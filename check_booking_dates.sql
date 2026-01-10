-- Check booking dates to diagnose calendar mismatch
SELECT 
  id,
  vehicle_name,
  vehicle_plate,
  pickup_date,
  dropoff_date,
  -- Extract date parts in UTC
  EXTRACT(DAY FROM pickup_date AT TIME ZONE 'UTC') as pickup_day_utc,
  EXTRACT(MONTH FROM pickup_date AT TIME ZONE 'UTC') as pickup_month_utc,
  -- Extract date parts in Europe/Rome timezone
  EXTRACT(DAY FROM pickup_date AT TIME ZONE 'Europe/Rome') as pickup_day_rome,
  EXTRACT(MONTH FROM pickup_date AT TIME ZONE 'Europe/Rome') as pickup_month_rome,
  EXTRACT(DAY FROM dropoff_date AT TIME ZONE 'Europe/Rome') as dropoff_day_rome,
  EXTRACT(MONTH FROM dropoff_date AT TIME ZONE 'Europe/Rome') as dropoff_month_rome,
  status
FROM bookings 
WHERE status != 'cancelled' 
  AND (service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical', 'mechanical_service'))
  AND EXTRACT(MONTH FROM pickup_date AT TIME ZONE 'Europe/Rome') = 1
  AND EXTRACT(YEAR FROM pickup_date AT TIME ZONE 'Europe/Rome') = 2026
ORDER BY pickup_date 
LIMIT 10;
