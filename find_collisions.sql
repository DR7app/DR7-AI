-- FIND THE COLLISION CULPRIT

-- 1. Check for most common Emails
SELECT email, count(*) as count
FROM customers_extended
WHERE email IS NOT NULL AND email != ''
GROUP BY email
HAVING count(*) > 1
ORDER BY count DESC
LIMIT 5;

-- 2. Check for most common Phone Numbers
SELECT telefono, count(*) as count
FROM customers_extended
WHERE telefono IS NOT NULL AND telefono != ''
GROUP BY telefono
HAVING count(*) > 1
ORDER BY count DESC
LIMIT 5;

-- 3. Check for most common Names (just in case code uses name as backup)
SELECT 'Name Collision' as type, nome, cognome, count(*) as count
FROM customers_extended
GROUP BY nome, cognome
HAVING count(*) > 1
ORDER BY count DESC
LIMIT 5;
