-- Step 1: Find Ophelie's booking from Jan 12, 2026
SELECT 
  id as rental_id,
  vehicle_name,
  vehicle_plate,
  customer_name,
  TO_CHAR(pickup_date, 'YYYY-MM-DD HH24:MI') as pickup,
  TO_CHAR(dropoff_date, 'YYYY-MM-DD HH24:MI') as dropoff,
  dropoff_date as dropoff_timestamp
FROM bookings
WHERE customer_name ILIKE '%Ophelie%Giraud%'
  AND (service_type IS NULL OR service_type IN ('rental', 'car_rental'))
  AND status != 'cancelled'
  AND pickup_date >= '2026-01-12'
ORDER BY pickup_date DESC
LIMIT 5;

-- Step 2: After finding the booking ID, create the car wash
-- Replace 'RENTAL_ID', 'VEHICLE_NAME', 'VEHICLE_PLATE', and 'DROPOFF_TIMESTAMP' with values from Step 1

INSERT INTO bookings (
  service_type,
  service_name,
  vehicle_name,
  vehicle_plate,
  customer_name,
  customer_email,
  customer_phone,
  guest_name,
  guest_email,
  guest_phone,
  appointment_date,
  appointment_time,
  pickup_date,
  dropoff_date,
  pickup_location,
  dropoff_location,
  price_total,
  currency,
  status,
  payment_status,
  booking_details,
  created_at
) VALUES (
  'car_wash',
  'Lavaggio Completo',
  'VEHICLE_NAME',  -- Replace with actual vehicle name from Step 1
  'VEHICLE_PLATE',  -- Replace with actual plate from Step 1
  'Lavaggio Rientro',
  NULL,
  NULL,
  'Lavaggio Rientro',
  NULL,
  NULL,
  'DROPOFF_TIMESTAMP'::timestamptz,  -- Replace with dropoff_timestamp from Step 1
  TO_CHAR('DROPOFF_TIMESTAMP'::timestamptz, 'HH24:MI'),  -- Replace
  'DROPOFF_TIMESTAMP'::timestamptz,  -- Replace
  'DROPOFF_TIMESTAMP'::timestamptz + INTERVAL '45 minutes',  -- Replace
  'DR7 Empire - Car Wash',
  'DR7 Empire - Car Wash',
  0,
  'EUR',
  'confirmed',
  'paid',
  jsonb_build_object(
    'auto_created', true,
    'manually_created', true,
    'source_booking_id', 'RENTAL_ID',  -- Replace with rental ID from Step 1
    'source_vehicle', 'VEHICLE_NAME',  -- Replace
    'original_dropoff', 'DROPOFF_TIMESTAMP'::timestamptz,  -- Replace
    'notes', 'Lavaggio creato manualmente - trigger non ha funzionato'
  ),
  NOW()
);

-- Step 3: Verify the car wash was created
SELECT 
  r.id as rental_id,
  r.vehicle_name,
  TO_CHAR(r.dropoff_date, 'YYYY-MM-DD HH24:MI') as rental_dropoff,
  cw.id as carwash_id,
  TO_CHAR(cw.appointment_date, 'YYYY-MM-DD HH24:MI') as carwash_appointment,
  '✅ Created!' as status
FROM bookings r
LEFT JOIN bookings cw ON cw.booking_details->>'source_booking_id' = r.id::text
WHERE r.customer_name ILIKE '%Ophelie%Giraud%'
  AND r.pickup_date >= '2026-01-12'
  AND cw.service_type = 'car_wash';
