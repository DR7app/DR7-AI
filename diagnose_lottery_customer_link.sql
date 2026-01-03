-- Check if these customers exist in customers_extended by email
SELECT 
    'andrea.caria@dcrsrls.it' as search_email,
    ce.*
FROM customers_extended ce
WHERE ce.email = 'andrea.caria@dcrsrls.it'
UNION ALL
SELECT 
    'desmokelu@gmail.com' as search_email,
    ce.*
FROM customers_extended ce
WHERE ce.email = 'desmokelu@gmail.com';

-- Check if they exist in the customers table
SELECT 
    'Customers table' as source,
    c.*
FROM customers c
WHERE c.email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com');

-- Check if they exist in auth.users
SELECT 
    'Auth users' as source,
    u.id,
    u.email,
    u.created_at
FROM auth.users u
WHERE u.email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com');

-- Check the actual user_id stored in the lottery tickets
SELECT 
    t.ticket_number,
    t.email,
    t.user_id,
    t.full_name,
    ce.id as ce_id,
    ce.email as ce_email,
    ce.tipo_cliente
FROM commercial_operation_tickets t
LEFT JOIN customers_extended ce ON t.user_id = ce.id
WHERE t.email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com')
LIMIT 5;

-- Check if user_id column exists and what values it has
SELECT 
    ticket_number,
    email,
    user_id,
    CASE 
        WHEN user_id IS NULL THEN 'NULL'
        ELSE 'HAS VALUE'
    END as user_id_status
FROM commercial_operation_tickets
WHERE email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com')
LIMIT 5;
