-- All Nexi transactions involving Manolo Cherchi. Look at status + amount
-- + created_at — if a row says 'preauth_held' but the booking is paid,
-- that row is what's showing "Pre-autorizzato" wrongly.

SELECT
  id,
  order_id,
  contract_id,
  status,
  amount_cents,
  amount_cents / 100.0 AS amount_eur,
  description,
  customer_email,
  booking_id,
  created_at,
  updated_at
FROM public.nexi_transactions
WHERE LOWER(customer_email) = LOWER('manolcherch19@icloud.com')
   OR LOWER(description) LIKE '%manolo%cherchi%'
   OR booking_id IN (
       SELECT id FROM public.bookings
       WHERE LOWER(customer_email) = LOWER('manolcherch19@icloud.com')
          OR LOWER(customer_name) LIKE '%manolo%cherchi%'
   )
ORDER BY created_at DESC;
