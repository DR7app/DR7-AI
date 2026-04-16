-- Template for "Da Saldare" bookings with non-Nexi payment (Contanti, Bonifico, etc.)
-- Similar to payment_link_customer but without the Nexi payment link — just tells customer to pay within 1h
-- Sent by ReservationsTab processBookingSubmission when payment_status=pending and payment_method != 'Nexi Pay by Link'

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled, trigger_event, target_category, target_status)
VALUES
('rental_da_saldare_customer', 'Prenotazione Da Saldare (cliente)', 'Inviato al cliente quando prenotazione non pagata (Contanti/Bonifico/etc.) — deve pagare entro 1h',
 'Gentile *{customer_name}*,

La sua prenotazione *#{booking_id}* è stata registrata.

*Veicolo:* {vehicle_name}
*Ritiro:* {pickup_date} alle {pickup_time}
*Riconsegna:* {dropoff_date} alle {dropoff_time}
*Totale:* €{total}

Per confermare la prenotazione, completi il pagamento entro *1 ora*.

*Il link scade tra 1 ora.* In assenza di pagamento, la prenotazione verrà automaticamente annullata.

*Nota importante:* la prenotazione non può essere garantita fino al completamento del pagamento. In caso di mancato pagamento immediato, lo slot potrebbe essere assegnato ad altri clienti che prenotano online.

Grazie,
*DR7*',
 true, true, 'on_booking', 'all', 'confirmed')
ON CONFLICT (message_key) DO NOTHING;
