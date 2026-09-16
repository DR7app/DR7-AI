-- ═══════════════════════════════════════════════════════════════════════════
-- CREDITO WALLET VINCOLATO — 16/09/2026
--
-- Fino ad oggi il wallet era un numero solo: `user_credit_balance.balance`.
-- Un credito regalato valeva su tutto e per sempre. La direzione ha chiesto
-- di poterne dare uno che vale SOLO su certi servizi (es. solo Lavaggio, o
-- Lavaggio + Terra) e SOLO fino a una data.
--
-- Un numero solo non basta piu': servono i LOTTI. Ogni credito vincolato e'
-- una riga con il suo residuo, la sua scadenza e i suoi servizi. Il saldo
-- libero resta dov'e' — nessuna migrazione dei dati esistenti, nessun saldo
-- che cambia stanotte.
--
-- REGOLE DI SPESA (valgono ovunque: sito, gestionale, trigger, SQL a mano)
--   1. Prima si consumano i lotti VINCOLATI validi per quel servizio, il piu'
--      stretto e il piu' vicino a scadere per primo. Se non si facesse cosi'
--      il credito a scadenza morirebbe nel wallet mentre si spende quello
--      libero.
--   2. Quello che resta esce dal saldo libero.
--   3. Un lotto scaduto non si spende. Non si cancella: resta a registro.
--   4. Lo storno di una prenotazione restituisce a OGNI lotto quello che quel
--      lotto aveva pagato, e il resto al saldo libero.
--
-- Il servizio si normalizza come `businessScope.ts` nel gestionale: Terra e'
-- NULL/''/car_rental/rental, la meccanica sta dentro car_wash.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Il business di un service_type (stessa regola di businessScope.ts) ──
CREATE OR REPLACE FUNCTION public.dr7_wallet_business(p_service_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_service_type IS NULL OR btrim(p_service_type) = '' THEN 'rental'
    WHEN lower(btrim(p_service_type)) IN ('rental', 'car_rental') THEN 'rental'
    WHEN lower(btrim(p_service_type)) IN ('mechanical', 'mechanical_service', 'car_wash') THEN 'car_wash'
    WHEN lower(btrim(p_service_type)) IN ('boat_rental', 'heli_rental', 'stay_rental') THEN lower(btrim(p_service_type))
    ELSE 'rental'
  END;
$$;

COMMENT ON FUNCTION public.dr7_wallet_business(TEXT) IS
  'Business di un service_type: rental | boat_rental | heli_rental | stay_rental | car_wash. Copia SQL di businessScope.toBusiness.';

-- ── 2. I lotti ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_crediti_vincolati (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  importo      NUMERIC(12,2) NOT NULL CHECK (importo > 0),
  residuo      NUMERIC(12,2) NOT NULL CHECK (residuo >= 0),
  -- NULL = non scade mai. La data e' l'ULTIMO giorno valido.
  scadenza     DATE,
  -- NULL o vuoto = vale su tutti i servizi. Altrimenti i business ammessi.
  servizi      TEXT[],
  descrizione  TEXT,
  origine      TEXT NOT NULL DEFAULT 'admin',
  creato_da    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_crediti_vincolati_residuo_max CHECK (residuo <= importo)
);

CREATE INDEX IF NOT EXISTS idx_wcv_user ON public.wallet_crediti_vincolati (user_id) WHERE residuo > 0;
CREATE INDEX IF NOT EXISTS idx_wcv_scadenza ON public.wallet_crediti_vincolati (scadenza) WHERE residuo > 0;

-- Quanto ha pagato ogni lotto su ogni prenotazione: serve allo storno, che
-- deve rimettere i soldi nel lotto giusto e non nel saldo libero.
CREATE TABLE IF NOT EXISTS public.wallet_crediti_vincolati_movimenti (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lotto_id     UUID NOT NULL REFERENCES public.wallet_crediti_vincolati(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  booking_id   UUID,
  importo      NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wcvm_booking ON public.wallet_crediti_vincolati_movimenti (booking_id);
CREATE INDEX IF NOT EXISTS idx_wcvm_lotto ON public.wallet_crediti_vincolati_movimenti (lotto_id);

-- ── 3. Un lotto e' spendibile su questo servizio, oggi? ───────────────────
CREATE OR REPLACE FUNCTION public.dr7_wallet_lotto_vale(
  p_scadenza DATE,
  p_servizi  TEXT[],
  p_servizio TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT (p_scadenza IS NULL OR p_scadenza >= current_date)
     AND (p_servizi IS NULL OR cardinality(p_servizi) = 0
          OR public.dr7_wallet_business(p_servizio) = ANY (
               SELECT public.dr7_wallet_business(s) FROM unnest(p_servizi) AS s
             ));
$$;

-- ── 4. Quanto credito vincolato e' spendibile su un servizio ──────────────
CREATE OR REPLACE FUNCTION public.dr7_wallet_vincolato_disponibile(
  p_user_id  UUID,
  p_servizio TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(sum(residuo), 0)::NUMERIC(12,2)
    FROM public.wallet_crediti_vincolati
   WHERE user_id = p_user_id
     AND residuo > 0
     AND public.dr7_wallet_lotto_vale(scadenza, servizi, p_servizio);
$$;

-- ── 5. Consuma dai lotti. Torna quanto ha coperto. ────────────────────────
-- Ordine: prima i vincolati a un servizio (piu' stretti), poi quelli che
-- scadono prima, poi i piu' vecchi. Chi scade per primo se ne va per primo.
CREATE OR REPLACE FUNCTION public.dr7_wallet_consuma_vincolato(
  p_user_id    UUID,
  p_importo    NUMERIC,
  p_servizio   TEXT,
  p_booking_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_resta  NUMERIC := round(coalesce(p_importo, 0), 2);
  v_preso  NUMERIC := 0;
  v_quota  NUMERIC;
  r        RECORD;
BEGIN
  IF v_resta <= 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT id, residuo
      FROM public.wallet_crediti_vincolati
     WHERE user_id = p_user_id
       AND residuo > 0
       AND public.dr7_wallet_lotto_vale(scadenza, servizi, p_servizio)
     -- Prima quello che SCADE prima: e' l'unico che, non speso, sparisce.
     -- A parita' di scadenza, prima il piu' stretto (vincolato a un
     -- servizio), che serve a meno cose. Poi il piu' vecchio.
     ORDER BY scadenza NULLS LAST,
              (servizi IS NOT NULL AND cardinality(servizi) > 0) DESC,
              created_at
     FOR UPDATE
  LOOP
    EXIT WHEN v_resta <= 0;
    v_quota := least(r.residuo, v_resta);

    UPDATE public.wallet_crediti_vincolati
       SET residuo = round(residuo - v_quota, 2), updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.wallet_crediti_vincolati_movimenti (lotto_id, user_id, booking_id, importo)
         VALUES (r.id, p_user_id, p_booking_id, v_quota);

    v_resta := round(v_resta - v_quota, 2);
    v_preso := round(v_preso + v_quota, 2);
  END LOOP;

  RETURN v_preso;
END;
$$;

-- ── 6. Restituisce ai lotti quello che avevano pagato su una prenotazione ─
CREATE OR REPLACE FUNCTION public.dr7_wallet_restituisci_vincolato(
  p_user_id    UUID,
  p_importo    NUMERIC,
  p_booking_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_resta NUMERIC := round(coalesce(p_importo, 0), 2);
  v_dato  NUMERIC := 0;
  v_quota NUMERIC;
  r       RECORD;
BEGIN
  IF v_resta <= 0 OR p_booking_id IS NULL THEN RETURN 0; END IF;

  -- Si ridanno indietro gli ultimi presi per primi: e' l'inverso esatto di
  -- come sono stati tolti.
  FOR r IN
    SELECT m.id, m.lotto_id, m.importo, l.importo AS lotto_importo, l.residuo
      FROM public.wallet_crediti_vincolati_movimenti m
      JOIN public.wallet_crediti_vincolati l ON l.id = m.lotto_id
     WHERE m.user_id = p_user_id
       AND m.booking_id = p_booking_id
       AND m.importo > 0
     ORDER BY m.created_at DESC
     FOR UPDATE OF m, l
  LOOP
    EXIT WHEN v_resta <= 0;
    -- Mai oltre il capiente del lotto: un lotto non puo' tornare piu' pieno
    -- di com'e' nato.
    v_quota := least(r.importo, v_resta, round(r.lotto_importo - r.residuo, 2));
    CONTINUE WHEN v_quota <= 0;

    UPDATE public.wallet_crediti_vincolati
       SET residuo = round(residuo + v_quota, 2), updated_at = now()
     WHERE id = r.lotto_id;

    UPDATE public.wallet_crediti_vincolati_movimenti
       SET importo = round(importo - v_quota, 2)
     WHERE id = r.id;

    v_resta := round(v_resta - v_quota, 2);
    v_dato  := round(v_dato + v_quota, 2);
  END LOOP;

  RETURN v_dato;
END;
$$;

-- ── 7. Permessi ───────────────────────────────────────────────────────────
ALTER TABLE public.wallet_crediti_vincolati ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_crediti_vincolati_movimenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wcv_proprio ON public.wallet_crediti_vincolati;
CREATE POLICY wcv_proprio ON public.wallet_crediti_vincolati
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS wcvm_proprio ON public.wallet_crediti_vincolati_movimenti;
CREATE POLICY wcvm_proprio ON public.wallet_crediti_vincolati_movimenti
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.wallet_crediti_vincolati TO authenticated;
GRANT SELECT ON public.wallet_crediti_vincolati_movimenti TO authenticated;
GRANT ALL ON public.wallet_crediti_vincolati TO service_role;
GRANT ALL ON public.wallet_crediti_vincolati_movimenti TO service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_business(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_lotto_vale(DATE, TEXT[], TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_vincolato_disponibile(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_consuma_vincolato(UUID, NUMERIC, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_restituisci_vincolato(UUID, NUMERIC, UUID) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. IL TRIGGER DELLE PRENOTAZIONI IMPARA I LOTTI
--
-- Stessa funzione della migrazione 20260915000000, con una differenza sola:
-- l'addebito passa prima dai crediti vincolati validi per il servizio della
-- prenotazione, e solo il resto esce dal saldo libero. Il registro
-- `credit_transactions` continua a segnare l'importo INTERO pagato col
-- wallet — quello che il cliente ha speso non cambia perche' arriva da due
-- tasche diverse — e la descrizione dice quanto veniva dal vincolato.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dr7_wallet_sync_prenotazione()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_dovuto         NUMERIC := 0;
  v_dovuto_prima   NUMERIC := 0;
  v_gia_addebitato NUMERIC := 0;
  v_base           NUMERIC := 0;
  v_delta          NUMERIC := 0;
  v_saldo          NUMERIC;
  v_nuovo_saldo    NUMERIC;
  v_movimento      UUID;
  v_descrizione    TEXT;
  v_riferimento    TEXT;
  v_stato          TEXT;
  v_da_vincolati   NUMERIC := 0;   -- quanto copre il credito vincolato
  v_delta_libero   NUMERIC := 0;   -- quanto resta al saldo libero
  v_disponibile    NUMERIC := 0;
BEGIN
  -- (a) Niente da fare se non e' cambiato nulla che riguardi il pagamento.
  --     Un salvataggio che tocca solo le note non deve nemmeno leggere il wallet.
  IF TG_OP = 'UPDATE'
     AND NEW.payment_method  IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.payment_status  IS NOT DISTINCT FROM OLD.payment_status
     AND NEW.price_total     IS NOT DISTINCT FROM OLD.price_total
     AND NEW.amount_paid     IS NOT DISTINCT FROM OLD.amount_paid
     AND NEW.user_id         IS NOT DISTINCT FROM OLD.user_id
     AND NEW.customer_email  IS NOT DISTINCT FROM OLD.customer_email THEN
    RETURN NEW;
  END IF;

  -- (b) Prenotazioni di prova: non toccano mai denaro vero.
  IF coalesce(NEW.vehicle_plate, '') ILIKE 'TEST%'
     OR lower(coalesce(NEW.vehicle_name, '')) = 'test' THEN
    RETURN NEW;
  END IF;

  v_dovuto := public.dr7_wallet_importo_dovuto(
    NEW.payment_method, NEW.payment_status, NEW.price_total, NEW.amount_paid);

  IF TG_OP = 'UPDATE' THEN
    v_dovuto_prima := public.dr7_wallet_importo_dovuto(
      OLD.payment_method, OLD.payment_status, OLD.price_total, OLD.amount_paid);
  END IF;

  -- Prenotazione annullata: il wallet non si tocca. Il rimborso segue la
  -- politica di cancellazione (10% trattenuto, 90% a credito), che e' un
  -- flusso a parte con le sue regole. Qui si congela la situazione attuale.
  v_stato := lower(btrim(coalesce(NEW.status, '')));
  IF v_stato IN ('cancelled', 'annullata', 'canceled', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Nessun movimento previsto ne' prima ne' adesso: strada piu' corta.
  IF v_dovuto = 0 AND v_dovuto_prima = 0 THEN
    RETURN NEW;
  END IF;

  -- (c) Il cliente e il suo wallet. Senza account sito non esiste un wallet da
  --     addebitare: si avvisa e si lascia passare la prenotazione (la scheda
  --     del gestionale lo segnala all'operatore prima del salvataggio).
  -- 16/09/2026: `bookings.user_id` e' l'account del sito quando la
  -- prenotazione arriva dal sito, ma e' l'id della SCHEDA CLIENTE quando la
  -- scrive il gestionale. Chiedere sempre e comunque un account qui dentro
  -- voleva dire non addebitare mai le prenotazioni fatte dall'ufficio.
  v_user_id := public.dr7_wallet_account_del_cliente(NEW.user_id, NEW.customer_email);

  IF v_user_id IS NULL THEN
    RAISE WARNING '[wallet] prenotazione % con metodo wallet ma nessun account cliente: addebito non eseguito', NEW.id;
    RETURN NEW;
  END IF;

  -- (d) Quanto e' gia' stato prelevato PER QUESTA prenotazione.
  --     Si contano solo gli addebiti collegati e gli storni emessi da qui:
  --     un eventuale cashback accreditato sulla stessa prenotazione non deve
  --     far sembrare che il cliente abbia pagato di meno.
  SELECT coalesce(sum(
           CASE WHEN ct.transaction_type = 'debit' THEN ct.amount
                WHEN ct.reference_type = 'booking_refund' THEN -ct.amount
                ELSE 0 END), 0)
    INTO v_gia_addebitato
    FROM public.credit_transactions ct
   WHERE ct.reference_id = NEW.id;

  -- (e) Adozione: il sito addebita il wallet e SUBITO DOPO crea la
  --     prenotazione, senza poter scrivere un reference_id che ancora non
  --     esiste. Se troviamo quell'addebito, lo colleghiamo a questa
  --     prenotazione invece di prelevare una seconda volta.
  IF v_gia_addebitato = 0 AND TG_OP = 'INSERT' AND v_dovuto > 0 THEN
    SELECT ct.id INTO v_movimento
      FROM public.credit_transactions ct
     WHERE ct.user_id = v_user_id
       AND ct.transaction_type = 'debit'
       AND ct.reference_id IS NULL
       AND ct.reference_type IS NULL
       AND abs(ct.amount - v_dovuto) < 0.01
       AND ct.created_at >= now() - interval '15 minutes'
     ORDER BY ct.created_at DESC
     LIMIT 1;

    IF v_movimento IS NOT NULL THEN
      UPDATE public.credit_transactions
         SET reference_id   = NEW.id,
             reference_type = 'booking_payment',
             service_type   = coalesce(service_type, NEW.service_type)
       WHERE id = v_movimento;
      RAISE NOTICE '[wallet] movimento % collegato alla prenotazione % (addebito gia effettuato dal sito)', v_movimento, NEW.id;
      RETURN NEW;
    END IF;
  END IF;

  -- (f) Base di calcolo. Se il registro parla, vince il registro. Altrimenti,
  --     su una MODIFICA, si assume che l'importo gia' dovuto prima fosse stato
  --     incassato: si movimenta solo la differenza, non tutto da capo.
  IF v_gia_addebitato > 0 THEN
    v_base := v_gia_addebitato;
  ELSIF TG_OP = 'UPDATE' THEN
    v_base := v_dovuto_prima;
  ELSE
    v_base := 0;
  END IF;

  v_delta := round(v_dovuto - v_base, 2);

  -- Non si restituisce denaro che non risulta prelevato da noi, e non si
  -- restituisce piu' di quanto prelevato.
  IF v_delta < 0 THEN
    IF v_gia_addebitato <= 0 THEN
      v_delta := 0;
    ELSE
      v_delta := greatest(v_delta, -v_gia_addebitato);
    END IF;
  END IF;

  IF abs(v_delta) < 0.01 THEN
    RETURN NEW;
  END IF;

  -- (g1) Credito VINCOLATO (16/09/2026). Prima di toccare il saldo libero si
  --      consumano i lotti validi per QUESTO servizio, il piu' stretto e il
  --      piu' vicino a scadere per primo: altrimenti il credito a scadenza
  --      muore nel wallet mentre si spende quello che non scade mai.
  --      Sullo storno si restituisce a ogni lotto quello che quel lotto aveva
  --      pagato su questa prenotazione, non al saldo libero.
  IF v_delta > 0 THEN
    v_da_vincolati := public.dr7_wallet_consuma_vincolato(v_user_id, v_delta, NEW.service_type, NEW.id);
  ELSE
    v_da_vincolati := - public.dr7_wallet_restituisci_vincolato(v_user_id, -v_delta, NEW.id);
  END IF;

  v_delta_libero := round(v_delta - v_da_vincolati, 2);

  -- (g2) Movimento sul saldo libero. La riga si blocca: due salvataggi in
  --      parallelo non possono spendere lo stesso credito.
  SELECT balance INTO v_saldo
    FROM public.user_credit_balance
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_saldo IS NULL THEN
    v_saldo := 0;
    INSERT INTO public.user_credit_balance (user_id, balance, last_updated)
         VALUES (v_user_id, 0, now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  v_nuovo_saldo := round(v_saldo - v_delta_libero, 2);

  -- Saldo insufficiente: SI RIFIUTA. Regola della direzione (15/09/2026):
  -- una prenotazione non puo' essere pagata con un credito che non c'e'. Il
  -- gestionale mostra il popup prima di arrivare qui, ma il salvataggio passa
  -- da molte schermate (Da Saldare > segna pagato, check-out, estensioni,
  -- import, SQL a mano): questa e' l'ultima porta, ed e' chiusa per tutte.
  --
  -- E' l'UNICO caso in cui questo trigger fa fallire una scrittura su bookings.
  -- Il codice DR7WL lo distingue da qualunque altro errore: sotto, nel blocco
  -- EXCEPTION, viene rilanciato invece di essere trasformato in un warning.
  IF v_nuovo_saldo < 0 AND v_delta_libero > 0 THEN
    -- Nel messaggio va il credito che il cliente puo' davvero spendere QUI:
    -- saldo libero piu' i lotti vincolati validi per questo servizio. Un
    -- credito "solo Lavaggio" non e' disponibile per un noleggio, e dirlo
    -- disponibile manderebbe l'operatore a cercare un errore che non c'e'.
    v_disponibile := round(v_saldo + v_da_vincolati, 2);
    RAISE EXCEPTION 'Credito Wallet insufficiente: su questo servizio il cliente ha % EUR e ne servono %. Scegli un altro metodo di pagamento oppure ricarica il wallet.',
      to_char(v_disponibile, 'FM999999990.00'), to_char(v_delta, 'FM999999990.00')
      USING ERRCODE = 'DR7WL';
  END IF;

  UPDATE public.user_credit_balance
     SET balance = v_nuovo_saldo,
         last_updated = now()
   WHERE user_id = v_user_id;

  v_riferimento := 'DR7-' || upper(substring(NEW.id::text, 1, 8));
  IF v_delta > 0 THEN
    v_descrizione := 'Prenotazione ' || v_riferimento
                     || coalesce(' - ' || nullif(btrim(coalesce(NEW.vehicle_name, NEW.service_name, '')), ''), '')
                     || CASE WHEN v_da_vincolati > 0
                             THEN ' (di cui ' || to_char(v_da_vincolati, 'FM999999990.00') || ' EUR di credito vincolato)'
                             ELSE '' END;
  ELSE
    v_descrizione := 'Storno prenotazione ' || v_riferimento;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type, service_type, created_at
  ) VALUES (
    v_user_id,
    CASE WHEN v_delta > 0 THEN 'debit' ELSE 'credit' END,
    abs(v_delta),
    v_nuovo_saldo,
    v_descrizione,
    NEW.id,
    CASE WHEN v_delta > 0 THEN 'booking_payment' ELSE 'booking_refund' END,
    NEW.service_type,
    now()
  );

  RETURN NEW;

EXCEPTION
  WHEN SQLSTATE 'DR7WL' THEN
    -- Credito insufficiente: e' una risposta, non un guasto. Deve arrivare
    -- all'operatore cosi' com'e' ed impedire il salvataggio.
    RAISE;
  WHEN OTHERS THEN
    -- Tutto il resto: un problema sul wallet non puo' impedire di salvare una
    -- prenotazione. Si scrive nel log e si va avanti.
    RAISE WARNING '[wallet] sincronizzazione fallita per la prenotazione %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;
