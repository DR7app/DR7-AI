-- Verifica pagamento di Gabriele Mudu — solo i suoi booking
SELECT
  id,
  customer_name,
  customer_email,
  vehicle_name,
  vehicle_plate,
  pickup_date,
  price_total / 100.0  AS price_total_eur,
  amount_paid / 100.0  AS amount_paid_eur,
  (price_total - amount_paid) / 100.0 AS residuo_eur,
  payment_status,
  payment_method,
  booking_details->>'nexi_paid_at'      AS nexi_paid_at,
  booking_details->>'nexi_payment_link' AS nexi_link,
  created_at
FROM public.bookings
WHERE LOWER(customer_name) LIKE '%mudu%'
   OR LOWER(customer_email) LIKE '%mudu%'
ORDER BY created_at DESC;
