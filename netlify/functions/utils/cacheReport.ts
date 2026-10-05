/**
 * Cache CDN breve per le funzioni di lettura dei report (05/10/2026).
 *
 * Dashboard, Prenotazioni e Calendario richiamano gli stessi report a ogni
 * apertura di tab: il calcolo e' identico finche' non cambia il dato, quindi
 * la risposta resta pronta sulla rete Netlify per pochi secondi.
 *
 * FRESCA e' volutamente corta (60 s) e SENZA stale-while-revalidate: dopo il
 * salvataggio di una prenotazione i numeri possono restare indietro al
 * massimo un minuto, mai di piu'. Chi vuole il dato al secondo passa
 * `?refresh=1`: la funzione ricalcola e la risposta non viene messa in cache.
 *
 * `Cache-Control: private, no-store` tiene la copia SOLO sulla CDN: nessun
 * browser e nessun proxy intermedio conserva i dati su disco.
 *
 * `Netlify-Vary: query, header=Authorization` e' OBBLIGATORIO: mette il token
 * nella chiave della cache, una copia per operatore. Una richiesta SENZA
 * token ha una chiave diversa, non trova nulla, la funzione parte davvero e
 * `requireAuth` (dove c'e') la respinge. Senza questa riga la copia salvata
 * da un operatore loggato e' scaricabile da chiunque conosca l'URL
 * (verificato sulla demo il 29/08/2026).
 */

/** Finestra di freschezza, in secondi. */
const FRESCA = 60

export function intestazioniCacheReportPrivata(tag: string): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${FRESCA}`,
    'Netlify-Vary': 'query, header=Authorization',
    'Netlify-Cache-Tag': tag,
  }
}

/** `?refresh=1`: ricalcolo vero, risposta mai messa in cache. */
export function chiedeRicalcolo(params: Record<string, string | undefined> | null | undefined): boolean {
  return params?.refresh === '1'
}

export const INTESTAZIONI_NESSUNA_CACHE: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'Netlify-CDN-Cache-Control': 'no-store',
}
