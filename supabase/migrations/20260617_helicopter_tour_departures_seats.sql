-- Noleggio Aria — Tour Elicottero: PARTENZE + SEAT MAP (biglietti tour)
-- ------------------------------------------------------------------
-- Estende il modulo Noleggio Aria (NoleggioServiceTab, serviceType 'heli_rental')
-- con la vendita di BIGLIETTI per tour a posto singolo.
--
-- Flusso cliente (sito):
--   sezione elicottero -> scegli DATA del tour -> scegli ORARIO ->
--   seleziona uno o piu' POSTI (seat map nominale) -> aggiungi al carrello ->
--   checkout + pagamento Nexi -> conferma + fattura WhatsApp (come noleggio).
--
-- Modello dati (si appoggia al catalogo esistente):
--   noleggio_catalog        = il TOUR/esperienza (gia' esistente, heli_rental)
--   noleggio_tour_departures = una PARTENZA = tour (catalog) + data + orario
--   noleggio_tour_seats      = SEAT MAP nominale per partenza (posto 1,2,3...)
--
-- Pagamento/fattura: riusa la tabella `bookings` (service_type 'heli_rental'):
--   il posto venduto punta a bookings.id via noleggio_tour_seats.booking_id.
-- Money in CENTS interi (come noleggio_catalog).
-- Idempotente: safe to re-run.

-- ==================================================================
-- 1. PARTENZE (data + orario di un tour del catalogo)
-- ==================================================================
CREATE TABLE IF NOT EXISTS noleggio_tour_departures (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id           UUID NOT NULL REFERENCES noleggio_catalog(id) ON DELETE CASCADE,
  departure_date       DATE NOT NULL,
  departure_time       TIME NOT NULL,
  total_seats          INTEGER NOT NULL DEFAULT 6,
  price_per_seat_cents INTEGER,              -- override; NULL = usa noleggio_catalog.price_per_day
  status               TEXT NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','cancelled','completed')),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (catalog_id, departure_date, departure_time)
);

CREATE INDEX IF NOT EXISTS idx_tour_departures_catalog
  ON noleggio_tour_departures(catalog_id);
CREATE INDEX IF NOT EXISTS idx_tour_departures_date
  ON noleggio_tour_departures(departure_date);

ALTER TABLE noleggio_tour_departures ENABLE ROW LEVEL SECURITY;

-- Admin: accesso completo (mirror noleggio_catalog)
DROP POLICY IF EXISTS "Admins can manage tour_departures" ON noleggio_tour_departures;
CREATE POLICY "Admins can manage tour_departures"
  ON noleggio_tour_departures FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Sito (anon): legge solo le partenze programmate per mostrare le date.
DROP POLICY IF EXISTS "Public read scheduled tour_departures" ON noleggio_tour_departures;
CREATE POLICY "Public read scheduled tour_departures"
  ON noleggio_tour_departures FOR SELECT
  USING (status = 'scheduled');

-- ==================================================================
-- 2. SEAT MAP nominale per partenza
-- ==================================================================
CREATE TABLE IF NOT EXISTS noleggio_tour_seats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id    UUID NOT NULL REFERENCES noleggio_tour_departures(id) ON DELETE CASCADE,
  seat_label      TEXT NOT NULL,             -- es. "1", "2", "Co-pilota"
  seat_position   INTEGER NOT NULL DEFAULT 0,
  price_cents     INTEGER,                   -- override; NULL = prezzo partenza/tour
  status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available','held','sold','blocked')),
  hold_expires_at TIMESTAMPTZ,               -- tenuta carrello (held); scade come i link Nexi (1h)
  booking_id      UUID,                      -- -> bookings.id quando venduto
  customer_name   TEXT,
  customer_phone  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (departure_id, seat_label)
);

CREATE INDEX IF NOT EXISTS idx_tour_seats_departure ON noleggio_tour_seats(departure_id);
CREATE INDEX IF NOT EXISTS idx_tour_seats_status    ON noleggio_tour_seats(status);
CREATE INDEX IF NOT EXISTS idx_tour_seats_booking   ON noleggio_tour_seats(booking_id);

ALTER TABLE noleggio_tour_seats ENABLE ROW LEVEL SECURITY;

-- Admin: accesso completo
DROP POLICY IF EXISTS "Admins can manage tour_seats" ON noleggio_tour_seats;
CREATE POLICY "Admins can manage tour_seats"
  ON noleggio_tour_seats FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Sito (anon): legge i posti per mostrare la disponibilita' (la scrittura
-- hold/vendita avviene via Netlify function con service_role, non dal client anon).
DROP POLICY IF EXISTS "Public read tour_seats" ON noleggio_tour_seats;
CREATE POLICY "Public read tour_seats"
  ON noleggio_tour_seats FOR SELECT
  USING (true);

-- ==================================================================
-- 3. updated_at trigger su partenze
-- ==================================================================
CREATE OR REPLACE FUNCTION touch_tour_departures_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_tour_departures ON noleggio_tour_departures;
CREATE TRIGGER trg_touch_tour_departures
  BEFORE UPDATE ON noleggio_tour_departures
  FOR EACH ROW EXECUTE FUNCTION touch_tour_departures_updated_at();

-- ==================================================================
-- 4. Helper: genera i posti "1..N" available per una partenza
-- ==================================================================
CREATE OR REPLACE FUNCTION seed_tour_seats(p_departure_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_total INTEGER;
  i INTEGER;
BEGIN
  SELECT total_seats INTO v_total FROM noleggio_tour_departures WHERE id = p_departure_id;
  IF v_total IS NULL THEN RETURN; END IF;
  FOR i IN 1..v_total LOOP
    INSERT INTO noleggio_tour_seats (departure_id, seat_label, seat_position)
    VALUES (p_departure_id, i::TEXT, i)
    ON CONFLICT (departure_id, seat_label) DO NOTHING;
  END LOOP;
END;
$$;

-- ==================================================================
-- Prossimo step (non in questa migration):
--   • Admin: vista "Tour/Partenze" in NoleggioServiceTab (heli_rental) per
--     creare partenze, generare/rinominare/prezzare i posti, vedere i venduti.
--   • Sito: NoleggioServicePage Aria -> data -> orario -> seat map -> carrello.
--   • Netlify: hold posti + checkout Nexi + conferma/fattura WhatsApp.
-- ==================================================================
