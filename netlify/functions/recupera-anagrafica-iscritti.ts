/**
 * Recupero dell'anagrafica degli iscritti al sito (26/08/2026).
 *
 * PERCHE' SERVE
 * La registrazione dal sito salva TUTTO nei metadati auth
 * (`auth.users.raw_user_meta_data`), poi copia i dati nella scheda cliente
 * (`customers_extended`) con UNA SOLA UPDATE. Bastava un valore rifiutato dal
 * database (un CAP piu' lungo della colonna, una data vuota, un check) per far
 * fallire l'INTERA update: nessun campo veniva scritto e la scheda restava con
 * la sola email, anche se il cliente aveva compilato nome, cognome, codice
 * fiscale, indirizzo e citta'.
 *
 * Da qui la differenza che si vede nel gestionale: la tab "Iscritti al Sito"
 * legge anche i metadati auth (quindi mostra tutto), la tab Clienti legge solo
 * `customers_extended` (quindi mostra "Cliente" e due trattini).
 *
 * COSA FA
 * Rimette i dati nella scheda leggendoli dai metadati auth. Regole:
 *  - scrive SOLO dove il campo della scheda e' vuoto: nessun dato corretto,
 *    magari sistemato a mano dall'ufficio, viene sovrascritto;
 *  - se l'update completa viene rifiutata, riprova CAMPO PER CAMPO, cosi' il
 *    singolo valore problematico non si porta dietro tutti gli altri (e' lo
 *    stesso errore che ha causato il danno: non va ripetuto);
 *  - se la scheda non esiste proprio, la crea;
 *  - e' ripetibile: rilanciarla non cambia nulla per chi e' gia' a posto.
 *
 * Scrive sull'anagrafica dei clienti, quindi non basta essere autenticati:
 * chi chiama dev'essere un operatore presente in `admins`.
 *
 * Body: { userIds?: string[] }  -> se assente, passa tutti gli iscritti.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type Meta = Record<string, any>

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

// Come in list-site-users: pagine piccole e qualche tentativo. Con qualche
// migliaio di iscritti una sola richiesta da 1000 va in timeout (504) e
// l'errore azzererebbe tutto il recupero.
const UTENTI_PER_PAGINA = 200
const PAGINE_MAX = 200
const TENTATIVI = 3
const PAGINE_IN_PARALLELO = 6

const attendi = (ms: number) => new Promise(r => setTimeout(r, ms))

async function utentiDellaPagina(page: number): Promise<any[] | null> {
  for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: UTENTI_PER_PAGINA })
    if (!error) return data?.users || []
    console.warn(`[recupera-anagrafica] pagina ${page}, tentativo ${tentativo}: ${error.message || error}`)
    if (tentativo < TENTATIVI) await attendi(400 * tentativo)
  }
  return null
}

async function tuttiGliUtenti(): Promise<{ utenti: any[]; pagineMancanti: number }> {
  const utenti: any[] = []
  let pagineMancanti = 0

  const { data: prima, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: UTENTI_PER_PAGINA })
  if (error) {
    const ripiego = await utentiDellaPagina(1)
    if (!ripiego) throw error
    return { utenti: ripiego, pagineMancanti: 0 }
  }
  utenti.push(...(prima?.users || []))

  const ultima = Math.min(Number((prima as { lastPage?: number })?.lastPage) || 1, PAGINE_MAX)
  if (ultima <= 1 || (prima?.users?.length || 0) < UTENTI_PER_PAGINA) return { utenti, pagineMancanti }

  for (let da = 2; da <= ultima; da += PAGINE_IN_PARALLELO) {
    const gruppo: number[] = []
    for (let p = da; p < da + PAGINE_IN_PARALLELO && p <= ultima; p++) gruppo.push(p)
    const risultati = await Promise.all(gruppo.map(p => utentiDellaPagina(p)))
    for (const lista of risultati) {
      if (lista === null) { pagineMancanti++; continue }
      utenti.push(...lista)
    }
  }
  return { utenti, pagineMancanti }
}

// PostgREST tronca ogni richiesta a 1000 righe: senza paginazione le schede
// oltre la millesima non verrebbero mai lette (e quindi mai riparate).
async function leggiTutteLeSchede(colonne: string) {
  const righe: any[] = []
  const BLOCCO = 1000
  for (let da = 0; ; da += BLOCCO) {
    const { data, error } = await supabase
      .from('customers_extended')
      .select(colonne)
      .range(da, da + BLOCCO - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    righe.push(...data)
    if (data.length < BLOCCO) break
  }
  return righe
}

// Una colonna inesistente fa rifiutare a PostgREST l'INTERA query: si
// chiedono solo le colonne che questo database ha davvero.
async function colonneEsistenti(volute: string[]): Promise<Set<string>> {
  const { data, error } = await supabase.from('customers_extended').select('*').limit(1)
  if (error || !data || data.length === 0) return new Set(volute)
  const presenti = new Set(Object.keys(data[0]))
  const mancanti = volute.filter(c => !presenti.has(c))
  if (mancanti.length) console.warn('[recupera-anagrafica] colonne assenti:', mancanti.join(', '))
  return presenti
}

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

  for (const k of Object.keys(campi)) if (!campi[k]) delete campi[k]
  return campi
}

// Se anche uno solo di questi manca, la scheda e' inutilizzabile per
// contratto, fattura e messaggi: sono i campi che contano davvero.
const ESSENZIALI = ['nome', 'cognome', 'telefono', 'codice_fiscale', 'denominazione', 'partita_iva', 'ente_ufficio']

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
    const { userIds } = JSON.parse(event.body || '{}') as { userIds?: string[] }
    const filtro = new Set((userIds || []).map(v => String(v || '').trim()).filter(Boolean))

    const { utenti, pagineMancanti } = await tuttiGliUtenti()
    const daTrattare = filtro.size > 0 ? utenti.filter(u => filtro.has(u.id)) : utenti

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
    const colonne = await colonneEsistenti(CANDIDATE)
    const scrivibili = CANDIDATE.filter(c => colonne.has(c))

    const schede = await leggiTutteLeSchede(['id', 'user_id', 'email', ...scrivibili].join(', '))
    const perUserId = new Map<string, any>()
    const perEmail = new Map<string, any>()
    for (const s of schede) {
      if (s.user_id) perUserId.set(s.user_id, s)
      const em = String(s.email || '').trim().toLowerCase()
      if (em && !perEmail.has(em)) perEmail.set(em, s)
    }

    let aggiornati = 0        // schede esistenti riempite
    let create = 0            // schede che non esistevano
    let gia_complete = 0      // niente da recuperare
    let campiScritti = 0
    let campiRifiutati = 0
    const errori: Array<{ email: string; errore: string }> = []
    const rifiutati: Array<{ email: string; campo: string; errore: string }> = []

    for (const u of daTrattare) {
      const email = String(u.email || '').trim()
      const meta = (u.user_metadata || {}) as Meta
      const daiMetadati = anagraficaDaiMetadati(meta)
      const scheda = perUserId.get(u.id) || (email ? perEmail.get(email.toLowerCase()) : null)

      // Solo i campi VUOTI nella scheda: nessuna sovrascrittura di dati buoni.
      const patch: Record<string, string> = {}
      for (const campo of scrivibili) {
        const valore = daiMetadati[campo]
        if (!valore) continue
        if (scheda && !vuoto(scheda[campo])) continue
        patch[campo] = valore
      }

      // Scheda mai creata: va creata, altrimenti quell'iscritto non esiste
      // per contratti, fatture e messaggi.
      if (!scheda) {
        if (!email && Object.keys(patch).length === 0) { gia_complete++; continue }
        const base: Record<string, any> = { user_id: u.id, email, source: 'website', ...patch }
        const { error: insErr } = await supabase.from('customers_extended').insert(base)
        if (insErr) {
          // Riprova con la sola anagrafica essenziale: meglio una scheda
          // minima che nessuna scheda.
          const minimo: Record<string, any> = { user_id: u.id, email, source: 'website' }
          for (const c of ESSENZIALI) if (patch[c]) minimo[c] = patch[c]
          const { error: insErr2 } = await supabase.from('customers_extended').insert(minimo)
          if (insErr2) {
            errori.push({ email: email || u.id, errore: insErr2.message })
            continue
          }
          campiScritti += Object.keys(minimo).length - 3
          campiRifiutati += Object.keys(patch).length - (Object.keys(minimo).length - 3)
        } else {
          campiScritti += Object.keys(patch).length
        }
        create++
        continue
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
      console.warn('[recupera-anagrafica] update in blocco rifiutata per', email, '-', updErr.message)
      let scrittiQui = 0
      for (const [campo, valore] of Object.entries(patch)) {
        const { error: e1 } = await supabase
          .from('customers_extended')
          .update({ [campo]: valore })
          .eq('id', scheda.id)
        if (e1) {
          campiRifiutati++
          rifiutati.push({ email: email || u.id, campo, errore: e1.message })
        } else {
          scrittiQui++
        }
      }
      if (scrittiQui > 0) {
        aggiornati++
        campiScritti += scrittiQui
      } else {
        errori.push({ email: email || u.id, errore: updErr.message })
      }
    }

    if (pagineMancanti > 0) {
      console.warn(`[recupera-anagrafica] ${pagineMancanti} pagine auth non lette dopo i tentativi`)
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        esaminati: daTrattare.length,
        aggiornati,
        create,
        gia_complete,
        campiScritti,
        campiRifiutati,
        // Solo i primi: servono a capire QUALE campo il database rifiuta,
        // non a elencare tutti gli iscritti.
        rifiutati: rifiutati.slice(0, 20),
        errori: errori.slice(0, 20),
        pagine_auth_mancanti: pagineMancanti,
      }),
    }
  } catch (e) {
    console.error('[recupera-anagrafica-iscritti]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore nel recupero' }) }
  }
}

export { handler }
