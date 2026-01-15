-- ========================================
-- COMPREHENSIVE MASSIMO RUNCHINA SEARCH
-- Based on Credit Wallet Reconciliation Case Study
-- ========================================

-- Step 1: Find the customer record(s)
SELECT 
    'CUSTOMER RECORDS' as query_type,
    id,
    nome,
    cognome,
    email,
    telefono,
    user_id,
    created_at
FROM customers_extended
WHERE 
    LOWER(nome || ' ' || cognome) LIKE '%massimo%runchina%'
    OR LOWER(nome || ' ' || cognome) LIKE '%runchina%massimo%'
    OR LOWER(email) LIKE '%runchina%'
    OR telefono LIKE '%336973849%'
    OR telefono LIKE '%3336973849%';


-- Step 2: Find ALL bookings by name/email/phone
SELECT 
    'BOOKINGS BY NAME/EMAIL/PHONE' as query_type,
    id,
    customer_name,
    customer_email,
    customer_phone,
    customer_id,
    vehicle_name,
    pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_local,
    status,
    service_type,
    total_price,
    payment_status,
    payment_method,
    created_at AT TIME ZONE 'Europe/Rome' as created_local
FROM bookings
WHERE 
    LOWER(customer_name) LIKE '%massimo%runchina%'
    OR LOWER(customer_name) LIKE '%runchina%massimo%'
    OR LOWER(customer_email) LIKE '%runchina%'
    OR customer_phone LIKE '%336973849%'
    OR customer_phone LIKE '%3336973849%'
ORDER BY created_at DESC;

-- Step 3: Find bookings via customer_id link
SELECT 
    'BOOKINGS VIA CUSTOMER_ID' as query_type,
    b.id,
    b.customer_name,
    b.customer_email,
    b.customer_id,
    b.vehicle_name,
    b.pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    b.dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_local,
    b.status,
    b.service_type,
    b.total_price,
    b.payment_status,
    b.payment_method,
    b.created_at AT TIME ZONE 'Europe/Rome' as created_local,
    c.nome || ' ' || c.cognome as linked_customer_name
FROM bookings b
INNER JOIN customers_extended c ON b.customer_id = c.id
WHERE 
    LOWER(c.nome || ' ' || c.cognome) LIKE '%massimo%runchina%'
    OR LOWER(c.nome || ' ' || c.cognome) LIKE '%runchina%massimo%'
    OR LOWER(c.email) LIKE '%runchina%'
ORDER BY b.created_at DESC;

-- Step 4: Check for bookings with user_id in booking_details JSONB
SELECT 
    'BOOKINGS VIA JSONB user_id' as query_type,
    b.id,
    b.customer_name,
    b.customer_email,
    b.vehicle_name,
    b.pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    b.total_price,
    b.payment_method,
    b.booking_details->>'user_id' as jsonb_user_id,
    c.nome || ' ' || c.cognome as matched_customer_name
FROM bookings b
LEFT JOIN customers_extended c ON (b.booking_details->>'user_id')::uuid = c.user_id
WHERE 
    b.booking_details->>'user_id' IS NOT NULL
    AND (
        LOWER(c.nome || ' ' || c.cognome) LIKE '%massimo%runchina%'
        OR LOWER(c.nome || ' ' || c.cognome) LIKE '%runchina%massimo%'
    )
ORDER BY b.created_at DESC;

-- Step 5: Credit wallet balance
SELECT 
    'CREDIT BALANCE' as query_type,
    ucb.customer_id,
    ucb.balance,
    ucb.bonus_percentage,
    ucb.tier,
    c.nome || ' ' || c.cognome as name,
    c.email
FROM user_credit_balance ucb
INNER JOIN customers_extended c ON ucb.customer_id = c.id
WHERE 
    LOWER(c.nome || ' ' || c.cognome) LIKE '%massimo%runchina%'
    OR LOWER(c.nome || ' ' || c.cognome) LIKE '%runchina%massimo%';

-- Step 6: Credit transactions history
SELECT 
    'CREDIT TRANSACTIONS' as query_type,
    ct.id,
    ct.customer_id,
    ct.amount,
    ct.transaction_type,
    ct.reference_id,
    ct.description,
    ct.created_at AT TIME ZONE 'Europe/Rome' as created_local,
    c.nome || ' ' || c.cognome as name
FROM credit_transactions ct
INNER JOIN customers_extended c ON ct.customer_id = c.id
WHERE 
    LOWER(c.nome || ' ' || c.cognome) LIKE '%massimo%runchina%'
    OR LOWER(c.nome || ' ' || c.cognome) LIKE '%runchina%massimo%'
ORDER BY ct.created_at DESC;


-- Step 7: Look for "orphaned" credit bookings (paid with credit but no transaction record)
SELECT 
    'ORPHANED CREDIT BOOKINGS' as query_type,
    b.id as booking_id,
    b.customer_name,
    b.vehicle_name,
    b.total_price,
    b.payment_method,
    b.payment_status,
    b.created_at AT TIME ZONE 'Europe/Rome' as created_local,
    CASE 
        WHEN ct.id IS NULL THEN 'MISSING FROM CREDIT_TRANSACTIONS'
        ELSE 'Has transaction record'
    END as ledger_status
FROM bookings b
LEFT JOIN credit_transactions ct ON ct.reference_id = b.id
WHERE 
    (LOWER(b.customer_name) LIKE '%massimo%runchina%' OR LOWER(b.customer_name) LIKE '%runchina%massimo%')
    AND b.payment_method IN ('credit', 'credit_wallet')
    AND b.payment_status IN ('succeeded', 'paid', 'completed', 'Pagato')
ORDER BY b.created_at DESC;
