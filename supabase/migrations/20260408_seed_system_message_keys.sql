-- Seed ALL active system message templates
-- Only includes messages that are ACTUALLY sent by active functions
-- ON CONFLICT DO NOTHING = won't overwrite existing edited templates

-- First ensure message_key has a unique constraint for ON CONFLICT
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_messages_message_key_key') THEN
    ALTER TABLE system_messages ADD CONSTRAINT system_messages_message_key_key UNIQUE (message_key);
  END IF;
END $$;

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled, trigger_event, target_category, target_status)
VALUES

-- ═══ Booking Confirmations (send-whatsapp-notification) ═══
('rental_new', 'Conferma Noleggio', 'Inviato quando viene creata una prenotazione noleggio',
 '*Nuova Prenotazione*

*ID:* {booking_id}
*Cliente:* {customer_name}
*Tel:* {customer_phone}
*Email:* {customer_email}
*Veicolo:* {vehicle_name}
*Targa:* {plate}
*Ritiro:* {pickup_date} alle {pickup_time}
*Riconsegna:* {dropoff_date} alle {dropoff_time}
*Luogo Ritiro:* {pickup_location}
*Assicurazione:* {insurance}
*Cauzione:* {deposit}
*KM:* {km_info}
*Totale:* €{total}
*Pagamento:* {payment_status}',
 true, true, 'on_booking', 'all', 'confirmed'),

('carwash_new', 'Conferma Car Wash', 'Inviato quando viene creata una prenotazione car wash',
 '🚗 *NUOVA PRENOTAZIONE AUTOLAVAGGIO*

*ID:* DR7-{booking_id}
*Cliente:* {customer_name}
*Email:* {customer_email}
*Telefono:* {customer_phone}
*Servizio:* {service_name}
*Data e Ora:* {pickup_date} alle {pickup_time}
*Totale:* €{total}
*Pagamento:* {payment_status}',
 true, true, 'on_booking', 'all', 'confirmed'),

('mechanical_new', 'Conferma Meccanica', 'Inviato quando viene creata una prenotazione meccanica',
 '🔧 *NUOVA PRENOTAZIONE MECCANICA*

*ID:* DR7-{booking_id}
*Cliente:* {customer_name}
*Email:* {customer_email}
*Telefono:* {customer_phone}
*Servizio:* {service_name}
*Data e Ora:* {pickup_date} alle {pickup_time}
*Totale:* €{total}
*Pagamento:* {payment_status}',
 true, true, 'on_booking', 'all', 'confirmed'),

-- ═══ Day-before Reminders (send-booking-reminders cron) ═══
('supercar_day_before', 'Promemoria Supercar (giorno prima)', 'Offerta estensione per supercar il giorno prima del ritiro',
 'Ciao {nome},
domani è il grande giorno.
La tua {vehicle_name} è pronta per te.

Vuoi prolungare l''esperienza con un giorno extra a prezzo dedicato? Rispondi a questo messaggio.

A domani,
DR7',
 true, true, 'before_pickup', 'exotic', 'confirmed'),

('utilitaria_day_before', 'Promemoria Utilitaria (giorno prima)', 'Offerta estensione per utilitaria il giorno prima del ritiro',
 'Ciao {nome},
ti ricordiamo che domani puoi ritirare la tua {vehicle_name}.

Se vuoi prolungare il noleggio, faccelo sapere rispondendo qui.

A domani,
DR7',
 true, true, 'before_pickup', 'urban', 'confirmed'),

('deposit_return_iban', 'Richiesta IBAN Cauzione', 'Richiesta IBAN per restituzione cauzione dopo fine noleggio',
 'Ciao {nome},
speriamo che il noleggio della {vehicle_name} sia andato bene.

Per procedere alla restituzione della cauzione, ti chiediamo gentilmente di inviarci il tuo IBAN rispondendo a questo messaggio.

Grazie,
DR7',
 true, true, 'after_dropoff', 'all', 'completed'),

-- ═══ Check-in / Check-out (send-checkin-checkout-whatsapp) ═══
('checkin_reminder', 'Promemoria Check-in', 'Inviato il giorno del ritiro veicolo',
 'Ciao {nome}!

Ti ricordiamo il ritiro del tuo veicolo previsto per *oggi*.

*Veicolo:* {vehicle_name}
*Targa:* {targa}
*Orario Ritiro:* {pickup_time}
*Luogo:* {pickup_location}
*Cauzione:* {deposit}

Ti aspettiamo! Per qualsiasi necessita non esitare a contattarci.

_DR7 Empire_',
 true, true, 'before_pickup', 'all', 'confirmed'),

('checkout_reminder', 'Promemoria Check-out', 'Inviato il giorno della riconsegna veicolo',
 'Ciao {nome}!

Ti ricordiamo la riconsegna del veicolo prevista per *oggi*.

*Veicolo:* {vehicle_name}
*Targa:* {targa}
*Orario Riconsegna:* {dropoff_time}
*Luogo:* {dropoff_location}
*Cauzione:* {deposit}

Ti preghiamo di riconsegnare il veicolo nelle stesse condizioni in cui lo hai ritirato.

Grazie per aver scelto DR7 Empire!',
 true, true, 'before_dropoff', 'all', 'confirmed'),

-- ═══ Recensioni (send-review-whatsapp cron) ═══
('review_request_whatsapp', 'Richiesta Recensione', 'Inviato 60-120 min dopo la riconsegna',
 'Ciao {nome} 👋🏻

Grazie per aver scelto DR7 Empire!

La tua opinione è fondamentale per noi. Se ti fa piacere, lasciaci una recensione a 5 stelle raccontando la tua esperienza ⭐

In segno di gratitudine, inviandoci uno screenshot della recensione riceverai un buono sconto da €100 sul tuo prossimo noleggio e uno da €10 sul tuo prossimo lavaggio 🎁

Clicca qui per lasciare la recensione 👇🏻
https://g.page/r/CQwgJt7OYpsfEBM/review

Grazie mille!
Dubai Rent 7.0 S.p.A.',
 true, true, 'after_dropoff', 'all', 'completed'),

-- ═══ Compleanno (send-birthday-messages cron) ═══
('birthday_message', 'Auguri Compleanno', 'Inviato 10 giorni prima del compleanno',
 'Ciao {nome} 👋🏻

mancano esattamente 10 giorni a una data speciale: il tuo compleanno 🥳

Per questo ti abbiamo riservato:

Credito personale di €100 utilizzabile per un noleggio DR7
Buono sconto di €10 per un lavaggio auto DR7

CODICE SCONTO: {codice}

Ti basterà rispondere a questo messaggio per attivare il tuo credito.

Con stima,
DR7',
 true, true, 'before_pickup', 'all', 'confirmed'),

-- ═══ Firma Contratto (signature-*) ═══
('signature_request_link', 'Link Firma Contratto', 'Inviato quando si richiede la firma del contratto',
 'Gentile {signerName},

di seguito trova il contratto di noleggio n. {contractNumber} da visionare e firmare digitalmente.

{signingUrl}

La firma richiede meno di 1 minuto.
Il link è valido per 12 ore: trascorso questo termine, la prenotazione potrà decadere automaticamente come da policy.

La invitiamo quindi a completare la firma ora per confermare il noleggio.

Cordiali Saluti,
DR7',
 true, true, 'on_booking', 'all', 'confirmed'),

('signature_reminder_whatsapp', 'Promemoria Firma Contratto', 'Inviato 6 ore dopo la richiesta di firma se ancora in attesa',
 'Gentile {signerName},

le ricordiamo che il contratto di noleggio n. {contractNumber} è ancora in attesa di firma.

{signingUrl}

Il link resterà valido per le prossime 6 ore.
La invitiamo a completare la firma quanto prima per confermare la prenotazione.

Cordiali Saluti,
DR7',
 true, true, 'before_pickup', 'all', 'confirmed'),

('signature_otp_whatsapp', 'Codice OTP Firma', 'Codice verifica per firma contratto',
 '*DR7 Empire - Codice di Verifica*

Il tuo codice OTP per la firma del contratto e:

*{otp}*

Il codice scade tra 10 minuti.

Se non hai richiesto questo codice, ignora questo messaggio.',
 true, true, 'on_booking', 'all', 'confirmed'),

('admin_contract_signed_alert', 'Alert Admin: Contratto Firmato', 'Notifica admin quando un contratto viene firmato',
 '✅ CONTRATTO FIRMATO

{docIdentifier} firmato da {signerName}

Scarica PDF:
{signedPdfUrl}',
 true, true, 'on_booking', 'all', 'confirmed'),

-- ═══ Firma Documento (document-sign-init) ═══
('document_signature_link', 'Link Firma Documento', 'Inviato quando si richiede la firma di un documento generico',
 'Gentile *{signerName}*,

di seguito trova il documento "{docName}" da visionare e firmare digitalmente.

{signingUrl}

La firma richiede meno di 1 minuto.
Il link è valido per 12 ore.

Cordiali Saluti,
DR7',
 true, true, 'on_booking', 'all', 'confirmed'),

-- ═══ Cancellazione (cancel-unpaid-nexi-bookings) ═══
('booking_cancelled_whatsapp', 'Prenotazione Annullata (cliente)', 'Inviato al cliente quando la prenotazione viene annullata per mancato pagamento',
 '*Prenotazione annullata*

Gentile {custName},

La prenotazione #{bookingRef} è stata annullata perché il pagamento non è stato ricevuto entro 1 ora.

Il link di pagamento è stato disattivato.

Se desidera prenotare nuovamente, ci contatti.

DR7',
 true, true, 'on_booking', 'all', 'cancelled'),

('cancellation_admin_alert', 'Alert Admin: Prenotazione Annullata', 'Notifica admin quando una prenotazione viene auto-annullata',
 '*PRENOTAZIONE AUTO-ANNULLATA*

*Cliente:* {customer_name}
*Veicolo:* {vehicle_name}
*ID:* #{bookingRef}

Motivo: Pagamento Nexi non ricevuto entro 1 ora.',
 true, true, 'on_booking', 'all', 'cancelled'),

-- ═══ Pagamento Ricevuto (nexi-payment-callback) ═══
('payment_received_damages', 'Conferma Pagamento Danni/Penali', 'Inviato al cliente dopo pagamento danni o penali',
 'Gentile {custName},

Confermiamo la ricezione del pagamento di €{amountEur} per {paymentType}.

Grazie,
DR7',
 true, true, 'on_payment', 'all', 'confirmed'),

('payment_received_extension', 'Conferma Pagamento Estensione', 'Inviato al cliente dopo pagamento estensione noleggio',
 'Gentile {custName},

Confermiamo la ricezione del pagamento di €{amountEur} per l''estensione del noleggio.

Grazie,
DR7',
 true, true, 'on_payment', 'all', 'confirmed'),

('wallet_bonus_credit', 'Credito Wallet Bonus', 'Inviato al cliente quando riceve credito wallet da pagamento',
 'Gentile {custName},

Ha ricevuto *€{bonusEur}* di credito sul suo wallet DR7 grazie al pagamento con {cardLabel} ({percentLabel}).

Saldo attuale: *€{newBalance}*

Il credito è spendibile direttamente sul sito per le prossime prenotazioni.

Grazie per la collaborazione.

DR7',
 true, true, 'on_payment', 'all', 'confirmed'),

-- ═══ Carta Prepagata (prepaid-card-guard) ═══
('prepaid_card_blocked_customer', 'Carta Prepagata Rifiutata (cliente)', 'Inviato al cliente quando la carta prepagata viene rifiutata',
 '⚠️ *Pagamento rifiutato*

Gentile {customerName},

Non accettiamo carte prepagate. Utilizzare una carta di credito o debito.

La prenotazione #{bookingRef} è stata annullata e il pagamento verrà rimborsato.

Per assistenza contattaci.

DR7',
 true, true, 'on_payment', 'all', 'cancelled'),

('prepaid_card_blocked_admin', 'Alert Admin: Carta Prepagata', 'Notifica admin quando una carta prepagata viene bloccata',
 '🚫 *CARTA PREPAGATA BLOCCATA*

*Cliente:* {customerName}
*Importo:* €{amount}
*Prenotazione:* #{bookingRef}

Operazione rifiutata e rimborso avviato.',
 true, true, 'on_payment', 'all', 'cancelled'),

-- ═══ Fattura (generate-invoice/penalty) ═══
('invoice_pdf_whatsapp', 'Invio Fattura PDF', 'Caption del PDF fattura inviato via WhatsApp',
 'Fattura {numero_fattura} - DR7 Empire',
 true, true, 'on_payment', 'all', 'confirmed'),

('penalty_invoice_pdf_whatsapp', 'Invio Fattura Penale PDF', 'Caption del PDF fattura penale inviato via WhatsApp',
 'Fattura {numero_fattura} - DR7 Empire',
 true, true, 'on_payment', 'all', 'confirmed'),

-- ═══ OTP Referral (referral-send-otp) ═══
('referral_otp_whatsapp', 'Codice OTP Referral', 'Codice verifica per referral',
 '*DR7 Empire - Codice di Verifica*

Il tuo codice OTP: *{code}*

Scade tra 5 minuti.
Non condividere questo codice con nessuno.',
 true, true, 'on_booking', 'all', 'confirmed'),

-- ═══ Preventivo dal Sito (create-website-preventivo) ═══
('admin_new_website_quote', 'Notifica Admin: Nuovo Preventivo', 'Inviato all''admin quando un cliente crea un preventivo dal sito',
 '*NUOVO PREVENTIVO DAL SITO*

*Cliente:* {customer_name}
*Tel:* {customer_phone}
*Veicolo:* {vehicle_name}
*Date:* {pickup_date} - {dropoff_date} ({rental_days}gg)
*Totale:* €{total_final}
*Assicurazione:* {insurance_option}
*KM:* {km_info}
*Cauzione:* {cauzione_line}

Gestisci dal pannello admin > Preventivi',
 true, true, 'on_booking', 'all', 'confirmed'),

('admin_no_cauzione_request', 'Notifica Admin: Richiesta No Cauzione', 'Inviato all''admin e al boss quando un cliente richiede no cauzione',
 '*RICHIESTA NO CAUZIONE*

*Cliente:* {customer_name}
*Telefono:* {customer_phone}
*Veicolo:* {vehicle_name}
*Periodo:* {pickup_date} → {dropoff_date}
*Totale:* €{total_final}

Approvare o rifiutare dall''admin > Preventivi.',
 true, true, 'on_booking', 'all', 'confirmed')

ON CONFLICT (message_key) DO NOTHING;
