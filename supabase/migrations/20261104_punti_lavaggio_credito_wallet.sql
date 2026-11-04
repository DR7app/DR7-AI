-- ============================================================================
-- PUNTI LAVAGGIO (FIDELITY CARD): CALCOLATI DALLE PRENOTAZIONI, PREMIO IN
-- CREDITO WALLET VINCOLATO AL LAVAGGIO (04/11/2026)
--
-- Da eseguire a mano nel SQL editor di Supabase. Autosufficiente: funziona sia
-- che 20261012_punti_lavaggio_dal_database.sql sia gia' stata eseguita, sia
-- che non lo sia (ricrea quello che le serve con IF NOT EXISTS / OR REPLACE).
-- Rilanciabile.
--
-- PERCHE' (segnalazione 31/10, cliente Antonella Melis: 179 EUR di lavaggi
-- pagati, la Fidelity Card del sito diceva "Mancano 250 punti").
-- Il contatore `customers_extended.fidelity_points` era un numero che si
-- INCREMENTAVA soltanto, una prenotazione alla volta, al momento esatto in cui
-- passava a pagata. Tutto quello che non passava da quel momento restava fuori
-- per sempre:
--   * i lavaggi pagati PRIMA del trigger del 12/10 (nessun recupero: 71 su 74
--     negli ultimi 60 giorni erano senza punti);
--   * i lavaggi gia' pagati quando il trigger non c'era ancora nel database;
--   * il cliente con due schede (quella dell'ufficio e quella dell'account del
--     sito): i punti finivano sulla scheda dell'ufficio, il sito leggeva
--     quella dell'account e mostrava 0;
--   * un lavaggio annullato o ricalcolato dopo il pagamento non toglieva ne'
--     aggiornava niente.
--
-- ORA i punti NON si accumulano: si CALCOLANO ogni volta dalle prenotazioni.
--   punti totali = EUR interi della somma dei lavaggi (service_type car_wash)
--                  pagati (paid / succeeded / completed), non annullati,
--                  pagati sul sito o in negozio (qualunque metodo).
--   premi dovuti = floor(punti totali / 250)
--   punti sulla carta = punti totali - 250 x (premi gia' dati + soglie pregresse)
-- Stessa regola per sito e gestionale: entrambi leggono le due colonne
-- `fidelity_points` / `fidelity_lifetime_points`, che scrive SOLO questa
-- funzione, su TUTTE le schede della stessa persona.
--
-- CHI E' IL CLIENTE: solo dagli id della prenotazione, mai email/telefono/nome
-- (20261005_cauzione_cliente_mai_per_email.sql). Il "titolare" dei punti e'
-- l'ACCOUNT del sito se la scheda ne ha uno, altrimenti la scheda stessa.
-- Cosi' due schede dello stesso account sommano sulla stessa carta.
--
-- IL PREMIO (25 EUR ogni 250 punti):
--   * cliente con account sul sito -> un LOTTO di credito wallet vincolato
--     (wallet_crediti_vincolati, servizi = car_wash, scadenza 15 giorni):
--     lo stesso meccanismo del credito vincolato dato dall'admin. Nessuna riga
--     credit_transactions (regola di wallet_credito_vincolato: il lotto non
--     entra nel saldo libero).
--   * cliente senza account (solo in negozio) -> non ha un wallet: resta il
--     buono codice sconto di prima (discount_codes, scope lavaggi).
-- Ogni premio e' una riga `fidelity_buoni` con (titolare, numero) UNICO: il
-- premio n. 3 di una persona esiste una volta sola, qualunque strada lo
-- chieda (trigger, sito, callback Nexi, due salvataggi insieme).
--
-- STORICO: i lavaggi passati ora CONTANO per i punti (Melis vede 179/250), ma
-- le soglie da 250 gia' superate in passato senza premio NON pagano arretrati:
-- si registrano come "soglie pregresse" in `fidelity_lavaggio_base`. Chi aveva
-- 600 EUR di storico vede 100/250 e prende il premio al prossimo 250.
-- Per pagare invece gli arretrati: DELETE FROM fidelity_lavaggio_base; e poi
-- SELECT dr7_punti_lavaggio_ricalcola(titolare) per ogni titolare (vedi fondo).
-- ============================================================================

-- ── 0. Tabelle (gia' presenti se 20261012 e' stata eseguita) ────────────────
CREATE TABLE IF NOT EXISTS public.fidelity_buoni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_extended_id UUID REFERENCES public.customers_extended(id) ON DELETE SET NULL,
  voucher_code TEXT,
  importo NUMERIC NOT NULL,
  punti_soglia INTEGER NOT NULL,
  punti_rimasti INTEGER NOT NULL,
  valido_fino TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  messaggio_at TIMESTAMPTZ,
  messaggio_esito TEXT
);
CREATE INDEX IF NOT EXISTS idx_fidelity_buoni_created ON public.fidelity_buoni (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fidelity_buoni_da_inviare ON public.fidelity_buoni (created_at) WHERE messaggio_at IS NULL;
ALTER TABLE public.fidelity_buoni ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fidelity_buoni_staff_lettura ON public.fidelity_buoni;
CREATE POLICY fidelity_buoni_staff_lettura ON public.fidelity_buoni
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- Un premio non ha piu' sempre un codice (il credito wallet non ne ha), e non
-- deve sparire se si cancella la prenotazione che l'ha fatto scattare:
-- sparendo, il conto dei premi dati calerebbe e il premio ripartirebbe.
ALTER TABLE public.fidelity_buoni ALTER COLUMN voucher_code DROP NOT NULL;
ALTER TABLE public.fidelity_buoni ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE public.fidelity_buoni DROP CONSTRAINT IF EXISTS fidelity_buoni_booking_id_fkey;
ALTER TABLE public.fidelity_buoni
  ADD CONSTRAINT fidelity_buoni_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;

ALTER TABLE public.fidelity_buoni ADD COLUMN IF NOT EXISTS titolare UUID;
ALTER TABLE public.fidelity_buoni ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE public.fidelity_buoni ADD COLUMN IF NOT EXISTS lotto_id UUID;

-- I buoni gia' emessi dal 12/10 contano come premi dati.
UPDATE public.fidelity_buoni f
   SET titolare = coalesce(ce.user_id, ce.id)
  FROM public.customers_extended ce
 WHERE f.titolare IS NULL AND ce.id = f.customer_extended_id;

WITH n AS (
  SELECT id,
         row_number() OVER (PARTITION BY titolare ORDER BY created_at, id)
           + coalesce((SELECT max(numero) FROM public.fidelity_buoni x WHERE x.titolare = f.titolare), 0) AS rn
    FROM public.fidelity_buoni f
   WHERE titolare IS NOT NULL AND numero IS NULL
)
UPDATE public.fidelity_buoni f SET numero = n.rn FROM n WHERE f.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fidelity_buoni_titolare_numero
  ON public.fidelity_buoni (titolare, numero) WHERE titolare IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fidelity_buoni_titolare ON public.fidelity_buoni (titolare);

-- Soglie da 250 superate PRIMA di oggi senza premio: non pagano arretrati.
CREATE TABLE IF NOT EXISTS public.fidelity_lavaggio_base (
  titolare UUID PRIMARY KEY,
  soglie INTEGER NOT NULL CHECK (soglie >= 0),
  punti_al_via INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fidelity_lavaggio_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fidelity_lavaggio_base_staff_lettura ON public.fidelity_lavaggio_base;
CREATE POLICY fidelity_lavaggio_base_staff_lettura ON public.fidelity_lavaggio_base
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- ── 1. Cliente della prenotazione, solo per id (come 20261012) ──────────────
CREATE OR REPLACE FUNCTION public.dr7_cliente_della_prenotazione(p_user_id UUID, p_details JSONB)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_testo TEXT;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_extended WHERE id = p_user_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    SELECT id INTO v_id FROM customers_extended WHERE user_id = p_user_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  v_testo := coalesce(nullif(p_details #>> '{customer,customerId}', ''), nullif(p_details #>> '{customer,id}', ''));
  IF v_testo ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_id FROM customers_extended WHERE id = v_testo::uuid;
  END IF;
  RETURN v_id;
END;
$$;

-- ── 2. Titolare dei punti di una prenotazione ──────────────────────────────
-- Account del sito se c'e', altrimenti la scheda. NULL = nessun cliente.
CREATE OR REPLACE FUNCTION public.dr7_punti_titolare(p_user_id UUID, p_details JSONB)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scheda UUID;
  v_titolare UUID;
BEGIN
  v_scheda := dr7_cliente_della_prenotazione(p_user_id, p_details);
  IF v_scheda IS NOT NULL THEN
    SELECT coalesce(user_id, id) INTO v_titolare FROM customers_extended WHERE id = v_scheda;
    RETURN v_titolare;
  END IF;
  -- Account del sito senza scheda cliente.
  IF p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN p_user_id;
  END IF;
  RETURN NULL;
END;
$$;

-- Lavaggio che da' punti: stessa regola ovunque.
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_vale(p_service_type TEXT, p_payment_status TEXT, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_service_type, '') IN ('car_wash', 'carwash')
     AND lower(coalesce(p_payment_status, '')) IN ('paid', 'succeeded', 'completed')
     AND lower(coalesce(p_status, '')) NOT IN ('cancelled', 'annullata');
$$;

-- ── 3. Punti totali di un titolare: EUR interi dei lavaggi pagati ───────────
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
BEGIN
  IF p_titolare IS NULL THEN RETURN 0; END IF;
  v_schede := ARRAY[p_titolare] || coalesce(ARRAY(SELECT id FROM customers_extended WHERE user_id = p_titolare), '{}'::UUID[]);
  v_testi := ARRAY(SELECT unnest(v_schede)::TEXT);
  -- Il filtro sugli id e' piu' largo del necessario; il titolare esatto lo
  -- decide dr7_punti_titolare, la stessa funzione del trigger.
  SELECT coalesce(sum(b.price_total), 0) INTO v_cent
    FROM bookings b
   WHERE dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status)
     AND (b.user_id = ANY (v_schede)
          OR (b.booking_details #>> '{customer,customerId}') = ANY (v_testi)
          OR (b.booking_details #>> '{customer,id}') = ANY (v_testi))
     AND dr7_punti_titolare(b.user_id, b.booking_details) = p_titolare;
  RETURN greatest(0, floor(v_cent / 100.0))::INTEGER;  -- centesimi -> EUR
END;
$$;

-- ── 4. Ricalcolo di un titolare: premi mancanti + colonne della carta ───────
-- Ritorna quanti premi ha emesso adesso (0 quasi sempre). Idempotente.
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
              OR (b.booking_details #>> '{customer,id}') = ANY (ARRAY(SELECT unnest(v_schede)::TEXT)))
         AND dr7_punti_titolare(b.user_id, b.booking_details) = p_titolare
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

-- ── 5. Accredito di UNA prenotazione: stessa firma di prima (sito, Nexi) ────
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
  SELECT id, user_id, service_type, price_total, payment_status, status, booking_details
    INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT dr7_punti_lavaggio_vale(b.service_type, b.payment_status, b.status) THEN RETURN 0; END IF;
  v_titolare := dr7_punti_titolare(b.user_id, b.booking_details);
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

REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_accredita(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_accredita(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_ricalcola(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_ricalcola(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_totale(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_totale(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_punti_titolare(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_titolare(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_cliente_della_prenotazione(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_cliente_della_prenotazione(UUID, JSONB) TO service_role;

-- ── 6. Trigger su bookings ──────────────────────────────────────────────────
-- Ricalcola a ogni cambiamento che sposta i punti: pagamento, annullamento,
-- prezzo, cliente agganciato, cancellazione. Un errore qui non blocca mai il
-- salvataggio della prenotazione.
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
       AND (OLD.booking_details #>> '{customer,customerId}') IS NOT DISTINCT FROM (NEW.booking_details #>> '{customer,customerId}')
       AND (OLD.booking_details #>> '{customer,id}') IS NOT DISTINCT FROM (NEW.booking_details #>> '{customer,id}') THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') AND coalesce(NEW.service_type, '') IN ('car_wash', 'carwash') THEN
      v_nuovo := dr7_punti_titolare(NEW.user_id, NEW.booking_details);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND coalesce(OLD.service_type, '') IN ('car_wash', 'carwash') THEN
      v_vecchio := dr7_punti_titolare(OLD.user_id, OLD.booking_details);
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
  AFTER INSERT OR DELETE OR UPDATE OF payment_status, status, price_total, user_id, booking_details, service_type
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_trg_punti_lavaggio();

-- Scheda collegata (o scollegata) a un account: la carta cambia titolare.
CREATE OR REPLACE FUNCTION public.dr7_trg_punti_lavaggio_scheda()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM dr7_punti_lavaggio_ricalcola(coalesce(NEW.user_id, NEW.id), NULL);
    IF coalesce(OLD.user_id, OLD.id) IS DISTINCT FROM coalesce(NEW.user_id, NEW.id) THEN
      PERFORM dr7_punti_lavaggio_ricalcola(coalesce(OLD.user_id, OLD.id), NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[punti lavaggio] scheda % non ricalcolata: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dr7_punti_lavaggio_scheda ON public.customers_extended;
CREATE TRIGGER trg_dr7_punti_lavaggio_scheda
  AFTER UPDATE OF user_id ON public.customers_extended
  FOR EACH ROW
  WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION public.dr7_trg_punti_lavaggio_scheda();

-- ── 7. Messaggio e allarme (gia' presenti se 20261012 e' stata eseguita) ────
INSERT INTO public.system_messages
  (message_key, label, description, message_body, is_automatic, is_enabled, include_header, send_email,
   target_service_type, recipient_mode, handled_events)
SELECT 'pro_fidelity_voucher',
       'Lavaggio: 250 punti raggiunti (buono 25 EUR)',
       'WhatsApp al cliente quando la Fidelity Card lavaggio arriva a 250 punti. Parte da solo, sia per i lavaggi del gestionale sia per quelli del sito. Token: {nome}, {codice}, {importo}, {punti}, {punti_rimasti}, {giorni}, {scadenza}, {link}',
       E'Complimenti *{nome}*!\n\nSei arrivato a *{punti} punti* con la Fidelity Card DR7 Prime Wash. Ecco il tuo buono di *€{importo}* utilizzabile sul prossimo lavaggio:\n\n*{codice}*\n\nValido fino al {scadenza}. Hai gia'' {punti_rimasti} punti sulla nuova carta.\n\nCordiali Saluti,\n*DR7*',
       false, true, false, false, 'all', 'customer', ARRAY['fidelity_voucher_whatsapp']::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.system_messages WHERE message_key = 'pro_fidelity_voucher');

INSERT INTO public.system_alarms
    (id, label, schedule, reason, category, threshold_value, threshold_unit, is_enabled, sort_order,
     group_key, priority, reparto, detector, stato_rilevamento, ripeti_finche_non_risolto, ripeti_ogni_minuti,
     notifica_gestionale, notifica_push, notifica_whatsapp_interna, notifica_email_interna, destinatari,
     sound_key, suono_continuo, messaggio_cliente_auto)
VALUES
    ('lav_punti_250', 'Cliente a 250 punti lavaggio', 'All''emissione del buono',
     'Il cliente ha raggiunto 250 punti Fidelity lavaggio: buono di 25 EUR emesso e inviato su WhatsApp.',
     'booking', 1440, 'minutes_after', true, 2490, 'lavaggi', 'attenzione', 'Lavaggio',
     'punti_lavaggio_250', 'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false)
ON CONFLICT (id) DO NOTHING;

-- ── 8. Allineamento dello storico (una passata, niente premi arretrati) ─────
-- Soglie gia' superate senza premio -> fidelity_lavaggio_base.
WITH tot AS (
  SELECT t.titolare, greatest(0, floor(sum(t.price_total) / 100.0))::INTEGER AS punti
    FROM (
      SELECT dr7_punti_titolare(b.user_id, b.booking_details) AS titolare, b.price_total
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
 WHERE NOT EXISTS (SELECT 1 FROM public.fidelity_lavaggio_base x WHERE x.titolare = dati.titolare)
ON CONFLICT (titolare) DO NOTHING;

-- Colonne della carta su ogni scheda, dallo stesso calcolo.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT coalesce(ce.user_id, ce.id) AS titolare
      FROM public.customers_extended ce
     WHERE coalesce(ce.fidelity_points, 0) <> 0
        OR coalesce(ce.fidelity_lifetime_points, 0) <> 0
    UNION
    SELECT titolare FROM public.fidelity_lavaggio_base
  LOOP
    PERFORM public.dr7_punti_lavaggio_ricalcola(r.titolare, NULL);
  END LOOP;
END $$;

-- Verifica (facoltativa) dopo l'esecuzione:
--   SELECT nome, cognome, fidelity_points, fidelity_lifetime_points
--     FROM customers_extended WHERE cognome ILIKE 'melis%';
-- Per pagare gli arretrati invece di azzerarli (decisione della direzione):
--   DELETE FROM fidelity_lavaggio_base;
--   SELECT dr7_punti_lavaggio_ricalcola(titolare) FROM (SELECT DISTINCT
--     dr7_punti_titolare(user_id, booking_details) AS titolare FROM bookings
--     WHERE dr7_punti_lavaggio_vale(service_type, payment_status, status)) t
--     WHERE titolare IS NOT NULL;
