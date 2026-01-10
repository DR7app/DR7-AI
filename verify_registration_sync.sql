-- =====================================================
-- VERIFY REGISTRATION SYNC IS WORKING
-- =====================================================
-- Run this after applying the trigger and backfill
-- to verify everything is working correctly
-- =====================================================

-- 1. Check that the trigger exists
SELECT 
  '1. Trigger Status' as check_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- 2. Check sync status
SELECT 
  '2. Sync Status' as check_name,
  COUNT(DISTINCT au.id) as total_auth_users,
  COUNT(DISTINCT ce.id) as total_customers_synced,
  COUNT(DISTINCT au.id) - COUNT(DISTINCT ce.id) as missing_count
FROM auth.users au
LEFT JOIN customers_extended ce ON au.id = ce.user_id
WHERE au.email NOT LIKE '%@dr7.app'
  AND au.email NOT LIKE '%dubai.rent7.0srl%';

-- 3. Show any users still missing (should be empty)
SELECT 
  '3. Missing Users' as check_name,
  au.email,
  au.created_at,
  au.raw_user_meta_data
FROM auth.users au
LEFT JOIN customers_extended ce ON au.id = ce.user_id
WHERE ce.id IS NULL
  AND au.email NOT LIKE '%@dr7.app'
  AND au.email NOT LIKE '%dubai.rent7.0srl%'
ORDER BY au.created_at DESC
LIMIT 10;

-- 4. Show recent synced customers
SELECT 
  '4. Recent Synced Customers' as check_name,
  ce.email,
  ce.nome,
  ce.cognome,
  ce.telefono,
  ce.source,
  ce.created_at
FROM customers_extended ce
WHERE ce.source IN ('website_registration', 'backfill_registration')
ORDER BY ce.created_at DESC
LIMIT 10;

-- 5. Count by source
SELECT 
  '5. Customers by Source' as check_name,
  source,
  COUNT(*) as count
FROM customers_extended
GROUP BY source
ORDER BY count DESC;

-- Success message
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM auth.users au
  LEFT JOIN customers_extended ce ON au.id = ce.user_id
  WHERE ce.id IS NULL
    AND au.email NOT LIKE '%@dr7.app'
    AND au.email NOT LIKE '%dubai.rent7.0srl%';
  
  IF missing_count = 0 THEN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ ALL CHECKS PASSED!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'All auth.users are synced to customers_extended';
    RAISE NOTICE 'New registrations will automatically sync';
    RAISE NOTICE '========================================';
  ELSE
    RAISE WARNING '⚠️ Found % users not synced. Review the results above.', missing_count;
  END IF;
END $$;
