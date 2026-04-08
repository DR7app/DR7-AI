-- Seed all system message keys so they appear in Messaggi Sistema tab
-- Existing templates are NOT overwritten (ON CONFLICT DO NOTHING)

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled, trigger_event, target_category, target_status)
VALUES
  ('carwash_new', 'Conferma Car Wash', 'Messaggio inviato alla creazione di una prenotazione car wash',
   'Nuova prenotazione Car Wash\n\n*Servizio:* {service_name}\n*Cliente:* {customer_name}\n*Telefono:* {customer_phone}\n*Data:* {pickup_date} alle {pickup_time}\n*Totale:* €{total}\n*Pagamento:* {payment_status}',
   true, true, 'on_booking', 'all', 'confirmed'),

  ('carwash_modified', 'Car Wash Modificato', 'Messaggio inviato alla modifica di una prenotazione car wash',
   'Prenotazione Car Wash modificata\n\n*Servizio:* {service_name}\n*Cliente:* {customer_name}\n*Data:* {pickup_date} alle {pickup_time}\n*Totale:* €{total}',
   true, true, 'on_booking', 'all', 'confirmed'),

  ('mechanical_new', 'Conferma Meccanica', 'Messaggio inviato alla creazione di una prenotazione meccanica',
   'Nuova prenotazione Meccanica\n\n*Servizio:* {service_name}\n*Cliente:* {customer_name}\n*Telefono:* {customer_phone}\n*Data:* {pickup_date} alle {pickup_time}\n*Totale:* €{total}\n*Pagamento:* {payment_status}',
   true, true, 'on_booking', 'all', 'confirmed'),

  ('mechanical_modified', 'Meccanica Modificato', 'Messaggio inviato alla modifica di una prenotazione meccanica',
   'Prenotazione Meccanica modificata\n\n*Servizio:* {service_name}\n*Cliente:* {customer_name}\n*Data:* {pickup_date} alle {pickup_time}\n*Totale:* €{total}',
   true, true, 'on_booking', 'all', 'confirmed'),

  ('rental_new', 'Conferma Noleggio', 'Messaggio inviato alla creazione di una prenotazione noleggio',
   '*Nuova Prenotazione*\n\n*ID:* {booking_id}\n*Cliente:* {customer_name}\n*Tel:* {customer_phone}\n*Veicolo:* {vehicle_name}\n*Targa:* {plate}\n*Ritiro:* {pickup_date} alle {pickup_time}\n*Riconsegna:* {dropoff_date} alle {dropoff_time}\n*Luogo Ritiro:* {pickup_location}\n*Assicurazione:* {insurance}\n*Cauzione:* {deposit}\n*KM:* {km_info}\n*Totale:* €{total}\n*Pagamento:* {payment_status}',
   true, true, 'on_booking', 'all', 'confirmed'),

  ('rental_modified', 'Noleggio Modificato', 'Messaggio inviato alla modifica di una prenotazione noleggio',
   '*Prenotazione Modificata*\n\n*ID:* {booking_id}\n*Cliente:* {customer_name}\n*Veicolo:* {vehicle_name}\n*Ritiro:* {pickup_date} alle {pickup_time}\n*Riconsegna:* {dropoff_date} alle {dropoff_time}\n*Totale:* €{total}',
   true, true, 'on_booking', 'all', 'confirmed'),

  ('supercar_day_before', 'Promemoria Supercar (giorno prima)', 'Offerta estensione per supercar il giorno prima del ritiro',
   'Ciao {nome},\ndomani è il grande giorno.\nLa tua {vehicle_name} è pronta per te.\n\nVuoi prolungare l''esperienza con un giorno extra a prezzo dedicato? Rispondi a questo messaggio.\n\nA domani,\nDR7',
   true, true, 'before_pickup', 'exotic', 'confirmed'),

  ('utilitaria_day_before', 'Promemoria Utilitaria (giorno prima)', 'Offerta estensione per utilitaria il giorno prima del ritiro',
   'Ciao {nome},\nti ricordiamo che domani puoi ritirare la tua {vehicle_name}.\n\nSe vuoi prolungare il noleggio, faccelo sapere rispondendo qui.\n\nA domani,\nDR7',
   true, true, 'before_pickup', 'urban', 'confirmed'),

  ('deposit_return_iban', 'Richiesta IBAN Cauzione', 'Richiesta IBAN per restituzione cauzione dopo fine noleggio',
   'Ciao {nome},\nsperiamo che il noleggio della {vehicle_name} sia andato bene.\n\nPer procedere alla restituzione della cauzione, ti chiediamo gentilmente di inviarci il tuo IBAN rispondendo a questo messaggio.\n\nGrazie,\nDR7',
   true, true, 'after_dropoff', 'all', 'completed'),

  ('checkin_reminder', 'Promemoria Check-in', 'Messaggio inviato prima del ritiro con istruzioni',
   'Ciao {nome}!\n\nTi ricordiamo il ritiro della tua {vehicle_name} ({targa}).\n\n*Quando:* {pickup_date} alle {pickup_time}\n*Dove:* {pickup_location}\n\nPorta con te patente e documento d''identità.\n\nA presto!\nDR7',
   true, true, 'before_pickup', 'all', 'confirmed'),

  ('checkout_reminder', 'Promemoria Check-out', 'Messaggio inviato prima della riconsegna con istruzioni',
   'Ciao {nome}!\n\nTi ricordiamo la riconsegna della {vehicle_name} ({targa}).\n\n*Quando:* {dropoff_date} alle {dropoff_time}\n*Dove:* {dropoff_location}\n\nAssicurati che il veicolo sia nelle stesse condizioni del ritiro.\n\nGrazie!\nDR7',
   true, true, 'before_dropoff', 'all', 'confirmed'),

  ('birthday_message', 'Auguri Compleanno', 'Messaggio inviato 10 giorni prima del compleanno con codice sconto',
   'Ciao {nome} 👋🏻\n\nmancano esattamente 10 giorni a una data speciale: il tuo compleanno 🥳\n\nPer questo ti abbiamo riservato:\n\nCredito personale di €100 utilizzabile per un noleggio DR7\nBuono sconto di €10 per un lavaggio auto DR7\n\nCODICE SCONTO: {codice}\n\nTi basterà rispondere a questo messaggio per attivare il tuo credito.\n\nCon stima,\nDR7',
   true, true, 'before_pickup', 'all', 'confirmed')

ON CONFLICT (message_key) DO NOTHING;
