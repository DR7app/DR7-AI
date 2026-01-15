-- Check the actual data in the database for these bookings
SELECT 
    id,
    customer_name,
    service_name,
    price_total,
    payment_status,
    booking_details
FROM bookings
WHERE id IN (
    '8beec534-f314-4077-91a0-3d830b2ea427',
    '86f82c29-37d9-4659-b373-611f95865e4a'
)
ORDER BY customer_name;
