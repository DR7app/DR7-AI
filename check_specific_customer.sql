-- Check if customer exists in customers_extended
SELECT 'customers_extended' as source, *
FROM customers_extended
WHERE id = '702878e4-3248-4ec9-b567-1153a4580624';

-- Check if customer exists in bookings
SELECT 'bookings' as source, user_id, customer_name, customer_email, customer_phone, booking_details
FROM bookings
WHERE user_id = '702878e4-3248-4ec9-b567-1153a4580624'
LIMIT 5;

-- Check all bookings with this customer info
SELECT user_id, customer_name, customer_email, customer_phone, created_at
FROM bookings
WHERE customer_email LIKE '%' OR customer_phone LIKE '%'
ORDER BY created_at DESC
LIMIT 20;
