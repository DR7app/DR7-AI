-- ============================================================================
-- PRENOTAZIONI MARE / ARIA / SOGGIORNI: vehicle_type ammesso (25/08/2026)
--
-- Sintomo: salvando una prenotazione Aria il gestionale risponde
--   new row for relation "bookings" violates check constraint
--   "bookings_vehicle_type_check"   (SQLSTATE 23514)
--
-- Causa: su un business dedicato la prenotazione nasce con il tipo del mezzo
-- ('boat' per Mare, 'helicopter' per Aria, 'stay' per Soggiorni), ma il CHECK
-- su bookings.vehicle_type e' rimasto quello dei tempi in cui esisteva solo il
-- noleggio auto. La riga viene rifiutata dal database, non dal codice.
--
-- Questa migrazione NON sostituisce l'elenco: lo ALLARGA. Il nuovo vincolo
-- ammette i valori gia' presenti nella tabella (qualunque essi siano, anche
-- quelli storici che nessuno ricorda) piu' i quattro canonici. Cosi' nessuna
-- riga esistente diventa invalida e l'ADD CONSTRAINT non puo' fallire.
-- ============================================================================

-- ── ANTEPRIMA (eseguire PRIMA del blocco che modifica) ──────────────────────
-- 1) Come e' fatto il vincolo adesso:
SELECT conname, pg_get_constraintdef(oid) AS definizione
  FROM pg_constraint
 WHERE conrelid = 'public.bookings'::regclass
   AND conname = 'bookings_vehicle_type_check';

-- 2) Quali valori esistono davvero nelle prenotazioni:
SELECT COALESCE(vehicle_type, '(nullo)') AS vehicle_type, COUNT(*) AS righe
  FROM public.bookings
 GROUP BY 1
 ORDER BY righe DESC;

-- ── MODIFICA ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  valori TEXT;
BEGIN
  -- Unione fra i valori gia' presenti e i quattro canonici.
  SELECT string_agg(quote_literal(v), ', ' ORDER BY v)
    INTO valori
    FROM (
      SELECT DISTINCT vehicle_type AS v
        FROM public.bookings
       WHERE vehicle_type IS NOT NULL
      UNION
      SELECT unnest(ARRAY['car', 'boat', 'helicopter', 'stay'])
    ) s;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.bookings'::regclass
       AND conname = 'bookings_vehicle_type_check'
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT bookings_vehicle_type_check;
  END IF;

  -- NULL resta ammesso: sul Noleggio Terra storico la colonna e' spesso vuota.
  EXECUTE format(
    'ALTER TABLE public.bookings ADD CONSTRAINT bookings_vehicle_type_check '
    'CHECK (vehicle_type IS NULL OR vehicle_type IN (%s))', valori);

  RAISE NOTICE 'bookings_vehicle_type_check ora ammette: %', valori;
END $$;

-- ── RECUPERO RIGHE GIA' SALVATE ─────────────────────────────────
-- Finche' il vincolo era stretto il gestionale salvava la prenotazione
-- SENZA il tipo di mezzo (meglio NULL che perdere la prenotazione). Quelle
-- righe esistono e sono visibili nel loro elenco - l'elenco filtra per
-- service_type - ma il tipo di mezzo e' rimasto vuoto. Qui lo rimettiamo.
-- Tocca SOLO le righe di Mare / Aria / Soggiorni con vehicle_type nullo:
-- il Noleggio Terra storico ha la colonna vuota per progetto e non si tocca.
-- Conta PRIMA quante righe verranno toccate (l'ancora e' service_type):
SELECT service_type, COUNT(*) AS righe_da_riempire
  FROM public.bookings
 WHERE vehicle_type IS NULL
   AND service_type IN ('boat_rental', 'heli_rental', 'stay_rental')
 GROUP BY service_type;

UPDATE public.bookings
   SET vehicle_type = CASE service_type
                        WHEN 'boat_rental' THEN 'boat'
                        WHEN 'heli_rental' THEN 'helicopter'
                        ELSE 'stay'
                      END
 WHERE vehicle_type IS NULL
   AND service_type IN ('boat_rental', 'heli_rental', 'stay_rental');

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT pg_get_constraintdef(oid) AS definizione_nuova
  FROM pg_constraint
 WHERE conrelid = 'public.bookings'::regclass
   AND conname = 'bookings_vehicle_type_check';
