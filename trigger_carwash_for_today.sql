-- Quick test to verify the trigger and create a car wash booking for today's returns
-- Run this in Supabase SQL Editor

-- Step 1: Check if there are any returns today that should have car wash bookings
SELECT 
  id,
  vehicle_name,
  customer_name,
  dropoff_date,
  service_type,
  status
FROM bookings
WHERE DATE(dropoff_date) = CURRENT_DATE
  AND (service_type IS NULL OR service_type = 'rental')
  AND status != 'cancelled'
ORDER BY dropoff_date;

-- Step 2: Check if car wash bookings exist for today
SELECT 
  id,
  vehicle_name,
  customer_name,
  service_type,
  service_name,
  appointment_date,
  appointment_time,
  booking_details->>'auto_created' as auto_created
FROM bookings
WHERE service_type = 'car_wash'
  AND DATE(appointment_date) = CURRENT_DATE
ORDER BY appointment_date;

-- Step 3: Manually trigger car wash creation for existing returns
-- This will create car wash bookings for the returns you see in the screenshot
UPDATE bookings
SET dropoff_date = dropoff_date  -- This triggers the UPDATE trigger
WHERE DATE(dropoff_date) = CURRENT_DATE
  AND (service_type IS NULL OR service_type = 'rental')
  AND status != 'cancelled'
  AND id IN (
    -- Only update bookings that don't already have a car wash
    SELECT b.id FROM bookings b
    WHERE DATE(b.dropoff_date) = CURRENT_DATE
      AND (b.service_type IS NULL OR b.service_type = 'rental')
      AND b.status != 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM bookings cw
        WHERE cw.service_type = 'car_wash'
          AND cw.vehicle_name = b.vehicle_name
          AND cw.appointment_date >= b.dropoff_date - INTERVAL '5 minutes'
          AND cw.appointment_date <= b.dropoff_date + INTERVAL '2 hours'
      )
  );

-- Step 4: Verify car wash bookings were created
SELECT 
  id,
  vehicle_name,
  customer_name,
  service_name,
  appointment_date,
  appointment_time,
  status,
  booking_details->>'auto_created' as auto_created,
  booking_details->>'source_vehicle' as source_vehicle
FROM bookings
WHERE service_type = 'car_wash'
  AND DATE(appointment_date) = CURRENT_DATE
ORDER BY appointment_date;
