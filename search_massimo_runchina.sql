-- ========================================
-- SEARCH FOR MASSIMO RUNCHINA BOOKINGS
-- ========================================

-- 1. Find customer records
SELECT 
    'customers_extended' as source,
    id,
    name,
    email,
    phone,
    created_at
FROM customers_extended
WHERE 
    LOWER(name) LIKE '%massimo%runchina%'
    OR LOWER(name) LIKE '%runchina%massimo%'
    OR LOWER(email) LIKE '%runchina%'
    OR phone LIKE '%3336973849%';

-- 2. Find all bookings by name
SELECT 
    'bookings_by_name' as source,
    id,
    customer_name,
    customer_email,
    customer_phone,
    customer_id,
    vehicle_name,
    pickup_date,
    dropoff_date,
    status,
    service_type,
    total_price,
    payment_status,
    created_at
FROM bookings
WHERE 
    LOWER(customer_name) LIKE '%massimo%runchina%'
    OR LOWER(customer_name) LIKE '%runchina%massimo%'
    OR LOWER(customer_email) LIKE '%runchina%'
    OR customer_phone LIKE '%3336973849%'
ORDER BY created_at DESC;

-- 3. Find bookings by customer_id (if we found a customer record)
SELECT 
    'bookings_by_customer_id' as source,
    b.id,
    b.customer_name,
    b.customer_email,
    b.customer_phone,
    b.customer_id,
    b.vehicle_name,
    b.pickup_date,
    b.dropoff_date,
    b.status,
    b.service_type,
    b.total_price,
    b.payment_status,
    b.created_at,
    c.name as customer_extended_name
FROM bookings b
LEFT JOIN customers_extended c ON b.customer_id = c.id
WHERE 
    c.name ILIKE '%massimo%runchina%'
    OR c.name ILIKE '%runchina%massimo%'
    OR c.email ILIKE '%runchina%'
ORDER BY b.created_at DESC;

-- 4. Check credit transactions
SELECT 
    'credit_transactions' as source,
    ct.*
FROM credit_transactions ct
LEFT JOIN customers_extended c ON ct.customer_id = c.id
WHERE 
    c.name ILIKE '%massimo%runchina%'
    OR c.name ILIKE '%runchina%massimo%'
ORDER BY ct.created_at DESC;

-- 5. Check user_credit_balance
SELECT 
    'credit_balance' as source,
    ucb.*,
    c.name,
    c.email
FROM user_credit_balance ucb
LEFT JOIN customers_extended c ON ucb.customer_id = c.id
WHERE 
    c.name ILIKE '%massimo%runchina%'
    OR c.name ILIKE '%runchina%massimo%';

-- 6. Check if there are any orphaned bookings (customer_id doesn't match)
SELECT 
    'orphaned_check' as source,
    b.id,
    b.customer_name,
    b.customer_email,
    b.customer_id,
    CASE 
        WHEN b.customer_id IS NULL THEN 'No customer_id'
        WHEN c.id IS NULL THEN 'customer_id points to non-existent customer'
        ELSE 'Linked correctly'
    END as link_status
FROM bookings b
LEFT JOIN customers_extended c ON b.customer_id = c.id
WHERE 
    LOWER(b.customer_name) LIKE '%massimo%runchina%'
    OR LOWER(b.customer_name) LIKE '%runchina%massimo%';
