-- ============================================================================
-- SITO: STORICO ACCESSI E PAGINE VISITATE (21/10/2026)
--
-- Perche': il Report Sito leggeva auth.users.last_sign_in_at, cioe' SOLO
-- l'ultimo accesso. Massimo Runchina collegato ieri e oggi compariva una volta
-- (oggi cancellava ieri), e chi tornava con la sessione ancora aperta non
-- compariva affatto. Qui ogni visita e' una riga.
--
-- Regole (direzione + GDPR):
--  - sito_visite: una riga per visita (nuova dopo 30 minuti di inattivita').
--    Per i clienti collegati si registra sempre (storico accessi = servizio);
--    per gli anonimi solo con consenso ai cookie statistici.
--  - sito_pagine_viste: le pagine si registrano SOLO con consenso.
--  - Il sito scrive solo tramite le due funzioni qui sotto: user_id lo mette
--    il database (auth.uid()), dal browser non si puo' falsificare.
--  - Leggono solo gli operatori del gestionale (dr7_admin_id()).
--  - Righe piu' vecchie di 12 mesi: cancellate.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sito_visite (
  id                   UUID PRIMARY KEY,
  user_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  iniziata_il          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_attivita      TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispositivo          TEXT,
  provenienza          TEXT,
  pagina_ingresso      TEXT,
  consenso_statistiche BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sito_visite_iniziata_idx ON public.sito_visite (iniziata_il DESC);
CREATE INDEX IF NOT EXISTS sito_visite_user_idx ON public.sito_visite (user_id, iniziata_il DESC);

CREATE TABLE IF NOT EXISTS public.sito_pagine_viste (
  id        BIGSERIAL PRIMARY KEY,
  visita_id UUID NOT NULL REFERENCES public.sito_visite(id) ON DELETE CASCADE,
  percorso  TEXT NOT NULL,
  visto_il  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sito_pagine_viste_visita_idx ON public.sito_pagine_viste (visita_id, visto_il);
CREATE INDEX IF NOT EXISTS sito_pagine_viste_visto_idx ON public.sito_pagine_viste (visto_il DESC);

-- Nessun accesso diretto: solo le funzioni.
ALTER TABLE public.sito_visite ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sito_pagine_viste ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sito_visite FROM anon, authenticated;
REVOKE ALL ON public.sito_pagine_viste FROM anon, authenticated;

-- ── Scrittura dal sito ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sito_registra_visita(
  p_id          UUID,
  p_dispositivo TEXT DEFAULT NULL,
  p_provenienza TEXT DEFAULT NULL,
  p_pagina      TEXT DEFAULT NULL,
  p_consenso    BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  -- Anonimo senza consenso: niente.
  IF v_user IS NULL AND NOT COALESCE(p_consenso, false) THEN RETURN; END IF;

  INSERT INTO public.sito_visite (id, user_id, dispositivo, provenienza, pagina_ingresso, consenso_statistiche)
  VALUES (p_id, v_user, left(p_dispositivo, 40), left(p_provenienza, 200), left(p_pagina, 300), COALESCE(p_consenso, false))
  ON CONFLICT (id) DO UPDATE
    SET ultima_attivita = now(),
        -- chi si collega a meta' visita: la visita diventa sua
        user_id = COALESCE(public.sito_visite.user_id, EXCLUDED.user_id),
        consenso_statistiche = public.sito_visite.consenso_statistiche OR EXCLUDED.consenso_statistiche;

  -- Pulizia a campione: oltre 12 mesi non si tiene niente.
  IF random() < 0.01 THEN
    DELETE FROM public.sito_visite WHERE iniziata_il < now() - interval '12 months';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sito_registra_pagina(
  p_visita   UUID,
  p_percorso TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_visita IS NULL OR p_percorso IS NULL OR p_percorso = '' THEN RETURN; END IF;
  -- Solo visite con consenso ai cookie statistici.
  IF NOT EXISTS (SELECT 1 FROM public.sito_visite WHERE id = p_visita AND consenso_statistiche) THEN
    RETURN;
  END IF;
  INSERT INTO public.sito_pagine_viste (visita_id, percorso) VALUES (p_visita, left(p_percorso, 300));
  UPDATE public.sito_visite SET ultima_attivita = now() WHERE id = p_visita;
END;
$$;

REVOKE ALL ON FUNCTION public.sito_registra_visita(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sito_registra_pagina(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sito_registra_visita(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sito_registra_pagina(UUID, TEXT) TO anon, authenticated;

-- ── Lettura dal gestionale (solo operatori) ─────────────────────────────────

-- Una riga per visita di un cliente collegato: ieri e oggi = due righe.
CREATE OR REPLACE FUNCTION public.dr7_sito_accessi(
  p_from  TIMESTAMPTZ DEFAULT NULL,
  p_to    TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER     DEFAULT 500
)
RETURNS TABLE (
  visita_id       UUID,
  user_id         UUID,
  email           TEXT,
  nome            TEXT,
  cognome         TEXT,
  iniziata_il     TIMESTAMPTZ,
  ultima_attivita TIMESTAMPTZ,
  dispositivo     TEXT,
  provenienza     TEXT,
  pagine          BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.user_id, u.email::text,
         COALESCE(c.nome, ''), COALESCE(c.cognome, ''),
         v.iniziata_il, v.ultima_attivita, v.dispositivo, v.provenienza,
         (SELECT count(*) FROM public.sito_pagine_viste p WHERE p.visita_id = v.id)
    FROM public.sito_visite v
    JOIN auth.users u ON u.id = v.user_id
    LEFT JOIN public.customers_extended c ON c.user_id = v.user_id
   WHERE public.dr7_admin_id() IS NOT NULL
     AND (p_from IS NULL OR v.iniziata_il >= p_from)
     AND (p_to   IS NULL OR v.iniziata_il <= p_to)
   ORDER BY v.iniziata_il DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
$$;

-- Pagine piu' viste nel periodo (visitatori con consenso, collegati o no).
CREATE OR REPLACE FUNCTION public.dr7_sito_pagine_top(
  p_from  TIMESTAMPTZ DEFAULT NULL,
  p_to    TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER     DEFAULT 30
)
RETURNS TABLE (percorso TEXT, viste BIGINT, visite BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.percorso, count(*), count(DISTINCT p.visita_id)
    FROM public.sito_pagine_viste p
   WHERE public.dr7_admin_id() IS NOT NULL
     AND (p_from IS NULL OR p.visto_il >= p_from)
     AND (p_to   IS NULL OR p.visto_il <= p_to)
   GROUP BY p.percorso
   ORDER BY count(*) DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 200));
$$;

-- Percorso di una visita, in ordine.
CREATE OR REPLACE FUNCTION public.dr7_sito_percorso(p_visita UUID)
RETURNS TABLE (percorso TEXT, visto_il TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.percorso, p.visto_il
    FROM public.sito_pagine_viste p
   WHERE public.dr7_admin_id() IS NOT NULL
     AND p.visita_id = p_visita
   ORDER BY p.visto_il;
$$;

REVOKE ALL ON FUNCTION public.dr7_sito_accessi(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dr7_sito_pagine_top(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dr7_sito_percorso(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dr7_sito_accessi(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_sito_pagine_top(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_sito_percorso(UUID) TO authenticated;
