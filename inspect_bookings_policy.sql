-- ============================================
-- 1. INSPECT EXISTING POLICIES ON BOOKINGS
-- ============================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM
    pg_policies
WHERE
    tablename = 'bookings';

-- ============================================
-- 2. CHECK TARGET USER ROLE AND PERMISSIONS
-- ============================================
SELECT
    u.email,
    a.role,
    a.can_view_financials
FROM
    auth.users u
    LEFT JOIN admins a ON a.user_id = u.id
WHERE
    u.email = 'dubai.rent7.0srl@gmail.com';

-- ============================================
-- 3. TEST POLICY LOGIC (Simulated)
-- ============================================
-- We can't easily simulate the policy execution here without impersonation,
-- but listing the policies above will tell us if 'admin' role is covered.
