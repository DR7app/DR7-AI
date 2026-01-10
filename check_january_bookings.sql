-- Check what's actually stored in the database for January bookings
SELECT 
  customer_name,
  vehicle_name,
  pickup_date,
  dropoff_date,
  -- Show what day these should appear on in Rome timezone
  EXTRACT(DAY FROM pickup_date AT TIME ZONE 'Europe/Rome') as pickup_day_rome,
  EXTRACT(DAY FROM dropoff_date AT TIME ZONE 'Europe/Rome') as dropoff_day_rome,
  EXTRACT(MONTH FROM pickup_date AT TIME ZONE 'Europe/Rome') as pickup_month_rome,
  EXTRACT(MONTH FROM dropoff_date AT TIME ZONE 'Europe/Rome') as dropoff_month_rome
FROM bookings 
WHERE pickup_date >= '2026-01-01' 
  AND pickup_date < '2026-02-01'
  AND status IN ('confirmed', 'pending')
  AND (service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service'))
ORDER BY pickup_date
LIMIT 10;
