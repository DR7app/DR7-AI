-- ============================================================
-- operatori_persone.avatar_url
--
-- Aggiunge una colonna avatar_url alle persone operatori così
-- direzione/ophe possono caricare la foto profilo di ciascuno
-- (visibile nel Report Operatori, in Rilevazione Orari, ecc.).
-- Storage: usa il bucket pubblico `operator-avatars` (creato da
-- questo file). Public read, write soltanto da utenti
-- autenticati.
-- ============================================================

ALTER TABLE public.operatori_persone
    ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.operatori_persone.avatar_url IS
    'Public URL della foto profilo (bucket operator-avatars). NULL = avatar fallback con iniziali.';

-- ── Bucket per foto profilo operatori ─────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'operator-avatars',
    'operator-avatars',
    true,
    2 * 1024 * 1024,                 -- 2 MB max per upload
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Storage RLS ──────────────────────────────────────────
-- Read: pubblico (le foto vengono mostrate in admin senza richiesta auth).
DROP POLICY IF EXISTS "operator-avatars public read" ON storage.objects;
CREATE POLICY "operator-avatars public read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'operator-avatars');

-- Write/Update/Delete: solo utenti autenticati (admin).
DROP POLICY IF EXISTS "operator-avatars authenticated write" ON storage.objects;
CREATE POLICY "operator-avatars authenticated write"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'operator-avatars');

DROP POLICY IF EXISTS "operator-avatars authenticated update" ON storage.objects;
CREATE POLICY "operator-avatars authenticated update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'operator-avatars')
    WITH CHECK (bucket_id = 'operator-avatars');

DROP POLICY IF EXISTS "operator-avatars authenticated delete" ON storage.objects;
CREATE POLICY "operator-avatars authenticated delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'operator-avatars');
