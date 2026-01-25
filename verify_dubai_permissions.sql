-- ============================================================================
-- VERIFICATION SCRIPT: Dubai Admin Permissions
-- ============================================================================

-- 1. Verify admin status (ALREADY CONFIRMED ✅)
SELECT
  '👤 ADMIN STATUS' as check_type,
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

-- 2. Verify BOOKINGS table policies
SELECT
  '📋 BOOKINGS POLICIES' as check_type,
  policyname,
  cmd as operation,
  CASE
    WHEN cmd = 'SELECT' THEN '✅ Can view bookings'
    WHEN cmd = 'INSERT' THEN '✅ Can create bookings'
    WHEN cmd = 'UPDATE' THEN '✅ Can modify bookings'
    WHEN cmd = 'DELETE' THEN '✅ Can delete bookings'
    ELSE cmd
  END as description
FROM pg_policies
WHERE tablename = 'bookings'
  AND policyname LIKE '%Admins%'
ORDER BY cmd;

-- 3. Verify CUSTOMERS_EXTENDED table policies
SELECT
  '👥 CUSTOMERS_EXTENDED POLICIES' as check_type,
  policyname,
  cmd as operation,
  CASE
    WHEN cmd = 'SELECT' THEN '✅ Can read customer data (FIXES RE-ENTRY ISSUE)'
    WHEN cmd = 'INSERT' THEN '✅ Can create customers'
    WHEN cmd = 'UPDATE' THEN '✅ Can modify customers'
    WHEN cmd = 'DELETE' THEN '✅ Can delete customers'
    ELSE cmd
  END as description
FROM pg_policies
WHERE tablename = 'customers_extended'
  AND policyname LIKE '%Admins%'
ORDER BY cmd;

-- 4. Count total policies per table
SELECT
  '📊 POLICY SUMMARY' as check_type,
  tablename,
  COUNT(*) as total_policies,
  CASE
    WHEN tablename = 'bookings' AND COUNT(*) >= 6 THEN '✅ Complete'
    WHEN tablename = 'customers_extended' AND COUNT(*) >= 6 THEN '✅ Complete'
    ELSE '⚠️ May be missing policies'
  END as status
FROM pg_policies
WHERE tablename IN ('bookings', 'customers_extended')
GROUP BY tablename
ORDER BY tablename;

-- ============================================================================
-- EXPECTED RESULTS:
-- 
-- 1. Admin Status: ✅ ADMIN ACCESS GRANTED
-- 2. Bookings Policies: 4 admin policies (SELECT, INSERT, UPDATE, DELETE)
-- 3. Customers Policies: 4 admin policies (SELECT, INSERT, UPDATE, DELETE)
-- 4. Total: 6+ policies per table (4 admin + 1 service + 1 user)
-- ============================================================================
