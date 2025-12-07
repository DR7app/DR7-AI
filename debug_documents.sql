-- 1. Check if user_documents table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'user_documents'
);

-- 2. If it exists, check what data is in it
SELECT * FROM user_documents LIMIT 10;

-- 3. Check storage buckets
SELECT * FROM storage.buckets
WHERE id IN ('driver-licenses', 'driver-ids', 'codice-fiscale');

-- 4. Check storage objects (files)
SELECT
  bucket_id,
  name,
  created_at,
  metadata
FROM storage.objects
WHERE bucket_id IN ('driver-licenses', 'driver-ids', 'codice-fiscale')
ORDER BY created_at DESC
LIMIT 20;

-- 5. Check storage policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage';
