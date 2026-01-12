-- Fix Ophelie's car wash booking to match the extended rental
-- Rental: 8c361b44-11c9-4b20-b8ae-12d54d32aadb (Fiat Panda Grey)
-- Car wash: 33049e8d-21e3-4101-ba2b-860eeab9d7ee
-- New return time: 2026-01-13 14:45

UPDATE bookings
SET 
  appointment_date = '2026-01-13 14:45:00+01'::timestamptz,
  appointment_time = '14:45',
  pickup_date = '2026-01-13 14:45:00+01'::timestamptz,
  dropoff_date = '2026-01-13 15:30:00+01'::timestamptz,  -- 45 minutes later
  booking_details = booking_details || jsonb_build_object(
    'manually_updated', true,
    'updated_at', NOW(),
    'reason', 'Trigger did not fire - manually synced with rental extension'
  )
WHERE id = '33049e8d-21e3-4101-ba2b-860eeab9d7ee';

-- Verify the fix
SELECT 
  r.id as rental_id,
  r.vehicle_name,
  TO_CHAR(r.dropoff_date, 'YYYY-MM-DD HH24:MI') as rental_dropoff,
  cw.id as carwash_id,
  TO_CHAR(cw.appointment_date, 'YYYY-MM-DD HH24:MI') as carwash_appointment,
  CASE 
    WHEN cw.appointment_date = r.dropoff_date THEN '✅ FIXED - In sync!'
    ELSE '❌ Still out of sync'
  END as status
FROM bookings r
JOIN bookings cw ON cw.id = '33049e8d-21e3-4101-ba2b-860eeab9d7ee'
WHERE r.id = '8c361b44-11c9-4b20-b8ae-12d54d32aadb';
