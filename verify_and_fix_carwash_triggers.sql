-- Verify and fix car wash triggers
-- Run this in your Supabase SQL Editor

-- 1. Check if the triggers exist
SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('trigger_auto_carwash_on_insert', 'trigger_auto_carwash_on_update', 'update_linked_carwash_trigger')
ORDER BY trigger_name;

-- 2. Check if the functions exist
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name IN ('auto_create_carwash_on_booking', 'update_linked_carwash_on_rental_change')
ORDER BY routine_name;

-- 3. Test: Find a rental booking and its linked car wash
SELECT 
  r.id as rental_id,
  r.vehicle_name,
  r.dropoff_date as rental_dropoff,
  cw.id as carwash_id,
  cw.appointment_date as carwash_appointment,
  cw.booking_details->>'source_booking_id' as linked_to_rental
FROM bookings r
LEFT JOIN bookings cw ON cw.booking_details->>'source_booking_id' = r.id::text
WHERE r.service_type IS NULL OR r.service_type IN ('rental', 'car_rental')
  AND r.status != 'cancelled'
  AND cw.service_type = 'car_wash'
ORDER BY r.dropoff_date DESC
LIMIT 10;
