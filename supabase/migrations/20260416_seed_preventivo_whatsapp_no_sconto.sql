-- Seed preventivo_whatsapp_no_sconto template in system_messages
-- Used by PreventiviTab when the preventivo has no discount applied.
-- Identical to preventivo_whatsapp but without the {sconto} line.
INSERT INTO system_messages (message_key, label, message_body, include_header, is_enabled, description)
VALUES (
  'preventivo_whatsapp_no_sconto',
  'Preventivo WhatsApp (senza sconto)',
  E'Preventivo {vehicle_name}\n\n{breakdown}\n\nQuesto preventivo è valido per 24 ore.\n\nPer confermare, ci contatti o risponda a questo messaggio.\n\nCordiali Saluti,\nDR7',
  false,
  true,
  'Messaggio WhatsApp inviato al cliente quando il preventivo NON ha sconto. Variabili: {vehicle_name}, {rental_days}, {daily_rate}, {pickup_date}, {dropoff_date}, {total_final}, {subtotal}, {customer_name}, {insurance_option}, {km_info}, {breakdown}, {pricing_lines}'
)
ON CONFLICT (message_key) DO NOTHING;
