-- Add template for "Booking confirmed but payment pending" message
-- Sent when admin creates a new booking with payment_status = 'pending' (Da Saldare)

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled, trigger_event, target_category, target_status)
VALUES
('rental_confirmed_unpaid', 'Prenotazione Confermata - Da Saldare', 'Inviato al cliente quando l''admin conferma una prenotazione con pagamento in sospeso',
 'Gentile {customer_name},

La sua prenotazione #{booking_id} è stata *confermata*.

*Veicolo:* {vehicle_name}
*Ritiro:* {pickup_date} alle {pickup_time}
*Riconsegna:* {dropoff_date} alle {dropoff_time}
*Totale:* €{total}
*Metodo Pagamento:* {payment_method}

*Stato Pagamento:* Da saldare

La ringraziamo e attendiamo il pagamento per completare la prenotazione.
Riceverà il contratto di noleggio e la fattura non appena il pagamento sarà confermato.

DR7',
 true, true, 'on_booking', 'all', 'confirmed')
ON CONFLICT (message_key) DO NOTHING;
