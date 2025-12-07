-- Fix Fiat Panda Bianca booking conflict
-- Giovanni Ladu should have GK837BP
-- Davide Fani should be moved to the other Fiat Panda Bianca

-- Step 1: Check current bookings for both customers
SELECT
  id,
  customer_name,
  customer_email,
  vehicle_name,
  vehicle_plate,
  pickup_date,
  dropoff_date,
  status
FROM bookings
WHERE customer_email IN ('giovanni.ladu.01@gmail.com', 'davide.fani@example.com')
  OR customer_name ILIKE '%giovanni%ladu%'
  OR customer_name ILIKE '%davide%fani%'
ORDER BY pickup_date;

-- Step 2: Find all Fiat Panda Bianca vehicles to see available targas
SELECT
  id,
  display_name,
  plate,
  status,
  metadata->>'display_group' as display_group
FROM vehicles
WHERE display_name ILIKE '%panda%bianca%'
ORDER BY plate;

-- Step 3: Update Davide Fani's booking to use the other Fiat Panda Bianca
-- First, let's see what the other targa is (run query above first to see)
-- Then update Davide's booking:

UPDATE bookings
SET
  vehicle_name = 'Fiat Panda Benzina (Bianca)',
  vehicle_plate = (
    SELECT plate
    FROM vehicles
    WHERE display_name ILIKE '%panda%bianca%'
      AND plate != 'GK837BP'
    LIMIT 1
  )
WHERE (customer_name ILIKE '%davide%fani%' OR customer_email LIKE '%davide%fani%')
  AND vehicle_name ILIKE '%panda%'
  AND status != 'cancelled';

-- Step 4: Verify the fix
SELECT
  id,
  customer_name,
  customer_email,
  vehicle_name,
  vehicle_plate,
  pickup_date,
  dropoff_date,
  status
FROM bookings
WHERE (customer_email IN ('giovanni.ladu.01@gmail.com') OR customer_name ILIKE '%giovanni%ladu%')
   OR (customer_name ILIKE '%davide%fani%' OR customer_email LIKE '%davide%fani%')
ORDER BY pickup_date;
