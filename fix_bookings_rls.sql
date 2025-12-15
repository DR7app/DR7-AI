-- ============================================
-- Fix RLS Policies for 'bookings' Table
-- ============================================

-- Drop existing policies to start fresh
DROP POLICY IF EXISTS "Enable read access for all users" ON bookings;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON bookings;
DROP POLICY IF EXISTS "Enable update for users based on email" ON bookings;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON bookings;
DROP POLICY IF EXISTS "Allow admins to view all" ON bookings;
DROP POLICY IF EXISTS "Allow admins to insert" ON bookings;
DROP POLICY IF EXISTS "Allow admins to update" ON bookings;
DROP POLICY IF EXISTS "Allow admins to delete" ON bookings;
DROP POLICY IF EXISTS "Service role has full access" ON bookings;

-- 1. VIEW (SELECT)
CREATE POLICY "Allow admins to view all"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
  );

-- 2. INSERT
CREATE POLICY "Allow admins to insert"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
  );

-- 3. UPDATE
CREATE POLICY "Allow admins to update"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
  );

-- 4. DELETE
CREATE POLICY "Allow admins to delete"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
  );

-- Service Role (Backend) Access
CREATE POLICY "Service role has full access"
  ON bookings
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Also allow users to view their own bookings (for the client portal)
CREATE POLICY "Users can view own bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR 
    customer_email = auth.email()
  );

-- Verify
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'bookings';
