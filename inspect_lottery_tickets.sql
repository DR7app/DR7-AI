-- Check the schema of commercial_operation_tickets table
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'commercial_operation_tickets'
ORDER BY ordinal_position;

-- Check sample data from recent lottery tickets
SELECT 
    ticket_number,
    email,
    full_name,
    customer_phone,
    purchase_date,
    payment_intent_id,
    user_id
FROM commercial_operation_tickets
ORDER BY purchase_date DESC
LIMIT 10;

-- Check if there are any additional columns we're not seeing
SELECT *
FROM commercial_operation_tickets
ORDER BY purchase_date DESC
LIMIT 3;

-- Check how many tickets have user_id vs don't
SELECT 
    COUNT(*) as total_tickets,
    COUNT(user_id) as tickets_with_user_id,
    COUNT(*) - COUNT(user_id) as tickets_without_user_id
FROM commercial_operation_tickets;

-- For tickets with user_id, check if we can get customer data
SELECT 
    t.ticket_number,
    t.email,
    t.full_name,
    t.customer_phone,
    ce.tipo_cliente,
    ce.nome,
    ce.cognome,
    ce.indirizzo,
    ce.citta,
    ce.codice_fiscale
FROM commercial_operation_tickets t
LEFT JOIN customers_extended ce ON t.user_id = ce.id
ORDER BY t.purchase_date DESC
LIMIT 5;
