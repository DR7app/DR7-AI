-- Backfill script to fix out-of-sync automatic car wash bookings
-- This updates all "Lavaggio Rientro" bookings to match their source rental's current dropoff date

-- First, let's see which car washes are out of sync
SELECT 
  r.id as rental_id,
  r.vehicle_name,
  r.vehicle_plate,
  r.dropoff_date as rental_dropoff,
  cw.id as carwash_id,
  cw.appointment_date as carwash_appointment,
  (r.dropoff_date - cw.appointment_date) as time_difference
FROM bookings r
JOIN bookings cw ON cw.booking_details->>'source_booking_id' = r.id::text
WHERE r.service_type IN ('rental', 'car_rental') OR r.service_type IS NULL
  AND cw.service_type = 'car_wash'
  AND cw.customer_name = 'Lavaggio Rientro'
  AND cw.status != 'cancelled'
  AND r.status != 'cancelled'
  AND r.dropoff_date != cw.appointment_date
ORDER BY r.dropoff_date DESC;

-- Now update all out-of-sync car washes to match their rental's dropoff date
UPDATE bookings AS cw
SET 
  appointment_date = r.dropoff_date,
  appointment_time = TO_CHAR(r.dropoff_date, 'HH24:MI'),
  pickup_date = r.dropoff_date,
  dropoff_date = r.dropoff_date + INTERVAL '45 minutes',
  booking_details = cw.booking_details || jsonb_build_object(
    'backfilled_at', NOW(),
    'previous_appointment_date', cw.appointment_date,
    'synced_with_rental', r.id
  )
FROM bookings r
WHERE cw.booking_details->>'source_booking_id' = r.id::text
  AND (r.service_type IN ('rental', 'car_rental') OR r.service_type IS NULL)
  AND cw.service_type = 'car_wash'
  AND cw.customer_name = 'Lavaggio Rientro'
  AND cw.status != 'cancelled'
  AND r.status != 'cancelled'
  AND r.dropoff_date != cw.appointment_date;

-- Verify the update
SELECT 
  COUNT(*) as updated_count,
  'Car washes synchronized with rental dropoff dates' as message
FROM bookings cw
WHERE cw.booking_details->>'backfilled_at' IS NOT NULL;
