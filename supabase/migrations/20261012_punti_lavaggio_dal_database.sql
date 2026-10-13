-- ============================================================================
-- PUNTI LAVAGGIO (FIDELITY CARD) DAL DATABASE (12/10/2026)
--
-- Regola (direzione): 1 EUR speso in un lavaggio = 1 punto. A 250 punti il
-- cliente riceve un buono di 25 EUR per il prossimo lavaggio e la linea
-- riparte da quello che avanza: 240 punti + lavaggio da 100 EUR = 340 ->
-- buono + 90 punti.
--
-- Prima i punti li dava solo la funzione del sito `award-fidelity-points`,
-- chiamata dalle pagine del sito e dal callback Nexi. I lavaggi creati o
-- incassati dal GESTIONALE non prendevano punti (71 su 74 lavaggi pagati
-- senza punti negli ultimi 60 giorni), il surplus veniva azzerato invece di
-- essere riportato, il cliente si cercava per email/telefono e il template
-- `pro_fidelity_voucher` non esisteva: nessun buono e' mai partito.
--
-- Da qui in avanti i punti li assegna il trigger su `bookings`, per ogni
-- strada (gestionale, sito, callback, SQL a mano), come l'addebito del wallet
-- (20260915000000_wallet_addebito_prenotazione.sql).
--
-- Cliente: SOLO dagli id della prenotazione, mai email/telefono/nome
-- (vedi 20261005_cauzione_cliente_mai_per_email.sql):
--   bookings.user_id = customers_extended.id
--   customers_extended.user_id = bookings.user_id (account del sito)
--   booking_details.customer.customerId / .id = customers_extended.id
-- Iscritto al sito o no non cambia niente: conta la scheda Lead.
--
-- Ogni buono emesso diventa una riga `fidelity_buoni`. Il giro allarmi del
-- gestionale (alarm-engine-cron, ogni minuto) la legge: apre l'allarme
-- "Cliente a 250 punti lavaggio" e manda al cliente il messaggio Pro
-- `pro_fidelity_voucher` con il codice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fidelity_buoni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_extended_id UUID REFERENCES public.customers_extended(id) ON DELETE SET NULL,
  voucher_code TEXT NOT NULL,
  importo NUMERIC NOT NULL,
  punti_soglia INTEGER NOT NULL,
  punti_rimasti INTEGER NOT NULL,
  valido_fino TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invio al cliente: prenotato con una UPDATE atomica (NULL -> adesso).
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

-- ── Cliente della prenotazione, solo per id ─────────────────────────────────
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

-- ── Accredito dei punti di UNA prenotazione (idempotente) ────────────────────
-- Ritorna quanti buoni ha emesso. Chiamabile anche dal sito via RPC.
CREATE OR REPLACE FUNCTION public.dr7_punti_lavaggio_accredita(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_soglia CONSTANT INTEGER := 250;
  c_buono CONSTANT NUMERIC := 25;
  c_giorni CONSTANT INTEGER := 15;
  c_alfabeto CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b RECORD;
  v_cliente UUID;
  v_ce RECORD;
  v_punti INTEGER;
  v_linea INTEGER;
  v_buoni INTEGER := 0;
  v_codice TEXT;
  v_primo TEXT;
  v_fino TIMESTAMPTZ;
  v_award UUID;
  i INTEGER;
BEGIN
  SELECT id, user_id, service_type, price_total, payment_status, status, booking_details
    INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF coalesce(b.service_type, '') NOT IN ('car_wash', 'carwash') THEN RETURN 0; END IF;
  IF lower(coalesce(b.payment_status, '')) NOT IN ('paid', 'succeeded', 'completed') THEN RETURN 0; END IF;
  IF lower(coalesce(b.status, '')) IN ('cancelled', 'annullata') THEN RETURN 0; END IF;

  v_punti := floor(coalesce(b.price_total, 0) / 100.0)::INTEGER;  -- centesimi -> EUR
  IF v_punti <= 0 THEN RETURN 0; END IF;

  v_cliente := dr7_cliente_della_prenotazione(b.user_id, b.booking_details);
  IF v_cliente IS NULL THEN RETURN 0; END IF;

  -- Il blocco sulla riga premio (UNIQUE booking_id) impedisce il doppio
  -- accredito anche con trigger + sito + callback nello stesso istante.
  INSERT INTO fidelity_point_awards (booking_id, customer_extended_id, points_awarded)
  VALUES (b.id, v_cliente, v_punti)
  ON CONFLICT (booking_id) DO NOTHING
  RETURNING id INTO v_award;
  IF v_award IS NULL THEN RETURN 0; END IF;

  SELECT id, email, telefono, coalesce(fidelity_points, 0) AS punti, coalesce(fidelity_lifetime_points, 0) AS totale
    INTO v_ce FROM customers_extended WHERE id = v_cliente FOR UPDATE;

  v_linea := v_ce.punti + v_punti;
  v_fino := date_trunc('day', now() AT TIME ZONE 'Europe/Rome') + make_interval(days => c_giorni + 1) - interval '1 second';
  v_fino := v_fino AT TIME ZONE 'Europe/Rome';

  WHILE v_linea >= c_soglia LOOP
    v_linea := v_linea - c_soglia;
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
    VALUES (v_codice, 'codice_sconto', 'fixed', c_buono, ARRAY['lavaggi'], NULL, true, 'active',
            nullif(v_ce.email, ''), nullif(v_ce.telefono, ''), now(), v_fino,
            'Buono Fidelity Card — solo Prime Wash',
            format('Buono di EUR %s guadagnato con la Fidelity Card (%s punti). Utilizzabile solo per servizi di lavaggio. Valido %s giorni.', c_buono, c_soglia, c_giorni),
            'https://dr7.app/promo/' || v_codice);

    INSERT INTO fidelity_buoni (booking_id, customer_extended_id, voucher_code, importo, punti_soglia, punti_rimasti, valido_fino)
    VALUES (b.id, v_cliente, v_codice, c_buono, c_soglia, v_linea, v_fino);

    v_primo := coalesce(v_primo, v_codice);
    v_buoni := v_buoni + 1;
  END LOOP;

  UPDATE customers_extended
     SET fidelity_points = v_linea,
         fidelity_lifetime_points = v_ce.totale + v_punti,
         updated_at = now()
   WHERE id = v_cliente;

  IF v_primo IS NOT NULL THEN
    UPDATE fidelity_point_awards SET voucher_code = v_primo, voucher_issued_at = now() WHERE id = v_award;
  END IF;

  RETURN v_buoni;
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_punti_lavaggio_accredita(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_punti_lavaggio_accredita(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.dr7_cliente_della_prenotazione(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_cliente_della_prenotazione(UUID, JSONB) TO service_role;

-- ── Trigger: quando un lavaggio diventa pagato (o gli si aggancia il cliente) ─
-- Solo al PASSAGGIO a pagato: risalvare una vecchia prenotazione gia' pagata
-- non regala punti arretrati. Un errore qui non blocca mai il salvataggio.
CREATE OR REPLACE FUNCTION public.dr7_trg_punti_lavaggio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pagata_ora BOOLEAN;
  v_pagata_prima BOOLEAN;
BEGIN
  IF coalesce(NEW.service_type, '') NOT IN ('car_wash', 'carwash') THEN RETURN NEW; END IF;
  v_pagata_ora := lower(coalesce(NEW.payment_status, '')) IN ('paid', 'succeeded', 'completed');
  IF NOT v_pagata_ora THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_pagata_prima := lower(coalesce(OLD.payment_status, '')) IN ('paid', 'succeeded', 'completed');
    IF v_pagata_prima
       AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
       AND (OLD.booking_details #>> '{customer,customerId}') IS NOT DISTINCT FROM (NEW.booking_details #>> '{customer,customerId}')
       AND (OLD.booking_details #>> '{customer,id}') IS NOT DISTINCT FROM (NEW.booking_details #>> '{customer,id}') THEN
      RETURN NEW;
    END IF;
    -- Pagata gia' prima ma il cliente arriva solo ora: si accredita solo se
    -- la prenotazione e' recente, mai arretrati di mesi.
    IF v_pagata_prima AND coalesce(NEW.created_at, now()) < now() - interval '30 days' THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    PERFORM dr7_punti_lavaggio_accredita(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[punti lavaggio] prenotazione % non accreditata: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dr7_punti_lavaggio ON public.bookings;
CREATE TRIGGER trg_dr7_punti_lavaggio
  AFTER INSERT OR UPDATE OF payment_status, user_id, booking_details, service_type ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_trg_punti_lavaggio();

-- ── Messaggio di Sistema Pro ────────────────────────────────────────────────
INSERT INTO public.system_messages
  (message_key, label, description, message_body, is_automatic, is_enabled, include_header, send_email,
   target_service_type, recipient_mode, handled_events)
SELECT 'pro_fidelity_voucher',
       'Lavaggio: 250 punti raggiunti (buono 25 EUR)',
       'WhatsApp al cliente quando la Fidelity Card lavaggio arriva a 250 punti. Parte da solo, sia per i lavaggi del gestionale sia per quelli del sito. Token: {nome}, {codice}, {importo}, {punti}, {punti_rimasti}, {giorni}, {scadenza}, {link}',
       E'Complimenti *{nome}*!\n\nSei arrivato a *{punti} punti* con la Fidelity Card DR7 Prime Wash. Ecco il tuo buono di *€{importo}* utilizzabile sul prossimo lavaggio:\n\n*{codice}*\n\nValido fino al {scadenza}. Hai gia'' {punti_rimasti} punti sulla nuova carta.\n\nCordiali Saluti,\n*DR7*',
       false, true, false, false, 'all', 'customer', ARRAY['fidelity_voucher_whatsapp']::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.system_messages WHERE message_key = 'pro_fidelity_voucher');

-- ── Allarme del catalogo ────────────────────────────────────────────────────
-- Detector `punti_lavaggio_250` (src/utils/allarmi/puntiLavaggio.ts). Soglia =
-- minuti dopo l'emissione del buono in cui l'allarme resta aperto. Acceso.
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
