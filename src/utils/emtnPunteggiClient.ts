/**
 * Punteggi EMTN per i badge della lista prenotazioni (07/11/2026).
 *
 * Ogni badge chiede il punteggio del suo cliente; le richieste dello stesso
 * istante si raccolgono in UNA chiamata a emtn-score-clienti (che legge
 * emtn_score_clienti e ricalcola con il motore EMTN quelli mancanti o
 * vecchi). Il risultato resta in memoria per la sessione della pagina
 * (MEMORIA_MS): cambiare pagina della lista non richiama il server.
 * Nessun calcolo qui: il numero e' sempre quello di EMTN.
 */
import { authFetch } from './authFetch'

export interface PunteggioEmtn {
  score: number
  band: 'green' | 'yellow' | 'red'
  livello: string
  calcolato_il: string
}

/** undefined = in caricamento; null = nessun punteggio (senza codice fiscale). */
type Valore = PunteggioEmtn | null

const MEMORIA_MS = 10 * 60_000
const RIPROVA_MS = 8_000
const MAX_TENTATIVI = 4
const PER_CHIAMATA = 150

const memoria = new Map<string, { valore: Valore; il: number }>()
const ascoltatori = new Map<string, Set<(v: Valore) => void>>()
const inAttesa = new Set<string>()
const tentativi = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | null = null

function notifica(id: string, valore: Valore) {
  memoria.set(id, { valore, il: Date.now() })
  for (const f of ascoltatori.get(id) || []) f(valore)
}

async function scarica() {
  timer = null
  const ids = [...inAttesa].slice(0, PER_CHIAMATA)
  for (const id of ids) inAttesa.delete(id)
  if (inAttesa.size > 0) pianifica(0)
  if (ids.length === 0) return
  try {
    const res = await authFetch('/.netlify/functions/emtn-score-clienti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body) throw new Error(body?.error || `HTTP ${res.status}`)
    const punteggi = (body.punteggi || {}) as Record<string, Valore>
    const inCorso = new Set<string>(Array.isArray(body.inCorso) ? body.inCorso : [])
    for (const id of ids) {
      if (inCorso.has(id)) { riprova(id); continue }
      notifica(id, punteggi[id] ?? null)
    }
  } catch (e) {
    console.warn('[EMTN] punteggi non disponibili:', e)
    for (const id of ids) riprova(id)
  }
}

function riprova(id: string) {
  const n = (tentativi.get(id) || 0) + 1
  tentativi.set(id, n)
  if (n >= MAX_TENTATIVI) { notifica(id, null); return }
  setTimeout(() => { inAttesa.add(id); pianifica(0) }, RIPROVA_MS * n)
}

function pianifica(ms: number) {
  if (!timer) timer = setTimeout(() => { void scarica() }, ms)
}

/**
 * Si iscrive al punteggio di un cliente (id scheda o account). Ritorna il
 * valore gia' in memoria (o undefined) e la funzione per disiscriversi.
 */
export function osservaPunteggioEmtn(id: string, cb: (v: Valore) => void): { attuale: Valore | undefined; stop: () => void } {
  const set = ascoltatori.get(id) || new Set()
  set.add(cb)
  ascoltatori.set(id, set)
  const m = memoria.get(id)
  const fresco = m && Date.now() - m.il < MEMORIA_MS
  if (!fresco) {
    tentativi.delete(id)
    inAttesa.add(id)
    // Un attimo di attesa: i badge della stessa pagina partono insieme.
    pianifica(50)
  }
  return {
    attuale: m?.valore,
    stop: () => { set.delete(cb) },
  }
}
