-- ============================================================================
-- PREVENDITE: CREDIT WALLET E CODICE SCONTO, ACCENDIBILI DA CENTRALINA PRO
-- (22/10/2026)
--
-- Il 19/10 il wallet sulle prevendite era stato tolto (REVOKE della funzione).
-- Ora la direzione li vuole entrambi, governati da due interruttori in
-- Centralina Pro > Automazioni (riga `main`):
--   automations.prevendite_wallet_attivo         (assente = acceso)
--   automations.prevendite_codice_sconto_attivo  (assente = acceso)
--
-- Tutto il controllo sta QUI, non nel browser:
--  - prevendite_opzioni_pagamento(): il sito chiede cosa mostrare;
--  - prevendita_calcola_sconto(): valida il codice e calcola il prezzo finale
--    (stesse regole di validate-discount-code: attivo, date, uso singolo,
--    cliente riservato, spesa minima; ambito "tutti" o "prevendite");
--  - trigger su prevendite_clienti (righe del sito in attesa): il prezzo
--    pagato lo ricalcola il database dal catalogo e dal codice;
--  - a pagamento avvenuto (carta o wallet) il codice si segna usato.
-- ============================================================================

ALTER TABLE public.prevendite_clienti ADD COLUMN IF NOT EXISTS codice_sconto TEXT;
ALTER TABLE public.prevendite_clienti ADD COLUMN IF NOT EXISTS sconto_eur NUMERIC(10,2);

-- ── Interruttori ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevendite_opzioni_pagamento()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'wallet',        coalesce((c.config->'automations'->>'prevendite_wallet_attivo')::boolean, true),
    'codice_sconto', coalesce((c.config->'automations'->>'prevendite_codice_sconto_attivo')::boolean, true)
  )
  FROM (SELECT (SELECT config FROM public.centralina_pro_config WHERE id = 'main') AS config) c;
$$;
REVOKE ALL ON FUNCTION public.prevendite_opzioni_pagamento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevendite_opzioni_pagamento() TO anon, authenticated;

-- ── Codice sconto ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevendita_calcola_sconto(
  p_prevendita_id UUID,
  p_codice        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT := lower(trim(coalesce(auth.jwt()->>'email', '')));
  v_codice TEXT := upper(regexp_replace(coalesce(p_codice, ''), '\s', '', 'g'));
  p        public.prevendite%ROWTYPE;
  d        public.discount_codes%ROWTYPE;
  v_fine   TIMESTAMPTZ;
  v_scope  TEXT;
  v_tel    TEXT;
  v_sconto NUMERIC;
BEGIN
  IF NOT coalesce((public.prevendite_opzioni_pagamento()->>'codice_sconto')::boolean, true) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Codici sconto non disponibili per le prevendite.');
  END IF;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Accedi per usare un codice sconto.');
  END IF;
  IF v_codice = '' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Inserisci un codice sconto.');
  END IF;

  SELECT * INTO p FROM public.prevendite WHERE id = p_prevendita_id;
  IF NOT FOUND OR p.prezzo IS NULL OR p.prezzo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non valida.');
  END IF;

  SELECT * INTO d FROM public.discount_codes WHERE code = v_codice;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Codice non valido.');
  END IF;
  IF coalesce(d.status, '') <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice non e'' piu'' valido.');
  END IF;
  -- valid_until salvato a mezzanotte UTC = vale tutto quel giorno (come il validatore).
  v_fine := CASE WHEN d.valid_until IS NOT NULL AND d.valid_until = date_trunc('day', d.valid_until AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                 THEN d.valid_until + interval '1 day' - interval '1 millisecond'
                 ELSE d.valid_until END;
  IF v_fine IS NOT NULL AND v_fine < now() THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice e'' scaduto.');
  END IF;
  IF d.valid_from IS NOT NULL AND d.valid_from > now() THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice non e'' ancora valido.');
  END IF;
  IF coalesce(d.single_use, false)
     AND EXISTS (SELECT 1 FROM public.discount_code_usages WHERE discount_code_id = d.id) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice e'' gia'' stato utilizzato.');
  END IF;
  IF nullif(trim(coalesce(d.customer_email, '')), '') IS NOT NULL
     AND lower(trim(d.customer_email)) <> v_email THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice e'' riservato a un altro cliente.');
  END IF;
  IF nullif(regexp_replace(coalesce(d.customer_phone, ''), '[\s\-+()]', '', 'g'), '') IS NOT NULL THEN
    SELECT regexp_replace(coalesce(telefono, ''), '[\s\-+()]', '', 'g') INTO v_tel
      FROM public.customers_extended WHERE user_id = v_uid LIMIT 1;
    IF right(coalesce(v_tel, ''), 9) = '' OR right(v_tel, 9) <> right(regexp_replace(d.customer_phone, '[\s\-+()]', '', 'g'), 9) THEN
      RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice e'' riservato a un altro cliente.');
    END IF;
  END IF;
  -- Ambito: nessuno, "tutti" o "prevendite".
  v_scope := lower(coalesce(d.scope::text, ''));
  IF v_scope NOT IN ('', '[]', '{}', 'null') AND v_scope !~ '(tutti|prevendit)' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice non vale per le prevendite.');
  END IF;
  IF d.minimum_spend IS NOT NULL AND p.prezzo < d.minimum_spend THEN
    RETURN jsonb_build_object('ok', false, 'errore',
      format('Questo codice richiede una spesa minima di €%s.', to_char(d.minimum_spend, 'FM999999990.00')));
  END IF;

  v_sconto := CASE d.value_type
    WHEN 'fixed' THEN coalesce(d.value_amount, 0)
    WHEN 'percentage' THEN round(p.prezzo * coalesce(d.value_amount, 0) / 100, 2)
    ELSE 0 END;
  v_sconto := least(greatest(v_sconto, 0), p.prezzo);
  IF v_sconto <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questo codice non da'' sconto su questa prevendita.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'codice', d.code,
    'codice_id', d.id,
    'sconto', v_sconto,
    'prezzo', p.prezzo,
    'prezzo_finale', round(p.prezzo - v_sconto, 2),
    'descrizione', CASE d.value_type WHEN 'percentage' THEN d.value_amount::text || '%' ELSE '€' || to_char(d.value_amount, 'FM999999990.00') END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prevendita_calcola_sconto(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevendita_calcola_sconto(UUID, TEXT) TO authenticated;

-- ── Prezzo delle righe del sito: lo decide il database ──────────────────────
-- Riga del sito in attesa di pagamento: prezzo = catalogo − codice. Le vendite
-- dal gestionale (origine 'gestionale', importo incassato a mano) non si toccano.
CREATE OR REPLACE FUNCTION public.prevendite_clienti_prezzo_sito()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prezzo NUMERIC;
  v_esito  JSONB;
BEGIN
  IF coalesce(NEW.origine, '') <> 'sito' OR coalesce(NEW.payment_status, '') <> 'pending' THEN
    RETURN NEW;
  END IF;
  SELECT prezzo INTO v_prezzo FROM public.prevendite WHERE id = NEW.prevendita_id;
  IF v_prezzo IS NULL THEN RETURN NEW; END IF;

  IF nullif(trim(coalesce(NEW.codice_sconto, '')), '') IS NULL THEN
    NEW.codice_sconto := NULL;
    NEW.sconto_eur := NULL;
    NEW.prezzo_pagato := v_prezzo;
    RETURN NEW;
  END IF;

  v_esito := public.prevendita_calcola_sconto(NEW.prevendita_id, NEW.codice_sconto);
  IF NOT coalesce((v_esito->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'CODICE_SCONTO: %', v_esito->>'errore';
  END IF;
  NEW.codice_sconto := v_esito->>'codice';
  NEW.sconto_eur := (v_esito->>'sconto')::numeric;
  NEW.prezzo_pagato := (v_esito->>'prezzo_finale')::numeric;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevendite_clienti_prezzo_sito ON public.prevendite_clienti;
CREATE TRIGGER trg_prevendite_clienti_prezzo_sito
  BEFORE INSERT ON public.prevendite_clienti
  FOR EACH ROW EXECUTE FUNCTION public.prevendite_clienti_prezzo_sito();

-- ── Codice usato a pagamento avvenuto (carta o wallet) ──────────────────────
CREATE OR REPLACE FUNCTION public.prevendite_clienti_codice_usato()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.discount_codes%ROWTYPE;
BEGIN
  IF NEW.codice_sconto IS NULL
     OR lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'completed', 'succeeded')
     OR lower(coalesce(OLD.payment_status, '')) IN ('paid', 'completed', 'succeeded') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO d FROM public.discount_codes WHERE code = NEW.codice_sconto;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.discount_code_usages (discount_code_id, customer_name, service_type, booking_id, discount_applied, notes)
  VALUES (d.id, NEW.customer_nome, 'prevendita', NULL, coalesce(NEW.sconto_eur, 0), 'Prevendita ' || NEW.nome || ' (' || NEW.id || ')');

  IF coalesce(d.single_use, false) THEN
    UPDATE public.discount_codes SET status = 'deactivated', updated_at = now() WHERE id = d.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevendite_clienti_codice_usato ON public.prevendite_clienti;
CREATE TRIGGER trg_prevendite_clienti_codice_usato
  AFTER UPDATE OF payment_status ON public.prevendite_clienti
  FOR EACH ROW EXECUTE FUNCTION public.prevendite_clienti_codice_usato();

-- ── Acquisto col Credit Wallet (con interruttore e codice) ──────────────────
CREATE OR REPLACE FUNCTION public.prevendita_acquista_con_credito(
  p_prevendita_id UUID,
  p_dati          JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  p          public.prevendite%ROWTYPE;
  v_saldo    NUMERIC;
  v_nuovo    NUMERIC;
  v_pc_id    UUID;
  v_attiva   JSONB;
  v_codice   TEXT := nullif(trim(coalesce(p_dati->>'codice_sconto', '')), '');
  v_sconto   JSONB;
  v_prezzo   NUMERIC;
BEGIN
  IF NOT coalesce((public.prevendite_opzioni_pagamento()->>'wallet')::boolean, true) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Il pagamento con Credit Wallet non e'' disponibile per le prevendite.');
  END IF;
  -- Chi compra e' sempre chi ha fatto l'accesso: mai un user_id dal browser.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Accedi per acquistare una prevendita.');
  END IF;

  SELECT * INTO p FROM public.prevendite WHERE id = p_prevendita_id FOR UPDATE;
  IF NOT FOUND OR NOT p.attiva OR NOT p.visibile_sito THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa prevendita non e piu in vendita.');
  END IF;
  IF p.posti_totali IS NOT NULL AND p.posti_venduti >= p.posti_totali THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita esaurita: i posti sono finiti.');
  END IF;
  IF p.prezzo IS NULL OR p.prezzo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prezzo della prevendita non valido.');
  END IF;

  v_prezzo := p.prezzo;
  IF v_codice IS NOT NULL THEN
    v_sconto := public.prevendita_calcola_sconto(p.id, v_codice);
    IF NOT coalesce((v_sconto->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'errore', v_sconto->>'errore');
    END IF;
    v_prezzo := (v_sconto->>'prezzo_finale')::numeric;
  END IF;

  SELECT balance INTO v_saldo FROM public.user_credit_balance WHERE user_id = v_uid FOR UPDATE;
  v_saldo := coalesce(v_saldo, 0);
  IF v_saldo < v_prezzo THEN
    RETURN jsonb_build_object('ok', false, 'errore',
      format('Credito insufficiente. Disponibile: €%s, richiesto: €%s.',
        to_char(v_saldo, 'FM999999990.00'), to_char(v_prezzo, 'FM999999990.00')));
  END IF;

  v_nuovo := round(v_saldo - v_prezzo, 2);
  UPDATE public.user_credit_balance SET balance = v_nuovo, last_updated = now() WHERE user_id = v_uid;

  -- Il pacchetto porta con se' le condizioni di OGGI (come l'acquisto a carta).
  -- prezzo_pagato e sconto li riscrive il trigger dal catalogo e dal codice.
  INSERT INTO public.prevendite_clienti (
    prevendita_id, user_id, customer_email, customer_nome, customer_telefono,
    nome, foto_url, prezzo_pagato, utilizzi_iniziali, utilizzi_usati,
    veicoli, km_inclusi, assicurazione_inclusa, max_utilizzi_mese,
    max_giorni_consecutivi, regole_extra, payment_status, payment_method, origine,
    customer_codice_fiscale, customer_indirizzo, customer_numero_civico,
    customer_citta, customer_cap, customer_provincia, codice_sconto
  ) VALUES (
    p.id, v_uid,
    coalesce(nullif(p_dati->>'email', ''), auth.jwt()->>'email', ''),
    coalesce(p_dati->>'nome', ''),
    coalesce(p_dati->>'telefono', ''),
    p.nome, p.foto_url, v_prezzo, p.utilizzi_inclusi, 0,
    p.veicoli, p.km_inclusi, p.assicurazione_inclusa, p.max_utilizzi_mese,
    p.max_giorni_consecutivi, p.regole_extra, 'pending', 'credit', 'sito',
    nullif(p_dati->>'codice_fiscale', ''), nullif(p_dati->>'indirizzo', ''),
    nullif(p_dati->>'numero_civico', ''), nullif(p_dati->>'citta', ''),
    nullif(p_dati->>'cap', ''), nullif(p_dati->>'provincia', ''), v_codice
  ) RETURNING id INTO v_pc_id;

  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_after, description,
    reference_id, reference_type, service_type, created_at
  ) VALUES (
    v_uid, 'debit', v_prezzo, v_nuovo, 'Prevendita ' || p.nome,
    v_pc_id, 'prevendita', 'prevendita', now()
  );

  -- Stessa attivazione del pagamento con carta: pagato, scadenza, posti.
  v_attiva := public.prevendita_attiva_pagamento(v_pc_id, 'credit');
  IF NOT coalesce((v_attiva->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'Attivazione prevendita non riuscita: %', v_attiva->>'errore';
  END IF;

  RETURN jsonb_build_object('ok', true, 'prevendita_cliente_id', v_pc_id, 'nuovo_saldo', v_nuovo);
END;
$$;

REVOKE ALL ON FUNCTION public.prevendita_acquista_con_credito(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevendita_acquista_con_credito(UUID, JSONB) TO authenticated;
