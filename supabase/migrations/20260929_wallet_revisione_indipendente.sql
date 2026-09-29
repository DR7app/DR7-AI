-- Credit Wallet: correzioni dalla revisione indipendente (29/09/2026)
--
-- 1. Un ordine Nexi = una sola ricarica. Senza vincolo, un cliente poteva
--    scrivere in una sua ricarica 'pending' il numero di un ordine gia' pagato
--    e farsi accreditare di nuovo (il server ora controlla anche in
--    utils/ricaricaWallet.js; questo e' il muro nel database).
-- 2. bookings e' ancora scrivibile dai clienti (fase 2 RLS da fare). Fino ad
--    allora un cliente (non staff, non server) NON puo':
--      - cambiare user_id: ci si "prendeva" la prenotazione pagata col wallet
--        di un altro e il rimborso finiva sul proprio wallet;
--      - riaprire una prenotazione annullata;
--      - abbassare price_total di una prenotazione pagata: il trigger del
--        wallet stornava la differenza (rimborso senza annullare).
--    Il sito non fa nessuna di queste tre cose (verificato nel codice).
-- 3. Il tetto dei rimborsi conta anche gli storni del trigger (booking_refund).
-- 4. add_credits: primo accredito di un cliente senza riga saldo. Due chiamate
--    in parallelo (pagina + webhook) tentavano entrambe l'INSERT: la seconda
--    falliva. Ora la riga si crea prima, poi si blocca.

-- 1 ------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_wallet_purchases_nexi_order
  ON public.credit_wallet_purchases (nexi_order_id)
  WHERE nexi_order_id IS NOT NULL;

-- 2 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dr7_prenotazione_modifiche_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ruolo text;
BEGIN
  v_ruolo := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role',
    '');
  -- Server, cron, SQL a mano e operatori del gestionale: nessun limite qui.
  IF v_ruolo = 'service_role' OR auth.uid() IS NULL OR public.dr7_is_staff() THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Non e'' possibile cambiare il titolare di una prenotazione' USING ERRCODE = '42501';
  END IF;

  IF lower(coalesce(OLD.status, '')) IN ('cancelled', 'annullata', 'canceled')
     AND lower(coalesce(NEW.status, '')) NOT IN ('cancelled', 'annullata', 'canceled') THEN
    RAISE EXCEPTION 'Una prenotazione annullata non si puo'' riaprire dal sito' USING ERRCODE = '42501';
  END IF;

  IF lower(coalesce(OLD.payment_status, '')) IN ('paid', 'succeeded', 'completed', 'partial', 'parziale')
     AND coalesce(NEW.price_total, 0) < coalesce(OLD.price_total, 0) THEN
    RAISE EXCEPTION 'Il totale di una prenotazione pagata non si puo'' abbassare dal sito' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dr7_prenotazione_modifiche_cliente ON public.bookings;
CREATE TRIGGER trg_dr7_prenotazione_modifiche_cliente
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_prenotazione_modifiche_cliente();

-- 3 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dr7_rimborso_solo_se_pagato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stato     text;
  v_totale    numeric;
  v_gia       numeric;
BEGIN
  IF NEW.transaction_type <> 'credit'
     OR NEW.reference_id IS NULL
     OR coalesce(NEW.reference_type, '') NOT IN ('refund', 'booking_cancellation_refund')
  THEN
    RETURN NEW;
  END IF;

  SELECT lower(coalesce(b.payment_status, '')), coalesce(b.price_total, 0) / 100.0
    INTO v_stato, v_totale
    FROM public.bookings b
   WHERE b.id::text = NEW.reference_id::text;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_stato NOT IN ('paid', 'succeeded', 'completed') THEN
    RAISE EXCEPTION 'Rimborso rifiutato: la prenotazione % non risulta pagata (stato pagamento: %)',
      NEW.reference_id, nullif(v_stato, '')
      USING ERRCODE = 'P0001';
  END IF;

  -- Tutto cio' che e' gia' tornato al cliente per questa prenotazione, compresi
  -- gli storni automatici del trigger del wallet (booking_refund).
  SELECT coalesce(sum(ct.amount), 0)
    INTO v_gia
    FROM public.credit_transactions ct
   WHERE ct.reference_id::text = NEW.reference_id::text
     AND ct.transaction_type = 'credit'
     AND ct.reference_type IN ('refund', 'booking_cancellation_refund', 'booking_refund');

  IF v_gia + NEW.amount > v_totale + 0.01 THEN
    RAISE EXCEPTION 'Rimborso rifiutato: % EUR gia'' rimborsati + % EUR superano il totale % EUR della prenotazione %',
      v_gia, NEW.amount, v_totale, NEW.reference_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- 4 ------------------------------------------------------------------------
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.add_credits(uuid,numeric,text,text,text)'::regprocedure);
  IF position('riga_saldo_prima' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '  -- Lock row to prevent race conditions',
      E'  -- riga_saldo_prima: la riga del saldo esiste sempre prima del lock, cosi''\n  -- due accrediti in parallelo si mettono in fila invece di scontrarsi.\n  INSERT INTO user_credit_balance (user_id, balance, last_updated)\n  VALUES (p_user_id, 0, NOW()) ON CONFLICT (user_id) DO NOTHING;\n\n  -- Lock row to prevent race conditions');
    EXECUTE v_def;
  END IF;
END $$;
