-- Search for andreii1710@icloud.com user
-- Check if they exist in auth.users and customers_extended

-- 1. Check auth.users
SELECT 
  'auth.users' as table_name,
  id,
  email,
  created_at,
  raw_user_meta_data
FROM auth.users
WHERE email ILIKE '%andreii1710%'
ORDER BY created_at DESC;

-- 2. Check customers_extended
SELECT 
  'customers_extended' as table_name,
  id,
  user_id,
  email,
  nome,
  cognome,
  telefono,
  source,
  created_at
FROM customers_extended
WHERE email ILIKE '%andreii1710%'
ORDER BY created_at DESC;

-- 3. Check if there's a user_id mismatch
SELECT 
  'Checking for orphaned records' as info,
  au.email as auth_email,
  au.id as auth_user_id,
  au.created_at as auth_created_at,
  ce.email as customer_email,
  ce.user_id as customer_user_id,
  ce.created_at as customer_created_at,
  ce.source
FROM auth.users au
FULL OUTER JOIN customers_extended ce ON au.id = ce.user_id
WHERE au.email ILIKE '%andreii1710%' 
   OR ce.email ILIKE '%andreii1710%';

-- 4. Check recent registrations from yesterday
SELECT 
  'Recent registrations (last 2 days)' as info,
  email,
  created_at,
  raw_user_meta_data
FROM auth.users
WHERE created_at >= NOW() - INTERVAL '2 days'
  AND email NOT LIKE '%@dr7.app'
  AND email NOT LIKE '%dubai.rent7.0srl%'
ORDER BY created_at DESC;
