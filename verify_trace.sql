-- ============================================
-- Diagnostic Script for customers_extended Table
-- Run this in Supabase SQL Editor to diagnose issues
-- ============================================

-- 1. Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'customers_extended'
) AS table_exists;

-- 2. List all columns in customers_extended
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'customers_extended'
ORDER BY ordinal_position;

-- 3. Check RLS status
SELECT 
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename = 'customers_extended';

-- 4. List all RLS policies on customers_extended
SELECT 
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

-- 5. Count total customers
SELECT COUNT(*) AS total_customers FROM customers_extended;

-- 6. Sample customers to verify data
SELECT 
  id,
  tipo_cliente,
  nome,
  cognome,
  ragione_sociale,
  email,
  telefono,
  created_at
FROM customers_extended
ORDER BY created_at DESC
LIMIT 10;

-- 7. Check if user_profiles table exists (required for RLS policies)
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'user_profiles'
) AS user_profiles_exists;

-- 8. Check current user's admin status
SELECT 
  up.user_id,
  up.role,
  au.email
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE up.user_id = auth.uid();

-- 9. List all admin users
SELECT 
  up.user_id,
  up.role,
  au.email
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE up.role = 'admin';

-- ============================================
-- Expected Results:
-- - table_exists should be TRUE
-- - Should see columns: id, tipo_cliente, nome, cognome, email, telefono, metadata, etc.
-- - rls_enabled should be TRUE
-- - Should see 4 policies (SELECT, INSERT, UPDATE, DELETE for admins)
-- - total_customers should show the count of customers
-- - Sample customers should show recent entries
-- - user_profiles_exists should be TRUE
-- - Current user should have role = 'admin'
-- ============================================

-- Trace execution
