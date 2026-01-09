-- Diagnostic script to check registration data flow
-- Run this to understand why registrations from main website aren't appearing in admin

-- 1. Check recent auth.users registrations
SELECT 
  'Recent auth.users' as check_name,
  email,
  created_at,
  raw_user_meta_data,
  raw_app_meta_data
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;

-- 2. Check if these users exist in customers_extended
SELECT 
  'Users in customers_extended' as check_name,
  ce.email,
  ce.nome,
  ce.cognome,
  ce.user_id,
  ce.source,
  ce.created_at,
  au.email as auth_email,
  au.created_at as auth_created_at
FROM customers_extended ce
LEFT JOIN auth.users au ON ce.user_id = au.id
ORDER BY ce.created_at DESC
LIMIT 10;

-- 3. Find auth.users NOT in customers_extended
SELECT 
  'Missing from customers_extended' as check_name,
  au.email,
  au.created_at,
  au.raw_user_meta_data
FROM auth.users au
LEFT JOIN customers_extended ce ON au.id = ce.user_id
WHERE ce.id IS NULL
  AND au.email NOT LIKE '%@dr7.app'
  AND au.email NOT LIKE '%dubai.rent7.0srl%'
ORDER BY au.created_at DESC
LIMIT 20;

-- 4. Check for any database triggers on auth.users
SELECT 
  'Triggers on auth.users' as check_name,
  trigger_name,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
  AND event_object_table = 'users';

-- 5. Check for functions that might handle user creation
SELECT 
  'Functions matching user creation' as check_name,
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND (
    routine_name LIKE '%user%'
    OR routine_name LIKE '%customer%'
    OR routine_name LIKE '%auth%'
    OR routine_name LIKE '%register%'
  )
ORDER BY routine_name;

-- 6. Check RLS policies on customers_extended
SELECT 
  'RLS Policies on customers_extended' as check_name,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'customers_extended';
