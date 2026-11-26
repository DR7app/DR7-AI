-- 26/11/2026 (video di Valerio, Lorenzo Becconi, Macan GTS): una prenotazione
-- dal sito e' arrivata pagata col wallet con la cauzione VUOTA (ne' cauzione
-- ne' "Nessuna cauzione"): il wizard l'aveva azzerata cambiando fascia e il
-- pagamento non la ricontrollava. Il sito ora blocca; qui il controllo che non
-- dipende dal browser, PRIMA che un euro si muova:
--  - wallet: book_with_credits inserisce in bookings nella stessa transazione,
--    quindi l'errore annulla anche l'addebito;
--  - carta: la riga pending_nexi_bookings si scrive prima di aprire Nexi.
-- Solo payload con la chiave depositOption (wizard noleggio): lavaggi,
-- meccanica e prenotazioni del gestionale non la hanno e non cambiano.

BEGIN;

CREATE OR REPLACE FUNCTION public.dr7_cauzione_vuota(p_details JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_details IS NOT NULL
     AND jsonb_typeof(p_details) = 'object'
     AND p_details ? 'depositOption'
     AND btrim(coalesce(p_details->>'depositOption', '')) = '';
$$;

CREATE OR REPLACE FUNCTION public.dr7_blocca_prenotazione_senza_cauzione()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    IF NEW.booking_source = 'website' AND NEW.payment_method = 'credit'
       AND public.dr7_cauzione_vuota(NEW.booking_details) THEN
      RAISE EXCEPTION 'Scegli la cauzione prima di pagare.' USING ERRCODE = 'P0001', HINT = 'cauzione_mancante';
    END IF;
  ELSE
    IF public.dr7_cauzione_vuota(NEW.booking_data->'booking_details') THEN
      RAISE EXCEPTION 'Scegli la cauzione prima di pagare.' USING ERRCODE = 'P0001', HINT = 'cauzione_mancante';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cauzione_obbligatoria_sito ON public.bookings;
CREATE TRIGGER trg_cauzione_obbligatoria_sito
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_blocca_prenotazione_senza_cauzione();

DROP TRIGGER IF EXISTS trg_cauzione_obbligatoria_sito ON public.pending_nexi_bookings;
CREATE TRIGGER trg_cauzione_obbligatoria_sito
  BEFORE INSERT ON public.pending_nexi_bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_blocca_prenotazione_senza_cauzione();

COMMIT;
