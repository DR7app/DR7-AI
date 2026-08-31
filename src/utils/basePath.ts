// Dove vive il gestionale.
//
// La stessa base di codice serve due modi di stare in rete:
//   · un sito tutto suo            -> platform.dr7ai.com/...
//   · un indirizzo dentro dr7ai.com -> dr7ai.com/NOMEAZIENDA/...
//
// Nel secondo caso il pacchetto viene compilato con VITE_BASE_PATH e ogni
// indirizzo assoluto deve portare quel prefisso, altrimenti la pagina cerca i
// suoi file e le sue funzioni nella radice di dr7ai.com e non trova niente.
//
// import.meta.env.BASE_URL vale '/' quando non c'e' prefisso: in quel caso
// tutto quello che c'e' qui sotto non fa nulla.

/** '/' oppure '/NOMEAZIENDA/'. Sempre con la barra finale. */
export const BASE: string = (import.meta.env.BASE_URL || '/')

/** Senza barra finale: '' oppure '/NOMEAZIENDA'. */
export const PREFISSO: string = BASE === '/' ? '' : BASE.replace(/\/$/, '')

/** Il gestionale sta sotto un prefisso? */
export const SOTTO_PREFISSO: boolean = PREFISSO !== ''

/** Indirizzo di un file pubblico: risorsa('dr7-logo.png'). */
export function risorsa(percorso: string): string {
  return BASE + percorso.replace(/^\//, '')
}

/**
 * Aggiunge il prefisso alle chiamate alle funzioni.
 *
 * Nel codice restano scritte come sono sempre state
 * ('/.netlify/functions/...'): sono oltre quattrocento in un centinaio di
 * file, riscriverle una per una sarebbe stato un invito all'errore. Si
 * corregge qui, in un punto solo, appena prima che la richiesta parta.
 */
export function installaPrefissoChiamate(): void {
  if (!SOTTO_PREFISSO) return
  if ((window as unknown as { __dr7PrefissoInstallato?: boolean }).__dr7PrefissoInstallato) return
  ;(window as unknown as { __dr7PrefissoInstallato?: boolean }).__dr7PrefissoInstallato = true

  const originale = window.fetch.bind(window)

  const conPrefisso = (u: string): string =>
    u.startsWith('/.netlify/') ? PREFISSO + u : u

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === 'string') {
      return originale(conPrefisso(input), init)
    }
    if (input instanceof Request && input.url) {
      // Un Request porta con se' un indirizzo gia' assoluto: si guarda solo
      // il percorso, e si ricostruisce solo se serve davvero.
      try {
        const u = new URL(input.url)
        if (u.origin === window.location.origin && u.pathname.startsWith('/.netlify/')) {
          return originale(new Request(u.origin + PREFISSO + u.pathname + u.search, input), init)
        }
      } catch { /* indirizzo non interpretabile: si lascia com'e' */ }
    }
    return originale(input as RequestInfo, init)
  }
}
