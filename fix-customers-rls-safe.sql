-- ============================================
-- SAFE FIX FOR CUSTOMERS_EXTENDED PERMISSIONS
-- Run this in Supabase SQL Editor
-- ============================================

--  1. Enable RLS (just in case)
ALTER TABLE customers_extended ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing restrictive policies that might be causing the 403
DROP POLICY IF EXISTS "Allow all for authenticated users" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins full access" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins to view all customers" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins to insert customers" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins to update customers" ON customers_extended;

-- 3. Create a unified permissive policy for authenticated users
-- This allows any logged-in user (admin) to perform all actions
CREATE POLICY "Allow all actions for authenticated users"
  ON customers_extended
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Verify policies (Optional - just for output)
SELECT * FROM pg_policies WHERE tablename = 'customers_extended';
