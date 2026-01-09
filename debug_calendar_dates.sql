-- Debug calendar booking dates
-- Check how dates are stored and what the calendar should display

SELECT 
  id,
  customer_name,
  vehicle_name,
  pickup_date,
  dropoff_date,
  -- Extract just the date part
  DATE(pickup_date) as pickup_date_only,
  DATE(dropoff_date) as dropoff_date_only,
  -- Extract day of month
  EXTRACT(DAY FROM pickup_date) as pickup_day,
  EXTRACT(DAY FROM dropoff_date) as dropoff_day,
  status,
  service_type
FROM bookings
WHERE 
  service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service', 'mechanical')
  AND status != 'cancelled'
  AND (pickup_date >= '2026-01-01' OR dropoff_date >= '2026-01-01')
ORDER BY pickup_date DESC
LIMIT 10;
