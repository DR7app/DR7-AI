-- Check Riccardo Aru's booking to see exact dates
SELECT 
  id,
  customer_name,
  vehicle_name,
  pickup_date,
  dropoff_date,
  pickup_date::date as pickup_date_only,
  dropoff_date::date as dropoff_date_only,
  EXTRACT(DAY FROM pickup_date) as pickup_day,
  EXTRACT(DAY FROM dropoff_date) as dropoff_day
FROM bookings 
WHERE customer_name ILIKE '%riccardo%'
  AND status != 'cancelled'
ORDER BY created_at DESC
LIMIT 3;
