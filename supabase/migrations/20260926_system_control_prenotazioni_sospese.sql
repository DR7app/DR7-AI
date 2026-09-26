-- System Control: interruttore "Prenotazioni dal sito" (prenotazioni_online).
--
-- Il sito scrive le prenotazioni direttamente dal browser (supabase-js e la
-- RPC book_with_credits): nessuna Netlify function le vede passare, quindi
-- l'unico blocco affidabile e' nel database.
--
-- Chi viene fermato: SOLO i clienti del sito (ruolo anon o authenticated che
-- non e' staff). Passano sempre:
--   - lo staff del gestionale (dr7_is_staff), che deve poter prenotare a mano;
--   - il service role (Netlify functions, es. la prenotazione scritta DOPO un
--     pagamento Nexi gia' riuscito: il cliente ha pagato, non si perde);
--   - una prenotazione con pagamento Nexi concluso scritta dal browser
--     (PaymentSuccessPage, ramo legacy): stesso motivo;
--   - SQL diretto senza JWT.
-- In caso di dubbio (tabella sc_flags assente, lettura fallita) si lascia
-- passare: e' la regola di statoFunzione nel codice.
--
-- Il messaggio inizia con 'PRENOTAZIONI_SOSPESE:' cosi' il sito lo riconosce
-- e mostra il testo al cliente invece di un errore generico.

CREATE OR REPLACE FUNCTION public.sc_business_da_service_type(p_service_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_service_type, '') = '' THEN '*'
    WHEN lower(p_service_type) = 'boat_rental' THEN 'mare'
    WHEN lower(p_service_type) = 'heli_rental' THEN 'aria'
    WHEN lower(p_service_type) = 'stay_rental' THEN 'soggiorni'
    WHEN lower(p_service_type) = 'car_wash' OR lower(p_service_type) LIKE 'mechanical%' THEN 'lavaggio'
    ELSE 'terra'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sc_blocca_prenotazioni_sito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ruolo TEXT := coalesce(auth.jwt() ->> 'role', '');
  v_service_type TEXT;
  v_business TEXT;
  v_messaggio TEXT;
  v_ferma BOOLEAN := false;
BEGIN
  -- Solo richieste di clienti: service role e SQL diretto passano sempre.
  IF v_ruolo NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF v_ruolo = 'authenticated' AND public.dr7_is_staff() THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'pending_nexi_bookings' THEN
    v_service_type := NEW.booking_data ->> 'service_type';
  ELSE
    v_service_type := NEW.service_type;
    -- Pagamento Nexi gia' concluso (PaymentSuccessPage, ramo legacy): il
    -- cliente ha pagato, la prenotazione si registra sempre.
    IF NEW.nexi_order_id IS NOT NULL
       AND lower(coalesce(NEW.payment_status, '')) IN ('paid', 'succeeded', 'completed') THEN
      RETURN NEW;
    END IF;
  END IF;
  v_business := public.sc_business_da_service_type(v_service_type);

  BEGIN
    SELECT true, f.messaggio
      INTO v_ferma, v_messaggio
      FROM public.sc_flags f
     WHERE f.chiave IN ('prenotazioni_online', 'gestionale')
       AND f.business IN ('*', v_business)
       AND (f.attiva = false OR f.manutenzione = true)
     ORDER BY (f.messaggio IS NULL), (f.chiave = 'gestionale')
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- nel dubbio si prenota
  END;

  IF coalesce(v_ferma, false) THEN
    RAISE EXCEPTION 'PRENOTAZIONI_SOSPESE: %',
      coalesce(v_messaggio, 'Le prenotazioni online sono momentaneamente sospese. Contattaci per prenotare.')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sc_blocca_prenotazioni_sito() FROM PUBLIC, anon, authenticated;

-- "00" nel nome: i trigger BEFORE girano in ordine alfabetico, questo deve
-- essere il primo (prima dei controlli di sovrapposizione e del wallet).
DROP TRIGGER IF EXISTS trg_00_sc_prenotazioni_sospese ON public.bookings;
CREATE TRIGGER trg_00_sc_prenotazioni_sospese
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sc_blocca_prenotazioni_sito();

DROP TRIGGER IF EXISTS trg_00_sc_prenotazioni_sospese ON public.pending_nexi_bookings;
CREATE TRIGGER trg_00_sc_prenotazioni_sospese
  BEFORE INSERT ON public.pending_nexi_bookings
  FOR EACH ROW EXECUTE FUNCTION public.sc_blocca_prenotazioni_sito();
