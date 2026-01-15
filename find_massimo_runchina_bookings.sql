-- ========================================
-- MASSIMO RUNCHINA COMPREHENSIVE SEARCH
-- Fixed to match actual database schema
-- ========================================

-- Step 1: Find customer record in customers_extended
SELECT 
    'CUSTOMER RECORD' as query_type,
    id,
    nome,
    cognome,
    email,
    telefono,
    user_id,
    tipo_cliente,
    created_at AT TIME ZONE 'Europe/Rome' as created_local
FROM customers_extended
WHERE 
    LOWER(nome || ' ' || COALESCE(cognome, '')) LIKE '%massimo%runchina%'
    OR LOWER(nome || ' ' || COALESCE(cognome, '')) LIKE '%runchina%massimo%'
    OR LOWER(COALESCE(email, '')) LIKE '%runchina%'
    OR telefono LIKE '%336973849%'
    OR telefono LIKE '%3336973849%';

-- Step 2: Find ALL bookings by customer name/email/phone
SELECT 
    'ALL BOOKINGS' as query_type,
    id,
    customer_name,
    customer_email,
    customer_phone,
    user_id,
    vehicle_name,
    vehicle_plate,
    pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_local,
    status,
    service_type,
    price_total / 100.0 as total_price_eur,
    payment_status,
    payment_method,
    created_at AT TIME ZONE 'Europe/Rome' as created_local,
    booked_at AT TIME ZONE 'Europe/Rome' as booked_local
FROM bookings
WHERE 
    LOWER(COALESCE(customer_name, '')) LIKE '%massimo%runchina%'
    OR LOWER(COALESCE(customer_name, '')) LIKE '%runchina%massimo%'
    OR LOWER(COALESCE(customer_email, '')) LIKE '%runchina%'
    OR customer_phone LIKE '%336973849%'
    OR customer_phone LIKE '%3336973849%'
ORDER BY created_at DESC;

-- Step 3: Find bookings via user_id (if customer has auth account)
SELECT 
    'BOOKINGS VIA USER_ID' as query_type,
    b.id,
    b.customer_name,
    b.customer_email,
    b.vehicle_name,
    b.pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    b.dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_local,
    b.price_total / 100.0 as total_price_eur,
    b.payment_method,
    b.payment_status,
    b.status,
    c.nome || ' ' || c.cognome as customer_full_name
FROM bookings b
INNER JOIN customers_extended c ON b.user_id = c.user_id
WHERE 
    LOWER(c.nome || ' ' || COALESCE(c.cognome, '')) LIKE '%massimo%runchina%'
    OR LOWER(c.nome || ' ' || COALESCE(c.cognome, '')) LIKE '%runchina%massimo%'
ORDER BY b.created_at DESC;

-- Step 4: Check credit wallet balance
SELECT 
    'CREDIT BALANCE' as query_type,
    ucb.customer_id,
    ucb.balance / 100.0 as balance_eur,
    ucb.bonus_percentage,
    ucb.tier,
    c.nome || ' ' || c.cognome as name,
    c.email
FROM user_credit_balance ucb
INNER JOIN customers_extended c ON ucb.customer_id = c.id
WHERE 
    LOWER(c.nome || ' ' || COALESCE(c.cognome, '')) LIKE '%massimo%runchina%'
    OR LOWER(c.nome || ' ' || COALESCE(c.cognome, '')) LIKE '%runchina%massimo%';

-- Step 5: Check credit transactions history
SELECT 
    'CREDIT TRANSACTIONS' as query_type,
    ct.id,
    ct.customer_id,
    ct.amount / 100.0 as amount_eur,
    ct.transaction_type,
    ct.reference_id,
    ct.description,
    ct.created_at AT TIME ZONE 'Europe/Rome' as created_local,
    c.nome || ' ' || c.cognome as customer_name
FROM credit_transactions ct
INNER JOIN customers_extended c ON ct.customer_id = c.id
WHERE 
    LOWER(c.nome || ' ' || COALESCE(c.cognome, '')) LIKE '%massimo%runchina%'
    OR LOWER(c.nome || ' ' || COALESCE(c.cognome, '')) LIKE '%runchina%massimo%'
ORDER BY ct.created_at DESC;

-- Step 6: Look for "orphaned" credit bookings (paid with credit but missing from transaction ledger)
-- This is the key issue from the case study!
SELECT 
    'ORPHANED CREDIT BOOKINGS' as query_type,
    b.id as booking_id,
    b.customer_name,
    b.vehicle_name,
    b.price_total / 100.0 as price_eur,
    b.payment_method,
    b.payment_status,
    b.status,
    b.created_at AT TIME ZONE 'Europe/Rome' as created_local,
    CASE 
        WHEN ct.id IS NULL THEN '⚠️ MISSING FROM CREDIT_TRANSACTIONS'
        ELSE '✅ Has transaction record'
    END as ledger_status
FROM bookings b
LEFT JOIN credit_transactions ct ON ct.reference_id = b.id::text
WHERE 
    (LOWER(COALESCE(b.customer_name, '')) LIKE '%massimo%runchina%' 
     OR LOWER(COALESCE(b.customer_name, '')) LIKE '%runchina%massimo%')
    AND b.payment_method IN ('credit', 'credit_wallet')
    AND b.payment_status IN ('succeeded', 'paid', 'completed', 'Pagato')
ORDER BY b.created_at DESC;

-- Step 7: Summary count
SELECT 
    'SUMMARY' as query_type,
    COUNT(*) as total_bookings,
    COUNT(DISTINCT vehicle_name) as unique_vehicles,
    SUM(price_total) / 100.0 as total_spent_eur,
    MIN(pickup_date AT TIME ZONE 'Europe/Rome') as first_booking,
    MAX(pickup_date AT TIME ZONE 'Europe/Rome') as last_booking
FROM bookings
WHERE 
    LOWER(COALESCE(customer_name, '')) LIKE '%massimo%runchina%'
    OR LOWER(COALESCE(customer_name, '')) LIKE '%runchina%massimo%'
    OR LOWER(COALESCE(customer_email, '')) LIKE '%runchina%';
