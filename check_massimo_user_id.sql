-- Check if Massimo has a user_id in any booking
SELECT DISTINCT
    user_id,
    customer_name,
    customer_email,
    customer_phone
FROM bookings
WHERE 
    customer_email ILIKE '%massimorunchina69%'
ORDER BY user_id;

-- Check if there's a customers_extended record
SELECT 
    id,
    user_id,
    nome,
    cognome,
    email,
    telefono
FROM customers_extended
WHERE 
    email ILIKE '%massimorunchina69%'
    OR telefono LIKE '%3496435070%';
