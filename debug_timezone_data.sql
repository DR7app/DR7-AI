-- Debug timezone handling for bookings
-- This script examines how dates are stored and how they should be interpreted

-- 1. Check the actual data type of pickup_date and dropoff_date
SELECT 
  column_name,
  data_type,
  datetime_precision,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'bookings'
  AND column_name IN ('pickup_date', 'dropoff_date');

-- 2. Sample actual booking data with timezone conversions
SELECT 
  id,
  customer_name,
  vehicle_name,
  -- Raw values from DB
  pickup_date as pickup_raw_utc,
  dropoff_date as dropoff_raw_utc,
  -- Data types
  pg_typeof(pickup_date) as pickup_type,
  -- Convert to Europe/Rome timezone
  pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome' as pickup_rome,
  dropoff_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome' as dropoff_rome,
  -- Extract date components in Rome timezone
  EXTRACT(YEAR FROM (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')) as pickup_year,
  EXTRACT(MONTH FROM (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')) as pickup_month,
  EXTRACT(DAY FROM (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')) as pickup_day,
  EXTRACT(HOUR FROM (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')) as pickup_hour,
  -- Check if stored as local time incorrectly
  CASE 
    WHEN EXTRACT(DAY FROM pickup_date) != EXTRACT(DAY FROM (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome'))
    THEN 'DAY SHIFT DETECTED'
    ELSE 'Same day'
  END as day_shift_check,
  status,
  created_at
FROM bookings 
WHERE pickup_date IS NOT NULL 
  AND status IN ('confirmed', 'pending')
  AND pickup_date >= '2026-01-01'
ORDER BY pickup_date DESC 
LIMIT 10;

-- 3. Check for bookings in January 2026 specifically
SELECT 
  COUNT(*) as total_bookings,
  COUNT(CASE WHEN EXTRACT(DAY FROM pickup_date) != EXTRACT(DAY FROM (pickup_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')) THEN 1 END) as bookings_with_day_shift
FROM bookings
WHERE pickup_date >= '2026-01-01' 
  AND pickup_date < '2026-02-01'
  AND status IN ('confirmed', 'pending');
