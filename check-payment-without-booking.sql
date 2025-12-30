-- URGENT: Check if customer PAID but booking wasn't created
-- Email: pisceddasandro87@gmail.com

-- 1. Check if there's a payment record without a booking
SELECT 
    id,
    customer_email,
    amount,
    status,
    payment_method,
    created_at,
    metadata
FROM payments
WHERE customer_email ILIKE '%pisceddasandro87@gmail.com%'
ORDER BY created_at DESC;

-- 2. Check Nexi transactions
SELECT *
FROM bookings
WHERE nexi_order_id IS NOT NULL
  OR nexi_payment_id IS NOT NULL
  OR nexi_transaction_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check if there are any bookings with payment provider = 'nexi' recently
SELECT 
    id,
    customer_email,
    customer_name,
    service_type,
    payment_provider,
    payment_status,
    nexi_order_id,
    nexi_payment_id,
    created_at
FROM bookings
WHERE payment_provider = 'nexi'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- 4. Check for any failed/pending bookings
SELECT 
    id,
    customer_email,
    customer_name,
    service_type,
    status,
    payment_status,
    payment_error,
    nexi_error_message,
    created_at
FROM bookings
WHERE (payment_status = 'failed' OR payment_status = 'pending')
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- 5. Check if there's a separate payments or transactions table
-- (Run this to see what tables exist)
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND (table_name LIKE '%payment%' 
    OR table_name LIKE '%transaction%'
    OR table_name LIKE '%nexi%')
ORDER BY table_name;
