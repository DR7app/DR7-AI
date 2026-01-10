-- Debug script to find Riccardo PILIA's customer data
-- This will help identify why his name doesn't appear when editing bookings

-- 1. Search for Riccardo PILIA in customers_extended
SELECT 
    id,
    tipo_cliente,
    nome,
    cognome,
    email,
    telefono,
    created_at
FROM customers_extended
WHERE 
    LOWER(nome) LIKE '%riccardo%' 
    OR LOWER(cognome) LIKE '%pilia%'
    OR LOWER(email) LIKE '%riccardo%'
    OR LOWER(email) LIKE '%pilia%';

-- 2. Search for his bookings
SELECT 
    id,
    user_id,
    customer_name,
    customer_email,
    customer_phone,
    vehicle_name,
    pickup_date,
    status,
    booking_details
FROM bookings
WHERE 
    LOWER(customer_name) LIKE '%riccardo%' 
    OR LOWER(customer_name) LIKE '%pilia%'
    OR LOWER(customer_email) LIKE '%riccardo%'
    OR LOWER(customer_email) LIKE '%pilia%'
ORDER BY created_at DESC
LIMIT 5;

-- 3. Check if there's a user_id mismatch
-- Find bookings with Riccardo's name and check if user_id exists in customers_extended
SELECT 
    b.id as booking_id,
    b.user_id,
    b.customer_name,
    b.customer_email,
    c.id as customer_extended_id,
    c.nome,
    c.cognome,
    c.email as customer_extended_email
FROM bookings b
LEFT JOIN customers_extended c ON b.user_id = c.id
WHERE 
    LOWER(b.customer_name) LIKE '%riccardo%pilia%'
    OR LOWER(b.customer_name) LIKE '%pilia%riccardo%'
ORDER BY b.created_at DESC
LIMIT 5;

-- 4. Check auth.users for Riccardo
SELECT 
    id,
    email,
    raw_user_meta_data
FROM auth.users
WHERE 
    LOWER(email) LIKE '%riccardo%'
    OR LOWER(email) LIKE '%pilia%'
    OR LOWER(raw_user_meta_data::text) LIKE '%riccardo%'
    OR LOWER(raw_user_meta_data::text) LIKE '%pilia%';
