#!/usr/bin/env node
/**
 * verificaWalletAutorizzazione.mjs — prova su un Postgres vero, in memoria,
 * il blocco "serve il codice del cliente" sul Credit Wallet (17/09/2026).
 *
 *   npm run wallet:autorizzazione
 *
 * Un operatore del gestionale non puo' prelevare dal wallet senza il codice
 * che il cliente riceve via email. Il cliente che paga da se' dal sito, i
 * server e i cron non sono vincolati. Un codice autorizza un importo e non
 * puo' pagare due volte.
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
  notes text,
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
CREATE TABLE public.limitation_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  limitation_code text NOT NULL,
  action_context text,
  otp_code text NOT NULL DEFAULT '000000',
  otp_expires_at timestamptz NOT NULL DEFAULT now(),
  otp_verified boolean NOT NULL DEFAULT false,
  otp_attempts int NOT NULL DEFAULT 0,
  approved_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'consumed', 'expired', 'revoked')),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
-- Come su Supabase: l'utente loggato arriva dalle impostazioni della richiesta.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
`)

const leggi = (f) => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
await db.exec(leggi('20260915000000_wallet_addebito_prenotazione.sql'))
await db.exec(leggi('20260916030000_wallet_account_da_scheda.sql'))
await db.exec(leggi('20260916000000_wallet_crediti_vincolati.sql'))
await db.exec(leggi('20260917000000_wallet_codice_cliente.sql'))

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const uno = async (s, p) => (await q(s, p))[0]
const tit = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

// Chi sta scrivendo. Nessuno = server/cron/SQL a mano.
const come = async (uid, ruolo = 'authenticated') => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)`,
    [uid || '', uid ? ruolo : ''])
}

let seq = 0
const nuovoCliente = async (credito) => {
  seq += 1
  const account = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
  const scheda = `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1,$2)', [account, `c${seq}@dr7.app`])
  await db.query('INSERT INTO user_credit_balance (user_id, balance) VALUES ($1,$2)', [account, credito])
  await db.query('INSERT INTO customers_extended (id, user_id, email, nome) VALUES ($1,$2,$3,$4)',
    [scheda, account, `c${seq}@dr7.app`, 'Cliente'])
  return { account, scheda }
}
const saldo = async (c) => Number((await uno('SELECT balance b FROM user_credit_balance WHERE user_id=$1', [c.account])).b)

const codice = async (c, importo, verificato = true) => (await uno(
  `INSERT INTO limitation_overrides (limitation_code, action_context, otp_verified, status, metadata)
   VALUES ('wallet_autorizzazione_cliente', $1, $2, $3, jsonb_build_object('customer_id', $1::text, 'importo', $4::numeric))
   RETURNING id`,
  [c.scheda, verificato, verificato ? 'active' : 'pending', importo])).id
const conCodice = (id) => (id ? { wallet_autorizzazione_cliente: { override_id: id } } : {})

const prenota = async (c, totaleEur, o = {}) => uno(
  `INSERT INTO bookings (user_id, customer_email, vehicle_name, service_type, price_total, amount_paid,
                         payment_method, payment_status, status, booking_details)
   VALUES ($1,$2,'Auto','car_rental',$3,$4,$5,$6,'confirmed',$7) RETURNING id`,
  [o.userId ?? c.scheda, null, Math.round(totaleEur * 100), o.pagato ?? null,
   o.metodo ?? 'Credit Wallet', o.stato ?? 'paid', JSON.stringify(o.details ?? {})])

const rifiuta = async (fn) => {
  try { await fn(); return null } catch (e) { return String(e?.message || e) }
}

const OPERATORE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

tit('1. Operatore senza codice: rifiutato')
const c1 = await nuovoCliente(500)
await come(OPERATORE)
let err = await rifiuta(() => prenota(c1, 200))
ok(!!err && /Serve il codice del cliente/.test(err), `rifiutato: "${err?.split('\n')[0]}"`)
ok(await saldo(c1) === 500, 'saldo intatto a 500')
ok((await q('SELECT id FROM bookings WHERE user_id=$1', [c1.scheda])).length === 0, 'nessuna prenotazione creata')

tit('2. Operatore con codice valido: passa, il codice si consuma')
const k1 = await codice(c1, 200)
const b1 = await prenota(c1, 200, { details: conCodice(k1) })
ok(!!b1.id && await saldo(c1) === 300, `prelevati 200, saldo ${await saldo(c1)}`)
let riga = await uno('SELECT status, metadata FROM limitation_overrides WHERE id=$1', [k1])
ok(riga.status === 'consumed' && Number(riga.metadata.residuo) === 0, 'codice consumato, residuo 0')

tit('3. Lo stesso codice non paga una seconda volta')
err = await rifiuta(() => prenota(c1, 50, { details: conCodice(k1) }))
ok(!!err && /copre ancora 0.00/.test(err), `rifiutato: "${err?.split('\n')[0]}"`)
ok(await saldo(c1) === 300, 'saldo sempre 300')

tit('4. Aumento del totale con il vecchio codice: rifiutato; con uno nuovo passa')
err = await rifiuta(() => db.query('UPDATE bookings SET price_total=25000 WHERE id=$1', [b1.id]))
ok(!!err && /DR7WA|codice/i.test(err), 'aumento di 50 senza nuovo codice rifiutato')
const k2 = await codice(c1, 50)
await db.query(`UPDATE bookings SET price_total=25000, booking_details=$2 WHERE id=$1`, [b1.id, JSON.stringify(conCodice(k2))])
ok(await saldo(c1) === 250, `con il nuovo codice: saldo ${await saldo(c1)}`)

tit('5. Risalvare senza cambiare importo e stornare non chiedono codici')
await db.query(`UPDATE bookings SET notes='nota', booking_details='{}' WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 250, 'risalvataggio: nessun movimento, nessun errore')
await db.query(`UPDATE bookings SET price_total=10000 WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 400, `storno di 150 senza codice: saldo ${await saldo(c1)}`)

tit('6. Budget: un codice da 300 paga un acconto e poi il saldo')
const c2 = await nuovoCliente(1000)
const k3 = await codice(c2, 300)
const b2 = await prenota(c2, 300, { stato: 'partial', pagato: 10000, details: conCodice(k3) })
ok(await saldo(c2) === 900, 'acconto 100 prelevato')
riga = await uno('SELECT status, metadata FROM limitation_overrides WHERE id=$1', [k3])
ok(riga.status === 'active' && Number(riga.metadata.residuo) === 200, 'residuo 200, codice ancora attivo')
await db.query(`UPDATE bookings SET payment_status='paid', amount_paid=30000 WHERE id=$1`, [b2.id])
ok(await saldo(c2) === 700, 'saldata con lo stesso codice: prelevati altri 200')
riga = await uno('SELECT status, metadata FROM limitation_overrides WHERE id=$1', [k3])
ok(riga.status === 'consumed' && riga.metadata.utilizzi.length === 2, 'due utilizzi registrati, codice consumato')

tit('7. Da saldare col wallet: nessun prelievo, nessun codice richiesto')
const c3 = await nuovoCliente(100)
const b3 = await prenota(c3, 80, { stato: 'pending' })
ok(!!b3.id && await saldo(c3) === 100, 'salvata senza codice, wallet intatto')
err = await rifiuta(() => db.query(`UPDATE bookings SET payment_status='paid' WHERE id=$1`, [b3.id]))
ok(!!err && /Serve il codice/.test(err), 'segna pagato senza codice: rifiutato')

tit('8. Codice di un altro cliente o non confermato: rifiutato')
const kAltro = await codice(c1, 500)
err = await rifiuta(() => prenota(c3, 50, { details: conCodice(kAltro) }))
ok(!!err && /altro cliente/.test(err), `rifiutato: "${err?.split('\n')[0]}"`)
const kNonConfermato = await codice(c3, 500, false)
err = await rifiuta(() => prenota(c3, 50, { details: conCodice(kNonConfermato) }))
ok(!!err && /non valido o non confermato/.test(err), 'codice non confermato: rifiutato')
err = await rifiuta(() => prenota(c3, 50, { details: { wallet_autorizzazione_cliente: { override_id: 'non-un-uuid' } } }))
ok(!!err && /Serve il codice/.test(err), 'id malformato: trattato come codice mancante')

tit('9. Codice troppo piccolo: rifiutato, nulla consumato')
const kPiccolo = await codice(c3, 30)
err = await rifiuta(() => prenota(c3, 50, { details: conCodice(kPiccolo) }))
ok(!!err && /copre ancora 30.00/.test(err), 'importo oltre il codice: rifiutato')
riga = await uno('SELECT status, metadata FROM limitation_overrides WHERE id=$1', [kPiccolo])
ok(riga.status === 'active' && riga.metadata.residuo === undefined, 'il codice resta intatto')

tit('10. Il cliente che paga da se e i server non sono vincolati')
const c4 = await nuovoCliente(300)
await come(c4.account)
await prenota(c4, 100, { userId: c4.account })
ok(await saldo(c4) === 200, 'il titolare del wallet paga senza codice')
await come(OPERATORE, 'service_role')
await prenota(c4, 50)
ok(await saldo(c4) === 150, 'service_role (server): nessun codice richiesto')
await come(null)
await prenota(c4, 50)
ok(await saldo(c4) === 100, 'nessun utente (cron, SQL a mano): nessun codice richiesto')

tit('11. Credito insufficiente resta la risposta, e non consuma il codice')
await come(OPERATORE)
const c5 = await nuovoCliente(20)
const k5 = await codice(c5, 100)
err = await rifiuta(() => prenota(c5, 100, { details: conCodice(k5) }))
ok(!!err && /Credito Wallet insufficiente/.test(err), 'rifiutato per credito insufficiente')
riga = await uno('SELECT status, metadata FROM limitation_overrides WHERE id=$1', [k5])
ok(riga.status === 'active' && riga.metadata.residuo === undefined, 'il codice non e stato consumato (tutto annullato)')

tit('12. Metodi diversi dal wallet e prenotazioni TEST: nessun controllo')
await prenota(c5, 100, { metodo: 'Contanti' })
ok(await saldo(c5) === 20, 'contanti: nessun codice, wallet intatto')
await db.query(`INSERT INTO bookings (user_id, vehicle_name, vehicle_plate, price_total, payment_method, payment_status, status)
                VALUES ($1,'Auto','TEST01',5000,'Credit Wallet','paid','confirmed')`, [c5.scheda])
ok(await saldo(c5) === 20, 'targa TEST: nessun codice, nessun prelievo')

tit('13. Addebito manuale: stessa funzione, stesso budget')
const c6 = await nuovoCliente(100)
const k6 = await codice(c6, 40)
await db.query(`SELECT dr7_wallet_consuma_autorizzazione($1,$2,40,'{"tipo":"addebito_manuale"}')`, [k6, c6.account])
riga = await uno('SELECT status FROM limitation_overrides WHERE id=$1', [k6])
ok(riga.status === 'consumed', 'codice consumato dall addebito manuale')
err = await rifiuta(() => db.query(`SELECT dr7_wallet_consuma_autorizzazione($1,$2,40,'{}')`, [k6, c6.account]))
ok(!!err, 'secondo addebito con lo stesso codice: rifiutato')

console.log('\nTutti i controlli superati.')
