-- ============================================================================
-- Catalogo: il vincolo su service_type bloccava l'inserimento (25/08/2026)
--
-- SINTOMO: "Aggiungi" nel Catalogo Soggiorni & Ospitalita' (Alloggi) rispondeva
--   new row for relation "noleggio_catalog" violates check constraint
--   "noleggio_catalog_service_type_check"
--
-- CAUSA: il vincolo in produzione elenca meno service_type di quanti ne manda
-- l'app. `NoleggioServiceTab` scrive `service_type` uguale alla prop del tab:
--   Terra 'car_rental' · Mare 'boat_rental' · Aria 'heli_rental'
--   Soggiorni 'stay_rental' · Lavaggio/Meccanica 'car_wash'
-- mentre il vincolo nato con la tabella (20260617) ne accettava solo tre, e
-- non e' mai stato allargato come invece e' successo a `noleggio_preventivi`
-- (20260814100000 aggiunse 'car_wash').
--
-- SCELTA: la lista viene allineata a `src/utils/businessScope.ts` (BUSINESSES +
-- gli alias storici che la stessa `toBusiness()` normalizza), cosi' non serve
-- una nuova migrazione ogni volta che un business apre il suo catalogo.
-- Nessun dato toccato: le righe esistenti usano tutte valori che restano validi.
-- Idempotente: safe to re-run.
-- ============================================================================

-- Guardia: se in tabella esistesse un valore fuori lista, l'ADD CONSTRAINT
-- fallirebbe con un errore muto sul nome del vincolo. Qui si vede subito QUALE
-- valore lo blocca, prima di toccare qualsiasi cosa.
DO $$
DECLARE fuori TEXT;
BEGIN
  SELECT string_agg(DISTINCT t.service_type, ', ')
    INTO fuori
    FROM (
      SELECT service_type FROM public.noleggio_catalog
      UNION ALL
      SELECT service_type FROM public.noleggio_preventivi
    ) t
   WHERE t.service_type NOT IN (
     'rental','car_rental','boat_rental','heli_rental','stay_rental',
     'car_wash','mechanical','mechanical_service'
   );
  IF fuori IS NOT NULL THEN
    RAISE EXCEPTION 'service_type fuori lista, aggiungerli prima di allargare il vincolo: %', fuori;
  END IF;
END $$;

ALTER TABLE public.noleggio_catalog
  DROP CONSTRAINT IF EXISTS noleggio_catalog_service_type_check;

ALTER TABLE public.noleggio_catalog
  ADD CONSTRAINT noleggio_catalog_service_type_check
  CHECK (service_type IN (
    'rental', 'car_rental',      -- Noleggio Terra (storico: due nomi)
    'boat_rental',               -- Noleggio Mare
    'heli_rental',               -- Noleggio Aria
    'stay_rental',               -- Soggiorni & Ospitalita'
    'car_wash', 'mechanical', 'mechanical_service'  -- Lavaggio & Meccanica
  ));

-- Stesso allargamento sui preventivi: la lista era ferma a quattro valori
-- (20260814100000) e un preventivo di Terra sarebbe stato rifiutato allo stesso
-- modo, con lo stesso messaggio.
ALTER TABLE public.noleggio_preventivi
  DROP CONSTRAINT IF EXISTS noleggio_preventivi_service_type_check;

ALTER TABLE public.noleggio_preventivi
  ADD CONSTRAINT noleggio_preventivi_service_type_check
  CHECK (service_type IN (
    'rental', 'car_rental',
    'boat_rental',
    'heli_rental',
    'stay_rental',
    'car_wash', 'mechanical', 'mechanical_service'
  ));
