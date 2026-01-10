-- =====================================================
-- BACKFILL MISSING NOME/COGNOME IN CUSTOMERS_EXTENDED
-- =====================================================
-- This script recovers missing customer names from
-- auth.users metadata and bookings table
-- =====================================================

-- STAGE 0: Show current state
DO $$
DECLARE
  total_persona_fisica INTEGER;
  missing_names INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_persona_fisica
  FROM customers_extended
  WHERE tipo_cliente = 'persona_fisica';
  
  SELECT COUNT(*) INTO missing_names
  FROM customers_extended
  WHERE tipo_cliente = 'persona_fisica'
    AND (nome IS NULL OR nome = '' OR cognome IS NULL OR cognome = '');
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '📊 CURRENT STATE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total persona_fisica customers: %', total_persona_fisica;
  RAISE NOTICE 'Customers with missing nome/cognome: %', missing_names;
  RAISE NOTICE 'Percentage missing: %%%', ROUND((missing_names::DECIMAL / NULLIF(total_persona_fisica, 0) * 100), 2);
  RAISE NOTICE '========================================';
END $$;

-- STAGE 1: Backfill from auth.users metadata
DO $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🔄 STAGE 1: Backfilling from auth.users metadata...';
  
  WITH updates AS (
    UPDATE customers_extended ce
    SET 
      nome = COALESCE(NULLIF(ce.nome, ''), au.raw_user_meta_data->>'nome', ce.nome),
      cognome = COALESCE(NULLIF(ce.cognome, ''), au.raw_user_meta_data->>'cognome', ce.cognome),
      updated_at = NOW()
    FROM auth.users au
    WHERE ce.user_id = au.id
      AND ce.tipo_cliente = 'persona_fisica'
      AND (ce.nome IS NULL OR ce.nome = '' OR ce.cognome IS NULL OR ce.cognome = '')
      AND (au.raw_user_meta_data->>'nome' IS NOT NULL OR au.raw_user_meta_data->>'cognome' IS NOT NULL)
    RETURNING ce.id
  )
  SELECT COUNT(*) INTO updated_count FROM updates;
  
  RAISE NOTICE '✅ Updated % customers from auth.users metadata', updated_count;
END $$;

-- STAGE 2: Backfill from bookings table (parse customer_name)
DO $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🔄 STAGE 2: Backfilling from bookings table...';
  
  WITH booking_names AS (
    SELECT DISTINCT ON (b.customer_email)
      LOWER(TRIM(b.customer_email)) as email,
      b.customer_name,
      -- Parse customer_name into nome and cognome
      -- Assumes format: "Nome Cognome" or "Nome"
      CASE 
        WHEN POSITION(' ' IN TRIM(b.customer_name)) > 0 
        THEN TRIM(SPLIT_PART(TRIM(b.customer_name), ' ', 1))
        ELSE TRIM(b.customer_name)
      END as parsed_nome,
      CASE 
        WHEN POSITION(' ' IN TRIM(b.customer_name)) > 0 
        THEN TRIM(SUBSTRING(TRIM(b.customer_name) FROM POSITION(' ' IN TRIM(b.customer_name)) + 1))
        ELSE NULL
      END as parsed_cognome
    FROM bookings b
    WHERE b.customer_email IS NOT NULL
      AND b.customer_name IS NOT NULL
      AND b.customer_name != 'Cliente'
      AND TRIM(b.customer_name) != ''
    ORDER BY b.customer_email, b.booked_at DESC
  ),
  updates AS (
    UPDATE customers_extended ce
    SET 
      nome = COALESCE(NULLIF(ce.nome, ''), bn.parsed_nome, ce.nome),
      cognome = COALESCE(NULLIF(ce.cognome, ''), bn.parsed_cognome, ce.cognome),
      updated_at = NOW()
    FROM booking_names bn
    WHERE LOWER(TRIM(ce.email)) = bn.email
      AND ce.tipo_cliente = 'persona_fisica'
      AND (ce.nome IS NULL OR ce.nome = '' OR ce.cognome IS NULL OR ce.cognome = '')
      AND (bn.parsed_nome IS NOT NULL OR bn.parsed_cognome IS NOT NULL)
    RETURNING ce.id
  )
  SELECT COUNT(*) INTO updated_count FROM updates;
  
  RAISE NOTICE '✅ Updated % customers from bookings table', updated_count;
END $$;

-- STAGE 3: Verification and reporting
DO $$
DECLARE
  total_persona_fisica INTEGER;
  still_missing INTEGER;
  recovered INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_persona_fisica
  FROM customers_extended
  WHERE tipo_cliente = 'persona_fisica';
  
  SELECT COUNT(*) INTO still_missing
  FROM customers_extended
  WHERE tipo_cliente = 'persona_fisica'
    AND (nome IS NULL OR nome = '' OR cognome IS NULL OR cognome = '');
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ BACKFILL COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total persona_fisica customers: %', total_persona_fisica;
  RAISE NOTICE 'Still missing nome/cognome: %', still_missing;
  RAISE NOTICE 'Percentage still missing: %%%', ROUND((still_missing::DECIMAL / NULLIF(total_persona_fisica, 0) * 100), 2);
  RAISE NOTICE '========================================';
  
  IF still_missing > 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ Note: % customers still have missing names.', still_missing;
    RAISE NOTICE 'These customers may have been created without name data in any source.';
  ELSE
    RAISE NOTICE '🎉 All customers now have complete name data!';
  END IF;
END $$;

-- Show sample of recovered customers
SELECT 
  '✅ Sample of customers with recovered names' as info,
  email,
  nome,
  cognome,
  source,
  updated_at
FROM customers_extended
WHERE tipo_cliente = 'persona_fisica'
  AND nome IS NOT NULL
  AND nome != ''
  AND updated_at > NOW() - INTERVAL '5 minutes'
ORDER BY updated_at DESC
LIMIT 10;

-- Show remaining customers with missing names (if any)
SELECT 
  '⚠️ Customers still missing names' as info,
  email,
  telefono,
  nome,
  cognome,
  source,
  created_at
FROM customers_extended
WHERE tipo_cliente = 'persona_fisica'
  AND (nome IS NULL OR nome = '' OR cognome IS NULL OR cognome = '')
ORDER BY created_at DESC
LIMIT 10;
