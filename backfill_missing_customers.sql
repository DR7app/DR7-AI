-- =====================================================
-- BACKFILL MISSING CUSTOMERS FROM AUTH.USERS
-- =====================================================
-- This script syncs existing auth.users who are missing
-- from customers_extended table (users who registered
-- before the trigger was created)
-- =====================================================

-- Step 1: Show how many users will be backfilled
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
  
  RAISE NOTICE '📊 Found % users in auth.users missing from customers_extended', missing_count;
END $$;

-- Step 2: Backfill missing users
INSERT INTO customers_extended (
  user_id,
  email,
  nome,
  cognome,
  telefono,
  tipo_cliente,
  nazione,
  source,
  created_at
)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'nome', ''),
  COALESCE(au.raw_user_meta_data->>'cognome', ''),
  COALESCE(au.raw_user_meta_data->>'telefono', ''),
  'persona_fisica',
  'Italia',
  'backfill_registration',
  au.created_at
FROM auth.users au
WHERE au.email NOT LIKE '%@dr7.app'
  AND au.email NOT LIKE '%dubai.rent7.0srl%'
  AND NOT EXISTS (
    SELECT 1 FROM customers_extended ce 
    WHERE ce.user_id = au.id
  );

-- Step 3: Verify backfill results
DO $$
DECLARE
  total_auth_users INTEGER;
  total_customers INTEGER;
  missing_count INTEGER;
  backfilled_count INTEGER;
BEGIN
  -- Count total auth users (excluding admins)
  SELECT COUNT(*) INTO total_auth_users
  FROM auth.users
  WHERE email NOT LIKE '%@dr7.app'
    AND email NOT LIKE '%dubai.rent7.0srl%';
  
  -- Count total customers from website registration
  SELECT COUNT(*) INTO total_customers
  FROM customers_extended
  WHERE source IN ('website_registration', 'backfill_registration');
  
  -- Count still missing (should be 0)
  SELECT COUNT(*) INTO missing_count
  FROM auth.users au
  LEFT JOIN customers_extended ce ON au.id = ce.user_id
  WHERE ce.id IS NULL
    AND au.email NOT LIKE '%@dr7.app'
    AND au.email NOT LIKE '%dubai.rent7.0srl%';
  
  -- Calculate backfilled
  backfilled_count := total_customers;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ BACKFILL COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total auth.users (non-admin): %', total_auth_users;
  RAISE NOTICE 'Total customers synced: %', total_customers;
  RAISE NOTICE 'Still missing: %', missing_count;
  RAISE NOTICE '========================================';
  
  IF missing_count > 0 THEN
    RAISE WARNING '⚠️ There are still % users not synced. Check the logs above.', missing_count;
  ELSE
    RAISE NOTICE '🎉 All users successfully synced to customers_extended!';
  END IF;
END $$;

-- Step 4: Show sample of backfilled customers
SELECT 
  'Sample backfilled customers' as info,
  ce.email,
  ce.nome,
  ce.cognome,
  ce.telefono,
  ce.source,
  ce.created_at
FROM customers_extended ce
WHERE ce.source = 'backfill_registration'
ORDER BY ce.created_at DESC
LIMIT 10;
