/**
 * Iscritti al Sito — lettura a pagine (02/09/2026).
 *
 * Prima la tab chiedeva TUTTI gli iscritti a `list-site-users`, che a sua
 * volta pagina ogni account auth, rilegge customers_extended per intero, i
 * saldi wallet e le transazioni del bonus, e risponde con un JSON enorme che
 * il browser trasforma in una riga di tabella per ogni iscritto. Oltre i
 * ventimila account l'apertura della pagina va in decine di secondi.
 *
 * Adesso si chiede al database una pagina alla volta (`iscritti_sito_elenco`),
 * i numeri delle carte sono conteggi (`iscritti_sito_statistiche`) e gli id
 * delle azioni di massa li elenca il database (`iscritti_sito_ids`).
 *
 * VIA LENTA: finche' la migrazione `20260902_iscritti_sito_paginazione.sql`
 * non e' stata eseguita le tre funzioni non esistono. In quel caso si torna
 * esattamente al comportamento di prima — elenco intero da `list-site-users`,
 * filtri e conteggi nel browser — cosi' la tab resta usabile invece di
 * mostrare un errore. La lista pesante si scarica UNA volta per sessione:
 * cambiare pagina o ricerca non la richiede di nuovo.
 */
import { supabase } from '../supabaseClient'
import { authFetch } from './authFetch'

export interface IscrittoSito {
  id: string
  email: string
  created_at: string
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  balance: number
  bonus_benvenuto: boolean
  ha_scheda: boolean
  // Dati compilati in registrazione ma mai finiti nella scheda cliente
  da_recuperare: boolean
  // Anagrafica compilata in fase di registrazione
  tipo_cliente: string
  nazione: string
  nome: string
  cognome: string
  telefono: string
  pec: string
  codice_fiscale: string
  sesso: string
  data_nascita: string
  citta_nascita: string
  provincia_nascita: string
  // Residenza
  indirizzo: string
  numero_civico: string
  codice_postale: string
  citta_residenza: string
  provincia_residenza: string
  // Azienda
  denominazione: string
  partita_iva: string
  codice_destinatario: string
  sede_operativa: string
  rappresentante: string
  rappresentante_cf: string
  rappresentante_ruolo: string
  // Pubblica amministrazione
  ente_ufficio: string
  codice_univoco: string
  source: string
}

export type OrdineIscritti = 'nome' | 'email' | 'created_at' | 'last_sign_in_at' | 'balance'

export interface PaginaIscritti {
  righe: IscrittoSito[]
  totale: number
  /** true = risposta ottenuta dalla via lenta (migrazione non ancora eseguita) */
  lento: boolean
}

export interface StatisticheIscritti {
  totale: number
  verificati: number
  non_verificati: number
  nuovi_mese: number
  credito_totale: number
  senza_bonus: number
  senza_bonus_a_zero: number
  schede_incomplete: number
  da_recuperare: number
  senza_scheda: number
  andamento: Array<{ giorno: string; quanti: number }>
  top_credito: Array<{ id: string; nome: string; email: string; balance: number }>
  lento: boolean
}

/**
 * Un iscritto azienda/PA non ha nome e cognome: il suo nome e' la ragione
 * sociale. Una sola regola per tabella, ricerca e ordinamento.
 */
export const nomeVisibile = (u: { nome?: string; cognome?: string; denominazione?: string; ente_ufficio?: string }) =>
  `${u.nome || ''} ${u.cognome || ''}`.trim()
  || (u.denominazione || '').trim()
  || (u.ente_ufficio || '').trim()

/**
 * La funzione non esiste (migrazione non ancora eseguita) oppure lo schema
 * non e' ancora nella cache di PostgREST. Solo in questi casi si ripiega:
 * un "non autorizzato" deve restare un errore, non diventare una scorciatoia.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function funzioneMancante(errore: any): boolean {
  const codice = String(errore?.code || '')
  const messaggio = String(errore?.message || '').toLowerCase()
  return codice === 'PGRST202' || codice === '42883' || codice === '42P01'
    || messaggio.includes('could not find the function')
    || messaggio.includes('does not exist')
}

// --- via lenta: elenco intero scaricato una volta sola per sessione ---------

let elencoLento: Promise<IscrittoSito[]> | null = null

async function tuttiGliIscritti(): Promise<IscrittoSito[]> {
  if (!elencoLento) {
    elencoLento = (async () => {
      const res = await authFetch('/.netlify/functions/list-site-users')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success || !Array.isArray(data.users)) {
        throw new Error(data?.error || 'Impossibile leggere l\'elenco degli iscritti.')
      }
      return data.users as IscrittoSito[]
    })().catch(e => { elencoLento = null; throw e })
  }
  return elencoLento
}

/** La lista pesante e' cambiata sul database: alla prossima richiesta si rilegge. */
export function scordaElencoLento() {
  elencoLento = null
}

function filtraOrdinaLento(
  tutti: IscrittoSito[], cerca: string, ordine: OrdineIscritti, dir: 'asc' | 'desc',
): IscrittoSito[] {
  const q = cerca.trim().toLowerCase()
  const base = q
    ? tutti.filter(u => (
        u.email?.toLowerCase().includes(q) ||
        u.nome?.toLowerCase().includes(q) ||
        u.cognome?.toLowerCase().includes(q) ||
        u.denominazione?.toLowerCase().includes(q) ||
        u.ente_ufficio?.toLowerCase().includes(q) ||
        u.codice_fiscale?.toLowerCase().includes(q) ||
        u.partita_iva?.toLowerCase().includes(q) ||
        u.citta_residenza?.toLowerCase().includes(q) ||
        u.telefono?.includes(q)
      ))
    : tutti
  return [...base].sort((a, b) => {
    if (ordine === 'nome') {
      const va = nomeVisibile(a).toLowerCase(), vb = nomeVisibile(b).toLowerCase()
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    if (ordine === 'email') {
      const va = (a.email || '').toLowerCase(), vb = (b.email || '').toLowerCase()
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    const va = ordine === 'balance' ? (a.balance || 0) : new Date(a[ordine] || 0).getTime()
    const vb = ordine === 'balance' ? (b.balance || 0) : new Date(b[ordine] || 0).getTime()
    return dir === 'asc' ? va - vb : vb - va
  })
}

// --- API della tab ---------------------------------------------------------

export async function caricaPagina(opts: {
  pagina: number
  perPagina: number
  cerca: string
  ordine: OrdineIscritti
  dir: 'asc' | 'desc'
}): Promise<PaginaIscritti> {
  const offset = Math.max(0, (opts.pagina - 1) * opts.perPagina)
  const { data, error } = await supabase.rpc('iscritti_sito_elenco', {
    p_cerca: opts.cerca || '',
    p_ordine: opts.ordine,
    p_dir: opts.dir,
    p_offset: offset,
    p_limite: opts.perPagina,
  })
  if (!error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any
    return {
      righe: (d?.righe || []) as IscrittoSito[],
      totale: Number(d?.totale) || 0,
      lento: false,
    }
  }
  if (!funzioneMancante(error)) throw error

  const tutti = await tuttiGliIscritti()
  const filtrati = filtraOrdinaLento(tutti, opts.cerca, opts.ordine, opts.dir)
  return {
    righe: filtrati.slice(offset, offset + opts.perPagina),
    totale: filtrati.length,
    lento: true,
  }
}

export async function caricaStatistiche(): Promise<StatisticheIscritti> {
  const { data, error } = await supabase.rpc('iscritti_sito_statistiche')
  if (!error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (data || {}) as any
    return {
      totale: Number(d.totale) || 0,
      verificati: Number(d.verificati) || 0,
      non_verificati: Number(d.non_verificati) || 0,
      nuovi_mese: Number(d.nuovi_mese) || 0,
      credito_totale: Number(d.credito_totale) || 0,
      senza_bonus: Number(d.senza_bonus) || 0,
      senza_bonus_a_zero: Number(d.senza_bonus_a_zero) || 0,
      schede_incomplete: Number(d.schede_incomplete) || 0,
      da_recuperare: Number(d.da_recuperare) || 0,
      senza_scheda: Number(d.senza_scheda) || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      andamento: (d.andamento || []).map((r: any) => ({ giorno: String(r.giorno), quanti: Number(r.quanti) || 0 })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      top_credito: (d.top_credito || []).map((r: any) => ({
        id: String(r.id), nome: String(r.nome || ''), email: String(r.email || ''), balance: Number(r.balance) || 0,
      })),
      lento: false,
    }
  }
  if (!funzioneMancante(error)) throw error

  // Via lenta: gli stessi numeri, contati sulle righe scaricate.
  const tutti = await tuttiGliIscritti()
  const oggi = new Date()
  const inizioMese = new Date(oggi.getFullYear(), oggi.getMonth(), 1)
  const giorno = 86400000
  const zero = new Date(); zero.setHours(0, 0, 0, 0)
  const conteggi = new Map<string, number>()
  for (const u of tutti) {
    const k = new Date(u.created_at).toISOString().slice(0, 10)
    conteggi.set(k, (conteggi.get(k) || 0) + 1)
  }
  const andamento: Array<{ giorno: string; quanti: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(zero.getTime() - i * giorno)
    const k = d.toISOString().slice(0, 10)
    andamento.push({ giorno: k, quanti: conteggi.get(k) || 0 })
  }
  const verificati = tutti.filter(u => u.email_confirmed_at).length
  return {
    totale: tutti.length,
    verificati,
    non_verificati: tutti.length - verificati,
    nuovi_mese: tutti.filter(u => new Date(u.created_at) >= inizioMese).length,
    credito_totale: tutti.reduce((s, u) => s + (u.balance || 0), 0),
    senza_bonus: tutti.filter(u => !u.bonus_benvenuto).length,
    senza_bonus_a_zero: tutti.filter(u => !u.bonus_benvenuto && (u.balance || 0) === 0).length,
    schede_incomplete: tutti.filter(u => !u.codice_fiscale && !u.partita_iva && !u.codice_univoco).length,
    da_recuperare: tutti.filter(u => u.da_recuperare).length,
    senza_scheda: tutti.filter(u => !u.ha_scheda).length,
    andamento,
    top_credito: [...tutti]
      .filter(u => (u.balance || 0) > 0)
      .sort((a, b) => (b.balance || 0) - (a.balance || 0))
      .slice(0, 5)
      .map(u => ({ id: u.id, nome: nomeVisibile(u) || u.email, email: u.email, balance: u.balance || 0 })),
    lento: true,
  }
}

/** Gli id di un'azione di massa: li sceglie il database, non la pagina a video. */
export async function caricaIds(scope: 'bonus_a_zero' | 'da_recuperare'): Promise<string[]> {
  const { data, error } = await supabase.rpc('iscritti_sito_ids', { p_scope: scope })
  if (!error) return (data || []) as string[]
  if (!funzioneMancante(error)) throw error

  const tutti = await tuttiGliIscritti()
  return scope === 'bonus_a_zero'
    ? tutti.filter(u => !u.bonus_benvenuto && (u.balance || 0) === 0).map(u => u.id)
    : tutti.filter(u => u.da_recuperare).map(u => u.id)
}
