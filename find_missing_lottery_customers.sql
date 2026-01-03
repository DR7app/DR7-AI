-- Check if these specific lottery customers exist in customers_extended
SELECT 
    email,
    tipo_cliente,
    nome,
    cognome,
    codice_fiscale,
    indirizzo,
    citta,
    telefono
FROM customers_extended
WHERE email IN (
    'andrea.caria@dcrsrls.it',
    'desmokelu@gmail.com'
);

-- Check if ANY customers_extended records exist
SELECT COUNT(*) as total_customers FROM customers_extended;

-- Check if there are customers_extended with email
SELECT COUNT(*) as customers_with_email 
FROM customers_extended 
WHERE email IS NOT NULL AND email != '';

-- Find lottery ticket emails that DON'T have a match in customers_extended
SELECT DISTINCT
    t.email,
    t.full_name,
    CASE 
        WHEN ce.email IS NULL THEN 'NOT FOUND in customers_extended'
        ELSE 'FOUND'
    END as status
FROM commercial_operation_tickets t
LEFT JOIN customers_extended ce ON LOWER(TRIM(t.email)) = LOWER(TRIM(ce.email))
WHERE t.email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com')
ORDER BY t.email;

-- Check for email case/whitespace issues
SELECT 
    email,
    LENGTH(email) as email_length,
    tipo_cliente
FROM customers_extended
WHERE LOWER(email) LIKE '%andrea.caria%' 
   OR LOWER(email) LIKE '%desmokelu%';
