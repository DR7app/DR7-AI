-- Delete duplicate booking for "ophel luli" with Renault Clio Blue
-- Date: 17/12/2025, 12:30 - 17/12/2025, 11:00

-- First, let's find the duplicate bookings
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    created_at
FROM bookings
WHERE customer_name ILIKE '%ophel%luli%'
    AND vehicle_name ILIKE '%Clio%Blue%'
    AND pickup_date::date = '2025-12-17'
ORDER BY created_at DESC;

-- After confirming which booking to delete, uncomment and run ONE of these:

-- Option 1: Delete the FIRST duplicate (older one)
-- DELETE FROM contracts WHERE booking_id = (
--     SELECT id FROM bookings
--     WHERE customer_name ILIKE '%ophel%luli%'
--         AND vehicle_name ILIKE '%Clio%Blue%'
--         AND pickup_date::date = '2025-12-17'
--     ORDER BY created_at ASC
--     LIMIT 1
-- );
-- 
-- DELETE FROM bookings
-- WHERE id = (
--     SELECT id FROM bookings
--     WHERE customer_name ILIKE '%ophel%luli%'
--         AND vehicle_name ILIKE '%Clio%Blue%'
--         AND pickup_date::date = '2025-12-17'
--     ORDER BY created_at ASC
--     LIMIT 1
-- );

-- Option 2: Delete the SECOND duplicate (newer one)
-- DELETE FROM contracts WHERE booking_id = (
--     SELECT id FROM bookings
--     WHERE customer_name ILIKE '%ophel%luli%'
--         AND vehicle_name ILIKE '%Clio%Blue%'
--         AND pickup_date::date = '2025-12-17'
--     ORDER BY created_at DESC
--     LIMIT 1
-- );
-- 
-- DELETE FROM bookings
-- WHERE id = (
--     SELECT id FROM bookings
--     WHERE customer_name ILIKE '%ophel%luli%'
--         AND vehicle_name ILIKE '%Clio%Blue%'
--         AND pickup_date::date = '2025-12-17'
--     ORDER BY created_at DESC
--     LIMIT 1
-- );

-- Verify deletion
-- SELECT COUNT(*) as remaining_bookings
-- FROM bookings
-- WHERE customer_name ILIKE '%ophel%luli%'
--     AND vehicle_name ILIKE '%Clio%Blue%'
--     AND pickup_date::date = '2025-12-17';
