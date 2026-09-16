#!/usr/bin/env node
/**
 * verificaWalletVincolato.mjs — prova su un Postgres vero, in memoria, il
 * credito wallet VINCOLATO: scadenza e servizi ammessi.
 *
 *   npm run wallet:vincolato
 *
 * Perche' esiste: la regola sta tutta nel database. Un errore qui non lo vede
 * nessuna schermata — lo vede il cliente a cui si spende il credito sbagliato,
 * o a cui muore in mano quello che stava per scadere. Qui si ripercorre la
 * vita dei lotti: quale si consuma per primo, cosa succede a uno scaduto, cosa
 * torna indietro quando una prenotazione si storna.
 *
 * Gira su @electric-sql/pglite: Postgres in WebAssembly, niente rete.
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

await db.exec(`
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  customer_email text,
  customer_name text,
  vehicle_name text,
  vehicle_plate text,
  service_name text,
  service_type text,
  price_total bigint,
  amount_paid bigint,
  payment_method text,
  payment_status text,
  status text,
  booking_details jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.customers_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, email text, nome text, cognome text
);
CREATE TABLE public.user_credit_balance (
  user_id uuid PRIMARY KEY,
  balance numeric(10,2) NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('credit','debit')),
  amount numeric(10,2) NOT NULL,
  balance_after numeric(10,2) NOT NULL,
  description text NOT NULL,
  reference_id uuid,
  reference_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
`)

const leggi = (f) => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
await db.exec(leggi('20260915000000_wallet_addebito_prenotazione.sql'))
await db.exec(leggi('20260916000000_wallet_crediti_vincolati.sql'))

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const uno = async (s, p) => (await q(s, p))[0]
const tit = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

const CLIENTE = '11111111-1111-1111-1111-111111111111'
await db.query('INSERT INTO public.user_credit_balance (user_id, balance) VALUES ($1, 0)', [CLIENTE])

const saldo = async () => Number((await uno('SELECT balance FROM public.user_credit_balance WHERE user_id=$1', [CLIENTE])).balance)
const disponibile = async (servizio) =>
  Number((await uno('SELECT public.dr7_wallet_vincolato_disponibile($1,$2) AS v', [CLIENTE, servizio])).v)
const lotto = async (descrizione, importo, scadenza, servizi) =>
  (await uno(
    `INSERT INTO public.wallet_crediti_vincolati (user_id, importo, residuo, scadenza, servizi, descrizione)
     VALUES ($1,$2,$2,$3,$4,$5) RETURNING id`,
    [CLIENTE, importo, scadenza, servizi, descrizione])).id
const residuo = async (id) => Number((await uno('SELECT residuo FROM public.wallet_crediti_vincolati WHERE id=$1', [id])).residuo)

const prenota = async (servizio, totale, extra = {}) => (await uno(
  `INSERT INTO public.bookings (user_id, service_type, vehicle_name, price_total, amount_paid, payment_method, payment_status, status)
   VALUES ($1,$2,$3,$4,0,'Credit Wallet','paid',$5) RETURNING id`,
  [CLIENTE, servizio, extra.nome || 'Auto', totale * 100, extra.stato || 'confirmed'])).id

tit('1. Il servizio decide se il credito si puo spendere')
const soloLavaggio = await lotto('Solo lavaggio', 100, null, ['car_wash'])
ok(await disponibile('car_wash') === 100, 'sul lavaggio vale 100')
ok(await disponibile('car_rental') === 0, 'sul noleggio Terra non vale niente')
ok(await disponibile('mechanical') === 100, 'la meccanica e lo stesso business del lavaggio')
ok(await disponibile('boat_rental') === 0, 'sul Mare non vale niente')

tit('2. Due servizi insieme')
const duePlus = await lotto('Lavaggio e Terra', 50, null, ['car_wash', 'rental'])
ok(await disponibile('car_wash') === 150, 'lavaggio: 100 + 50')
ok(await disponibile('car_rental') === 50, 'Terra: solo il secondo lotto')
ok(await disponibile('heli_rental') === 0, 'Aria: nessuno dei due')

tit('3. La scadenza')
const scaduto = await lotto('Scaduto ieri', 500, 'yesterday', null)
await db.query(`UPDATE public.wallet_crediti_vincolati SET scadenza = current_date - 1 WHERE id=$1`, [scaduto])
ok(await disponibile('car_rental') === 50, 'un lotto scaduto non si spende')
const scadeOggi = await lotto('Scade oggi', 30, null, null)
await db.query(`UPDATE public.wallet_crediti_vincolati SET scadenza = current_date WHERE id=$1`, [scadeOggi])
ok(await disponibile('car_rental') === 80, "l'ultimo giorno vale ancora")

tit('4. Chi scade prima se ne va per primo')
const b1 = await prenota('car_rental', 30)
ok(await residuo(scadeOggi) === 0, 'consumato il lotto che scade oggi')
ok(await residuo(duePlus) === 50, 'quello senza scadenza non e stato toccato')
ok(await saldo() === 0, 'il saldo libero non e stato toccato')

tit('5. Prima il vincolato, poi il saldo libero')
await db.query('UPDATE public.user_credit_balance SET balance = 200 WHERE user_id=$1', [CLIENTE])
const b2 = await prenota('car_rental', 120)
ok(await residuo(duePlus) === 0, 'il lotto valido per Terra si e svuotato')
ok(await saldo() === 130, 'il resto (70) e uscito dal saldo libero')
ok(await residuo(soloLavaggio) === 100, 'il credito solo-lavaggio non e stato toccato da un noleggio')

tit('6. Lo storno rimette i soldi nel lotto giusto')
await db.query(`UPDATE public.bookings SET payment_method='Carta', payment_status='paid' WHERE id=$1`, [b2])
ok(await residuo(duePlus) === 50, 'il lotto ha riavuto i suoi 50')
ok(await saldo() === 200, 'e il saldo libero i suoi 70')

tit('7. Il credito vincolato non paga un servizio che non e il suo')
await db.query('UPDATE public.user_credit_balance SET balance = 0 WHERE user_id=$1', [CLIENTE])
let rifiutata = false
try {
  await prenota('boat_rental', 80)
} catch (e) {
  rifiutata = /insufficiente/i.test(e.message)
}
ok(rifiutata, 'sul Mare la prenotazione viene rifiutata: 150 di credito, ma nessuno vale li')
ok(await residuo(soloLavaggio) === 100, 'e il lotto lavaggio e rimasto intero')

tit('8. Sul suo servizio invece paga')
const b3 = await prenota('car_wash', 60)
ok(await residuo(soloLavaggio) === 40, 'il lavaggio ha scalato dal lotto lavaggio')
ok(await saldo() === 0, 'senza toccare il saldo libero (che e a zero)')

tit('9. Il registro dice quanto veniva dal vincolato')
const mov = await uno(`SELECT amount, description FROM public.credit_transactions WHERE reference_id=$1`, [b3])
ok(Number(mov.amount) === 60, "l'importo a registro e quello intero pagato col wallet")
ok(/credito vincolato/i.test(mov.description), 'la descrizione dice quanto veniva dal vincolato')

tit('10. La migrazione si puo rilanciare')
await db.exec(leggi('20260916000000_wallet_crediti_vincolati.sql'))
ok(await residuo(soloLavaggio) === 40, 'rilanciarla non cambia i residui')
ok(await disponibile('car_wash') === 90, 'ne le disponibilita (40 del lotto lavaggio + 50 di quello valido su due servizi)')

console.log('\nSCENARIO COMPLETO: tutto verificato.')
