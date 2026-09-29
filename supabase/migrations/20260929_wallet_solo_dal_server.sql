-- Credit Wallet: niente piu' soldi scritti dal browser (29/09/2026)
--
-- Stato trovato il 29/09/2026:
--   * add_credits / deduct_credits / book_with_credits / grant_* erano
--     eseguibili da anon e authenticated, per QUALUNQUE p_user_id: dalla
--     console del sito ci si poteva accreditare qualsiasi cifra, o svuotare il
--     wallet di un altro cliente;
--   * le policy "Admin full access" su user_credit_balance,
--     credit_transactions e credit_wallet_purchases controllavano solo
--     auth.role() = 'authenticated': ogni cliente loggato poteva riscrivere
--     saldi e ricariche di tutti; "Users can update own balance" permetteva di
--     alzarsi il saldo da solo.
--
-- Dopo questa migrazione:
--   * accreditare (add_credits, bonus) = solo server (service_role) e le
--     funzioni SECURITY DEFINER del database (trigger wallet, referral,
--     book_with_credits), che girano come proprietario;
--   * addebitare dal sito (deduct_credits, book_with_credits) = solo il
--     PROPRIO wallet; lo staff del gestionale resta libero (dr7_is_staff);
--   * tabelle: il cliente legge le sue righe, crea/aggiorna/cancella solo
--     ricariche ancora 'pending' (il server ricalcola gli importi da Nexi e dal
--     CMS: vedi Sito/netlify/functions/utils/ricaricaWallet.js); lo staff
--     (dr7_is_staff: admins attivi + direzione) fa tutto; il server bypassa.
--
-- Da applicare DOPO il deploy del sito che smette di chiamare add_credits dal
-- browser (DR7app/Sito, 29/09/2026), altrimenti ricariche e annullamenti dal
-- vecchio codice fallirebbero. Prova: npm run wallet:server (PGlite).

-- 1. Solo il proprio wallet ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.dr7_wallet_solo_proprio(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
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

  -- Server e SQL a mano: nessun utente del sito dietro.
  IF v_ruolo = 'service_role' THEN RETURN; END IF;
  IF v_ruolo = '' AND auth.uid() IS NULL THEN RETURN; END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = p_user_id THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND public.dr7_is_staff() THEN RETURN; END IF;

  RAISE EXCEPTION 'Operazione non consentita sul Credit Wallet di un altro account'
    USING ERRCODE = '42501';
END;
$$;

-- 2. Il controllo entra come prima istruzione di deduct_credits e
--    book_with_credits. Si riscrive la definizione viva invece di copiarla qui:
--    il corpo (credito vincolato, messaggi) resta esattamente quello in
--    produzione. Idempotente.
DO $$
DECLARE
  v_fn  regprocedure;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.deduct_credits(uuid,numeric,text,uuid,text)'::regprocedure,
    'public.book_with_credits(uuid,integer,text,jsonb)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position('dr7_wallet_solo_proprio' IN v_def) = 0 THEN
      v_def := regexp_replace(v_def, '\mBEGIN\M',
        E'BEGIN\n  PERFORM public.dr7_wallet_solo_proprio(p_user_id);');
      EXECUTE v_def;
    END IF;
  END LOOP;
END;
$$;

-- 3. Chi puo' chiamare cosa ---------------------------------------------------
REVOKE ALL ON FUNCTION public.add_credits(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_credits(uuid, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_welcome_bonus(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_referral_bonus(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dr7_wallet_consuma_vincolato(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dr7_wallet_restituisci_vincolato(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(uuid, numeric, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credits(uuid, numeric, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_welcome_bonus(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_referral_bonus(uuid, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_consuma_vincolato(uuid, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_restituisci_vincolato(uuid, numeric, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.deduct_credits(uuid, numeric, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.book_with_credits(uuid, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dr7_wallet_solo_proprio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, numeric, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.book_with_credits(uuid, integer, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_solo_proprio(uuid) TO authenticated, service_role;

-- 4. Tabelle ------------------------------------------------------------------
-- user_credit_balance: il cliente legge il suo saldo, non lo scrive mai.
DROP POLICY IF EXISTS "Admin full access on user_credit_balance" ON public.user_credit_balance;
DROP POLICY IF EXISTS "Users can insert own balance" ON public.user_credit_balance;
DROP POLICY IF EXISTS "Users can update own balance" ON public.user_credit_balance;
DROP POLICY IF EXISTS "Staff full access on user_credit_balance" ON public.user_credit_balance;
CREATE POLICY "Staff full access on user_credit_balance" ON public.user_credit_balance
  FOR ALL TO authenticated
  USING (public.dr7_is_staff()) WITH CHECK (public.dr7_is_staff());

-- credit_transactions: il cliente legge i suoi movimenti, non li scrive mai.
DROP POLICY IF EXISTS "Admin full access on credit_transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Staff full access on credit_transactions" ON public.credit_transactions;
CREATE POLICY "Staff full access on credit_transactions" ON public.credit_transactions
  FOR ALL TO authenticated
  USING (public.dr7_is_staff()) WITH CHECK (public.dr7_is_staff());

-- credit_wallet_purchases: il cliente prepara la sua ricarica ('pending'),
-- ci scrive il numero d'ordine Nexi e la puo' togliere se il checkout fallisce.
-- A chiuderla ('succeeded') e' solo il server.
DROP POLICY IF EXISTS "Admin full access on credit_wallet_purchases" ON public.credit_wallet_purchases;
DROP POLICY IF EXISTS "Users can insert own purchases" ON public.credit_wallet_purchases;
DROP POLICY IF EXISTS "Users can update own purchases" ON public.credit_wallet_purchases;
DROP POLICY IF EXISTS "Staff full access on credit_wallet_purchases" ON public.credit_wallet_purchases;
DROP POLICY IF EXISTS "Users insert own pending purchases" ON public.credit_wallet_purchases;
DROP POLICY IF EXISTS "Users update own pending purchases" ON public.credit_wallet_purchases;
DROP POLICY IF EXISTS "Users delete own pending purchases" ON public.credit_wallet_purchases;
CREATE POLICY "Staff full access on credit_wallet_purchases" ON public.credit_wallet_purchases
  FOR ALL TO authenticated
  USING (public.dr7_is_staff()) WITH CHECK (public.dr7_is_staff());
CREATE POLICY "Users insert own pending purchases" ON public.credit_wallet_purchases
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND payment_status = 'pending');
CREATE POLICY "Users update own pending purchases" ON public.credit_wallet_purchases
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND payment_status = 'pending')
  WITH CHECK (user_id = auth.uid() AND payment_status = 'pending');
CREATE POLICY "Users delete own pending purchases" ON public.credit_wallet_purchases
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND payment_status = 'pending');

-- 5. Verifica -----------------------------------------------------------------
SELECT p.oid::regprocedure AS funzione,
       has_function_privilege('anon', p.oid, 'execute') AS anon,
       has_function_privilege('authenticated', p.oid, 'execute') AS authenticated,
       position('dr7_wallet_solo_proprio' IN pg_get_functiondef(p.oid)) > 0 AS solo_proprio
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('add_credits', 'deduct_credits', 'book_with_credits', 'grant_welcome_bonus', 'grant_referral_bonus',
                     'dr7_wallet_consuma_vincolato', 'dr7_wallet_restituisci_vincolato')
 ORDER BY 1;
