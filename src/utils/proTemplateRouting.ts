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
  // 2026-08-14 — Catalogo completo delle azioni del gestionale (roadmap #44).
  //
  // La direzione contestava la distanza fra le azioni che il gestionale
  // permette e i trigger selezionabili nei Messaggi di Sistema. Qui sotto c'e'
  // una voce per ogni azione che CAMBIA uno stato: creare, modificare,
  // eliminare, inviare, generare, attivare, caricare.
  //
  // Le azioni di sola consultazione (visualizzare, cercare, filtrare, aprire,
  // navigare) sono ESCLUSE di proposito: non succede niente da comunicare, e
  // un trigger che non puo' produrre un messaggio e' solo rumore in un elenco
  // che serve a scegliere.
  //
  // Le azioni gia' coperte da un evento esistente non sono state duplicate
  // (es. "Creare una nuova prenotazione" e' gia' rental_new_customer): due
  // voci identiche vorrebbero dire sceglierne una a caso, e meta' delle volte
  // sarebbe quella sbagliata.
  //
  // ATTENZIONE: sono selezionabili ma NON emessi dal codice — stanno tutti in
  // PENDING_EVENTS e l'interfaccia li mostra con il badge "da collegare". La
  // direzione puo' preparare il testo; il messaggio partira' quando
  // l'emissione verra' aggiunta nel punto giusto del codice.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Noleggio Terra ──
  terra_invia_test_meteo: 'NOLEGGIO TERRA: Inviare un test meteo',
  terra_gestire_prenotazione: 'NOLEGGIO TERRA: Gestire una prenotazione',
  terra_gestire_danni: 'NOLEGGIO TERRA: Gestire danni',
  terra_gestire_penali: 'NOLEGGIO TERRA: Gestire penali',
  terra_crea_nuovo_preventivo: 'NOLEGGIO TERRA: Creare un nuovo preventivo',
  terra_modifica_preventivo: 'NOLEGGIO TERRA: Modificare un preventivo',
  terra_invia_preventivo: 'NOLEGGIO TERRA: Inviare un preventivo',
  terra_accettare_preventivo: 'NOLEGGIO TERRA: Accettare un preventivo',
  terra_rifiutare_preventivo: 'NOLEGGIO TERRA: Rifiutare un preventivo',
  terra_cambiare_preventivo: 'NOLEGGIO TERRA: Cambiare un preventivo',
  terra_esportare_preventivi: 'NOLEGGIO TERRA: Esportare i preventivi',
  terra_aggiungi_nuova_uscita_straordinaria: 'NOLEGGIO TERRA: Aggiungere una nuova uscita straordinaria',
  terra_modifica_uscita_straordinaria: 'NOLEGGIO TERRA: Modificare un\'uscita straordinaria',
  terra_gestire_uscita_straordinaria: 'NOLEGGIO TERRA: Gestire un\'uscita straordinaria',
  terra_modifica_prenotazioni_esistenti_dal_calendar: 'NOLEGGIO TERRA: Modificare le prenotazioni esistenti dal calendario',

  // ── Contratti ──
  contratti_carica_nuova_versione_contratto: 'CONTRATTI: Caricare una nuova versione del contratto',
  contratti_rigenera_contratto: 'CONTRATTI: Rigenerare il contratto',
  contratti_modifica_contratto: 'CONTRATTI: Modificare il contratto',
  contratti_elimina_contratto: 'CONTRATTI: Eliminare il contratto',
  contratti_elimina_prenotazione_collegata: 'CONTRATTI: Eliminare la prenotazione collegata',

  // ── Danni e Penali ──
  danni_modifica_penali: 'DANNI E PENALI: Modificare le penali',
  danni_elimina_penali: 'DANNI E PENALI: Eliminare le penali',
  danni_modifica_danni: 'DANNI E PENALI: Modificare i danni',
  danni_elimina_danni: 'DANNI E PENALI: Eliminare i danni',

  // ── Multe ──
  multe_aggiornare_storico_pec: 'MULTE: Aggiornare lo storico PEC',
  multe_carica_documento_multa: 'MULTE: Caricare il documento della multa',
  multe_analizzare_documento: 'MULTE: Analizzare il documento',

  // ── Cargos ──
  cargos_scarica_file: 'CARGOS: Scaricare i file',
  cargos_gestire_impostazioni_cargos: 'CARGOS: Gestire le impostazioni Cargos',
  cargos_validare_contratti: 'CARGOS: Validare i contratti',
  cargos_invia_piu_contratti_cargos: 'CARGOS: Inviare piu\' contratti a Cargos',

  // ── Veicoli ──
  veicoli_modifica_targa: 'VEICOLI: Modificare la targa',
  veicoli_modifica_numero_telaio: 'VEICOLI: Modificare il numero di telaio',
  veicoli_modifica_chilometraggio: 'VEICOLI: Modificare il chilometraggio',
  veicoli_modifica_cavalli: 'VEICOLI: Modificare i cavalli',
  veicoli_modifica_l_anno: 'VEICOLI: Modificare l\'anno',
  veicoli_modifica_dato_accelerazione: 'VEICOLI: Modificare il dato di accelerazione',
  veicoli_inserisci_tagliando: 'VEICOLI: Inserire il tagliando',
  veicoli_modifica_tagliando: 'VEICOLI: Modificare il tagliando',
  veicoli_inserisci_l_intervallo_tagliando: 'VEICOLI: Inserire l\'intervallo di tagliando',
  veicoli_modifica_l_intervallo_tagliando: 'VEICOLI: Modificare l\'intervallo di tagliando',
  veicoli_inserisci_specifiche_gomme_anteriori: 'VEICOLI: Inserire le specifiche delle gomme anteriori',
  veicoli_inserisci_specifiche_gomme_posteriori: 'VEICOLI: Inserire le specifiche delle gomme posteriori',
  veicoli_modifica_specifiche_gomme_anteriori: 'VEICOLI: Modificare le specifiche delle gomme anteriori',
  veicoli_modifica_specifiche_gomme_posteriori: 'VEICOLI: Modificare le specifiche delle gomme posteriori',
  veicoli_inserisci_gli_intervalli_gomme: 'VEICOLI: Inserire gli intervalli delle gomme',
  veicoli_modifica_gli_intervalli_gomme: 'VEICOLI: Modificare gli intervalli delle gomme',
  veicoli_inserisci_dati_pastiglie_anteriori: 'VEICOLI: Inserire i dati delle pastiglie anteriori',
  veicoli_inserisci_dati_pastiglie_posteriori: 'VEICOLI: Inserire i dati delle pastiglie posteriori',
  veicoli_modifica_dati_pastiglie_anteriori: 'VEICOLI: Modificare i dati delle pastiglie anteriori',
  veicoli_modifica_dati_pastiglie_posteriori: 'VEICOLI: Modificare i dati delle pastiglie posteriori',
  veicoli_inserisci_gli_intervalli_pastiglie: 'VEICOLI: Inserire gli intervalli delle pastiglie',
  veicoli_modifica_gli_intervalli_pastiglie: 'VEICOLI: Modificare gli intervalli delle pastiglie',
  veicoli_inserisci_scadenze_amministrative: 'VEICOLI: Inserire le scadenze amministrative',
  veicoli_modifica_scadenze_amministrative: 'VEICOLI: Modificare le scadenze amministrative',
  veicoli_inserisci_attivita_sul_veicolo: 'VEICOLI: Inserire un\'attivita\' sul veicolo',
  veicoli_inserisci_manutenzione_effettuata: 'VEICOLI: Inserire una manutenzione effettuata',
  veicoli_inserisci_lavoro_effettuato: 'VEICOLI: Inserire un lavoro effettuato',
  veicoli_inserisci_foto_auto: 'VEICOLI: Inserire le foto delle auto',

  // ── Magazzino ──
  magazzino_inserisci_nuovo_materiale: 'MAGAZZINO: Inserire un nuovo materiale',
  magazzino_inserisci_quantita_disponibile: 'MAGAZZINO: Inserire la quantita\' disponibile',
  magazzino_aggiornare_quantita_disponibile: 'MAGAZZINO: Aggiornare la quantita\' disponibile',
  magazzino_inserisci_quantita_utilizzata: 'MAGAZZINO: Inserire la quantita\' utilizzata',
  magazzino_aggiungi_merce: 'MAGAZZINO: Aggiungere merce',
  magazzino_togliere_merce: 'MAGAZZINO: Togliere merce',
  magazzino_aggiungi_materiale_carrello: 'MAGAZZINO: Aggiungere materiale al carrello',
  magazzino_rimuovi_articoli_dal_carrello: 'MAGAZZINO: Rimuovere articoli dal carrello',
  magazzino_genera_ordine: 'MAGAZZINO: Generare un ordine',
  magazzino_aggiungi_fornitore_magazzino: 'MAGAZZINO: Aggiungere un fornitore magazzino',
  magazzino_modifica_fornitore_magazzino: 'MAGAZZINO: Modificare un fornitore magazzino',
  magazzino_elimina_fornitore_magazzino: 'MAGAZZINO: Eliminare un fornitore magazzino',

  // ── Lavaggio e Meccanica ──
  lavaggio_invia_fattura_lavaggio: 'LAVAGGIO E MECCANICA: Inviare la fattura lavaggio',
  lavaggio_elimina_prenotazione_lavaggio: 'LAVAGGIO E MECCANICA: Eliminare la prenotazione lavaggio',
  lavaggio_inserisci_nuovo_servizio_lavaggio: 'LAVAGGIO E MECCANICA: Inserire un nuovo servizio di lavaggio',
  lavaggio_modifica_servizio_lavaggio: 'LAVAGGIO E MECCANICA: Modificare un servizio di lavaggio',
  lavaggio_inserisci_descrizione: 'LAVAGGIO E MECCANICA: Inserire una descrizione',
  lavaggio_modifica_descrizione: 'LAVAGGIO E MECCANICA: Modificare una descrizione',
  lavaggio_inserisci_foto: 'LAVAGGIO E MECCANICA: Inserire una foto',
  lavaggio_modifica_foto: 'LAVAGGIO E MECCANICA: Modificare una foto',
  lavaggio_cambiare_prezzi: 'LAVAGGIO E MECCANICA: Cambiare i prezzi',
  lavaggio_cambiare_durate: 'LAVAGGIO E MECCANICA: Cambiare le durate',
  lavaggio_modifica_durate: 'LAVAGGIO E MECCANICA: Modificare le durate',
  lavaggio_aggiungi_extra: 'LAVAGGIO E MECCANICA: Aggiungere un extra',
  lavaggio_modifica_extra: 'LAVAGGIO E MECCANICA: Modificare un extra',
  lavaggio_elimina_extra: 'LAVAGGIO E MECCANICA: Eliminare un extra',
  lavaggio_aggiungi_sezione: 'LAVAGGIO E MECCANICA: Aggiungere una sezione',
  lavaggio_modifica_sezione: 'LAVAGGIO E MECCANICA: Modificare una sezione',
  lavaggio_elimina_sezione: 'LAVAGGIO E MECCANICA: Eliminare una sezione',
  lavaggio_aggiungi_auto_cortesia: 'LAVAGGIO E MECCANICA: Aggiungere un\'auto di cortesia',
  lavaggio_modifica_auto_cortesia: 'LAVAGGIO E MECCANICA: Modificare un\'auto di cortesia',
  lavaggio_elimina_auto_cortesia: 'LAVAGGIO E MECCANICA: Eliminare un\'auto di cortesia',
  lavaggio_modifica_servizi_auto_cortesia: 'LAVAGGIO E MECCANICA: Modificare i servizi di un\'auto di cortesia',

  // ── Clienti ──
  clienti_rimuovi_duplicati: 'CLIENTI: Rimuovere i duplicati',
  clienti_esportare_tutti_clienti: 'CLIENTI: Esportare tutti i clienti',
  clienti_importare_lead_link: 'CLIENTI: Importare lead da link',
  clienti_invia_link_autoregistrazione: 'CLIENTI: Inviare un link di autoregistrazione',
  clienti_crea_nuovo_cliente: 'CLIENTI: Creare un nuovo cliente',
  clienti_crea_persona_fisica: 'CLIENTI: Creare una persona fisica',
  clienti_crea_azienda: 'CLIENTI: Creare un\'azienda',
  clienti_crea_pubblica_amministrazione: 'CLIENTI: Creare una Pubblica Amministrazione',
  clienti_inserisci_documenti_tramite_file: 'CLIENTI: Inserire documenti tramite file',
  clienti_inserisci_documenti_tramite_foto: 'CLIENTI: Inserire documenti tramite foto',
  clienti_calcolare_codice_fiscale: 'CLIENTI: Calcolare il codice fiscale',
  clienti_carica_file_documenti: 'CLIENTI: Caricare i file dei documenti',
  clienti_salvare_cliente: 'CLIENTI: Salvare il cliente',
  clienti_copiare_contatto: 'CLIENTI: Copiare il contatto',
  clienti_invia_messaggio_whatsapp_cliente: 'CLIENTI: Inviare un messaggio WhatsApp al cliente',
  clienti_chiamare_cliente: 'CLIENTI: Chiamare il cliente',
  clienti_modifica_scheda_cliente: 'CLIENTI: Modificare la scheda cliente',
  clienti_salvare_modifiche_cliente: 'CLIENTI: Salvare le modifiche cliente',
  clienti_trasformare_lead_autista: 'CLIENTI: Trasformare una lead in autista',
  clienti_aggiungi_status_autista: 'CLIENTI: Aggiungere lo status di autista',
  clienti_rimuovi_cliente_dalla_blacklist: 'CLIENTI: Rimuovere il cliente dalla Blacklist',
  clienti_rimuovi_status_member: 'CLIENTI: Rimuovere lo status Member',
  clienti_rimuovi_status_elite: 'CLIENTI: Rimuovere lo status Elite',
  clienti_addebitare_crediti_dal_wallet: 'CLIENTI: Addebitare crediti dal wallet',

  // ── Marketing ──
  marketing_reinvia_messaggio_compleanno: 'MARKETING: Reinviare il messaggio di compleanno',
  marketing_reinvia_richiesta_recensione: 'MARKETING: Reinviare una richiesta recensione',
  marketing_bloccare_cliente_recensioni: 'MARKETING: Bloccare un cliente per le recensioni',
  marketing_sbloccare_cliente_recensioni: 'MARKETING: Sbloccare un cliente per le recensioni',
  marketing_approvare_cliente_richiesta_recensione: 'MARKETING: Approvare un cliente per la richiesta recensione',
  marketing_escludere_cliente_dalla_richiesta_recensione: 'MARKETING: Escludere un cliente dalla richiesta recensione',
  marketing_invia_alla_direzione_clienti_con_danni: 'MARKETING: Inviare alla direzione i clienti con danni',
  marketing_invia_alla_direzione_clienti_con_penali: 'MARKETING: Inviare alla direzione i clienti con penali',
  marketing_invia_alla_direzione_clienti_con_contenziosi: 'MARKETING: Inviare alla direzione i clienti con contenziosi',
  marketing_crea_nuovo_messaggio_sistema: 'MARKETING: Creare un nuovo messaggio di sistema',
  marketing_modifica_messaggio_sistema: 'MARKETING: Modificare un messaggio di sistema',
  marketing_elimina_messaggio_sistema: 'MARKETING: Eliminare un messaggio di sistema',
  marketing_invia_messaggio_manualmente: 'MARKETING: Inviare un messaggio manualmente',
  marketing_accendere_messaggio: 'MARKETING: Accendere un messaggio',
  marketing_spegnere_messaggio: 'MARKETING: Spegnere un messaggio',
  marketing_imposta_messaggio_come_automatico: 'MARKETING: Impostare un messaggio come automatico',
  marketing_imposta_messaggio_come_manuale: 'MARKETING: Impostare un messaggio come manuale',
  marketing_imposta_cron_on: 'MARKETING: Impostare Cron ON',
  marketing_imposta_cron_off: 'MARKETING: Impostare Cron OFF',
  marketing_attiva_header: 'MARKETING: Attivare Header',
  marketing_disattiva_header: 'MARKETING: Disattivare Header',
  marketing_attiva_footer: 'MARKETING: Attivare Footer',
  marketing_disattiva_footer: 'MARKETING: Disattivare Footer',
  marketing_attiva_invio_tramite_email: 'MARKETING: Attivare invio tramite email',
  marketing_disattiva_invio_tramite_email: 'MARKETING: Disattivare invio tramite email',
  marketing_crea_nuova_campagna_marketing: 'MARKETING: Creare una nuova campagna marketing',
  marketing_programmare_campagna_marketing: 'MARKETING: Programmare una campagna marketing',
  marketing_aggiungi_file_multimediale: 'MARKETING: Aggiungere un file multimediale',
  marketing_aggiungi_video: 'MARKETING: Aggiungere un video',
  marketing_programmare_l_invio: 'MARKETING: Programmare l\'invio',
  marketing_invia_immediatamente: 'MARKETING: Inviare immediatamente',
  marketing_invia_50_clienti: 'MARKETING: Inviare a 50 clienti',
  marketing_invia_100_clienti: 'MARKETING: Inviare a 100 clienti',
  marketing_invia_250_clienti: 'MARKETING: Inviare a 250 clienti',
  marketing_invia_500_clienti: 'MARKETING: Inviare a 500 clienti',
  marketing_invia_tutti_clienti: 'MARKETING: Inviare a tutti i clienti',
  marketing_aggiungi_link_social: 'MARKETING: Aggiungere un link social',
  marketing_modifica_link_social: 'MARKETING: Modificare un link social',
  marketing_elimina_link_social: 'MARKETING: Eliminare un link social',
  marketing_genera_nuovo_codice_sconto: 'MARKETING: Generare un nuovo codice sconto',
  marketing_modifica_codice_sconto: 'MARKETING: Modificare un codice sconto',
  marketing_attiva_codice_sconto: 'MARKETING: Attivare un codice sconto',
  marketing_disattiva_codice_sconto: 'MARKETING: Disattivare un codice sconto',
  marketing_crea_qr_code: 'MARKETING: Creare un QR Code',
  marketing_copiare_codice_sconto: 'MARKETING: Copiare il codice sconto',

  // ── Amministrazione ──
  amm_segnare_pagamento_come_pagato: 'AMMINISTRAZIONE: Segnare un pagamento come pagato',
  amm_inserisci_l_importo_pagato: 'AMMINISTRAZIONE: Inserire l\'importo pagato',
  amm_invia_link_pagamento_parziale: 'AMMINISTRAZIONE: Inviare un link di pagamento parziale',
  amm_addebitare_carta_tokenizzata: 'AMMINISTRAZIONE: Addebitare una carta tokenizzata',
  amm_registrare_pagamento_parziale: 'AMMINISTRAZIONE: Registrare un pagamento parziale',
  amm_parzializzare_pagamento: 'AMMINISTRAZIONE: Parzializzare un pagamento',
  amm_modifica_l_importo_pagamento: 'AMMINISTRAZIONE: Modificare l\'importo del pagamento',
  amm_elimina_pagamento: 'AMMINISTRAZIONE: Eliminare il pagamento',
  amm_modifica_cauzione: 'AMMINISTRAZIONE: Modificare una cauzione',
  amm_segnare_cauzione_incassare: 'AMMINISTRAZIONE: Segnare una cauzione da incassare',
  amm_segnare_cauzione_incassata: 'AMMINISTRAZIONE: Segnare una cauzione incassata',
  amm_inserisci_cauzione_cassa: 'AMMINISTRAZIONE: Inserire una cauzione in cassa',
  amm_restituire_cauzione_prima_dell_incasso: 'AMMINISTRAZIONE: Restituire una cauzione prima dell\'incasso',
  amm_invia_link_preautorizzare_cauzione: 'AMMINISTRAZIONE: Inviare un link per preautorizzare la cauzione',
  amm_incassare_cauzione: 'AMMINISTRAZIONE: Incassare una cauzione',
  amm_imposta_nuova_scadenza: 'AMMINISTRAZIONE: Impostare una nuova scadenza',
  amm_aggiungi_scadenza: 'AMMINISTRAZIONE: Aggiungere una scadenza',
  amm_modifica_scadenza: 'AMMINISTRAZIONE: Modificare una scadenza',
  amm_elimina_scadenza: 'AMMINISTRAZIONE: Eliminare una scadenza',
  amm_scarica_fattura: 'AMMINISTRAZIONE: Scaricare una fattura',
  amm_copiare_fattura: 'AMMINISTRAZIONE: Copiare una fattura',
  amm_inoltrare_fattura: 'AMMINISTRAZIONE: Inoltrare una fattura',
  amm_modifica_fattura: 'AMMINISTRAZIONE: Modificare una fattura',
  amm_segnare_fattura_come_non_pagata: 'AMMINISTRAZIONE: Segnare una fattura come non pagata',
  amm_elimina_fattura: 'AMMINISTRAZIONE: Eliminare una fattura',
  amm_effettuare_rilevazione_degli_orari: 'AMMINISTRAZIONE: Effettuare la rilevazione degli orari',
  amm_carica_buste_paga: 'AMMINISTRAZIONE: Caricare le buste paga',
  amm_crea_contratti_operatore: 'AMMINISTRAZIONE: Creare i contratti operatore',
  amm_assegnare_permessi_operatore: 'AMMINISTRAZIONE: Assegnare permessi a un operatore',
  amm_rimuovi_permessi_operatore: 'AMMINISTRAZIONE: Rimuovere permessi a un operatore',
  amm_modifica_status_operatore: 'AMMINISTRAZIONE: Modificare lo status di un operatore',
  amm_modifica_livello_autorizzazione: 'AMMINISTRAZIONE: Modificare il livello di autorizzazione',
  amm_aggiungi_calendario_rifiuti: 'AMMINISTRAZIONE: Aggiungere un calendario rifiuti',
  amm_crea_giornata_ritiro: 'AMMINISTRAZIONE: Creare una giornata di ritiro',
  amm_aggiungi_ritiro: 'AMMINISTRAZIONE: Aggiungere un ritiro',
  amm_imposta_giornata_fissa_ritiro: 'AMMINISTRAZIONE: Impostare una giornata fissa di ritiro',
  amm_imposta_orario_fisso_ritiro: 'AMMINISTRAZIONE: Impostare un orario fisso di ritiro',
  amm_modifica_giornata_ritiro: 'AMMINISTRAZIONE: Modificare una giornata di ritiro',
  amm_modifica_ritiro: 'AMMINISTRAZIONE: Modificare un ritiro',
  amm_elimina_giornata: 'AMMINISTRAZIONE: Eliminare una giornata',
  amm_elimina_ritiro: 'AMMINISTRAZIONE: Eliminare un ritiro',
  amm_aprire_nuovo_ticket: 'AMMINISTRAZIONE: Aprire un nuovo ticket',
  amm_invia_ticket: 'AMMINISTRAZIONE: Inviare il ticket',
  amm_annullare_ticket: 'AMMINISTRAZIONE: Annullare il ticket',
  amm_gestire_destinatari_ticket: 'AMMINISTRAZIONE: Gestire i destinatari dei ticket',
  amm_aggiungi_fornitore: 'AMMINISTRAZIONE: Aggiungere un fornitore',
  amm_modifica_fornitore: 'AMMINISTRAZIONE: Modificare un fornitore',
  amm_elimina_fornitore: 'AMMINISTRAZIONE: Eliminare un fornitore',
  amm_carica_bolle: 'AMMINISTRAZIONE: Caricare le bolle',
  amm_carica_bolla_senza_fattura: 'AMMINISTRAZIONE: Caricare una bolla senza fattura',
  amm_carica_documenti_fattura_ricevuta: 'AMMINISTRAZIONE: Caricare documenti su una fattura ricevuta',
  amm_eseguire_controllo_incrociato_fatture: 'AMMINISTRAZIONE: Eseguire un controllo incrociato delle fatture',
  amm_richiedere_accesso_tp_approvazione_fatture: 'AMMINISTRAZIONE: Richiedere accesso TP per approvazione fatture',
  amm_richiedere_accesso_tp_approvazione_pagamento: 'AMMINISTRAZIONE: Richiedere accesso TP per approvazione pagamento',
  amm_aggiornare_fatture_fornitore: 'AMMINISTRAZIONE: Aggiornare le fatture fornitore',
  amm_effettuare_nuovo_pagamento_nexi: 'AMMINISTRAZIONE: Effettuare un nuovo pagamento Nexi',
  amm_preautorizzare_pagamento_nexi: 'AMMINISTRAZIONE: Preautorizzare un pagamento Nexi',
  amm_elimina_carta_tokenizzata: 'AMMINISTRAZIONE: Eliminare una carta tokenizzata',
  amm_addebitare_carta_tokenizzata_nexi: 'AMMINISTRAZIONE: Addebitare una carta tokenizzata Nexi',
  amm_modifica_canali_notifica_otp: 'AMMINISTRAZIONE: Modificare i canali di notifica OTP',
  amm_configurare_destinatari_otp: 'AMMINISTRAZIONE: Configurare i destinatari OTP',
  amm_aggiungi_regola_otp: 'AMMINISTRAZIONE: Aggiungere una regola OTP',
  amm_modifica_regola_otp: 'AMMINISTRAZIONE: Modificare una regola OTP',
  amm_attiva_regola_otp: 'AMMINISTRAZIONE: Attivare una regola OTP',
  amm_disattiva_regola_otp: 'AMMINISTRAZIONE: Disattivare una regola OTP',
  amm_elimina_regola_otp: 'AMMINISTRAZIONE: Eliminare una regola OTP',
  amm_elimina_blocco_otp_regola: 'AMMINISTRAZIONE: Eliminare il blocco OTP da una regola',
  amm_invia_anteprima_otp: 'AMMINISTRAZIONE: Inviare un\'anteprima OTP',
  amm_effettuare_test_otp: 'AMMINISTRAZIONE: Effettuare un test OTP',
  amm_scarica_documenti_cliente: 'AMMINISTRAZIONE: Scaricare i documenti cliente',
  amm_inserisci_documenti_nella_scheda_cliente: 'AMMINISTRAZIONE: Inserire i documenti nella scheda cliente',
  amm_accettare_documenti: 'AMMINISTRAZIONE: Accettare i documenti',
  amm_rifiutare_documenti: 'AMMINISTRAZIONE: Rifiutare i documenti',

  // ── Centralina Pro ──
  centralina_aggiungi_categoria: 'CENTRALINA PRO: Aggiungere una categoria',
  centralina_modifica_categoria: 'CENTRALINA PRO: Modificare una categoria',
  centralina_elimina_categoria: 'CENTRALINA PRO: Eliminare una categoria',
  centralina_aggiungi_fascia: 'CENTRALINA PRO: Aggiungere una fascia',
  centralina_modifica_fascia: 'CENTRALINA PRO: Modificare una fascia',
  centralina_rimuovi_fascia: 'CENTRALINA PRO: Rimuovere una fascia',
  centralina_imposta_regole_fasce: 'CENTRALINA PRO: Impostare regole per le fasce',
  centralina_aggiungi_assicurazione: 'CENTRALINA PRO: Aggiungere un\'assicurazione',
  centralina_modifica_assicurazione: 'CENTRALINA PRO: Modificare un\'assicurazione',
  centralina_attiva_assicurazione: 'CENTRALINA PRO: Attivare un\'assicurazione',
  centralina_disattiva_assicurazione: 'CENTRALINA PRO: Disattivare un\'assicurazione',
  centralina_elimina_assicurazione: 'CENTRALINA PRO: Eliminare un\'assicurazione',
  centralina_crea_chilometraggio: 'CENTRALINA PRO: Creare un chilometraggio',
  centralina_modifica_chilometraggio: 'CENTRALINA PRO: Modificare un chilometraggio',
  centralina_elimina_chilometraggio: 'CENTRALINA PRO: Eliminare un chilometraggio',
  centralina_crea_uno_sforo: 'CENTRALINA PRO: Creare uno sforo',
  centralina_modifica_uno_sforo: 'CENTRALINA PRO: Modificare uno sforo',
  centralina_elimina_uno_sforo: 'CENTRALINA PRO: Eliminare uno sforo',
  centralina_imposta_tariffe_sforo: 'CENTRALINA PRO: Impostare le tariffe di sforo',
  centralina_modifica_tariffe_sforo: 'CENTRALINA PRO: Modificare le tariffe di sforo',
  centralina_attiva_chilometri_illimitati: 'CENTRALINA PRO: Attivare i chilometri illimitati',
  centralina_disattiva_chilometri_illimitati: 'CENTRALINA PRO: Disattivare i chilometri illimitati',
  centralina_crea_pacchetto_chilometrico: 'CENTRALINA PRO: Creare un pacchetto chilometrico',
  centralina_modifica_pacchetto_chilometrico: 'CENTRALINA PRO: Modificare un pacchetto chilometrico',
  centralina_elimina_pacchetto_chilometrico: 'CENTRALINA PRO: Eliminare un pacchetto chilometrico',
  centralina_imposta_percentuali_sconto: 'CENTRALINA PRO: Impostare le percentuali di sconto',
  centralina_modifica_percentuali_sconto: 'CENTRALINA PRO: Modificare le percentuali di sconto',
  centralina_applicare_pacchetto_fascia: 'CENTRALINA PRO: Applicare il pacchetto a una fascia',
  centralina_applicare_pacchetto_tutte_fasce: 'CENTRALINA PRO: Applicare il pacchetto a tutte le fasce',
  centralina_aggiungi_cauzione: 'CENTRALINA PRO: Aggiungere una cauzione',
  centralina_modifica_cauzione_centralina: 'CENTRALINA PRO: Modificare una cauzione in centralina',
  centralina_attiva_cauzione: 'CENTRALINA PRO: Attivare una cauzione',
  centralina_disattiva_cauzione: 'CENTRALINA PRO: Disattivare una cauzione',
  centralina_elimina_cauzione: 'CENTRALINA PRO: Eliminare una cauzione',
  centralina_configurare_modalita_versamento: 'CENTRALINA PRO: Configurare le modalita\' di versamento',
  centralina_aggiungi_servizio_extra: 'CENTRALINA PRO: Aggiungere un servizio extra',
  centralina_modifica_servizio_extra: 'CENTRALINA PRO: Modificare un servizio extra',
  centralina_elimina_servizio_extra: 'CENTRALINA PRO: Eliminare un servizio extra',
  centralina_attiva_servizio_extra: 'CENTRALINA PRO: Attivare un servizio extra',
  centralina_disattiva_servizio_extra: 'CENTRALINA PRO: Disattivare un servizio extra',
  centralina_crea_prezzo_dinamico: 'CENTRALINA PRO: Creare un prezzo dinamico',
  centralina_modifica_prezzo_dinamico: 'CENTRALINA PRO: Modificare un prezzo dinamico',
  centralina_elimina_prezzo_dinamico: 'CENTRALINA PRO: Eliminare un prezzo dinamico',
  centralina_imposta_prezzo_base: 'CENTRALINA PRO: Impostare il prezzo base',
  centralina_imposta_prezzo_minimo: 'CENTRALINA PRO: Impostare il prezzo minimo',
  centralina_imposta_prezzo_massimo: 'CENTRALINA PRO: Impostare il prezzo massimo',
  centralina_crea_coefficiente_dinamico: 'CENTRALINA PRO: Creare un coefficiente dinamico',
  centralina_modifica_coefficiente_dinamico: 'CENTRALINA PRO: Modificare un coefficiente dinamico',
  centralina_elimina_coefficiente_dinamico: 'CENTRALINA PRO: Eliminare un coefficiente dinamico',
  centralina_attiva_coefficiente_dinamico: 'CENTRALINA PRO: Attivare un coefficiente dinamico',
  centralina_disattiva_coefficiente_dinamico: 'CENTRALINA PRO: Disattivare un coefficiente dinamico',
  centralina_seleziona_maggiorazione_preventivo: 'CENTRALINA PRO: Selezionare la maggiorazione del preventivo',
  centralina_imposta_scadenza_predefinita_preventivo: 'CENTRALINA PRO: Impostare la scadenza predefinita del preventivo',
  centralina_attiva_richieste_preventivo_dal_sito: 'CENTRALINA PRO: Attivare le richieste preventivo dal sito',
  centralina_disattiva_richieste_preventivo_dal_sito: 'CENTRALINA PRO: Disattivare le richieste preventivo dal sito',
  centralina_aggiungi_danno_catalogo: 'CENTRALINA PRO: Aggiungere un danno a catalogo',
  centralina_modifica_danno_catalogo: 'CENTRALINA PRO: Modificare un danno a catalogo',
  centralina_elimina_danno_catalogo: 'CENTRALINA PRO: Eliminare un danno a catalogo',
  centralina_aggiungi_penale_catalogo: 'CENTRALINA PRO: Aggiungere una penale a catalogo',
  centralina_modifica_penale_catalogo: 'CENTRALINA PRO: Modificare una penale a catalogo',
  centralina_elimina_penale_catalogo: 'CENTRALINA PRO: Eliminare una penale a catalogo',
  centralina_seleziona_l_aliquota_iva: 'CENTRALINA PRO: Selezionare l\'aliquota IVA',
  centralina_modifica_l_aliquota_iva: 'CENTRALINA PRO: Modificare l\'aliquota IVA',
  centralina_attiva_fattura_metodo_pagamento: 'CENTRALINA PRO: Attivare la fattura su un metodo di pagamento',
  centralina_disattiva_fattura_metodo_pagamento: 'CENTRALINA PRO: Disattivare la fattura su un metodo di pagamento',
  centralina_aggiungi_metodo_pagamento: 'CENTRALINA PRO: Aggiungere un metodo di pagamento',
  centralina_modifica_metodo_pagamento: 'CENTRALINA PRO: Modificare un metodo di pagamento',
  centralina_elimina_metodo_pagamento: 'CENTRALINA PRO: Eliminare un metodo di pagamento',
  centralina_attiva_metodo_pagamento: 'CENTRALINA PRO: Attivare un metodo di pagamento',
  centralina_disattiva_metodo_pagamento: 'CENTRALINA PRO: Disattivare un metodo di pagamento',
  centralina_aggiungi_tier_cashback: 'CENTRALINA PRO: Aggiungere un Tier Cashback',
  centralina_modifica_tier_cashback: 'CENTRALINA PRO: Modificare un Tier Cashback',
  centralina_elimina_tier_cashback: 'CENTRALINA PRO: Eliminare un Tier Cashback',
  centralina_attiva_tier_cashback: 'CENTRALINA PRO: Attivare un Tier Cashback',
  centralina_disattiva_tier_cashback: 'CENTRALINA PRO: Disattivare un Tier Cashback',
  centralina_modifica_percentuale_cashback: 'CENTRALINA PRO: Modificare la percentuale di cashback',
  centralina_configurare_soglie_spesa: 'CENTRALINA PRO: Configurare le soglie di spesa',
  centralina_inserisci_buffer_post_noleggio: 'CENTRALINA PRO: Inserire un buffer post noleggio',
  centralina_inserisci_buffer_tra_veicoli: 'CENTRALINA PRO: Inserire un buffer tra veicoli',
  centralina_inserisci_buffer_pre_pickup: 'CENTRALINA PRO: Inserire un buffer pre-pickup',
  centralina_modifica_buffer: 'CENTRALINA PRO: Modificare un buffer',
  centralina_elimina_buffer: 'CENTRALINA PRO: Eliminare un buffer',
  centralina_attiva_buffer: 'CENTRALINA PRO: Attivare un buffer',
  centralina_disattiva_buffer: 'CENTRALINA PRO: Disattivare un buffer',
  centralina_aggiungi_regola_cancellazione: 'CENTRALINA PRO: Aggiungere una regola di cancellazione',
  centralina_modifica_regola_cancellazione: 'CENTRALINA PRO: Modificare una regola di cancellazione',
  centralina_elimina_regola_cancellazione: 'CENTRALINA PRO: Eliminare una regola di cancellazione',
  centralina_attiva_regola_cancellazione: 'CENTRALINA PRO: Attivare una regola di cancellazione',
  centralina_disattiva_regola_cancellazione: 'CENTRALINA PRO: Disattivare una regola di cancellazione',
  centralina_inserisci_grace_period: 'CENTRALINA PRO: Inserire una Grace Period',
  centralina_modifica_grace_period: 'CENTRALINA PRO: Modificare la Grace Period',
  centralina_elimina_grace_period: 'CENTRALINA PRO: Eliminare la Grace Period',
  centralina_attiva_grace_period: 'CENTRALINA PRO: Attivare la Grace Period',
  centralina_disattiva_grace_period: 'CENTRALINA PRO: Disattivare la Grace Period',
  centralina_bloccare_prenotazioni_lavaggio_giorni: 'CENTRALINA PRO: Bloccare le prenotazioni lavaggio per giorni',
  centralina_bloccare_prenotazioni_lavaggio_orario: 'CENTRALINA PRO: Bloccare le prenotazioni lavaggio per orario',
  centralina_bloccare_prenotazioni_lavaggio_sezione: 'CENTRALINA PRO: Bloccare le prenotazioni lavaggio per sezione',
  centralina_modifica_blocco_lavaggio: 'CENTRALINA PRO: Modificare un blocco lavaggio',
  centralina_elimina_blocco_lavaggio: 'CENTRALINA PRO: Eliminare un blocco lavaggio',
  centralina_includere_servizio_nei_coefficienti_dinamici: 'CENTRALINA PRO: Includere un servizio nei coefficienti dinamici',
  centralina_escludere_servizio_dai_coefficienti_dinamici: 'CENTRALINA PRO: Escludere un servizio dai coefficienti dinamici',
  centralina_configurare_gli_orari_noleggio: 'CENTRALINA PRO: Configurare gli orari di noleggio',
  centralina_aggiungi_finestra_oraria_noleggio: 'CENTRALINA PRO: Aggiungere una finestra oraria noleggio',
  centralina_modifica_finestra_oraria_noleggio: 'CENTRALINA PRO: Modificare una finestra oraria noleggio',
  centralina_elimina_finestra_oraria_noleggio: 'CENTRALINA PRO: Eliminare una finestra oraria noleggio',
  centralina_chiudere_finestra_oraria_noleggio: 'CENTRALINA PRO: Chiudere una finestra oraria noleggio',
  centralina_configurare_gli_orari_lavaggio: 'CENTRALINA PRO: Configurare gli orari di lavaggio',
  centralina_aggiungi_finestra_oraria_lavaggio: 'CENTRALINA PRO: Aggiungere una finestra oraria lavaggio',
  centralina_modifica_finestra_oraria_lavaggio: 'CENTRALINA PRO: Modificare una finestra oraria lavaggio',
  centralina_elimina_finestra_oraria_lavaggio: 'CENTRALINA PRO: Eliminare una finestra oraria lavaggio',
  centralina_chiudere_finestra_oraria_lavaggio: 'CENTRALINA PRO: Chiudere una finestra oraria lavaggio',
  centralina_seleziona_giorni_apertura: 'CENTRALINA PRO: Selezionare i giorni di apertura',
  centralina_seleziona_giorni_chiusura: 'CENTRALINA PRO: Selezionare i giorni di chiusura',

  // ── DR7 Trust ──
  trust_invia_nuovi_documenti_firmare: 'DR7 TRUST: Inviare nuovi documenti da firmare',
  trust_elimina_documenti_firmati: 'DR7 TRUST: Eliminare documenti firmati',

  // ── Allarmi ──
  allarmi_attiva_gli_allarmi: 'ALLARMI: Attivare gli allarmi',
  allarmi_disattiva_gli_allarmi: 'ALLARMI: Disattivare gli allarmi',
  allarmi_crea_nuovo_allarme: 'ALLARMI: Creare un nuovo allarme',
  allarmi_modifica_allarme: 'ALLARMI: Modificare un allarme',
  allarmi_elimina_allarme: 'ALLARMI: Eliminare un allarme',
  allarmi_accendere_allarme: 'ALLARMI: Accendere un allarme',
  allarmi_spegnere_allarme: 'ALLARMI: Spegnere un allarme',

  // ── I Miei Orari ──
  orari_inserisci_l_orario_entrata: 'I MIEI ORARI: Inserire l\'orario di entrata',
  orari_inserisci_l_orario_uscita: 'I MIEI ORARI: Inserire l\'orario di uscita',
  orari_aggiungi_pausa: 'I MIEI ORARI: Aggiungere una pausa',
  orari_elimina_pausa: 'I MIEI ORARI: Eliminare una pausa',
  orari_modifica_pausa: 'I MIEI ORARI: Modificare una pausa',
  orari_inserisci_note_operative: 'I MIEI ORARI: Inserire note operative',
  orari_modifica_gli_orari: 'I MIEI ORARI: Modificare gli orari',
  orari_salvare_gli_orari: 'I MIEI ORARI: Salvare gli orari',

  // ── Account ──
  account_cambiare_password_profilo_admin: 'ACCOUNT: Cambiare la password del profilo Admin',
  account_uscire_dal_profilo_admin: 'ACCOUNT: Uscire dal profilo Admin',

  // ── Noleggio Mare ──
  mare_invia_test_meteo: 'NOLEGGIO MARE: Inviare un test meteo',
  mare_gestire_prenotazione: 'NOLEGGIO MARE: Gestire una prenotazione',
  mare_estendere_prenotazione: 'NOLEGGIO MARE: Estendere una prenotazione',
  mare_invia_contratto: 'NOLEGGIO MARE: Inviare il contratto',
  mare_gestire_danni: 'NOLEGGIO MARE: Gestire danni',
  mare_gestire_penali: 'NOLEGGIO MARE: Gestire penali',
  mare_crea_nuovo_preventivo: 'NOLEGGIO MARE: Creare un nuovo preventivo',
  mare_modifica_preventivo: 'NOLEGGIO MARE: Modificare un preventivo',
  mare_invia_preventivo: 'NOLEGGIO MARE: Inviare un preventivo',
  mare_accettare_preventivo: 'NOLEGGIO MARE: Accettare un preventivo',
  mare_rifiutare_preventivo: 'NOLEGGIO MARE: Rifiutare un preventivo',
  mare_cambiare_preventivo: 'NOLEGGIO MARE: Cambiare un preventivo',
  mare_esportare_preventivi: 'NOLEGGIO MARE: Esportare i preventivi',
  mare_accettare_richiesta_no_cauzione: 'NOLEGGIO MARE: Accettare una richiesta No Cauzione',
  mare_rifiutare_richiesta_no_cauzione: 'NOLEGGIO MARE: Rifiutare una richiesta No Cauzione',
  mare_aggiungi_nuova_uscita_straordinaria: 'NOLEGGIO MARE: Aggiungere una nuova uscita straordinaria',
  mare_modifica_uscita_straordinaria: 'NOLEGGIO MARE: Modificare un\'uscita straordinaria',
  mare_gestire_uscita_straordinaria: 'NOLEGGIO MARE: Gestire un\'uscita straordinaria',
  mare_modifica_prenotazioni_esistenti_dal_calendar: 'NOLEGGIO MARE: Modificare le prenotazioni esistenti dal calendario',

  // ── Noleggio Aria ──
  aria_invia_allerta_meteo: 'NOLEGGIO ARIA: Inviare un\'allerta meteo',
  aria_invia_test_meteo: 'NOLEGGIO ARIA: Inviare un test meteo',
  aria_gestire_prenotazione: 'NOLEGGIO ARIA: Gestire una prenotazione',
  aria_estendere_prenotazione: 'NOLEGGIO ARIA: Estendere una prenotazione',
  aria_invia_contratto: 'NOLEGGIO ARIA: Inviare il contratto',
  aria_gestire_danni: 'NOLEGGIO ARIA: Gestire danni',
  aria_gestire_penali: 'NOLEGGIO ARIA: Gestire penali',
  aria_crea_nuovo_preventivo: 'NOLEGGIO ARIA: Creare un nuovo preventivo',
  aria_modifica_preventivo: 'NOLEGGIO ARIA: Modificare un preventivo',
  aria_invia_preventivo: 'NOLEGGIO ARIA: Inviare un preventivo',
  aria_accettare_preventivo: 'NOLEGGIO ARIA: Accettare un preventivo',
  aria_rifiutare_preventivo: 'NOLEGGIO ARIA: Rifiutare un preventivo',
  aria_cambiare_preventivo: 'NOLEGGIO ARIA: Cambiare un preventivo',
  aria_esportare_preventivi: 'NOLEGGIO ARIA: Esportare i preventivi',
  aria_accettare_richiesta_no_cauzione: 'NOLEGGIO ARIA: Accettare una richiesta No Cauzione',
  aria_rifiutare_richiesta_no_cauzione: 'NOLEGGIO ARIA: Rifiutare una richiesta No Cauzione',
  aria_aggiungi_nuova_uscita_straordinaria: 'NOLEGGIO ARIA: Aggiungere una nuova uscita straordinaria',
  aria_modifica_uscita_straordinaria: 'NOLEGGIO ARIA: Modificare un\'uscita straordinaria',
  aria_gestire_uscita_straordinaria: 'NOLEGGIO ARIA: Gestire un\'uscita straordinaria',
  aria_modifica_prenotazioni_esistenti_dal_calendar: 'NOLEGGIO ARIA: Modificare le prenotazioni esistenti dal calendario',

  // ── Soggiorni ──
  soggiorni_invia_allerta_meteo: 'SOGGIORNI: Inviare un\'allerta meteo',
  soggiorni_invia_test_meteo: 'SOGGIORNI: Inviare un test meteo',
  soggiorni_gestire_prenotazione: 'SOGGIORNI: Gestire una prenotazione',
  soggiorni_estendere_prenotazione: 'SOGGIORNI: Estendere una prenotazione',
  soggiorni_invia_contratto: 'SOGGIORNI: Inviare il contratto',
  soggiorni_gestire_danni: 'SOGGIORNI: Gestire danni',
  soggiorni_gestire_penali: 'SOGGIORNI: Gestire penali',
  soggiorni_crea_nuovo_preventivo: 'SOGGIORNI: Creare un nuovo preventivo',
  soggiorni_modifica_preventivo: 'SOGGIORNI: Modificare un preventivo',
  soggiorni_invia_preventivo: 'SOGGIORNI: Inviare un preventivo',
  soggiorni_accettare_preventivo: 'SOGGIORNI: Accettare un preventivo',
  soggiorni_rifiutare_preventivo: 'SOGGIORNI: Rifiutare un preventivo',
  soggiorni_cambiare_preventivo: 'SOGGIORNI: Cambiare un preventivo',
  soggiorni_esportare_preventivi: 'SOGGIORNI: Esportare i preventivi',
  soggiorni_accettare_richiesta_no_cauzione: 'SOGGIORNI: Accettare una richiesta No Cauzione',
  soggiorni_rifiutare_richiesta_no_cauzione: 'SOGGIORNI: Rifiutare una richiesta No Cauzione',
  soggiorni_aggiungi_nuova_uscita_straordinaria: 'SOGGIORNI: Aggiungere una nuova uscita straordinaria',
  soggiorni_modifica_uscita_straordinaria: 'SOGGIORNI: Modificare un\'uscita straordinaria',
  soggiorni_gestire_uscita_straordinaria: 'SOGGIORNI: Gestire un\'uscita straordinaria',
  soggiorni_modifica_prenotazioni_esistenti_dal_calendar: 'SOGGIORNI: Modificare le prenotazioni esistenti dal calendario',
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
  'boat_new_admin', 'boat_cancelled', 'boat_da_saldare_customer', 'boat_pronto',
  'heli_new_admin', 'heli_cancelled', 'heli_da_saldare_customer', 'heli_pronto',
  'stay_new_admin', 'stay_cancelled', 'stay_da_saldare_customer', 'stay_pronto',
  'fattura_generata_customer', 'fattura_inviata_customer', 'nota_credito_emessa_customer',
  'fattura_sdi_accettata_admin', 'fattura_sdi_rifiutata_admin',
  'multa_conducente_identificato_admin', 'multa_pec_inviata_admin', 'multa_notifica_cliente',
  'magazzino_ordine_fornitore',

  // 2026-08-14 (roadmap #44): catalogo completo delle azioni che cambiano
  // stato. Nessuna di queste e' ancora emessa dal codice.
  'terra_invia_test_meteo', 'terra_gestire_prenotazione', 'terra_gestire_danni', 'terra_gestire_penali',
  'terra_crea_nuovo_preventivo', 'terra_modifica_preventivo', 'terra_invia_preventivo', 'terra_accettare_preventivo',
  'terra_rifiutare_preventivo', 'terra_cambiare_preventivo', 'terra_esportare_preventivi', 'terra_aggiungi_nuova_uscita_straordinaria',
  'terra_modifica_uscita_straordinaria', 'terra_gestire_uscita_straordinaria', 'terra_modifica_prenotazioni_esistenti_dal_calendar', 'contratti_carica_nuova_versione_contratto',
  'contratti_rigenera_contratto', 'contratti_modifica_contratto', 'contratti_elimina_contratto', 'contratti_elimina_prenotazione_collegata',
  'danni_modifica_penali', 'danni_elimina_penali', 'danni_modifica_danni', 'danni_elimina_danni',
  'multe_aggiornare_storico_pec', 'multe_carica_documento_multa', 'multe_analizzare_documento', 'cargos_scarica_file',
  'cargos_gestire_impostazioni_cargos', 'cargos_validare_contratti', 'cargos_invia_piu_contratti_cargos', 'veicoli_modifica_targa',
  'veicoli_modifica_numero_telaio', 'veicoli_modifica_chilometraggio', 'veicoli_modifica_cavalli', 'veicoli_modifica_l_anno',
  'veicoli_modifica_dato_accelerazione', 'veicoli_inserisci_tagliando', 'veicoli_modifica_tagliando', 'veicoli_inserisci_l_intervallo_tagliando',
  'veicoli_modifica_l_intervallo_tagliando', 'veicoli_inserisci_specifiche_gomme_anteriori', 'veicoli_inserisci_specifiche_gomme_posteriori', 'veicoli_modifica_specifiche_gomme_anteriori',
  'veicoli_modifica_specifiche_gomme_posteriori', 'veicoli_inserisci_gli_intervalli_gomme', 'veicoli_modifica_gli_intervalli_gomme', 'veicoli_inserisci_dati_pastiglie_anteriori',
  'veicoli_inserisci_dati_pastiglie_posteriori', 'veicoli_modifica_dati_pastiglie_anteriori', 'veicoli_modifica_dati_pastiglie_posteriori', 'veicoli_inserisci_gli_intervalli_pastiglie',
  'veicoli_modifica_gli_intervalli_pastiglie', 'veicoli_inserisci_scadenze_amministrative', 'veicoli_modifica_scadenze_amministrative', 'veicoli_inserisci_attivita_sul_veicolo',
  'veicoli_inserisci_manutenzione_effettuata', 'veicoli_inserisci_lavoro_effettuato', 'veicoli_inserisci_foto_auto', 'magazzino_inserisci_nuovo_materiale',
  'magazzino_inserisci_quantita_disponibile', 'magazzino_aggiornare_quantita_disponibile', 'magazzino_inserisci_quantita_utilizzata', 'magazzino_aggiungi_merce',
  'magazzino_togliere_merce', 'magazzino_aggiungi_materiale_carrello', 'magazzino_rimuovi_articoli_dal_carrello', 'magazzino_genera_ordine',
  'magazzino_aggiungi_fornitore_magazzino', 'magazzino_modifica_fornitore_magazzino', 'magazzino_elimina_fornitore_magazzino', 'lavaggio_invia_fattura_lavaggio',
  'lavaggio_elimina_prenotazione_lavaggio', 'lavaggio_inserisci_nuovo_servizio_lavaggio', 'lavaggio_modifica_servizio_lavaggio', 'lavaggio_inserisci_descrizione',
  'lavaggio_modifica_descrizione', 'lavaggio_inserisci_foto', 'lavaggio_modifica_foto', 'lavaggio_cambiare_prezzi',
  'lavaggio_cambiare_durate', 'lavaggio_modifica_durate', 'lavaggio_aggiungi_extra', 'lavaggio_modifica_extra',
  'lavaggio_elimina_extra', 'lavaggio_aggiungi_sezione', 'lavaggio_modifica_sezione', 'lavaggio_elimina_sezione',
  'lavaggio_aggiungi_auto_cortesia', 'lavaggio_modifica_auto_cortesia', 'lavaggio_elimina_auto_cortesia', 'lavaggio_modifica_servizi_auto_cortesia',
  'clienti_rimuovi_duplicati', 'clienti_esportare_tutti_clienti', 'clienti_importare_lead_link', 'clienti_invia_link_autoregistrazione',
  'clienti_crea_nuovo_cliente', 'clienti_crea_persona_fisica', 'clienti_crea_azienda', 'clienti_crea_pubblica_amministrazione',
  'clienti_inserisci_documenti_tramite_file', 'clienti_inserisci_documenti_tramite_foto', 'clienti_calcolare_codice_fiscale', 'clienti_carica_file_documenti',
  'clienti_salvare_cliente', 'clienti_copiare_contatto', 'clienti_invia_messaggio_whatsapp_cliente', 'clienti_chiamare_cliente',
  'clienti_modifica_scheda_cliente', 'clienti_salvare_modifiche_cliente', 'clienti_trasformare_lead_autista', 'clienti_aggiungi_status_autista',
  'clienti_rimuovi_cliente_dalla_blacklist', 'clienti_rimuovi_status_member', 'clienti_rimuovi_status_elite', 'clienti_addebitare_crediti_dal_wallet',
  'marketing_reinvia_messaggio_compleanno', 'marketing_reinvia_richiesta_recensione', 'marketing_bloccare_cliente_recensioni', 'marketing_sbloccare_cliente_recensioni',
  'marketing_approvare_cliente_richiesta_recensione', 'marketing_escludere_cliente_dalla_richiesta_recensione', 'marketing_invia_alla_direzione_clienti_con_danni', 'marketing_invia_alla_direzione_clienti_con_penali',
  'marketing_invia_alla_direzione_clienti_con_contenziosi', 'marketing_crea_nuovo_messaggio_sistema', 'marketing_modifica_messaggio_sistema', 'marketing_elimina_messaggio_sistema',
  'marketing_invia_messaggio_manualmente', 'marketing_accendere_messaggio', 'marketing_spegnere_messaggio', 'marketing_imposta_messaggio_come_automatico',
  'marketing_imposta_messaggio_come_manuale', 'marketing_imposta_cron_on', 'marketing_imposta_cron_off', 'marketing_attiva_header',
  'marketing_disattiva_header', 'marketing_attiva_footer', 'marketing_disattiva_footer', 'marketing_attiva_invio_tramite_email',
  'marketing_disattiva_invio_tramite_email', 'marketing_crea_nuova_campagna_marketing', 'marketing_programmare_campagna_marketing', 'marketing_aggiungi_file_multimediale',
  'marketing_aggiungi_video', 'marketing_programmare_l_invio', 'marketing_invia_immediatamente', 'marketing_invia_50_clienti',
  'marketing_invia_100_clienti', 'marketing_invia_250_clienti', 'marketing_invia_500_clienti', 'marketing_invia_tutti_clienti',
  'marketing_aggiungi_link_social', 'marketing_modifica_link_social', 'marketing_elimina_link_social', 'marketing_genera_nuovo_codice_sconto',
  'marketing_modifica_codice_sconto', 'marketing_attiva_codice_sconto', 'marketing_disattiva_codice_sconto', 'marketing_crea_qr_code',
  'marketing_copiare_codice_sconto', 'amm_segnare_pagamento_come_pagato', 'amm_inserisci_l_importo_pagato', 'amm_invia_link_pagamento_parziale',
  'amm_addebitare_carta_tokenizzata', 'amm_registrare_pagamento_parziale', 'amm_parzializzare_pagamento', 'amm_modifica_l_importo_pagamento',
  'amm_elimina_pagamento', 'amm_modifica_cauzione', 'amm_segnare_cauzione_incassare', 'amm_segnare_cauzione_incassata',
  'amm_inserisci_cauzione_cassa', 'amm_restituire_cauzione_prima_dell_incasso', 'amm_invia_link_preautorizzare_cauzione', 'amm_incassare_cauzione',
  'amm_imposta_nuova_scadenza', 'amm_aggiungi_scadenza', 'amm_modifica_scadenza', 'amm_elimina_scadenza',
  'amm_scarica_fattura', 'amm_copiare_fattura', 'amm_inoltrare_fattura', 'amm_modifica_fattura',
  'amm_segnare_fattura_come_non_pagata', 'amm_elimina_fattura', 'amm_effettuare_rilevazione_degli_orari', 'amm_carica_buste_paga',
  'amm_crea_contratti_operatore', 'amm_assegnare_permessi_operatore', 'amm_rimuovi_permessi_operatore', 'amm_modifica_status_operatore',
  'amm_modifica_livello_autorizzazione', 'amm_aggiungi_calendario_rifiuti', 'amm_crea_giornata_ritiro', 'amm_aggiungi_ritiro',
  'amm_imposta_giornata_fissa_ritiro', 'amm_imposta_orario_fisso_ritiro', 'amm_modifica_giornata_ritiro', 'amm_modifica_ritiro',
  'amm_elimina_giornata', 'amm_elimina_ritiro', 'amm_aprire_nuovo_ticket', 'amm_invia_ticket',
  'amm_annullare_ticket', 'amm_gestire_destinatari_ticket', 'amm_aggiungi_fornitore', 'amm_modifica_fornitore',
  'amm_elimina_fornitore', 'amm_carica_bolle', 'amm_carica_bolla_senza_fattura', 'amm_carica_documenti_fattura_ricevuta',
  'amm_eseguire_controllo_incrociato_fatture', 'amm_richiedere_accesso_tp_approvazione_fatture', 'amm_richiedere_accesso_tp_approvazione_pagamento', 'amm_aggiornare_fatture_fornitore',
  'amm_effettuare_nuovo_pagamento_nexi', 'amm_preautorizzare_pagamento_nexi', 'amm_elimina_carta_tokenizzata', 'amm_addebitare_carta_tokenizzata_nexi',
  'amm_modifica_canali_notifica_otp', 'amm_configurare_destinatari_otp', 'amm_aggiungi_regola_otp', 'amm_modifica_regola_otp',
  'amm_attiva_regola_otp', 'amm_disattiva_regola_otp', 'amm_elimina_regola_otp', 'amm_elimina_blocco_otp_regola',
  'amm_invia_anteprima_otp', 'amm_effettuare_test_otp', 'amm_scarica_documenti_cliente', 'amm_inserisci_documenti_nella_scheda_cliente',
  'amm_accettare_documenti', 'amm_rifiutare_documenti', 'centralina_aggiungi_categoria', 'centralina_modifica_categoria',
  'centralina_elimina_categoria', 'centralina_aggiungi_fascia', 'centralina_modifica_fascia', 'centralina_rimuovi_fascia',
  'centralina_imposta_regole_fasce', 'centralina_aggiungi_assicurazione', 'centralina_modifica_assicurazione', 'centralina_attiva_assicurazione',
  'centralina_disattiva_assicurazione', 'centralina_elimina_assicurazione', 'centralina_crea_chilometraggio', 'centralina_modifica_chilometraggio',
  'centralina_elimina_chilometraggio', 'centralina_crea_uno_sforo', 'centralina_modifica_uno_sforo', 'centralina_elimina_uno_sforo',
  'centralina_imposta_tariffe_sforo', 'centralina_modifica_tariffe_sforo', 'centralina_attiva_chilometri_illimitati', 'centralina_disattiva_chilometri_illimitati',
  'centralina_crea_pacchetto_chilometrico', 'centralina_modifica_pacchetto_chilometrico', 'centralina_elimina_pacchetto_chilometrico', 'centralina_imposta_percentuali_sconto',
  'centralina_modifica_percentuali_sconto', 'centralina_applicare_pacchetto_fascia', 'centralina_applicare_pacchetto_tutte_fasce', 'centralina_aggiungi_cauzione',
  'centralina_modifica_cauzione_centralina', 'centralina_attiva_cauzione', 'centralina_disattiva_cauzione', 'centralina_elimina_cauzione',
  'centralina_configurare_modalita_versamento', 'centralina_aggiungi_servizio_extra', 'centralina_modifica_servizio_extra', 'centralina_elimina_servizio_extra',
  'centralina_attiva_servizio_extra', 'centralina_disattiva_servizio_extra', 'centralina_crea_prezzo_dinamico', 'centralina_modifica_prezzo_dinamico',
  'centralina_elimina_prezzo_dinamico', 'centralina_imposta_prezzo_base', 'centralina_imposta_prezzo_minimo', 'centralina_imposta_prezzo_massimo',
  'centralina_crea_coefficiente_dinamico', 'centralina_modifica_coefficiente_dinamico', 'centralina_elimina_coefficiente_dinamico', 'centralina_attiva_coefficiente_dinamico',
  'centralina_disattiva_coefficiente_dinamico', 'centralina_seleziona_maggiorazione_preventivo', 'centralina_imposta_scadenza_predefinita_preventivo', 'centralina_attiva_richieste_preventivo_dal_sito',
  'centralina_disattiva_richieste_preventivo_dal_sito', 'centralina_aggiungi_danno_catalogo', 'centralina_modifica_danno_catalogo', 'centralina_elimina_danno_catalogo',
  'centralina_aggiungi_penale_catalogo', 'centralina_modifica_penale_catalogo', 'centralina_elimina_penale_catalogo', 'centralina_seleziona_l_aliquota_iva',
  'centralina_modifica_l_aliquota_iva', 'centralina_attiva_fattura_metodo_pagamento', 'centralina_disattiva_fattura_metodo_pagamento', 'centralina_aggiungi_metodo_pagamento',
  'centralina_modifica_metodo_pagamento', 'centralina_elimina_metodo_pagamento', 'centralina_attiva_metodo_pagamento', 'centralina_disattiva_metodo_pagamento',
  'centralina_aggiungi_tier_cashback', 'centralina_modifica_tier_cashback', 'centralina_elimina_tier_cashback', 'centralina_attiva_tier_cashback',
  'centralina_disattiva_tier_cashback', 'centralina_modifica_percentuale_cashback', 'centralina_configurare_soglie_spesa', 'centralina_inserisci_buffer_post_noleggio',
  'centralina_inserisci_buffer_tra_veicoli', 'centralina_inserisci_buffer_pre_pickup', 'centralina_modifica_buffer', 'centralina_elimina_buffer',
  'centralina_attiva_buffer', 'centralina_disattiva_buffer', 'centralina_aggiungi_regola_cancellazione', 'centralina_modifica_regola_cancellazione',
  'centralina_elimina_regola_cancellazione', 'centralina_attiva_regola_cancellazione', 'centralina_disattiva_regola_cancellazione', 'centralina_inserisci_grace_period',
  'centralina_modifica_grace_period', 'centralina_elimina_grace_period', 'centralina_attiva_grace_period', 'centralina_disattiva_grace_period',
  'centralina_bloccare_prenotazioni_lavaggio_giorni', 'centralina_bloccare_prenotazioni_lavaggio_orario', 'centralina_bloccare_prenotazioni_lavaggio_sezione', 'centralina_modifica_blocco_lavaggio',
  'centralina_elimina_blocco_lavaggio', 'centralina_includere_servizio_nei_coefficienti_dinamici', 'centralina_escludere_servizio_dai_coefficienti_dinamici', 'centralina_configurare_gli_orari_noleggio',
  'centralina_aggiungi_finestra_oraria_noleggio', 'centralina_modifica_finestra_oraria_noleggio', 'centralina_elimina_finestra_oraria_noleggio', 'centralina_chiudere_finestra_oraria_noleggio',
  'centralina_configurare_gli_orari_lavaggio', 'centralina_aggiungi_finestra_oraria_lavaggio', 'centralina_modifica_finestra_oraria_lavaggio', 'centralina_elimina_finestra_oraria_lavaggio',
  'centralina_chiudere_finestra_oraria_lavaggio', 'centralina_seleziona_giorni_apertura', 'centralina_seleziona_giorni_chiusura', 'trust_invia_nuovi_documenti_firmare',
  'trust_elimina_documenti_firmati', 'allarmi_attiva_gli_allarmi', 'allarmi_disattiva_gli_allarmi', 'allarmi_crea_nuovo_allarme',
  'allarmi_modifica_allarme', 'allarmi_elimina_allarme', 'allarmi_accendere_allarme', 'allarmi_spegnere_allarme',
  'orari_inserisci_l_orario_entrata', 'orari_inserisci_l_orario_uscita', 'orari_aggiungi_pausa', 'orari_elimina_pausa',
  'orari_modifica_pausa', 'orari_inserisci_note_operative', 'orari_modifica_gli_orari', 'orari_salvare_gli_orari',
  'account_cambiare_password_profilo_admin', 'account_uscire_dal_profilo_admin', 'mare_invia_test_meteo', 'mare_gestire_prenotazione',
  'mare_estendere_prenotazione', 'mare_invia_contratto', 'mare_gestire_danni', 'mare_gestire_penali',
  'mare_crea_nuovo_preventivo', 'mare_modifica_preventivo', 'mare_invia_preventivo', 'mare_accettare_preventivo',
  'mare_rifiutare_preventivo', 'mare_cambiare_preventivo', 'mare_esportare_preventivi', 'mare_accettare_richiesta_no_cauzione',
  'mare_rifiutare_richiesta_no_cauzione', 'mare_aggiungi_nuova_uscita_straordinaria', 'mare_modifica_uscita_straordinaria', 'mare_gestire_uscita_straordinaria',
  'mare_modifica_prenotazioni_esistenti_dal_calendar', 'aria_invia_allerta_meteo', 'aria_invia_test_meteo', 'aria_gestire_prenotazione',
  'aria_estendere_prenotazione', 'aria_invia_contratto', 'aria_gestire_danni', 'aria_gestire_penali',
  'aria_crea_nuovo_preventivo', 'aria_modifica_preventivo', 'aria_invia_preventivo', 'aria_accettare_preventivo',
  'aria_rifiutare_preventivo', 'aria_cambiare_preventivo', 'aria_esportare_preventivi', 'aria_accettare_richiesta_no_cauzione',
  'aria_rifiutare_richiesta_no_cauzione', 'aria_aggiungi_nuova_uscita_straordinaria', 'aria_modifica_uscita_straordinaria', 'aria_gestire_uscita_straordinaria',
  'aria_modifica_prenotazioni_esistenti_dal_calendar', 'soggiorni_invia_allerta_meteo', 'soggiorni_invia_test_meteo', 'soggiorni_gestire_prenotazione',
  'soggiorni_estendere_prenotazione', 'soggiorni_invia_contratto', 'soggiorni_gestire_danni', 'soggiorni_gestire_penali',
  'soggiorni_crea_nuovo_preventivo', 'soggiorni_modifica_preventivo', 'soggiorni_invia_preventivo', 'soggiorni_accettare_preventivo',
  'soggiorni_rifiutare_preventivo', 'soggiorni_cambiare_preventivo', 'soggiorni_esportare_preventivi', 'soggiorni_accettare_richiesta_no_cauzione',
  'soggiorni_rifiutare_richiesta_no_cauzione', 'soggiorni_aggiungi_nuova_uscita_straordinaria', 'soggiorni_modifica_uscita_straordinaria', 'soggiorni_gestire_uscita_straordinaria',
  'soggiorni_modifica_prenotazioni_esistenti_dal_calendar',
])
