-- ============================================
-- Verify and Fix Admin Access for Both Accounts
-- Ensures both admin@dr7.app and dubai.rent7.0srl@gmail.com have admin access
-- ============================================

-- 1. Check if both admin users exist in auth.users
SELECT 
  id,
  email,
  created_at,
  email_confirmed_at
FROM auth.users
WHERE email IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com')
ORDER BY email;

-- 2. Check if user_profiles table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'user_profiles'
) AS user_profiles_exists;

-- 3. Check current admin entries in user_profiles
SELECT 
  up.user_id,
  up.role,
  au.email
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE up.role = 'admin'
ORDER BY au.email;

-- 4. Add admin role for both users (if not already present)
-- First, get the user IDs
DO $$
DECLARE
  admin_dr7_id UUID;
  dubai_rent_id UUID;
BEGIN
  -- Get user IDs
  SELECT id INTO admin_dr7_id FROM auth.users WHERE email = 'admin@dr7.app';
  SELECT id INTO dubai_rent_id FROM auth.users WHERE email = 'dubai.rent7.0srl@gmail.com';

  -- Insert or update admin role for admin@dr7.app
  IF admin_dr7_id IS NOT NULL THEN
    INSERT INTO user_profiles (user_id, role, created_at, updated_at)
    VALUES (admin_dr7_id, 'admin', NOW(), NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET role = 'admin', updated_at = NOW();
    
    RAISE NOTICE '✅ Admin role set for admin@dr7.app';
  ELSE
    RAISE WARNING '⚠️ User admin@dr7.app not found in auth.users';
  END IF;

  -- Insert or update admin role for dubai.rent7.0srl@gmail.com
  IF dubai_rent_id IS NOT NULL THEN
    INSERT INTO user_profiles (user_id, role, created_at, updated_at)
    VALUES (dubai_rent_id, 'admin', NOW(), NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET role = 'admin', updated_at = NOW();
    
    RAISE NOTICE '✅ Admin role set for dubai.rent7.0srl@gmail.com';
  ELSE
    RAISE WARNING '⚠️ User dubai.rent7.0srl@gmail.com not found in auth.users';
  END IF;
END $$;

-- 5. Verify both admins are now in user_profiles
SELECT 
  up.user_id,
  up.role,
  au.email,
  up.created_at,
  up.updated_at
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE au.email IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com')
ORDER BY au.email;

-- 6. Test that both admins can access customers_extended
-- This will show if RLS policies are working correctly
DO $$
DECLARE
  admin_dr7_id UUID;
  dubai_rent_id UUID;
  can_access BOOLEAN;
BEGIN
  SELECT id INTO admin_dr7_id FROM auth.users WHERE email = 'admin@dr7.app';
  SELECT id INTO dubai_rent_id FROM auth.users WHERE email = 'dubai.rent7.0srl@gmail.com';

  -- Test admin@dr7.app access
  IF admin_dr7_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = admin_dr7_id AND role = 'admin'
    ) INTO can_access;
    
    IF can_access THEN
      RAISE NOTICE '✅ admin@dr7.app has admin access';
    ELSE
      RAISE WARNING '⚠️ admin@dr7.app does NOT have admin access';
    END IF;
  END IF;

  -- Test dubai.rent7.0srl@gmail.com access
  IF dubai_rent_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = dubai_rent_id AND role = 'admin'
    ) INTO can_access;
    
    IF can_access THEN
      RAISE NOTICE '✅ dubai.rent7.0srl@gmail.com has admin access';
    ELSE
      RAISE WARNING '⚠️ dubai.rent7.0srl@gmail.com does NOT have admin access';
    END IF;
  END IF;
END $$;

-- ============================================
-- Expected Results:
-- - Both users should appear in auth.users
-- - Both users should have role = 'admin' in user_profiles
-- - Both should have access to customers_extended via RLS policies
-- ============================================

-- Note: If you want different access levels for these admins,
-- you can modify the user_profiles table to add more granular permissions
-- or create a new 'permissions' column with specific access rights.
