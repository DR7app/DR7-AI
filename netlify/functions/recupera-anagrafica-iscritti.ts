/**
 * Ogni iscritto al sito deve avere la sua scheda cliente (26/08/2026).
 *
 * PERCHE' SERVE
 * La registrazione dal sito salva TUTTO nei metadati auth
 * (`auth.users.raw_user_meta_data`), poi copia i dati nella scheda cliente
 * (`customers_extended`) con UNA SOLA UPDATE. Bastava un valore rifiutato dal
 * database (un CAP piu' lungo della colonna, una data vuota, un check) per far
 * fallire l'INTERA update: nessun campo veniva scritto e la scheda restava con
 * la sola email — o non veniva creata affatto.
 *
 * Da qui la differenza che si vede nel gestionale: la tab "Iscritti al Sito"
 * legge anche i metadati auth (quindi mostra tutto), la tab Clienti legge solo
 * `customers_extended` (quindi mostra "Cliente" e due trattini, o non mostra
 * proprio l'iscritto).
 *
 * COSA FA
 * Per ogni iscritto indicato: se la scheda non c'e' la CREA, se c'e' la
 * completa con i dati della registrazione. Regole:
 *  - scrive SOLO dove il campo della scheda e' vuoto: nessun dato corretto,
 *    magari sistemato a mano dall'ufficio, viene sovrascritto;
 *  - se l'update completa viene rifiutata, riprova CAMPO PER CAMPO, cosi' il
 *    singolo valore problematico non si porta dietro tutti gli altri (e' lo
 *    stesso errore che ha causato il danno: non va ripetuto);
 *  - e' ripetibile: rilanciarla non cambia nulla per chi e' gia' a posto.
 *
 * Lavora SOLO sugli iscritti indicati, a piccoli gruppi: il gestionale chiama
 * la function piu' volte. Un solo giro su tutti gli iscritti supererebbe il
 * tempo massimo di una Netlify function e non ne salverebbe nemmeno uno.
 *
 * Scrive sull'anagrafica dei clienti, quindi non basta essere autenticati:
 * chi chiama dev'essere un operatore presente in `admins`.
 *
 * Si chiama da DUE tab, che cosi' smettono di vedere due verita' diverse:
 *  - "Iscritti al Sito" passa `userIds` (gli account del sito);
 *  - "Lead / Clienti" passa `customerIds` (le schede incomplete): la function
 *    risale da sola all'account e ai suoi dati.
 *
 * Body: { userIds?: string[], customerIds?: string[] }  -> massimo 50 in tutto.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type Meta = Record<string, any>

const MAX_PER_CHIAMATA = 50
// Le letture dell'API Auth sono indipendenti fra loro: a gruppi invece che
// una dopo l'altra, altrimenti 50 iscritti sono 50 giri in fila.
const IN_PARALLELO = 10

// ---------------------------------------------------------------------------
// Dai metadati auth ai campi della scheda
// ---------------------------------------------------------------------------

const testo = (...candidati: any[]): string => {
  for (const c of candidati) {
    const v = typeof c === 'string' ? c.trim() : c
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return ''
}

const vuoto = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

// Una data vuota o scritta male e' proprio uno dei valori che facevano
// fallire l'update: qui si scarta invece di riproporla.
const dataValida = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ''

/** Tutto quello che la registrazione ha messo nei metadati, con i nomi delle colonne. */
function anagraficaDaiMetadati(m: Meta): Record<string, string> {
  // I provider OAuth scrivono first_name/last_name o given_name/family_name,
  // l'iscrizione rapida scrive full_name: senza queste chiavi quegli iscritti
  // resterebbero senza nome anche dopo il recupero.
  let nome = testo(m.nome, m.first_name, m.given_name)
  let cognome = testo(m.cognome, m.last_name, m.family_name)
  if (!nome && !cognome) {
    const intero = testo(m.full_name, m.fullName, m.name)
    if (intero) {
      const parti = intero.split(/\s+/)
      nome = parti[0]
      cognome = parti.slice(1).join(' ')
    }
  }

  const campi: Record<string, string> = {
    tipo_cliente: testo(m.tipoCliente, m.tipo_cliente),
    nazione: testo(m.nazione),
    nome,
    cognome,
    telefono: testo(m.telefono, m.phone),
    pec: testo(m.pec),
    codice_fiscale: testo(m.codiceFiscale, m.codice_fiscale).toUpperCase(),
    sesso: testo(m.sesso),
    data_nascita: dataValida(testo(m.dataNascita, m.data_nascita)),
    citta_nascita: testo(m.cittaNascita, m.citta_nascita),
    provincia_nascita: testo(m.provinciaNascita, m.provincia_nascita),

    indirizzo: testo(m.indirizzo),
    numero_civico: testo(m.numeroCivico, m.numero_civico),
    codice_postale: testo(m.codicePostale, m.codice_postale),
    citta_residenza: testo(m.cittaResidenza, m.citta_residenza),
    provincia_residenza: testo(m.provinciaResidenza, m.provincia_residenza),
    citta: testo(m.citta),

    denominazione: testo(m.denominazione, m.company_name),
    partita_iva: testo(m.partitaIva, m.partita_iva),
    codice_destinatario: testo(m.codiceDestinatario, m.codice_destinatario),
    sede_operativa: testo(m.sedeOperativa, m.sede_operativa),
    rappresentante_nome: testo(m.rappresentanteNome, m.rappresentante_nome),
    rappresentante_cognome: testo(m.rappresentanteCognome, m.rappresentante_cognome),
    rappresentante_cf: testo(m.rappresentanteCF, m.rappresentante_cf).toUpperCase(),
    rappresentante_ruolo: testo(m.rappresentanteRuolo, m.rappresentante_ruolo),

    ente_ufficio: testo(m.enteUfficio, m.ente_ufficio),
    codice_univoco: testo(m.codiceUnivoco, m.codice_univoco),

    residency_zone: testo(m.residencyZone, m.residency_zone),

    tipo_patente: testo(m.tipoPatente, m.tipo_patente),
    numero_patente: testo(m.numeroPatente, m.numero_patente),
    patente_emessa_da: testo(m.patenteEmessaDa, m.patente_emessa_da),
    patente_data_rilascio: dataValida(testo(m.patenteDataRilascio, m.patente_data_rilascio)),
    patente_scadenza: dataValida(testo(m.patenteScadenza, m.patente_scadenza)),
  }

  // Il tipo cliente decide come la scheda viene letta ovunque (contratto,
  // fattura, dedup): se la registrazione non lo ha salvato si ricava da cosa
  // ha compilato l'iscritto, invece di lasciare la lead senza tipo.
  if (!campi.tipo_cliente) {
    if (campi.codice_univoco || campi.ente_ufficio) campi.tipo_cliente = 'pubblica_amministrazione'
    else if (campi.partita_iva || campi.denominazione) campi.tipo_cliente = 'azienda'
    else campi.tipo_cliente = 'persona_fisica'
  }

  for (const k of Object.keys(campi)) if (!campi[k]) delete campi[k]
  return campi
}

/**
 * 26/08/2026 — Seconda sorgente: i dati compilati nei FORM DI PRENOTAZIONE del
 * sito. Fino ad oggi finivano solo dentro `bookings.booking_details.customer`
 * e non risalivano mai alla scheda: chi si iscriveva e comprava un lavaggio
 * compariva in Clienti senza telefono ne' codice fiscale, anche se quei campi
 * li aveva scritti al momento di pagare. Qui si legge la prenotazione piu'
 * recente e si riempiono i buchi lasciati dai metadati.
 */
function anagraficaDallePrenotazioni(rows: Array<Record<string, any>>): Record<string, string> {
  const campi: Record<string, string> = {}
  // Dalla piu' recente alla piu' vecchia: la prima che valorizza un campo vince.
  for (const r of rows) {
    const c = (r?.booking_details?.customer || {}) as Record<string, any>
    const g = (r?.booking_details?.guest || r?.booking_details?.driver || {}) as Record<string, any>
    const metti = (colonna: string, ...valori: any[]) => {
      if (campi[colonna]) return
      const v = testo(...valori)
      if (v) campi[colonna] = v
    }

    if (!campi.nome && !campi.cognome) {
      const intero = testo(c.fullName, c.full_name, c.nome && c.cognome ? `${c.nome} ${c.cognome}` : '', g.fullName, r.customer_name)
      const nomeSolo = testo(c.nome, c.firstName, c.first_name, g.nome)
      const cognomeSolo = testo(c.cognome, c.lastName, c.last_name, g.cognome)
      if (nomeSolo || cognomeSolo) {
        if (nomeSolo) campi.nome = nomeSolo
        if (cognomeSolo) campi.cognome = cognomeSolo
      } else if (intero) {
        const parti = intero.split(/\s+/)
        campi.nome = parti[0]
        campi.cognome = parti.slice(1).join(' ')
      }
    }

    metti('telefono', c.phone, c.telefono, g.phone, r.customer_phone)
    metti('codice_fiscale', c.codiceFiscale, c.codice_fiscale, g.codiceFiscale)
    metti('indirizzo', c.indirizzo, c.address, c.via)
    metti('numero_civico', c.numeroCivico, c.numero_civico, c.civico)
    metti('codice_postale', c.codicePostale, c.codice_postale, c.cap)
    metti('citta_residenza', c.cittaResidenza, c.citta_residenza, c.citta, c.city)
    metti('provincia_residenza', c.provinciaResidenza, c.provincia_residenza, c.provincia)
    metti('data_nascita', dataValida(testo(c.dataNascita, c.data_nascita, c.birthDate)))
    metti('citta_nascita', c.cittaNascita, c.citta_nascita)
    metti('provincia_nascita', c.provinciaNascita, c.provincia_nascita)
    metti('nazione', c.nazione, c.country)
    metti('denominazione', c.denominazione, c.ragioneSociale, c.company_name)
    metti('partita_iva', c.partitaIva, c.partita_iva, c.vat)
    metti('pec', c.pec)
    metti('codice_destinatario', c.codiceDestinatario, c.codice_destinatario, c.sdi)
    metti('numero_patente', c.numeroPatente, c.numero_patente, c.licenseNumber)
    metti('tipo_patente', c.tipoPatente, c.tipo_patente)
    metti('patente_emessa_da', c.patenteEmessaDa, c.patente_emessa_da)
    metti('patente_data_rilascio', dataValida(testo(c.patenteDataRilascio, c.patente_data_rilascio)))
    metti('patente_scadenza', dataValida(testo(c.patenteScadenza, c.patente_scadenza, c.licenseExpiry)))
  }

  if (campi.codice_fiscale) campi.codice_fiscale = campi.codice_fiscale.toUpperCase()
  for (const k of Object.keys(campi)) if (!campi[k]) delete campi[k]
  return campi
}

// Tutti i nomi di colonna che questa function sa scrivere.
const CANDIDATE = Object.keys(anagraficaDaiMetadati({
  nome: 'x', cognome: 'x', telefono: 'x', pec: 'x', codiceFiscale: 'x', sesso: 'x',
  dataNascita: '2000-01-01', cittaNascita: 'x', provinciaNascita: 'x', indirizzo: 'x',
  numeroCivico: 'x', codicePostale: 'x', cittaResidenza: 'x', provinciaResidenza: 'x',
  citta: 'x', nazione: 'x', tipoCliente: 'x', denominazione: 'x', partitaIva: 'x',
  codiceDestinatario: 'x', sedeOperativa: 'x', rappresentanteNome: 'x',
  rappresentanteCognome: 'x', rappresentanteCF: 'x', rappresentanteRuolo: 'x',
  enteUfficio: 'x', codiceUnivoco: 'x', residencyZone: 'x', tipoPatente: 'x',
  numeroPatente: 'x', patenteEmessaDa: 'x', patenteDataRilascio: '2000-01-01',
  patenteScadenza: '2000-01-01',
}))

// Se anche uno solo di questi manca, la scheda e' inutilizzabile per
// contratto, fattura e messaggi: sono i campi che contano davvero.
const ESSENZIALI = ['tipo_cliente', 'nome', 'cognome', 'telefono', 'codice_fiscale', 'denominazione', 'partita_iva', 'ente_ufficio']

// Una colonna inesistente fa rifiutare a PostgREST l'INTERA query: si
// chiedono solo le colonne che questo database ha davvero.
let colonneNote: Set<string> | null = null
async function colonneEsistenti(): Promise<Set<string>> {
  if (colonneNote) return colonneNote
  const { data, error } = await supabase.from('customers_extended').select('*').limit(1)
  if (error || !data || data.length === 0) return new Set(CANDIDATE)
  colonneNote = new Set(Object.keys(data[0]))
  const mancanti = CANDIDATE.filter(c => !colonneNote!.has(c))
  if (mancanti.length) console.warn('[recupera-anagrafica] colonne assenti:', mancanti.join(', '))
  return colonneNote
}

// ---------------------------------------------------------------------------

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const auth = await requireAuth(event as unknown as { headers: Record<string, string> })
  if (auth.error) return auth.error

  // Il token di servizio interno (ADMIN_API_TOKEN) passa con id 'admin'.
  if (auth.user?.id !== 'admin') {
    const { data: operatore } = await supabase
      .from('admins')
      .select('id')
      .eq('user_id', auth.user?.id)
      .maybeSingle()
    if (!operatore) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Riservato agli operatori del gestionale.' }) }
    }
  }

  try {
    const { userIds, customerIds } = JSON.parse(event.body || '{}') as { userIds?: string[]; customerIds?: string[] }
    const ids = Array.from(new Set((userIds || []).map(v => String(v || '').trim()).filter(Boolean)))
    const schedaIds = Array.from(new Set((customerIds || []).map(v => String(v || '').trim()).filter(Boolean)))
    if (ids.length === 0 && schedaIds.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nessuna scheda indicata.' }) }
    }
    if (ids.length + schedaIds.length > MAX_PER_CHIAMATA) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Troppe schede in una sola volta (massimo ${MAX_PER_CHIAMATA}).` }) }
    }

    const errori: Array<{ email: string; errore: string }> = []

    // 1a. Chiamata dalla tab Lead/Clienti: si parte dalle SCHEDE. Se la scheda
    //     e' gia' legata a un account si recupera anche dai metadati auth;
    //     se non lo e', restano comunque le prenotazioni (letta per email).
    const schedeIndicate: Array<{ id: string; user_id: string | null; email: string }> = []
    if (schedaIds.length) {
      const { data: righe, error: schErr } = await supabase
        .from('customers_extended')
        .select('id, user_id, email')
        .in('id', schedaIds)
      if (schErr) throw schErr
      for (const r of (righe || []) as any[]) {
        schedeIndicate.push({ id: String(r.id), user_id: r.user_id ? String(r.user_id) : null, email: String(r.email || '').trim() })
      }
      for (const r of schedeIndicate) if (r.user_id && !ids.includes(r.user_id)) ids.push(r.user_id)
    }

    // 1b. Metadati auth degli account coinvolti.
    const utenti: Array<{ id: string | null; email: string; meta: Meta; schedaId?: string }> = []
    const metaDi = new Map<string, { email: string; meta: Meta }>()
    for (let da = 0; da < ids.length; da += IN_PARALLELO) {
      const gruppo = ids.slice(da, da + IN_PARALLELO)
      const letti = await Promise.all(gruppo.map(id => supabase.auth.admin.getUserById(id)))
      letti.forEach(({ data, error }, i) => {
        if (error || !data?.user) {
          errori.push({ email: gruppo[i], errore: error?.message || 'Account non trovato' })
          return
        }
        metaDi.set(data.user.id, {
          email: String(data.user.email || '').trim(),
          meta: (data.user.user_metadata || {}) as Meta,
        })
      })
    }

    // Soggetti da trattare: gli iscritti richiesti + le schede richieste
    // (senza doppioni quando la stessa persona arriva da entrambe le tab).
    const visti = new Set<string>()
    for (const id of (userIds || []).map(v => String(v || '').trim()).filter(Boolean)) {
      const m = metaDi.get(id)
      if (!m || visti.has(`u:${id}`)) continue
      visti.add(`u:${id}`)
      utenti.push({ id, email: m.email, meta: m.meta })
    }
    for (const sch of schedeIndicate) {
      const chiave = sch.user_id ? `u:${sch.user_id}` : `s:${sch.id}`
      if (visti.has(chiave)) continue
      visti.add(chiave)
      const m = sch.user_id ? metaDi.get(sch.user_id) : null
      utenti.push({
        id: sch.user_id,
        email: m?.email || sch.email,
        meta: m?.meta || {},
        schedaId: sch.id,
      })
    }

    // 2. Schede gia' esistenti — per user_id e, in riserva, per email: molte
    //    schede vecchie hanno solo l'email e collegarle evita di creare un
    //    doppione della stessa persona.
    const colonne = await colonneEsistenti()
    const scrivibili = CANDIDATE.filter(c => colonne.has(c))
    const selezione = ['id', 'user_id', 'email', ...scrivibili].join(', ')
    const emails = utenti.map(u => u.email.toLowerCase()).filter(Boolean)

    const [perId, perMail, prenId, prenMail] = await Promise.all([
      supabase.from('customers_extended').select(selezione).in('user_id', utenti.map(u => u.id).filter(Boolean) as string[]),
      emails.length
        ? supabase.from('customers_extended').select(selezione).in('email', emails)
        : Promise.resolve({ data: [], error: null } as any),
      // Prenotazioni dell'iscritto: seconda sorgente dell'anagrafica.
      supabase.from('bookings')
        .select('user_id, customer_email, customer_name, customer_phone, booking_details, created_at')
        .in('user_id', utenti.map(u => u.id).filter(Boolean) as string[])
        .order('created_at', { ascending: false })
        .limit(500),
      emails.length
        ? supabase.from('bookings')
            .select('user_id, customer_email, customer_name, customer_phone, booking_details, created_at')
            .in('customer_email', emails)
            .order('created_at', { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null } as any),
    ])
    if (perId.error) throw perId.error

    // Le prenotazioni sono una riserva: se la lettura fallisce si va avanti
    // coi soli metadati, non si perde tutto il recupero.
    if (prenId.error) console.warn('[recupera-anagrafica] prenotazioni per account non lette:', prenId.error.message)
    if (prenMail.error) console.warn('[recupera-anagrafica] prenotazioni per email non lette:', prenMail.error.message)
    const prenotazioniDi = new Map<string, Array<Record<string, any>>>()
    const prenotazioniPerEmail = new Map<string, Array<Record<string, any>>>()
    for (const b of ((prenId.data || []) as any[])) {
      const k = String(b.user_id || '')
      if (!k) continue
      if (!prenotazioniDi.has(k)) prenotazioniDi.set(k, [])
      prenotazioniDi.get(k)!.push(b)
    }
    for (const b of ((prenMail.data || []) as any[])) {
      const k = String(b.customer_email || '').trim().toLowerCase()
      if (!k) continue
      if (!prenotazioniPerEmail.has(k)) prenotazioniPerEmail.set(k, [])
      prenotazioniPerEmail.get(k)!.push(b)
    }

    const schedaDi = new Map<string, any>()
    const schedaPerEmail = new Map<string, any>()
    for (const s of (perId.data || []) as any[]) if (s.user_id) schedaDi.set(s.user_id, s)
    for (const s of (perMail.data || []) as any[]) {
      const em = String(s.email || '').trim().toLowerCase()
      if (em && !schedaPerEmail.has(em)) schedaPerEmail.set(em, s)
    }

    // Le schede arrivate per id dalla tab Lead: si rileggono per intero cosi'
    // il confronto "campo vuoto" usa la riga vera, non solo id/user_id/email.
    const schedaIndicataPerId = new Map<string, any>()
    if (schedeIndicate.length) {
      const { data: complete } = await supabase
        .from('customers_extended')
        .select(selezione)
        .in('id', schedeIndicate.map(s2 => s2.id))
      for (const r of ((complete || []) as any[])) schedaIndicataPerId.set(String(r.id), r)
    }

    let aggiornati = 0        // schede esistenti completate
    let create = 0            // schede che non esistevano: l'iscritto entra in Clienti
    let collegate = 0         // scheda trovata per email e agganciata all'account
    let gia_complete = 0      // niente da recuperare
    let campiScritti = 0
    let campiRifiutati = 0
    const rifiutati: Array<{ email: string; campo: string; errore: string }> = []

    let daPrenotazione = 0    // campi recuperati dai form di prenotazione

    for (const u of utenti) {
      const daiMetadati = anagraficaDaiMetadati(u.meta)
      const scheda = (u.schedaId ? schedaIndicataPerId.get(u.schedaId) : null)
        || (u.id ? schedaDi.get(u.id) : null)
        || (u.email ? schedaPerEmail.get(u.email.toLowerCase()) : null)

      // I metadati dell'iscrizione vengono prima; quello che manca lo
      // completano i dati compilati nelle prenotazioni.
      const prenotazioni = [
        ...(u.id ? (prenotazioniDi.get(u.id) || []) : []),
        ...(u.email ? (prenotazioniPerEmail.get(u.email.toLowerCase()) || []) : []),
      ]
      const dallePrenotazioni = prenotazioni.length ? anagraficaDallePrenotazioni(prenotazioni) : {}

      // Solo i campi VUOTI nella scheda: nessuna sovrascrittura di dati buoni.
      const patch: Record<string, any> = {}
      for (const campo of scrivibili) {
        const daMeta = daiMetadati[campo]
        const daPren = dallePrenotazioni[campo]
        const valore = daMeta || daPren
        if (!valore) continue
        if (scheda && !vuoto(scheda[campo])) continue
        patch[campo] = valore
        if (!daMeta && daPren) daPrenotazione++
      }
      // Il tipo cliente non arriva mai dal form di prenotazione: se la scheda
      // nasce solo da li' resterebbe senza, e senza tipo la lead non e'
      // leggibile da contratto, fattura e dedup.
      if (!patch.tipo_cliente && scrivibili.includes('tipo_cliente') && (!scheda || vuoto(scheda.tipo_cliente))) {
        patch.tipo_cliente = (patch.partita_iva || patch.denominazione) ? 'azienda' : 'persona_fisica'
      }

      // ------------------------------------------------------------------
      // Scheda mai creata: va creata, altrimenti l'iscritto non esiste per
      // la tab Clienti, per i contratti, per le fatture e per i messaggi.
      // ------------------------------------------------------------------
      if (!scheda) {
        const base: Record<string, any> = { ...(u.id ? { user_id: u.id } : {}), email: u.email, source: 'website', ...patch }
        const { error: insErr } = await supabase.from('customers_extended').insert(base)
        if (!insErr) {
          create++
          campiScritti += Object.keys(patch).length
          continue
        }
        // Riprova con la sola anagrafica essenziale: meglio una scheda
        // minima che nessuna scheda.
        const minimo: Record<string, any> = { ...(u.id ? { user_id: u.id } : {}), email: u.email, source: 'website' }
        for (const c of ESSENZIALI) if (patch[c]) minimo[c] = patch[c]
        const { error: insErr2 } = await supabase.from('customers_extended').insert(minimo)
        if (insErr2) {
          errori.push({ email: u.email || u.id || '', errore: insErr2.message })
          continue
        }
        const scritti = Object.keys(minimo).length - 3
        campiScritti += scritti
        campiRifiutati += Object.keys(patch).length - scritti
        create++
        continue
      }

      // La scheda esisteva ma non era legata all'account: si aggancia, cosi'
      // il wallet e le prenotazioni del sito trovano la persona giusta.
      if (!scheda.user_id && u.id) {
        const { error: linkErr } = await supabase
          .from('customers_extended')
          .update({ user_id: u.id })
          .eq('id', scheda.id)
        if (!linkErr) collegate++
        else console.warn('[recupera-anagrafica] aggancio account fallito per', u.email, '-', linkErr.message)
      }

      if (Object.keys(patch).length === 0) { gia_complete++; continue }

      const { error: updErr } = await supabase
        .from('customers_extended')
        .update(patch)
        .eq('id', scheda.id)

      if (!updErr) {
        aggiornati++
        campiScritti += Object.keys(patch).length
        continue
      }

      // 26/08/2026 — QUI sta la lezione del guasto: una sola update rifiutata
      // non deve far perdere tutti gli altri campi. Si riscrive campo per
      // campo, cosi' si salva tutto tranne il singolo valore che il database
      // non accetta (di solito un CAP troppo lungo o un check).
      console.warn('[recupera-anagrafica] update in blocco rifiutata per', u.email, '-', updErr.message)
      let scrittiQui = 0
      for (const [campo, valore] of Object.entries(patch)) {
        const { error: e1 } = await supabase
          .from('customers_extended')
          .update({ [campo]: valore })
          .eq('id', scheda.id)
        if (e1) {
          campiRifiutati++
          rifiutati.push({ email: u.email || u.id || '', campo, errore: e1.message })
        } else {
          scrittiQui++
        }
      }
      if (scrittiQui > 0) {
        aggiornati++
        campiScritti += scrittiQui
      } else {
        errori.push({ email: u.email || u.id || '', errore: updErr.message })
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        esaminati: utenti.length,
        create,
        aggiornati,
        collegate,
        gia_complete,
        campiScritti,
        campiRifiutati,
        // Quanti campi sono stati salvati grazie ai form di prenotazione:
        // e' la differenza rispetto al recupero dai soli metadati.
        daPrenotazione,
        // Solo i primi: servono a capire QUALE campo il database rifiuta,
        // non a elencare tutti gli iscritti.
        rifiutati: rifiutati.slice(0, 20),
        errori: errori.slice(0, 20),
      }),
    }
  } catch (e) {
    console.error('[recupera-anagrafica-iscritti]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore nel recupero' }) }
  }
}

export { handler }
