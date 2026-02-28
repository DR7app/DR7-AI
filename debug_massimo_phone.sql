-- 1. Check the booking for Massimo Runchina (Audi rs3, March dates)
SELECT
    id,
    user_id,
    customer_name,
    customer_phone,
    customer_email,
    booking_details->'customer' as customer_details,
    booking_source,
    created_at
FROM bookings
WHERE customer_name ILIKE '%Runchina%'
ORDER BY created_at DESC
LIMIT 5;

-- 2. Check customers_extended for Massimo
SELECT
    id,
    nome,
    cognome,
    telefono,
    email,
    source
FROM customers_extended
WHERE cognome ILIKE '%Runchina%'
   OR email = 'massimorunchina69@gmail.com';

-- 3. Check if user_id on booking matches customers_extended id
SELECT
    b.id as booking_id,
    b.user_id,
    b.customer_phone,
    c.id as customer_id,
    c.telefono,
    b.user_id = c.id as ids_match
FROM bookings b
LEFT JOIN customers_extended c ON c.id = b.user_id
WHERE b.customer_name ILIKE '%Runchina%'
ORDER BY b.created_at DESC
LIMIT 5;
