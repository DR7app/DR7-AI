-- Debug Mercedes Vito VIP DR7 availability issue
-- Check all bookings for this vehicle around January 2026

SELECT 
    id,
    vehicle_name,
    vehicle_plate,
    pickup_date AT TIME ZONE 'Europe/Rome' as pickup_rome,
    dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_rome,
    status,
    service_type
FROM bookings
WHERE 
    (vehicle_plate LIKE '%GV059GV%' OR vehicle_name LIKE '%Vito%')
    AND pickup_date >= '2026-01-01'
    AND pickup_date <= '2026-01-31'
    AND status != 'cancelled'
ORDER BY pickup_date;
