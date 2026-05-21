-- =====================================================================
-- bookings.updated_at: trigger automatico su ogni UPDATE
-- =====================================================================
-- Bug pattern: la tabella bookings non aveva un trigger auto-update su
-- updated_at. Molti percorsi (admin edit, pay-by-link refresh, sync
-- carwash, ecc.) facevano UPDATE senza settare updated_at, lasciandolo
-- pari a booked_at. Risultato: dal DB non sapevamo se/quando una
-- prenotazione era stata modificata (caso reale: Massimo Runchina
-- Porsche 911 modificata di notte tra orari + assicurazione, ma il
-- DB sembrava "mai modificata").
--
-- Adesso un BEFORE UPDATE trigger setta updated_at = NOW() su ogni UPDATE,
-- a meno che il codice non lo abbia già impostato esplicitamente.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bookings_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Se il codice ha già settato updated_at esplicitamente in questa
  -- riga (NEW.updated_at != OLD.updated_at), lasciamolo. Altrimenti
  -- lo bumpiamo a NOW().
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_set_updated_at ON public.bookings;

CREATE TRIGGER trg_bookings_set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_set_updated_at();
