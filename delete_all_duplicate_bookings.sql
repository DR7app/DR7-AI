-- Find and delete ALL duplicate bookings
-- This script identifies duplicates and keeps only the OLDEST booking for each duplicate set

-- Step 1: Find all duplicates
WITH duplicate_bookings AS (
    SELECT 
        customer_name,
        vehicle_name,
        vehicle_plate,
        pickup_date,
        dropoff_date,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids,
        ARRAY_AGG(created_at ORDER BY created_at ASC) as created_dates
    FROM bookings
    WHERE status != 'cancelled'
    GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
    HAVING COUNT(*) > 1
)
SELECT 
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date::date as pickup,
    dropoff_date::date as dropoff,
    duplicate_count,
    booking_ids,
    created_dates
FROM duplicate_bookings
ORDER BY duplicate_count DESC, customer_name;

-- Step 2: After reviewing the duplicates above, uncomment this to DELETE them
-- This will keep the OLDEST booking and delete all newer duplicates

-- WITH duplicate_bookings AS (
--     SELECT 
--         customer_name,
--         vehicle_name,
--         vehicle_plate,
--         pickup_date,
--         dropoff_date,
--         ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids
--     FROM bookings
--     WHERE status != 'cancelled'
--     GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
--     HAVING COUNT(*) > 1
-- ),
-- ids_to_delete AS (
--     SELECT UNNEST(booking_ids[2:]) as booking_id
--     FROM duplicate_bookings
-- )
-- -- First delete related contracts
-- DELETE FROM contracts
-- WHERE booking_id IN (SELECT booking_id FROM ids_to_delete);
-- 
-- -- Then delete the duplicate bookings
-- WITH duplicate_bookings AS (
--     SELECT 
--         customer_name,
--         vehicle_name,
--         vehicle_plate,
--         pickup_date,
--         dropoff_date,
--         ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids
--     FROM bookings
--     WHERE status != 'cancelled'
--     GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
--     HAVING COUNT(*) > 1
-- ),
-- ids_to_delete AS (
--     SELECT UNNEST(booking_ids[2:]) as booking_id
--     FROM duplicate_bookings
-- )
-- DELETE FROM bookings
-- WHERE id IN (SELECT booking_id FROM ids_to_delete);

-- Step 3: Verify - should return 0 rows if all duplicates are removed
-- WITH duplicate_check AS (
--     SELECT 
--         customer_name,
--         vehicle_name,
--         vehicle_plate,
--         pickup_date,
--         dropoff_date,
--         COUNT(*) as count
--     FROM bookings
--     WHERE status != 'cancelled'
--     GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
--     HAVING COUNT(*) > 1
-- )
-- SELECT * FROM duplicate_check;
