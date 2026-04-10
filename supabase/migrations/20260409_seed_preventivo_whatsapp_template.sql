-- Seed preventivo_whatsapp template in system_messages
INSERT INTO system_messages (message_key, message_body, include_header, is_enabled, description)
VALUES (
  'preventivo_whatsapp',
  E'Preventivo {vehicle_name}\n\n{breakdown}\n\nQuesto preventivo è valido per 24 ore.\n\nPer confermare, ci contatti o risponda a questo messaggio.\n\nCordiali Saluti,\nDR7',
  false,
  true,
  'Messaggio WhatsApp inviato al cliente con il preventivo. Variabili: {vehicle_name}, {rental_days}, {daily_rate}, {pickup_date}, {dropoff_date}, {total_final}, {subtotal}, {customer_name}, {insurance_option}, {km_info}, {breakdown}, {sconto}, {sconto_note}'
)
ON CONFLICT (message_key) DO NOTHING;
