-- Quick count of total customers and estimated duplicates

-- Total customers in customers_extended
SELECT 
  'Total customer records' as metric,
  COUNT(*) as count
FROM customers_extended

UNION ALL

-- Unique emails (non-placeholder)
SELECT 
  'Unique valid emails' as metric,
  COUNT(DISTINCT email) as count
FROM customers_extended
WHERE email IS NOT NULL 
  AND email != '' 
  AND email NOT LIKE '%placeholder%'
  AND email NOT LIKE '%noemail%'
  AND email NOT LIKE '%@example.com%'

UNION ALL

-- Unique phones (non-placeholder)
SELECT 
  'Unique valid phones' as metric,
  COUNT(DISTINCT telefono) as count
FROM customers_extended
WHERE telefono IS NOT NULL 
  AND telefono != '' 
  AND telefono NOT LIKE '%placeholder%'
  AND telefono NOT LIKE '%000000%'

UNION ALL

-- Unique codice fiscale
SELECT 
  'Unique Codice Fiscale' as metric,
  COUNT(DISTINCT codice_fiscale) as count
FROM customers_extended
WHERE codice_fiscale IS NOT NULL 
  AND codice_fiscale != ''
  AND tipo_cliente = 'persona_fisica'

UNION ALL

-- Count of duplicate emails
SELECT 
  'Duplicate email groups' as metric,
  COUNT(*) as count
FROM (
  SELECT email
  FROM customers_extended
  WHERE email IS NOT NULL 
    AND email != '' 
    AND email NOT LIKE '%placeholder%'
    AND email NOT LIKE '%noemail%'
    AND email NOT LIKE '%@example.com%'
  GROUP BY email
  HAVING COUNT(*) > 1
) dup_emails

UNION ALL

-- Count of duplicate phones
SELECT 
  'Duplicate phone groups' as metric,
  COUNT(*) as count
FROM (
  SELECT telefono
  FROM customers_extended
  WHERE telefono IS NOT NULL 
    AND telefono != '' 
    AND telefono NOT LIKE '%placeholder%'
    AND telefono NOT LIKE '%000000%'
  GROUP BY telefono
  HAVING COUNT(*) > 1
) dup_phones

UNION ALL

-- Count of duplicate codice fiscale
SELECT 
  'Duplicate CF groups' as metric,
  COUNT(*) as count
FROM (
  SELECT codice_fiscale
  FROM customers_extended
  WHERE codice_fiscale IS NOT NULL 
    AND codice_fiscale != ''
    AND tipo_cliente = 'persona_fisica'
  GROUP BY codice_fiscale
  HAVING COUNT(*) > 1
) dup_cf;

-- Show some example duplicates
SELECT 
  '--- EXAMPLE DUPLICATE EMAILS ---' as info;

SELECT 
  email,
  COUNT(*) as duplicate_count,
  STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, denominazione), ', ') as customer_names
FROM customers_extended
WHERE email IS NOT NULL 
  AND email != '' 
  AND email NOT LIKE '%placeholder%'
  AND email NOT LIKE '%noemail%'
  AND email NOT LIKE '%@example.com%'
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10;
