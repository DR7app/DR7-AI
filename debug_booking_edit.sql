-- DEBUG: Check what's happening with this specific booking
-- Run this in Supabase SQL Editor to see the issue

-- 1. Check the booking you're trying to edit
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    service_type
FROM bookings
WHERE id = 'e3fdca9d-d967-4212-89a2-8a9708292e4f';

-- 2. Check if there are other bookings for the same vehicle
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    service_type
FROM bookings
WHERE vehicle_plate = (
    SELECT vehicle_plate FROM bookings WHERE id = 'e3fdca9d-d967-4212-89a2-8a9708292e4f'
)
AND status NOT IN ('cancelled', 'returned')
ORDER BY pickup_date;

-- 3. Check the check_unified_vehicle_availability function
SELECT routine_definition 
FROM information_schema.routines 
WHERE routine_name = 'check_unified_vehicle_availability';
