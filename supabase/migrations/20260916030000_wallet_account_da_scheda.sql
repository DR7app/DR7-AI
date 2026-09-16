-- ═══════════════════════════════════════════════════════════════════════════
-- WALLET: TROVARE L'ACCOUNT ANCHE QUANDO user_id E' LA SCHEDA — 16/09/2026
--
-- BUG TROVATO SU UNA PRENOTAZIONE VERA. Il gestionale salva in
-- `bookings.user_id` l'id della SCHEDA CLIENTE (customers_extended.id) — lo fa
-- da sempre, serve al contratto. Il sito, invece, ci mette l'id dell'ACCOUNT
-- (auth.users.id). Il trigger del wallet leggeva quel campo come se fosse
-- sempre un account: su una prenotazione fatta dall'ufficio cercava un saldo
-- con l'id sbagliato, non lo trovava, e l'addebito non avveniva. Il cliente
-- vedeva il credito intatto dopo aver pagato col wallet.
--
-- Ora l'account si cerca in tre passi, in ordine: e' gia' un account? e'
-- l'id di una scheda? altrimenti si va per email, come prima.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dr7_wallet_account_del_cliente(
  p_user_id UUID,
  p_email   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  IF p_user_id IS NOT NULL THEN
    -- 1. E' davvero un account del sito?
    SELECT id INTO v_account FROM auth.users WHERE id = p_user_id;
    IF v_account IS NOT NULL THEN RETURN v_account; END IF;

    -- 2. E' l'id di una scheda cliente: l'account e' quello collegato.
    SELECT ce.user_id INTO v_account
      FROM public.customers_extended ce
     WHERE ce.id = p_user_id AND ce.user_id IS NOT NULL;
    IF v_account IS NOT NULL THEN RETURN v_account; END IF;
  END IF;

  -- 3. Ultima strada: l'email della prenotazione.
  IF coalesce(p_email, '') <> '' THEN
    SELECT ce.user_id INTO v_account
      FROM public.customers_extended ce
     WHERE lower(ce.email) = lower(p_email) AND ce.user_id IS NOT NULL
     LIMIT 1;
  END IF;

  RETURN v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dr7_wallet_account_del_cliente(UUID, TEXT) TO authenticated, service_role;
