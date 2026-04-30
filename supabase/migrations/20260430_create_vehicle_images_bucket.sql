-- Storage bucket for vehicle photos managed from admin Veicoli tab.
-- Public-read so the website can render the URL without authentication;
-- writes restricted to authenticated admin users via RLS below.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vehicle-images',
    'vehicle-images',
    true,
    10485760, -- 10 MB
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read
DROP POLICY IF EXISTS "vehicle-images public read" ON storage.objects;
CREATE POLICY "vehicle-images public read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'vehicle-images');

-- Authenticated insert (admin app uses service-role key but JWT-authed sessions
-- should also be allowed in case we move uploads client-side)
DROP POLICY IF EXISTS "vehicle-images authenticated insert" ON storage.objects;
CREATE POLICY "vehicle-images authenticated insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'vehicle-images');

-- Authenticated update (replace existing image)
DROP POLICY IF EXISTS "vehicle-images authenticated update" ON storage.objects;
CREATE POLICY "vehicle-images authenticated update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'vehicle-images')
    WITH CHECK (bucket_id = 'vehicle-images');

-- Authenticated delete (remove old image)
DROP POLICY IF EXISTS "vehicle-images authenticated delete" ON storage.objects;
CREATE POLICY "vehicle-images authenticated delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'vehicle-images');
