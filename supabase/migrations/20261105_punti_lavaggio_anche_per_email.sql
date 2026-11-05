-- ============================================================================
-- PUNTI LAVAGGIO: anche le prenotazioni agganciate al cliente solo per EMAIL
-- (05/11/2026)
--
-- Dopo 20261104 Antonella Melis aveva 95 punti invece di 179: la scheda
-- cliente del gestionale trova le prenotazioni per id E per email, il calcolo
-- dei punti solo per id. I lavaggi senza id cliente (inseriti a mano, vecchi
-- flussi) restavano fuori dalla carta.
--
-- Regola nuova, una sola funzione (dr7_punti_titolare_prenotazione):
--   1. id come prima (dr7_punti_titolare, invariata);
--   2. SOLO se la prenotazione non porta nessun id cliente: email esatta
--      (minuscole, spazi tolti), mai vuota, e solo se porta a UN titolare.
--      Email condivisa da piu' clienti = nessuno (mai indovinare).
--      Mai per nome o telefono.
--
-- Niente arretrati: le soglie da 250 gia' superate con i lavaggi ritrovati
-- finiscono in fidelity_lavaggio_base (come nella 20261104), non diventano
-- premi. Si puo' rilanciare.
-- Nome nuovo, non un overload di dr7_punti_titolare (vedi PGRST203).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dr7_punti_titolare_prenotazione(p_user_id UUID, p_details JSONB, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_titolare UUID;
  v_mail TEXT;
  v_trovati UUID[];
BEGIN
  v_titolare := dr7_punti_titolare(p_user_id, p_details);
  IF v_titolare IS NOT NULL THEN RETURN v_titolare; END IF;

  -- Un id c'e' ma non porta a nessuno: non si indovina con l'email.
  IF p_user_id IS NOT NULL
     OR nullif(p_details #>> '{customer,customerId}', '') IS NOT NULL
     OR nullif(p_details #>> '{customer,id}', '') IS NOT NULL THEN
    RETURN NULL;
  END IF;

  v_mail := lower(trim(coalesce(p_email, '')));
  IF v_mail = '' OR position('@' IN v_mail) = 0 THEN RETURN NULL; END IF;

  v_trovati := ARRAY(
    SELECT DISTINCT coalesce(ce.user_id, ce.id)
      FROM customers_extended ce
     WHERE lower(trim(ce.email)) = v_mail
  );
  IF cardinality(v_trovati) = 1 THEN RETURN v_trovati[1]; END IF;
  IF cardinality(v_trovati) > 1 THEN RETURN NULL; END IF;

  -- Nessuna scheda: account del sito con quell'email.
  v_trovati := ARRAY(SELECT u.id FROM auth.users u WHERE lower(trim(u.email)) = v_mail);
  IF cardinality(v_trovati) = 1 THEN RETURN v_trovati[1]; END IF;
  RETURN NULL;
END;
$$;

-- Email del titolare (schede + account), per il prefiltro dei totali.
CREATE OR REPLACE FUNCTION public.dr7_punti_email_titolare(p_titolare UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT e), '{}'::TEXT[]) FROM (
    SELECT lower(trim(ce.email)) AS e FROM customers_extended ce
     WHERE (ce.id = p_titolare OR ce.user_id = p_titolare) AND coalesce(trim(ce.email), '') <> ''
    UNION
    SELECT lower(trim(u.email)) FROM auth.users u
     WHERE u.id = p_titolare AND coalesce(trim(u.email), '') <> ''
  ) x;
$$;

REVOKE ALL ON FUNCTION public.dr7_punti_titolare_prenotazione(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_titolare_prenotazione(UUID, JSONB, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_email_titolare(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_email_titolare(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_totale(p_titolare UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schede UUID[];
  v_testi TEXT[];
  v_cent NUMERIC;
  v_email TEXT[];
BEGIN
  IF p_titolare IS NULL THEN RETURN 0; END IF;
  v_schede := ARRAY[p_titolare] || coalesce(ARRAY(SELECT id FROM customers_extended WHERE user_id = p_titolare), '{}'::UUID[]);
  v_testi := ARRAY(SELECT unnest(v_schede)::TEXT);
  v_email := dr7_punti_email_titolare(p_titolare);
  -- Il filtro sugli id e' piu' largo del necessario; il titolare esatto lo
  -- decide dr7_punti_titolare, la stessa funzione del trigger.
  SELECT coalesce(sum(b.price_total), 0) INTO v_cent
    FROM bookings b
   WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
     AND (b.user_id = ANY (v_schede)
          OR (b.booking_details #>> '{customer,customerId}') = ANY (v_testi)
          OR (b.booking_details #>> '{customer,id}') = ANY (v_testi)
          OR lower(trim(b.customer_email)) = ANY (v_email))
     AND dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email) = p_titolare;
  RETURN greatest(0, floor(v_cent / 100.0))::INTEGER;  -- centesimi -> EUR
END;
$$;

CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_ricalcola(p_titolare UUID, p_booking_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_soglia CONSTANT INTEGER := 250;
  c_premio CONSTANT NUMERIC := 25;
  c_giorni CONSTANT INTEGER := 15;
  c_alfabeto CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_schede UUID[];
  v_totale INTEGER;
  v_base INTEGER;
  v_dati INTEGER;
  v_numero INTEGER;
  v_linea INTEGER;
  v_emessi INTEGER := 0;
  v_account UUID;
  v_booking UUID;
  v_scheda UUID;
  v_ce RECORD;
  v_fino_giorno DATE;
  v_fino TIMESTAMPTZ;
  v_codice TEXT;
  v_lotto UUID;
  v_buono UUID;
  i INTEGER;
BEGIN
  IF p_titolare IS NULL THEN RETURN 0; END IF;
  -- Un ricalcolo alla volta per persona: due salvataggi insieme non vedono
  -- entrambi "premio mancante". L'indice unico (titolare, numero) e' la rete.
  PERFORM pg_advisory_xact_lock(hashtext('dr7_punti_lavaggio:' || p_titolare::TEXT));

  v_schede := ARRAY[p_titolare] || coalesce(ARRAY(SELECT id FROM customers_extended WHERE user_id = p_titolare), '{}'::UUID[]);
  v_totale := dr7_punti_lavaggio_totale(p_titolare);
  SELECT coalesce(sum(soglie), 0) INTO v_base FROM fidelity_lavaggio_base WHERE titolare = ANY (v_schede);
  SELECT count(*) INTO v_dati FROM fidelity_buoni
   WHERE titolare = ANY (v_schede) OR (titolare IS NULL AND customer_extended_id = ANY (v_schede));

  WHILE floor(v_totale / c_soglia::NUMERIC) - v_base > v_dati LOOP
    v_dati := v_dati + 1;
    v_linea := greatest(0, v_totale - c_soglia * (v_base + v_dati));

    -- Prenotazione e scheda a cui appoggiare il premio (messaggio, allarme).
    v_booking := p_booking_id;
    IF v_booking IS NULL THEN
      SELECT b.id INTO v_booking FROM bookings b
       WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
         AND (b.user_id = ANY (v_schede)
              OR (b.booking_details #>> '{customer,customerId}') = ANY (ARRAY(SELECT unnest(v_schede)::TEXT))
              OR (b.booking_details #>> '{customer,id}') = ANY (ARRAY(SELECT unnest(v_schede)::TEXT))
              OR lower(trim(b.customer_email)) = ANY (dr7_punti_email_titolare(p_titolare)))
         AND dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email) = p_titolare
       ORDER BY b.created_at DESC NULLS LAST LIMIT 1;
    END IF;
    v_scheda := NULL;
    IF v_booking IS NOT NULL THEN
      SELECT dr7_cliente_della_prenotazione(user_id, booking_details) INTO v_scheda FROM bookings WHERE id = v_booking;
    END IF;
    IF v_scheda IS NULL THEN
      SELECT id INTO v_scheda FROM customers_extended WHERE id = ANY (v_schede)
       ORDER BY (id = p_titolare) DESC, updated_at DESC NULLS LAST LIMIT 1;
    END IF;

    SELECT max(numero) INTO v_numero FROM fidelity_buoni WHERE titolare = p_titolare;
    v_numero := coalesce(v_numero, 0) + 1;

    v_fino_giorno := (now() AT TIME ZONE 'Europe/Rome')::DATE + c_giorni;
    v_fino := ((v_fino_giorno + 1)::TIMESTAMP - interval '1 second') AT TIME ZONE 'Europe/Rome';

    INSERT INTO fidelity_buoni (booking_id, customer_extended_id, voucher_code, importo, punti_soglia,
                                punti_rimasti, valido_fino, titolare, numero)
    VALUES (v_booking, v_scheda, NULL, c_premio, c_soglia, v_linea, v_fino, p_titolare, v_numero)
    ON CONFLICT (titolare, numero) WHERE titolare IS NOT NULL DO NOTHING
    RETURNING id INTO v_buono;
    IF v_buono IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_account FROM auth.users WHERE id = p_titolare;
    IF v_account IS NOT NULL THEN
      -- Credito wallet vincolato al lavaggio: meccanismo dei lotti.
      INSERT INTO wallet_crediti_vincolati (user_id, importo, residuo, scadenza, servizi, descrizione, origine)
      VALUES (v_account, c_premio, c_premio, v_fino_giorno, ARRAY['car_wash'],
              format('Fidelity Card lavaggio: %s punti raggiunti', c_soglia), 'fidelity_lavaggio')
      RETURNING id INTO v_lotto;
      UPDATE fidelity_buoni SET lotto_id = v_lotto WHERE id = v_buono;
    ELSE
      -- Nessun account, nessun wallet: buono codice sconto come prima.
      SELECT email, telefono INTO v_ce FROM customers_extended WHERE id = v_scheda;
      LOOP
        v_codice := 'DR7-';
        FOR i IN 1..8 LOOP
          IF i = 5 THEN v_codice := v_codice || '-'; END IF;
          v_codice := v_codice || substr(c_alfabeto, 1 + floor(random() * length(c_alfabeto))::INTEGER, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM discount_codes WHERE code = v_codice);
      END LOOP;
      INSERT INTO discount_codes (code, code_type, value_type, value_amount, scope, minimum_spend, single_use, status,
                                  customer_email, customer_phone, valid_from, valid_until, message, usage_conditions, qr_url)
      VALUES (v_codice, 'codice_sconto', 'fixed', c_premio, ARRAY['lavaggi'], NULL, true, 'active',
              nullif(v_ce.email, ''), nullif(v_ce.telefono, ''), now(), v_fino,
              'Buono Fidelity Card — solo Prime Wash',
              format('Buono di EUR %s guadagnato con la Fidelity Card (%s punti). Utilizzabile solo per servizi di lavaggio. Valido %s giorni.', c_premio, c_soglia, c_giorni),
              'https://dr7.app/promo/' || v_codice);
      UPDATE fidelity_buoni SET voucher_code = v_codice WHERE id = v_buono;
    END IF;
    v_emessi := v_emessi + 1;
  END LOOP;

  v_linea := greatest(0, v_totale - c_soglia * (v_base + v_dati));
  UPDATE customers_extended
     SET fidelity_points = v_linea,
         fidelity_lifetime_points = v_totale
   WHERE id = ANY (v_schede)
     -- Solo le schede che appartengono ANCORA a questo titolare: una scheda
     -- appena collegata a un account ha un nuovo titolare e i suoi punti.
     AND coalesce(user_id, id) = p_titolare
     AND (fidelity_points IS DISTINCT FROM v_linea OR fidelity_lifetime_points IS DISTINCT FROM v_totale);

  RETURN v_emessi;
END;
$$;

CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_accredita(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_titolare UUID;
  v_punti INTEGER;
BEGIN
  SELECT id, user_id, customer_email, service_type, price_total, payment_status, status, booking_details
    INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status) THEN RETURN 0; END IF;
  v_titolare := dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email);
  IF v_titolare IS NULL THEN RETURN 0; END IF;

  -- Registro informativo per prenotazione (lo legge award-fidelity-points).
  v_punti := floor(coalesce(b.price_total, 0) / 100.0)::INTEGER;
  IF v_punti > 0 THEN
    INSERT INTO fidelity_point_awards (booking_id, customer_extended_id, points_awarded)
    VALUES (b.id, dr7_cliente_della_prenotazione(b.user_id, b.booking_details), v_punti)
    ON CONFLICT (booking_id) DO NOTHING;
  END IF;

  RETURN dr7_punti_lavaggio_ricalcola(v_titolare, b.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.dr7_trg_punti_lavaggio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuovo UUID;
  v_vecchio UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF coalesce(OLD.service_type, '') NOT IN ('car_wash', 'carwash')
       AND coalesce(NEW.service_type, '') NOT IN ('car_wash', 'carwash') THEN
      RETURN NEW;
    END IF;
    IF OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status
       AND OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.price_total IS NOT DISTINCT FROM NEW.price_total
       AND OLD.service_type IS NOT DISTINCT FROM NEW.service_type
       AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
       AND lower(trim(OLD.customer_email)) IS NOT DISTINCT FROM lower(trim(NEW.customer_email))
       AND (OLD.booking_details #>> '{customer,customerId}') IS NOT DISTINCT FROM (NEW.booking_details #>> '{customer,customerId}')
       AND (OLD.booking_details #>> '{customer,id}') IS NOT DISTINCT FROM (NEW.booking_details #>> '{customer,id}') THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') AND coalesce(NEW.service_type, '') IN ('car_wash', 'carwash') THEN
      v_nuovo := dr7_punti_titolare_prenotazione(NEW.user_id, NEW.booking_details, NEW.customer_email);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND coalesce(OLD.service_type, '') IN ('car_wash', 'carwash') THEN
      v_vecchio := dr7_punti_titolare_prenotazione(OLD.user_id, OLD.booking_details, OLD.customer_email);
    END IF;
    IF v_nuovo IS NOT NULL THEN
      PERFORM dr7_punti_lavaggio_ricalcola(v_nuovo, NEW.id);
    END IF;
    IF v_vecchio IS NOT NULL AND v_vecchio IS DISTINCT FROM v_nuovo THEN
      PERFORM dr7_punti_lavaggio_ricalcola(v_vecchio, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[punti lavaggio] prenotazione % non ricalcolata: %', coalesce(NEW.id, OLD.id), SQLERRM;
  END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Il nome conta: i trigger AFTER partono in ordine alfabetico. Deve girare
-- DOPO trg_dr7_wallet_sync_prenotazione, altrimenti un lavaggio pagato col
-- wallet che fa scattare i 250 punti si pagherebbe col premio appena dato.
DROP TRIGGER IF EXISTS trg_dr7_punti_lavaggio ON public.bookings;
DROP TRIGGER IF EXISTS trg_dr7_zz_punti_lavaggio ON public.bookings;
CREATE TRIGGER trg_dr7_zz_punti_lavaggio
  AFTER INSERT OR DELETE OR UPDATE OF payment_status, status, price_total, user_id, customer_email, booking_details, service_type
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_trg_punti_lavaggio();

-- Cambio email di una scheda: le prenotazioni agganciate per email cambiano.
DROP TRIGGER IF EXISTS trg_dr7_punti_lavaggio_scheda ON public.customers_extended;
CREATE TRIGGER trg_dr7_punti_lavaggio_scheda
  AFTER UPDATE OF user_id, email ON public.customers_extended
  FOR EACH ROW
  WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id
        OR lower(trim(OLD.email)) IS DISTINCT FROM lower(trim(NEW.email)))
  EXECUTE FUNCTION public.dr7_trg_punti_lavaggio_scheda();

-- ── Storico: soglie gia' superate coi lavaggi ritrovati = niente arretrati ──
WITH tot AS (
  SELECT t.titolare, greatest(0, floor(sum(t.price_total) / 100.0))::INTEGER AS punti
    FROM (
      SELECT dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email) AS titolare, b.price_total
        FROM public.bookings b
       WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
    ) t
   WHERE t.titolare IS NOT NULL
   GROUP BY t.titolare
), dati AS (
  SELECT tot.titolare, tot.punti,
         (SELECT count(*) FROM public.fidelity_buoni f
           WHERE f.titolare = tot.titolare
              OR f.titolare IN (SELECT ce.id FROM public.customers_extended ce WHERE ce.user_id = tot.titolare))::INTEGER AS premi
    FROM tot
)
INSERT INTO public.fidelity_lavaggio_base (titolare, soglie, punti_al_via)
SELECT titolare, greatest(0, floor(punti / 250.0)::INTEGER - premi), punti
  FROM dati
ON CONFLICT (titolare) DO UPDATE
   SET soglie = greatest(public.fidelity_lavaggio_base.soglie, EXCLUDED.soglie);

-- Ricalcolo delle carte toccate dai lavaggi ritrovati per email.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email) AS titolare
      FROM public.bookings b
     WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
       AND b.user_id IS NULL
       AND nullif(b.booking_details #>> '{customer,customerId}', '') IS NULL
       AND nullif(b.booking_details #>> '{customer,id}', '') IS NULL
  LOOP
    IF r.titolare IS NOT NULL THEN
      PERFORM public.dr7_punti_lavaggio_ricalcola(r.titolare, NULL);
    END IF;
  END LOOP;
END $$;

-- Verifica: atteso 179 per Antonella Melis.
--   SELECT nome, cognome, fidelity_points, fidelity_lifetime_points
--     FROM customers_extended WHERE nome ILIKE 'antonella' AND cognome ILIKE 'melis';
