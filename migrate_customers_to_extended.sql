-- First, let's check what columns exist in the customers table
-- Run this to see the structure:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customers';

-- Simplified migration: customers to customers_extended
-- This migrates basic customer data without assuming metadata column exists

INSERT INTO customers_extended (
    id,
    tipo_cliente,
    nazione,
    email,
    telefono,
    nome,
    cognome,
    created_at,
    updated_at
)
SELECT 
    c.id,
    'persona_fisica' as tipo_cliente,
    'Italia' as nazione,
    c.email,
    c.phone as telefono,
    -- Extract first name from full_name (everything before last space)
    CASE 
        WHEN c.full_name LIKE '% %' THEN 
            TRIM(SUBSTRING(c.full_name FROM 1 FOR POSITION(' ' IN REVERSE(c.full_name))))
        ELSE c.full_name
    END as nome,
    -- Extract last name from full_name (last word)
    CASE 
        WHEN c.full_name LIKE '% %' THEN 
            TRIM(SUBSTRING(c.full_name FROM LENGTH(c.full_name) - POSITION(' ' IN REVERSE(c.full_name)) + 2))
        ELSE ''
    END as cognome,
    c.created_at,
    NOW() as updated_at
FROM customers c
WHERE NOT EXISTS (
    SELECT 1 FROM customers_extended ce WHERE ce.id = c.id
)
AND c.email IS NOT NULL
AND c.full_name IS NOT NULL;

-- Show results
SELECT 
    COUNT(*) as total_customers_migrated
FROM customers_extended
WHERE id IN (
    SELECT id FROM customers WHERE email IS NOT NULL
);
