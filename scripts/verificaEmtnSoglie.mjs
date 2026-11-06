#!/usr/bin/env node
/**
 * verificaEmtnSoglie.mjs — prova su un Postgres vero, in memoria, la
 * migrazione 20261107_emtn_soglie.sql: blocco delle prenotazioni dal sito
 * sotto la soglia EMTN di Centralina Pro, soglie spente di default, fail open,
 * cliente riconosciuto solo per id, schede da ricalcolare.
 *
 *   npm run emtn:soglie
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
CREATE TABLE public.admins (user_id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION public.dr7_is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()) $$;
CREATE TABLE public.centralina_pro_config (id text PRIMARY KEY, config jsonb NOT NULL DEFAULT '{}'::jsonb);
INSERT INTO public.centralina_pro_config VALUES ('main', '{"site_copy":{"x":1}}');
CREATE TABLE public.customers_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, codice_fiscale text, nome text
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, service_type text, status text,
  payment_status text, nexi_order_id text, booking_details jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.pending_nexi_bookings (nexi_order_id text PRIMARY KEY, booking_data jsonb NOT NULL);
CREATE TABLE public.system_alarms (
  id text PRIMARY KEY, label text, schedule text, reason text, category text, threshold_value numeric,
  threshold_unit text, is_enabled boolean, sort_order int, group_key text, priority text, reparto text,
  detector text, stato_rilevamento text, ripeti_finche_non_risolto boolean, ripeti_ogni_minuti int,
  notifica_gestionale boolean, notifica_push boolean, notifica_whatsapp_interna boolean,
  notifica_email_interna boolean, destinatari jsonb, sound_key text, suono_continuo boolean,
  messaggio_cliente_auto boolean
);
`

const leggi = (f) => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }

const db = new PGlite()
await db.exec(SCHEMA)

// Prima della migrazione: il sito prenota come sempre (nessun trigger).
const CLIENTE = '11111111-1111-4111-8111-111111111111'
const SCHEDA = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'
const NUOVO = '44444444-4444-4444-8444-444444444444'
const ALTRO = '55555555-5555-4555-8555-555555555555'

await db.exec(leggi('20261107_emtn_soglie.sql'))
await db.exec(leggi('20261107_emtn_soglie.sql'))
ok(true, 'migrazione idempotente (eseguita due volte)')

const comeCliente = async (sub, ruolo = 'authenticated') =>
  db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(sub ? { sub, role: ruolo } : { role: ruolo })])
const comeServizio = async () => db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })])
const soglie = async (emtn) => {
  await comeServizio()
  await db.query(`UPDATE public.centralina_pro_config SET config = config || jsonb_build_object('emtn', $1::jsonb) WHERE id = 'main'`, [JSON.stringify(emtn)])
}
const score = async (id, s) => {
  await comeServizio()
  await db.query(`INSERT INTO public.emtn_score_clienti (persona_id, codice_fiscale, score, livello, band, versione)
                  VALUES ($1, 'RSSMRA80A01H501U', $2, 'Critical', 'red', 'emtn-score-2.0.0')
                  ON CONFLICT (persona_id) DO UPDATE SET score = EXCLUDED.score`, [id, s])
}
/** Prova un INSERT su bookings; ritorna null se passa, altrimenti il messaggio. */
const prenota = async (sub, riga = {}, tabella = 'bookings') => {
  await comeCliente(sub)
  try {
    if (tabella === 'bookings') {
      await db.query(`INSERT INTO public.bookings (user_id, service_type, status, payment_status, nexi_order_id)
                      VALUES ($1, $2, 'pending', $3, $4)`,
        [riga.user_id ?? sub, riga.service_type ?? 'car_rental', riga.payment_status ?? 'pending', riga.nexi_order_id ?? null])
    } else {
      await db.query(`INSERT INTO public.pending_nexi_bookings (nexi_order_id, booking_data) VALUES ($1, $2)`,
        [`ord-${Math.random()}`, JSON.stringify({ user_id: riga.user_id ?? sub, service_type: riga.service_type ?? 'car_rental' })])
    }
    return null
  } catch (e) {
    return String(e.message || e)
  }
}

// ── Soglie spente (default) ────────────────────────────────────────────────
await score(CLIENTE, 5)
ok(await prenota(CLIENTE) === null, 'senza soglie: anche un cliente a 5 prenota')
await soglie({ soglia_allarme: 50 })
ok(await prenota(CLIENTE) === null, 'solo soglia allarme: il blocco resta spento')
for (const v of [0, 101, 'abc', '', null, 12.5]) {
  await soglie({ soglia_blocco: v })
  ok(await prenota(CLIENTE) === null, `soglia blocco ${JSON.stringify(v)} = spenta`)
}

// ── Soglia di blocco 20 ────────────────────────────────────────────────────
await soglie({ soglia_allarme: 50, soglia_blocco: 20 })
let err = await prenota(CLIENTE)
ok(err && err.startsWith('EMTN_BLOCCO:'), 'cliente a 5 con soglia 20: noleggio rifiutato con EMTN_BLOCCO')
ok(err.includes('Contatta DR7'), 'messaggio predefinito per il cliente')
ok((await prenota(CLIENTE, {}, 'pending_nexi_bookings'))?.startsWith('EMTN_BLOCCO:'), 'rifiutato anche prima del pagamento Nexi (pending_nexi_bookings)')
ok(await prenota(CLIENTE, { service_type: 'car_wash' }) === null, 'il lavaggio non e toccato')
ok(await prenota(CLIENTE, { service_type: 'boat_rental' }) === null, 'Noleggio Mare non e toccato')
ok(await prenota(CLIENTE, { service_type: 'mechanical_service' }) === null, 'la meccanica non e toccata')
ok((await prenota(CLIENTE, { service_type: null }))?.startsWith('EMTN_BLOCCO:'), 'service_type vuoto = noleggio auto: rifiutato')
ok(await prenota(CLIENTE, { nexi_order_id: 'x', payment_status: 'paid' }) === null, 'Nexi gia pagato: la prenotazione si registra')

await score(CLIENTE, 20)
ok(await prenota(CLIENTE) === null, 'score uguale alla soglia (20): passa (solo sotto blocca)')
await score(CLIENTE, 19)
ok((await prenota(CLIENTE))?.startsWith('EMTN_BLOCCO:'), 'score 19: rifiutato')

// Messaggio scelto in Centralina.
await soglie({ soglia_blocco: 20, messaggio_blocco: 'Chiamaci al numero DR7.' })
ok(await prenota(CLIENTE) === 'EMTN_BLOCCO: Chiamaci al numero DR7.', 'messaggio della Centralina')
await soglie({ soglia_allarme: 50, soglia_blocco: 20 })

// ── Chi passa sempre ───────────────────────────────────────────────────────
await comeServizio()
await db.query('INSERT INTO public.admins (user_id) VALUES ($1)', [STAFF])
await score(STAFF, 1)
ok(await prenota(STAFF) === null, 'lo staff prenota sempre')
{
  // service role (nexi-callback dopo il pagamento) per conto del cliente bloccato
  await comeServizio()
  let e2 = null
  try { await db.query(`INSERT INTO public.bookings (user_id, service_type) VALUES ($1, 'car_rental')`, [CLIENTE]) } catch (e) { e2 = e.message }
  ok(e2 === null, 'service role (nexi-callback) passa sempre')
}
{
  await comeCliente(null, 'anon')
  let e3 = null
  try { await db.query(`INSERT INTO public.bookings (user_id, service_type) VALUES ($1, 'car_rental')`, [CLIENTE]) } catch (e) { e3 = e.message }
  ok(e3 === null, 'anon senza identita: nel dubbio si prenota')
}
ok(await prenota(NUOVO) === null, 'cliente nuovo senza punteggio salvato: prenota (fail open)')

// ── Per id: account del sito -> scheda del gestionale ──────────────────────
await comeServizio()
await db.query('INSERT INTO public.customers_extended (id, user_id, codice_fiscale, nome) VALUES ($1, $2, $3, $4)', [SCHEDA, ALTRO, 'RSSMRA80A01H501U', 'Mario'])
await score(SCHEDA, 10)
ok((await prenota(ALTRO))?.startsWith('EMTN_BLOCCO:'), 'punteggio salvato sulla scheda: blocca anche l account collegato (user_id)')
await comeServizio()
await db.query(`INSERT INTO public.customers_extended (user_id, codice_fiscale, nome) VALUES (NULL, NULL, 'Mario')`)
ok(await prenota(NUOVO) === null, 'stesso nome di un cliente bloccato ma altro id: prenota')

// ── Fail open: tabella assente o errore ────────────────────────────────────
await comeServizio()
await db.exec('ALTER TABLE public.emtn_score_clienti RENAME TO emtn_score_clienti_x')
ok(await prenota(CLIENTE) === null, 'tabella dei punteggi assente: si prenota')
await db.exec('ALTER TABLE public.emtn_score_clienti_x RENAME TO emtn_score_clienti')
await comeServizio()
await db.query(`UPDATE public.centralina_pro_config SET config = config - 'emtn' WHERE id = 'main'`)
ok(await prenota(CLIENTE) === null, 'chiave emtn tolta dalla Centralina: si prenota')
await soglie({ soglia_allarme: 50, soglia_blocco: 20 })

// ── Il resto della config non si tocca ─────────────────────────────────────
await comeServizio()
const cfg = (await db.query(`SELECT config FROM public.centralina_pro_config WHERE id='main'`)).rows[0].config
ok(cfg.site_copy?.x === 1, 'site_copy intatto')

// ── Schede da ricalcolare ──────────────────────────────────────────────────
await comeServizio()
await db.query(`INSERT INTO public.customers_extended (id, codice_fiscale, nome) VALUES
  ('66666666-6666-4666-8666-666666666666', 'vrdgpp70b02f205x', 'Giuseppe'),
  ('77777777-7777-4777-8777-777777777777', 'NONVALIDO', 'Anna'),
  ('88888888-8888-4888-8888-888888888888', 'BNCLRA85C43 F205Z', 'Laura')`)
let da = (await db.query(`SELECT customer_id FROM public.dr7_emtn_score_da_ricalcolare(10, 168)`)).rows.map(r => r.customer_id)
ok(da.includes('66666666-6666-4666-8666-666666666666'), 'scheda mai calcolata (CF minuscolo) da ricalcolare')
ok(da.includes('88888888-8888-4888-8888-888888888888'), 'CF con spazio accettato come fa il codice')
ok(!da.includes('77777777-7777-4777-8777-777777777777'), 'CF malformato escluso (non resta in testa per sempre)')
ok(!da.includes(SCHEDA), 'scheda calcolata da poco esclusa')
await db.query(`UPDATE public.emtn_score_clienti SET calcolato_il = now() - interval '8 days' WHERE persona_id = $1`, [SCHEDA])
da = (await db.query(`SELECT customer_id FROM public.dr7_emtn_score_da_ricalcolare(10, 168)`)).rows.map(r => r.customer_id)
ok(da.includes(SCHEDA), 'scheda calcolata 8 giorni fa: di nuovo da ricalcolare')
ok(da[da.length - 1] === SCHEDA, 'le mai calcolate vengono prima')

// ── Soglie lette dal database ──────────────────────────────────────────────
const s = (await db.query(`SELECT * FROM public.dr7_emtn_soglie()`)).rows[0]
ok(s.soglia_allarme === 50 && s.soglia_blocco === 20 && s.messaggio_blocco === null, 'dr7_emtn_soglie legge la Centralina')

// ── Allarme del catalogo ───────────────────────────────────────────────────
const a = (await db.query(`SELECT detector, is_enabled, stato_rilevamento FROM public.system_alarms WHERE id='cli_emtn_sotto_soglia'`)).rows[0]
ok(a?.detector === 'emtn_sotto_soglia' && a.is_enabled && a.stato_rilevamento === 'attivo', 'allarme cli_emtn_sotto_soglia nel catalogo')

console.log('\nTutto verde.')
