-- Test Script for Auto Car Wash Trigger
-- Run this in Supabase SQL Editor to test the automatic car wash booking creation

-- Step 1: Create a test rental booking that will return in 2 minutes
-- This allows us to observe the trigger in action

DO $$
DECLARE
  v_dropoff_time TIMESTAMPTZ;
  v_booking_id UUID;
BEGIN
  -- Set dropoff time to 2 minutes from now
  v_dropoff_time := NOW() + INTERVAL '2 minutes';
  
  -- Insert a test rental booking
  INSERT INTO bookings (
    vehicle_name,
    vehicle_plate,
    customer_name,
    customer_email,
    customer_phone,
    pickup_date,
    dropoff_date,
    pickup_location,
    dropoff_location,
    price_total,
    currency,
    status,
    payment_status,
    booking_details
  ) VALUES (
    'TEST VEHICLE - Fiat 500',
    'TEST123',
    'Test Customer',
    'test@example.com',
    '+39 333 1234567',
    NOW(),
    v_dropoff_time,
    'DR7 Empire',
    'DR7 Empire',
    5000, -- 50 EUR
    'EUR',
    'active',
    'paid',
    jsonb_build_object('test', true, 'notes', 'Test booking for auto car wash trigger')
  )
  RETURNING id INTO v_booking_id;
  
  RAISE NOTICE 'Test booking created with ID: %', v_booking_id;
  RAISE NOTICE 'Dropoff time set to: %', v_dropoff_time;
  RAISE NOTICE 'Wait 2 minutes, then check for auto-created car wash booking...';
END $$;

-- Step 2: After waiting 2 minutes, run this query to check if car wash was created
-- SELECT 
--   id,
--   vehicle_name,
--   service_type,
--   service_name,
--   appointment_date,
--   appointment_time,
--   status,
--   booking_details->>'auto_created' as auto_created,
--   booking_details->>'source_booking_id' as source_booking_id,
--   created_at
-- FROM bookings
-- WHERE service_type = 'car_wash'
--   AND vehicle_name = 'TEST VEHICLE - Fiat 500'
-- ORDER BY created_at DESC
-- LIMIT 1;

-- Step 3: Alternative - Manually trigger by updating the booking to simulate time passing
-- UPDATE bookings
-- SET dropoff_date = NOW() - INTERVAL '1 minute'
-- WHERE vehicle_name = 'TEST VEHICLE - Fiat 500'
--   AND service_type IS NULL
--   AND status != 'cancelled';

-- Step 4: Clean up test data after verification
-- DELETE FROM bookings WHERE vehicle_name = 'TEST VEHICLE - Fiat 500';
