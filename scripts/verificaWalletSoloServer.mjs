#!/usr/bin/env node
/**
 * verificaWalletSoloServer.mjs — prova su un Postgres vero, in memoria, che
 * dal browser non si possono piu' creare soldi sul Credit Wallet (29/09/2026).
 *
 *   npm run wallet:server
 *
 * Si gira con i ruoli veri di Supabase (anon / authenticated / service_role)
 * e RLS attivo: il cliente non si accredita niente, non tocca il wallet di un
 * altro, non si alza il saldo, non chiude da solo una ricarica; lo staff e il
 * server continuano a lavorare. Le funzioni deduct_credits e add_credits sono
 * copiate dalla produzione.
 */

let PGlite
try {
  ;({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  console.error('Serve @electric-sql/pglite. Installalo con:\n  npm i -D @electric-sql/pglite')
  process.exit(1)
}
import fs from 'node:fs'

const db = new PGlite()
const leggi = (f) => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' // cliente
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' // altro cliente
const S = 'cccccccc-cccc-cccc-cccc-cccccccccccc' // operatore del gestionale

await db.exec(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role' $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.admins (user_id uuid, archived_at timestamptz, role text, permissions jsonb DEFAULT '[]');
INSERT INTO public.admins (user_id) VALUES ('${S}');
CREATE FUNCTION public.dr7_is_direzione() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
CREATE FUNCTION public.dr7_is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid() and a.archived_at is null) or public.dr7_is_direzione();
$$;

CREATE TABLE public.user_credit_balance (
  user_id uuid PRIMARY KEY, balance numeric(10,2) NOT NULL DEFAULT 0, last_updated timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, transaction_type text NOT NULL,
  amount numeric(10,2) NOT NULL, balance_after numeric(10,2) NOT NULL, description text NOT NULL,
  reference_id uuid, reference_type text, created_at timestamptz NOT NULL DEFAULT now(), service_type text);
CREATE TABLE public.credit_wallet_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, recharge_amount numeric, received_amount numeric,
  payment_status text, nexi_order_id text);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- Policy come in produzione il 29/09/2026 (prima della migrazione)
ALTER TABLE public.user_credit_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_wallet_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access on user_credit_balance" ON public.user_credit_balance FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can insert own balance" ON public.user_credit_balance FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own balance" ON public.user_credit_balance FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own balance" ON public.user_credit_balance FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admin full access on credit_transactions" ON public.credit_transactions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can insert own transactions" ON public.credit_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own transactions" ON public.credit_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admin full access on credit_wallet_purchases" ON public.credit_wallet_purchases FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can insert own purchases" ON public.credit_wallet_purchases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own purchases" ON public.credit_wallet_purchases FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own purchases" ON public.credit_wallet_purchases FOR SELECT USING (auth.uid() = user_id);

-- Funzioni come in produzione
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id uuid, p_amount numeric, p_description text, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT 'purchase'::text)
 RETURNS TABLE(success boolean, new_balance numeric, error_message text) LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_current_balance NUMERIC; v_new_balance NUMERIC;
BEGIN
  SELECT balance INTO v_current_balance FROM user_credit_balance WHERE user_id = p_user_id FOR UPDATE;
  v_new_balance := coalesce(v_current_balance, 0) + p_amount;
  INSERT INTO user_credit_balance (user_id, balance) VALUES (p_user_id, v_new_balance)
    ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance;
  INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type)
  VALUES (p_user_id, 'credit', p_amount, v_new_balance, p_description, p_reference_id::uuid, p_reference_type);
  RETURN QUERY SELECT true, v_new_balance, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id uuid, p_amount numeric, p_description text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_type text DEFAULT 'purchase'::text)
 RETURNS TABLE(success boolean, new_balance numeric, error_message text) LANGUAGE sql SECURITY DEFINER
AS $function$ SELECT * FROM public.add_credits(p_user_id, p_amount, p_description, p_reference_id::text, p_reference_type); $function$;

CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid, p_amount numeric, p_description text, p_reference_id uuid DEFAULT NULL::uuid, p_transaction_type text DEFAULT 'booking_payment'::text)
 RETURNS TABLE(success boolean, new_balance numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    v_current_balance NUMERIC;
    v_new_balance NUMERIC;
  BEGIN
    SELECT balance INTO v_current_balance
    FROM user_credit_balance
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
      RETURN QUERY SELECT false, 0::NUMERIC, 'Wallet non trovato'::TEXT;
      RETURN;
    END IF;

    IF v_current_balance < p_amount THEN
      RETURN QUERY SELECT false, v_current_balance, 'Credito insufficiente'::TEXT;
      RETURN;
    END IF;

    v_new_balance := v_current_balance - p_amount;

    UPDATE user_credit_balance
    SET balance = v_new_balance, last_updated = NOW()
    WHERE user_id = p_user_id;

    INSERT INTO credit_transactions (user_id, transaction_type, amount, description, reference_id, balance_after)
    VALUES (p_user_id, 'debit', p_amount, p_description, p_reference_id, v_new_balance);

    RETURN QUERY SELECT true, v_new_balance, NULL::TEXT;
  END;
  $function$;

-- book_with_credits: stessa firma e stesso schema (DECLARE / BEGIN /
-- EXCEPTION che rilancia), corpo ridotto all'addebito.
CREATE OR REPLACE FUNCTION public.book_with_credits(p_user_id uuid, p_amount_cents integer, p_vehicle_name text, p_booking_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$

DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE user_credit_balance SET balance = balance - p_amount_cents / 100.0
   WHERE user_id = p_user_id RETURNING balance INTO v_new_balance;
  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Prenotazione fallita: %', SQLERRM;
END;

$function$;

CREATE FUNCTION public.grant_welcome_bonus(p_user_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
CREATE FUNCTION public.grant_referral_bonus(uuid, uuid, numeric) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
CREATE FUNCTION public.dr7_wallet_consuma_vincolato(uuid, numeric, text, uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.dr7_wallet_restituisci_vincolato(uuid, numeric, uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;

INSERT INTO public.user_credit_balance VALUES ('${A}', 100, now()), ('${B}', 500, now());
`)

const saldo = async (u) => Number((await db.query(`SELECT balance FROM public.user_credit_balance WHERE user_id='${u}'`)).rows[0].balance)

// Esegue sql come un certo utente; ritorna { righe, errore }.
async function come(chi, sql) {
  const ruolo = chi === 'anon' ? 'anon' : chi === 'server' ? 'service_role' : 'authenticated'
  const claims = chi === 'anon' ? { role: 'anon' } : chi === 'server' ? { role: 'service_role' } : { sub: chi, role: 'authenticated' }
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE ${ruolo}; SELECT set_config('request.jwt.claims', '${JSON.stringify(claims)}', true);`)
    const r = await db.query(sql)
    await db.exec('COMMIT')
    return { righe: r.rows, toccate: r.affectedRows ?? 0, errore: null }
  } catch (e) {
    await db.exec('ROLLBACK')
    return { righe: [], toccate: 0, errore: e.message }
  }
}

// ---------- PRIMA: la faille c'era davvero ----------
let r = await come(A, `SELECT * FROM add_credits('${A}'::uuid, 5000::numeric, 'regalo', NULL::text, 'x')`)
ok(!r.errore && await saldo(A) === 5100, 'prima: il cliente si accreditava 5000 EUR da solo')
r = await come(A, `UPDATE user_credit_balance SET balance = 99999 WHERE user_id = '${B}'`)
ok(await saldo(B) === 99999, "prima: il cliente riscriveva il saldo di un ALTRO cliente")
await db.exec(`UPDATE user_credit_balance SET balance = 100 WHERE user_id='${A}'; UPDATE user_credit_balance SET balance = 500 WHERE user_id='${B}'; DELETE FROM credit_transactions;`)

await db.exec(leggi('20260929_wallet_solo_dal_server.sql'))

// ---------- DOPO: cliente ----------
r = await come(A, `SELECT * FROM add_credits('${A}'::uuid, 5000::numeric, 'regalo', NULL::text, 'x')`)
ok(/permission denied/.test(r.errore || ''), 'cliente: add_credits rifiutata')
r = await come('anon', `SELECT * FROM add_credits('${A}'::uuid, 5000::numeric, 'regalo', NULL::text, 'x')`)
ok(/permission denied/.test(r.errore || ''), 'non loggato: add_credits rifiutata')
r = await come(A, `UPDATE user_credit_balance SET balance = 99999 WHERE user_id = '${A}'`)
ok(await saldo(A) === 100, 'cliente: non si alza il proprio saldo')
r = await come(A, `UPDATE user_credit_balance SET balance = 0 WHERE user_id = '${B}'`)
ok(await saldo(B) === 500, "cliente: non tocca il saldo di un altro")
r = await come(A, `INSERT INTO user_credit_balance (user_id, balance) VALUES (gen_random_uuid(), 1000)`)
ok(!!r.errore, 'cliente: non si crea un saldo')
r = await come(A, `INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description) VALUES ('${A}', 'credit', 1000, 1100, 'x')`)
ok(!!r.errore, 'cliente: non scrive movimenti')
r = await come(A, `SELECT * FROM deduct_credits('${B}'::uuid, 50::numeric, 'furto', NULL::uuid, 'x')`)
ok(/altro account/.test(r.errore || '') && await saldo(B) === 500, "cliente: non addebita il wallet di un altro")
r = await come(A, `SELECT book_with_credits('${B}'::uuid, 5000, 'X', '{}'::jsonb)`)
ok(!!r.errore && await saldo(B) === 500, "cliente: non prenota col wallet di un altro")
r = await come('anon', `SELECT * FROM deduct_credits('${B}'::uuid, 50::numeric, 'furto', NULL::uuid, 'x')`)
ok(/permission denied/.test(r.errore || ''), 'non loggato: deduct_credits rifiutata')
r = await come(A, `SELECT * FROM deduct_credits('${A}'::uuid, 30::numeric, 'lavaggio', NULL::uuid, 'x')`)
ok(!r.errore && r.righe[0].success === true && await saldo(A) === 70, 'cliente: paga col PROPRIO wallet')
r = await come(A, `SELECT book_with_credits('${A}'::uuid, 2000, 'X', '{}'::jsonb)`)
ok(!r.errore && await saldo(A) === 50, 'cliente: prenota col PROPRIO wallet')
r = await come(A, `SELECT balance FROM user_credit_balance`)
ok(r.righe.length === 1 && Number(r.righe[0].balance) === 50, 'cliente: vede solo il proprio saldo')

// ---------- DOPO: ricariche ----------
r = await come(A, `INSERT INTO credit_wallet_purchases (user_id, recharge_amount, received_amount, payment_status) VALUES ('${A}', 100, 110, 'pending') RETURNING id`)
ok(!r.errore, 'cliente: prepara una ricarica pending')
const idRic = r.righe[0].id
r = await come(A, `UPDATE credit_wallet_purchases SET nexi_order_id = 'DR7X' WHERE id = '${idRic}'`)
ok(!r.errore && r.toccate === 1, "cliente: ci scrive l'ordine Nexi")
r = await come(A, `UPDATE credit_wallet_purchases SET payment_status = 'succeeded' WHERE id = '${idRic}'`)
ok(!!r.errore, 'cliente: NON chiude da solo la ricarica')
r = await come(A, `INSERT INTO credit_wallet_purchases (user_id, recharge_amount, payment_status) VALUES ('${A}', 5000, 'succeeded')`)
ok(!!r.errore, 'cliente: NON crea una ricarica gia pagata')
r = await come(A, `INSERT INTO credit_wallet_purchases (user_id, recharge_amount, payment_status) VALUES ('${B}', 5000, 'pending')`)
ok(!!r.errore, 'cliente: NON crea ricariche a nome di altri')
r = await come(A, `DELETE FROM credit_wallet_purchases WHERE id = '${idRic}'`)
ok(!r.errore && r.toccate === 1, 'cliente: toglie la propria ricarica pending (checkout fallito)')

// ---------- DOPO: staff e server ----------
r = await come(S, `UPDATE user_credit_balance SET balance = 600 WHERE user_id = '${B}'`)
ok(!r.errore && await saldo(B) === 600, 'staff del gestionale: continua a lavorare sui saldi')
r = await come(S, `SELECT * FROM deduct_credits('${B}'::uuid, 100::numeric, 'ufficio', NULL::uuid, 'x')`)
ok(!r.errore && await saldo(B) === 500, 'staff: addebita il wallet di un cliente')
r = await come('server', `SELECT * FROM add_credits('${A}'::uuid, 10::numeric, 'bonus club', NULL::text, 'club_signup_bonus')`)
ok(!r.errore && r.righe[0].success === true && await saldo(A) === 60, 'server: accredita')
r = await come('server', `SELECT * FROM deduct_credits('${B}'::uuid, 10::numeric, 'cron', NULL::uuid, 'x')`)
ok(!r.errore && await saldo(B) === 490, 'server: addebita')

// ---------- Idempotenza della migrazione ----------
await db.exec(leggi('20260929_wallet_solo_dal_server.sql'))
const def = (await db.query(`SELECT pg_get_functiondef('public.deduct_credits(uuid,numeric,text,uuid,text)'::regprocedure) d`)).rows[0].d
ok((def.match(/dr7_wallet_solo_proprio/g) || []).length === 1, 'migrazione rilanciata: controllo inserito una volta sola')

console.log('\nTutti i controlli passati.')
