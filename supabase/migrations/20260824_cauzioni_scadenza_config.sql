-- ============================================================================
-- SCADENZA CAUZIONE CONFIGURABILE DA CENTRALINA PRO (24/08/2026)
--
-- Problema: due calcoli in disaccordo scrivevano la stessa colonna.
--   1) trigger `auto_calculate_scadenza_cauzione` (mig. 20260722b):
--      data_restituzione + N giorni di CALENDARIO, N da cauzioni_config
--      (default 15);
--   2) netlify `sync-booking-cauzione`: 14 giorni LAVORATIVI, festivi esclusi,
--      con il 14 scritto in duro nel codice.
-- Vinceva chi scriveva per ultimo. La regola confermata dalla direzione il
-- 12/08 e applicata alle righe dalla mig. 20260810 e' la (2): 14 lavorativi.
--
-- Questa migrazione rende quella regola UNICA e configurabile:
--   - aggiunge `modalita_calcolo` ('lavorativi' | 'calendario');
--   - allinea il default a 14 lavorativi;
--   - riscrive il trigger perche' usi la config invece di sommare giorni di
--     calendario a prescindere.
-- Il codice Netlify legge la stessa riga: un solo posto da cambiare.
-- ============================================================================

ALTER TABLE public.cauzioni_config
  ADD COLUMN IF NOT EXISTS modalita_calcolo TEXT NOT NULL DEFAULT 'lavorativi';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cauzioni_config_modalita_calcolo_chk'
  ) THEN
    ALTER TABLE public.cauzioni_config
      ADD CONSTRAINT cauzioni_config_modalita_calcolo_chk
      CHECK (modalita_calcolo IN ('lavorativi', 'calendario'));
  END IF;
END $$;

COMMENT ON COLUMN public.cauzioni_config.modalita_calcolo IS
  'lavorativi = lun-ven festivi esclusi (regola DR7, default). calendario = giorni solari.';
COMMENT ON COLUMN public.cauzioni_config.giorni_restituzione_default IS
  'Giorni entro cui la cauzione va restituita. Default 14 (confermato direzione 12/08/2026). Modificabile da Centralina Pro > Cauzioni.';

ALTER TABLE public.cauzioni_config
  ALTER COLUMN giorni_restituzione_default SET DEFAULT 14;

-- ── ANTEPRIMA (eseguire PRIMA dell'UPDATE) ──────────────────────────────────
-- Riga singleton: deve mostrare 1 riga con 15 se non e' mai stata toccata.
SELECT id, giorni_restituzione_default, modalita_calcolo
  FROM public.cauzioni_config WHERE id = 'main';

-- Allinea la config a cio' che il sistema applica davvero (14 lavorativi).
-- Tocca SOLO la riga ancora al vecchio default di calendario.
UPDATE public.cauzioni_config
   SET giorni_restituzione_default = 14,
       modalita_calcolo            = 'lavorativi',
       updated_at                  = NOW()
 WHERE id = 'main'
   AND giorni_restituzione_default = 15;

-- ── Trigger: una sola regola, presa dalla config ────────────────────────────
CREATE OR REPLACE FUNCTION auto_calculate_scadenza_cauzione()
RETURNS TRIGGER AS $$
DECLARE
  v_giorni INTEGER;
  v_mod    TEXT;
BEGIN
  -- Override manuale dell'operatore: vince sempre, non si ricalcola.
  IF NEW.scadenza_forzata_manualmente IS TRUE THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.data_restituzione_veicolo IS DISTINCT FROM OLD.data_restituzione_veicolo)
     AND NEW.stato NOT IN ('Restituita', 'Sbloccata', 'Incassata', 'Bloccata', 'Danno') THEN

    SELECT COALESCE(giorni_restituzione_default, 14),
           COALESCE(modalita_calcolo, 'lavorativi')
      INTO v_giorni, v_mod
      FROM public.cauzioni_config WHERE id = 'main';

    IF v_giorni IS NULL OR v_giorni < 1 THEN v_giorni := 14; END IF;

    IF v_mod = 'calendario' THEN
      NEW.scadenza_cauzione := NEW.data_restituzione_veicolo + (v_giorni || ' days')::interval;
    ELSE
      -- Giorni lavorativi lun-ven, festivi esclusi, a partire dal primo
      -- lavorativo DOPO la restituzione (funzione della mig. 20260810).
      NEW.scadenza_cauzione := public.dr7_scadenza_lavorativi(NEW.data_restituzione_veicolo, v_giorni);
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_calculate_scadenza_cauzione() IS
  'Scadenza cauzione dalla config singleton cauzioni_config (giorni + modalita). Un override manuale (scadenza_forzata_manualmente) non viene mai ricalcolato.';

-- ── VERIFICA ────────────────────────────────────────────────────────────────
-- Con 14 lavorativi, una riconsegna di venerdi' deve cadere ~3 settimane dopo.
SELECT public.dr7_scadenza_lavorativi(CURRENT_DATE, 14) AS scadenza_se_riconsegna_oggi;
