-- Update bookings for Massimo Runchina that were marked as 'Contanti' to 'Credit Wallet'
-- This fixes the issue where wallet payments were recorded incorrectly.

UPDATE bookings
SET payment_method = 'Credit Wallet'
WHERE (customer_email ILIKE '%massimorunchina69@gmail.com%' OR customer_name ILIKE '%Massimo%Runchina%')
  AND payment_method = 'Contanti';

-- Verify the changes
SELECT 
    created_at, 
    vehicle_name, 
    price_total, 
    payment_method 
FROM bookings 
WHERE customer_email ILIKE '%massimorunchina69@gmail.com%'
ORDER BY created_at DESC;
