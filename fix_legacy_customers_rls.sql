-- ============================================
-- Fix RLS Policies for legacy 'customers' Table
-- ============================================

-- Drop existing policies to start fresh
DROP POLICY IF EXISTS "Enable read access for all users" ON customers;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON customers;
DROP POLICY IF EXISTS "Enable update for users based on email" ON customers;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON customers;
DROP POLICY IF EXISTS "Allow admins to view all" ON customers;
DROP POLICY IF EXISTS "Allow admins to insert" ON customers;
DROP POLICY IF EXISTS "Allow admins to update" ON customers;
DROP POLICY IF EXISTS "Allow admins to delete" ON customers;

-- 1. VIEW (SELECT)
CREATE POLICY "Allow admins to view all"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- 2. INSERT
CREATE POLICY "Allow admins to insert"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- 3. UPDATE
CREATE POLICY "Allow admins to update"
  ON customers FOR UPDATE
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

-- 4. DELETE
CREATE POLICY "Allow admins to delete"
  ON customers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Service Role (Backend) Access
CREATE POLICY "Service role has full access"
  ON customers
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'customers';
