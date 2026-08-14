-- ============================================================================
-- Tour anche sul Noleggio Terra (2026-08-14)
--
-- Richiesta direzione: il Tour deve esistere per OGNI business, Terra
-- compresa, e funzionare come Mare e Aria — si programma una partenza (data,
-- orario, prezzo), il sistema crea i posti, i posti si vendono uno a uno.
--
-- Il blocco era strutturale: `noleggio_tour_departures.catalog_id` e' NOT NULL
-- e punta a `noleggio_catalog`, mentre la flotta di Terra vive in `vehicles`.
-- Un tour in Lamborghini non poteva esistere senza prima ri-inserire l'auto in
-- un secondo catalogo — cioe' una flotta doppia da tenere allineata a mano.
--
-- Scelta della direzione: le partenze di Terra puntano DIRETTAMENTE alla
-- flotta esistente. Quindi:
--   catalog_id  -> nullable, resta la fonte per Mare / Aria / Soggiorni
--   vehicle_id  -> nuova, e' la fonte per il Noleggio Terra
-- ed esattamente UNA delle due deve essere valorizzata su ogni riga.
--
-- Niente dati toccati: le partenze esistenti hanno tutte catalog_id e restano
-- valide senza modifiche.
-- Idempotente: safe to re-run.
-- ============================================================================

-- ── 1. La partenza puo' agganciarsi alla flotta invece che al catalogo ──────
ALTER TABLE public.noleggio_tour_departures
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE;

ALTER TABLE public.noleggio_tour_departures
  ALTER COLUMN catalog_id DROP NOT NULL;

COMMENT ON COLUMN public.noleggio_tour_departures.vehicle_id IS
  'Mezzo della flotta (Noleggio Terra). Alternativo a catalog_id, che serve Mare/Aria/Soggiorni.';

-- Esattamente una delle due sorgenti: mai nessuna, mai entrambe. Senza questo
-- vincolo una partenza orfana (nessuna delle due) passerebbe inosservata e il
-- Tour mostrerebbe una riga senza mezzo.
ALTER TABLE public.noleggio_tour_departures
  DROP CONSTRAINT IF EXISTS tour_departures_una_sola_sorgente;

ALTER TABLE public.noleggio_tour_departures
  ADD CONSTRAINT tour_departures_una_sola_sorgente
  CHECK (
    (catalog_id IS NOT NULL AND vehicle_id IS NULL)
    OR (catalog_id IS NULL AND vehicle_id IS NOT NULL)
  );

-- ── 2. Unicita' della partenza anche lato flotta ────────────────────────────
-- La UNIQUE originale (catalog_id, data, ora) non copre le righe con
-- catalog_id NULL: in Postgres i NULL non collidono mai, quindi senza questo
-- indice si potrebbero creare due partenze identiche per la stessa auto.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tour_departures_vehicle_slot
  ON public.noleggio_tour_departures (vehicle_id, departure_date, departure_time)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tour_departures_vehicle
  ON public.noleggio_tour_departures(vehicle_id);

-- NOTA: `seed_tour_seats()` NON viene toccata di proposito. Crea i posti
-- lasciando `price_cents` a NULL, cioe' "eredita il prezzo della partenza":
-- riscriverla per calcolare un prezzo dalla flotta congelerebbe un override
-- per posto anche su Mare e Aria, cambiando un comportamento che oggi
-- funziona. Il prezzo di una partenza di Terra si imposta come per gli altri
-- business, con `price_per_seat_cents` sulla partenza.

-- ── Verifica ────────────────────────────────────────────────────────────────
-- Attesi: colonna vehicle_id presente, catalog_id nullable, il CHECK sulle due
-- sorgenti, e l'indice unico parziale sulla flotta.
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'noleggio_tour_departures'
   AND column_name IN ('catalog_id', 'vehicle_id')
 ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid) AS definizione
  FROM pg_constraint
 WHERE conrelid = 'public.noleggio_tour_departures'::regclass
   AND conname = 'tour_departures_una_sola_sorgente';
