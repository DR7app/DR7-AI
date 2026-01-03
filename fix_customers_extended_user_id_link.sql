-- Check if customers_extended records are linked to the correct user_id
SELECT 
    ce.id,
    ce.user_id,
    ce.email,
    ce.tipo_cliente,
    ce.nome,
    ce.cognome,
    ce.codice_fiscale,
    au.id as auth_user_id,
    CASE 
        WHEN ce.user_id = au.id THEN 'LINKED'
        WHEN ce.user_id IS NULL THEN 'NO USER_ID'
        ELSE 'WRONG USER_ID'
    END as link_status
FROM customers_extended ce
LEFT JOIN auth.users au ON ce.email = au.email
WHERE ce.email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it');

-- Fix: Update customers_extended to link to correct user_id
UPDATE customers_extended ce
SET user_id = au.id
FROM auth.users au
WHERE ce.email = au.email
AND ce.user_id IS NULL
AND ce.email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it');

-- Verify the fix
SELECT 
    ce.email,
    ce.user_id,
    ce.tipo_cliente,
    ce.nome,
    ce.cognome
FROM customers_extended ce
WHERE ce.email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it');
