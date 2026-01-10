-- =====================================================
-- DIAGNOSE MISSING NOME/COGNOME IN CUSTOMERS_EXTENDED
-- =====================================================
-- This script helps identify where customer names are
-- missing and where they might be found
-- =====================================================

-- 1. Count customers with missing nome/cognome
SELECT 
  'Customers with missing nome/cognome' as category,
  COUNT(*) as count
FROM customers_extended
WHERE tipo_cliente = 'persona_fisica'
  AND (nome IS NULL OR nome = '' OR cognome IS NULL OR cognome = '');

-- 2. Sample customers with missing names
SELECT 
  'Sample customers with missing names' as info,
  id,
  email,
  telefono,
  nome,
  cognome,
  source,
  created_at
FROM customers_extended
WHERE tipo_cliente = 'persona_fisica'
  AND (nome IS NULL OR nome = '' OR cognome IS NULL OR cognome = '')
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check if names exist in auth.users metadata
SELECT 
  'Names in auth.users but missing in customers_extended' as info,
  au.email,
  au.raw_user_meta_data->>'nome' as nome_in_auth,
  au.raw_user_meta_data->>'cognome' as cognome_in_auth,
  ce.nome as nome_in_customers,
  ce.cognome as cognome_in_customers
FROM auth.users au
LEFT JOIN customers_extended ce ON au.id = ce.user_id
WHERE ce.id IS NOT NULL
  AND ce.tipo_cliente = 'persona_fisica'
  AND (ce.nome IS NULL OR ce.nome = '' OR ce.cognome IS NULL OR ce.cognome = '')
  AND (au.raw_user_meta_data->>'nome' IS NOT NULL OR au.raw_user_meta_data->>'cognome' IS NOT NULL)
LIMIT 10;

-- 4. Check if names exist in bookings table
SELECT 
  'Names in bookings for customers with missing names' as info,
  b.customer_email,
  b.customer_name,
  ce.nome,
  ce.cognome,
  ce.email
FROM bookings b
INNER JOIN customers_extended ce ON LOWER(TRIM(b.customer_email)) = LOWER(TRIM(ce.email))
WHERE ce.tipo_cliente = 'persona_fisica'
  AND (ce.nome IS NULL OR ce.nome = '' OR ce.cognome IS NULL OR ce.cognome = '')
  AND b.customer_name IS NOT NULL
  AND b.customer_name != 'Cliente'
LIMIT 10;

-- 5. Count potential sources for backfill
SELECT 
  'Potential backfill from auth.users' as source,
  COUNT(*) as recoverable_count
FROM auth.users au
LEFT JOIN customers_extended ce ON au.id = ce.user_id
WHERE ce.id IS NOT NULL
  AND ce.tipo_cliente = 'persona_fisica'
  AND (ce.nome IS NULL OR ce.nome = '' OR ce.cognome IS NULL OR ce.cognome = '')
  AND (au.raw_user_meta_data->>'nome' IS NOT NULL OR au.raw_user_meta_data->>'cognome' IS NOT NULL)

UNION ALL

SELECT 
  'Potential backfill from bookings' as source,
  COUNT(DISTINCT ce.id) as recoverable_count
FROM bookings b
INNER JOIN customers_extended ce ON LOWER(TRIM(b.customer_email)) = LOWER(TRIM(ce.email))
WHERE ce.tipo_cliente = 'persona_fisica'
  AND (ce.nome IS NULL OR ce.nome = '' OR ce.cognome IS NULL OR ce.cognome = '')
  AND b.customer_name IS NOT NULL
  AND b.customer_name != 'Cliente';
