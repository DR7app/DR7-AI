-- ============================================
-- Fix RLS Policies for customers_extended Table
-- Run this AFTER running verify_customers_extended_schema.sql
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Allow admins to view all customers" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins to insert customers" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins to update customers" ON customers_extended;
DROP POLICY IF EXISTS "Allow admins to delete customers" ON customers_extended;
DROP POLICY IF EXISTS "Service role has full access" ON customers_extended;

-- Create comprehensive RLS policies for admins
CREATE POLICY "Allow admins to view all customers"
  ON customers_extended FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow admins to insert customers"
  ON customers_extended FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow admins to update customers"
  ON customers_extended FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow admins to delete customers"
  ON customers_extended FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Add service role policy for backend operations
CREATE POLICY "Service role has full access"
  ON customers_extended
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify policies were created
SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'customers_extended'
ORDER BY policyname;

-- ============================================
-- ✅ RLS Policies Updated Successfully!
-- Now admins should be able to:
-- - View all customers (SELECT)
-- - Create new customers (INSERT)
-- - Update existing customers (UPDATE)
-- - Delete customers (DELETE)
-- ============================================
