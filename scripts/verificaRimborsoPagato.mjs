#!/usr/bin/env node
/**
 * verificaRimborsoPagato.mjs — prova su un Postgres vero, in memoria, che il
 * database rifiuta i rimborsi sul wallet di prenotazioni non pagate (29/09/2026).
 *
 *   npm run wallet:rimborso
 *
 * Caso reale: prenotazione "unpaid" annullata dal sito -> 704,62 EUR accreditati.
 * add_credits e' copiata dalla produzione COM'ERA (inseriva il testo in una
 * colonna uuid e falliva sempre con una prenotazione): la migrazione la
 * corregge. Il rifiuto deve lasciare invariati sia il saldo sia i movimenti.
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

await db.exec(`
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_total bigint,
  payment_status text,
  status text
);
CREATE TABLE public.user_credit_balance (
  user_id uuid PRIMARY KEY,
  balance numeric(10,2) NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_type text NOT NULL,
  amount numeric(10,2) NOT NULL,
  balance_after numeric(10,2) NOT NULL,
  description text NOT NULL,
  reference_id uuid,
  reference_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.add_credits(p_user_id uuid, p_amount numeric, p_description text, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT 'purchase'::text)
 RETURNS TABLE(success boolean, new_balance numeric, error_message text)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_existing_id UUID;
BEGIN
  SELECT balance INTO v_current_balance FROM user_credit_balance WHERE user_id = p_user_id FOR UPDATE;
  IF p_reference_id IS NOT NULL AND p_reference_type IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM credit_transactions
    WHERE user_id = p_user_id AND transaction_type = 'credit'
      AND reference_id::text = p_reference_id AND reference_type = p_reference_type LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT true, COALESCE(v_current_balance, 0::NUMERIC), NULL::TEXT;
      RETURN;
    END IF;
  END IF;
  IF v_current_balance IS NULL THEN
    v_new_balance := p_amount;
    INSERT INTO user_credit_balance (user_id, balance, last_updated) VALUES (p_user_id, v_new_balance, NOW());
  ELSE
    v_new_balance := v_current_balance + p_amount;
    UPDATE user_credit_balance SET balance = v_new_balance, last_updated = NOW() WHERE user_id = p_user_id;
  END IF;
  INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type, created_at)
  VALUES (p_user_id, 'credit', p_amount, v_new_balance, p_description, p_reference_id, p_reference_type, NOW());
  RETURN QUERY SELECT true, v_new_balance, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$;
`)

// Prima della migrazione: add_credits con prenotazione falliva sempre
await db.exec(`INSERT INTO bookings VALUES ('44444444-4444-4444-4444-444444444444', 100, 'paid', 'cancelled');`)
const prima = (await db.query(`SELECT * FROM add_credits('3b896d05-3d65-4819-a46a-ea9894343935', 1, 'x', '44444444-4444-4444-4444-444444444444', 'refund')`)).rows[0]
ok(prima.success === false && /uuid/.test(prima.error_message), 'prima: add_credits con prenotazione falliva (per questo il sito passava dalla strada di riserva)')
await db.exec(`DELETE FROM bookings; DELETE FROM user_credit_balance; DELETE FROM credit_transactions;`)

await db.exec(leggi('20260929_rimborso_solo_se_pagato.sql'))

const U = '3b896d05-3d65-4819-a46a-ea9894343935'
const NON_PAGATA = '72dae362-e437-4246-be69-edb6b4eb2195'
const PAGATA = '11111111-1111-1111-1111-111111111111'
const PAGATA_WALLET = '22222222-2222-2222-2222-222222222222'
const PARZIALE = '33333333-3333-3333-3333-333333333333'

await db.exec(`
INSERT INTO user_credit_balance VALUES ('${U}', 5977.59, now());
INSERT INTO bookings VALUES
  ('${NON_PAGATA}', 78291, 'unpaid', 'cancelled'),
  ('${PAGATA}', 72886, 'paid', 'cancelled'),
  ('${PAGATA_WALLET}', 100, 'succeeded', 'cancelled'),
  ('${PARZIALE}', 50000, 'partial', 'cancelled');
`)

const saldo = async () => Number((await db.query(`SELECT balance FROM user_credit_balance WHERE user_id='${U}'`)).rows[0].balance)
const movimenti = async () => Number((await db.query(`SELECT count(*) c FROM credit_transactions`)).rows[0].c)
const add = async (amount, ref, type = 'refund') =>
  (await db.query(`SELECT * FROM add_credits('${U}', ${amount}, 'test', ${ref ? `'${ref}'` : 'NULL'}, '${type}')`)).rows[0]

// 1. Il caso reale
let r = await add(704.62, NON_PAGATA)
ok(r.success === false, 'prenotazione unpaid: add_credits rifiuta il rimborso')
ok(/non risulta pagata/.test(r.error_message), `messaggio chiaro: "${r.error_message}"`)
ok(await saldo() === 5977.59, 'saldo invariato dopo il rifiuto')
ok(await movimenti() === 0, 'nessun movimento scritto')

// 2. Inserimento diretto (la vecchia strada di riserva del sito)
let errore = null
try {
  await db.exec(`INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type)
                 VALUES ('${U}', 'credit', 704.62, 6682.21, 'x', '${NON_PAGATA}', 'booking_cancellation_refund')`)
} catch (e) { errore = e }
ok(errore !== null, 'inserimento diretto booking_cancellation_refund su unpaid: rifiutato')

// 3. Pagamento parziale
r = await add(450, PARZIALE)
ok(r.success === false, 'prenotazione partial: rifiutato (lo gestisce l\'ufficio a mano)')

// 4. Casi legittimi continuano a funzionare
r = await add(655.97, PAGATA)
ok(r.success === true && await saldo() === 6633.56, 'prenotazione paid: rimborso 90% accreditato')
r = await add(0.90, PAGATA_WALLET)
ok(r.success === true, 'prenotazione pagata col wallet (succeeded): rimborso accreditato')

// 5. Mai oltre il totale
r = await add(100, PAGATA, 'booking_cancellation_refund')
ok(r.success === false && /superano il totale/.test(r.error_message), 'secondo rimborso oltre il totale: rifiutato')
r = await add(72.89, PAGATA, 'booking_cancellation_refund')
ok(r.success === true, 'integrazione fino al 100% esatto: accettata')

// 6. Fuori dal perimetro: nessun blocco
r = await add(50, null)
ok(r.success === true, 'rimborso senza prenotazione (carrello fallito): accettato')
r = await add(339, NON_PAGATA, 'admin_manual')
ok(r.success === true, 'accredito manuale ufficio: non toccato')
r = await add(20, '99999999-9999-9999-9999-999999999999')
ok(r.success === true, 'reference_id che non e\' una prenotazione: accettato')

console.log('\nTutti i controlli passati.')
