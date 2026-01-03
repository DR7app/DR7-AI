-- ============================================
-- Fix Alarm Visibility / RLS for Bookings
-- Explicitly allow specific admin emails to see ALL bookings
-- ============================================

-- Drop existing SELECT policy to replace it
DROP POLICY IF EXISTS "Allow admins to view all" ON bookings;
DROP POLICY IF EXISTS "Enable read access for all users" ON bookings;

-- Create robust SELECT policy
CREATE POLICY "Allow admins to view all"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    -- 1. Explicit Email Whitelist (Safest backup)
    auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com', 'opheliegiraud@gmail.com')
    OR
    -- 2. Check user_profiles (Standard way)
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
    OR
    -- 3. Check admins table (Legacy way, just in case)
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
    OR
    -- 4. Users see their own bookings
    auth.uid() = user_id 
    OR 
    customer_email = auth.email()
  );

-- Also ensure INSERT/UPDATE/DELETE match this robustness
DROP POLICY IF EXISTS "Allow admins to insert" ON bookings;
CREATE POLICY "Allow admins to insert"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
    EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Allow admins to update" ON bookings;
CREATE POLICY "Allow admins to update"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
    EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
    EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Allow admins to delete" ON bookings;
CREATE POLICY "Allow admins to delete"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
    EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
  );
