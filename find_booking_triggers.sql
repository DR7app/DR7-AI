-- Find all functions related to bookings
SELECT 
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
    AND (
        routine_name ILIKE '%booking%' 
        OR routine_name ILIKE '%vehicle%'
        OR routine_name ILIKE '%availability%'
    );

-- Find all triggers on bookings table
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'bookings'
ORDER BY trigger_name;

-- Check for the specific conflicting booking
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_local,
    status,
    booking_source
FROM bookings
WHERE id = '76152554-7cc7-4769-a005-49fbfcea73b0';
