-- ─────────────────────────────────────────────────────────────────
-- Investiga cosa è successo con Matteo Spada:
--   1) Stato della prenotazione (pagata? confermata? da saldare?)
--   2) Cronologia messaggi WhatsApp inviati al suo numero
--   3) Log dei template di sistema (system_message_send_log) per quella prenotazione
--   4) Eventuali transazioni Nexi
--   5) Anteprima del template DR7 Privilege editato dall'admin
--
-- Cambia il filtro WHERE se cognome/nome non matchano.
-- ─────────────────────────────────────────────────────────────────

-- 1. La prenotazione di Matteo Spada (ultime 7 giorni, ordinate per creazione discendente)
SELECT
  id,
  customer_name,
  customer_phone,
  customer_email,
  vehicle_name,
  vehicle_plate,
  pickup_date,
  dropoff_date,
  status,                                -- pending / confirmed / active / completed / cancelled
  payment_status,                        -- pending / paid / succeeded / completed / unpaid
  payment_method,
  price_total / 100.0 AS price_total_eur,
  amount_paid / 100.0 AS amount_paid_eur,
  dr7_privilege_sent_at,                 -- NULL = privilegio non ancora inviato
  dr7_privilege_code,
  booking_details->>'nexi_payment_link' AS nexi_link,
  booking_details->>'nexi_paid_at'      AS nexi_paid_at,
  created_at,
  updated_at
FROM public.bookings
WHERE (LOWER(customer_name) LIKE '%matteo%spada%'
       OR LOWER(customer_name) LIKE '%spada%matteo%')
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 5;

-- 2. Tutti i WhatsApp loggati per il suo numero (ultime 7 giorni).
--    Vedi quali template sono partiti, quando, e con quale corpo.
SELECT
  sent_at,
  template_label,
  status,                                -- sent / failed / skipped
  LEFT(message_text, 200) AS message_preview,
  customer_phone
FROM public.sent_messages_log
WHERE sent_at > NOW() - INTERVAL '7 days'
  AND (LOWER(customer_name) LIKE '%matteo%spada%'
       OR customer_phone IN (
         SELECT customer_phone FROM public.bookings
         WHERE LOWER(customer_name) LIKE '%matteo%spada%'
         LIMIT 5
       ))
ORDER BY sent_at DESC
LIMIT 30;

-- 3. Log dei template Messaggi di Sistema Pro per la sua prenotazione
--    (mostra ogni template fired dal cron / trigger inline, con dedup)
SELECT
  l.sent_at,
  m.label,
  m.message_key,
  m.trigger_event,
  l.status,
  l.error
FROM public.system_message_send_log l
JOIN public.system_messages m ON m.id = l.system_message_id
WHERE l.booking_id IN (
  SELECT id FROM public.bookings
  WHERE LOWER(customer_name) LIKE '%matteo%spada%'
  ORDER BY created_at DESC
  LIMIT 5
)
ORDER BY l.sent_at DESC
LIMIT 30;

-- 4. Eventuali transazioni Nexi (pay-by-link / preauth) per la prenotazione
SELECT
  id,
  booking_id,
  amount_cents / 100.0 AS amount_eur,
  status,
  order_id,
  payment_link,
  description,
  metadata->>'expires_at' AS expires_at,
  created_at
FROM public.nexi_transactions
WHERE booking_id IN (
  SELECT id FROM public.bookings
  WHERE LOWER(customer_name) LIKE '%matteo%spada%'
  ORDER BY created_at DESC
  LIMIT 5
)
ORDER BY created_at DESC
LIMIT 10;

-- 5. Diagnostica: il template DR7 Privilege editato dall'admin (corpo)
SELECT
  message_key,
  label,
  is_enabled,
  include_header,
  trigger_event,
  LEFT(message_body, 500) AS body_preview
FROM public.system_messages
WHERE message_key = 'pro_dr7_privilege_noleggio'
   OR message_key = 'rental_new_customer'
   OR message_key = 'booking_confirmed_da_saldare'
   OR message_key = 'pro_conferma_noleggio';
