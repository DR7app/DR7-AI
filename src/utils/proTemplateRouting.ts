/**
 * Routing condiviso server + client: ogni "evento di codice" (es.
 * conferma prenotazione, callback pagamento, firma contratto) viene
 * inoltrato a uno specifico template Pro presente in
 * `system_messages`. Questa mappa è la SINGLE SOURCE OF TRUTH:
 *
 *   - `netlify/functions/utils/messageTemplates.ts` la importa per
 *     decidere quale riga DB usare quando rendiamo un template.
 *   - `MessaggiSistemaProTab.tsx` la importa per mostrare nella UI
 *     "QUANDO parte davvero ogni template", anche quando il template
 *     ha is_automatic=false (perché il cron non lo gestisce ma un
 *     callback di codice sì).
 *
 * NON aggiungere mappe duplicate altrove. Se aggiungi un nuovo evento
 * o cambi la destinazione, modifica solo questo file.
 */

export const OLD_TO_PRO: Record<string, string> = {
  // Noleggio — customer + admin get the same template
  rental_new_customer: 'pro_conferma_noleggio',
  rental_new: 'pro_conferma_noleggio',
  rental_new_admin: 'pro_conferma_noleggio',
  rental_modified: 'pro_promemoria_appuntamento',
  deposit_return_iban: 'pro_richiesta_iban',

  // Lavaggio — customer + admin get the same template
  carwash_new_customer: 'pro_conferma_lavaggio',
  carwash_new: 'pro_conferma_lavaggio',
  carwash_new_admin: 'pro_conferma_lavaggio',
  carwash_modified: 'pro_promemoria_pagamento',

  // Meccanica (Prime Wash umbrella)
  mechanical_new_customer: 'pro_conferma_meccanica',
  mechanical_new: 'pro_conferma_meccanica',
  mechanical_new_admin: 'pro_conferma_meccanica',
  mechanical_modified: 'pro_promemoria_pagamento',

  // Firma & Contratto
  signature_request_link: 'pro_richiesta_firma',
  signature_reminder_whatsapp: 'pro_promemoria_firma',
  signature_otp_whatsapp: 'pro_richiesta_otp',
  document_signature_link: 'pro_richiesta_firma',

  // Pagamenti & annullamenti
  payment_link_customer: 'pro_richiesta_pagamento',
  rental_da_saldare_customer: 'pro_richiesta_pagamento',
  booking_cancelled_whatsapp: 'pro_custom_prenotazione_annullata_da_sito_1776503923221',

  // Pagamento ricevuto
  payment_received_extension: 'pro_conferma_da_saldare',
  payment_received_extension_admin: 'pro_conferma_da_saldare',
  payment_received_damages: 'pro_conferma_da_saldare',
  payment_received_damages_admin: 'pro_conferma_da_saldare',

  // Conferma "Da Saldare" — admin spunta Conferma Prenotazione mentre
  // payment_status resta pending. NON e' una conferma di pagamento, e' una
  // conferma che la prenotazione e' bloccata pur restando da saldare.
  booking_confirmed_da_saldare: 'pro_conferma_da_saldare',

  // Preventivi admin alert
  admin_new_website_quote: 'pro_richiesta_otp',
  admin_no_cauzione_request: 'pro_richiesta_otp',

  // Marketing & Wallet
  review_request_whatsapp: 'pro_marketing_recensione',
  birthday_message: 'pro_marketing_compleanno',
  wallet_bonus_credit: 'pro_wallet_bonus_cliente',
  review_discount_code: 'pro_marketing_codice_sconto',
  promo_incassi_whatsapp: 'pro_promo_incassi',
  maxi_promo_gap_whatsapp: 'pro_maxi_promo_gap_1gg',

  // Cauzione
  deposit_request_customer: 'pro_richiesta_cauzione',

  // No Cauzione / Sconti preventivi
  no_cauzione_approved: 'pro_no_cauzione_approvato',
  no_cauzione_rejected: 'pro_no_cauzione_rifiutato',
  quote_discount_offered: 'pro_sconto_concesso',

  // Fidelity Card — voucher fired at 250 punti
  fidelity_voucher_whatsapp: 'pro_fidelity_voucher',

  // Website customer actions
  website_booking_cancelled_customer: 'pro_custom_prenotazione_annullata_da_sito_1776503923221',
}

/**
 * Descrizione in italiano per ogni legacy key — l'evento che fa
 * partire la chiamata `renderTemplate(<legacy_key>, ...)` nel codice.
 * Usata dalla UI per spiegare all'admin "quando parte davvero questo
 * template".
 */
export const EVENT_DESCRIPTIONS: Record<string, string> = {
  // Noleggio
  rental_new_customer: 'Alla creazione della prenotazione noleggio (al cliente)',
  rental_new: 'Alla creazione della prenotazione noleggio',
  rental_new_admin: 'Alla creazione della prenotazione noleggio (admin)',
  rental_modified: 'Alla modifica della prenotazione noleggio',
  deposit_return_iban: 'Quando si chiede l\'IBAN per il rimborso cauzione',

  // Lavaggio
  carwash_new_customer: 'Alla creazione della prenotazione lavaggio (al cliente)',
  carwash_new: 'Alla creazione della prenotazione lavaggio',
  carwash_new_admin: 'Alla creazione della prenotazione lavaggio (admin)',
  carwash_modified: 'Alla modifica della prenotazione lavaggio',

  // Meccanica
  mechanical_new_customer: 'Alla creazione della prenotazione meccanica (al cliente)',
  mechanical_new: 'Alla creazione della prenotazione meccanica',
  mechanical_new_admin: 'Alla creazione della prenotazione meccanica (admin)',
  mechanical_modified: 'Alla modifica della prenotazione meccanica',

  // Firma & Contratto
  signature_request_link: 'Quando si invia il link di firma del contratto',
  signature_reminder_whatsapp: 'Promemoria firma contratto in scadenza',
  signature_otp_whatsapp: 'Quando si invia l\'OTP per firmare il contratto',
  document_signature_link: 'Quando si invia un link di firma documento',

  // Pagamenti
  payment_link_customer: 'Quando si invia il link di pagamento al cliente',
  rental_da_saldare_customer: 'Promemoria noleggio da saldare',
  booking_cancelled_whatsapp: 'Annullamento prenotazione (cron pagamento non riuscito o richiesta admin)',
  payment_received_extension: 'Conferma pagamento estensione (al cliente)',
  payment_received_extension_admin: 'Conferma pagamento estensione (admin)',
  payment_received_damages: 'Conferma pagamento danni/penali (al cliente)',
  payment_received_damages_admin: 'Conferma pagamento danni/penali (admin)',
  booking_confirmed_da_saldare: 'Prenotazione confermata ma ancora Da Saldare (admin spunta Conferma Prenotazione su booking pending)',

  // Preventivi admin
  admin_new_website_quote: 'Alert admin: nuovo preventivo dal sito',
  admin_no_cauzione_request: 'Alert admin: richiesta "No Cauzione" da un cliente Fascia B',

  // Marketing & Wallet
  review_request_whatsapp: 'Richiesta recensione (cron review-send)',
  birthday_message: 'Compleanno del cliente (cron giornaliero)',
  wallet_bonus_credit: 'Cashback wallet dopo pagamento carta (callback Nexi)',

  // Fidelity
  fidelity_voucher_whatsapp: 'Voucher fidelity raggiunti i 250 punti',

  // Marketing aggiuntivo
  review_discount_code: 'Invio codice sconto post-recensione (Review Management)',
  promo_incassi_whatsapp: 'Promo incassi: invio WhatsApp al cliente quando un veicolo è sotto soglia (cron mensile)',
  maxi_promo_gap_whatsapp: 'Maxi Promo Gap: invio quando un veicolo ha 1 giorno libero tra prenotazioni (cron giornaliero)',

  // Cauzione
  deposit_request_customer: 'Invio link pagamento cauzione al cliente (admin Cauzioni)',

  // No Cauzione / Sconti preventivi
  no_cauzione_approved: 'Approvazione "No Cauzione": invio link pagamento al cliente',
  no_cauzione_rejected: 'Rifiuto "No Cauzione": invio codice sconto 5% al cliente',
  quote_discount_offered: 'Preventivo rifiutato con sconto: invio codice sconto al cliente',

  // Website
  website_booking_cancelled_customer: 'Annullamento prenotazione effettuato dal cliente sul sito',
}

/**
 * Fallback label matchers: ogni voce mappa un pro_key alle liste di
 * AND-group da cercare nella label di un template enabled+non-vuoto.
 * Il resolver server (messageTemplates.resolveKeyForContext) usa questi
 * pattern quando il pro_key canonico è vuoto/disabilitato, così l'admin
 * può tenere un template "Conferma Noleggio" custom (con message_key
 * `pro_custom_*_<ts>`) e il codice lo trova comunque per label.
 *
 * Il client (MessaggiSistemaProTab) usa la stessa mappa al contrario:
 * dato un template (label + message_key) capisce a quali eventi di
 * codice il template risponderà davvero.
 *
 * AND-group: tutti i frammenti devono essere presenti (case-insensitive)
 * nella label. L'ordine delle entries conta — i pattern più specifici
 * stanno prima dei più generici per evitare match indesiderati.
 */
export const LABEL_FALLBACKS: Record<string, string[][]> = {
  // ── Conferma — eventi di creazione prenotazione (BUG FIX: prima
  // mancavano completamente, quindi `renderTemplate('rental_new_customer')`
  // tornava null se l'admin aveva messo il body in un custom invece
  // che nel canonico pro_conferma_noleggio → invio saltato in silenzio.
  pro_conferma_noleggio: [
    ['conferma', 'noleggio'],
    ['nuova', 'prenotazione', 'noleggio'],
    ['nuova', 'prenotazione', 'rental'],
    ['conferma', 'rental'],
    ['conferma', 'prenotazione'],
  ],
  pro_conferma_lavaggio: [
    ['conferma', 'lavaggio'],
    ['nuova', 'prenotazione', 'lavaggio'],
    ['conferma', 'wash'],
    ['conferma', 'prime', 'wash'],
  ],
  pro_conferma_meccanica: [
    ['conferma', 'meccanica'],
    ['nuova', 'prenotazione', 'meccanica'],
    ['conferma', 'mechanical'],
  ],
  pro_conferma_da_saldare: [
    ['conferma', 'pagamento'],
    ['pagamento', 'ricevuto'],
    ['pagamento', 'confermato'],
    ['payment', 'received'],
    ['payment', 'confirmed'],
    ['saldare', 'conferm'],
    ['conferm', 'saldare'],
    ['prenotazione', 'saldare', 'conferm'],
  ],
  pro_conferma_contratto_firmato: [
    ['conferma', 'contratto', 'firmat'],
    ['contratto', 'firmat'],
  ],

  // ── Firma & OTP ─────────────────────────────────────────────────
  pro_richiesta_firma: [
    ['link', 'firma', 'contratto'],
    ['link', 'firma'],
    ['richiesta', 'firma'],
    ['firma', 'contratto'],
    ['signature', 'request'],
    ['signing', 'link'],
  ],
  pro_promemoria_firma: [
    ['promemoria', 'firma'],
    ['reminder', 'sign'],
    ['ricordo', 'firma'],
  ],
  pro_richiesta_otp: [
    ['otp', 'firma'],
    ['codice', 'otp'],
    ['otp', 'contratto'],
    ['richiesta', 'otp'],
  ],
  pro_richiesta_iban: [
    ['richiesta', 'iban'],
    ['iban', 'rimborso'],
    ['rimborso', 'iban'],
    ['iban'],
  ],
  pro_richiesta_cauzione: [
    ['richiesta', 'cauzione'],
    ['link', 'cauzione'],
    ['pagamento', 'cauzione'],
    ['cauzione', 'pagamento'],
    ['deposit', 'request'],
  ],
  pro_no_cauzione_approvato: [
    ['no', 'cauzione', 'approv'],
    ['approv', 'no', 'cauzione'],
    ['senza', 'cauzione', 'approv'],
    ['no', 'cauzione', 'ok'],
  ],
  pro_no_cauzione_rifiutato: [
    ['no', 'cauzione', 'rifiut'],
    ['rifiut', 'no', 'cauzione'],
    ['senza', 'cauzione', 'rifiut'],
    ['no', 'cauzione', 'ko'],
  ],
  pro_sconto_concesso: [
    ['sconto', 'concesso'],
    ['concesso', 'sconto'],
    ['preventivo', 'sconto'],
    ['sconto', 'preventivo'],
  ],

  // ── Pagamenti / Pay-by-link (già presenti nel server, ricopiate qui) ─
  pro_richiesta_pagamento: [
    ['link pagamento'],
    ['richiesta pagamento'],
    ['invio link pagamento'],
    ['pay by link'],
    ['payment link'],
  ],
  pro_modifica_noleggio: [
    ['modifica', 'noleggio'],
    ['modifica', 'prenotazione'],
    ['modifica', 'rental'],
    ['modifica', 'rent'],
  ],
  pro_modifica_lavaggio: [
    ['modifica', 'lavaggio'],
    ['modifica', 'prime wash'],
    ['modifica', 'primewash'],
    ['modifica', 'wash'],
  ],
  // I fallback generici (['link pagamento'], ['pay by link']) sono stati
  // RIMOSSI: matchavano qualunque template di pagamento e facevano arrivare
  // al cliente il messaggio sbagliato (generico Pay-by-Link) invece del
  // testo specifico danni/penali. Ora se il template specifico non esiste
  // l'invio viene saltato e l'admin vede un toast di errore.
  pro_richiesta_penali: [
    ['link', 'pagamento', 'penal'],
    ['penal'],
  ],
  pro_richiesta_danni: [
    ['link', 'pagamento', 'dann'],
    ['dann'],
  ],
  pro_richiesta_danni_penali: [
    ['link', 'pagamento', 'dann', 'penal'],
    ['link', 'pagamento', 'penal'],
    ['link', 'pagamento', 'dann'],
    ['dann'],
    ['penal'],
  ],
  pro_richiesta_addebito: [
    ['link', 'pagamento', 'addebit'],
    ['addebit'],
    ['link pagamento'],
  ],
  pro_richiesta_estensione: [
    ['link', 'pagamento', 'estension'],
    ['estension'],
    ['link pagamento'],
  ],

  // ── Marketing & Wallet & Fidelity ──────────────────────────────
  pro_marketing_recensione: [
    ['richiesta', 'recensione'],
    ['review', 'request'],
    ['recensione'],
  ],
  pro_marketing_codice_sconto: [
    ['codice', 'sconto', 'recensione'],
    ['codice', 'recensione'],
    ['sconto', 'recensione'],
    ['codice', 'sconto'],
    ['discount', 'review'],
  ],
  pro_marketing_compleanno: [
    ['compleanno'],
    ['birthday'],
    ['auguri', 'cliente'],
  ],
  pro_wallet_bonus_cliente: [
    ['bonus', 'wallet'],
    ['wallet', 'bonus'],
    ['cashback'],
    ['accredito', 'wallet'],
    ['bonus', 'carta'],
  ],
  pro_fidelity_voucher: [
    ['fidelity', 'voucher'],
    ['fidelity'],
    ['fedeltà'],
    ['buono', 'fidelity'],
    ['250', 'punti'],
    ['buono', 'prime', 'wash'],
  ],
  pro_maxi_promo_gap_1gg: [
    ['maxi', 'promo', 'gap', '1gg'],
    ['maxi', 'promo', 'gap'],
    ['maxi', 'promo'],
    ['gap', '1gg'],
    ['gap', '1', 'giorno'],
    ['promo', 'gap'],
  ],
  pro_promo_incassi: [
    ['promo', 'incassi'],
    ['promo', 'incasso'],
    ['incassi', 'promo'],
  ],
}

/** Verifica se la label del template fa match con uno dei pattern di
    LABEL_FALLBACKS per il pro_key dato. Match case-insensitive. */
function labelMatchesProKey(label: string | null | undefined, proKey: string): boolean {
  if (!label) return false
  const groups = LABEL_FALLBACKS[proKey]
  if (!groups) return false
  const lbl = label.toLowerCase()
  return groups.some(group => group.every(frag => lbl.includes(frag.toLowerCase())))
}

/** Tokenizza una stringa in parole "significative" (≥3 char,
    lowercased, deaccented). Usata per word-overlap match. */
function tokenize(s: string): string[] {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
}

const STOPWORDS = new Set([
  'alla', 'allo', 'agli', 'alle', 'del', 'dello', 'dei', 'delle', 'della',
  'sul', 'sulla', 'sui', 'sulle', 'sullo', 'nel', 'nella', 'nei', 'negli',
  'per', 'con', 'tra', 'fra', 'che', 'cui', 'una', 'uno', 'gli', 'lui',
  'lei', 'voi', 'noi', 'ecco', 'questo', 'questa', 'quello', 'quella',
  'tutto', 'tutta', 'tutti', 'tutte', 'come', 'quando', 'dove', 'perche',
  'cosa', 'molto', 'poco', 'piu', 'meno', 'sopra', 'sotto', 'dopo',
  'prima', 'durante', 'mentre', 'inoltre', 'invece', 'comunque', 'sempre',
  'quasi', 'subito', 'ancora', 'gia', 'mai', 'solo', 'soltanto', 'anche',
  'oppure', 'oltre', 'sia', 'piu', 'tante', 'tanti', 'tanto', 'tanta',
  // English stopwords for mixed-language labels
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
])

/**
 * Auto-detect: dato un template (label + opzionalmente body), suggerisce
 * la lista di eventi di codice (legacy keys) che PROBABILMENTE dovrebbe
 * gestire. Logica: word-overlap tra le parole della label/body del
 * template e le descrizioni italiane degli eventi in EVENT_DESCRIPTIONS.
 *
 * Esempio: template label "Conferma Noleggio" → tokens {conferma, noleggio}.
 * Evento 'rental_new_customer' descrizione "Alla creazione della
 * prenotazione noleggio (al cliente)" → tokens {creazione, prenotazione,
 * noleggio, cliente}. Overlap = {noleggio} → match → suggerito.
 *
 * Nessuna mappa di pattern hardcoded — usa solo le descrizioni in italiano
 * già presenti in EVENT_DESCRIPTIONS, così aggiungere un nuovo evento
 * (con la sua descrizione) è automaticamente coperto.
 */
export function suggestEventsForTemplate(
  template: { message_key?: string | null; label?: string | null; message_body?: string | null },
): string[] {
  const tplTokens = new Set(
    [
      ...tokenize(template.label || ''),
      ...tokenize((template.message_body || '').slice(0, 500)),
    ].filter(w => !STOPWORDS.has(w))
  )
  if (tplTokens.size === 0) return []

  const scored: Array<{ eventKey: string; score: number }> = []
  for (const [eventKey, desc] of Object.entries(EVENT_DESCRIPTIONS)) {
    const descTokens = tokenize(desc).filter(w => !STOPWORDS.has(w))
    if (descTokens.length === 0) continue
    let overlap = 0
    for (const w of descTokens) if (tplTokens.has(w)) overlap++
    if (overlap >= 1) {
      // Score = % di parole della descrizione presenti nel template.
      // Eventi con descrizioni corte e match alto vincono.
      const score = overlap / descTokens.length
      scored.push({ eventKey, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  // Manteniamo solo i top match con score >= 0.25 per evitare suggerimenti
  // troppo larghi (es. una sola parola comune come "prenotazione").
  return scored.filter(s => s.score >= 0.25).slice(0, 6).map(s => s.eventKey)
}

/**
 * Per un dato template (message_key + label), restituisce la lista di
 * descrizioni italiane di TUTTI gli eventi di codice che lo fanno
 * partire. Usa DUE meccanismi:
 *
 *   1. Match diretto su message_key in OLD_TO_PRO (template con la
 *      chiave canonica pro_*).
 *   2. Match per label via LABEL_FALLBACKS — necessario per i template
 *      custom (message_key `pro_custom_*`) la cui label corrisponde a
 *      uno slot canonico. Esempio: un template `pro_custom_conferma_noleggio_<ts>`
 *      con label "Conferma Noleggio" risponde agli eventi di
 *      pro_conferma_noleggio se quest'ultimo è vuoto/disabilitato.
 *
 * Vuota se il template è davvero solo manuale o gestito solo dal cron.
 */
export function getProKeyEventTriggers(
  messageKey: string | null | undefined,
  label?: string | null,
): string[] {
  const matches: string[] = []

  // 1. Match diretto su message_key (canonico)
  if (messageKey) {
    for (const [legacy, pro] of Object.entries(OLD_TO_PRO)) {
      if (pro !== messageKey) continue
      const desc = EVENT_DESCRIPTIONS[legacy]
      if (desc && !matches.includes(desc)) matches.push(desc)
    }
  }

  // 2. Match per label (template custom che agiscono come uno slot canonico)
  if (label) {
    for (const proKey of Object.keys(LABEL_FALLBACKS)) {
      if (proKey === messageKey) continue // già coperto dal match diretto
      if (!labelMatchesProKey(label, proKey)) continue
      for (const [legacy, pro] of Object.entries(OLD_TO_PRO)) {
        if (pro !== proKey) continue
        const desc = EVENT_DESCRIPTIONS[legacy]
        if (desc && !matches.includes(desc)) matches.push(desc)
      }
    }
  }

  return matches
}
