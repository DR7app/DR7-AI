-- =====================================================
-- UPDATE EXISTING USERS WITH FULLNAME/PHONE FORMAT
-- =====================================================
-- This updates users who were synced with empty data
-- because they used fullName/phone instead of nome/cognome/telefono
-- =====================================================

-- Update existing customers_extended records that have fullName/phone in auth.users
UPDATE customers_extended ce
SET 
  nome = COALESCE(
    NULLIF(ce.nome, ''),
    split_part(au.raw_user_meta_data->>'fullName', ' ', 1)
  ),
  cognome = COALESCE(
    NULLIF(ce.cognome, ''),
    substring(au.raw_user_meta_data->>'fullName' from position(' ' in au.raw_user_meta_data->>'fullName') + 1)
  ),
  telefono = COALESCE(
    NULLIF(ce.telefono, ''),
    au.raw_user_meta_data->>'phone'
  ),
  updated_at = NOW()
FROM auth.users au
WHERE ce.user_id = au.id
  AND au.raw_user_meta_data->>'fullName' IS NOT NULL
  AND (ce.nome = '' OR ce.cognome = '' OR ce.telefono = '');

-- Show updated records
SELECT 
  'Updated customers with fullName/phone data' as info,
  email,
  nome,
  cognome,
  telefono,
  source,
  updated_at
FROM customers_extended
WHERE updated_at > NOW() - INTERVAL '1 minute'
ORDER BY updated_at DESC
LIMIT 20;
