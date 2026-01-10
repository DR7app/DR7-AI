-- Check actual booking data to see what's stored
SELECT 
  id,
  customer_name,
  vehicle_name,
  pickup_date,
  dropoff_date,
  -- Extract just the date part
  pickup_date::date as pickup_date_only,
  dropoff_date::date as dropoff_date_only,
  -- Show what day it would be in Rome
  (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date as pickup_rome_date,
  (dropoff_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date as dropoff_rome_date,
  status
FROM bookings 
WHERE pickup_date >= '2026-01-01' 
  AND pickup_date < '2026-02-01'
  AND status IN ('confirmed', 'pending')
  AND service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service')
ORDER BY pickup_date
LIMIT 10;
