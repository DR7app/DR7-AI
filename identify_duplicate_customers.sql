-- ============================================
-- IDENTIFY DUPLICATE CUSTOMERS IN customers_extended
-- ============================================

-- 1. Find duplicates by email (excluding placeholder emails)
SELECT 
  email,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, denominazione), ' | ') as names
FROM customers_extended
WHERE email IS NOT NULL 
  AND email != '' 
  AND email NOT LIKE '%placeholder%'
  AND email NOT LIKE '%noemail%'
  AND email NOT LIKE '%@example.com%'
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- 2. Find duplicates by phone (excluding placeholder phones)
SELECT 
  telefono,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, denominazione), ' | ') as names
FROM customers_extended
WHERE telefono IS NOT NULL 
  AND telefono != '' 
  AND telefono NOT LIKE '%placeholder%'
  AND telefono NOT LIKE '%000000%'
GROUP BY telefono
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- 3. Find duplicates by codice_fiscale
SELECT 
  codice_fiscale,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(nome || ' ' || cognome, ' | ') as names
FROM customers_extended
WHERE codice_fiscale IS NOT NULL 
  AND codice_fiscale != ''
  AND tipo_cliente = 'persona_fisica'
GROUP BY codice_fiscale
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- 4. Find duplicates by partita_iva
SELECT 
  partita_iva,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(ragione_sociale, ' | ') as names
FROM customers_extended
WHERE partita_iva IS NOT NULL 
  AND partita_iva != ''
  AND tipo_cliente = 'azienda'
GROUP BY partita_iva
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- 5. Find duplicates by name (persona fisica)
SELECT 
  nome,
  cognome,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(COALESCE(email, 'no email'), ' | ') as emails
FROM customers_extended
WHERE tipo_cliente = 'persona_fisica'
  AND nome IS NOT NULL
  AND cognome IS NOT NULL
GROUP BY nome, cognome
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- 6. Summary of total duplicates
SELECT 
  'Total customers' as metric,
  COUNT(*) as count
FROM customers_extended
UNION ALL
SELECT 
  'Unique emails (non-placeholder)' as metric,
  COUNT(DISTINCT email) as count
FROM customers_extended
WHERE email IS NOT NULL 
  AND email != '' 
  AND email NOT LIKE '%placeholder%'
  AND email NOT LIKE '%noemail%'
  AND email NOT LIKE '%@example.com%'
UNION ALL
SELECT 
  'Unique phones (non-placeholder)' as metric,
  COUNT(DISTINCT telefono) as count
FROM customers_extended
WHERE telefono IS NOT NULL 
  AND telefono != '' 
  AND telefono NOT LIKE '%placeholder%'
  AND telefono NOT LIKE '%000000%'
UNION ALL
SELECT 
  'Unique codice_fiscale' as metric,
  COUNT(DISTINCT codice_fiscale) as count
FROM customers_extended
WHERE codice_fiscale IS NOT NULL AND codice_fiscale != '';
