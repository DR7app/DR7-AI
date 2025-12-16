-- Find the conflicting booking
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    booking_source,
    created_at
FROM bookings
WHERE id = '76152554-7cc7-4769-a005-49fbfcea73b0';

-- Check if there are any triggers on the bookings table
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'bookings';

-- Check for any unique constraints that might be causing this
SELECT
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'bookings';
