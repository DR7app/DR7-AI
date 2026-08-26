import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Meta = Record<string, any>

// Una colonna inesistente fa rifiutare a PostgREST l'INTERA query: si
// perderebbe tutto l'elenco per un campo accessorio. Quindi si chiedono solo
// le colonne che questo database ha davvero.
async function colonneEsistenti(tabella: string, volute: string[]): Promise<string[]> {
  const { data, error } = await supabase.from(tabella).select('*').limit(1)
  if (error || !data || data.length === 0) return volute
  const presenti = new Set(Object.keys(data[0]))
  const ok = volute.filter(c => presenti.has(c))
  const mancanti = volute.filter(c => !presenti.has(c))
  if (mancanti.length) console.warn(`[list-site-users] colonne assenti su ${tabella}:`, mancanti.join(', '))
  return ok.length ? ok : volute
}

// PostgREST tronca ogni richiesta a 1000 righe. Ogni tabella letta qui va
// scorsa a blocchi, altrimenti gli iscritti oltre il millesimo restano senza
// dati: e' esattamente il difetto che svuotava l'elenco.
async function leggiTutto(tabella: string, colonne: string) {
  const righe: any[] = []
  const BLOCCO = 1000
  for (let da = 0; ; da += BLOCCO) {
    const { data, error } = await supabase
      .from(tabella)
      .select(colonne)
      .range(da, da + BLOCCO - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    righe.push(...data)
    if (data.length < BLOCCO) break
  }
  return righe
}

// I dati della registrazione stanno SEMPRE nei metadati auth; la scheda
// cliente e' una copia che puo' essere rimasta indietro. Quindi: prima la
// scheda, poi i metadati (in entrambe le grafie usate dal sito).
const valore = (...candidati: any[]): string => {
  for (const c of candidati) {
    const v = typeof c === 'string' ? c.trim() : c
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return ''
}

const nomeIntero = (m: Meta) =>
  valore(m.full_name, m.fullName, m.name)

// 26/08/2026 — L'elenco iscritti restava VUOTO: `listUsers({ perPage: 1000 })`
// superava il tempo massimo dell'API Auth (504 AuthRetryableFetchError) e
// l'errore azzerava tutta la lista. Cresciuto il numero di iscritti, mille
// utenti in una sola richiesta non si leggono piu'.
// Pagine piccole, tre tentativi con attesa crescente, e una pagina persa non
// cancella le altre: meglio un elenco quasi completo che un elenco vuoto.
const UTENTI_PER_PAGINA = 200
const PAGINE_MAX = 200
const TENTATIVI = 3
// 26/08/2026 — le pagine si leggevano una dopo l'altra: con qualche migliaio
// di iscritti erano decine di chiamate in fila e la schermata restava a
// caricare. L'API Auth dice gia' alla prima pagina quante ce ne sono, quindi
// le altre si chiedono a gruppi. Sei alla volta: abbastanza per essere
// veloce, poche abbastanza da non farsi limitare dall'API.
const PAGINE_IN_PARALLELO = 6

const attendi = (ms: number) => new Promise(r => setTimeout(r, ms))

async function utentiDellaPagina(page: number): Promise<any[] | null> {
  for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: UTENTI_PER_PAGINA })
    if (!error) return data?.users || []
    console.warn(`[list-site-users] pagina ${page}, tentativo ${tentativo}: ${error.message || error}`)
    if (tentativo < TENTATIVI) await attendi(400 * tentativo)
  }
  return null
}

export const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    // Utenti auth. Le tabelle qui sotto non dipendono dagli utenti: si leggono
    // NELLO STESSO TEMPO invece che una dopo l'altra.
    const utenti: Array<{ id: string; email: string; created_at: string; email_confirmed_at: string | null; last_sign_in_at: string | null; meta: Meta }> = []
    let paginaMancante = 0

    const aggiungi = (lista: any[]) => {
      for (const u of lista) {
        utenti.push({
          id: u.id,
          email: u.email || '',
          created_at: u.created_at,
          email_confirmed_at: u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          meta: (u.user_metadata || {}) as Meta,
        })
      }
    }

    const leggiUtenti = async () => {
      // Prima pagina da sola: dice quante pagine ci sono in tutto.
      const { data: prima, error: erroreP1 } = await supabase.auth.admin.listUsers({ page: 1, perPage: UTENTI_PER_PAGINA })
      if (erroreP1) {
        const ripiego = await utentiDellaPagina(1)
        if (!ripiego) throw erroreP1
        aggiungi(ripiego)
        return
      }
      aggiungi(prima?.users || [])
      const ultima = Math.min(Number((prima as { lastPage?: number })?.lastPage) || 1, PAGINE_MAX)
      if (ultima <= 1 || (prima?.users?.length || 0) < UTENTI_PER_PAGINA) return

      // Le pagine restanti a gruppi. Una pagina persa dopo i tentativi non
      // cancella le altre: meglio un elenco quasi completo che uno vuoto.
      for (let da = 2; da <= ultima; da += PAGINE_IN_PARALLELO) {
        const gruppo = []
        for (let p = da; p < da + PAGINE_IN_PARALLELO && p <= ultima; p++) gruppo.push(p)
        const risultati = await Promise.all(gruppo.map(p => utentiDellaPagina(p)))
        for (const lista of risultati) {
          if (lista === null) { paginaMancante++; continue }
          aggiungi(lista)
        }
      }
    }

    const leggiSaldi = async () => {
      const saldi = await leggiTutto('user_credit_balance', 'user_id, balance')
      const m = new Map<string, number>()
      for (const b of saldi) m.set(b.user_id, Number(b.balance) || 0)
      return m
    }

    // Bonus benvenuto: chi lo ha gia' ricevuto (reference_type = welcome_bonus)
    const leggiBonus = async () => {
      const bonus = new Set<string>()
      try {
        const BLOCCO = 1000
        for (let da = 0; ; da += BLOCCO) {
          const { data, error } = await supabase
            .from('credit_transactions')
            .select('user_id')
            .eq('reference_type', 'welcome_bonus')
            .range(da, da + BLOCCO - 1)
          if (error) throw error
          if (!data || data.length === 0) break
          for (const t of data) if (t.user_id) bonus.add(t.user_id)
          if (data.length < BLOCCO) break
        }
      } catch (e: any) {
        console.warn('[list-site-users] bonus non leggibile:', e.message)
      }
      return bonus
    }

    // Schede cliente complete
    const VOLUTE = [
      'user_id', 'email', 'tipo_cliente', 'nazione', 'nome', 'cognome', 'telefono', 'pec',
      'codice_fiscale', 'sesso', 'data_nascita', 'citta_nascita', 'provincia_nascita',
      'indirizzo', 'numero_civico', 'codice_postale', 'citta_residenza', 'provincia_residenza',
      'denominazione', 'ragione_sociale', 'partita_iva', 'codice_destinatario', 'sede_operativa',
      'rappresentante_nome', 'rappresentante_cognome', 'rappresentante_cf', 'rappresentante_ruolo',
      'ente_ufficio', 'codice_univoco', 'citta', 'source', 'created_at',
    ]
    const leggiSchede = async () => leggiTutto(
      'customers_extended',
      (await colonneEsistenti('customers_extended', VOLUTE)).join(', ')
    )

    // Le quattro letture partono insieme: la piu' lenta detta il tempo totale.
    const [, saldoDi, bonus, schede] = await Promise.all([
      leggiUtenti(),
      leggiSaldi(),
      leggiBonus(),
      leggiSchede(),
    ])
    if (paginaMancante > 0) {
      console.warn(`[list-site-users] ${paginaMancante} pagine auth non lette dopo i tentativi`)
    }
    const schedaDi = new Map<string, any>()
    const schedaPerEmail = new Map<string, any>()
    for (const c of schede) {
      if (c.user_id) schedaDi.set(c.user_id, c)
      const em = (c.email || '').trim().toLowerCase()
      if (em && !schedaPerEmail.has(em)) schedaPerEmail.set(em, c)
    }

    const arricchiti = utenti.map(u => {
      const em = (u.email || '').trim().toLowerCase()
      const c = schedaDi.get(u.id) || (em ? schedaPerEmail.get(em) : null) || {}
      const m = u.meta || {}

      // I provider OAuth scrivono first_name/last_name o given_name/family_name,
      // l'iscrizione rapida del sito scrive full_name: senza queste chiavi
      // quegli iscritti restavano senza nessun nome.
      let nome = valore(c.nome, m.nome, m.first_name, m.given_name)
      let cognome = valore(c.cognome, m.cognome, m.last_name, m.family_name)
      if (!nome && !cognome) {
        const intero = nomeIntero(m)
        if (intero) {
          const parti = intero.split(/\s+/)
          nome = parti[0]
          cognome = parti.slice(1).join(' ')
        }
      }
      // Azienda iscritta dal sito: la persona e' il rappresentante legale.
      if (!nome && !cognome) {
        nome = valore(c.rappresentante_nome, m.rappresentanteNome)
        cognome = valore(c.rappresentante_cognome, m.rappresentanteCognome)
      }

      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
        balance: saldoDi.get(u.id) || 0,
        bonus_benvenuto: bonus.has(u.id),
        ha_scheda: !!c.user_id || !!c.email,

        // Anagrafica
        tipo_cliente: valore(c.tipo_cliente, m.tipoCliente),
        nazione: valore(c.nazione, m.nazione),
        nome,
        cognome,
        telefono: valore(c.telefono, m.telefono, m.phone),
        pec: valore(c.pec, m.pec),
        codice_fiscale: valore(c.codice_fiscale, m.codiceFiscale, m.codice_fiscale),
        sesso: valore(c.sesso, m.sesso),
        data_nascita: valore(c.data_nascita, m.dataNascita, m.data_nascita),
        citta_nascita: valore(c.citta_nascita, m.cittaNascita, m.citta_nascita),
        provincia_nascita: valore(c.provincia_nascita, m.provinciaNascita, m.provincia_nascita),

        // Residenza
        indirizzo: valore(c.indirizzo, m.indirizzo),
        numero_civico: valore(c.numero_civico, m.numeroCivico, m.numero_civico),
        codice_postale: valore(c.codice_postale, m.codicePostale, m.codice_postale),
        citta_residenza: valore(c.citta_residenza, m.cittaResidenza, m.citta_residenza, c.citta, m.citta),
        provincia_residenza: valore(c.provincia_residenza, m.provinciaResidenza, m.provincia_residenza),

        // Azienda
        denominazione: valore(c.denominazione, c.ragione_sociale, m.denominazione, m.company_name),
        partita_iva: valore(c.partita_iva, m.partitaIva, m.partita_iva),
        codice_destinatario: valore(c.codice_destinatario, m.codiceDestinatario),
        sede_operativa: valore(c.sede_operativa, m.sedeOperativa),
        rappresentante: valore(
          `${valore(c.rappresentante_nome, m.rappresentanteNome)} ${valore(c.rappresentante_cognome, m.rappresentanteCognome)}`.trim()
        ),
        rappresentante_cf: valore(c.rappresentante_cf, m.rappresentanteCF),
        rappresentante_ruolo: valore(c.rappresentante_ruolo, m.rappresentanteRuolo),

        // Pubblica amministrazione
        ente_ufficio: valore(c.ente_ufficio, m.enteUfficio),
        codice_univoco: valore(c.codice_univoco, m.codiceUnivoco),

        source: valore(c.source, m.source),
      }
    })

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, users: arricchiti, total: arricchiti.length }),
    }
  } catch (err: any) {
    console.error('[list-site-users] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
