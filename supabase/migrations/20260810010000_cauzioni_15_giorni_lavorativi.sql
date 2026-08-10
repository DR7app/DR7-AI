-- ============================================================================
-- BUG CAUZIONI (direzione, 2026-08-10): scadenze tutte ANTICIPATE
--
-- La scadenza di restituzione cauzione deve essere a 15 GIORNI LAVORATIVI:
--   - lavorativi = lunedi'-venerdi';
--   - esclusi TUTTI i festivi;
--   - il conteggio parte dal primo giorno lavorativo DOPO la restituzione:
--     se l'auto torna venerdi', il giorno 1 e' il lunedi' successivo.
--
-- Il calcolo in `sync-booking-cauzione` aveva due difetti:
--   1. contava 14 giorni lavorativi invece di 15;
--   2. non escludeva i festivi.
-- Risultato: ogni scadenza anticipata di 1 giorno sempre, fino a 5 giorni nei
-- periodi di festa (es. restituzione 11/12/2026 -> scadenza calcolata
-- 31/12/2026 invece del 05/01/2027). Le cauzioni venivano sollecitate e
-- restituite prima del dovuto.
--
-- Questa migrazione: crea la funzione di calcolo e RETTIFICA le cauzioni
-- ancora aperte. Le cauzioni chiuse (Restituita / Incassata / con
-- data_incasso) NON vengono toccate: sono storia, non vanno riscritte.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dr7_festivo_it(d DATE)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT to_char(d, 'YYYY-MM-DD') IN (
    '2025-01-01','2025-01-06','2025-04-20','2025-04-21','2025-04-25',
    '2025-05-01','2025-06-02','2025-08-15','2025-11-01','2025-12-08',
    '2025-12-25','2025-12-26',
    '2026-01-01','2026-01-06','2026-04-05','2026-04-06','2026-04-25',
    '2026-05-01','2026-06-02','2026-08-15','2026-11-01','2026-12-08',
    '2026-12-25','2026-12-26',
    '2027-01-01','2027-01-06','2027-03-28','2027-03-29','2027-04-25',
    '2027-05-01','2027-06-02','2027-08-15','2027-11-01','2027-12-08',
    '2027-12-25','2027-12-26'
  );
$$;

COMMENT ON FUNCTION public.dr7_festivo_it(DATE) IS
  'true se la data e'' un festivo nazionale italiano. Stesso elenco di netlify/functions/utils/giorniLavorativi.ts e src/data/italianHolidays.ts: aggiornando un anno, aggiornarli tutti.';

CREATE OR REPLACE FUNCTION public.dr7_scadenza_lavorativi(data_restituzione DATE, giorni INT DEFAULT 15)
RETURNS DATE
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  cur DATE;
  contati INT := 1;
BEGIN
  IF data_restituzione IS NULL THEN RETURN NULL; END IF;

  -- Primo giorno lavorativo DOPO la restituzione (venerdi' -> lunedi').
  cur := data_restituzione + 1;
  WHILE EXTRACT(ISODOW FROM cur) > 5 OR public.dr7_festivo_it(cur) LOOP
    cur := cur + 1;
  END LOOP;

  -- Quello raggiunto e' il giorno lavorativo n.1.
  WHILE contati < giorni LOOP
    cur := cur + 1;
    IF EXTRACT(ISODOW FROM cur) <= 5 AND NOT public.dr7_festivo_it(cur) THEN
      contati := contati + 1;
    END IF;
  END LOOP;

  RETURN cur;
END;
$$;

COMMENT ON FUNCTION public.dr7_scadenza_lavorativi(DATE, INT) IS
  'Scadenza a N giorni lavorativi (lun-ven, festivi esclusi) dal giorno dopo la restituzione. Default 15, come da regola direzione 2026-08-10.';


-- ── ANTEPRIMA (eseguire PRIMA dell'UPDATE) ──────────────────────────────────
-- Mostra quali cauzioni aperte cambiano e di quanti giorni erano anticipate.
SELECT c.id,
       c.data_restituzione_veicolo                                   AS restituzione,
       c.scadenza_cauzione                                           AS scadenza_attuale,
       public.dr7_scadenza_lavorativi(c.data_restituzione_veicolo)   AS scadenza_corretta,
       public.dr7_scadenza_lavorativi(c.data_restituzione_veicolo)
         - c.scadenza_cauzione                                       AS giorni_di_anticipo,
       c.stato
  FROM public.cauzioni c
 WHERE c.data_restituzione_veicolo IS NOT NULL
   AND c.data_incasso IS NULL
   AND coalesce(c.stato, '') NOT IN ('Restituita', 'Incassata')
   AND c.scadenza_cauzione IS DISTINCT FROM public.dr7_scadenza_lavorativi(c.data_restituzione_veicolo)
 ORDER BY c.scadenza_cauzione;


-- ── RETTIFICA ───────────────────────────────────────────────────────────────
-- Ricalcola le cauzioni ANCORA APERTE. Le chiuse restano come sono.
UPDATE public.cauzioni c
   SET scadenza_cauzione = public.dr7_scadenza_lavorativi(c.data_restituzione_veicolo),
       updated_at = NOW()
 WHERE c.data_restituzione_veicolo IS NOT NULL
   AND c.data_incasso IS NULL
   AND coalesce(c.stato, '') NOT IN ('Restituita', 'Incassata')
   AND c.scadenza_cauzione IS DISTINCT FROM public.dr7_scadenza_lavorativi(c.data_restituzione_veicolo);


-- ── VERIFICA ────────────────────────────────────────────────────────────────
-- Deve restituire 0 righe: nessuna cauzione aperta fuori regola.
SELECT count(*) AS cauzioni_ancora_fuori_regola
  FROM public.cauzioni c
 WHERE c.data_restituzione_veicolo IS NOT NULL
   AND c.data_incasso IS NULL
   AND coalesce(c.stato, '') NOT IN ('Restituita', 'Incassata')
   AND c.scadenza_cauzione IS DISTINCT FROM public.dr7_scadenza_lavorativi(c.data_restituzione_veicolo);
