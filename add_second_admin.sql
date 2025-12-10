-- ============================================
-- Add Second Admin Account to user_profiles
-- Checks what role type is used (admin or superadmin) and adds the second account
-- ============================================

-- 1. Check what role the first admin has
SELECT 
  up.user_id,
  up.role,
  au.email
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE au.email = 'admin@dr7.app';

-- 2. Check if second user exists in auth.users
SELECT 
  id,
  email,
  created_at
FROM auth.users
WHERE email = 'dubai.rent7.0srl@gmail.com';

-- 3. Add the second admin with 'admin' role
-- (Change 'admin' to 'superadmin' if that's what the first admin has)
DO $$
DECLARE
  dubai_user_id UUID;
  admin_role TEXT := 'admin'; -- Change to 'superadmin' if needed
BEGIN
  SELECT id INTO dubai_user_id 
  FROM auth.users 
  WHERE email = 'dubai.rent7.0srl@gmail.com';

  IF dubai_user_id IS NOT NULL THEN
    INSERT INTO user_profiles (user_id, role, created_at, updated_at)
    VALUES (dubai_user_id, admin_role, NOW(), NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET role = admin_role, updated_at = NOW();
    
    RAISE NOTICE '✅ Role "%" added for dubai.rent7.0srl@gmail.com', admin_role;
  ELSE
    RAISE WARNING '⚠️ User dubai.rent7.0srl@gmail.com not found';
  END IF;
END $$;

-- 4. Verify both admins
SELECT 
  up.user_id,
  up.role,
  au.email
FROM user_profiles up
JOIN auth.users au ON au.id = up.user_id
WHERE up.role IN ('admin', 'superadmin')
ORDER BY au.email;
