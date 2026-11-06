/**
 * Soglie EMTN da Centralina Pro > EMTN (07/11/2026).
 *
 * Stanno in `centralina_pro_config` (riga 'main', globale) alla chiave `emtn`:
 *   soglia_allarme  — EMTN Score sotto il quale un noleggio del cliente apre
 *                     l'allarme cli_emtn_sotto_soglia;
 *   soglia_blocco   — EMTN Score sotto il quale il cliente non puo' prenotare
 *                     un noleggio dal sito (registrazione e documenti restano);
 *   messaggio_blocco — testo mostrato al cliente fermato (facoltativo).
 *
 * Una soglia vuota, a zero, fuori da 1-100 o non numerica e' SPENTA: di
 * default sono spente e nulla cambia. `normalizzaSoglieEmtn` e' la gemella di
 * dr7_emtn_soglia_valida / dr7_emtn_soglie in SQL (migrazione
 * 20261107_emtn_soglie.sql): quello che si vede e' quello che il database
 * applica. Cambiare in entrambi.
 */

export const EMTN_SOGLIE_KEY = 'emtn'

export const MESSAGGIO_BLOCCO_DEFAULT =
  "Non e' possibile completare la prenotazione online. Contatta DR7 e ti aiuteremo a completare il noleggio."

export interface SoglieEmtn {
  soglia_allarme: number | null
  soglia_blocco: number | null
  messaggio_blocco: string | null
}

export const SOGLIE_EMTN_SPENTE: SoglieEmtn = { soglia_allarme: null, soglia_blocco: null, messaggio_blocco: null }

/** 1-100 intero, altrimenti null (spenta). */
export function sogliaEmtnValida(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const t = String(v).trim()
  if (!/^[0-9]{1,3}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 100 ? n : null
}

export function normalizzaSoglieEmtn(raw: unknown): SoglieEmtn {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...SOGLIE_EMTN_SPENTE }
  const v = raw as Record<string, unknown>
  const msg = typeof v.messaggio_blocco === 'string' ? v.messaggio_blocco.trim() : ''
  return {
    soglia_allarme: sogliaEmtnValida(v.soglia_allarme),
    soglia_blocco: sogliaEmtnValida(v.soglia_blocco),
    messaggio_blocco: msg || null,
  }
}

/** Sotto la soglia = strettamente minore (score 20 con soglia 20 non scatta). */
export function sottoSoglia(score: number | null | undefined, soglia: number | null): boolean {
  return soglia != null && typeof score === 'number' && Number.isFinite(score) && score < soglia
}
