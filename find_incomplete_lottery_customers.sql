-- Find all lottery ticket customers who don't have complete profiles
SELECT DISTINCT
    t.email,
    t.full_name,
    t.customer_phone,
    COUNT(t.ticket_number) as total_tickets,
    CASE 
        WHEN ce.id IS NULL THEN 'No profile at all'
        WHEN ce.tipo_cliente IS NULL THEN 'Profile exists but incomplete'
        ELSE 'Profile complete'
    END as profile_status
FROM commercial_operation_tickets t
LEFT JOIN customers_extended ce ON t.email = ce.email
GROUP BY t.email, t.full_name, t.customer_phone, ce.id, ce.tipo_cliente
ORDER BY total_tickets DESC;

-- Count tickets by profile status
SELECT 
    CASE 
        WHEN ce.id IS NULL THEN 'No profile'
        WHEN ce.tipo_cliente IS NULL THEN 'Incomplete profile'
        ELSE 'Complete profile'
    END as status,
    COUNT(DISTINCT t.email) as unique_customers,
    COUNT(t.ticket_number) as total_tickets
FROM commercial_operation_tickets t
LEFT JOIN customers_extended ce ON t.email = ce.email
GROUP BY 
    CASE 
        WHEN ce.id IS NULL THEN 'No profile'
        WHEN ce.tipo_cliente IS NULL THEN 'Incomplete profile'
        ELSE 'Complete profile'
    END;

-- Get emails of customers who need to complete their profiles
-- (useful for sending a mass email campaign)
SELECT DISTINCT
    t.email,
    t.full_name,
    t.customer_phone
FROM commercial_operation_tickets t
LEFT JOIN customers_extended ce ON t.email = ce.email
WHERE ce.id IS NULL OR ce.tipo_cliente IS NULL
ORDER BY t.email;
