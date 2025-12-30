-- 1. FIND THE USER ID (UUID)
-- We search by email to get the robust generic ID
SELECT id, full_name, email, phone 
FROM customers 
WHERE email ILIKE '%massimorunchina69@gmail.com%';

-- 2. FETCH ALL BOOKINGS (Using OR logic to catch everything)
-- We check 'user_id', 'customer_email', AND 'customer_name' to be safe.
-- Replace 'YOUR_FOUND_ID_HERE' with the ID from step 1 if you want to be precise,
-- but this query does it all in one go using OR.

SELECT 
    created_at,        -- Date of booking
    vehicle_name,      -- Car
    price_total,       -- Price
    status,            -- Confirmed/Cancelled?
    payment_status,    -- Paid/To Pay?
    payment_method,    -- Wallet? Cash?
    pickup_date,
    dropoff_date,
    booking_details    -- JSON details
FROM bookings 
WHERE customer_email ILIKE '%massimorunchina69@gmail.com%'
   OR customer_name ILIKE '%Massimo%Runchina%'
   -- If you know his phone number, add it here:
   -- OR customer_phone LIKE '%3331234567%'
ORDER BY created_at DESC;
