-- Migration: Fix timezone offsets in existing bookings
-- Problem: Bookings were stored with +01:00 offset instead of pure UTC
-- Example: "2026-01-05T11:00:00+01:00" should be "2026-01-05T10:00:00Z"
--
-- This script converts all timestamps to pure UTC by:
-- 1. Parsing the timestamp AT TIME ZONE 'Europe/Rome' (interprets the stored time as Rome time)
-- 2. Converting back to UTC for storage
--
-- IMPORTANT: Run this ONCE. Do not run multiple times as it will shift dates again!

BEGIN;

-- Create backup table first
CREATE TABLE IF NOT EXISTS bookings_backup_20260110 AS 
SELECT * FROM bookings;

-- Show sample of what will change
SELECT 
  id,
  customer_name,
  vehicle_name,
  pickup_date as old_pickup,
  (pickup_date AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC' as new_pickup,
  dropoff_date as old_dropoff,
  (dropoff_date AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC' as new_dropoff
FROM bookings 
WHERE pickup_date >= '2026-01-01'
  AND (service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service'))
LIMIT 5;

-- Prompt user to review before proceeding
-- If the above looks correct, uncomment the UPDATE statements below:

/*
-- Fix pickup_date: interpret stored time as Rome time, convert to UTC
UPDATE bookings
SET pickup_date = (pickup_date AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'
WHERE pickup_date IS NOT NULL
  AND (service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service'));

-- Fix dropoff_date: interpret stored time as Rome time, convert to UTC  
UPDATE bookings
SET dropoff_date = (dropoff_date AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'
WHERE dropoff_date IS NOT NULL
  AND (service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service'));

-- Fix car wash appointment_date
UPDATE bookings
SET appointment_date = (appointment_date AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'
WHERE appointment_date IS NOT NULL
  AND service_type = 'car_wash';

-- Fix mechanical appointment_date
UPDATE bookings
SET appointment_date = (appointment_date AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'
WHERE appointment_date IS NOT NULL
  AND service_type = 'mechanical_service';
*/

-- Verification query (run after UPDATE to confirm)
SELECT 
  'After migration' as status,
  COUNT(*) as total_bookings,
  COUNT(CASE WHEN pickup_date::text LIKE '%+%' THEN 1 END) as with_offset,
  COUNT(CASE WHEN pickup_date::text LIKE '%Z' OR pickup_date::text NOT LIKE '%+%' THEN 1 END) as pure_utc
FROM bookings
WHERE pickup_date IS NOT NULL;

COMMIT;

-- To rollback if something goes wrong:
-- BEGIN;
-- DELETE FROM bookings;
-- INSERT INTO bookings SELECT * FROM bookings_backup_20260110;
-- COMMIT;
