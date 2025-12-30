-- Backfill vehicle_id for existing bookings
-- This fixes the Calendar display issue after the vehicle_id matching update

UPDATE bookings
SET vehicle_id = vehicles.id
FROM vehicles
WHERE bookings.vehicle_id IS NULL
  AND bookings.vehicle_plate IS NOT NULL
  AND vehicles.plate = bookings.vehicle_plate;

-- For bookings without plate, try to match by name
UPDATE bookings
SET vehicle_id = vehicles.id
FROM vehicles
WHERE bookings.vehicle_id IS NULL
  AND bookings.vehicle_name IS NOT NULL
  AND vehicles.display_name = bookings.vehicle_name;

SELECT 
  COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL) as bookings_with_vehicle_id,
  COUNT(*) FILTER (WHERE vehicle_id IS NULL) as bookings_without_vehicle_id,
  COUNT(*) as total_bookings
FROM bookings
WHERE status != 'cancelled';
