-- Check where documents are stored for andreiii1710@icloud.com
-- and how they're linked to the user

-- 1. Check customer_documents table
SELECT 
  'customer_documents' as table_name,
  cd.*
FROM customer_documents cd
JOIN customers_extended ce ON cd.customer_id = ce.id
WHERE ce.email = 'andreiii1710@icloud.com';

-- 2. Check if there's a user_documents table
SELECT 
  'Looking for documents by user_id' as info,
  *
FROM customer_documents
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'andreiii1710@icloud.com'
);

-- 3. Check customers_extended for this user
SELECT 
  'customers_extended record' as info,
  id,
  user_id,
  email,
  nome,
  cognome,
  telefono,
  source,
  created_at
FROM customers_extended
WHERE email = 'andreiii1710@icloud.com';

-- 4. Check auth.users for this user
SELECT 
  'auth.users record' as info,
  id as user_id,
  email,
  created_at,
  raw_user_meta_data
FROM auth.users
WHERE email = 'andreiii1710@icloud.com';

-- 5. Check all document-related tables
SELECT 
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE '%document%' OR table_name LIKE '%file%' OR table_name LIKE '%upload%')
ORDER BY table_name;
