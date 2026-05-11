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
  payment_received_extension: 'pro_conferma_pagamento',
  payment_received_extension_admin: 'pro_conferma_pagamento',
  payment_received_damages: 'pro_conferma_pagamento',
  payment_received_damages_admin: 'pro_conferma_pagamento',

  // Preventivi admin alert
  admin_new_website_quote: 'pro_richiesta_otp',
  admin_no_cauzione_request: 'pro_richiesta_otp',

  // Marketing & Wallet
  review_request_whatsapp: 'pro_marketing_recensione',
  birthday_message: 'pro_marketing_compleanno',
  wallet_bonus_credit: 'pro_wallet_bonus_cliente',

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

  // Preventivi admin
  admin_new_website_quote: 'Alert admin: nuovo preventivo dal sito',
  admin_no_cauzione_request: 'Alert admin: richiesta "No Cauzione" da un cliente Fascia B',

  // Marketing & Wallet
  review_request_whatsapp: 'Richiesta recensione (cron review-send)',
  birthday_message: 'Compleanno del cliente (cron giornaliero)',
  wallet_bonus_credit: 'Cashback wallet dopo pagamento carta (callback Nexi)',

  // Fidelity
  fidelity_voucher_whatsapp: 'Voucher fidelity raggiunti i 250 punti',

  // Website
  website_booking_cancelled_customer: 'Annullamento prenotazione effettuato dal cliente sul sito',
}

/**
 * Per un dato `pro_key`, restituisce la lista di descrizioni italiane
 * di TUTTI gli eventi di codice che lo fanno partire. Vuota se il
 * template è gestito SOLO dal cron `process-scheduled-system-messages-cron`
 * (quindi davvero "manuale o solo cron") oppure è un template custom
 * usato solo manualmente dall'admin.
 */
export function getProKeyEventTriggers(proKey: string | null | undefined): string[] {
  if (!proKey) return []
  const matches: string[] = []
  for (const [legacy, pro] of Object.entries(OLD_TO_PRO)) {
    if (pro !== proKey) continue
    const desc = EVENT_DESCRIPTIONS[legacy]
    if (desc && !matches.includes(desc)) matches.push(desc)
  }
  return matches
}
