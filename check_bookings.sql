-- EMERGENCY REVERT: Restore Calendar bookings display
-- This script will show you what's in the database

-- First, let's see what bookings exist
SELECT 
  id,
  vehicle_id,
  vehicle_name,
  vehicle_plate,
  pickup_date,
  dropoff_date,
  status,
  customer_name
FROM bookings
WHERE status != 'cancelled'
  AND pickup_date IS NOT NULL
ORDER BY pickup_date DESC
LIMIT 20;

-- Check if vehicle_id is populated
SELECT 
  COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL) as with_vehicle_id,
  COUNT(*) FILTER (WHERE vehicle_id IS NULL) as without_vehicle_id,
  COUNT(*) as total
FROM bookings
WHERE status != 'cancelled';
