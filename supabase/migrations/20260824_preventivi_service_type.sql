-- ============================================================================
-- PREVENTIVI PER BUSINESS (24/08/2026)
--
-- Richiesta direzione: "anche il Preventivo deve essere come quello di
-- Noleggio Terra, per Mare e Aria". La scheda e' la stessa (PreventiviTab):
-- serve solo sapere di quale business e' il preventivo, altrimenti quelli
-- del Mare comparirebbero nell'elenco del Noleggio Terra.
--
--   service_type NULL / 'rental' -> Noleggio Terra (tutte le righe storiche)
--   'boat_rental'                -> Noleggio Mare
--   'heli_rental'                -> Noleggio Aria
--   'stay_rental'                -> Soggiorni & Ospitalita
--
-- I preventivi gia' salvati non hanno il campo: restano Terra, cioe'
-- esattamente dove si vedono oggi. Nessuno sparisce.
--
-- vehicle_id: su Mare/Aria/Soggiorni il mezzo viene da `noleggio_catalog`,
-- mentre questa colonna riferisce `vehicles` (la flotta auto). Il codice la
-- lascia NULL e salva l'id del mezzo in `extras_detail.asset_id`; il vincolo
-- di chiave esterna resta valido per Terra e non va toccato.
-- ============================================================================

ALTER TABLE public.preventivi
  ADD COLUMN IF NOT EXISTS service_type TEXT
    CHECK (service_type IN ('rental','boat_rental','heli_rental','stay_rental'));

COMMENT ON COLUMN public.preventivi.service_type IS
  'Business del preventivo. NULL = Noleggio Terra (storico). Vedi src/utils/businessScope.ts';

CREATE INDEX IF NOT EXISTS idx_preventivi_service_type
  ON public.preventivi(service_type, created_at DESC);

-- Le righe storiche sono tutte del Noleggio Terra: le si marca esplicitamente
-- cosi' la colonna diventa leggibile a occhio (il codice tratta NULL = Terra
-- comunque, quindi questo UPDATE non cambia il comportamento).
UPDATE public.preventivi SET service_type = 'rental' WHERE service_type IS NULL;

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT COALESCE(service_type, 'NULL (= Terra)') AS business, COUNT(*) AS preventivi
  FROM public.preventivi
 GROUP BY 1
 ORDER BY 1;
