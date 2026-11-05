#!/usr/bin/env node
/**
 * verificaPuntiLavaggio.mjs — prova su un Postgres vero, in memoria, la
 * Fidelity Card lavaggio (migrazioni 20261104_punti_lavaggio_credito_wallet,
 * 20261105_punti_lavaggio_anche_per_email e 20261106_fidelity_lavaggio_da_centralina:
 * regole da Centralina Pro, cambi di regole senza premi arretrati).
 *
 *   npm run punti:lavaggio
 *
 * Ripercorre il caso segnalato il 31/10 (cliente con 179 EUR di lavaggi
 * pagati e la carta a zero) e la vita del premio: credito wallet vincolato
 * per chi ha l'account, buono codice per chi non ce l'ha, mai due volte.
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

const SCHEMA = `
CREATE TABLE public.centralina_pro_config (
  id text PRIMARY KEY,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO public.centralina_pro_config (id, config) VALUES
  ('main', '{"site_copy":{"x":1}}'::jsonb), ('business_lavaggio', '{}'::jsonb);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  customer_email text,
  customer_name text,
  customer_phone text,
  vehicle_name text,
  vehicle_plate text,
  service_name text,
  service_type text,
  price_total bigint,
  amount_paid bigint,
  payment_method text,
  payment_status text,
  status text,
  booking_details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.customers_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, email text, telefono text, nome text, cognome text,
  updated_at timestamptz DEFAULT now(),
  fidelity_points integer DEFAULT 0,
  fidelity_lifetime_points integer DEFAULT 0
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
-- Sito 20260427000000_add_fidelity_points.sql
CREATE TABLE public.fidelity_point_awards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_extended_id uuid REFERENCES public.customers_extended(id) ON DELETE SET NULL,
  points_awarded integer NOT NULL,
  voucher_code text,
  voucher_issued_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, code_type text, value_type text, value_amount numeric, scope text[],
  minimum_spend numeric, single_use boolean, status text, customer_email text, customer_phone text,
  valid_from timestamptz, valid_until timestamptz, message text, usage_conditions text, qr_url text
);
CREATE TABLE public.admins (user_id uuid);
CREATE TABLE public.system_messages (
  message_key text PRIMARY KEY, label text, description text, message_body text, is_automatic boolean,
  is_enabled boolean, include_header boolean, send_email boolean, target_service_type text,
  recipient_mode text, handled_events text[]
);
CREATE TABLE public.system_alarms (
  id text PRIMARY KEY, label text, schedule text, reason text, category text, threshold_value integer,
  threshold_unit text, is_enabled boolean, sort_order integer, group_key text, priority text, reparto text,
  detector text, stato_rilevamento text, ripeti_finche_non_risolto boolean, ripeti_ogni_minuti integer,
  notifica_gestionale boolean, notifica_push boolean, notifica_whatsapp_interna boolean,
  notifica_email_interna boolean, destinatari jsonb, sound_key text, suono_continuo boolean,
  messaggio_cliente_auto boolean
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
`

const leggi = (f) => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
async function nuovoDb() {
  const d = new PGlite()
  await d.exec(SCHEMA)
  await d.exec(leggi('20260915000000_wallet_addebito_prenotazione.sql'))
  await d.exec(leggi('20260916030000_wallet_account_da_scheda.sql'))
  await d.exec(leggi('20260916000000_wallet_crediti_vincolati.sql'))
  return d
}
let db = await nuovoDb()

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const uno = async (s, p) => (await q(s, p))[0]
const tit = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

// Antonella: account del sito + DUE schede (ufficio e sito) dello stesso account.
const ACCOUNT = '11111111-1111-1111-1111-111111111111'
const SCHEDA_UFFICIO = '22222222-2222-2222-2222-222222222222'
const SCHEDA_SITO = '33333333-3333-3333-3333-333333333333'
// Cliente solo in negozio, senza account, con tanto storico.
const NEGOZIO = '44444444-4444-4444-4444-444444444444'
// Cliente senza account che poi si iscrive.
const ISCRIVENDO = '55555555-5555-5555-5555-555555555555'
const NUOVO_ACCOUNT = '66666666-6666-6666-6666-666666666666'

await db.query('INSERT INTO auth.users (id, email) VALUES ($1,$2)', [ACCOUNT, 'antonella@prova.it'])
await db.query('INSERT INTO public.user_credit_balance (user_id, balance) VALUES ($1, 0)', [ACCOUNT])
await db.query(`INSERT INTO public.customers_extended (id, user_id, email, nome, cognome, telefono, updated_at) VALUES
  ($1,$2,'antonella@prova.it','Antonella','Melis','3330000000', now() - interval '10 days'),
  ($3,$2,'antonella@prova.it','Antonella','Melis','3330000000', now()),
  ($4,NULL,'negozio@prova.it','Mario','Negozio','3331111111', now()),
  ($5,NULL,'','Luca','Iscrivendo','3332222222', now())`,
  [SCHEDA_UFFICIO, ACCOUNT, SCHEDA_SITO, NEGOZIO, ISCRIVENDO])

const lavaggio = async ({ userId = null, scheda = null, eur, stato = 'paid', metodo = 'Contanti', status = 'confirmed' }) => (await uno(
  `INSERT INTO public.bookings (user_id, service_type, vehicle_name, price_total, amount_paid, payment_method, payment_status, status, booking_details)
   VALUES ($1,'car_wash','Lavaggio',$2,0,$3,$4,$5,$6::jsonb) RETURNING id`,
  [userId, Math.round(eur * 100), metodo, stato, status, JSON.stringify(scheda ? { customer: { customerId: scheda } } : {})])).id

const carta = async (id) => {
  const r = await uno('SELECT fidelity_points AS p, fidelity_lifetime_points AS t FROM public.customers_extended WHERE id=$1', [id])
  return { punti: Number(r.p), totale: Number(r.t) }
}
const premi = async (titolare) => q('SELECT * FROM public.fidelity_buoni WHERE titolare=$1 ORDER BY numero', [titolare])

tit('0. Storico prima di qualunque trigger (il caso segnalato)')
// Melis: 40 + 55 + 35 + 49 = 179, come nella scheda cliente del gestionale.
await lavaggio({ scheda: SCHEDA_UFFICIO, eur: 40, metodo: 'Contanti' })
await lavaggio({ scheda: SCHEDA_UFFICIO, eur: 55, metodo: 'POS' })
await lavaggio({ userId: SCHEDA_UFFICIO, scheda: SCHEDA_UFFICIO, eur: 35, metodo: 'Bonifico' })
await lavaggio({ userId: ACCOUNT, eur: 49, metodo: 'Nexi', stato: 'succeeded' })
// Non contano: non pagato, annullato, noleggio, meccanica.
await lavaggio({ scheda: SCHEDA_UFFICIO, eur: 300, stato: 'pending' })
await lavaggio({ scheda: SCHEDA_UFFICIO, eur: 300, status: 'cancelled' })
await db.query(`INSERT INTO public.bookings (user_id, service_type, price_total, payment_status, status) VALUES ($1,'car_rental',90000,'paid','confirmed')`, [ACCOUNT])
await db.query(`INSERT INTO public.bookings (user_id, service_type, price_total, payment_status, status) VALUES ($1,'mechanical_service',9000,'paid','confirmed')`, [ACCOUNT])
// Negozio: 610 EUR di storico.
for (const e of [200, 200, 210]) await lavaggio({ userId: NEGOZIO, eur: e })
// Iscrivendo: 100 EUR.
await lavaggio({ scheda: ISCRIVENDO, eur: 100 })

// Con PUNTI_SENZA_1012=1 si prova il database dove la migrazione del 12/10
// non e' mai stata eseguita: la nuova deve bastare da sola.
if (process.env.PUNTI_SENZA_1012 !== '1') {
  tit('1. La vecchia migrazione 12/10: lo storico resta fuori')
  await db.exec(leggi('20261012_punti_lavaggio_dal_database.sql'))
  ok((await carta(SCHEDA_SITO)).punti === 0, 'con il contatore incrementale la carta del sito resta a 0 (il bug)')
} else {
  tit('1. Database senza la migrazione 12/10')
}

tit('2. La nuova migrazione: punti dalle prenotazioni')
await db.exec(leggi('20261104_punti_lavaggio_credito_wallet.sql'))
let c = await carta(SCHEDA_SITO)
ok(c.punti === 179 && c.totale === 179, `scheda del sito: 179/250 (letto ${c.punti}/${c.totale})`)
c = await carta(SCHEDA_UFFICIO)
ok(c.punti === 179, 'scheda dell ufficio: stessi 179 (stesso titolare)')
c = await carta(NEGOZIO)
ok(c.punti === 110 && c.totale === 610, `negozio: 610 di storico -> 110 sulla carta (letto ${c.punti})`)
ok(Number((await uno('SELECT soglie FROM public.fidelity_lavaggio_base WHERE titolare=$1', [NEGOZIO])).soglie) === 2, 'le 2 soglie passate sono pregresse')
ok(Number((await uno('SELECT count(*) n FROM public.discount_codes')).n) === 0, 'nessun premio arretrato emesso')
ok(Number((await uno('SELECT count(*) n FROM public.wallet_crediti_vincolati')).n) === 0, 'nessun credito arretrato')
ok((await carta(ISCRIVENDO)).punti === 100, 'iscrivendo: 100')
const trig = await q(`SELECT tgname FROM pg_trigger WHERE tgrelid='public.bookings'::regclass AND tgname LIKE '%punti%'`)
ok(trig.length === 1 && trig[0].tgname === 'trg_dr7_zz_punti_lavaggio', 'un solo trigger punti, quello nuovo')

tit('3. A 250 punti: credito wallet vincolato al lavaggio')
const b80 = await lavaggio({ userId: SCHEDA_UFFICIO, scheda: SCHEDA_UFFICIO, eur: 80, stato: 'pending' })
ok((await carta(SCHEDA_SITO)).punti === 179, 'da saldare: non conta')
await db.query(`UPDATE public.bookings SET payment_status='paid', payment_method='Contanti' WHERE id=$1`, [b80])
c = await carta(SCHEDA_SITO)
ok(c.punti === 9 && c.totale === 259, `pagato in negozio: 259 -> premio + 9 punti (letto ${c.punti})`)
let p = await premi(ACCOUNT)
ok(p.length === 1 && p[0].numero === 1 && p[0].lotto_id && !p[0].voucher_code, 'premio n.1 = lotto wallet, senza codice')
const lotto1 = await uno('SELECT * FROM public.wallet_crediti_vincolati WHERE id=$1', [p[0].lotto_id])
ok(lotto1.user_id === ACCOUNT && Number(lotto1.importo) === 25 && Number(lotto1.residuo) === 25, 'lotto di 25 EUR sull account')
ok(JSON.stringify(lotto1.servizi) === '["car_wash"]', 'vale solo sul lavaggio')
const giorni = Number((await uno(`SELECT ($1::date - (now() AT TIME ZONE 'Europe/Rome')::date) AS g`, [lotto1.scadenza])).g)
ok(giorni === 15, 'scade fra 15 giorni')
ok(Number((await uno('SELECT count(*) n FROM public.credit_transactions WHERE user_id=$1', [ACCOUNT])).n) === 0, 'nessuna riga credit_transactions (il lotto non entra nel saldo libero)')
ok(p[0].booking_id === b80 && p[0].customer_extended_id === SCHEDA_UFFICIO, 'il premio sa prenotazione e scheda (messaggio, allarme)')
ok(Number((await uno('SELECT public.dr7_wallet_vincolato_disponibile($1,$2) v', [ACCOUNT, 'car_wash'])).v) === 25, 'spendibile sul lavaggio')
ok(Number((await uno('SELECT public.dr7_wallet_vincolato_disponibile($1,$2) v', [ACCOUNT, 'car_rental'])).v) === 0, 'non sul noleggio')

tit('4. Mai due volte')
await db.query(`UPDATE public.bookings SET booking_details = booking_details || '{"notes":"x"}'::jsonb WHERE id=$1`, [b80])
await db.query(`UPDATE public.bookings SET payment_status='completed' WHERE id=$1`, [b80])
ok(Number((await uno('SELECT public.dr7_punti_lavaggio_accredita($1) n', [b80])).n) === 0, 'il sito che richiama accredita: 0 premi')
await db.exec(leggi('20261104_punti_lavaggio_credito_wallet.sql'))
p = await premi(ACCOUNT)
ok(p.length === 1, 'risalvataggi, callback e migrazione rilanciata: sempre 1 premio')
ok((await carta(SCHEDA_SITO)).punti === 9, 'e la carta resta a 9')
let doppio = false
try { await db.query(`INSERT INTO public.fidelity_buoni (importo, punti_soglia, punti_rimasti, titolare, numero) VALUES (25,250,0,$1,1)`, [ACCOUNT]) } catch { doppio = true }
ok(doppio, 'il database rifiuta un secondo premio n.1')

tit('5. Senza account: buono codice sconto come prima')
await lavaggio({ userId: NEGOZIO, eur: 150 })
c = await carta(NEGOZIO)
ok(c.punti === 10 && c.totale === 760, `negozio 760 -> premio + 10 (letto ${c.punti})`)
p = await premi(NEGOZIO)
ok(p.length === 1 && /^DR7-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(p[0].voucher_code) && !p[0].lotto_id, 'premio = codice sconto')
const dc = await uno('SELECT * FROM public.discount_codes WHERE code=$1', [p[0].voucher_code])
ok(Number(dc.value_amount) === 25 && JSON.stringify(dc.scope) === '["lavaggi"]', 'codice da 25 EUR, solo lavaggi')

tit('6. Annullamento: i punti scendono, il premio resta e non si ripete')
await db.query(`UPDATE public.bookings SET status='cancelled' WHERE id=$1`, [b80])
c = await carta(SCHEDA_SITO)
ok(c.punti === 0 && c.totale === 179, 'annullato il lavaggio da 80: totale 179, carta a 0')
await lavaggio({ userId: ACCOUNT, eur: 100, metodo: 'Nexi' })
c = await carta(SCHEDA_SITO)
ok(c.punti === 29 && (await premi(ACCOUNT)).length === 1, '279: nessun nuovo premio (gia dato), carta a 29')

tit('7. Pagato col wallet: il premio nuovo non paga il lavaggio che lo ha fatto scattare')
await db.query('UPDATE public.user_credit_balance SET balance = 500 WHERE user_id=$1', [ACCOUNT])
await lavaggio({ userId: ACCOUNT, eur: 230, metodo: 'Credit Wallet' })
p = await premi(ACCOUNT)
ok(p.length === 2, '509: premio n.2')
const lotto2 = await uno('SELECT residuo FROM public.wallet_crediti_vincolati WHERE id=$1', [p[1].lotto_id])
ok(Number(lotto2.residuo) === 25, 'il lotto n.2 e intero')
ok((await carta(SCHEDA_SITO)).punti === 9, 'carta a 9')

tit('8. Prenotazione cancellata: il premio resta a registro')
await db.query('DELETE FROM public.bookings WHERE id=$1', [b80])
p = await premi(ACCOUNT)
ok(p.length === 2 && p[0].booking_id === null, 'il premio n.1 resta, senza prenotazione')

tit('9. Scheda che si iscrive al sito: la carta la segue')
await db.query('INSERT INTO auth.users (id, email) VALUES ($1,$2)', [NUOVO_ACCOUNT, 'luca@prova.it'])
await db.query('UPDATE public.customers_extended SET user_id=$1 WHERE id=$2', [NUOVO_ACCOUNT, ISCRIVENDO])
ok((await carta(ISCRIVENDO)).punti === 100, 'sempre 100 punti dopo il collegamento')
await lavaggio({ userId: NUOVO_ACCOUNT, eur: 150 })
p = await premi(NUOVO_ACCOUNT)
ok(p.length === 1 && p[0].lotto_id, 'a 250 il premio arriva come credito wallet sul nuovo account')
ok((await carta(ISCRIVENDO)).punti === 0, 'e la carta riparte da 0')

tit('10. Un errore nei punti non blocca mai il salvataggio')
await db.exec('ALTER TABLE public.fidelity_buoni RENAME TO fidelity_buoni_x')
const bOk = await lavaggio({ userId: ACCOUNT, eur: 300 })
ok(!!bOk, 'prenotazione salvata anche con la tabella premi assente')
await db.exec('ALTER TABLE public.fidelity_buoni_x RENAME TO fidelity_buoni')

tit('11. 20261105: lavaggi agganciati al cliente solo per email')
// Caso reale 05/11: Melis a 95 invece di 179, i lavaggi da 35 e 49 avevano
// solo l'email (nessun id cliente nella prenotazione).
const PAOLA_ACC = '77777777-7777-7777-7777-777777777777'
const PAOLA = '88888888-8888-8888-8888-888888888888'
const STORICO = '99999999-9999-9999-9999-999999999999'
const COND_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const COND_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
await db.query('INSERT INTO auth.users (id, email) VALUES ($1,$2)', [PAOLA_ACC, 'paola@prova.it'])
await db.query('INSERT INTO public.user_credit_balance (user_id, balance) VALUES ($1, 0)', [PAOLA_ACC])
await db.query(`INSERT INTO public.customers_extended (id, user_id, email, nome, cognome, telefono, updated_at) VALUES
  ($1,$2,'paola@prova.it','Paola','Prova','3334444444', now()),
  ($3,NULL,'storico@prova.it','Sara','Storico','3335555555', now()),
  ($4,NULL,'condivisa@prova.it','Uno','Condiviso','3336666666', now()),
  ($5,NULL,'condivisa@prova.it','Due','Condiviso','3337777777', now())`,
  [PAOLA, PAOLA_ACC, STORICO, COND_A, COND_B])
const soloEmail = async (email, eur, userId = null) => (await uno(
  `INSERT INTO public.bookings (user_id, customer_email, service_type, vehicle_name, price_total, amount_paid, payment_method, payment_status, status, booking_details)
   VALUES ($1,$2,'car_wash','Lavaggio',$3,0,'Contanti','paid','confirmed','{}'::jsonb) RETURNING id`,
  [userId, email, Math.round(eur * 100)])).id
await lavaggio({ scheda: PAOLA, eur: 40 })
await lavaggio({ scheda: PAOLA, eur: 55 })
// Senza la 20261105 il trigger 20261104 ignora queste due: si inseriscono prima.
await soloEmail(' Paola@Prova.it ', 35)
await soloEmail('paola@prova.it', 49)
ok((await carta(PAOLA)).punti === 95, `prima della 20261105: 95 (il bug, letto ${(await carta(PAOLA)).punti})`)
// Storico: 100 per id + 300 solo email = 400 -> una soglia gia' superata.
await lavaggio({ scheda: STORICO, eur: 100 })
await soloEmail('storico@prova.it', 300)
// Email condivisa da due clienti, email vuota, id che non porta a nessuno.
await soloEmail('condivisa@prova.it', 60)
await soloEmail('', 500)
await soloEmail('paola@prova.it', 500, 'cccccccc-cccc-cccc-cccc-cccccccccccc')

await db.exec(leggi('20261105_punti_lavaggio_anche_per_email.sql'))
c = await carta(PAOLA)
ok(c.punti === 179 && c.totale === 179, `dopo la 20261105: 179/250 (letto ${c.punti}/${c.totale})`)
ok((await premi(PAOLA_ACC)).length === 0, 'nessun premio per Paola (sotto 250)')
c = await carta(STORICO)
ok(c.punti === 150 && c.totale === 400, `storico: 400 -> 150 sulla carta (letto ${c.punti}/${c.totale})`)
ok((await premi(STORICO)).length === 0, 'storico: soglia passata ritrovata per email = nessun arretrato')
ok((await carta(COND_A)).punti === 0 && (await carta(COND_B)).punti === 0, 'email condivisa: nessuno dei due prende i punti')
ok((await carta(PAOLA)).totale === 179, 'email vuota e id inesistente: non finiscono a Paola')

// Dal vivo: nuovo lavaggio solo email, pagato in negozio.
const bLive = await soloEmail('PAOLA@prova.it', 71)
c = await carta(PAOLA)
ok(c.punti === 0 && c.totale === 250 && (await premi(PAOLA_ACC)).length === 1, `dal vivo: 250 -> premio come credito wallet (carta ${c.punti}/${c.totale})`)
await db.query(`UPDATE public.bookings SET status='cancelled' WHERE id=$1`, [bLive])
ok((await carta(PAOLA)).totale === 179, 'annullato: torna a 179, premio non ripetuto')
// La scheda cambia email: i lavaggi agganciati per email la seguono.
await db.query(`UPDATE public.customers_extended SET email='storico.nuova@prova.it' WHERE id=$1`, [STORICO])
ok((await carta(STORICO)).totale === 100, 'scheda con email cambiata: restano solo i lavaggi per id')
await db.query(`UPDATE public.customers_extended SET email='storico@prova.it' WHERE id=$1`, [STORICO])
ok((await carta(STORICO)).totale === 400 && (await premi(STORICO)).length === 0, 'email ripristinata: 400 e ancora nessun arretrato')

await db.exec(leggi('20261105_punti_lavaggio_anche_per_email.sql'))
ok((await premi(PAOLA_ACC)).length === 1 && (await premi(ACCOUNT)).length === 2, 'migrazione rilanciata: nessun premio in piu')
const fn = await q(`SELECT p.oid FROM pg_proc p WHERE p.proname = 'dr7_punti_titolare_prenotazione'`)
ok(fn.length === 1, 'una sola versione della funzione (niente overload)')

tit('12. 20261106: regole da Centralina Pro, con i default nulla cambia')
const DEF = { attivo: true, euro_per_punto: 1, soglia_punti: 250, importo_premio: 25, validita_giorni: 15, tipo_premio: 'credito_wallet' }
const salvaCfg = async (over, dbx = db) => dbx.query(
  `UPDATE public.centralina_pro_config SET config = jsonb_set(config, '{fidelity_lavaggio}', $1::jsonb) WHERE id = 'main'`,
  [JSON.stringify({ ...DEF, ...over })])
const foto = async () => JSON.stringify({
  carte: await q('SELECT id, fidelity_points, fidelity_lifetime_points FROM public.customers_extended ORDER BY id'),
  premi: Number((await uno('SELECT count(*) n FROM public.fidelity_buoni')).n),
  codici: Number((await uno('SELECT count(*) n FROM public.discount_codes')).n),
  lotti: Number((await uno('SELECT count(*) n FROM public.wallet_crediti_vincolati')).n),
})
const versione = async () => Number((await uno(`SELECT coalesce((SELECT versione FROM public.fidelity_lavaggio_config WHERE id='attiva'), 0) v`)).v)
const ancore = async () => Number((await uno('SELECT count(*) n FROM public.fidelity_lavaggio_ancora')).n)
const nuovoCliente = async (id, scheda, email) => {
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1,$2)', [id, email])
  await db.query('INSERT INTO public.user_credit_balance (user_id, balance) VALUES ($1, 0)', [id])
  await db.query(`INSERT INTO public.customers_extended (id, user_id, email, nome, cognome, telefono) VALUES ($1,$2,$3,'Prova','Cliente','3339999999')`, [scheda, id, email])
}
const n = async (s, p) => Number((await uno(s, p)).n)

const prima = await foto()
await db.exec(leggi('20261106_fidelity_lavaggio_da_centralina.sql'))
ok(await foto() === prima, 'migrazione con config assente: carte, premi, codici, lotti identici')
ok(await versione() === 0 && await ancore() === 0, 'nessuna ancora, regola di sempre')
await db.exec(leggi('20261106_fidelity_lavaggio_da_centralina.sql'))
ok(await foto() === prima, 'migrazione rilanciata: identico')
await salvaCfg({})
ok(await foto() === prima && await versione() === 0 && await ancore() === 0, 'salvata la sezione con i valori di default: niente si muove')
const norm = (await uno(`SELECT public.dr7_fidelity_lavaggio_norm('{"euro_per_punto":-1,"soglia_punti":0,"importo_premio":"abc","validita_giorni":0,"tipo_premio":"x"}'::jsonb) c`)).c
ok(Number(norm.euro_per_punto) === 1 && norm.soglia_punti === 250 && Number(norm.importo_premio) === 25 && norm.validita_giorni === 15 && norm.tipo_premio === 'credito_wallet' && norm.attivo === true, 'valori 0, negativi o testo = default')
const norm2 = (await uno(`SELECT public.dr7_fidelity_lavaggio_norm('{"euro_per_punto":"1,5","soglia_punti":"120"}'::jsonb) c`)).c
ok(Number(norm2.euro_per_punto) === 1.5 && norm2.soglia_punti === 120, 'decimali con la virgola accettati')

const RIC_ACC = 'd0000000-0000-0000-0000-000000000001', RIC = 'd0000000-0000-0000-0000-000000000002'
await nuovoCliente(RIC_ACC, RIC, 'riccardo@prova.it')
await lavaggio({ userId: RIC_ACC, eur: 260 })
p = await premi(RIC_ACC)
c = await carta(RIC)
ok(p.length === 1 && Number(p[0].importo) === 25 && p[0].punti_soglia === 250 && c.punti === 10 && c.totale === 260, 'default dal vivo: 260 -> premio 25 EUR a 250, 10 punti')
const lr = await uno('SELECT * FROM public.wallet_crediti_vincolati WHERE id=$1', [p[0].lotto_id])
ok(Number(lr.importo) === 25 && Number((await uno(`SELECT ($1::date - (now() AT TIME ZONE 'Europe/Rome')::date) AS g`, [lr.scadenza])).g) === 15, 'lotto 25 EUR, 15 giorni')

tit('13. Soglia da 250 a 100 (premio 10) con un cliente a 179')
const GIU_ACC = 'd0000000-0000-0000-0000-000000000003', GIU = 'd0000000-0000-0000-0000-000000000004'
await nuovoCliente(GIU_ACC, GIU, 'giulia@prova.it')
const giu100 = await lavaggio({ userId: GIU_ACC, eur: 100 })
await lavaggio({ userId: GIU_ACC, eur: 79 })
ok((await carta(GIU)).punti === 179, 'Giulia a 179/250')
let premiTotali = await n('SELECT count(*) n FROM public.fidelity_buoni')
await salvaCfg({ soglia_punti: 100, importo_premio: 10 })
ok(await n('SELECT count(*) n FROM public.fidelity_buoni') === premiTotali, 'al cambio NESSUN premio, per nessun cliente')
c = await carta(GIU)
ok(c.punti === 99 && c.totale === 179, `Giulia tiene i punti fino a soglia - 1: 99/100 (letto ${c.punti}/${c.totale})`)
ok(await versione() === 1 && await ancore() > 0, 'regola versione 1, ancore scritte')
c = await carta(RIC)
ok(c.punti === 10, 'Riccardo resta a 10')
ok((await uno(`SELECT label FROM public.system_alarms WHERE id='lav_punti_250'`)).label === 'Cliente a 100 punti lavaggio', 'etichetta allarme con la soglia nuova')
ok((await uno(`SELECT label FROM public.system_messages WHERE message_key='pro_fidelity_voucher'`)).label === 'Lavaggio: 100 punti raggiunti (buono 10 EUR)', 'etichetta template con soglia e importo nuovi')
const fotoV1 = await foto()
await salvaCfg({ soglia_punti: 100, importo_premio: 10 })
await db.exec(leggi('20261106_fidelity_lavaggio_da_centralina.sql'))
ok(await foto() === fotoV1 && await versione() === 1, 'stessa config risalvata e migrazione rilanciata: nulla cambia')
await lavaggio({ userId: GIU_ACC, eur: 15 })
p = await premi(GIU_ACC)
c = await carta(GIU)
ok(p.length === 1 && Number(p[0].importo) === 10 && p[0].punti_soglia === 100 && c.punti === 14, `primo lavaggio dopo il cambio: UN premio da 10, carta a 14 (letto ${c.punti})`)
ok(Number((await uno('SELECT importo FROM public.wallet_crediti_vincolati WHERE id=$1', [p[0].lotto_id])).importo) === 10, 'lotto da 10 EUR')
const MAR_ACC = 'd0000000-0000-0000-0000-000000000005', MAR = 'd0000000-0000-0000-0000-000000000006'
await nuovoCliente(MAR_ACC, MAR, 'marco@prova.it')
await lavaggio({ userId: MAR_ACC, eur: 60 })
ok((await carta(MAR)).punti === 60 && (await premi(MAR_ACC)).length === 0, 'cliente nuovo: 60/100')
await lavaggio({ userId: MAR_ACC, eur: 50 })
c = await carta(MAR)
ok((await premi(MAR_ACC)).length === 1 && c.punti === 10 && c.totale === 110, 'a 110: premio a 100, surplus 10 riportato')

tit('14. 2 EUR per punto')
await salvaCfg({ soglia_punti: 100, importo_premio: 10, euro_per_punto: 2 })
ok((await carta(GIU)).punti === 14 && (await carta(MAR)).punti === 10, 'chi era a meta carta tiene i suoi punti')
const NAD_ACC = 'd0000000-0000-0000-0000-000000000007', NAD = 'd0000000-0000-0000-0000-000000000008'
await nuovoCliente(NAD_ACC, NAD, 'nadia@prova.it')
await lavaggio({ userId: NAD_ACC, eur: 179 })
c = await carta(NAD)
ok(c.punti === 89 && c.totale === 89, `179 EUR = 89 punti (letto ${c.punti}/${c.totale})`)
await lavaggio({ userId: GIU_ACC, eur: 42 })
ok((await carta(GIU)).punti === 35, 'Giulia: 14 + 42 EUR / 2 = 35')

tit('15. Premio "codice sconto" anche per chi ha l account')
await salvaCfg({ soglia_punti: 100, importo_premio: 10, euro_per_punto: 2, tipo_premio: 'codice_sconto' })
const lottiMarco = await n('SELECT count(*) n FROM public.wallet_crediti_vincolati WHERE user_id=$1', [MAR_ACC])
await lavaggio({ userId: MAR_ACC, eur: 180 })
p = await premi(MAR_ACC)
ok(p.length === 2 && p[1].voucher_code && !p[1].lotto_id, 'premio n.2 di Marco = codice, nessun lotto')
const dcm = await uno('SELECT * FROM public.discount_codes WHERE code=$1', [p[1].voucher_code])
ok(Number(dcm.value_amount) === 10 && dcm.customer_email === 'marco@prova.it' && /EUR 10 .*\(100 punti\).*Valido 15 giorni/.test(dcm.usage_conditions), 'codice da 10 EUR intestato a Marco, testo coi valori in vigore')
ok(await n('SELECT count(*) n FROM public.wallet_crediti_vincolati WHERE user_id=$1', [MAR_ACC]) === lottiMarco, 'nessun credito wallet in piu')
ok((await carta(MAR)).punti === 0, 'Marco riparte da 0')
await salvaCfg({ soglia_punti: 100, importo_premio: 10, euro_per_punto: 2 })

tit('16. Soglia alzata da 100 a 400')
await salvaCfg({ soglia_punti: 400, importo_premio: 10, euro_per_punto: 2 })
ok((await carta(NAD)).punti === 89 && (await carta(GIU)).punti === 35, 'Nadia 89/400, Giulia 35/400')
await lavaggio({ userId: NAD_ACC, eur: 1 })
ok((await carta(NAD)).punti === 90, 'l euro avanzato prima del cambio non si perde: 180 EUR = 90')
await lavaggio({ userId: NAD_ACC, eur: 620 })
c = await carta(NAD)
ok((await premi(NAD_ACC)).length === 1 && c.punti === 0 && c.totale === 400, 'premio a 400, non prima')

tit('17. Programma spento e riacceso')
await salvaCfg({ attivo: false, soglia_punti: 400, importo_premio: 10, euro_per_punto: 2 })
premiTotali = await n('SELECT count(*) n FROM public.fidelity_buoni')
const giuSpento = await lavaggio({ userId: GIU_ACC, eur: 900 })
ok((await carta(GIU)).punti === 35, 'spento: la carta resta ferma')
ok(Number((await uno('SELECT public.dr7_punti_lavaggio_accredita($1) n', [giuSpento])).n) === 0, 'il sito che richiama accredita: 0')
ok(await n('SELECT count(*) n FROM public.fidelity_buoni') === premiTotali, 'spento: nessun premio')
ok(await n('SELECT count(*) n FROM public.fidelity_point_awards WHERE booking_id=$1', [giuSpento]) === 0, 'spento: nessun registro punti')
await salvaCfg({ attivo: true, soglia_punti: 400, importo_premio: 10, euro_per_punto: 2 })
ok(await n('SELECT count(*) n FROM public.fidelity_buoni') === premiTotali, 'riacceso: nessuna raffica di arretrati')
ok((await carta(GIU)).punti === 35, 'riacceso: Giulia riparte da 35')
await lavaggio({ userId: GIU_ACC, eur: 2 })
ok((await carta(GIU)).punti === 36, 'conta solo quello pagato dopo la riaccensione')
await lavaggio({ userId: GIU_ACC, eur: 728 })
c = await carta(GIU)
ok((await premi(GIU_ACC)).length === 2 && c.punti === 0, 'premio a 400 punti dopo la riaccensione')

tit('18. Lavaggio pagato prima del cambio, annullato dopo')
const totPrima = (await carta(GIU)).totale
await db.query(`UPDATE public.bookings SET status='cancelled' WHERE id=$1`, [giu100])
c = await carta(GIU)
ok(c.totale === totPrima - 50 && c.punti === 0 && (await premi(GIU_ACC)).length === 2, 'tolti 100 EUR = 50 punti al valore nuovo, nessun premio')

tit('19. Idempotenza dopo i cambi')
const fotoFine = await foto()
const verFine = await versione()
await db.exec(leggi('20261106_fidelity_lavaggio_da_centralina.sql'))
await salvaCfg({ attivo: true, soglia_punti: 400, importo_premio: 10, euro_per_punto: 2 })
ok(await foto() === fotoFine && await versione() === verFine, 'migrazione rilanciata e config risalvata: identico')
const emessi = await n(`SELECT coalesce(sum(public.dr7_punti_lavaggio_ricalcola(t)), 0) n FROM (SELECT DISTINCT coalesce(user_id, id) t FROM public.customers_extended) x`)
ok(emessi === 0 && await foto() === fotoFine, 'ricalcolo di tutte le carte: 0 premi, nessuna carta cambia')
await db.query(`UPDATE public.centralina_pro_config SET config = jsonb_set(config, '{fidelity_lavaggio}', $1::jsonb) WHERE id = 'business_lavaggio'`, [JSON.stringify({ ...DEF, soglia_punti: 5 })])
ok(await versione() === verFine, 'la riga di un altro business non cambia la regola')

tit('20. Sezione salvata PRIMA di eseguire la migrazione')
db = await nuovoDb()
const LU_ACC = 'e0000000-0000-0000-0000-000000000001', LU = 'e0000000-0000-0000-0000-000000000002'
await nuovoCliente(LU_ACC, LU, 'lucia@prova.it')
await lavaggio({ userId: LU_ACC, eur: 179 })
await db.exec(leggi('20261104_punti_lavaggio_credito_wallet.sql'))
await db.exec(leggi('20261105_punti_lavaggio_anche_per_email.sql'))
ok((await carta(LU)).punti === 179, 'Lucia a 179/250')
await salvaCfg({ soglia_punti: 100, importo_premio: 10 })
await db.exec(leggi('20261106_fidelity_lavaggio_da_centralina.sql'))
c = await carta(LU)
ok((await premi(LU_ACC)).length === 0 && c.punti === 99, `migrazione: regole salvate in vigore senza arretrati (99/100, letto ${c.punti})`)
ok(await versione() === 1, 'regola versione 1')
await lavaggio({ userId: LU_ACC, eur: 15 })
p = await premi(LU_ACC)
ok(p.length === 1 && Number(p[0].importo) === 10 && (await carta(LU)).punti === 14, 'primo lavaggio dopo: premio da 10, carta a 14')

console.log('\nSCENARIO COMPLETO: tutto verificato.')
