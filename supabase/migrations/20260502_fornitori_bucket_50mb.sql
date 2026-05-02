-- Bump fornitori-documents bucket file size limit 20MB → 50MB.
-- Necessario perché foto da smartphone delle bolle possono superare 20MB.

UPDATE storage.buckets
   SET file_size_limit = 52428800,                           -- 50 MB
       allowed_mime_types = ARRAY[
           'application/pdf',
           'image/jpeg',
           'image/jpg',
           'image/png',
           'image/webp'
       ]
 WHERE id = 'fornitori-documents';
