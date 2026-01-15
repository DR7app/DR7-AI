-- Search for all Massimo Runchina bookings
SELECT 
    id,
    customer_name,
    customer_email,
    customer_phone,
    vehicle_name,
    pickup_date,
    dropoff_date,
    status,
    payment_status,
    payment_method,
    price_total / 100.0 as price_eur,
    created_at
FROM bookings
WHERE 
    customer_name ILIKE '%massimo%runchina%'
    OR customer_name ILIKE '%runchina%massimo%'
    OR customer_email ILIKE '%runchina%'
    OR customer_phone LIKE '%3336973849%'
ORDER BY pickup_date DESC;
