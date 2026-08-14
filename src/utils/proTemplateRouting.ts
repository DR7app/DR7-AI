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
  // Tour Elicottero/Barca (Noleggio Aria/Mare): conferma prenotazione tour
  tour_new_customer: 'pro_conferma_tour',
  // Auto pronta Noleggio (admin clicca "Auto Pronta" su prenotazione/calendario)
  rental_auto_pronta: 'pro_auto_pronta_noleggio',
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
  // Sollecito pagamento — promemoria al cliente con debito ancora aperto
  // ("Invia Sollecito" in UnpaidBookingsTab + auto-resend ogni 48h dal cron
  // sollecito-pagamento-cron). Il body vive nel template Pro "Promemoria
  // Pagamento" (pro_promemoria_pagamento) editato dall'admin in Messaggi di
  // Sistema Pro.
  sollecito_pagamento: 'pro_sollecito_pagamento',
  // Annullamento DA ADMIN: slot dedicato pro_annullamento_admin, separato
  // da quello del cliente. Cosi' l'admin puo' scrivere un messaggio del tipo
  // "Salve, abbiamo annullato la sua prenotazione..." invece di
  // "Hai annullato la tua prenotazione dal sito" (testo errato quando e'
  // l'operatore a cancellare).
  booking_cancelled_whatsapp: 'pro_annullamento_admin',

  // Pagamento ricevuto
  payment_received_extension: 'pro_conferma_da_saldare',
  payment_received_extension_admin: 'pro_conferma_da_saldare',
  payment_received_damages: 'pro_conferma_da_saldare',
  payment_received_damages_admin: 'pro_conferma_da_saldare',

  // Conferma "Da Saldare" — admin spunta Conferma Prenotazione mentre
  // payment_status resta pending. NON e' una conferma di pagamento, e' una
  // conferma che la prenotazione e' bloccata pur restando da saldare.
  booking_confirmed_da_saldare: 'pro_conferma_da_saldare',

  // Pagamento ricevuto al booking — per metodo di pagamento. Admin sceglie
  // payment_method=Contanti/Bancomat/Bonifico/... + payment_status=paid +
  // Conferma Prenotazione. Eventi separati cosi' l'admin puo' avere un
  // template diverso per ogni metodo ("Pagato Contanti", "Pagato Carta",
  // "Pagato Bonifico", ecc.). Nessun fallback canonico: il send parte
  // SOLO se un template claima l'evento via handled_events.
  booking_paid_cash:          'pro_conferma_da_saldare',
  booking_paid_card:          'pro_conferma_da_saldare',
  booking_paid_bank_transfer: 'pro_conferma_da_saldare',
  booking_paid_paypal:        'pro_conferma_da_saldare',
  booking_paid_wallet:        'pro_conferma_da_saldare',

  // Eventi specifici per LAVAGGIO — evitano che "Conferma Noleggio"
  // (che tipicamente claima i booking_paid_*) intercetti i pagamenti di
  // un car wash e mandi il testo di noleggio al cliente. Canonicamente
  // mappano a pro_conferma_lavaggio cosi' "Conferma Lavaggio" puo'
  // semplicemente claimare questi nuovi eventi nei suoi handled_events.
  carwash_confirmed_da_saldare: 'pro_conferma_lavaggio',
  carwash_paid_cash:            'pro_conferma_lavaggio',
  carwash_paid_card:            'pro_conferma_lavaggio',
  carwash_paid_bank_transfer:   'pro_conferma_lavaggio',
  carwash_paid_paypal:          'pro_conferma_lavaggio',
  carwash_paid_wallet:          'pro_conferma_lavaggio',

  // Eventi specifici per MECCANICA — stessa logica del lavaggio.
  mechanical_confirmed_da_saldare: 'pro_conferma_meccanica',
  mechanical_paid_cash:            'pro_conferma_meccanica',
  mechanical_paid_card:            'pro_conferma_meccanica',
  mechanical_paid_bank_transfer:   'pro_conferma_meccanica',
  mechanical_paid_paypal:          'pro_conferma_meccanica',
  mechanical_paid_wallet:          'pro_conferma_meccanica',

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

  // Website customer actions — cancellation lifecycle now points all to
  // the canonical pro_annullamento_cliente slot (was pinned to a specific
  // pro_custom_* key). LABEL_FALLBACKS keeps the legacy custom alive.
  website_booking_cancelled_customer: 'pro_annullamento_cliente',

  // Prime Wash — servizio finito ("AUTO PRONTA" button su CarWashBookingsTab,
  // sia per Lavaggi che per Meccanica). Single event for both service types;
  // il resolver sceglie il template per service_type su template a Tipo
  // servizio = Prime Wash.
  service_ready_customer: 'pro_auto_pronta',
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
  tour_new_customer: 'ARIA/MARE: alla creazione della prenotazione TOUR (al cliente) — dopo pagamento o spunta Conferma Prenotazione',
  rental_auto_pronta: 'NOLEGGIO: auto pronta — veicolo pronto al ritiro (admin clicca "Auto Pronta" su prenotazione o calendario)',
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
  booking_cancelled_whatsapp: 'Annullamento prenotazione (admin annulla manualmente o cron pagamento non riuscito)',
  sollecito_pagamento: 'Sollecito pagamento: promemoria al cliente con debito ancora aperto ("Invia Sollecito" in In attesa di pagamento + auto-resend ogni 48h, max 3)',
  payment_received_extension: 'Conferma pagamento estensione (al cliente)',
  payment_received_extension_admin: 'Conferma pagamento estensione (admin)',
  payment_received_damages: 'Conferma pagamento danni/penali (al cliente)',
  payment_received_damages_admin: 'Conferma pagamento danni/penali (admin)',
  booking_confirmed_da_saldare: 'NOLEGGIO: prenotazione confermata ma ancora Da Saldare (admin spunta Conferma su noleggio pending)',
  booking_paid_cash:          'NOLEGGIO: pagamento ricevuto in CONTANTI (admin crea noleggio con payment_method=Contanti + Conferma Prenotazione)',
  booking_paid_card:          'NOLEGGIO: pagamento ricevuto via CARTA / BANCOMAT (admin crea noleggio con payment_method=Bancomat/POS + Conferma)',
  booking_paid_bank_transfer: 'NOLEGGIO: pagamento ricevuto via BONIFICO (admin crea noleggio con payment_method=Bonifico + Conferma)',
  booking_paid_paypal:        'NOLEGGIO: pagamento ricevuto via PAYPAL (admin crea noleggio con payment_method=Paypal + Conferma)',
  booking_paid_wallet:        'NOLEGGIO: pagamento usando il WALLET / Credit Wallet (admin crea noleggio con payment_method=Credit Wallet + Conferma)',

  // Lavaggio — pagamento confermato (NON usati da noleggio)
  carwash_confirmed_da_saldare: 'LAVAGGIO: prenotazione confermata ma ancora Da Saldare (admin spunta Conferma su lavaggio pending)',
  carwash_paid_cash:            'LAVAGGIO: pagamento ricevuto in CONTANTI (admin crea lavaggio con payment_method=Contanti + Conferma)',
  carwash_paid_card:            'LAVAGGIO: pagamento ricevuto via CARTA / BANCOMAT (admin crea lavaggio + Conferma)',
  carwash_paid_bank_transfer:   'LAVAGGIO: pagamento ricevuto via BONIFICO (admin crea lavaggio + Conferma)',
  carwash_paid_paypal:          'LAVAGGIO: pagamento ricevuto via PAYPAL (admin crea lavaggio + Conferma)',
  carwash_paid_wallet:          'LAVAGGIO: pagamento usando il WALLET / Credit Wallet (admin crea lavaggio + Conferma)',

  // Meccanica — pagamento confermato (NON usati da noleggio o lavaggio)
  mechanical_confirmed_da_saldare: 'MECCANICA: prenotazione confermata ma ancora Da Saldare',
  mechanical_paid_cash:            'MECCANICA: pagamento ricevuto in CONTANTI (admin crea meccanica + Conferma)',
  mechanical_paid_card:            'MECCANICA: pagamento ricevuto via CARTA / BANCOMAT (admin crea meccanica + Conferma)',
  mechanical_paid_bank_transfer:   'MECCANICA: pagamento ricevuto via BONIFICO (admin crea meccanica + Conferma)',
  mechanical_paid_paypal:          'MECCANICA: pagamento ricevuto via PAYPAL (admin crea meccanica + Conferma)',
  mechanical_paid_wallet:          'MECCANICA: pagamento usando il WALLET / Credit Wallet (admin crea meccanica + Conferma)',

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
  // 2026-05-22: cauzione con VEICOLO come garanzia (Auto come Cauzione).
  // Fire quando admin spunta "Cauzione Auto" su una prenotazione e salva.
  cauzione_veicolo_created: 'Cauzione con VEICOLO come garanzia: dettagli targa/garante al cliente',
  cauzione_veicolo_returned: 'Cauzione veicolo restituita al cliente (fine noleggio)',
  // Promemoria garante: il garante riceve il riassunto della cauzione veicolo
  cauzione_garante_notification: 'Notifica al GARANTE della cauzione veicolo (terzo intestatario)',

  // No Cauzione / Sconti preventivi
  no_cauzione_approved: 'Approvazione "No Cauzione": invio link pagamento al cliente',
  no_cauzione_rejected: 'Rifiuto "No Cauzione": invio codice sconto 5% al cliente',
  quote_discount_offered: 'Preventivo rifiutato con sconto: invio codice sconto al cliente',

  // Website
  website_booking_cancelled_customer: 'Annullamento prenotazione effettuato dal cliente sul sito',

  // 2026-05-22: eventi aggiuntivi richiesti da direzione per copertura completa
  // Ciclo cliente
  on_first_booking: 'Prima prenotazione di un nuovo cliente (welcome message)',
  before_birthday: 'X giorni prima del compleanno del cliente (auguri anticipati)',
  // Pagamento — eventi mancanti
  on_payment_failed: 'Pagamento Nexi fallito (carta rifiutata / 3DS fallita)',
  on_payment_link_expired: 'Link Nexi pay-by-link scaduto senza pagamento',
  on_partial_payment_received: 'Pagamento parziale ricevuto (residuo da saldare)',
  // Documenti cliente
  on_doc_uploaded: 'Cliente ha caricato patente/CI sul sito',
  on_doc_verified: 'Documenti del cliente verificati dall\'admin (ok per noleggio)',
  on_doc_rejected: 'Documenti del cliente rifiutati dall\'admin (caricare di nuovo)',
  // Pickup/Dropoff timing
  on_late_pickup: 'Cliente in ritardo per il ritiro (oltre 30min dall\'orario)',
  on_late_return: 'Cliente in ritardo per la riconsegna',
  on_no_show: 'Cliente non si e\' presentato al ritiro',
  // Recensioni
  on_review_received: 'Recensione lasciata dal cliente (5 stelle → ringrazia / <3 → contatta)',
  // Promozioni / Club
  on_promo_gap: 'Veicolo libero per gap di 1 giorno tra prenotazioni',
  on_club_subscription: 'Cliente acquista DR7 Club',
  on_club_tier_promotion: 'Cliente promosso a tier superiore (Elite / Member / ecc.)',
  on_club_renewal_due: 'Rinnovo membership DR7 Club in scadenza',
  // Wallet
  on_wallet_recharge: 'Wallet ricaricato dal cliente',
  on_wallet_low_balance: 'Saldo wallet sotto soglia (es. <€20)',
  // Extras / servizi premium
  on_extra_added: 'Servizio extra aggiunto a una prenotazione esistente',
  on_extension_requested: 'Cliente richiede estensione del noleggio',

  // Prime Wash — auto pronta (admin clicca AUTO PRONTA su CarWashBookingsTab)
  service_ready_customer: 'PRIME WASH: auto pronta / lavaggio concluso (admin clicca "Auto Pronta" sulla riga della prenotazione)',
  // ─────────────────────────────────────────────────────────────────────────
  // 2026-08-09 — Trigger aggiunti per coprire i business e le sezioni che non
  // avevano NESSUN evento (Mare, Aria, Soggiorni, Fatture, Multe, Scadenze
  // veicolo, Magazzino, Status cliente).
  //
  // ATTENZIONE: sono selezionabili ma NON ancora emessi dal codice — vedi
  // PENDING_EVENTS piu' sotto. Un messaggio collegato a uno di questi non
  // partira' finche' l'emissione non viene aggiunta nel punto giusto. In
  // MessaggiSistemaProTab compaiono con il badge "da collegare".
  // ─────────────────────────────────────────────────────────────────────────

  // NOLEGGIO MARE
  boat_new_customer: 'MARE: conferma prenotazione al cliente',
  boat_new_admin: 'MARE: nuova prenotazione — avviso allo staff',
  boat_modified: 'MARE: prenotazione modificata (date, mezzo, importo)',
  boat_cancelled: 'MARE: prenotazione annullata',
  boat_da_saldare_customer: 'MARE: prenotazione confermata da saldare',
  boat_pronto: 'MARE: mezzo pronto per il ritiro',

  // NOLEGGIO ARIA
  heli_new_customer: 'ARIA: conferma prenotazione al cliente',
  heli_new_admin: 'ARIA: nuova prenotazione — avviso allo staff',
  heli_modified: 'ARIA: prenotazione modificata (date, velivolo, importo)',
  heli_cancelled: 'ARIA: prenotazione annullata',
  heli_da_saldare_customer: 'ARIA: prenotazione confermata da saldare',
  heli_pronto: 'ARIA: velivolo pronto per la partenza',

  // SOGGIORNI E OSPITALITA'
  stay_new_customer: 'SOGGIORNI: conferma prenotazione al cliente',
  stay_new_admin: 'SOGGIORNI: nuova prenotazione — avviso allo staff',
  stay_modified: 'SOGGIORNI: prenotazione modificata (date, struttura, importo)',
  stay_cancelled: 'SOGGIORNI: prenotazione annullata',
  stay_da_saldare_customer: 'SOGGIORNI: prenotazione confermata da saldare',
  stay_pronto: 'SOGGIORNI: struttura pronta per il check-in',

  // FATTURE (Amministrazione > Fatture)
  fattura_generata_customer: 'FATTURA: fattura emessa — invio al cliente',
  fattura_inviata_customer: 'FATTURA: fattura inoltrata al cliente (reinvio manuale)',
  nota_credito_emessa_customer: 'FATTURA: nota di credito emessa — invio al cliente',
  fattura_sdi_accettata_admin: 'FATTURA: SDI ha ACCETTATO la fattura — avviso amministrazione',
  fattura_sdi_rifiutata_admin: 'FATTURA: SDI ha SCARTATO la fattura — avviso amministrazione',

  // CAUZIONI — NON aggiunte di proposito. Il gestionale ha DUE meccanismi:
  // `handled_events` (questo elenco) e `trigger_event` (Alla creazione, Al
  // pagamento, Cauzione incassata, Cauzione restituita...). Incasso e
  // restituzione esistono gia' come trigger_event 'on_cauzione_collected' e
  // 'on_cauzione_refunded', e CauzioniTab li EMETTE davvero al clic sui
  // bottoni Incassata / Restituita. Duplicarli qui avrebbe dato due strade per
  // la stessa cosa, con il rischio di doppio invio.

  // MULTE
  multa_conducente_identificato_admin: 'MULTA: conducente identificato — avviso amministrazione',
  multa_pec_inviata_admin: 'MULTA: PEC inviata all\'ente — conferma amministrazione',
  multa_notifica_cliente: 'MULTA: notifica al cliente della multa a suo carico',

  // VEICOLI — SCADENZE (dal cruscotto veicolo)
  veicolo_scadenza_assicurazione: 'VEICOLO: assicurazione in scadenza — avviso staff',
  veicolo_scadenza_tagliando: 'VEICOLO: tagliando in scadenza (km o data) — avviso staff',
  veicolo_scadenza_gomme: 'VEICOLO: gomme da sostituire — avviso staff',
  veicolo_scadenza_pastiglie: 'VEICOLO: pastiglie freni da sostituire — avviso staff',
  veicolo_scadenza_generica: 'VEICOLO: altra scadenza amministrativa — avviso staff',

  // MAGAZZINO
  magazzino_ordine_fornitore: 'MAGAZZINO: ordine inviato al fornitore',

  // CLIENTI — STATUS
  cliente_status_blacklist: 'CLIENTE: inserito in Blacklist',
  cliente_status_member: 'CLIENTE: promosso a Member',
  cliente_status_elite: 'CLIENTE: promosso a Elite',

  // ─────────────────────────────────────────────────────────────────────────
  // 2026-08-10 — Chiavi che il codice EMETTE GIA' ma che non erano
  // selezionabili: la direzione non poteva quindi modificarne il testo dai
  // Messaggi di Sistema Pro, pur essendo messaggi che partono ogni giorno.
  // Nessun badge "da collegare": sono attive.
  // ─────────────────────────────────────────────────────────────────────────
  invoice_pdf_whatsapp: 'FATTURA: didascalia del PDF fattura inviato su WhatsApp',
  penalty_invoice_pdf_whatsapp: 'FATTURA: didascalia del PDF fattura penali/danni su WhatsApp',
  admin_contract_signed_alert: 'CONTRATTO: contratto firmato — avviso allo staff',
  pro_email_contratto: 'CONTRATTO: corpo della email con il contratto',
  pro_email_contratto_subject: 'CONTRATTO: oggetto della email con il contratto',
  cancellation_admin_alert: 'ANNULLAMENTO: prenotazione annullata — avviso allo staff',
  nexi_payment_received_admin: 'PAGAMENTO: incasso Nexi ricevuto — avviso allo staff',
  pro_richiesta_pagamento: 'PAGAMENTO: richiesta di pagamento al cliente',
  pro_email_addebito: 'PAGAMENTO: corpo della email di addebito',
  pro_email_addebito_subject: 'PAGAMENTO: oggetto della email di addebito',
  pro_custom_link_pagamento_penali_e_danni_17: 'PAGAMENTO: link di pagamento penali e danni',
  prepaid_card_blocked_customer: 'PAGAMENTO: carta prepagata rifiutata — avviso al cliente',
  prepaid_card_blocked_admin: 'PAGAMENTO: carta prepagata rifiutata — avviso allo staff',
  pro_allerta_meteo: 'METEO: allerta meteo — Noleggio Terra',
  pro_allerta_meteo_mare: 'METEO: allerta meteo — Noleggio Mare',
  wallet_auto_recharge: 'WALLET: ricarica automatica ricorrente accreditata',
  wallet_bonus_credit_admin: 'WALLET: bonus accreditato — avviso allo staff',
  referral_otp_whatsapp: 'REFERRAL: codice OTP di verifica al partecipante',


  // ═══════════════════════════════════════════════════════════════════════
  // 2026-08-14 (roadmap #44) — Catalogo generato dal FILE TRIGGER della
  // direzione ("Gestionale DR7 – Elenco completo delle azioni disponibili").
  //
  // Il file elenca 958 azioni. 334 sono di sola consultazione (visualizzare,
  // cercare, filtrare, navigare, aprire): ESCLUSE su decisione della
  // direzione — non cambiano niente, quindi non c'e' niente da comunicare, e
  // un trigger che non puo' produrre un messaggio e' solo rumore in un elenco
  // che serve a scegliere.
  //
  // Restano 624 azioni che CAMBIANO uno stato. 64 erano gia' coperte da un
  // evento esistente (es. "Creare una nuova prenotazione" = rental_new_customer)
  // e non sono state duplicate: due voci identiche vorrebbero dire sceglierne
  // una a caso. Le altre 560 sono qui sotto, nell'ordine e con i nomi del file.
  //
  // ATTENZIONE: sono selezionabili ma NON emesse dal codice — stanno tutte in
  // PENDING_EVENTS e l'interfaccia le mostra con il badge "da collegare". La
  // direzione puo' preparare il testo; il messaggio partira' quando
  // l'emissione verra' aggiunta nel punto giusto del codice.
  // ═══════════════════════════════════════════════════════════════════════

  // ── NOLEGGIO TERRA · Prenotazioni ──
  terra_invia_test_meteo: 'NOLEGGIO TERRA · Prenotazioni: Inviare un test meteo',

  // ── NOLEGGIO TERRA · Gestione Prenotazione ──
  terra_gestire_prenotazione: 'NOLEGGIO TERRA · Gestione Prenotazione: Gestire una prenotazione',
  terra_gestire_danni: 'NOLEGGIO TERRA · Gestione Prenotazione: Gestire danni',
  terra_gestire_penali: 'NOLEGGIO TERRA · Gestione Prenotazione: Gestire penali',

  // ── NOLEGGIO TERRA · Preventivi ──
  terra_crea_preventivo: 'NOLEGGIO TERRA · Preventivi: Creare un nuovo preventivo',
  terra_modifica_preventivo: 'NOLEGGIO TERRA · Preventivi: Modificare un preventivo',
  terra_invia_preventivo: 'NOLEGGIO TERRA · Preventivi: Inviare un preventivo',
  terra_accettare_preventivo: 'NOLEGGIO TERRA · Preventivi: Accettare un preventivo',
  terra_rifiutare_preventivo: 'NOLEGGIO TERRA · Preventivi: Rifiutare un preventivo',
  terra_cambiare_preventivo: 'NOLEGGIO TERRA · Preventivi: Cambiare un preventivo',
  terra_esportare_preventivi: 'NOLEGGIO TERRA · Preventivi: Esportare i preventivi',

  // ── NOLEGGIO TERRA · Uscite Straordinarie ──
  terra_aggiungi_uscita_straordinaria: 'NOLEGGIO TERRA · Uscite Straordinarie: Aggiungere una nuova uscita straordinaria',
  terra_invia_test_meteo_2: 'NOLEGGIO TERRA · Uscite Straordinarie: Inviare un test meteo',
  terra_modifica_uscita_straordinaria: 'NOLEGGIO TERRA · Uscite Straordinarie: Modificare un\'uscita straordinaria',
  terra_gestire_uscita_straordinaria: 'NOLEGGIO TERRA · Uscite Straordinarie: Gestire un\'uscita straordinaria',

  // ── NOLEGGIO TERRA · Calendario ──
  terra_modifica_prenotazioni_esistenti: 'NOLEGGIO TERRA · Calendario: Modificare le prenotazioni esistenti',
  terra_verificare_tutti_veicoli_disponibili: 'NOLEGGIO TERRA · Calendario: Verificare tutti i veicoli disponibili',
  terra_nascondere_fatturato: 'NOLEGGIO TERRA · Calendario: Nascondere il fatturato',
  terra_mostrare_fatturato: 'NOLEGGIO TERRA · Calendario: Mostrare il fatturato',

  // ── CONTRATTI · Gestione Template Contratto ──
  contratti_carica_versione_contratto: 'CONTRATTI · Gestione Template Contratto: Caricare una nuova versione del contratto',

  // ── CONTRATTI · Gestione Contratti ──
  contratti_rigenera_contratto: 'CONTRATTI · Gestione Contratti: Rigenerare il contratto',
  contratti_modifica_contratto: 'CONTRATTI · Gestione Contratti: Modificare il contratto',
  contratti_elimina_contratto: 'CONTRATTI · Gestione Contratti: Eliminare il contratto',
  contratti_elimina_prenotazione_collegata: 'CONTRATTI · Gestione Contratti: Eliminare la prenotazione collegata',

  // ── DANNI E PENALI · Penali ──
  danni_modifica_penali: 'DANNI E PENALI · Penali: Modificare le penali',
  danni_elimina_penali: 'DANNI E PENALI · Penali: Eliminare le penali',

  // ── DANNI E PENALI · Danni ──
  danni_modifica_danni: 'DANNI E PENALI · Danni: Modificare i danni',
  danni_elimina_danni: 'DANNI E PENALI · Danni: Eliminare i danni',

  // ── MULTE · Storico Pec ──
  multe_aggiornare_storico_pec: 'MULTE · Storico Pec: Aggiornare lo storico PEC',

  // ── MULTE · Carica E Invia Pec ──
  multe_carica_documento: 'MULTE · Carica E Invia Pec: Caricare il documento',
  multe_analizzare_documento: 'MULTE · Carica E Invia Pec: Analizzare il documento',

  // ── CARGOS · Cargos ──
  cargos_scarica_file: 'CARGOS · Cargos: Scaricare i file',
  cargos_gestire_impostazioni: 'CARGOS · Cargos: Gestire le impostazioni',
  cargos_validare_contratti: 'CARGOS · Cargos: Validare i contratti',
  cargos_invia_piu_contratti_contemporaneamente_cargos: 'CARGOS · Cargos: Inviare piu\' contratti contemporaneamente a Cargos',

  // ── VEICOLI · Cruscotto ──
  veicoli_modifica_targa: 'VEICOLI · Cruscotto: Modificare la targa',
  veicoli_modifica_numero_telaio: 'VEICOLI · Cruscotto: Modificare il numero di telaio',
  veicoli_modifica_chilometraggio: 'VEICOLI · Cruscotto: Modificare il chilometraggio',
  veicoli_modifica_cavalli: 'VEICOLI · Cruscotto: Modificare i cavalli',
  veicoli_modifica_l_anno: 'VEICOLI · Cruscotto: Modificare l\'anno',
  veicoli_modifica_dato_accelerazione_0_100_km_h: 'VEICOLI · Cruscotto: Modificare il dato di accelerazione 0-100 km/h',

  // ── VEICOLI · Manutenzione E Chilometri ──
  veicoli_inserisci_tagliando: 'VEICOLI · Manutenzione E Chilometri: Inserire il tagliando',
  veicoli_modifica_tagliando: 'VEICOLI · Manutenzione E Chilometri: Modificare il tagliando',
  veicoli_inserisci_l_intervallo_tagliando: 'VEICOLI · Manutenzione E Chilometri: Inserire l\'intervallo di tagliando',
  veicoli_modifica_l_intervallo_tagliando: 'VEICOLI · Manutenzione E Chilometri: Modificare l\'intervallo di tagliando',

  // ── VEICOLI · Gomme ──
  veicoli_inserisci_specifiche_gomme_anteriori: 'VEICOLI · Gomme: Inserire le specifiche delle gomme anteriori',
  veicoli_inserisci_specifiche_gomme_posteriori: 'VEICOLI · Gomme: Inserire le specifiche delle gomme posteriori',
  veicoli_modifica_specifiche_gomme_anteriori: 'VEICOLI · Gomme: Modificare le specifiche delle gomme anteriori',
  veicoli_modifica_specifiche_gomme_posteriori: 'VEICOLI · Gomme: Modificare le specifiche delle gomme posteriori',
  veicoli_inserisci_intervalli_relativi_gomme: 'VEICOLI · Gomme: Inserire gli intervalli relativi alle gomme',
  veicoli_modifica_intervalli_relativi_gomme: 'VEICOLI · Gomme: Modificare gli intervalli relativi alle gomme',

  // ── VEICOLI · Pastiglie Freni ──
  veicoli_inserisci_dati_pastiglie_anteriori: 'VEICOLI · Pastiglie Freni: Inserire i dati delle pastiglie anteriori',
  veicoli_inserisci_dati_pastiglie_posteriori: 'VEICOLI · Pastiglie Freni: Inserire i dati delle pastiglie posteriori',
  veicoli_modifica_dati_pastiglie_anteriori: 'VEICOLI · Pastiglie Freni: Modificare i dati delle pastiglie anteriori',
  veicoli_modifica_dati_pastiglie_posteriori: 'VEICOLI · Pastiglie Freni: Modificare i dati delle pastiglie posteriori',
  veicoli_inserisci_intervalli_relativi_pastiglie: 'VEICOLI · Pastiglie Freni: Inserire gli intervalli relativi alle pastiglie',
  veicoli_modifica_intervalli_relativi_pastiglie: 'VEICOLI · Pastiglie Freni: Modificare gli intervalli relativi alle pastiglie',

  // ── VEICOLI · Scadenze E Date ──
  veicoli_inserisci_scadenze_amministrative: 'VEICOLI · Scadenze E Date: Inserire le scadenze amministrative',
  veicoli_modifica_scadenze_amministrative: 'VEICOLI · Scadenze E Date: Modificare le scadenze amministrative',
  veicoli_inserisci_qualsiasi_altra_scadenza_relativa_ve: 'VEICOLI · Scadenze E Date: Inserire qualsiasi altra scadenza relativa al veicolo',

  // ── VEICOLI · Storico Veicolo ──
  veicoli_inserisci_attivita_effettuate_sul_veicolo: 'VEICOLI · Storico Veicolo: Inserire le attivita\' effettuate sul veicolo',
  veicoli_inserisci_manutenzioni_effettuate: 'VEICOLI · Storico Veicolo: Inserire le manutenzioni effettuate',
  veicoli_inserisci_lavori_effettuati: 'VEICOLI · Storico Veicolo: Inserire i lavori effettuati',

  // ── VEICOLI · Catalogo Veicoli ──
  veicoli_inserisci_foto_auto: 'VEICOLI · Catalogo Veicoli: Inserire le foto delle auto',

  // ── MAGAZZINO · Gestione Materiali ──
  magazzino_inserisci_materiale: 'MAGAZZINO · Gestione Materiali: Inserire un nuovo materiale',
  magazzino_inserisci_quantita_disponibile: 'MAGAZZINO · Gestione Materiali: Inserire la quantita\' disponibile',
  magazzino_aggiornare_quantita_disponibile: 'MAGAZZINO · Gestione Materiali: Aggiornare la quantita\' disponibile',
  magazzino_inserisci_quantita_utilizzata: 'MAGAZZINO · Gestione Materiali: Inserire la quantita\' utilizzata',
  magazzino_aggiungi_merce: 'MAGAZZINO · Gestione Materiali: Aggiungere merce',
  magazzino_togliere_merce: 'MAGAZZINO · Gestione Materiali: Togliere merce',
  magazzino_gestire_materiale_utilizzato_manutenzione_auto: 'MAGAZZINO · Gestione Materiali: Gestire il materiale utilizzato per la manutenzione delle auto',
  magazzino_aggiungi_materiale_carrello: 'MAGAZZINO · Gestione Materiali: Aggiungere materiale al carrello',
  magazzino_aggiungi_materiale_ordine: 'MAGAZZINO · Gestione Materiali: Aggiungere materiale a un ordine',

  // ── MAGAZZINO · Carrello ──
  magazzino_rimuovi_articoli_dal_carrello: 'MAGAZZINO · Carrello: Rimuovere articoli dal carrello',
  magazzino_genera_ordine: 'MAGAZZINO · Carrello: Generare un ordine',

  // ── MAGAZZINO · Fornitori Magazzino ──
  magazzino_aggiungi_fornitore: 'MAGAZZINO · Fornitori Magazzino: Aggiungere un nuovo fornitore',
  magazzino_modifica_fornitore: 'MAGAZZINO · Fornitori Magazzino: Modificare un fornitore esistente',
  magazzino_elimina_fornitore: 'MAGAZZINO · Fornitori Magazzino: Eliminare un fornitore',

  // ── NOLEGGIO MARE · Prenotazioni ──
  mare_invia_test_meteo: 'NOLEGGIO MARE · Prenotazioni: Inviare un test meteo',

  // ── NOLEGGIO MARE · Gestione Prenotazione ──
  mare_gestire_prenotazione: 'NOLEGGIO MARE · Gestione Prenotazione: Gestire una prenotazione',
  mare_estendere_prenotazione: 'NOLEGGIO MARE · Gestione Prenotazione: Estendere una prenotazione',
  mare_invia_contratto: 'NOLEGGIO MARE · Gestione Prenotazione: Inviare il contratto',
  mare_gestire_danni: 'NOLEGGIO MARE · Gestione Prenotazione: Gestire danni',
  mare_gestire_penali: 'NOLEGGIO MARE · Gestione Prenotazione: Gestire penali',

  // ── NOLEGGIO MARE · Preventivi ──
  mare_crea_preventivo: 'NOLEGGIO MARE · Preventivi: Creare un nuovo preventivo',
  mare_modifica_preventivo: 'NOLEGGIO MARE · Preventivi: Modificare un preventivo',
  mare_invia_preventivo: 'NOLEGGIO MARE · Preventivi: Inviare un preventivo',
  mare_accettare_preventivo: 'NOLEGGIO MARE · Preventivi: Accettare un preventivo',
  mare_rifiutare_preventivo: 'NOLEGGIO MARE · Preventivi: Rifiutare un preventivo',
  mare_cambiare_preventivo: 'NOLEGGIO MARE · Preventivi: Cambiare un preventivo',
  mare_esportare_preventivi: 'NOLEGGIO MARE · Preventivi: Esportare i preventivi',

  // ── NOLEGGIO MARE · Richieste No Cauzione ──
  mare_accettare_richiesta_no_cauzione: 'NOLEGGIO MARE · Richieste No Cauzione: Accettare una richiesta No Cauzione',
  mare_rifiutare_richiesta_no_cauzione: 'NOLEGGIO MARE · Richieste No Cauzione: Rifiutare una richiesta No Cauzione',

  // ── NOLEGGIO MARE · Uscite Straordinarie ──
  mare_aggiungi_uscita_straordinaria: 'NOLEGGIO MARE · Uscite Straordinarie: Aggiungere una nuova uscita straordinaria',
  mare_invia_test_meteo_2: 'NOLEGGIO MARE · Uscite Straordinarie: Inviare un test meteo',
  mare_modifica_uscita_straordinaria: 'NOLEGGIO MARE · Uscite Straordinarie: Modificare un\'uscita straordinaria',
  mare_gestire_uscita_straordinaria: 'NOLEGGIO MARE · Uscite Straordinarie: Gestire un\'uscita straordinaria',

  // ── NOLEGGIO MARE · Calendario ──
  mare_modifica_prenotazioni_esistenti: 'NOLEGGIO MARE · Calendario: Modificare le prenotazioni esistenti',
  mare_verificare_tutti_mezzi_disponibili: 'NOLEGGIO MARE · Calendario: Verificare tutti i mezzi disponibili',
  mare_nascondere_fatturato: 'NOLEGGIO MARE · Calendario: Nascondere il fatturato',
  mare_mostrare_fatturato: 'NOLEGGIO MARE · Calendario: Mostrare il fatturato',

  // ── NOLEGGIO ARIA · Prenotazioni ──
  aria_invia_allerta_meteo: 'NOLEGGIO ARIA · Prenotazioni: Inviare un\'allerta meteo',
  aria_invia_test_meteo: 'NOLEGGIO ARIA · Prenotazioni: Inviare un test meteo',

  // ── NOLEGGIO ARIA · Gestione Prenotazione ──
  aria_gestire_prenotazione: 'NOLEGGIO ARIA · Gestione Prenotazione: Gestire una prenotazione',
  aria_estendere_prenotazione: 'NOLEGGIO ARIA · Gestione Prenotazione: Estendere una prenotazione',
  aria_invia_contratto: 'NOLEGGIO ARIA · Gestione Prenotazione: Inviare il contratto',
  aria_gestire_danni: 'NOLEGGIO ARIA · Gestione Prenotazione: Gestire danni',
  aria_gestire_penali: 'NOLEGGIO ARIA · Gestione Prenotazione: Gestire penali',

  // ── NOLEGGIO ARIA · Preventivi ──
  aria_crea_preventivo: 'NOLEGGIO ARIA · Preventivi: Creare un nuovo preventivo',
  aria_modifica_preventivo: 'NOLEGGIO ARIA · Preventivi: Modificare un preventivo',
  aria_invia_preventivo: 'NOLEGGIO ARIA · Preventivi: Inviare un preventivo',
  aria_accettare_preventivo: 'NOLEGGIO ARIA · Preventivi: Accettare un preventivo',
  aria_rifiutare_preventivo: 'NOLEGGIO ARIA · Preventivi: Rifiutare un preventivo',
  aria_cambiare_preventivo: 'NOLEGGIO ARIA · Preventivi: Cambiare un preventivo',
  aria_esportare_preventivi: 'NOLEGGIO ARIA · Preventivi: Esportare i preventivi',

  // ── NOLEGGIO ARIA · Richieste No Cauzione ──
  aria_accettare_richiesta_no_cauzione: 'NOLEGGIO ARIA · Richieste No Cauzione: Accettare una richiesta No Cauzione',
  aria_rifiutare_richiesta_no_cauzione: 'NOLEGGIO ARIA · Richieste No Cauzione: Rifiutare una richiesta No Cauzione',

  // ── NOLEGGIO ARIA · Uscite Straordinarie ──
  aria_aggiungi_uscita_straordinaria: 'NOLEGGIO ARIA · Uscite Straordinarie: Aggiungere una nuova uscita straordinaria',
  aria_invia_allerta_meteo_2: 'NOLEGGIO ARIA · Uscite Straordinarie: Inviare un\'allerta meteo',
  aria_invia_test_meteo_2: 'NOLEGGIO ARIA · Uscite Straordinarie: Inviare un test meteo',
  aria_modifica_uscita_straordinaria: 'NOLEGGIO ARIA · Uscite Straordinarie: Modificare un\'uscita straordinaria',
  aria_gestire_uscita_straordinaria: 'NOLEGGIO ARIA · Uscite Straordinarie: Gestire un\'uscita straordinaria',

  // ── NOLEGGIO ARIA · Calendario ──
  aria_modifica_prenotazioni_esistenti: 'NOLEGGIO ARIA · Calendario: Modificare le prenotazioni esistenti',
  aria_verificare_tutti_velivoli_disponibili: 'NOLEGGIO ARIA · Calendario: Verificare tutti i velivoli disponibili',
  aria_nascondere_fatturato: 'NOLEGGIO ARIA · Calendario: Nascondere il fatturato',
  aria_mostrare_fatturato: 'NOLEGGIO ARIA · Calendario: Mostrare il fatturato',

  // ── SOGGIORNI E OSPITALITA · Prenotazioni ──
  soggiorni_invia_allerta_meteo: 'SOGGIORNI E OSPITALITA · Prenotazioni: Inviare un\'allerta meteo',
  soggiorni_invia_test_meteo: 'SOGGIORNI E OSPITALITA · Prenotazioni: Inviare un test meteo',

  // ── SOGGIORNI E OSPITALITA · Gestione Prenotazione ──
  soggiorni_gestire_prenotazione: 'SOGGIORNI E OSPITALITA · Gestione Prenotazione: Gestire una prenotazione',
  soggiorni_estendere_prenotazione: 'SOGGIORNI E OSPITALITA · Gestione Prenotazione: Estendere una prenotazione',
  soggiorni_invia_contratto: 'SOGGIORNI E OSPITALITA · Gestione Prenotazione: Inviare il contratto',
  soggiorni_gestire_danni: 'SOGGIORNI E OSPITALITA · Gestione Prenotazione: Gestire danni',
  soggiorni_gestire_penali: 'SOGGIORNI E OSPITALITA · Gestione Prenotazione: Gestire penali',

  // ── SOGGIORNI E OSPITALITA · Preventivi ──
  soggiorni_crea_preventivo: 'SOGGIORNI E OSPITALITA · Preventivi: Creare un nuovo preventivo',
  soggiorni_modifica_preventivo: 'SOGGIORNI E OSPITALITA · Preventivi: Modificare un preventivo',
  soggiorni_invia_preventivo: 'SOGGIORNI E OSPITALITA · Preventivi: Inviare un preventivo',
  soggiorni_accettare_preventivo: 'SOGGIORNI E OSPITALITA · Preventivi: Accettare un preventivo',
  soggiorni_rifiutare_preventivo: 'SOGGIORNI E OSPITALITA · Preventivi: Rifiutare un preventivo',
  soggiorni_cambiare_preventivo: 'SOGGIORNI E OSPITALITA · Preventivi: Cambiare un preventivo',
  soggiorni_esportare_preventivi: 'SOGGIORNI E OSPITALITA · Preventivi: Esportare i preventivi',

  // ── SOGGIORNI E OSPITALITA · Richieste No Cauzione ──
  soggiorni_accettare_richiesta_no_cauzione: 'SOGGIORNI E OSPITALITA · Richieste No Cauzione: Accettare una richiesta No Cauzione',
  soggiorni_rifiutare_richiesta_no_cauzione: 'SOGGIORNI E OSPITALITA · Richieste No Cauzione: Rifiutare una richiesta No Cauzione',

  // ── SOGGIORNI E OSPITALITA · Uscite O Servizi Straordinari ──
  soggiorni_aggiungi_servizio_straordinario: 'SOGGIORNI E OSPITALITA · Uscite O Servizi Straordinari: Aggiungere un nuovo servizio straordinario',
  soggiorni_invia_allerta_meteo_2: 'SOGGIORNI E OSPITALITA · Uscite O Servizi Straordinari: Inviare un\'allerta meteo',
  soggiorni_invia_test_meteo_2: 'SOGGIORNI E OSPITALITA · Uscite O Servizi Straordinari: Inviare un test meteo',
  soggiorni_modifica_servizio_straordinario: 'SOGGIORNI E OSPITALITA · Uscite O Servizi Straordinari: Modificare un servizio straordinario',
  soggiorni_gestire_servizio_straordinario: 'SOGGIORNI E OSPITALITA · Uscite O Servizi Straordinari: Gestire un servizio straordinario',

  // ── SOGGIORNI E OSPITALITA · Calendario ──
  soggiorni_modifica_prenotazioni_esistenti: 'SOGGIORNI E OSPITALITA · Calendario: Modificare le prenotazioni esistenti',
  soggiorni_verificare_tutte_strutture_o_disponibilita: 'SOGGIORNI E OSPITALITA · Calendario: Verificare tutte le strutture o disponibilita\'',
  soggiorni_nascondere_fatturato: 'SOGGIORNI E OSPITALITA · Calendario: Nascondere il fatturato',
  soggiorni_mostrare_fatturato: 'SOGGIORNI E OSPITALITA · Calendario: Mostrare il fatturato',

  // ── LAVAGGIO E MECCANICA · Prenotazioni ──
  lavaggio_invia_fattura: 'LAVAGGIO E MECCANICA · Prenotazioni: Inviare la fattura',
  lavaggio_elimina_prenotazione: 'LAVAGGIO E MECCANICA · Prenotazioni: Eliminare la prenotazione',

  // ── LAVAGGIO E MECCANICA · Calendario ──
  lavaggio_modifica_prenotazioni_esistenti: 'LAVAGGIO E MECCANICA · Calendario: Modificare le prenotazioni esistenti',
  lavaggio_aggiungi_prenotazione: 'LAVAGGIO E MECCANICA · Calendario: Aggiungere una nuova prenotazione',
  lavaggio_mostrare_fatturato: 'LAVAGGIO E MECCANICA · Calendario: Mostrare il fatturato',
  lavaggio_nascondere_fatturato: 'LAVAGGIO E MECCANICA · Calendario: Nascondere il fatturato',

  // ── LAVAGGIO E MECCANICA · Catalogo Lavaggio ──
  lavaggio_inserisci_servizio_lavaggio: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Inserire un nuovo servizio di lavaggio',
  lavaggio_modifica_servizio_lavaggio: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Modificare un servizio di lavaggio',
  lavaggio_inserisci_descrizione: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Inserire una descrizione',
  lavaggio_modifica_descrizione: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Modificare una descrizione',
  lavaggio_salvare_descrizione: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Salvare una nuova descrizione',
  lavaggio_inserisci_foto: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Inserire una foto',
  lavaggio_modifica_foto: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Modificare una foto',
  lavaggio_salvare_foto: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Salvare una foto',
  lavaggio_cambiare_prezzi: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Cambiare i prezzi',
  lavaggio_cambiare_durate: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Cambiare le durate',
  lavaggio_modifica_durate: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Modificare le durate',
  lavaggio_salvare_modifiche: 'LAVAGGIO E MECCANICA · Catalogo Lavaggio: Salvare le modifiche',

  // ── LAVAGGIO E MECCANICA · Extra ──
  lavaggio_aggiungi_extra: 'LAVAGGIO E MECCANICA · Extra: Aggiungere un extra',
  lavaggio_modifica_extra: 'LAVAGGIO E MECCANICA · Extra: Modificare un extra',
  lavaggio_elimina_extra: 'LAVAGGIO E MECCANICA · Extra: Eliminare un extra',

  // ── LAVAGGIO E MECCANICA · Sezioni ──
  lavaggio_aggiungi_sezione: 'LAVAGGIO E MECCANICA · Sezioni: Aggiungere una sezione',
  lavaggio_modifica_sezione: 'LAVAGGIO E MECCANICA · Sezioni: Modificare una sezione',
  lavaggio_elimina_sezione: 'LAVAGGIO E MECCANICA · Sezioni: Eliminare una sezione',

  // ── LAVAGGIO E MECCANICA · Auto Di Cortesia ──
  lavaggio_aggiungi_auto_cortesia: 'LAVAGGIO E MECCANICA · Auto Di Cortesia: Aggiungere un\'auto di cortesia',
  lavaggio_modifica_auto_cortesia: 'LAVAGGIO E MECCANICA · Auto Di Cortesia: Modificare un\'auto di cortesia',
  lavaggio_elimina_auto_cortesia: 'LAVAGGIO E MECCANICA · Auto Di Cortesia: Eliminare un\'auto di cortesia',
  lavaggio_modifica_servizi_relativi_singola_auto_cortesi: 'LAVAGGIO E MECCANICA · Auto Di Cortesia: Modificare i servizi relativi a ogni singola auto di cortesia',

  // ── CLIENTI · Gestione Clienti ──
  clienti_rimuovi_duplicati: 'CLIENTI · Gestione Clienti: Rimuovere i duplicati',
  clienti_esportare_tutti_clienti: 'CLIENTI · Gestione Clienti: Esportare tutti i clienti',
  clienti_importare_link_con_lead_salvate: 'CLIENTI · Gestione Clienti: Importare un link con lead gia\' salvate',
  clienti_invia_link_autoregistrazione_cliente: 'CLIENTI · Gestione Clienti: Inviare un link di autoregistrazione al cliente',
  clienti_crea_cliente: 'CLIENTI · Gestione Clienti: Creare un nuovo cliente',

  // ── CLIENTI · Tipologia Cliente ──
  clienti_crea_persona_fisica: 'CLIENTI · Tipologia Cliente: Creare una persona fisica',
  clienti_crea_azienda: 'CLIENTI · Tipologia Cliente: Creare un\'azienda',
  clienti_crea_pubblica_amministrazione: 'CLIENTI · Tipologia Cliente: Creare una Pubblica Amministrazione',

  // ── CLIENTI · Creazione E Anagrafica ──
  clienti_inserisci_documenti_tramite_file: 'CLIENTI · Creazione E Anagrafica: Inserire documenti tramite file',
  clienti_inserisci_documenti_tramite_foto: 'CLIENTI · Creazione E Anagrafica: Inserire documenti tramite foto',
  clienti_compilare_manualmente_dati: 'CLIENTI · Creazione E Anagrafica: Compilare manualmente i dati',
  clienti_calcolare_codice_fiscale: 'CLIENTI · Creazione E Anagrafica: Calcolare il codice fiscale',
  clienti_calcolare_dati_anagrafici_partendo_dal_codice_: 'CLIENTI · Creazione E Anagrafica: Calcolare i dati anagrafici partendo dal codice fiscale',
  clienti_compilare_automaticamente_campi_tramite_foto_d: 'CLIENTI · Creazione E Anagrafica: Compilare automaticamente i campi tramite foto dei documenti',
  clienti_carica_file_documenti: 'CLIENTI · Creazione E Anagrafica: Caricare i file dei documenti',
  clienti_salvare_cliente: 'CLIENTI · Creazione E Anagrafica: Salvare il cliente',

  // ── CLIENTI · Lead Clienti ──
  clienti_copiare_contatto: 'CLIENTI · Lead Clienti: Copiare il contatto',
  clienti_invia_messaggio_tramite_whatsapp: 'CLIENTI · Lead Clienti: Inviare un messaggio tramite WhatsApp',
  clienti_chiamare_cliente: 'CLIENTI · Lead Clienti: Chiamare il cliente',

  // ── CLIENTI · Modifica Cliente ──
  clienti_modifica_tutta_scheda_cliente_compilata: 'CLIENTI · Modifica Cliente: Modificare tutta la scheda cliente gia\' compilata',
  clienti_salvare_modifiche: 'CLIENTI · Modifica Cliente: Salvare le modifiche',

  // ── CLIENTI · Autista ──
  clienti_trasformare_lead_cliente_anche_autista: 'CLIENTI · Autista: Trasformare una lead cliente anche in autista',
  clienti_aggiungi_status_autista: 'CLIENTI · Autista: Aggiungere lo status di autista',

  // ── CLIENTI · Status Cliente ──
  clienti_rimuovi_cliente_dalla_blacklist: 'CLIENTI · Status Cliente: Rimuovere il cliente dalla Blacklist',
  clienti_rimuovi_status_member: 'CLIENTI · Status Cliente: Rimuovere lo status Member',
  clienti_rimuovi_status_elite: 'CLIENTI · Status Cliente: Rimuovere lo status Elite',

  // ── CLIENTI · Credit Wallet ──
  clienti_addebitare_crediti_dal_wallet: 'CLIENTI · Credit Wallet: Addebitare crediti dal wallet',

  // ── MARKETING · Compleanni ──
  marketing_reinvia_messaggio_compleanno: 'MARKETING · Compleanni: Reinviare il messaggio di compleanno',

  // ── MARKETING · Recensioni ──
  marketing_reinvia_richiesta_recensione: 'MARKETING · Recensioni: Reinviare una richiesta recensione',
  marketing_bloccare_cliente: 'MARKETING · Recensioni: Bloccare un cliente',
  marketing_sbloccare_cliente: 'MARKETING · Recensioni: Sbloccare un cliente',
  marketing_approvare_cliente_richiesta_recensione: 'MARKETING · Recensioni: Approvare un cliente per la richiesta recensione',
  marketing_escludere_cliente_dalla_richiesta_recensione: 'MARKETING · Recensioni: Escludere un cliente dalla richiesta recensione',
  marketing_invia_alla_valutazione_direzione_clienti_hanno: 'MARKETING · Recensioni: Inviare alla valutazione della Direzione i clienti che hanno avuto danni',
  marketing_invia_alla_valutazione_direzione_clienti_hanno_2: 'MARKETING · Recensioni: Inviare alla valutazione della Direzione i clienti che hanno avuto penali',
  marketing_invia_alla_valutazione_direzione_clienti_hanno_3: 'MARKETING · Recensioni: Inviare alla valutazione della Direzione i clienti che hanno avuto contenziosi',

  // ── MARKETING · Messaggi Di Sistema Pro ──
  marketing_crea_messaggio_sistema: 'MARKETING · Messaggi Di Sistema Pro: Creare un nuovo messaggio di sistema',
  marketing_modifica_messaggio_sistema: 'MARKETING · Messaggi Di Sistema Pro: Modificare un messaggio di sistema esistente',
  marketing_elimina_messaggio_sistema: 'MARKETING · Messaggi Di Sistema Pro: Eliminare un messaggio di sistema',
  marketing_invia_messaggio_manualmente: 'MARKETING · Messaggi Di Sistema Pro: Inviare un messaggio manualmente',
  marketing_on_messaggio_generico_creato: 'MARKETING · Messaggi Di Sistema Pro: Accendere un messaggio generico gia\' creato',
  marketing_off_messaggio_generico_creato: 'MARKETING · Messaggi Di Sistema Pro: Spegnere un messaggio generico gia\' creato',

  // ── MARKETING · Automazioni Messaggi ──
  marketing_imposta_messaggio_come_automatico: 'MARKETING · Automazioni Messaggi: Impostare un messaggio come automatico',
  marketing_imposta_messaggio_come_manuale: 'MARKETING · Automazioni Messaggi: Impostare un messaggio come manuale',
  marketing_imposta_cron_on: 'MARKETING · Automazioni Messaggi: Impostare Cron ON',
  marketing_imposta_cron_off: 'MARKETING · Automazioni Messaggi: Impostare Cron OFF',

  // ── MARKETING · Configurazione Messaggi ──
  marketing_attiva_header: 'MARKETING · Configurazione Messaggi: Attivare Header',
  marketing_disattiva_header: 'MARKETING · Configurazione Messaggi: Disattivare Header',
  marketing_attiva_footer: 'MARKETING · Configurazione Messaggi: Attivare Footer',
  marketing_disattiva_footer: 'MARKETING · Configurazione Messaggi: Disattivare Footer',
  marketing_attiva_invio_tramite_email: 'MARKETING · Configurazione Messaggi: Attivare invio tramite email',
  marketing_disattiva_invio_tramite_email: 'MARKETING · Configurazione Messaggi: Disattivare invio tramite email',

  // ── MARKETING · Campagne Marketing ──
  marketing_crea_campagna_marketing: 'MARKETING · Campagne Marketing: Creare una nuova campagna marketing',
  marketing_programmare_campagna_marketing: 'MARKETING · Campagne Marketing: Programmare una campagna marketing',
  marketing_aggiungi_file_multimediale: 'MARKETING · Campagne Marketing: Aggiungere un file multimediale',
  marketing_aggiungi_video: 'MARKETING · Campagne Marketing: Aggiungere un video',
  marketing_programmare_l_invio: 'MARKETING · Campagne Marketing: Programmare l\'invio',
  marketing_invia_immediatamente: 'MARKETING · Campagne Marketing: Inviare immediatamente',

  // ── MARKETING · Destinatari Campagne ──
  marketing_invia_50_clienti: 'MARKETING · Destinatari Campagne: Inviare a 50 clienti',
  marketing_invia_100_clienti: 'MARKETING · Destinatari Campagne: Inviare a 100 clienti',
  marketing_invia_250_clienti: 'MARKETING · Destinatari Campagne: Inviare a 250 clienti',
  marketing_invia_500_clienti: 'MARKETING · Destinatari Campagne: Inviare a 500 clienti',
  marketing_invia_tutti_clienti: 'MARKETING · Destinatari Campagne: Inviare a tutti i clienti',
  marketing_includere_solo_determinate_sezioni_o_categorie: 'MARKETING · Destinatari Campagne: Includere solo determinate sezioni o categorie di clienti',
  marketing_escludere_determinate_sezioni_o_categorie_clie: 'MARKETING · Destinatari Campagne: Escludere determinate sezioni o categorie di clienti',

  // ── MARKETING · Social Links ──
  marketing_aggiungi_link_social: 'MARKETING · Social Links: Aggiungere un link social',
  marketing_modifica_link_social: 'MARKETING · Social Links: Modificare un link social',
  marketing_elimina_link_social: 'MARKETING · Social Links: Eliminare un link social',

  // ── MARKETING · Codici Sconto ──
  marketing_genera_codice_sconto: 'MARKETING · Codici Sconto: Generare un nuovo codice sconto',
  marketing_modifica_codice_sconto: 'MARKETING · Codici Sconto: Modificare un codice sconto',
  marketing_attiva_codice_sconto: 'MARKETING · Codici Sconto: Attivare un codice sconto',
  marketing_disattiva_codice_sconto: 'MARKETING · Codici Sconto: Disattivare un codice sconto',
  marketing_crea_qr_code: 'MARKETING · Codici Sconto: Creare un QR Code',
  marketing_copiare_codice_sconto: 'MARKETING · Codici Sconto: Copiare il codice sconto',

  // ── REPORT · Report Noleggio ──
  report_aggiornare_report: 'REPORT · Report Noleggio: Aggiornare il report',

  // ── REPORT · Report Lavaggio ──
  report_aggiornare_report_2: 'REPORT · Report Lavaggio: Aggiornare il report',

  // ── REPORT · Report Clienti ──
  report_genera_report_spese_clienti: 'REPORT · Report Clienti: Generare un report delle spese dei clienti',
  report_classificare_clienti: 'REPORT · Report Clienti: Classificare i clienti',
  report_ordinare_clienti: 'REPORT · Report Clienti: Ordinare i clienti',

  // ── REPORT · Report Preventivi ──
  report_categorizzare_preventivi: 'REPORT · Report Preventivi: Categorizzare i preventivi',
  report_analizzare_dati_preventivi: 'REPORT · Report Preventivi: Analizzare i dati dei preventivi',

  // ── AMMINISTRAZIONE · Attesa Di Pagamento ──
  amm_segnare_pagamento_come_pagato: 'AMMINISTRAZIONE · Attesa Di Pagamento: Segnare un pagamento come pagato',
  amm_inserisci_l_importo_pagato: 'AMMINISTRAZIONE · Attesa Di Pagamento: Inserire l\'importo pagato',
  amm_invia_link_pagamento_parziale: 'AMMINISTRAZIONE · Attesa Di Pagamento: Inviare un link di pagamento parziale',
  amm_addebitare_carta_tokenizzata: 'AMMINISTRAZIONE · Attesa Di Pagamento: Addebitare una carta tokenizzata',
  amm_registrare_pagamento_parziale: 'AMMINISTRAZIONE · Attesa Di Pagamento: Registrare un pagamento parziale',
  amm_parzializzare_pagamento: 'AMMINISTRAZIONE · Attesa Di Pagamento: Parzializzare un pagamento',
  amm_modifica_l_importo_pagamento: 'AMMINISTRAZIONE · Attesa Di Pagamento: Modificare l\'importo del pagamento',
  amm_elimina_pagamento: 'AMMINISTRAZIONE · Attesa Di Pagamento: Eliminare il pagamento',

  // ── AMMINISTRAZIONE · Cauzioni Amministrative ──
  amm_modifica_cauzione: 'AMMINISTRAZIONE · Cauzioni Amministrative: Modificare una cauzione',
  amm_segnare_cauzione_come_incassare: 'AMMINISTRAZIONE · Cauzioni Amministrative: Segnare una cauzione come Da incassare',
  amm_segnare_cauzione_come_incassata: 'AMMINISTRAZIONE · Cauzioni Amministrative: Segnare una cauzione come Incassata',
  amm_inserisci_cauzione_cassa: 'AMMINISTRAZIONE · Cauzioni Amministrative: Inserire una cauzione in cassa',
  amm_restituire_cauzione_prima_dell_incasso: 'AMMINISTRAZIONE · Cauzioni Amministrative: Restituire una cauzione prima dell\'incasso',
  amm_invia_link_preautorizzare_cauzione: 'AMMINISTRAZIONE · Cauzioni Amministrative: Inviare un link per preautorizzare la cauzione',
  amm_incassare_cauzione: 'AMMINISTRAZIONE · Cauzioni Amministrative: Incassare una cauzione',

  // ── AMMINISTRAZIONE · Scadenze Amministrative ──
  amm_imposta_scadenza: 'AMMINISTRAZIONE · Scadenze Amministrative: Impostare una nuova scadenza',
  amm_aggiungi_scadenza: 'AMMINISTRAZIONE · Scadenze Amministrative: Aggiungere una nuova scadenza',
  amm_modifica_scadenza: 'AMMINISTRAZIONE · Scadenze Amministrative: Modificare una scadenza',
  amm_elimina_scadenza: 'AMMINISTRAZIONE · Scadenze Amministrative: Eliminare una scadenza',

  // ── AMMINISTRAZIONE · Fatture ──
  amm_scarica_fattura: 'AMMINISTRAZIONE · Fatture: Scaricare una fattura',
  amm_copiare_fattura: 'AMMINISTRAZIONE · Fatture: Copiare una fattura',
  amm_inoltrare_fattura: 'AMMINISTRAZIONE · Fatture: Inoltrare una fattura',
  amm_modifica_fattura: 'AMMINISTRAZIONE · Fatture: Modificare una fattura',
  amm_scarica_pdf: 'AMMINISTRAZIONE · Fatture: Scaricare il PDF',
  amm_verificare_stato_sdi: 'AMMINISTRAZIONE · Fatture: Verificare lo stato SDI',
  amm_segnare_fattura_come_non_pagata: 'AMMINISTRAZIONE · Fatture: Segnare una fattura come Non pagata',
  amm_elimina_fattura: 'AMMINISTRAZIONE · Fatture: Eliminare una fattura',

  // ── AMMINISTRAZIONE · Report Operatori ──
  amm_genera_report_totale_operatori: 'AMMINISTRAZIONE · Report Operatori: Generare un report totale degli operatori',
  amm_effettuare_rilevazione_orari_giornalieri: 'AMMINISTRAZIONE · Report Operatori: Effettuare la rilevazione degli orari giornalieri',
  amm_carica_buste_paga_operatore: 'AMMINISTRAZIONE · Report Operatori: Caricare le buste paga di ogni operatore',
  amm_verificare_contratti_operatore: 'AMMINISTRAZIONE · Report Operatori: Verificare i contratti di ogni operatore',
  amm_crea_contratti_operatore: 'AMMINISTRAZIONE · Report Operatori: Creare i contratti di ogni operatore',

  // ── AMMINISTRAZIONE · Gestione Permessi Operatori ──
  amm_assegnare_permessi_operatore: 'AMMINISTRAZIONE · Gestione Permessi Operatori: Assegnare permessi a un operatore',
  amm_rimuovi_permessi_operatore: 'AMMINISTRAZIONE · Gestione Permessi Operatori: Rimuovere permessi a un operatore',
  amm_assegnare_uno_status_operatore_maggiore: 'AMMINISTRAZIONE · Gestione Permessi Operatori: Assegnare uno status operatore maggiore',
  amm_assegnare_uno_status_operatore_minore: 'AMMINISTRAZIONE · Gestione Permessi Operatori: Assegnare uno status operatore minore',
  amm_modifica_status_operatore: 'AMMINISTRAZIONE · Gestione Permessi Operatori: Modificare lo status di un operatore',
  amm_modifica_livello_autorizzazione: 'AMMINISTRAZIONE · Gestione Permessi Operatori: Modificare il livello di autorizzazione',

  // ── AMMINISTRAZIONE · Gestione Rifiuti ──
  amm_aggiungi_calendario: 'AMMINISTRAZIONE · Gestione Rifiuti: Aggiungere un calendario',
  amm_crea_giornate: 'AMMINISTRAZIONE · Gestione Rifiuti: Creare delle giornate',
  amm_aggiungi_ritiro: 'AMMINISTRAZIONE · Gestione Rifiuti: Aggiungere un ritiro',
  amm_imposta_giornata_fissa_ritiro: 'AMMINISTRAZIONE · Gestione Rifiuti: Impostare una giornata fissa di ritiro',
  amm_imposta_orario_fisso_ritiro: 'AMMINISTRAZIONE · Gestione Rifiuti: Impostare un orario fisso di ritiro',
  amm_modifica_giornata: 'AMMINISTRAZIONE · Gestione Rifiuti: Modificare una giornata',
  amm_modifica_ritiro: 'AMMINISTRAZIONE · Gestione Rifiuti: Modificare un ritiro',
  amm_elimina_giornata: 'AMMINISTRAZIONE · Gestione Rifiuti: Eliminare una giornata',
  amm_elimina_ritiro: 'AMMINISTRAZIONE · Gestione Rifiuti: Eliminare un ritiro',

  // ── AMMINISTRAZIONE · Ticket ──
  amm_seleziona_destinatari: 'AMMINISTRAZIONE · Ticket: Selezionare i destinatari',
  amm_seleziona_reparto: 'AMMINISTRAZIONE · Ticket: Selezionare il reparto',
  amm_scrivere_l_oggetto: 'AMMINISTRAZIONE · Ticket: Scrivere l\'oggetto',
  amm_inserisci_priorita: 'AMMINISTRAZIONE · Ticket: Inserire una priorita\'',
  amm_inserisci_numero_telefono: 'AMMINISTRAZIONE · Ticket: Inserire il numero di telefono',
  amm_carica_file: 'AMMINISTRAZIONE · Ticket: Caricare dei file',
  amm_invia_ticket: 'AMMINISTRAZIONE · Ticket: Inviare il ticket',
  amm_annullare_ticket: 'AMMINISTRAZIONE · Ticket: Annullare il ticket',
  amm_invia_messaggio_ticket_tramite_whatsapp: 'AMMINISTRAZIONE · Ticket: Inviare il messaggio del ticket tramite WhatsApp',
  amm_gestire_destinatari: 'AMMINISTRAZIONE · Ticket: Gestire i destinatari',

  // ── AMMINISTRAZIONE · Fornitori Amministrazione ──
  amm_aggiungi_fornitore: 'AMMINISTRAZIONE · Fornitori Amministrazione: Aggiungere un nuovo fornitore',
  amm_modifica_fornitore: 'AMMINISTRAZIONE · Fornitori Amministrazione: Modificare un fornitore esistente',
  amm_elimina_fornitore: 'AMMINISTRAZIONE · Fornitori Amministrazione: Eliminare un fornitore',
  amm_carica_bolle: 'AMMINISTRAZIONE · Fornitori Amministrazione: Caricare le bolle',
  amm_carica_bolla_senza_fattura: 'AMMINISTRAZIONE · Fornitori Amministrazione: Caricare una bolla senza fattura',
  amm_carica_documenti_fattura_ricevuta: 'AMMINISTRAZIONE · Fornitori Amministrazione: Caricare documenti su ogni fattura ricevuta',
  amm_eseguire_controllo_incrociato_fatture: 'AMMINISTRAZIONE · Fornitori Amministrazione: Eseguire un controllo incrociato delle fatture',
  amm_richiedere_accesso_tp_approvazione_fatture: 'AMMINISTRAZIONE · Fornitori Amministrazione: Richiedere accesso TP per approvazione fatture',
  amm_richiedere_accesso_tp_approvazione_pagamento: 'AMMINISTRAZIONE · Fornitori Amministrazione: Richiedere accesso TP per approvazione pagamento',
  amm_aggiornare_fatture: 'AMMINISTRAZIONE · Fornitori Amministrazione: Aggiornare le fatture',

  // ── AMMINISTRAZIONE · Nexi ──
  amm_effettuare_pagamento: 'AMMINISTRAZIONE · Nexi: Effettuare un nuovo pagamento',
  amm_preautorizzare_pagamento: 'AMMINISTRAZIONE · Nexi: Preautorizzare un nuovo pagamento',
  amm_elimina_carta_tokenizzata: 'AMMINISTRAZIONE · Nexi: Eliminare una carta tokenizzata',
  amm_addebitare_carta_tokenizzata_2: 'AMMINISTRAZIONE · Nexi: Addebitare una carta gia\' tokenizzata',

  // ── AMMINISTRAZIONE · Canali Di Notifica Otp ──
  amm_verificare_canali_notifica_otp: 'AMMINISTRAZIONE · Canali Di Notifica Otp: Verificare i canali di notifica OTP',
  amm_modifica_canali_notifica_direzione: 'AMMINISTRAZIONE · Canali Di Notifica Otp: Modificare i canali di notifica della Direzione',
  amm_config_destinatari_notifiche_otp: 'AMMINISTRAZIONE · Canali Di Notifica Otp: Configurare i destinatari delle notifiche OTP',

  // ── AMMINISTRAZIONE · Regole Otp ──
  amm_aggiungi_regola_otp: 'AMMINISTRAZIONE · Regole Otp: Aggiungere una nuova regola OTP',
  amm_modifica_regola_otp: 'AMMINISTRAZIONE · Regole Otp: Modificare una regola OTP esistente',
  amm_attiva_regola_otp: 'AMMINISTRAZIONE · Regole Otp: Attivare una regola OTP',
  amm_disattiva_regola_otp: 'AMMINISTRAZIONE · Regole Otp: Disattivare una regola OTP',
  amm_elimina_regola_otp: 'AMMINISTRAZIONE · Regole Otp: Eliminare una regola OTP',
  amm_elimina_blocco_otp_regola: 'AMMINISTRAZIONE · Regole Otp: Eliminare il blocco OTP da una regola',
  amm_segnalare_nuove_uscite_otp: 'AMMINISTRAZIONE · Regole Otp: Segnalare nuove uscite OTP',
  amm_segnalare_nuove_regole_otp: 'AMMINISTRAZIONE · Regole Otp: Segnalare nuove regole OTP',
  amm_invia_anteprima_otp: 'AMMINISTRAZIONE · Regole Otp: Inviare un\'anteprima OTP',
  amm_effettuare_test_otp: 'AMMINISTRAZIONE · Regole Otp: Effettuare un test OTP',

  // ── AMMINISTRAZIONE · Verifica Documenti ──
  amm_scarica_documenti: 'AMMINISTRAZIONE · Verifica Documenti: Scaricare i documenti',
  amm_inserisci_documenti_nella_scheda_cliente: 'AMMINISTRAZIONE · Verifica Documenti: Inserire i documenti nella scheda cliente',
  amm_verificare_documenti: 'AMMINISTRAZIONE · Verifica Documenti: Verificare i documenti',
  amm_far_verificare_documenti_dal_sito: 'AMMINISTRAZIONE · Verifica Documenti: Far verificare i documenti dal sito',
  amm_accettare_documenti: 'AMMINISTRAZIONE · Verifica Documenti: Accettare i documenti',
  amm_rifiutare_documenti: 'AMMINISTRAZIONE · Verifica Documenti: Rifiutare i documenti',

  // ── CENTRALINA PRO · Categorie ──
  centralina_aggiungi_categoria: 'CENTRALINA PRO · Categorie: Aggiungere una nuova categoria',
  centralina_modifica_categoria: 'CENTRALINA PRO · Categorie: Modificare una categoria',
  centralina_elimina_categoria: 'CENTRALINA PRO · Categorie: Eliminare una categoria',

  // ── CENTRALINA PRO · Fasce ──
  centralina_aggiungi_fascia: 'CENTRALINA PRO · Fasce: Aggiungere una nuova fascia',
  centralina_modifica_fascia: 'CENTRALINA PRO · Fasce: Modificare una fascia',
  centralina_rimuovi_fascia: 'CENTRALINA PRO · Fasce: Rimuovere una fascia',
  centralina_imposta_regole_fasce: 'CENTRALINA PRO · Fasce: Impostare regole per le fasce',

  // ── CENTRALINA PRO · Assicurazioni ──
  centralina_aggiungi_assicurazione: 'CENTRALINA PRO · Assicurazioni: Aggiungere una nuova assicurazione',
  centralina_modifica_assicurazione: 'CENTRALINA PRO · Assicurazioni: Modificare un\'assicurazione',
  centralina_attiva_assicurazione: 'CENTRALINA PRO · Assicurazioni: Attivare un\'assicurazione',
  centralina_disattiva_assicurazione: 'CENTRALINA PRO · Assicurazioni: Disattivare un\'assicurazione',
  centralina_on_assicurazione: 'CENTRALINA PRO · Assicurazioni: Accendere un\'assicurazione',
  centralina_off_assicurazione: 'CENTRALINA PRO · Assicurazioni: Spegnere un\'assicurazione',
  centralina_elimina_assicurazione: 'CENTRALINA PRO · Assicurazioni: Eliminare un\'assicurazione',

  // ── CENTRALINA PRO · Chilometraggi ──
  centralina_crea_chilometraggio: 'CENTRALINA PRO · Chilometraggi: Creare un nuovo chilometraggio',
  centralina_modifica_chilometraggio: 'CENTRALINA PRO · Chilometraggi: Modificare un chilometraggio',
  centralina_elimina_chilometraggio: 'CENTRALINA PRO · Chilometraggi: Eliminare un chilometraggio',

  // ── CENTRALINA PRO · Sforo Chilometrico ──
  centralina_crea_sforo: 'CENTRALINA PRO · Sforo Chilometrico: Creare un nuovo sforo',
  centralina_modifica_uno_sforo: 'CENTRALINA PRO · Sforo Chilometrico: Modificare uno sforo',
  centralina_elimina_uno_sforo: 'CENTRALINA PRO · Sforo Chilometrico: Eliminare uno sforo',
  centralina_imposta_tariffe_sforo: 'CENTRALINA PRO · Sforo Chilometrico: Impostare le tariffe di sforo',
  centralina_modifica_tariffe_sforo: 'CENTRALINA PRO · Sforo Chilometrico: Modificare le tariffe di sforo',
  centralina_aumentare_tariffe: 'CENTRALINA PRO · Sforo Chilometrico: Aumentare le tariffe',
  centralina_diminuire_tariffe: 'CENTRALINA PRO · Sforo Chilometrico: Diminuire le tariffe',

  // ── CENTRALINA PRO · Chilometri Illimitati ──
  centralina_attiva_funzionalita_chilometri_illimitati: 'CENTRALINA PRO · Chilometri Illimitati: Attivare le funzionalita\' dei chilometri illimitati',
  centralina_disattiva_funzionalita_chilometri_illimitati: 'CENTRALINA PRO · Chilometri Illimitati: Disattivare le funzionalita\' dei chilometri illimitati',

  // ── CENTRALINA PRO · Pacchetti Chilometrici ──
  centralina_crea_pacchetto_chilometrico: 'CENTRALINA PRO · Pacchetti Chilometrici: Creare un pacchetto chilometrico',
  centralina_modifica_pacchetto_chilometrico: 'CENTRALINA PRO · Pacchetti Chilometrici: Modificare un pacchetto chilometrico',
  centralina_elimina_pacchetto_chilometrico: 'CENTRALINA PRO · Pacchetti Chilometrici: Eliminare un pacchetto chilometrico',
  centralina_imposta_tariffe_pacchetti: 'CENTRALINA PRO · Pacchetti Chilometrici: Impostare le tariffe dei pacchetti',
  centralina_modifica_tariffe_pacchetti: 'CENTRALINA PRO · Pacchetti Chilometrici: Modificare le tariffe dei pacchetti',
  centralina_imposta_percentuali_sconto: 'CENTRALINA PRO · Pacchetti Chilometrici: Impostare le percentuali di sconto',
  centralina_modifica_percentuali_sconto: 'CENTRALINA PRO · Pacchetti Chilometrici: Modificare le percentuali di sconto',
  centralina_lasciare_invariate_percentuali_sconto: 'CENTRALINA PRO · Pacchetti Chilometrici: Lasciare invariate le percentuali di sconto',
  centralina_salvare_percentuali_sconto: 'CENTRALINA PRO · Pacchetti Chilometrici: Salvare le percentuali di sconto',
  centralina_applicare_pacchetto_singola_fascia: 'CENTRALINA PRO · Pacchetti Chilometrici: Applicare il pacchetto a una singola fascia',
  centralina_applicare_pacchetto_tutte_fasce: 'CENTRALINA PRO · Pacchetti Chilometrici: Applicare il pacchetto a tutte le fasce',

  // ── CENTRALINA PRO · Servizi Chilometraggio ──
  centralina_attiva_servizi_relativi_chilometraggio: 'CENTRALINA PRO · Servizi Chilometraggio: Attivare servizi relativi al chilometraggio',
  centralina_disattiva_servizi_relativi_chilometraggio: 'CENTRALINA PRO · Servizi Chilometraggio: Disattivare servizi relativi al chilometraggio',

  // ── CENTRALINA PRO · Configurazione Cauzioni ──
  centralina_aggiungi_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Aggiungere una nuova cauzione',
  centralina_modifica_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Modificare una cauzione',
  centralina_attiva_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Attivare una cauzione',
  centralina_disattiva_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Disattivare una cauzione',
  centralina_on_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Accendere una cauzione',
  centralina_off_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Spegnere una cauzione',
  centralina_elimina_cauzione: 'CENTRALINA PRO · Configurazione Cauzioni: Eliminare una cauzione',
  centralina_config_modalita_versamento: 'CENTRALINA PRO · Configurazione Cauzioni: Configurare le modalita\' di versamento',
  centralina_config_cauzioni_fascia: 'CENTRALINA PRO · Configurazione Cauzioni: Configurare le cauzioni per fascia',
  centralina_config_cauzioni_categoria_auto: 'CENTRALINA PRO · Configurazione Cauzioni: Configurare le cauzioni per categoria di auto',

  // ── CENTRALINA PRO · Servizi Extra ──
  centralina_aggiungi_servizio: 'CENTRALINA PRO · Servizi Extra: Aggiungere un nuovo servizio',
  centralina_modifica_servizio: 'CENTRALINA PRO · Servizi Extra: Modificare un servizio',
  centralina_elimina_servizio: 'CENTRALINA PRO · Servizi Extra: Eliminare un servizio',
  centralina_attiva_servizio: 'CENTRALINA PRO · Servizi Extra: Attivare un servizio',
  centralina_disattiva_servizio: 'CENTRALINA PRO · Servizi Extra: Disattivare un servizio',
  centralina_on_servizio: 'CENTRALINA PRO · Servizi Extra: Accendere un servizio',
  centralina_off_servizio: 'CENTRALINA PRO · Servizi Extra: Spegnere un servizio',

  // ── CENTRALINA PRO · Prezzo Dinamico ──
  centralina_crea_prezzo_dinamico: 'CENTRALINA PRO · Prezzo Dinamico: Creare un nuovo prezzo dinamico',
  centralina_modifica_prezzo_dinamico: 'CENTRALINA PRO · Prezzo Dinamico: Modificare un prezzo dinamico',
  centralina_cancellare_prezzo_dinamico: 'CENTRALINA PRO · Prezzo Dinamico: Cancellare un prezzo dinamico',
  centralina_elimina_prezzo_dinamico: 'CENTRALINA PRO · Prezzo Dinamico: Eliminare un prezzo dinamico',
  centralina_imposta_prezzo_base: 'CENTRALINA PRO · Prezzo Dinamico: Impostare il prezzo base',
  centralina_imposta_prezzo_minimo: 'CENTRALINA PRO · Prezzo Dinamico: Impostare il prezzo minimo',
  centralina_imposta_prezzo_massimo: 'CENTRALINA PRO · Prezzo Dinamico: Impostare il prezzo massimo',

  // ── CENTRALINA PRO · Coefficienti Dinamici ──
  centralina_crea_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Creare un nuovo coefficiente dinamico',
  centralina_nominare_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Nominare un coefficiente dinamico',
  centralina_modifica_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Modificare un coefficiente dinamico esistente',
  centralina_elimina_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Eliminare un coefficiente dinamico',
  centralina_aggiungi_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Aggiungere un coefficiente dinamico',
  centralina_togliere_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Togliere un coefficiente dinamico',
  centralina_attiva_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Attivare un coefficiente dinamico',
  centralina_disattiva_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Disattivare un coefficiente dinamico',
  centralina_on_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Accendere un coefficiente dinamico',
  centralina_off_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Spegnere un coefficiente dinamico',
  centralina_config_impostazioni_coefficiente_dinamico: 'CENTRALINA PRO · Coefficienti Dinamici: Configurare le impostazioni del coefficiente dinamico',

  // ── CENTRALINA PRO · Configurazione Preventivi ──
  centralina_seleziona_maggiorazione_preventivo: 'CENTRALINA PRO · Configurazione Preventivi: Selezionare la maggiorazione del preventivo',
  centralina_imposta_scadenza_predefinita: 'CENTRALINA PRO · Configurazione Preventivi: Impostare la scadenza predefinita',
  centralina_config_l_invio_preventivo: 'CENTRALINA PRO · Configurazione Preventivi: Configurare l\'invio del preventivo',
  centralina_attiva_richieste_preventivo_l_admin_provenient: 'CENTRALINA PRO · Configurazione Preventivi: Attivare le richieste preventivo per l\'Admin provenienti dal sito',
  centralina_disattiva_richieste_preventivo_l_admin_proveni: 'CENTRALINA PRO · Configurazione Preventivi: Disattivare le richieste preventivo per l\'Admin provenienti dal sito',

  // ── CENTRALINA PRO · Catalogo Danni ──
  centralina_imposta_catalogo_danni_categoria_auto: 'CENTRALINA PRO · Catalogo Danni: Impostare un catalogo danni per ogni categoria di auto',
  centralina_aggiungi_danno: 'CENTRALINA PRO · Catalogo Danni: Aggiungere un nuovo danno',
  centralina_modifica_danno: 'CENTRALINA PRO · Catalogo Danni: Modificare un danno esistente',
  centralina_elimina_danno: 'CENTRALINA PRO · Catalogo Danni: Eliminare un danno esistente',
  centralina_cambiare_nome_danno: 'CENTRALINA PRO · Catalogo Danni: Cambiare il nome del danno',
  centralina_cambiare_l_importo_danno: 'CENTRALINA PRO · Catalogo Danni: Cambiare l\'importo del danno',

  // ── CENTRALINA PRO · Catalogo Penali ──
  centralina_imposta_catalogo_penali_categoria_auto: 'CENTRALINA PRO · Catalogo Penali: Impostare un catalogo penali per ogni categoria di auto',
  centralina_aggiungi_penale: 'CENTRALINA PRO · Catalogo Penali: Aggiungere una nuova penale',
  centralina_modifica_penale: 'CENTRALINA PRO · Catalogo Penali: Modificare una penale esistente',
  centralina_elimina_penale: 'CENTRALINA PRO · Catalogo Penali: Eliminare una penale esistente',
  centralina_cambiare_nome_penale: 'CENTRALINA PRO · Catalogo Penali: Cambiare il nome della penale',
  centralina_cambiare_l_importo_penale: 'CENTRALINA PRO · Catalogo Penali: Cambiare l\'importo della penale',

  // ── CENTRALINA PRO · Configurazione Fiscale Iva ──
  centralina_seleziona_l_aliquota_iva: 'CENTRALINA PRO · Configurazione Fiscale Iva: Selezionare l\'aliquota IVA',
  centralina_modifica_l_aliquota_iva: 'CENTRALINA PRO · Configurazione Fiscale Iva: Modificare l\'aliquota IVA',

  // ── CENTRALINA PRO · Fatturazione ──
  centralina_seleziona_quali_operazioni_devono_genera_fattu: 'CENTRALINA PRO · Fatturazione: Selezionare quali operazioni devono generare fattura',
  centralina_seleziona_quali_operazioni_non_devono_genera_f: 'CENTRALINA PRO · Fatturazione: Selezionare quali operazioni non devono generare fattura',
  centralina_attiva_fattura_determinato_metodo_pagamento: 'CENTRALINA PRO · Fatturazione: Attivare la fattura su un determinato metodo di pagamento',
  centralina_disattiva_fattura_determinato_metodo_pagamento: 'CENTRALINA PRO · Fatturazione: Disattivare la fattura su un determinato metodo di pagamento',
  centralina_annullare_fatturazione_determinato_metodo_paga: 'CENTRALINA PRO · Fatturazione: Annullare la fatturazione su un determinato metodo di pagamento',

  // ── CENTRALINA PRO · Metodi Di Pagamento ──
  centralina_aggiungi_metodo_pagamento: 'CENTRALINA PRO · Metodi Di Pagamento: Aggiungere un metodo di pagamento',
  centralina_modifica_metodo_pagamento: 'CENTRALINA PRO · Metodi Di Pagamento: Modificare un metodo di pagamento',
  centralina_elimina_metodo_pagamento: 'CENTRALINA PRO · Metodi Di Pagamento: Eliminare un metodo di pagamento',
  centralina_attiva_metodo_pagamento: 'CENTRALINA PRO · Metodi Di Pagamento: Attivare un metodo di pagamento',
  centralina_disattiva_metodo_pagamento: 'CENTRALINA PRO · Metodi Di Pagamento: Disattivare un metodo di pagamento',
  centralina_seleziona_metodi_pagamento_accettati: 'CENTRALINA PRO · Metodi Di Pagamento: Selezionare i metodi di pagamento accettati',
  centralina_seleziona_metodi_pagamento_non_accettati: 'CENTRALINA PRO · Metodi Di Pagamento: Selezionare i metodi di pagamento non accettati',
  centralina_seleziona_quali_metodi_pagamento_generano_fatt: 'CENTRALINA PRO · Metodi Di Pagamento: Selezionare quali metodi di pagamento generano fattura',

  // ── CENTRALINA PRO · Dr7 Club Tier Cashback ──
  centralina_aggiungi_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Aggiungere un nuovo Tier Cashback',
  centralina_modifica_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Modificare un Tier Cashback esistente',
  centralina_elimina_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Eliminare un Tier Cashback',
  centralina_attiva_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Attivare un Tier Cashback',
  centralina_disattiva_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Disattivare un Tier Cashback',
  centralina_on_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Accendere un Tier Cashback',
  centralina_off_tier_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Spegnere un Tier Cashback',
  centralina_preimposta_cashback_fascia_dr7_club: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Preimpostare il cashback per ogni fascia DR7 Club',
  centralina_config_cashback_base_alla_spesa_cliente: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Configurare il cashback in base alla spesa del cliente',
  centralina_modifica_percentuale_cashback: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Modificare la percentuale di cashback',
  centralina_config_soglie_spesa: 'CENTRALINA PRO · Dr7 Club Tier Cashback: Configurare le soglie di spesa',

  // ── CENTRALINA PRO · Automazioni Buffer ──
  centralina_inserisci_buffer_post_noleggio: 'CENTRALINA PRO · Automazioni Buffer: Inserire un buffer post noleggio',
  centralina_inserisci_buffer_tra_veicoli_diversi: 'CENTRALINA PRO · Automazioni Buffer: Inserire un buffer tra veicoli diversi',
  centralina_inserisci_buffer_pre_pickup_veicoli_lavaggio: 'CENTRALINA PRO · Automazioni Buffer: Inserire un buffer pre-pickup dei veicoli in lavaggio',
  centralina_modifica_buffer: 'CENTRALINA PRO · Automazioni Buffer: Modificare un buffer',
  centralina_elimina_buffer: 'CENTRALINA PRO · Automazioni Buffer: Eliminare un buffer',
  centralina_attiva_buffer: 'CENTRALINA PRO · Automazioni Buffer: Attivare un buffer',
  centralina_disattiva_buffer: 'CENTRALINA PRO · Automazioni Buffer: Disattivare un buffer',

  // ── CENTRALINA PRO · Regole Di Cancellazione ──
  centralina_aggiungi_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Aggiungere una regola di cancellazione',
  centralina_modifica_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Modificare una regola di cancellazione esistente',
  centralina_elimina_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Eliminare una regola di cancellazione',
  centralina_attiva_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Attivare una regola di cancellazione',
  centralina_disattiva_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Disattivare una regola di cancellazione',
  centralina_on_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Accendere una regola di cancellazione',
  centralina_off_regola_cancellazione: 'CENTRALINA PRO · Regole Di Cancellazione: Spegnere una regola di cancellazione',

  // ── CENTRALINA PRO · Ritardi ──
  centralina_inserisci_grace_period_ritardo_riconsegna: 'CENTRALINA PRO · Ritardi: Inserire una Grace Period per il ritardo di riconsegna',
  centralina_modifica_grace_period: 'CENTRALINA PRO · Ritardi: Modificare la Grace Period',
  centralina_elimina_grace_period: 'CENTRALINA PRO · Ritardi: Eliminare la Grace Period',
  centralina_attiva_grace_period: 'CENTRALINA PRO · Ritardi: Attivare la Grace Period',
  centralina_disattiva_grace_period: 'CENTRALINA PRO · Ritardi: Disattivare la Grace Period',

  // ── CENTRALINA PRO · Blocchi Prenotazioni Lavaggio ──
  centralina_bloccare_prenotazioni_dal_giorno_giorno: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Bloccare le prenotazioni dal giorno al giorno',
  centralina_bloccare_prenotazioni_orario: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Bloccare le prenotazioni per orario',
  centralina_bloccare_prenotazioni_sezione: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Bloccare le prenotazioni per sezione',
  centralina_bloccare_prenotazioni_singoli_giorni: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Bloccare le prenotazioni per singoli giorni',
  centralina_bloccare_prenotazioni_periodi_tempo: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Bloccare le prenotazioni per periodi di tempo',
  centralina_modifica_blocco: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Modificare un blocco',
  centralina_elimina_blocco: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Eliminare un blocco',
  centralina_attiva_blocco: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Attivare un blocco',
  centralina_disattiva_blocco: 'CENTRALINA PRO · Blocchi Prenotazioni Lavaggio: Disattivare un blocco',

  // ── CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici ──
  centralina_includere_servizio_nei_coefficienti_dinamici: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Includere un servizio nei coefficienti dinamici',
  centralina_escludere_servizio_dai_coefficienti_dinamici: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Escludere un servizio dai coefficienti dinamici',
  centralina_seleziona_quali_servizi_sono_soggetti_sconti: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Selezionare quali servizi sono soggetti a sconti',
  centralina_seleziona_quali_servizi_sono_soggetti_ad_aumen: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Selezionare quali servizi sono soggetti ad aumenti',
  centralina_seleziona_quali_servizi_devono_essere_pagati_p: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Selezionare quali servizi devono essere pagati a prezzo pieno',
  centralina_attiva_l_inclusione_nei_coefficienti_dinamici: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Attivare l\'inclusione nei coefficienti dinamici',
  centralina_disattiva_l_inclusione_nei_coefficienti_dinami: 'CENTRALINA PRO · Inclusione Nei Coefficienti Dinamici: Disattivare l\'inclusione nei coefficienti dinamici',

  // ── CENTRALINA PRO · Orari Noleggio ──
  centralina_config_orari_noleggio: 'CENTRALINA PRO · Orari Noleggio: Configurare gli orari di noleggio',
  centralina_aggiungi_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Aggiungere una nuova finestra oraria',
  centralina_modifica_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Modificare una finestra oraria esistente',
  centralina_elimina_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Eliminare una finestra oraria',
  centralina_attiva_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Attivare una finestra oraria',
  centralina_disattiva_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Disattivare una finestra oraria',
  centralina_on_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Accendere una finestra oraria',
  centralina_off_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Spegnere una finestra oraria',
  centralina_chiudere_finestra_oraria: 'CENTRALINA PRO · Orari Noleggio: Chiudere una finestra oraria',
  centralina_seleziona_giorni_apertura: 'CENTRALINA PRO · Orari Noleggio: Selezionare i giorni di apertura',
  centralina_seleziona_giorni_chiusura: 'CENTRALINA PRO · Orari Noleggio: Selezionare i giorni di chiusura',
  centralina_config_autonomamente_giorni_aperti: 'CENTRALINA PRO · Orari Noleggio: Configurare autonomamente i giorni aperti',
  centralina_config_autonomamente_giorni_chiusi: 'CENTRALINA PRO · Orari Noleggio: Configurare autonomamente i giorni chiusi',

  // ── CENTRALINA PRO · Orari Lavaggio ──
  centralina_config_orari_lavaggio: 'CENTRALINA PRO · Orari Lavaggio: Configurare gli orari di lavaggio',
  centralina_aggiungi_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Aggiungere una nuova finestra oraria',
  centralina_modifica_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Modificare una finestra oraria esistente',
  centralina_elimina_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Eliminare una finestra oraria',
  centralina_attiva_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Attivare una finestra oraria',
  centralina_disattiva_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Disattivare una finestra oraria',
  centralina_on_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Accendere una finestra oraria',
  centralina_off_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Spegnere una finestra oraria',
  centralina_chiudere_finestra_oraria_2: 'CENTRALINA PRO · Orari Lavaggio: Chiudere una finestra oraria',
  centralina_seleziona_giorni_apertura_2: 'CENTRALINA PRO · Orari Lavaggio: Selezionare i giorni di apertura',
  centralina_seleziona_giorni_chiusura_2: 'CENTRALINA PRO · Orari Lavaggio: Selezionare i giorni di chiusura',
  centralina_config_autonomamente_giorni_aperti_2: 'CENTRALINA PRO · Orari Lavaggio: Configurare autonomamente i giorni aperti',
  centralina_config_autonomamente_giorni_chiusi_2: 'CENTRALINA PRO · Orari Lavaggio: Configurare autonomamente i giorni chiusi',
  centralina_bloccare_determinate_fasce_orarie: 'CENTRALINA PRO · Orari Lavaggio: Bloccare determinate fasce orarie',
  centralina_bloccare_determinati_periodi_tempo: 'CENTRALINA PRO · Orari Lavaggio: Bloccare determinati periodi di tempo',
  centralina_bloccare_giorni_specifici: 'CENTRALINA PRO · Orari Lavaggio: Bloccare giorni specifici',

  // ── DR7 TRUST · Documenti ──
  trust_invia_nuovi_documenti: 'DR7 TRUST · Documenti: Inviare nuovi documenti',
  trust_elimina_documenti_firmati: 'DR7 TRUST · Documenti: Eliminare documenti gia\' firmati',

  // ── ALLARMI · Attiva Allarmi ──
  allarmi_attiva_allarmi: 'ALLARMI · Attiva Allarmi: Attivare gli allarmi',
  allarmi_disattiva_allarmi: 'ALLARMI · Attiva Allarmi: Disattivare gli allarmi',

  // ── ALLARMI · Impostazioni Allarmi ──
  allarmi_gestire_allarmi: 'ALLARMI · Impostazioni Allarmi: Gestire gli allarmi',
  allarmi_scegliere_quando_deve_suonare_allarme: 'ALLARMI · Impostazioni Allarmi: Scegliere quando deve suonare un allarme',
  allarmi_scegliere_quanto_tempo_prima_deve_suonare: 'ALLARMI · Impostazioni Allarmi: Scegliere quanto tempo prima deve suonare',
  allarmi_scegliere_quale_evento_deve_suonare: 'ALLARMI · Impostazioni Allarmi: Scegliere per quale evento deve suonare',
  allarmi_crea_allarme: 'ALLARMI · Impostazioni Allarmi: Creare un nuovo allarme',
  allarmi_modifica_allarme: 'ALLARMI · Impostazioni Allarmi: Modificare un allarme esistente',
  allarmi_elimina_allarme: 'ALLARMI · Impostazioni Allarmi: Eliminare un allarme',
  allarmi_on_allarme: 'ALLARMI · Impostazioni Allarmi: Accendere un allarme',
  allarmi_off_allarme: 'ALLARMI · Impostazioni Allarmi: Spegnere un allarme',
  allarmi_attiva_allarme: 'ALLARMI · Impostazioni Allarmi: Attivare un allarme',
  allarmi_disattiva_allarme: 'ALLARMI · Impostazioni Allarmi: Disattivare un allarme',

  // ── I MIEI ORARI · I Miei Orari ──
  orari_inserisci_l_orario_entrata: 'I MIEI ORARI · I Miei Orari: Inserire l\'orario di entrata',
  orari_inserisci_l_orario_uscita: 'I MIEI ORARI · I Miei Orari: Inserire l\'orario di uscita',
  orari_aggiungi_pausa: 'I MIEI ORARI · I Miei Orari: Aggiungere una pausa',
  orari_elimina_pausa: 'I MIEI ORARI · I Miei Orari: Eliminare una pausa',
  orari_modifica_pausa: 'I MIEI ORARI · I Miei Orari: Modificare una pausa',
  orari_inserisci_note_operative: 'I MIEI ORARI · I Miei Orari: Inserire note operative',
  orari_modifica_orari_esistenti: 'I MIEI ORARI · I Miei Orari: Modificare gli orari gia\' esistenti',
  orari_modifica_orari_inseriti: 'I MIEI ORARI · I Miei Orari: Modificare gli orari gia\' inseriti',
  orari_salvare_orari: 'I MIEI ORARI · I Miei Orari: Salvare gli orari',
  orari_chiudere_salvare_orari: 'I MIEI ORARI · I Miei Orari: Chiudere e salvare gli orari',

  // ── ACCOUNT · Password ──
  account_cambiare_password_profilo_admin: 'ACCOUNT · Password: Cambiare la password del profilo Admin',

  // ── ACCOUNT · Esci ──
  account_uscire_dal_profilo_admin: 'ACCOUNT · Esci: Uscire dal profilo Admin',
  account_terminare_sessione: 'ACCOUNT · Esci: Terminare la sessione',
  account_effettuare_nuovamente_l_accesso: 'ACCOUNT · Esci: Effettuare nuovamente l\'accesso',
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

  // ── Annullamenti & Rimborsi ───────────────────────────────────
  // SLOT SEPARATI per chi cancella:
  //   pro_annullamento_admin    -> ticka evento 'booking_cancelled_whatsapp' in Eventi gestiti
  //   pro_annullamento_cliente  -> ticka evento 'website_booking_cancelled_customer'
  // Le LABEL_FALLBACKS non sono piu' usate dal resolver (2026-05-19) ma
  // restano qui come documentazione del naming atteso per le label admin.
  pro_annullamento_admin: [
    ['annullament', 'admin'],
    ['annullato', 'admin'],
    ['annullament', 'manuale'],
  ],
  pro_annullamento_cliente: [
    ['annullament', 'sito'],
    ['annullat', 'sito'],
    ['annullato', 'cliente'],
    ['website', 'cancel'],
  ],
  pro_rimborso_iniziato: [
    ['rimborso', 'iniziat'],
    ['rimborso', 'avviat'],
    ['rimborso', 'in', 'corso'],
    ['refund', 'started'],
    ['refund', 'initiated'],
  ],
  pro_rimborso_completato: [
    ['rimborso', 'completat'],
    ['rimborso', 'effettuat'],
    ['rimborso', 'erogat'],
    ['refund', 'completed'],
    ['refund', 'done'],
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

  // Prime Wash — auto pronta / lavaggio concluso
  pro_auto_pronta: [
    ['lavaggio', 'conclus'],
    ['lavaggio', 'finit'],
    ['lavaggio', 'pronto'],
    ['auto', 'pronta'],
    ['servizio', 'conclus'],
    ['servizio', 'pronto'],
    ['ready'],
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

/**
 * Trigger presenti nel catalogo ma NON ancora emessi da nessun punto del
 * codice (aggiunti il 2026-08-09). Restano selezionabili — la direzione deve
 * poter preparare il messaggio prima che l'evento esista — ma l'interfaccia li
 * marca "da collegare" cosi' nessuno crea un automatismo credendolo attivo.
 *
 * Togliere la chiave da qui quando l'emissione viene aggiunta nel codice.
 */
export const PENDING_EVENTS: ReadonlySet<string> = new Set([
  // 2026-08-10 COLLEGATI (rimossi da questa lista): boat_new_customer e
  // boat_modified partono da MareBookingModal.save(); heli_new_customer e
  // stay_new_customer da NoleggioServiceTab.saveBooking. In piu'
  // send-whatsapp-notification ora deriva le chiavi per boat/heli/stay dal
  // service_type invece di schiacciare tutto su 'rental'.
  // 2026-08-14 COLLEGATI (rimossi da questa lista): boat_pronto, heli_pronto e
  // stay_pronto partono dal menu Gestisci di Mare/Aria/Soggiorni, azione
  // "Mezzo/Velivolo/Struttura Pronto" (useBookingRowActions.segnalaPronto).
  'boat_new_admin', 'boat_cancelled', 'boat_da_saldare_customer',
  'heli_new_admin', 'heli_cancelled', 'heli_da_saldare_customer',
  'stay_new_admin', 'stay_cancelled', 'stay_da_saldare_customer',
  'fattura_generata_customer', 'fattura_inviata_customer', 'nota_credito_emessa_customer',
  'fattura_sdi_accettata_admin', 'fattura_sdi_rifiutata_admin',
  'multa_conducente_identificato_admin', 'multa_pec_inviata_admin', 'multa_notifica_cliente',
  'magazzino_ordine_fornitore',

  // 2026-08-14 (roadmap #44): le 560 azioni del file trigger che cambiano
  // uno stato. Nessuna e' ancora emessa dal codice.
  'terra_invia_test_meteo', 'terra_gestire_prenotazione', 'terra_gestire_danni', 'terra_gestire_penali',
  'terra_crea_preventivo', 'terra_modifica_preventivo', 'terra_invia_preventivo', 'terra_accettare_preventivo',
  'terra_rifiutare_preventivo', 'terra_cambiare_preventivo', 'terra_esportare_preventivi', 'terra_aggiungi_uscita_straordinaria',
  'terra_invia_test_meteo_2', 'terra_modifica_uscita_straordinaria', 'terra_gestire_uscita_straordinaria', 'terra_modifica_prenotazioni_esistenti',
  'terra_verificare_tutti_veicoli_disponibili', 'terra_nascondere_fatturato', 'terra_mostrare_fatturato', 'contratti_carica_versione_contratto',
  'contratti_rigenera_contratto', 'contratti_modifica_contratto', 'contratti_elimina_contratto', 'contratti_elimina_prenotazione_collegata',
  'danni_modifica_penali', 'danni_elimina_penali', 'danni_modifica_danni', 'danni_elimina_danni',
  'multe_aggiornare_storico_pec', 'multe_carica_documento', 'multe_analizzare_documento', 'cargos_scarica_file',
  'cargos_gestire_impostazioni', 'cargos_validare_contratti', 'cargos_invia_piu_contratti_contemporaneamente_cargos', 'veicoli_modifica_targa',
  'veicoli_modifica_numero_telaio', 'veicoli_modifica_chilometraggio', 'veicoli_modifica_cavalli', 'veicoli_modifica_l_anno',
  'veicoli_modifica_dato_accelerazione_0_100_km_h', 'veicoli_inserisci_tagliando', 'veicoli_modifica_tagliando', 'veicoli_inserisci_l_intervallo_tagliando',
  'veicoli_modifica_l_intervallo_tagliando', 'veicoli_inserisci_specifiche_gomme_anteriori', 'veicoli_inserisci_specifiche_gomme_posteriori', 'veicoli_modifica_specifiche_gomme_anteriori',
  'veicoli_modifica_specifiche_gomme_posteriori', 'veicoli_inserisci_intervalli_relativi_gomme', 'veicoli_modifica_intervalli_relativi_gomme', 'veicoli_inserisci_dati_pastiglie_anteriori',
  'veicoli_inserisci_dati_pastiglie_posteriori', 'veicoli_modifica_dati_pastiglie_anteriori', 'veicoli_modifica_dati_pastiglie_posteriori', 'veicoli_inserisci_intervalli_relativi_pastiglie',
  'veicoli_modifica_intervalli_relativi_pastiglie', 'veicoli_inserisci_scadenze_amministrative', 'veicoli_modifica_scadenze_amministrative', 'veicoli_inserisci_qualsiasi_altra_scadenza_relativa_ve',
  'veicoli_inserisci_attivita_effettuate_sul_veicolo', 'veicoli_inserisci_manutenzioni_effettuate', 'veicoli_inserisci_lavori_effettuati', 'veicoli_inserisci_foto_auto',
  'magazzino_inserisci_materiale', 'magazzino_inserisci_quantita_disponibile', 'magazzino_aggiornare_quantita_disponibile', 'magazzino_inserisci_quantita_utilizzata',
  'magazzino_aggiungi_merce', 'magazzino_togliere_merce', 'magazzino_gestire_materiale_utilizzato_manutenzione_auto', 'magazzino_aggiungi_materiale_carrello',
  'magazzino_aggiungi_materiale_ordine', 'magazzino_rimuovi_articoli_dal_carrello', 'magazzino_genera_ordine', 'magazzino_aggiungi_fornitore',
  'magazzino_modifica_fornitore', 'magazzino_elimina_fornitore', 'mare_invia_test_meteo', 'mare_gestire_prenotazione',
  'mare_estendere_prenotazione', 'mare_invia_contratto', 'mare_gestire_danni', 'mare_gestire_penali',
  'mare_crea_preventivo', 'mare_modifica_preventivo', 'mare_invia_preventivo', 'mare_accettare_preventivo',
  'mare_rifiutare_preventivo', 'mare_cambiare_preventivo', 'mare_esportare_preventivi', 'mare_accettare_richiesta_no_cauzione',
  'mare_rifiutare_richiesta_no_cauzione', 'mare_aggiungi_uscita_straordinaria', 'mare_invia_test_meteo_2', 'mare_modifica_uscita_straordinaria',
  'mare_gestire_uscita_straordinaria', 'mare_modifica_prenotazioni_esistenti', 'mare_verificare_tutti_mezzi_disponibili', 'mare_nascondere_fatturato',
  'mare_mostrare_fatturato', 'aria_invia_allerta_meteo', 'aria_invia_test_meteo', 'aria_gestire_prenotazione',
  'aria_estendere_prenotazione', 'aria_invia_contratto', 'aria_gestire_danni', 'aria_gestire_penali',
  'aria_crea_preventivo', 'aria_modifica_preventivo', 'aria_invia_preventivo', 'aria_accettare_preventivo',
  'aria_rifiutare_preventivo', 'aria_cambiare_preventivo', 'aria_esportare_preventivi', 'aria_accettare_richiesta_no_cauzione',
  'aria_rifiutare_richiesta_no_cauzione', 'aria_aggiungi_uscita_straordinaria', 'aria_invia_allerta_meteo_2', 'aria_invia_test_meteo_2',
  'aria_modifica_uscita_straordinaria', 'aria_gestire_uscita_straordinaria', 'aria_modifica_prenotazioni_esistenti', 'aria_verificare_tutti_velivoli_disponibili',
  'aria_nascondere_fatturato', 'aria_mostrare_fatturato', 'soggiorni_invia_allerta_meteo', 'soggiorni_invia_test_meteo',
  'soggiorni_gestire_prenotazione', 'soggiorni_estendere_prenotazione', 'soggiorni_invia_contratto', 'soggiorni_gestire_danni',
  'soggiorni_gestire_penali', 'soggiorni_crea_preventivo', 'soggiorni_modifica_preventivo', 'soggiorni_invia_preventivo',
  'soggiorni_accettare_preventivo', 'soggiorni_rifiutare_preventivo', 'soggiorni_cambiare_preventivo', 'soggiorni_esportare_preventivi',
  'soggiorni_accettare_richiesta_no_cauzione', 'soggiorni_rifiutare_richiesta_no_cauzione', 'soggiorni_aggiungi_servizio_straordinario', 'soggiorni_invia_allerta_meteo_2',
  'soggiorni_invia_test_meteo_2', 'soggiorni_modifica_servizio_straordinario', 'soggiorni_gestire_servizio_straordinario', 'soggiorni_modifica_prenotazioni_esistenti',
  'soggiorni_verificare_tutte_strutture_o_disponibilita', 'soggiorni_nascondere_fatturato', 'soggiorni_mostrare_fatturato', 'lavaggio_invia_fattura',
  'lavaggio_elimina_prenotazione', 'lavaggio_modifica_prenotazioni_esistenti', 'lavaggio_aggiungi_prenotazione', 'lavaggio_mostrare_fatturato',
  'lavaggio_nascondere_fatturato', 'lavaggio_inserisci_servizio_lavaggio', 'lavaggio_modifica_servizio_lavaggio', 'lavaggio_inserisci_descrizione',
  'lavaggio_modifica_descrizione', 'lavaggio_salvare_descrizione', 'lavaggio_inserisci_foto', 'lavaggio_modifica_foto',
  'lavaggio_salvare_foto', 'lavaggio_cambiare_prezzi', 'lavaggio_cambiare_durate', 'lavaggio_modifica_durate',
  'lavaggio_salvare_modifiche', 'lavaggio_aggiungi_extra', 'lavaggio_modifica_extra', 'lavaggio_elimina_extra',
  'lavaggio_aggiungi_sezione', 'lavaggio_modifica_sezione', 'lavaggio_elimina_sezione', 'lavaggio_aggiungi_auto_cortesia',
  'lavaggio_modifica_auto_cortesia', 'lavaggio_elimina_auto_cortesia', 'lavaggio_modifica_servizi_relativi_singola_auto_cortesi', 'clienti_rimuovi_duplicati',
  'clienti_esportare_tutti_clienti', 'clienti_importare_link_con_lead_salvate', 'clienti_invia_link_autoregistrazione_cliente', 'clienti_crea_cliente',
  'clienti_crea_persona_fisica', 'clienti_crea_azienda', 'clienti_crea_pubblica_amministrazione', 'clienti_inserisci_documenti_tramite_file',
  'clienti_inserisci_documenti_tramite_foto', 'clienti_compilare_manualmente_dati', 'clienti_calcolare_codice_fiscale', 'clienti_calcolare_dati_anagrafici_partendo_dal_codice_',
  'clienti_compilare_automaticamente_campi_tramite_foto_d', 'clienti_carica_file_documenti', 'clienti_salvare_cliente', 'clienti_copiare_contatto',
  'clienti_invia_messaggio_tramite_whatsapp', 'clienti_chiamare_cliente', 'clienti_modifica_tutta_scheda_cliente_compilata', 'clienti_salvare_modifiche',
  'clienti_trasformare_lead_cliente_anche_autista', 'clienti_aggiungi_status_autista', 'clienti_rimuovi_cliente_dalla_blacklist', 'clienti_rimuovi_status_member',
  'clienti_rimuovi_status_elite', 'clienti_addebitare_crediti_dal_wallet', 'marketing_reinvia_messaggio_compleanno', 'marketing_reinvia_richiesta_recensione',
  'marketing_bloccare_cliente', 'marketing_sbloccare_cliente', 'marketing_approvare_cliente_richiesta_recensione', 'marketing_escludere_cliente_dalla_richiesta_recensione',
  'marketing_invia_alla_valutazione_direzione_clienti_hanno', 'marketing_invia_alla_valutazione_direzione_clienti_hanno_2', 'marketing_invia_alla_valutazione_direzione_clienti_hanno_3', 'marketing_crea_messaggio_sistema',
  'marketing_modifica_messaggio_sistema', 'marketing_elimina_messaggio_sistema', 'marketing_invia_messaggio_manualmente', 'marketing_on_messaggio_generico_creato',
  'marketing_off_messaggio_generico_creato', 'marketing_imposta_messaggio_come_automatico', 'marketing_imposta_messaggio_come_manuale', 'marketing_imposta_cron_on',
  'marketing_imposta_cron_off', 'marketing_attiva_header', 'marketing_disattiva_header', 'marketing_attiva_footer',
  'marketing_disattiva_footer', 'marketing_attiva_invio_tramite_email', 'marketing_disattiva_invio_tramite_email', 'marketing_crea_campagna_marketing',
  'marketing_programmare_campagna_marketing', 'marketing_aggiungi_file_multimediale', 'marketing_aggiungi_video', 'marketing_programmare_l_invio',
  'marketing_invia_immediatamente', 'marketing_invia_50_clienti', 'marketing_invia_100_clienti', 'marketing_invia_250_clienti',
  'marketing_invia_500_clienti', 'marketing_invia_tutti_clienti', 'marketing_includere_solo_determinate_sezioni_o_categorie', 'marketing_escludere_determinate_sezioni_o_categorie_clie',
  'marketing_aggiungi_link_social', 'marketing_modifica_link_social', 'marketing_elimina_link_social', 'marketing_genera_codice_sconto',
  'marketing_modifica_codice_sconto', 'marketing_attiva_codice_sconto', 'marketing_disattiva_codice_sconto', 'marketing_crea_qr_code',
  'marketing_copiare_codice_sconto', 'report_aggiornare_report', 'report_aggiornare_report_2', 'report_genera_report_spese_clienti',
  'report_classificare_clienti', 'report_ordinare_clienti', 'report_categorizzare_preventivi', 'report_analizzare_dati_preventivi',
  'amm_segnare_pagamento_come_pagato', 'amm_inserisci_l_importo_pagato', 'amm_invia_link_pagamento_parziale', 'amm_addebitare_carta_tokenizzata',
  'amm_registrare_pagamento_parziale', 'amm_parzializzare_pagamento', 'amm_modifica_l_importo_pagamento', 'amm_elimina_pagamento',
  'amm_modifica_cauzione', 'amm_segnare_cauzione_come_incassare', 'amm_segnare_cauzione_come_incassata', 'amm_inserisci_cauzione_cassa',
  'amm_restituire_cauzione_prima_dell_incasso', 'amm_invia_link_preautorizzare_cauzione', 'amm_incassare_cauzione', 'amm_imposta_scadenza',
  'amm_aggiungi_scadenza', 'amm_modifica_scadenza', 'amm_elimina_scadenza', 'amm_scarica_fattura',
  'amm_copiare_fattura', 'amm_inoltrare_fattura', 'amm_modifica_fattura', 'amm_scarica_pdf',
  'amm_verificare_stato_sdi', 'amm_segnare_fattura_come_non_pagata', 'amm_elimina_fattura', 'amm_genera_report_totale_operatori',
  'amm_effettuare_rilevazione_orari_giornalieri', 'amm_carica_buste_paga_operatore', 'amm_verificare_contratti_operatore', 'amm_crea_contratti_operatore',
  'amm_assegnare_permessi_operatore', 'amm_rimuovi_permessi_operatore', 'amm_assegnare_uno_status_operatore_maggiore', 'amm_assegnare_uno_status_operatore_minore',
  'amm_modifica_status_operatore', 'amm_modifica_livello_autorizzazione', 'amm_aggiungi_calendario', 'amm_crea_giornate',
  'amm_aggiungi_ritiro', 'amm_imposta_giornata_fissa_ritiro', 'amm_imposta_orario_fisso_ritiro', 'amm_modifica_giornata',
  'amm_modifica_ritiro', 'amm_elimina_giornata', 'amm_elimina_ritiro', 'amm_seleziona_destinatari',
  'amm_seleziona_reparto', 'amm_scrivere_l_oggetto', 'amm_inserisci_priorita', 'amm_inserisci_numero_telefono',
  'amm_carica_file', 'amm_invia_ticket', 'amm_annullare_ticket', 'amm_invia_messaggio_ticket_tramite_whatsapp',
  'amm_gestire_destinatari', 'amm_aggiungi_fornitore', 'amm_modifica_fornitore', 'amm_elimina_fornitore',
  'amm_carica_bolle', 'amm_carica_bolla_senza_fattura', 'amm_carica_documenti_fattura_ricevuta', 'amm_eseguire_controllo_incrociato_fatture',
  'amm_richiedere_accesso_tp_approvazione_fatture', 'amm_richiedere_accesso_tp_approvazione_pagamento', 'amm_aggiornare_fatture', 'amm_effettuare_pagamento',
  'amm_preautorizzare_pagamento', 'amm_elimina_carta_tokenizzata', 'amm_addebitare_carta_tokenizzata_2', 'amm_verificare_canali_notifica_otp',
  'amm_modifica_canali_notifica_direzione', 'amm_config_destinatari_notifiche_otp', 'amm_aggiungi_regola_otp', 'amm_modifica_regola_otp',
  'amm_attiva_regola_otp', 'amm_disattiva_regola_otp', 'amm_elimina_regola_otp', 'amm_elimina_blocco_otp_regola',
  'amm_segnalare_nuove_uscite_otp', 'amm_segnalare_nuove_regole_otp', 'amm_invia_anteprima_otp', 'amm_effettuare_test_otp',
  'amm_scarica_documenti', 'amm_inserisci_documenti_nella_scheda_cliente', 'amm_verificare_documenti', 'amm_far_verificare_documenti_dal_sito',
  'amm_accettare_documenti', 'amm_rifiutare_documenti', 'centralina_aggiungi_categoria', 'centralina_modifica_categoria',
  'centralina_elimina_categoria', 'centralina_aggiungi_fascia', 'centralina_modifica_fascia', 'centralina_rimuovi_fascia',
  'centralina_imposta_regole_fasce', 'centralina_aggiungi_assicurazione', 'centralina_modifica_assicurazione', 'centralina_attiva_assicurazione',
  'centralina_disattiva_assicurazione', 'centralina_on_assicurazione', 'centralina_off_assicurazione', 'centralina_elimina_assicurazione',
  'centralina_crea_chilometraggio', 'centralina_modifica_chilometraggio', 'centralina_elimina_chilometraggio', 'centralina_crea_sforo',
  'centralina_modifica_uno_sforo', 'centralina_elimina_uno_sforo', 'centralina_imposta_tariffe_sforo', 'centralina_modifica_tariffe_sforo',
  'centralina_aumentare_tariffe', 'centralina_diminuire_tariffe', 'centralina_attiva_funzionalita_chilometri_illimitati', 'centralina_disattiva_funzionalita_chilometri_illimitati',
  'centralina_crea_pacchetto_chilometrico', 'centralina_modifica_pacchetto_chilometrico', 'centralina_elimina_pacchetto_chilometrico', 'centralina_imposta_tariffe_pacchetti',
  'centralina_modifica_tariffe_pacchetti', 'centralina_imposta_percentuali_sconto', 'centralina_modifica_percentuali_sconto', 'centralina_lasciare_invariate_percentuali_sconto',
  'centralina_salvare_percentuali_sconto', 'centralina_applicare_pacchetto_singola_fascia', 'centralina_applicare_pacchetto_tutte_fasce', 'centralina_attiva_servizi_relativi_chilometraggio',
  'centralina_disattiva_servizi_relativi_chilometraggio', 'centralina_aggiungi_cauzione', 'centralina_modifica_cauzione', 'centralina_attiva_cauzione',
  'centralina_disattiva_cauzione', 'centralina_on_cauzione', 'centralina_off_cauzione', 'centralina_elimina_cauzione',
  'centralina_config_modalita_versamento', 'centralina_config_cauzioni_fascia', 'centralina_config_cauzioni_categoria_auto', 'centralina_aggiungi_servizio',
  'centralina_modifica_servizio', 'centralina_elimina_servizio', 'centralina_attiva_servizio', 'centralina_disattiva_servizio',
  'centralina_on_servizio', 'centralina_off_servizio', 'centralina_crea_prezzo_dinamico', 'centralina_modifica_prezzo_dinamico',
  'centralina_cancellare_prezzo_dinamico', 'centralina_elimina_prezzo_dinamico', 'centralina_imposta_prezzo_base', 'centralina_imposta_prezzo_minimo',
  'centralina_imposta_prezzo_massimo', 'centralina_crea_coefficiente_dinamico', 'centralina_nominare_coefficiente_dinamico', 'centralina_modifica_coefficiente_dinamico',
  'centralina_elimina_coefficiente_dinamico', 'centralina_aggiungi_coefficiente_dinamico', 'centralina_togliere_coefficiente_dinamico', 'centralina_attiva_coefficiente_dinamico',
  'centralina_disattiva_coefficiente_dinamico', 'centralina_on_coefficiente_dinamico', 'centralina_off_coefficiente_dinamico', 'centralina_config_impostazioni_coefficiente_dinamico',
  'centralina_seleziona_maggiorazione_preventivo', 'centralina_imposta_scadenza_predefinita', 'centralina_config_l_invio_preventivo', 'centralina_attiva_richieste_preventivo_l_admin_provenient',
  'centralina_disattiva_richieste_preventivo_l_admin_proveni', 'centralina_imposta_catalogo_danni_categoria_auto', 'centralina_aggiungi_danno', 'centralina_modifica_danno',
  'centralina_elimina_danno', 'centralina_cambiare_nome_danno', 'centralina_cambiare_l_importo_danno', 'centralina_imposta_catalogo_penali_categoria_auto',
  'centralina_aggiungi_penale', 'centralina_modifica_penale', 'centralina_elimina_penale', 'centralina_cambiare_nome_penale',
  'centralina_cambiare_l_importo_penale', 'centralina_seleziona_l_aliquota_iva', 'centralina_modifica_l_aliquota_iva', 'centralina_seleziona_quali_operazioni_devono_genera_fattu',
  'centralina_seleziona_quali_operazioni_non_devono_genera_f', 'centralina_attiva_fattura_determinato_metodo_pagamento', 'centralina_disattiva_fattura_determinato_metodo_pagamento', 'centralina_annullare_fatturazione_determinato_metodo_paga',
  'centralina_aggiungi_metodo_pagamento', 'centralina_modifica_metodo_pagamento', 'centralina_elimina_metodo_pagamento', 'centralina_attiva_metodo_pagamento',
  'centralina_disattiva_metodo_pagamento', 'centralina_seleziona_metodi_pagamento_accettati', 'centralina_seleziona_metodi_pagamento_non_accettati', 'centralina_seleziona_quali_metodi_pagamento_generano_fatt',
  'centralina_aggiungi_tier_cashback', 'centralina_modifica_tier_cashback', 'centralina_elimina_tier_cashback', 'centralina_attiva_tier_cashback',
  'centralina_disattiva_tier_cashback', 'centralina_on_tier_cashback', 'centralina_off_tier_cashback', 'centralina_preimposta_cashback_fascia_dr7_club',
  'centralina_config_cashback_base_alla_spesa_cliente', 'centralina_modifica_percentuale_cashback', 'centralina_config_soglie_spesa', 'centralina_inserisci_buffer_post_noleggio',
  'centralina_inserisci_buffer_tra_veicoli_diversi', 'centralina_inserisci_buffer_pre_pickup_veicoli_lavaggio', 'centralina_modifica_buffer', 'centralina_elimina_buffer',
  'centralina_attiva_buffer', 'centralina_disattiva_buffer', 'centralina_aggiungi_regola_cancellazione', 'centralina_modifica_regola_cancellazione',
  'centralina_elimina_regola_cancellazione', 'centralina_attiva_regola_cancellazione', 'centralina_disattiva_regola_cancellazione', 'centralina_on_regola_cancellazione',
  'centralina_off_regola_cancellazione', 'centralina_inserisci_grace_period_ritardo_riconsegna', 'centralina_modifica_grace_period', 'centralina_elimina_grace_period',
  'centralina_attiva_grace_period', 'centralina_disattiva_grace_period', 'centralina_bloccare_prenotazioni_dal_giorno_giorno', 'centralina_bloccare_prenotazioni_orario',
  'centralina_bloccare_prenotazioni_sezione', 'centralina_bloccare_prenotazioni_singoli_giorni', 'centralina_bloccare_prenotazioni_periodi_tempo', 'centralina_modifica_blocco',
  'centralina_elimina_blocco', 'centralina_attiva_blocco', 'centralina_disattiva_blocco', 'centralina_includere_servizio_nei_coefficienti_dinamici',
  'centralina_escludere_servizio_dai_coefficienti_dinamici', 'centralina_seleziona_quali_servizi_sono_soggetti_sconti', 'centralina_seleziona_quali_servizi_sono_soggetti_ad_aumen', 'centralina_seleziona_quali_servizi_devono_essere_pagati_p',
  'centralina_attiva_l_inclusione_nei_coefficienti_dinamici', 'centralina_disattiva_l_inclusione_nei_coefficienti_dinami', 'centralina_config_orari_noleggio', 'centralina_aggiungi_finestra_oraria',
  'centralina_modifica_finestra_oraria', 'centralina_elimina_finestra_oraria', 'centralina_attiva_finestra_oraria', 'centralina_disattiva_finestra_oraria',
  'centralina_on_finestra_oraria', 'centralina_off_finestra_oraria', 'centralina_chiudere_finestra_oraria', 'centralina_seleziona_giorni_apertura',
  'centralina_seleziona_giorni_chiusura', 'centralina_config_autonomamente_giorni_aperti', 'centralina_config_autonomamente_giorni_chiusi', 'centralina_config_orari_lavaggio',
  'centralina_aggiungi_finestra_oraria_2', 'centralina_modifica_finestra_oraria_2', 'centralina_elimina_finestra_oraria_2', 'centralina_attiva_finestra_oraria_2',
  'centralina_disattiva_finestra_oraria_2', 'centralina_on_finestra_oraria_2', 'centralina_off_finestra_oraria_2', 'centralina_chiudere_finestra_oraria_2',
  'centralina_seleziona_giorni_apertura_2', 'centralina_seleziona_giorni_chiusura_2', 'centralina_config_autonomamente_giorni_aperti_2', 'centralina_config_autonomamente_giorni_chiusi_2',
  'centralina_bloccare_determinate_fasce_orarie', 'centralina_bloccare_determinati_periodi_tempo', 'centralina_bloccare_giorni_specifici', 'trust_invia_nuovi_documenti',
  'trust_elimina_documenti_firmati', 'allarmi_attiva_allarmi', 'allarmi_disattiva_allarmi', 'allarmi_gestire_allarmi',
  'allarmi_scegliere_quando_deve_suonare_allarme', 'allarmi_scegliere_quanto_tempo_prima_deve_suonare', 'allarmi_scegliere_quale_evento_deve_suonare', 'allarmi_crea_allarme',
  'allarmi_modifica_allarme', 'allarmi_elimina_allarme', 'allarmi_on_allarme', 'allarmi_off_allarme',
  'allarmi_attiva_allarme', 'allarmi_disattiva_allarme', 'orari_inserisci_l_orario_entrata', 'orari_inserisci_l_orario_uscita',
  'orari_aggiungi_pausa', 'orari_elimina_pausa', 'orari_modifica_pausa', 'orari_inserisci_note_operative',
  'orari_modifica_orari_esistenti', 'orari_modifica_orari_inseriti', 'orari_salvare_orari', 'orari_chiudere_salvare_orari',
  'account_cambiare_password_profilo_admin', 'account_uscire_dal_profilo_admin', 'account_terminare_sessione', 'account_effettuare_nuovamente_l_accesso',
])
