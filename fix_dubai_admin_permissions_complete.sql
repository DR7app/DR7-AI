-- ============================================================================
-- COMPREHENSIVE FIX: Dubai Admin Permissions & Customer Data Preservation
-- Author: Antigravity
-- Date: 2026-01-24
-- 
-- FIXES:
-- 1. Grant dubai.rent7.0srl@gmail.com FULL permissions to modify bookings
-- 2. Ensure customer data (user_id) is preserved when editing bookings
-- 3. Grant READ access to customers_extended so customer data displays correctly
-- ============================================================================

-- ============================================
-- STEP 1: Verify Current Admin Status
-- ============================================
SELECT
  u.email,
  a.role,
  a.can_view_financials,
  CASE
    WHEN a.role IS NULL THEN '❌ NOT IN ADMINS TABLE'
    WHEN a.role = 'superadmin' THEN '✅ SUPERADMIN'
    WHEN a.role = 'admin' THEN '✅ ADMIN'
    ELSE '⚠️ UNKNOWN ROLE'
  END as status
FROM auth.users u
LEFT JOIN admins a ON a.user_id = u.id
WHERE u.email = 'dubai.rent7.0srl@gmail.com';

-- ============================================
-- STEP 2: Ensure dubai.rent7.0srl@gmail.com is in admins table
-- ============================================
INSERT INTO admins (user_id, role, can_view_financials)
SELECT
  id,
  'admin',
  false  -- Dubai admin should NOT see financials
FROM auth.users
WHERE email = 'dubai.rent7.0srl@gmail.com'
ON CONFLICT (user_id) DO UPDATE
SET 
  role = 'admin',
  can_view_financials = false;

-- ============================================
-- STEP 3: Fix BOOKINGS Table RLS Policies
-- ============================================

-- Enable RLS
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Enable read access for all users" ON bookings;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON bookings;
DROP POLICY IF EXISTS "Enable update for users based on email" ON bookings;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON bookings;
DROP POLICY IF EXISTS "Allow admins to view all" ON bookings;
DROP POLICY IF EXISTS "Allow admins to insert" ON bookings;
DROP POLICY IF EXISTS "Allow admins to update" ON bookings;
DROP POLICY IF EXISTS "Allow admins to delete" ON bookings;
DROP POLICY IF EXISTS "Service role has full access" ON bookings;
DROP POLICY IF EXISTS "Users can view own bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can select bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can update bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can insert bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can delete bookings" ON bookings;

-- CREATE COMPREHENSIVE ADMIN POLICIES

-- 1. SELECT (View) - All admins can view all bookings
CREATE POLICY "Admins can select bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('admin', 'superadmin')
    )
  );

-- 2. INSERT - All admins can create bookings
CREATE POLICY "Admins can insert bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('admin', 'superadmin')
    )
  );

-- 3. UPDATE - All admins can update bookings (CRITICAL FOR DUBAI ADMIN)
CREATE POLICY "Admins can update bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('admin', 'superadmin')
    )
  );

-- 4. DELETE - All admins can delete bookings
CREATE POLICY "Admins can delete bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
      AND admins.role IN ('admin', 'superadmin')
    )
  );

-- 5. Service Role Access (for backend functions)
CREATE POLICY "Service role has full access"
  ON bookings
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 6. Users can view their own bookings (for client portal)
CREATE POLICY "Users can view own bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR 
    customer_email = auth.email()
  );

-- ============================================
-- STEP 4: Fix CUSTOMERS_EXTENDED Table RLS Policies
-- ============================================
-- This is CRITICAL - if admins can't READ customer data,
-- the frontend will think customer data is "missing" and ask to re-enter it

ALTER TABLE customers_extended ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can select customers_extended" ON customers_extended;
DROP POLICY IF EXISTS "Admins can insert customers_extended" ON customers_extended;
DROP POLICY IF EXISTS "Admins can update customers_extended" ON customers_extended;
DROP POLICY IF EXISTS "Admins can delete customers_extended" ON customers_extended;
DROP POLICY IF EXISTS "Service role has full access" ON customers_extended;
DROP POLICY IF EXISTS "Users can view own profile" ON customers_extended;

-- 1. SELECT - All admins can view all customers
CREATE POLICY "Admins can select customers_extended"
  ON customers_extended FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
    )
  );

-- 2. INSERT - All admins can create customers
CREATE POLICY "Admins can insert customers_extended"
  ON customers_extended FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
    )
  );

-- 3. UPDATE - All admins can update customers
CREATE POLICY "Admins can update customers_extended"
  ON customers_extended FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
    )
  );

-- 4. DELETE - All admins can delete customers
CREATE POLICY "Admins can delete customers_extended"
  ON customers_extended FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.user_id = auth.uid()
    )
  );

-- 5. Service Role Access
CREATE POLICY "Service role has full access"
  ON customers_extended
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 6. Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON customers_extended FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- ============================================
-- STEP 5: Verify All Policies Are Applied
-- ============================================

-- Check bookings policies
SELECT 
  '📋 BOOKINGS POLICIES' as section,
  policyname, 
  cmd as operation,
  roles
FROM pg_policies 
WHERE tablename = 'bookings'
ORDER BY cmd, policyname;

-- Check customers_extended policies
SELECT 
  '👥 CUSTOMERS_EXTENDED POLICIES' as section,
  policyname, 
  cmd as operation,
  roles
FROM pg_policies 
WHERE tablename = 'customers_extended'
ORDER BY cmd, policyname;

-- ============================================
-- STEP 6: Final Verification
-- ============================================

-- Verify dubai admin status
SELECT
  '✅ FINAL VERIFICATION' as section,
  u.email,
  a.role,
  a.can_view_financials,
  CASE
    WHEN a.role = 'admin' THEN '✅ ADMIN ACCESS GRANTED'
    WHEN a.role = 'superadmin' THEN '✅ SUPERADMIN ACCESS GRANTED'
    ELSE '❌ NO ADMIN ACCESS'
  END as status
FROM auth.users u
LEFT JOIN admins a ON a.user_id = u.id
WHERE u.email = 'dubai.rent7.0srl@gmail.com';

-- ============================================
-- ✅ EXPECTED RESULTS:
-- 
-- 1. dubai.rent7.0srl@gmail.com should have role = 'admin'
-- 2. Bookings table should have 6 policies (4 admin + 1 service + 1 user)
-- 3. Customers_extended table should have 6 policies (4 admin + 1 service + 1 user)
-- 4. Dubai admin should be able to:
--    - View all bookings ✅
--    - Create new bookings ✅
--    - UPDATE existing bookings ✅ (THIS WAS THE ISSUE)
--    - Delete bookings ✅
--    - View all customer data ✅ (THIS PREVENTS "RE-ENTER CLIENT" ISSUE)
-- ============================================
