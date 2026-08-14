-- ============================================================================
-- Preventivi anche per Lavaggio & Meccanica (2026-08-14)
--
-- Richiesta direzione: la voce Preventivi deve esistere per Lavaggio come per
-- Mare, Aria e Soggiorni.
--
-- `noleggio_preventivi` e' gia' generica (una riga per service_type), ma il
-- CHECK creato in 20260617 elencava solo i tre business del noleggio: un
-- preventivo di lavaggio veniva rifiutato dal database. Qui si allarga il
-- vincolo, nient'altro — nessuna colonna nuova, nessuna riga toccata.
--
-- Si allarga SOLO noleggio_preventivi. `noleggio_catalog` resta com'e': il
-- catalogo dei lavaggi ha gia' la sua tab (CarWashCatalogTab, voce "Lavaggi"),
-- e duplicarlo qui creerebbe due elenchi da tenere allineati.
-- ============================================================================

ALTER TABLE public.noleggio_preventivi
  DROP CONSTRAINT IF EXISTS noleggio_preventivi_service_type_check;

ALTER TABLE public.noleggio_preventivi
  ADD CONSTRAINT noleggio_preventivi_service_type_check
  CHECK (service_type IN ('boat_rental', 'heli_rental', 'stay_rental', 'car_wash'));

COMMENT ON CONSTRAINT noleggio_preventivi_service_type_check
  ON public.noleggio_preventivi IS
  'Business che usano la vista Preventivi condivisa (NoleggioServiceTab view=preventivi). Allargato a car_wash il 14/08/2026.';

-- Verifica: il vincolo deve elencare i 4 business.
SELECT conname, pg_get_constraintdef(oid) AS definizione
  FROM pg_constraint
 WHERE conrelid = 'public.noleggio_preventivi'::regclass
   AND conname = 'noleggio_preventivi_service_type_check';
