-- 1. SEARCH FOR WALLET COLUMNS (In case it's in a different table)
SELECT table_name, column_name 
FROM information_schema.columns 
WHERE column_name ILIKE '%wallet%' 
   OR column_name ILIKE '%credit%' 
   OR column_name ILIKE '%balance%'
   OR column_name ILIKE '%prepaid%';

-- 2. CHECK CUSTOMER DATA BY EMAIL
SELECT 
    id, 
    nome,
    cognome,
    email,
    metadata,  -- Check here for 'wallet_balance'
    notes      -- Check here for manual notes
FROM customers_extended 
WHERE email = 'massimorunchina69@gmail.com';

-- 3. CHECK BOOKINGS BY EMAIL
SELECT 
    created_at,
    vehicle_name,
    price_total,
    status,
    payment_status,
    payment_method, -- Check for 'Wallet'
    booking_details
FROM bookings 
WHERE customer_email = 'massimorunchina69@gmail.com'
ORDER BY created_at DESC;
