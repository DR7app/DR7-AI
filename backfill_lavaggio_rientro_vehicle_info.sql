-- Backfill vehicle_name and vehicle_plate for existing "Lavaggio Rientro" bookings
-- These bookings were auto-created by the trigger but may be missing vehicle info in the main fields

-- Step 1: Check current state
SELECT 
  id,
  customer_name,
  vehicle_name,
  vehicle_plate,
  booking_details->>'source_vehicle' as source_vehicle_from_details,
  booking_details->>'source_booking_id' as source_booking_id,
  appointment_date
FROM bookings
WHERE customer_name = 'Lavaggio Rientro'
  AND service_type = 'car_wash'
ORDER BY appointment_date DESC
LIMIT 10;

-- Step 2: Update Lavaggio Rientro bookings to populate vehicle_name and vehicle_plate
-- from the source rental booking
UPDATE bookings AS carwash
SET 
  vehicle_name = rental.vehicle_name,
  vehicle_plate = rental.vehicle_plate
FROM bookings AS rental
WHERE carwash.customer_name = 'Lavaggio Rientro'
  AND carwash.service_type = 'car_wash'
  AND carwash.booking_details->>'source_booking_id' = rental.id::text
  AND (carwash.vehicle_name IS NULL OR carwash.vehicle_name = '' OR carwash.vehicle_plate IS NULL OR carwash.vehicle_plate = '');

-- Step 3: Verify the update
SELECT 
  COUNT(*) as total_lavaggio_rientro,
  COUNT(CASE WHEN vehicle_name IS NOT NULL AND vehicle_name != '' THEN 1 END) as with_vehicle_name,
  COUNT(CASE WHEN vehicle_plate IS NOT NULL AND vehicle_plate != '' THEN 1 END) as with_vehicle_plate
FROM bookings
WHERE customer_name = 'Lavaggio Rientro'
  AND service_type = 'car_wash';

-- Step 4: Show any remaining records without vehicle info
SELECT 
  id,
  customer_name,
  vehicle_name,
  vehicle_plate,
  booking_details->>'source_booking_id' as source_booking_id,
  booking_details->>'source_vehicle' as source_vehicle_name,
  appointment_date
FROM bookings
WHERE customer_name = 'Lavaggio Rientro'
  AND service_type = 'car_wash'
  AND (vehicle_name IS NULL OR vehicle_name = '' OR vehicle_plate IS NULL OR vehicle_plate = '')
ORDER BY appointment_date DESC;
