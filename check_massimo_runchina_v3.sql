-- 1. Try to find the user in ALL possible customer tables
-- Check legacy 'customers' table
SELECT 'customers' as table_source, id, full_name, email, phone, notes, NULL as metadata
FROM customers 
WHERE email ILIKE '%massimorunchina69@gmail.com%';

-- Check 'customers_extended' table (if it exists)
-- Using try-catch logic isn't easy in standard SQL editor, so we just run it. 
-- If this fails, the table might not exist.
SELECT 'customers_extended' as table_source, id, nome, cognome, email, notes, metadata
FROM customers_extended 
WHERE email ILIKE '%massimorunchina69@gmail.com%';

-- 2. Check Bookings
SELECT 
    id,
    created_at,
    vehicle_name,
    price_total,
    status,
    payment_status,
    payment_method, 
    booking_details
FROM bookings 
WHERE customer_email ILIKE '%massimorunchina69@gmail.com%'
   OR customer_name ILIKE '%Massimo Runchina%'
ORDER BY created_at DESC;

-- 3. Check for any 'Special Pricing' or 'Wallet' columns in bookings
-- (Sometimes credit is stored as a negative price or discount column)
SELECT 
    column_name 
FROM information_schema.columns 
WHERE table_name = 'bookings'
  AND (column_name ILIKE '%discount%' OR column_name ILIKE '%credit%' OR column_name ILIKE '%wallet%');
