-- Aggiunge campo per allegare il PDF del contratto firmato.
-- Il file vive nello storage bucket "operatori-contratti" (private) e qui
-- salviamo solo il path relativo. La signed URL viene generata on-demand
-- dal client per il preview/download (no public links).

ALTER TABLE public.operatore_contratto
  ADD COLUMN IF NOT EXISTS pdf_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_uploaded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pdf_filename TEXT NULL;

-- Bucket privato per i PDF dei contratti operatore. Idempotente: se esiste
-- gia', no-op.
INSERT INTO storage.buckets (id, name, public)
VALUES ('operatori-contratti', 'operatori-contratti', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: solo direzione (Valerio / Ilenia / ophe) puo' leggere o
-- scrivere file in questo bucket. L'operatore stesso NON ha accesso al
-- proprio PDF — viene gestito da direzione.
DROP POLICY IF EXISTS operatori_contratti_direzione_read ON storage.objects;
CREATE POLICY operatori_contratti_direzione_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'operatori-contratti'
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND LOWER(u.email) IN ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    )
  );

DROP POLICY IF EXISTS operatori_contratti_direzione_write ON storage.objects;
CREATE POLICY operatori_contratti_direzione_write ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'operatori-contratti'
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND LOWER(u.email) IN ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    )
  );

DROP POLICY IF EXISTS operatori_contratti_direzione_delete ON storage.objects;
CREATE POLICY operatori_contratti_direzione_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'operatori-contratti'
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND LOWER(u.email) IN ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    )
  );
