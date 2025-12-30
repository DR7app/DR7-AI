-- Query to find recent bookings and their service types
SELECT 
    id,
    created_at,
    customer_name,
    service_type,
    service_name,
    status,
    vehicle_name,
    price_total,
    booking_source,
    payment_status
FROM bookings
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 20;
