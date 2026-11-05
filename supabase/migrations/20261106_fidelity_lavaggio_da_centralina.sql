-- ============================================================================
-- FIDELITY CARD LAVAGGIO: REGOLE DA CENTRALINA PRO (06/11/2026)
--
-- Da eseguire a mano nel SQL editor di Supabase, DOPO
-- 20261104_punti_lavaggio_credito_wallet.sql e
-- 20261105_punti_lavaggio_anche_per_email.sql. Rilanciabile.
-- ATTENZIONE: se un giorno si rilancia la 20261104 o la 20261105, rilanciare
-- SUBITO DOPO anche questa (quelle due riscrivono dr7_punti_lavaggio_ricalcola
-- con le vecchie costanti 250 / 25 / 15).
--
-- COSA CAMBIA
-- Fino a oggi soglia (250), premio (25 EUR), validita' (15 giorni) e
-- "1 EUR = 1 punto" erano costanti dentro dr7_punti_lavaggio_ricalcola.
-- Ora si decidono in Centralina Pro > Fidelity Lavaggio e stanno in
--   centralina_pro_config (id = 'main').config.fidelity_lavaggio
--   { attivo, euro_per_punto, soglia_punti, importo_premio, validita_giorni,
--     tipo_premio: 'credito_wallet' | 'codice_sconto' }
-- Valori mancanti o non validi (0, negativi, testo) = valori di prima:
-- attivo, 1 EUR per punto, 250 punti, 25 EUR, 15 giorni, credito wallet.
-- Con i valori di prima il comportamento e' IDENTICO a quello della 20261105.
--
-- CHI LEGGE COSA
--   * Il database NON legge direttamente la riga della Centralina: legge la
--     "regola in vigore" in `fidelity_lavaggio_config` (una riga). Ce la porta
--     il trigger trg_dr7_fidelity_lavaggio_config a ogni salvataggio della
--     riga 'main', e questa migrazione la prima volta. Cosi' la regola cambia
--     in UN punto solo, insieme al riallineamento dei clienti (sotto).
--   * Sito e gestionale leggono i valori da centralina_pro_config (lettura
--     pubblica gia' esistente; la scrittura resta solo staff, RLS invariata).
--     Le due nuove tabelle sono leggibili solo dallo staff.
--
-- PUNTI
--   punti = floor(EUR di lavaggi pagati / euro_per_punto)
--   premi dovuti = floor(punti / soglia_punti); il surplus resta sulla carta.
--   Programma disattivato: nessun premio nuovo, le carte restano ferme (sito e
--   gestionale le nascondono), i lavaggi pagati mentre e' spento NON danno
--   punti. I premi gia' emessi non si toccano mai.
--
-- CAMBIO DELLE REGOLE CON CLIENTI A META' CARTA (regola approvata dalla
-- direzione: "ognuno tiene i punti che vede, le regole nuove valgono da qui
-- in avanti"; nessun premio arretrato in blocco)
-- Quando cambia una delle tre regole che muovono i punti (attivo,
-- euro_per_punto, soglia_punti), per OGNI cliente si scrive un'"ancora" in
-- `fidelity_lavaggio_ancora` (nuova `versione`):
--   punti   = punti visibili sulla carta in quel momento, con le regole VECCHIE
--   totale  = totale punti guadagnati in quel momento
--   cent    = centesimi di lavaggi pagati gia' trasformati in punti (gli
--             spiccioli che non facevano ancora un punto restano da convertire
--             con il nuovo valore del punto: nessun euro perso)
--   premi   = premi gia' dati in quel momento
-- Da li' in poi:
--   punti nuovi   = tronca((EUR pagati adesso - EUR dell'ancora) / euro_per_punto)
--   punti carta   = min(punti ancora, soglia - 1) + punti nuovi
--                   - soglia x (premi dati dopo l'ancora)
--   totale        = totale ancora + punti nuovi
-- Esempi:
--   * 179 punti, soglia da 250 a 400: la carta dice 179/400, premio a 400.
--   * 179 punti, soglia da 250 a 100: NESSUN premio al cambio; la carta dice
--     99/100 (il massimo sotto la nuova soglia) e il premio arriva al primo
--     lavaggio pagato dopo il cambio. Nessuno prende un premio solo perche' la
--     soglia e' scesa, e nessuno ne prende due di colpo.
--   * 179 punti, da 1 a 2 EUR per punto: restano 179; 42 EUR dopo = 200.
--   * programma spento a 179 e riacceso: resta 179, nessun arretrato per
--     quello che si e' pagato mentre era spento.
--   * Un lavaggio pagato PRIMA del cambio e annullato DOPO toglie i suoi punti
--     al valore nuovo (puo' anche scendere a 0, come oggi).
-- Cambiare solo importo, validita' o tipo di premio NON tocca i punti: vale
-- per i premi emessi da quel momento.
-- Le ancore di una versione si scrivono una volta sola (PK versione+titolare):
-- rilanciare la migrazione o risalvare la stessa config non cambia niente.
-- Il riallineamento e il ricalcolo dei punti non si sovrappongono: lock
-- consultivo condiviso nel ricalcolo, esclusivo nel cambio di regole.
--
-- ETICHETTE
-- Allarme lav_punti_250 e template pro_fidelity_voucher: l'etichetta si
-- riscrive con i numeri in vigore SOLO se e' ancora quella generata
-- ("Cliente a N punti lavaggio", "Lavaggio: N punti raggiunti (buono X EUR)").
-- Un'etichetta riscritta a mano dallo staff non si tocca. Il testo del
-- WhatsApp usa gia' i token {punti} {importo} {giorni} dal premio emesso.
-- ============================================================================

-- ── 0. Tabelle ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fidelity_lavaggio_config (
  id TEXT PRIMARY KEY DEFAULT 'attiva' CHECK (id = 'attiva'),
  config JSONB NOT NULL,
  versione INTEGER NOT NULL DEFAULT 0,
  aggiornata_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fidelity_lavaggio_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fidelity_lavaggio_config_staff_lettura ON public.fidelity_lavaggio_config;
CREATE POLICY fidelity_lavaggio_config_staff_lettura ON public.fidelity_lavaggio_config
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.fidelity_lavaggio_ancora (
  versione INTEGER NOT NULL,
  titolare UUID NOT NULL,
  punti INTEGER NOT NULL,
  totale INTEGER NOT NULL,
  cent NUMERIC NOT NULL,
  premi INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (versione, titolare)
);
ALTER TABLE public.fidelity_lavaggio_ancora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fidelity_lavaggio_ancora_staff_lettura ON public.fidelity_lavaggio_ancora;
CREATE POLICY fidelity_lavaggio_ancora_staff_lettura ON public.fidelity_lavaggio_ancora
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- ── 1. Lettura e pulizia della config ───────────────────────────────────────
-- Numero da JSON: numero vero o testo "1,5" / "1.5". Altro = NULL.
CREATE OR REPLACE FUNCTION public.dr7_fidelity_lavaggio_numero(p JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_testo TEXT;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) = 'number' THEN RETURN (p #>> '{}')::NUMERIC; END IF;
  IF jsonb_typeof(p) = 'string' THEN
    v_testo := replace(trim(p #>> '{}'), ',', '.');
    IF v_testo ~ '^[0-9]+(\.[0-9]+)?$' THEN RETURN v_testo::NUMERIC; END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Config completa e valida: ogni valore mancante o non valido torna al default.
CREATE OR REPLACE FUNCTION public.dr7_fidelity_lavaggio_norm(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v JSONB := CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::JSONB END;
  v_attivo BOOLEAN := true;
  v_epp NUMERIC;
  v_soglia NUMERIC;
  v_importo NUMERIC;
  v_giorni NUMERIC;
  v_tipo TEXT;
BEGIN
  IF jsonb_typeof(v -> 'attivo') = 'boolean' THEN v_attivo := (v ->> 'attivo')::BOOLEAN; END IF;

  v_epp := dr7_fidelity_lavaggio_numero(v -> 'euro_per_punto');
  IF v_epp IS NULL OR v_epp <= 0 OR v_epp > 100000 THEN v_epp := 1; END IF;
  IF v_epp <> round(v_epp, 2) THEN v_epp := round(v_epp, 2); END IF;
  IF v_epp <= 0 THEN v_epp := 1; END IF;

  v_soglia := floor(dr7_fidelity_lavaggio_numero(v -> 'soglia_punti'));
  IF v_soglia IS NULL OR v_soglia < 1 OR v_soglia > 1000000 THEN v_soglia := 250; END IF;

  v_importo := dr7_fidelity_lavaggio_numero(v -> 'importo_premio');
  IF v_importo IS NULL OR v_importo <= 0 OR v_importo > 100000 THEN v_importo := 25; END IF;
  IF v_importo <> round(v_importo, 2) THEN v_importo := round(v_importo, 2); END IF;
  IF v_importo <= 0 THEN v_importo := 25; END IF;

  v_giorni := floor(dr7_fidelity_lavaggio_numero(v -> 'validita_giorni'));
  IF v_giorni IS NULL OR v_giorni < 1 OR v_giorni > 3650 THEN v_giorni := 15; END IF;

  v_tipo := v ->> 'tipo_premio';
  IF v_tipo IS NULL OR v_tipo NOT IN ('credito_wallet', 'codice_sconto') THEN v_tipo := 'credito_wallet'; END IF;

  RETURN jsonb_build_object(
    'attivo', v_attivo,
    'euro_per_punto', v_epp,
    'soglia_punti', v_soglia::INTEGER,
    'importo_premio', v_importo,
    'validita_giorni', v_giorni::INTEGER,
    'tipo_premio', v_tipo
  );
END;
$$;

-- Regola in vigore (default se la riga non c'e' ancora).
CREATE OR REPLACE FUNCTION public.dr7_fidelity_lavaggio_attiva()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dr7_fidelity_lavaggio_norm((SELECT config FROM fidelity_lavaggio_config WHERE id = 'attiva'));
$$;

-- "25" per 25, "12.50" per 12,5: stesso testo di prima con i default.
CREATE OR REPLACE FUNCTION public.dr7_fidelity_importo_testo(p NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p = trunc(p) THEN trunc(p)::TEXT ELSE to_char(p, 'FM999999990.00') END;
$$;

-- Titolare di oggi di un id registrato in passato (scheda poi collegata a un
-- account = l'account).
CREATE OR REPLACE FUNCTION public.dr7_punti_titolare_corrente(p_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT coalesce(ce.user_id, ce.id) FROM customers_extended ce WHERE ce.id = p_id), p_id);
$$;

-- ── 2. Centesimi di lavaggi pagati di un titolare ───────────────────────────
-- Stesso filtro di dr7_punti_lavaggio_totale (20261105), in centesimi.
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_cent(p_titolare UUID)
RETURNS NUMERIC
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
  SELECT coalesce(sum(b.price_total), 0) INTO v_cent
    FROM bookings b
   WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
     AND (b.user_id = ANY (v_schede)
          OR (b.booking_details #>> '{customer,customerId}') = ANY (v_testi)
          OR (b.booking_details #>> '{customer,id}') = ANY (v_testi)
          OR lower(trim(b.customer_email)) = ANY (v_email))
     AND dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email) = p_titolare;
  RETURN greatest(0, v_cent);
END;
$$;

-- Resta per compatibilita': EUR interi pagati (non piu' "punti").
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_totale(p_titolare UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT floor(dr7_punti_lavaggio_cent(p_titolare) / 100.0)::INTEGER;
$$;

-- ── 3. La formula, una sola, usata da ricalcolo e cambio di regole ──────────
--   p_cent       centesimi di lavaggi pagati del titolare, adesso
--   p_anc_*      ancora della versione in vigore (n = 0: nessuna ancora)
--   p_base       soglie pregresse (fidelity_lavaggio_base), solo senza ancora
--   p_dati       premi gia' dati in tutto
-- Esce:
--   grezzi       punti della carta prima di togliere i premi dati dopo l'ancora
--   dal_cambio   premi dati dopo l'ancora (senza ancora: tutti)
--   linea        punti visibili sulla carta
--   totale       totale punti guadagnati
--   resto        centesimi non ancora diventati un punto
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_formula(
  p_cfg JSONB, p_cent NUMERIC,
  p_anc_n INTEGER, p_anc_punti INTEGER, p_anc_totale INTEGER, p_anc_cent NUMERIC, p_anc_premi INTEGER,
  p_base INTEGER, p_dati INTEGER,
  OUT grezzi INTEGER, OUT dal_cambio INTEGER, OUT linea INTEGER, OUT totale INTEGER, OUT resto NUMERIC)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cfg JSONB := dr7_fidelity_lavaggio_norm(p_cfg);
  v_soglia INTEGER := (v_cfg ->> 'soglia_punti')::INTEGER;
  v_passo NUMERIC := (v_cfg ->> 'euro_per_punto')::NUMERIC * 100;  -- centesimi per un punto
  v_attivo BOOLEAN := (v_cfg ->> 'attivo')::BOOLEAN;
  v_delta NUMERIC;
  v_nuovi INTEGER;
BEGIN
  p_cent := coalesce(p_cent, 0);
  IF coalesce(p_anc_n, 0) > 0 THEN
    IF v_attivo THEN
      v_delta := p_cent - coalesce(p_anc_cent, 0);
      v_nuovi := trunc(v_delta / v_passo)::INTEGER;
      resto := v_delta - v_nuovi * v_passo;
    ELSE
      -- Spento: carta ferma, quello che si paga ora non diventa punti.
      v_nuovi := 0;
      resto := 0;
    END IF;
    grezzi := least(coalesce(p_anc_punti, 0), v_soglia - 1) + v_nuovi;
    dal_cambio := coalesce(p_dati, 0) - coalesce(p_anc_premi, 0);
    totale := greatest(0, coalesce(p_anc_totale, 0) + v_nuovi);
  ELSIF v_attivo THEN
    -- Nessun cambio di regole per questo titolare: il calcolo di sempre.
    totale := floor(p_cent / v_passo)::INTEGER;
    resto := p_cent - totale * v_passo;
    grezzi := totale - v_soglia * coalesce(p_base, 0);
    dal_cambio := coalesce(p_dati, 0);
  ELSE
    totale := 0;
    resto := 0;
    grezzi := 0;
    dal_cambio := 0;
  END IF;
  linea := greatest(0, grezzi - v_soglia * dal_cambio);
END;
$$;

-- ── 4. Ricalcolo di un titolare ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_ricalcola(p_titolare UUID, p_booking_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_alfabeto CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_cfg JSONB;
  v_ver INTEGER;
  v_soglia INTEGER;
  v_premio NUMERIC;
  v_giorni INTEGER;
  v_tipo TEXT;
  v_schede UUID[];
  v_cent NUMERIC;
  v_base INTEGER;
  v_dati INTEGER;
  v_an INTEGER;
  v_ap INTEGER;
  v_at INTEGER;
  v_ac NUMERIC;
  v_ar INTEGER;
  f RECORD;
  v_dal INTEGER;
  v_numero INTEGER;
  v_linea INTEGER;
  v_emessi INTEGER := 0;
  v_account UUID;
  v_booking UUID;
  v_scheda UUID;
  v_email TEXT;
  v_telefono TEXT;
  v_fino_giorno DATE;
  v_fino TIMESTAMPTZ;
  v_codice TEXT;
  v_lotto UUID;
  v_buono UUID;
  i INTEGER;
BEGIN
  IF p_titolare IS NULL THEN RETURN 0; END IF;
  -- Il cambio di regole (esclusivo) e i ricalcoli (condiviso) non si
  -- sovrappongono: un ricalcolo vede o tutte le regole vecchie o tutte nuove.
  PERFORM pg_advisory_xact_lock_shared(hashtext('dr7_fidelity_lavaggio_regole'));
  -- Un ricalcolo alla volta per persona. L'indice unico (titolare, numero) e' la rete.
  PERFORM pg_advisory_xact_lock(hashtext('dr7_punti_lavaggio:' || p_titolare::TEXT));

  SELECT dr7_fidelity_lavaggio_norm(c.config), c.versione INTO v_cfg, v_ver
    FROM fidelity_lavaggio_config c WHERE c.id = 'attiva';
  IF v_cfg IS NULL THEN v_cfg := dr7_fidelity_lavaggio_norm('{}'::JSONB); v_ver := 0; END IF;
  -- Programma spento: nessun premio, carte ferme.
  IF NOT (v_cfg ->> 'attivo')::BOOLEAN THEN RETURN 0; END IF;
  v_soglia := (v_cfg ->> 'soglia_punti')::INTEGER;
  v_premio := (v_cfg ->> 'importo_premio')::NUMERIC;
  v_giorni := (v_cfg ->> 'validita_giorni')::INTEGER;
  v_tipo := v_cfg ->> 'tipo_premio';

  v_schede := ARRAY[p_titolare] || coalesce(ARRAY(SELECT id FROM customers_extended WHERE user_id = p_titolare), '{}'::UUID[]);
  v_cent := dr7_punti_lavaggio_cent(p_titolare);
  SELECT coalesce(sum(soglie), 0) INTO v_base FROM fidelity_lavaggio_base WHERE titolare = ANY (v_schede);
  SELECT count(*) INTO v_dati FROM fidelity_buoni
   WHERE titolare = ANY (v_schede) OR (titolare IS NULL AND customer_extended_id = ANY (v_schede));
  SELECT count(*), coalesce(sum(punti), 0), coalesce(sum(totale), 0), coalesce(sum(cent), 0), coalesce(sum(premi), 0)
    INTO v_an, v_ap, v_at, v_ac, v_ar
    FROM fidelity_lavaggio_ancora WHERE versione = v_ver AND titolare = ANY (v_schede);

  SELECT * INTO f FROM dr7_punti_lavaggio_formula(v_cfg, v_cent, v_an, v_ap, v_at, v_ac, v_ar, v_base, v_dati);
  v_dal := f.dal_cambio;

  WHILE floor(f.grezzi / v_soglia::NUMERIC) > v_dal LOOP
    v_dal := v_dal + 1;
    v_linea := greatest(0, f.grezzi - v_soglia * v_dal);

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

    v_fino_giorno := (now() AT TIME ZONE 'Europe/Rome')::DATE + v_giorni;
    v_fino := ((v_fino_giorno + 1)::TIMESTAMP - interval '1 second') AT TIME ZONE 'Europe/Rome';

    INSERT INTO fidelity_buoni (booking_id, customer_extended_id, voucher_code, importo, punti_soglia,
                                punti_rimasti, valido_fino, titolare, numero)
    VALUES (v_booking, v_scheda, NULL, v_premio, v_soglia, v_linea, v_fino, p_titolare, v_numero)
    ON CONFLICT (titolare, numero) WHERE titolare IS NOT NULL DO NOTHING
    RETURNING id INTO v_buono;
    IF v_buono IS NULL THEN CONTINUE; END IF;

    v_account := NULL;
    SELECT id INTO v_account FROM auth.users WHERE id = p_titolare;
    IF v_account IS NOT NULL AND v_tipo = 'credito_wallet' THEN
      -- Credito wallet vincolato al lavaggio: meccanismo dei lotti.
      INSERT INTO wallet_crediti_vincolati (user_id, importo, residuo, scadenza, servizi, descrizione, origine)
      VALUES (v_account, v_premio, v_premio, v_fino_giorno, ARRAY['car_wash'],
              format('Fidelity Card lavaggio: %s punti raggiunti', v_soglia), 'fidelity_lavaggio')
      RETURNING id INTO v_lotto;
      UPDATE fidelity_buoni SET lotto_id = v_lotto WHERE id = v_buono;
    ELSE
      -- Senza account (nessun wallet) o premio "codice sconto" per tutti.
      SELECT nullif(email, ''), nullif(telefono, '') INTO v_email, v_telefono FROM customers_extended WHERE id = v_scheda;
      IF v_email IS NULL AND v_account IS NOT NULL THEN
        SELECT nullif(email, '') INTO v_email FROM auth.users WHERE id = v_account;
      END IF;
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
      VALUES (v_codice, 'codice_sconto', 'fixed', v_premio, ARRAY['lavaggi'], NULL, true, 'active',
              v_email, v_telefono, now(), v_fino,
              'Buono Fidelity Card — solo Prime Wash',
              format('Buono di EUR %s guadagnato con la Fidelity Card (%s punti). Utilizzabile solo per servizi di lavaggio. Valido %s giorni.',
                     dr7_fidelity_importo_testo(v_premio), v_soglia, v_giorni),
              'https://dr7.app/promo/' || v_codice);
      UPDATE fidelity_buoni SET voucher_code = v_codice WHERE id = v_buono;
    END IF;
    v_emessi := v_emessi + 1;
  END LOOP;

  v_linea := greatest(0, f.grezzi - v_soglia * v_dal);
  UPDATE customers_extended
     SET fidelity_points = v_linea,
         fidelity_lifetime_points = f.totale
   WHERE id = ANY (v_schede)
     -- Solo le schede che appartengono ANCORA a questo titolare.
     AND coalesce(user_id, id) = p_titolare
     AND (fidelity_points IS DISTINCT FROM v_linea OR fidelity_lifetime_points IS DISTINCT FROM f.totale);

  RETURN v_emessi;
END;
$$;

-- ── 5. Accredito di UNA prenotazione (sito, Nexi): stessa firma ─────────────
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_accredita(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_cfg JSONB;
  v_titolare UUID;
  v_punti INTEGER;
BEGIN
  SELECT id, user_id, customer_email, service_type, price_total, payment_status, status, booking_details
    INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status) THEN RETURN 0; END IF;
  v_cfg := dr7_fidelity_lavaggio_attiva();
  IF NOT (v_cfg ->> 'attivo')::BOOLEAN THEN RETURN 0; END IF;
  v_titolare := dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email);
  IF v_titolare IS NULL THEN RETURN 0; END IF;

  -- Registro informativo per prenotazione (lo legge award-fidelity-points).
  v_punti := floor(coalesce(b.price_total, 0) / ((v_cfg ->> 'euro_per_punto')::NUMERIC * 100))::INTEGER;
  IF v_punti > 0 THEN
    INSERT INTO fidelity_point_awards (booking_id, customer_extended_id, points_awarded)
    VALUES (b.id, dr7_cliente_della_prenotazione(b.user_id, b.booking_details), v_punti)
    ON CONFLICT (booking_id) DO NOTHING;
  END IF;

  RETURN dr7_punti_lavaggio_ricalcola(v_titolare, b.id);
END;
$$;

-- ── 6. Cambio di regole: ancore + regola in vigore ──────────────────────────
-- Ritorna quanti titolari sono stati ancorati (0 = nessun cambio sui punti).
CREATE OR REPLACE FUNCTION public.dr7_fidelity_lavaggio_applica(p_cfg JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuova JSONB := dr7_fidelity_lavaggio_norm(p_cfg);
  v_vecchia JSONB;
  v_ver INTEGER;
  v_ver_nuova INTEGER;
  v_ancorati INTEGER := 0;
  v_soglia INTEGER;
  v_importo TEXT;
BEGIN
  -- Esclusivo: nessun ricalcolo a meta' mentre cambiano le regole.
  PERFORM pg_advisory_xact_lock(hashtext('dr7_fidelity_lavaggio_regole'));

  SELECT dr7_fidelity_lavaggio_norm(config), versione INTO v_vecchia, v_ver
    FROM fidelity_lavaggio_config WHERE id = 'attiva' FOR UPDATE;
  IF v_vecchia IS NULL THEN v_vecchia := dr7_fidelity_lavaggio_norm('{}'::JSONB); v_ver := 0; END IF;
  IF v_vecchia = v_nuova THEN RETURN 0; END IF;

  v_ver_nuova := v_ver;
  IF (v_vecchia -> 'attivo', (v_vecchia ->> 'euro_per_punto')::NUMERIC, v_vecchia -> 'soglia_punti')
     IS DISTINCT FROM (v_nuova -> 'attivo', (v_nuova ->> 'euro_per_punto')::NUMERIC, v_nuova -> 'soglia_punti') THEN
    v_ver_nuova := v_ver + 1;

    -- Fotografia di ogni carta con le regole VECCHIE. Ogni insieme e'
    -- riportato al titolare di oggi (una scheda collegata a un account
    -- somma sull'account), come fa il ricalcolo con ANY(schede).
    INSERT INTO fidelity_lavaggio_ancora (versione, titolare, punti, totale, cent, premi)
    WITH prenot AS (
      SELECT dr7_punti_titolare_prenotazione(b.user_id, b.booking_details, b.customer_email) AS t, b.price_total AS c
        FROM bookings b
       WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
    ), cent AS (
      SELECT t, greatest(0, sum(c)) AS c FROM prenot WHERE t IS NOT NULL GROUP BY t
    ), anc AS (
      SELECT dr7_punti_titolare_corrente(a.titolare) AS t, count(*)::INTEGER AS n,
             sum(a.punti)::INTEGER AS p, sum(a.totale)::INTEGER AS l, sum(a.cent) AS c, sum(a.premi)::INTEGER AS r
        FROM fidelity_lavaggio_ancora a WHERE a.versione = v_ver GROUP BY 1
    ), base AS (
      SELECT dr7_punti_titolare_corrente(x.titolare) AS t, sum(x.soglie)::INTEGER AS s
        FROM fidelity_lavaggio_base x GROUP BY 1
    ), dati AS (
      SELECT dr7_punti_titolare_corrente(coalesce(fb.titolare, fb.customer_extended_id)) AS t, count(*)::INTEGER AS d
        FROM fidelity_buoni fb WHERE coalesce(fb.titolare, fb.customer_extended_id) IS NOT NULL GROUP BY 1
    ), carte AS (
      SELECT DISTINCT coalesce(ce.user_id, ce.id) AS t FROM customers_extended ce
       WHERE coalesce(ce.fidelity_points, 0) <> 0 OR coalesce(ce.fidelity_lifetime_points, 0) <> 0
    ), tutti AS (
      SELECT t FROM cent UNION SELECT t FROM anc UNION SELECT t FROM base UNION SELECT t FROM dati UNION SELECT t FROM carte
    )
    SELECT v_ver_nuova, x.t, f.linea, f.totale, coalesce(cent.c, 0) - f.resto, coalesce(dati.d, 0)
      FROM tutti x
      LEFT JOIN cent ON cent.t = x.t
      LEFT JOIN anc ON anc.t = x.t
      LEFT JOIN base ON base.t = x.t
      LEFT JOIN dati ON dati.t = x.t
      CROSS JOIN LATERAL dr7_punti_lavaggio_formula(v_vecchia, coalesce(cent.c, 0),
                   coalesce(anc.n, 0), anc.p, anc.l, anc.c, anc.r, coalesce(base.s, 0), coalesce(dati.d, 0)) f
     WHERE x.t IS NOT NULL
    ON CONFLICT (versione, titolare) DO NOTHING;
    GET DIAGNOSTICS v_ancorati = ROW_COUNT;

    -- Le carte con le regole NUOVE subito dopo il cambio (nessun punto nuovo:
    -- punti tenuti, al massimo soglia - 1). Nessun premio puo' scattare qui.
    UPDATE customers_extended ce
       SET fidelity_points = s.linea,
           fidelity_lifetime_points = s.totale
      FROM (
        SELECT a.titolare, f.linea, f.totale
          FROM fidelity_lavaggio_ancora a
          CROSS JOIN LATERAL dr7_punti_lavaggio_formula(v_nuova, a.cent, 1, a.punti, a.totale, a.cent, a.premi, 0, a.premi) f
         WHERE a.versione = v_ver_nuova
      ) s
     WHERE coalesce(ce.user_id, ce.id) = s.titolare
       AND (ce.fidelity_points IS DISTINCT FROM s.linea OR ce.fidelity_lifetime_points IS DISTINCT FROM s.totale);
  END IF;

  INSERT INTO fidelity_lavaggio_config (id, config, versione, aggiornata_at)
  VALUES ('attiva', v_nuova, v_ver_nuova, now())
  ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, versione = EXCLUDED.versione, aggiornata_at = now();

  -- Etichette generate con i numeri in vigore (mai quelle riscritte a mano).
  v_soglia := (v_nuova ->> 'soglia_punti')::INTEGER;
  v_importo := dr7_fidelity_importo_testo((v_nuova ->> 'importo_premio')::NUMERIC);
  UPDATE system_alarms
     SET label = format('Cliente a %s punti lavaggio', v_soglia),
         reason = format('Il cliente ha raggiunto %s punti Fidelity lavaggio: premio di %s EUR emesso e inviato su WhatsApp.', v_soglia, v_importo)
   WHERE id = 'lav_punti_250'
     AND label ~ '^Cliente a [0-9]+ punti lavaggio$';
  UPDATE system_messages
     SET label = format('Lavaggio: %s punti raggiunti (buono %s EUR)', v_soglia, v_importo)
   WHERE message_key = 'pro_fidelity_voucher'
     AND label ~ '^Lavaggio: [0-9]+ punti raggiunti \(buono [0-9.,]+ EUR\)$';

  RETURN v_ancorati;
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_fidelity_lavaggio_applica(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_fidelity_lavaggio_applica(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_fidelity_lavaggio_attiva() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_fidelity_lavaggio_attiva() TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_cent(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_cent(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_totale(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_totale(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_titolare_corrente(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_titolare_corrente(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_ricalcola(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_ricalcola(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_accredita(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_accredita(UUID) TO service_role;

-- ── 7. Trigger sulla riga 'main' della Centralina ───────────────────────────
-- Un errore qui non blocca il salvataggio della Centralina (che porta anche
-- il CMS del sito): la regola in vigore resta la precedente, intera, e la
-- sezione Fidelity Lavaggio lo segnala ("regole non ancora attive").
CREATE OR REPLACE FUNCTION public.dr7_trg_fidelity_lavaggio_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM dr7_fidelity_lavaggio_applica(coalesce(NEW.config -> 'fidelity_lavaggio', '{}'::JSONB));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fidelity lavaggio] regole non applicate: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dr7_fidelity_lavaggio_config ON public.centralina_pro_config;
CREATE TRIGGER trg_dr7_fidelity_lavaggio_config
  AFTER INSERT OR UPDATE OF config ON public.centralina_pro_config
  FOR EACH ROW
  WHEN (NEW.id = 'main')
  EXECUTE FUNCTION public.dr7_trg_fidelity_lavaggio_config();

-- ── 8. Allineamento iniziale ────────────────────────────────────────────────
-- Se la sezione e' gia' stata salvata prima di questa migrazione, le regole
-- salvate entrano in vigore adesso, con le ancore (niente arretrati). Con i
-- valori di default non succede niente. Rilanciata: nessun cambiamento.
SELECT public.dr7_fidelity_lavaggio_applica(
  coalesce((SELECT config -> 'fidelity_lavaggio' FROM public.centralina_pro_config WHERE id = 'main'), '{}'::JSONB)
);

-- Verifica (facoltativa):
--   SELECT * FROM fidelity_lavaggio_config;
--   SELECT versione, count(*) FROM fidelity_lavaggio_ancora GROUP BY 1 ORDER BY 1;
