-- Check what metadata is actually stored in auth.users for registered users
-- This will help us understand what data was captured during registration

SELECT 
  email,
  created_at,
  raw_user_meta_data,
  raw_app_meta_data,
  -- Extract specific fields if they exist
  raw_user_meta_data->>'nome' as nome_from_metadata,
  raw_user_meta_data->>'cognome' as cognome_from_metadata,
  raw_user_meta_data->>'telefono' as telefono_from_metadata,
  raw_user_meta_data->>'full_name' as full_name_from_metadata,
  raw_user_meta_data->>'phone' as phone_from_metadata
FROM auth.users
WHERE email IN (
  'giangi.ponti18@gmail.com',
  'casuale2005@gmail.com',
  'darionuovo99@gmail.com',
  'giovannicontini98@icloud.com',
  'matteocontu01@gmail.com'
)
ORDER BY created_at DESC;

-- Also check if there are any other fields in raw_user_meta_data
SELECT 
  email,
  jsonb_object_keys(raw_user_meta_data) as metadata_keys
FROM auth.users
WHERE email = 'giangi.ponti18@gmail.com';
