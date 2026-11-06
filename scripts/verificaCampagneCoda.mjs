#!/usr/bin/env node
/**
 * verificaCampagneCoda.mjs — prova la migrazione 20261107 (coda degli invii
 * massivi WhatsApp) su un Postgres vero in memoria, senza toccare Supabase.
 *
 *   npm run campagne:verifica
 *
 * Controlla: tetto orario su tutte le campagne, fascia oraria, nessun
 * destinatario preso due volte, prese interrotte che NON tornano in coda da
 * sole, righe inviate prima della migrazione contate nel tetto, vincolo stato.
 * PGlite ha una sola connessione: la concorrenza vera (due giri insieme) la
 * copre il lock nel database (pg_advisory_xact_lock + SKIP LOCKED), qui si
 * verifica che lo stesso cliente non esca mai due volte.
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

// Tabelle come in produzione (colonne dall'inventario dello schema), con un
// vincolo sullo stato "vecchio" per provare che la migrazione lo sostituisce.
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text, status text, total_recipients int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  customer_id uuid, customer_name text, phone text, email text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error_message text, sent_at timestamptz, created_at timestamptz DEFAULT now()
);
`)

const MIGRAZIONE = new URL('../supabase/migrations/20261107_campagne_coda_frequenza.sql', import.meta.url)
const sql = fs.readFileSync(MIGRAZIONE, 'utf8')
await db.exec(sql)
// Idempotente: una seconda esecuzione non deve fallire.
await db.exec(sql)

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const uno = async (s, p) => (await q(s, p))[0]

const campagna = async (n, titolo) => {
  const c = await uno(`INSERT INTO marketing_campaigns (title, status, total_recipients) VALUES ($1,'pending',$2) RETURNING id`, [titolo, n])
  for (let i = 0; i < n; i++) {
    await db.query(`INSERT INTO marketing_campaign_recipients (campaign_id, customer_name, phone, created_at)
                    VALUES ($1, $2, $3, now() + make_interval(secs => $4))`, [c.id, `${titolo} ${i}`, `39333000${String(i).padStart(4, '0')}`, i])
  }
  return c.id
}
// Fascia sempre aperta nei test (0-24), salvo il test della fascia.
const prendi = async (id, limite = 50, da = 0, a = 24) =>
  (await uno(`SELECT public.campagne_prenota_destinatario($1, $2, $3, $4, 60, 15) AS r`, [id, limite, da, a])).r
const segnaInviato = id => db.query(`UPDATE marketing_campaign_recipients SET status='sent', sent_at=now() WHERE id=$1`, [id])

console.log('\n── 1. Vincolo stato ────────────────────────────────────────────')
const vincoli = await q(`SELECT conname FROM pg_constraint WHERE conrelid='public.marketing_campaign_recipients'::regclass AND contype='c'`)
ok(vincoli.length === 1 && vincoli[0].conname === 'marketing_campaign_recipients_status_check', 'resta un solo vincolo stato, quello nuovo')
const A = await campagna(60, 'A')
let errore = null
try { await db.query(`UPDATE marketing_campaign_recipients SET status='inventato' WHERE campaign_id=$1`, [A]) } catch (e) { errore = e }
ok(errore !== null, 'uno stato sconosciuto e\' rifiutato')

console.log('\n── 2. Tetto di 50 l\'ora, nessun doppione ───────────────────────')
const presi = new Set()
let r
for (let i = 0; i < 50; i++) {
  r = await prendi(A)
  ok(r.esito === 'preso', `presa ${i + 1}: preso`)
  ok(!presi.has(r.destinatario.id), `presa ${i + 1}: destinatario nuovo`)
  presi.add(r.destinatario.id)
  await segnaInviato(r.destinatario.id)
}
r = await prendi(A)
ok(r.esito === 'limite' && r.usati === 50, '51esima: tetto raggiunto')
const B = await campagna(5, 'B')
r = await prendi(B)
ok(r.esito === 'limite', 'il tetto vale per TUTTE le campagne insieme')
const ordine = await q(`SELECT customer_name FROM marketing_campaign_recipients WHERE campaign_id=$1 AND status='sent' ORDER BY sent_at, customer_name`, [A])
ok(ordine.length === 50, '50 inviati nella campagna A')

console.log('\n── 3. L\'ora scorre: si riparte ─────────────────────────────────')
await db.query(`UPDATE marketing_campaign_recipients SET claimed_at = claimed_at - interval '61 minutes', sent_at = sent_at - interval '61 minutes' WHERE status='sent'`)
r = await prendi(A)
ok(r.esito === 'preso' && !presi.has(r.destinatario.id), 'dopo un\'ora si riprende, con un destinatario nuovo')
const inCorso = r.destinatario.id

console.log('\n── 4. Fascia oraria ────────────────────────────────────────────')
r = await prendi(A, 50, 0, 0)
ok(r.esito === 'fuori_fascia', 'fuori fascia: nessuna presa')
const pendenti = await uno(`SELECT count(*)::int n FROM marketing_campaign_recipients WHERE campaign_id=$1 AND status='pending'`, [A])
ok(pendenti.n === 9, 'fuori fascia i destinatari restano in coda (9)')

console.log('\n── 5. Presa interrotta: niente rinvio automatico ───────────────')
await db.query(`UPDATE marketing_campaign_recipients SET claimed_at = now() - interval '16 minutes' WHERE id=$1`, [inCorso])
r = await prendi(A)
const interrotto = await uno(`SELECT status, error_message FROM marketing_campaign_recipients WHERE id=$1`, [inCorso])
ok(interrotto.status === 'failed' && /incerto/i.test(interrotto.error_message), 'presa scaduta = failed, esito incerto')
ok(r.esito === 'preso' && r.destinatario.id !== inCorso, 'la presa scaduta non viene ripresa')
await segnaInviato(r.destinatario.id)

console.log('\n── 6. Campagna finita, con un invio ancora in corso ────────────')
for (;;) {
  r = await prendi(A)
  if (r.esito !== 'preso') break
  await segnaInviato(r.destinatario.id)
}
ok(r.esito === 'vuoto' && r.in_corso === 0, 'A svuotata: vuoto, niente in corso')
r = await prendi(B)
ok(r.esito === 'preso', 'B parte')
const presoB = r.destinatario.id
await db.query(`UPDATE marketing_campaign_recipients SET status='sent', sent_at=now() WHERE campaign_id=$1 AND id<>$2`, [B, presoB])
r = await prendi(B)
ok(r.esito === 'vuoto' && r.in_corso === 1, 'B: niente in coda ma 1 in corso (la campagna non va chiusa)')

console.log('\n── 7. Righe inviate prima della migrazione contano nel tetto ───')
await db.query(`UPDATE marketing_campaign_recipients SET claimed_at = NULL, sent_at = now() - interval '2 hours'`)
const C = await campagna(3, 'C')
await db.query(`UPDATE marketing_campaign_recipients SET status='sent', sent_at=now(), claimed_at=NULL
                 WHERE id IN (SELECT id FROM marketing_campaign_recipients WHERE campaign_id=$1 LIMIT 2)`, [C])
r = await prendi(C, 2)
ok(r.esito === 'limite', 'inviati senza claimed_at (prima della migrazione) contano con sent_at')

console.log('\n── 8. Permessi ─────────────────────────────────────────────────')
const perm = await uno(`SELECT has_function_privilege('authenticated', 'public.campagne_prenota_destinatario(uuid,integer,integer,integer,integer,integer)', 'EXECUTE') AS a,
                               has_function_privilege('service_role', 'public.campagne_prenota_destinatario(uuid,integer,integer,integer,integer,integer)', 'EXECUTE') AS s`)
ok(!perm.a && perm.s, 'solo il server (service_role) prenota i destinatari')

console.log('\nTutto verde.')
