-- Check a few bookings to see the date format
SELECT 
  id,
  vehicle_name,
  customer_name,
  pickup_date,
  dropoff_date,
  EXTRACT(DAY FROM pickup_date::timestamp) as pickup_day,
  EXTRACT(DAY FROM dropoff_date::timestamp) as dropoff_day
FROM bookings 
WHERE service_type IS NULL 
  AND status != 'cancelled'
ORDER BY pickup_date DESC
LIMIT 5;
