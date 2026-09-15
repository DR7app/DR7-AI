-- ============================================================================
-- ADDEBITO AUTOMATICO DAL CREDIT WALLET (15/09/2026)
--
-- Problema risolto: una prenotazione salvata dal gestionale con metodo di
-- pagamento "Credit Wallet" registrava l'incasso ma NON toccava il wallet del
-- cliente. Il saldo restava intero, la spesa non compariva nel movimento
-- crediti e il credito risultava spendibile due volte.
--
-- Da qui in avanti l'addebito lo fa il DATABASE, su `bookings`, per ogni
-- strada: gestionale (Noleggio, Mare, Aria, Soggiorni, Lavaggio, Meccanica),
-- sito, cron, correzioni SQL a mano. Nessuna schermata puo' dimenticarselo.
--
-- Come funziona
--   importo dovuto  = totale se la prenotazione e' pagata, acconto se parziale,
--                     0 se il metodo non e' il wallet.
--   gia' addebitato = somma dei movimenti `credit_transactions` collegati a
--                     QUESTA prenotazione (reference_id = bookings.id).
--   differenza      = dovuto - gia' addebitato. Positiva -> si addebita,
--                     negativa -> si restituisce.
-- Rieseguire il salvataggio dieci volte non cambia nulla: la differenza e' 0.
--
-- Tre regole di prudenza, tutte volute:
--   1. Non si restituisce mai denaro che non risulta prelevato. Le vecchie
--      prenotazioni marcate "Credit Wallet" ma mai addebitate (il bug) non
--      generano un accredito fantasma se l'operatore cambia metodo.
--   2. Se il sito ha gia' addebitato il wallet un istante prima di creare la
--      prenotazione (CarBookingWizard, Lavaggio, Carrello, Tour), il movimento
--      viene ADOTTATO: gli si scrive sopra il reference_id della prenotazione
--      invece di addebitare una seconda volta. Effetto collaterale utile: da
--      oggi quel movimento e' collegato al cliente E alla sua prenotazione.
--   3. Qualsiasi errore qui dentro non fa fallire la prenotazione: l'eccezione
--      viene catturata e trasformata in un WARNING. Un trigger sulla tabella
--      delle prenotazioni non puo' impedire di prenotare.
--
-- Gift card ESCLUSA di proposito: in DR7 e' un codice sconto
-- (DiscountCodeGeneratorModal, code_type 'gift_card'), non credito del wallet.
-- ============================================================================

-- ── 0. Colonne e indici di appoggio ─────────────────────────────────────────
-- `service_type` la scrive gia' book_with_credits: la garantiamo per poterla
-- valorizzare sempre. L'indice serve alla somma "gia' addebitato", che gira su
-- ogni salvataggio di prenotazione pagata col wallet.
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS reference_type TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS service_type TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference_id
    ON public.credit_transactions (reference_id)
    WHERE reference_id IS NOT NULL;

-- ── 1. Il metodo di pagamento e' il Credit Wallet? ──────────────────────────
-- Le etichette arrivano dalla Centralina Pro, quindi la stessa cosa e' scritta
-- in almeno cinque modi: "Credit Wallet", "credit_wallet", "Wallet", "credit",
-- "Credito". Si normalizza e si guarda per parole intere.
--
-- ATTENZIONE all'ordine dei controlli: "Carta di Credito" contiene "credito" ma
-- e' una carta. La carta esce PRIMA che si guardi la parola "credito".
CREATE OR REPLACE FUNCTION public.dr7_metodo_e_credit_wallet(p_metodo TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  v := lower(coalesce(p_metodo, ''));
  IF btrim(v) = '' THEN
    RETURN false;
  END IF;
  -- Ogni segno non alfanumerico diventa spazio: "credit_wallet" -> "credit wallet".
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := ' ' || btrim(regexp_replace(v, '\s+', ' ', 'g')) || ' ';

  -- Gift card: codice sconto, non wallet.
  IF v LIKE '% gift %' OR v LIKE '% giftcard %' THEN
    RETURN false;
  END IF;
  IF v LIKE '% wallet %' THEN
    RETURN true;
  END IF;
  -- Carta di Credito / Carta Punti / Card: non sono il wallet.
  IF v LIKE '% carta %' OR v LIKE '% card %' THEN
    RETURN false;
  END IF;
  IF v LIKE '% credit %' OR v LIKE '% credito %' OR v LIKE '% crediti %' THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.dr7_metodo_e_credit_wallet(TEXT) IS
    'true se l''etichetta del metodo di pagamento indica il Credit Wallet. Gift card e carte escluse.';

-- ── 2. Quanto deve uscire dal wallet per questa prenotazione ────────────────
-- Pagata -> il totale. Parziale -> l''acconto incassato. Tutto il resto -> 0.
-- Gli importi in `bookings` sono in CENTESIMI, il wallet lavora in EURO.
CREATE OR REPLACE FUNCTION public.dr7_wallet_importo_dovuto(
  p_metodo TEXT,
  p_stato_pagamento TEXT,
  p_price_total BIGINT,
  p_amount_paid BIGINT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_stato TEXT;
BEGIN
  IF NOT public.dr7_metodo_e_credit_wallet(p_metodo) THEN
    RETURN 0;
  END IF;
  v_stato := lower(btrim(coalesce(p_stato_pagamento, '')));
  IF v_stato IN ('paid', 'succeeded', 'completed', 'pagato') THEN
    RETURN round(coalesce(p_price_total, 0)::numeric / 100.0, 2);
  END IF;
  IF v_stato IN ('partial', 'parziale') THEN
    RETURN round(coalesce(p_amount_paid, 0)::numeric / 100.0, 2);
  END IF;
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.dr7_wallet_importo_dovuto(TEXT, TEXT, BIGINT, BIGINT) IS
    'Euro da addebitare al Credit Wallet per una prenotazione: totale se pagata, acconto se parziale, 0 altrimenti.';

-- ── 3. Il trigger ───────────────────────────────────────────────────────────
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
  v_user_id := NEW.user_id;
  IF v_user_id IS NULL AND coalesce(NEW.customer_email, '') <> '' THEN
    SELECT ce.user_id INTO v_user_id
      FROM public.customers_extended ce
     WHERE lower(ce.email) = lower(NEW.customer_email)
       AND ce.user_id IS NOT NULL
     LIMIT 1;
  END IF;

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

  -- (g) Movimento. La riga del saldo si blocca: due salvataggi in parallelo
  --     non possono spendere lo stesso credito.
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

  v_nuovo_saldo := round(v_saldo - v_delta, 2);

  -- Saldo insufficiente: si addebita lo stesso e il wallet va in rosso.
  -- Non esistono blocchi duri nel gestionale: il controllo (con OTP) sta nella
  -- schermata, qui si registra il debito invece di perderlo.
  IF v_nuovo_saldo < 0 THEN
    RAISE WARNING '[wallet] prenotazione %: saldo insufficiente, wallet del cliente % va a %', NEW.id, v_user_id, v_nuovo_saldo;
  END IF;

  UPDATE public.user_credit_balance
     SET balance = v_nuovo_saldo,
         last_updated = now()
   WHERE user_id = v_user_id;

  v_riferimento := 'DR7-' || upper(substring(NEW.id::text, 1, 8));
  IF v_delta > 0 THEN
    v_descrizione := 'Prenotazione ' || v_riferimento
                     || coalesce(' - ' || nullif(btrim(coalesce(NEW.vehicle_name, NEW.service_name, '')), ''), '');
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

EXCEPTION WHEN OTHERS THEN
  -- Regola non negoziabile: un problema sul wallet non puo' impedire di
  -- salvare una prenotazione. Si scrive nel log e si va avanti.
  RAISE WARNING '[wallet] sincronizzazione fallita per la prenotazione %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.dr7_wallet_sync_prenotazione() IS
    'Allinea il Credit Wallet del cliente all''importo pagato sulla prenotazione. Idempotente: lavora sulla differenza fra dovuto e gia'' addebitato.';

DROP TRIGGER IF EXISTS trg_dr7_wallet_sync_prenotazione ON public.bookings;
CREATE TRIGGER trg_dr7_wallet_sync_prenotazione
    AFTER INSERT OR UPDATE ON public.bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.dr7_wallet_sync_prenotazione();
