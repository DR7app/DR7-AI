-- Repair the broken preventivo_whatsapp seed (used {breakdown} which the code never
-- substituted, so messages shipped with literal "{breakdown}" in them).
--
-- Intentionally NON-destructive:
--  * If the row is missing, insert the canonical template.
--  * If the row exists AND still has the broken body (contains literal "{breakdown}"
--    or is the exact known-broken seed), rewrite it.
--  * Otherwise leave it alone — the admin edited it from the UI and we must not
--    clobber their customisation.
INSERT INTO system_messages (message_key, message_body, include_header, is_enabled, description)
VALUES (
  'preventivo_whatsapp',
  E'Preventivo *{vehicle_specs}*\n\n*Ritiro:* {pickup_date} alle {pickup_time}\n*Riconsegna:* {dropoff_date} alle {dropoff_time}\n\n{pricing_lines}\n\nTotale = {subtotal}\n*{sconto}*\n\n*DR7*',
  false,
  true,
  'Messaggio WhatsApp inviato al cliente con il preventivo. Variabili: {vehicle_name}, {vehicle_specs}, {rental_days}, {daily_rate}, {rental_total}, {pricing_lines}, {breakdown}, {insurance_line}, {insurance_option}, {km_info}, {subtotal}, {total}, {total_final}, {sconto}, {sconto_note}, {customer_name}, {pickup_date}, {pickup_time}, {dropoff_date}, {dropoff_time}'
)
ON CONFLICT (message_key) DO NOTHING;

UPDATE system_messages
SET message_body = E'Preventivo *{vehicle_specs}*\n\n*Ritiro:* {pickup_date} alle {pickup_time}\n*Riconsegna:* {dropoff_date} alle {dropoff_time}\n\n{pricing_lines}\n\nTotale = {subtotal}\n*{sconto}*\n\n*DR7*',
    description  = 'Messaggio WhatsApp inviato al cliente con il preventivo. Variabili: {vehicle_name}, {vehicle_specs}, {rental_days}, {daily_rate}, {rental_total}, {pricing_lines}, {breakdown}, {insurance_line}, {insurance_option}, {km_info}, {subtotal}, {total}, {total_final}, {sconto}, {sconto_note}, {customer_name}, {pickup_date}, {pickup_time}, {dropoff_date}, {dropoff_time}'
WHERE message_key = 'preventivo_whatsapp'
  AND message_body LIKE '%{breakdown}%';
