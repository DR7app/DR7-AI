-- Find and delete ALL duplicate bookings (BOTH Noleggio AND Lavaggio)
-- This script identifies duplicates and keeps only the OLDEST booking for each duplicate set

-- ============================================
-- PART 1: NOLEGGIO (Car Rental) DUPLICATES
-- ============================================

-- Step 1A: Find all RENTAL duplicates
WITH duplicate_rentals AS (
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
        AND (service_type IS NULL OR service_type != 'car_wash')  -- Rental bookings
    GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
    HAVING COUNT(*) > 1
)
SELECT 
    'NOLEGGIO' as type,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date::date as pickup,
    dropoff_date::date as dropoff,
    duplicate_count,
    booking_ids,
    created_dates
FROM duplicate_rentals
ORDER BY duplicate_count DESC, customer_name;

-- ============================================
-- PART 2: LAVAGGIO (Car Wash) DUPLICATES
-- ============================================

-- Step 1B: Find all CAR WASH duplicates
WITH duplicate_washes AS (
    SELECT 
        customer_name,
        pickup_date,
        service_type,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids,
        ARRAY_AGG(created_at ORDER BY created_at ASC) as created_dates
    FROM bookings
    WHERE status != 'cancelled'
        AND service_type = 'car_wash'
    GROUP BY customer_name, pickup_date, service_type
    HAVING COUNT(*) > 1
)
SELECT 
    'LAVAGGIO' as type,
    customer_name,
    pickup_date::date,
    service_type,
    duplicate_count,
    booking_ids,
    created_dates
FROM duplicate_washes
ORDER BY duplicate_count DESC, customer_name;

-- ============================================
-- STEP 2: DELETE ALL DUPLICATES (UNCOMMENT TO RUN)
-- ============================================

-- Step 2A: Delete RENTAL duplicates (keeps oldest)
-- WITH duplicate_rentals AS (
--     SELECT 
--         customer_name,
--         vehicle_name,
--         vehicle_plate,
--         pickup_date,
--         dropoff_date,
--         ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids
--     FROM bookings
--     WHERE status != 'cancelled'
--         AND (service_type IS NULL OR service_type != 'car_wash')
--     GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
--     HAVING COUNT(*) > 1
-- ),
-- rental_ids_to_delete AS (
--     SELECT UNNEST(booking_ids[2:]) as booking_id
--     FROM duplicate_rentals
-- )
-- -- Delete related contracts first
-- DELETE FROM contracts
-- WHERE booking_id IN (SELECT booking_id FROM rental_ids_to_delete);
-- 
-- WITH duplicate_rentals AS (
--     SELECT 
--         customer_name,
--         vehicle_name,
--         vehicle_plate,
--         pickup_date,
--         dropoff_date,
--         ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids
--     FROM bookings
--     WHERE status != 'cancelled'
--         AND (service_type IS NULL OR service_type != 'car_wash')
--     GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
--     HAVING COUNT(*) > 1
-- ),
-- rental_ids_to_delete AS (
--     SELECT UNNEST(booking_ids[2:]) as booking_id
--     FROM duplicate_rentals
-- )
-- DELETE FROM bookings
-- WHERE id IN (SELECT booking_id FROM rental_ids_to_delete);

-- Step 2B: Delete CAR WASH duplicates (keeps oldest)
-- WITH duplicate_washes AS (
--     SELECT 
--         customer_name,
--         pickup_date,
--         service_type,
--         ARRAY_AGG(id ORDER BY created_at ASC) as booking_ids
--     FROM bookings
--     WHERE status != 'cancelled'
--         AND service_type = 'car_wash'
--     GROUP BY customer_name, pickup_date, service_type
--     HAVING COUNT(*) > 1
-- ),
-- wash_ids_to_delete AS (
--     SELECT UNNEST(booking_ids[2:]) as booking_id
--     FROM duplicate_washes
-- )
-- DELETE FROM bookings
-- WHERE id IN (SELECT booking_id FROM wash_ids_to_delete);

-- ============================================
-- STEP 3: VERIFY (UNCOMMENT TO RUN)
-- ============================================

-- Verify RENTAL duplicates are gone
-- WITH rental_check AS (
--     SELECT 
--         customer_name,
--         vehicle_name,
--         vehicle_plate,
--         pickup_date,
--         dropoff_date,
--         COUNT(*) as count
--     FROM bookings
--     WHERE status != 'cancelled'
--         AND (service_type IS NULL OR service_type != 'car_wash')
--     GROUP BY customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date
--     HAVING COUNT(*) > 1
-- )
-- SELECT 'NOLEGGIO' as type, * FROM rental_check;

-- Verify CAR WASH duplicates are gone
-- WITH wash_check AS (
--     SELECT 
--         customer_name,
--         pickup_date,
--         service_type,
--         COUNT(*) as count
--     FROM bookings
--     WHERE status != 'cancelled'
--         AND service_type = 'car_wash'
--     GROUP BY customer_name, pickup_date, service_type
--     HAVING COUNT(*) > 1
-- )
-- SELECT 'LAVAGGIO' as type, * FROM wash_check;
