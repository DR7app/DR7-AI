/**
 * URL di ritorno dei pagamenti Nexi.
 *
 * 2026-08-27 — Bug: dopo aver pagato un link di pre-autorizzazione cauzione
 * il cliente veniva rimandato su `${process.env.URL}/admin`, cioe' sul
 * GESTIONALE (platform.dr7ai.com), che senza sessione admin lo scaricava
 * sulla pagina di login.
 *
 * Regola: `process.env.URL` e' il dominio Netlify di QUESTO repo (l'admin) e
 * va usato solo per il `notificationUrl`, che e' una chiamata server-to-server
 * verso le nostre funzioni. Le pagine di esito viste dal CLIENTE stanno sul
 * sito pubblico dr7.app.
 */

/** Sito pubblico: dove atterra il cliente dopo il pagamento. */
export const publicSiteUrl = (): string =>
    process.env.PUBLIC_SITE_URL || 'https://dr7.app'

/** Dominio del gestionale: solo per notificationUrl e ritorni admin. */
export const adminBaseUrl = (): string =>
    process.env.URL || 'https://platform.dr7ai.com'

/** Pagina di esito positivo sul sito. `tipo=cauzione` fa mostrare il testo
 *  della pre-autorizzazione (importo bloccato, non addebitato). */
export const successUrl = (orderId: string, tipo?: 'cauzione'): string =>
    `${publicSiteUrl()}/payment-success?orderId=${encodeURIComponent(orderId)}${tipo ? `&tipo=${tipo}` : ''}`

/** Pagina di annullamento sul sito. La rotta e' `/payment-cancel`. */
export const cancelUrl = (orderId: string, tipo?: 'cauzione'): string =>
    `${publicSiteUrl()}/payment-cancel?orderId=${encodeURIComponent(orderId)}${tipo ? `&tipo=${tipo}` : ''}`
