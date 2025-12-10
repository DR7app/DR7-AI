-- Search for Ivan Saba in the database
-- This will check all possible locations where the client data might be

-- 1. Search in customers_extended table
SELECT 
  id,
  tipo_cliente,
  nome,
  cognome,
  email,
  telefono,
  created_at,
  source
FROM customers_extended
WHERE 
  nome ILIKE '%ivan%' 
  OR cognome ILIKE '%saba%'
  OR email ILIKE '%ivan%'
  OR email ILIKE '%saba%';

-- 2. Search in customers table (if it exists)
SELECT 
  id,
  full_name,
  email,
  phone,
  created_at
FROM customers
WHERE 
  full_name ILIKE '%ivan%' 
  OR full_name ILIKE '%saba%'
  OR email ILIKE '%ivan%'
  OR email ILIKE '%saba%';

-- 3. Search in bookings table
SELECT 
  id,
  customer_name,
  customer_email,
  customer_phone,
  booked_at
FROM bookings
WHERE 
  customer_name ILIKE '%ivan%' 
  OR customer_name ILIKE '%saba%'
  OR customer_email ILIKE '%ivan%'
  OR customer_email ILIKE '%saba%';

-- 4. Count total customers in customers_extended
SELECT COUNT(*) as total_in_customers_extended FROM customers_extended;

-- 5. Count total unique customers from bookings
SELECT COUNT(DISTINCT customer_email) as unique_customers_from_bookings 
FROM bookings 
WHERE customer_email IS NOT NULL;

-- This will tell us:
-- - If Ivan Saba exists in the database at all
-- - Which table(s) contain the data
-- - Total customer counts to compare
