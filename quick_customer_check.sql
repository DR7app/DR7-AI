-- Quick diagnostic to see what data exists and where
-- Run this to understand the current state

-- 1. Count customers in customers_extended
SELECT 'customers_extended' as source, COUNT(*) as count 
FROM customers_extended;

-- 2. Count unique customers from bookings
SELECT 'bookings' as source, COUNT(DISTINCT customer_email) as count 
FROM bookings 
WHERE customer_email IS NOT NULL;

-- 3. Sample of customers from customers_extended
SELECT 
  'Sample from customers_extended' as info,
  id, 
  tipo_cliente,
  nome,
  cognome,
  email,
  telefono
FROM customers_extended
LIMIT 5;

-- 4. Sample of customers from bookings
SELECT 
  'Sample from bookings' as info,
  customer_name,
  customer_email,
  customer_phone,
  booked_at
FROM bookings
WHERE customer_email IS NOT NULL
ORDER BY booked_at DESC
LIMIT 5;

-- 5. Check if Ivan Saba exists anywhere
SELECT 'Ivan Saba in bookings' as info, COUNT(*) as found
FROM bookings
WHERE customer_name ILIKE '%saba%' OR customer_email ILIKE '%saba%';

SELECT 'Ivan Saba in customers_extended' as info, COUNT(*) as found
FROM customers_extended
WHERE nome ILIKE '%ivan%' OR cognome ILIKE '%saba%' OR email ILIKE '%saba%';
