#!/usr/bin/env node
/**
 * verificaIscrizioneScheda.mjs — prova su Postgres in memoria (PGlite) che
 * l'iscrizione al sito agganci la scheda creata dall'ufficio invece di
 * crearne una doppia.
 *
 *   node scripts/verificaIscrizioneScheda.mjs
 *
 * Migrazione provata: 20260917180000_iscrizione_aggancia_scheda_esistente.sql
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
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.customers_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  nome text,
  telefono text,
  tipo_cliente text CHECK (tipo_cliente IN ('persona_fisica','azienda','pubblica_amministrazione')),
  residency_zone text,
  source text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
`)

const MIGRAZIONE = new URL('../supabase/migrations/20260917180000_iscrizione_aggancia_scheda_esistente.sql', import.meta.url)
await db.exec(fs.readFileSync(MIGRAZIONE, 'utf8'))
await db.exec(`
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_to_customers();
`)

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const iscrivi = async (email, meta = {}) =>
  (await q(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id`, [email, meta]))[0].id
const schede = async email => q(`SELECT * FROM customers_extended WHERE lower(btrim(email)) = lower(btrim($1))`, [email])

// 1. Scheda dell'ufficio con email in maiuscolo e spazi: l'iscrizione la aggancia.
await q(`INSERT INTO customers_extended (email, nome, source, tipo_cliente) VALUES (' Mario.Rossi@Mail.IT ', 'Mario', 'admin', 'persona_fisica')`)
let u = await iscrivi('mario.rossi@mail.it')
let r = await schede('mario.rossi@mail.it')
ok(r.length === 1, 'una sola scheda dopo l\'iscrizione')
ok(r[0].user_id === u, 'account agganciato alla scheda dell\'ufficio')
ok(r[0].nome === 'Mario' && r[0].source === 'admin', 'dati dell\'ufficio conservati')
ok(!!r[0].metadata.account_sito_agganciato_il, 'traccia dell\'aggancio nei metadata')

// 2. Nessuna scheda: se ne crea una nuova come prima.
u = await iscrivi('nuovo@mail.it')
r = await schede('nuovo@mail.it')
ok(r.length === 1 && r[0].user_id === u && r[0].source === 'website_registration', 'cliente nuovo: scheda creata')

// 3. Stesso telefono ma email diversa: MAI agganciare (regola Lead).
await q(`INSERT INTO customers_extended (email, telefono, nome, source) VALUES ('altro@mail.it', '3331234567', 'Luca', 'admin')`)
u = await iscrivi('diverso@mail.it', { telefono: '3331234567' })
ok((await schede('altro@mail.it'))[0].user_id === null, 'stesso telefono: scheda dell\'ufficio non toccata')
ok((await schede('diverso@mail.it')).length === 1, 'stesso telefono: nuova scheda per il nuovo account')

// 4. Tipo cliente diverso: niente aggancio.
await q(`INSERT INTO customers_extended (email, tipo_cliente, source) VALUES ('ditta@mail.it', 'azienda', 'admin')`)
u = await iscrivi('ditta@mail.it', { tipoCliente: 'persona_fisica' })
r = await schede('ditta@mail.it')
ok(r.length === 2 && r.some(x => x.user_id === null && x.tipo_cliente === 'azienda'), 'tipo diverso: azienda non fusa con persona fisica')

// 5. Scheda con account gia' presente: non si ruba l'account a nessuno.
const altro = await iscrivi('gia@mail.it')
u = await iscrivi('GIA@mail.it')
r = await schede('gia@mail.it')
ok(r.length === 2 && r.some(x => x.user_id === altro) && r.some(x => x.user_id === u), 'scheda gia\' con account: non riagganciata')

// 6. Tipo non indicato sulla scheda dell'ufficio: si aggancia e si completa il tipo.
await q(`INSERT INTO customers_extended (email, source) VALUES ('senzatipo@mail.it', 'admin')`)
u = await iscrivi('senzatipo@mail.it')
r = await schede('senzatipo@mail.it')
ok(r.length === 1 && r[0].user_id === u && r[0].tipo_cliente === 'persona_fisica', 'tipo mancante: agganciata e tipo completato')

// 7. Due schede dell'ufficio con la stessa email: si prende la piu' recente, l'altra resta.
await q(`INSERT INTO customers_extended (email, nome, source, updated_at) VALUES ('doppio@mail.it', 'Vecchia', 'admin', now() - interval '10 days')`)
await q(`INSERT INTO customers_extended (email, nome, source, updated_at) VALUES ('doppio@mail.it', 'Recente', 'admin', now())`)
u = await iscrivi('doppio@mail.it')
r = await schede('doppio@mail.it')
ok(r.length === 2 && r.find(x => x.nome === 'Recente').user_id === u && r.find(x => x.nome === 'Vecchia').user_id === null,
  'due candidate: agganciata la piu\' recente, nessuna nuova scheda')

// 8. Iscrizione senza email (es. telefono): nessun aggancio, scheda nuova.
u = await iscrivi(null)
ok((await q(`SELECT 1 FROM customers_extended WHERE user_id = $1`, [u])).length === 1, 'senza email: scheda nuova')

console.log('\nTutti i controlli superati.')
