-- Find the conflicting booking
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    vehicle_id,
    pickup_date,
    dropoff_date,
    service_type,
    status,
    booking_details
FROM bookings
WHERE id = '33049e8d-21e3-4101-ba2b-860eeab9d7ee';
