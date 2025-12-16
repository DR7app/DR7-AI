-- Find the exact constraint or trigger causing "Vehicle already booked via admin"

-- 1. Check all constraints on bookings table
SELECT
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'bookings'::regclass
ORDER BY conname;

-- 2. Check all triggers on bookings table
SELECT
    tgname AS trigger_name,
    tgtype,
    tgenabled,
    pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgrelid = 'bookings'::regclass
    AND tgisinternal = false
ORDER BY tgname;

-- 3. Look for the specific conflicting booking
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    booking_source,
    service_type
FROM bookings
WHERE id = '76152554-7cc7-4769-a005-49fbfcea73b0';

-- 4. Check if there's a unique index causing conflicts
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'bookings'
    AND indexdef ILIKE '%unique%';
