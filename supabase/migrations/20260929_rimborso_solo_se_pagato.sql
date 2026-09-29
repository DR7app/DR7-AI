-- Rimborso sul Credit Wallet solo per prenotazioni PAGATE (29/09/2026)
--
-- Incidente: un cliente simula un preventivo sul sito, la prenotazione resta
-- "unpaid" (link Nexi mai pagato), la annulla da "Le mie prenotazioni" e il
-- sito gli accredita il 90% del prezzo (704,62 EUR) come rimborso DR7 Flex.
-- Il codice del sito calcolava il rimborso su price_total senza guardare se
-- qualcosa era stato incassato.
--
-- Il controllo sta qui, nel database, perche' i rimborsi partono da piu'
-- strade (sito, add_credits RPC, inserimenti diretti): qualunque riga di
-- rimborso legata a una prenotazione viene rifiutata se
--   1. la prenotazione non e' pagata (paid / succeeded / completed), oppure
--   2. la somma dei rimborsi supererebbe il totale della prenotazione.
--
-- Non tocca: rimborsi senza prenotazione (carrello/tour falliti, reference_id
-- nullo o non in bookings), accrediti manuali dell'ufficio (admin_manual),
-- bonus, ricariche.
-- add_credits intercetta l'eccezione e risponde success=false, quindi saldo
-- e movimento restano entrambi invariati.

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

  SELECT coalesce(sum(ct.amount), 0)
    INTO v_gia
    FROM public.credit_transactions ct
   WHERE ct.reference_id::text = NEW.reference_id::text
     AND ct.transaction_type = 'credit'
     AND ct.reference_type IN ('refund', 'booking_cancellation_refund');

  IF v_gia + NEW.amount > v_totale + 0.01 THEN
    RAISE EXCEPTION 'Rimborso rifiutato: % EUR gia'' rimborsati + % EUR superano il totale % EUR della prenotazione %',
      v_gia, NEW.amount, v_totale, NEW.reference_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dr7_rimborso_solo_se_pagato ON public.credit_transactions;
CREATE TRIGGER trg_dr7_rimborso_solo_se_pagato
  BEFORE INSERT ON public.credit_transactions
  FOR EACH ROW EXECUTE FUNCTION public.dr7_rimborso_solo_se_pagato();

-- add_credits (versione testo): inseriva p_reference_id TEXT nella colonna
-- uuid e falliva SEMPRE quando si passava una prenotazione. Il sito allora
-- ripiegava su una scrittura diretta in due passi (saldo, poi movimento):
-- e' da li' che e' passato l'accredito del 29/09. Con il cast la RPC torna
-- l'unica strada, atomica, e il controllo sopra ne annulla saldo e movimento.
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id uuid, p_amount numeric, p_description text, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT 'purchase'::text)
 RETURNS TABLE(success boolean, new_balance numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_existing_id UUID;
BEGIN
  -- Lock row to prevent race conditions
  SELECT balance INTO v_current_balance
  FROM user_credit_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- IDEMPOTENZA: stessa (user, reference_id, reference_type) gia' accreditata?
  IF p_reference_id IS NOT NULL AND p_reference_type IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM credit_transactions
    WHERE user_id = p_user_id
      AND transaction_type = 'credit'
      AND reference_id::text = p_reference_id
      AND reference_type = p_reference_type
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT true, COALESCE(v_current_balance, 0::NUMERIC), NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  IF v_current_balance IS NULL THEN
    v_new_balance := p_amount;
    INSERT INTO user_credit_balance (user_id, balance, last_updated)
    VALUES (p_user_id, v_new_balance, NOW());
  ELSE
    v_new_balance := v_current_balance + p_amount;
    UPDATE user_credit_balance
    SET balance = v_new_balance, last_updated = NOW()
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type, created_at)
  VALUES (p_user_id, 'credit', p_amount, v_new_balance, p_description, p_reference_id::uuid, p_reference_type, NOW());

  RETURN QUERY SELECT true, v_new_balance, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$;
