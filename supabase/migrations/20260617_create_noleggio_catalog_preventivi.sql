-- Noleggio Mare / Aria / Soggiorni — backing tables + storage
-- ------------------------------------------------------------------
-- The admin component src/pages/admin/components/NoleggioServiceTab.tsx
-- (serviceType 'boat_rental' | 'heli_rental' | 'stay_rental') reads/writes:
--   • noleggio_catalog     -> the "Catalogo" view (catalogue in place of the car Flotta)
--   • noleggio_preventivi  -> the "Preventivi" view
--   • storage bucket catalog-images (path noleggio-catalog/*) -> catalogue photos
--   • bookings.service_type -> "Prenotazioni"/"Calendario" (table already exists, no change)
-- Money columns store integer CENTS (component uses eurToCents / centsToEur).
-- RLS mirrors the existing preventivi table: any authenticated admin session has full access.
-- Idempotent: safe to re-run.

-- ==================================================================
-- 1. Catalogo (catalogue of boats / helicopters / stays)
-- ==================================================================
CREATE TABLE IF NOT EXISTS noleggio_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type  TEXT NOT NULL
                CHECK (service_type IN ('boat_rental','heli_rental','stay_rental')),
  name          TEXT NOT NULL,
  description   TEXT,
  price_per_day INTEGER NOT NULL DEFAULT 0,   -- cents / day
  capacity      INTEGER,                      -- persone
  image_url     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noleggio_catalog_service
  ON noleggio_catalog(service_type, sort_order, name);

ALTER TABLE noleggio_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage noleggio_catalog" ON noleggio_catalog;
CREATE POLICY "Admins can manage noleggio_catalog"
  ON noleggio_catalog FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ==================================================================
-- 2. Preventivi (quotes)
-- ==================================================================
CREATE TABLE IF NOT EXISTS noleggio_preventivi (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type   TEXT NOT NULL
                 CHECK (service_type IN ('boat_rental','heli_rental','stay_rental')),
  customer_name  TEXT,
  customer_phone TEXT,
  asset_name     TEXT,
  start_date     DATE,
  end_date       DATE,
  amount         INTEGER NOT NULL DEFAULT 0,  -- cents
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'bozza'
                 CHECK (status IN ('bozza','inviato','accettato','rifiutato','scaduto')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noleggio_preventivi_service
  ON noleggio_preventivi(service_type, created_at DESC);

ALTER TABLE noleggio_preventivi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage noleggio_preventivi" ON noleggio_preventivi;
CREATE POLICY "Admins can manage noleggio_preventivi"
  ON noleggio_preventivi FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ==================================================================
-- 3. Storage bucket for catalogue photos (public read)
--    mirrors 20260430_create_vehicle_images_bucket.sql
-- ==================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalog-images',
  'catalog-images',
  TRUE,
  10485760,  -- 10 MB
  ARRAY['image/png','image/jpeg','image/jpg','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "catalog-images public read" ON storage.objects;
CREATE POLICY "catalog-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'catalog-images');

DROP POLICY IF EXISTS "catalog-images authenticated insert" ON storage.objects;
CREATE POLICY "catalog-images authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'catalog-images');

DROP POLICY IF EXISTS "catalog-images authenticated update" ON storage.objects;
CREATE POLICY "catalog-images authenticated update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'catalog-images')
  WITH CHECK (bucket_id = 'catalog-images');

DROP POLICY IF EXISTS "catalog-images authenticated delete" ON storage.objects;
CREATE POLICY "catalog-images authenticated delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'catalog-images');
