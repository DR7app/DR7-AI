-- ============================================================================
-- RECENSIONI GOOGLE SEMPRE AGGIORNATE (26/09/2026)
--
-- Il sito mostrava 5 recensioni "piu' rilevanti" chieste a Google a ogni
-- visita, piu' 36 recensioni scritte a mano nel gestionale. Ora:
--   - sync-google-reviews-cron (ogni tre ore) copia qui le recensioni vere:
--     tutte da Google Business quando l'accesso API e' approvato, altrimenti
--     le 5 piu' recenti da Google Maps a ogni giro (la lista cresce, non si
--     cancella niente);
--   - il sito legge da qui, dalla piu' recente;
--   - dal gestionale (Sito > Recensioni) si puo' nascondere una recensione.
--
-- La stessa recensione puo' arrivare dalle due fonti (con e senza id Google):
-- la chiave primaria (autore normalizzato + giorno + stelle) la riconosce in
-- entrambi i casi. Stessa regola in netlify/functions/utils/recensioniGoogle.ts.
-- ============================================================================

-- Una vecchia google_reviews_cache (tentativo abbandonato, colonne review_id /
-- author_name / time) esisteva gia', VUOTA e mai usata dal codice. Si toglie
-- solo se e' ancora vuota e nel vecchio formato: mai perdere dati.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'google_reviews_cache'
                AND column_name = 'review_id') THEN
    IF (SELECT count(*) FROM public.google_reviews_cache) = 0 THEN
      DROP TABLE public.google_reviews_cache;
    ELSE
      RAISE EXCEPTION 'google_reviews_cache nel vecchio formato contiene dati: controllare a mano prima di migrare';
    END IF;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.google_reviews_cache (
  -- Chiave anti-doppione: "autore|aaaa-mm-gg|stelle".
  id            TEXT PRIMARY KEY,
  -- reviewId di Google Business, quando la recensione arriva da li'.
  google_review_id TEXT,
  source        TEXT NOT NULL CHECK (source IN ('gbp', 'places')),
  author        TEXT,
  author_photo  TEXT,
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  text          TEXT,
  lang          TEXT,
  published_at  TIMESTAMPTZ,
  reply         TEXT,
  reply_at      TIMESTAMPTZ,
  hidden        BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_reviews_cache_recenti
  ON public.google_reviews_cache (published_at DESC) WHERE NOT hidden;

CREATE TABLE IF NOT EXISTS public.google_reviews_summary (
  id               TEXT PRIMARY KEY DEFAULT 'main',
  rating           NUMERIC(3,2),
  total            INTEGER,
  source           TEXT,
  fetched_at       TIMESTAMPTZ,
  last_success_at  TIMESTAMPTZ,
  last_error       TEXT,
  CONSTRAINT google_reviews_summary_singola CHECK (id = 'main')
);

INSERT INTO public.google_reviews_summary (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Lettura: chiunque (le recensioni sono pubbliche su Google), solo quelle non
-- nascoste; lo staff vede anche le nascoste per poterle rimostrare.
-- Scrittura: solo il server (service role, che ignora RLS). Lo staff puo'
-- solo cambiare `hidden`.
ALTER TABLE public.google_reviews_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_reviews_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_reviews_cache_lettura ON public.google_reviews_cache;
CREATE POLICY google_reviews_cache_lettura ON public.google_reviews_cache
  FOR SELECT USING (
    NOT hidden
    OR public.dr7_admin_id() IS NOT NULL
    OR public.dr7_is_direzione()
  );

DROP POLICY IF EXISTS google_reviews_cache_nascondi ON public.google_reviews_cache;
CREATE POLICY google_reviews_cache_nascondi ON public.google_reviews_cache
  FOR UPDATE
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione())
  WITH CHECK (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

DROP POLICY IF EXISTS google_reviews_summary_lettura ON public.google_reviews_summary;
CREATE POLICY google_reviews_summary_lettura ON public.google_reviews_summary
  FOR SELECT USING (true);

GRANT SELECT ON public.google_reviews_cache TO anon, authenticated;
GRANT SELECT ON public.google_reviews_summary TO anon, authenticated;
-- Lo staff tocca SOLO la colonna hidden: nome, testo e stelle restano quelli di Google.
REVOKE UPDATE ON public.google_reviews_cache FROM authenticated;
GRANT UPDATE (hidden) ON public.google_reviews_cache TO authenticated;
