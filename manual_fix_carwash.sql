-- Manual fix for car wash booking that didn't auto-update
-- Run this in your Supabase SQL Editor AFTER verifying the triggers

-- Step 1: Find the rental booking you just extended and its linked car wash
-- Replace 'YOUR_RENTAL_ID' with the actual booking ID you just extended
WITH rental_info AS (
  SELECT 
    id,
    vehicle_name,
    vehicle_plate,
    dropoff_date,
    dropoff_date + INTERVAL '45 minutes' as carwash_end
  FROM bookings
  WHERE id = 'YOUR_RENTAL_ID'  -- <-- REPLACE THIS WITH YOUR BOOKING ID
)
SELECT 
  r.id as rental_id,
  r.vehicle_name,
  r.dropoff_date as new_rental_dropoff,
  cw.id as carwash_id,
  cw.appointment_date as current_carwash_time,
  r.dropoff_date as should_be_carwash_time,
  CASE 
    WHEN cw.appointment_date = r.dropoff_date THEN '✅ Already correct'
    ELSE '❌ Needs update'
  END as status
FROM rental_info r
LEFT JOIN bookings cw ON cw.booking_details->>'source_booking_id' = r.id::text
WHERE cw.service_type = 'car_wash';

-- Step 2: If the car wash needs updating, run this:
-- (Replace 'YOUR_CARWASH_ID' with the ID from Step 1)
UPDATE bookings
SET 
  appointment_date = (
    SELECT dropoff_date 
    FROM bookings 
    WHERE id = 'YOUR_RENTAL_ID'  -- <-- REPLACE THIS
  ),
  appointment_time = TO_CHAR(
    (SELECT dropoff_date FROM bookings WHERE id = 'YOUR_RENTAL_ID'),  -- <-- REPLACE THIS
    'HH24:MI'
  ),
  pickup_date = (
    SELECT dropoff_date 
    FROM bookings 
    WHERE id = 'YOUR_RENTAL_ID'  -- <-- REPLACE THIS
  ),
  dropoff_date = (
    SELECT dropoff_date + INTERVAL '45 minutes'
    FROM bookings 
    WHERE id = 'YOUR_RENTAL_ID'  -- <-- REPLACE THIS
  ),
  booking_details = booking_details || jsonb_build_object(
    'manually_updated', true,
    'updated_at', NOW()
  )
WHERE id = 'YOUR_CARWASH_ID';  -- <-- REPLACE THIS WITH CARWASH ID FROM STEP 1
