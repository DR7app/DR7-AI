-- ============================================================================
-- PREVENTIVI Mare/Aria/Soggiorni — asset dal catalogo, orari e tour (24/08/2026)
--
-- Problema (direzione): "nel preventivo Aria devono comparire tutti gli
-- elicotteri che ho gia' aggiunto, non devo scriverli io".
-- La tabella `noleggio_preventivi` ha solo `asset_name TEXT`: nel form era un
-- campo libero, scollegato dal catalogo `noleggio_catalog`. E mancava tutto
-- quello che il preventivo Terra ha: orario di inizio/fine e la scelta tour.
--
-- Qui si aggiungono le colonne. `asset_name` RESTA e continua a essere
-- valorizzato: i preventivi gia' salvati non perdono nulla e le stampe che
-- leggono il nome continuano a funzionare.
-- ============================================================================

ALTER TABLE public.noleggio_preventivi
  ADD COLUMN IF NOT EXISTS asset_id         UUID REFERENCES public.noleggio_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_time       TEXT,
  ADD COLUMN IF NOT EXISTS end_time         TEXT,
  ADD COLUMN IF NOT EXISTS is_tour          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duration_label   TEXT,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS passengers       INTEGER;

COMMENT ON COLUMN public.noleggio_preventivi.asset_id IS
  'Mezzo scelto dal catalogo noleggio_catalog. asset_name resta come testo stampabile e per lo storico.';
COMMENT ON COLUMN public.noleggio_preventivi.start_time IS 'Orario inizio HH:MM (Europe/Rome), come sui preventivi Terra.';
COMMENT ON COLUMN public.noleggio_preventivi.is_tour IS 'TRUE = preventivo per un tour, con durata e passeggeri invece del periodo.';

CREATE INDEX IF NOT EXISTS idx_noleggio_preventivi_asset
  ON public.noleggio_preventivi(asset_id);

-- ── Recupero storico: aggancia i preventivi esistenti al catalogo quando il
--    nome coincide, cosi' non restano orfani. Anteprima prima dell'UPDATE.
SELECT p.id, p.service_type, p.asset_name, c.id AS catalogo_id, c.name AS catalogo_nome
  FROM public.noleggio_preventivi p
  JOIN public.noleggio_catalog c
    ON c.service_type = p.service_type
   AND lower(trim(c.name)) = lower(trim(p.asset_name))
 WHERE p.asset_id IS NULL
   AND p.asset_name IS NOT NULL;

UPDATE public.noleggio_preventivi p
   SET asset_id = c.id, updated_at = NOW()
  FROM public.noleggio_catalog c
 WHERE c.service_type = p.service_type
   AND lower(trim(c.name)) = lower(trim(p.asset_name))
   AND p.asset_id IS NULL
   AND p.asset_name IS NOT NULL;

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'noleggio_preventivi'
   AND column_name IN ('asset_id','start_time','end_time','is_tour','duration_label','duration_minutes','passengers')
 ORDER BY column_name;
