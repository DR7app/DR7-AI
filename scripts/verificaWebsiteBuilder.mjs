#!/usr/bin/env node
/**
 * verificaWebsiteBuilder.mjs — prova la migrazione SQL su un Postgres
 * vero, in memoria, senza toccare Supabase.
 *
 *   npm run wb:verifica
 *
 * Perche' esiste: la migrazione contiene la logica su cui poggia tutto —
 * permessi, pubblicazione atomica, ripristino, isolamento fra aziende.
 * Un errore li' non si vede in nessun test dell'interfaccia, si vede sul
 * sito. Qui lo scenario viene eseguito per intero: importazione, prima
 * pubblicazione, modifica che NON deve andare online, sostituzione di una
 * pagina esistente, ripristino, pubblicazione respinta.
 *
 * Gira su @electric-sql/pglite (devDependency): Postgres compilato in
 * WebAssembly, nessun servizio da avviare e nessuna connessione di rete.
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
CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '11111111-1111-1111-1111-111111111111'::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"email":"salvatore@dr7.app"}'::jsonb $$;
CREATE TABLE public.admins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role text, permissions jsonb DEFAULT '[]'::jsonb, nome text, archived_at timestamptz);
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
`)
const sql = fs.readFileSync(new URL('../supabase/migrations/20260904_website_builder.sql', import.meta.url), 'utf8')
  .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/, '')
await db.exec(sql)

const ok = (c, m) => console.log(`${c ? 'OK  ' : 'KO  '} ${m}`) || (!c && process.exit(1))
const site = (await db.query(`SELECT id FROM wb_sites WHERE key='dr7'`)).rows[0].id

// ── 1. Permessi granulari
await db.query(`INSERT INTO public.admins (user_id, role, permissions) VALUES ($1,'admin','["website.edit"]'::jsonb)`, ['11111111-1111-1111-1111-111111111111'])
ok((await db.query(`SELECT public.wb_puo_leggere() a`)).rows[0].a === true, 'website.edit implica la lettura')
ok((await db.query(`SELECT public.wb_puo_scrivere() a`)).rows[0].a === true, 'website.edit puo scrivere')
ok((await db.query(`SELECT public.wb_puo_pubblicare() a`)).rows[0].a === false, 'website.edit NON puo pubblicare')
try { await db.query(`SELECT public.wb_publish_site($1)`, [site]); process.exit(1) }
catch { console.log('OK   la pubblicazione senza diritto viene respinta') }

// ── 2. Importazione: pagine in bozza, override spento
await db.query(`INSERT INTO wb_pages (site_id, slug, title, status, is_home, overrides_route, draft_content)
  VALUES ($1,'/','Home','draft',true,false,'{"sections":[{"id":"h1","type":"hero-slider","content":{"title":{"it":"DR7"}}}]}'::jsonb)`, [site])
await db.query(`INSERT INTO wb_pages (site_id, slug, title, status, overrides_route, draft_content)
  VALUES ($1,'/promo-estate','Promo','draft',false,'{"sections":[]}'::jsonb)`, [site])

await db.query(`UPDATE public.admins SET permissions='["website.edit","website.publish"]'::jsonb`)
let r = (await db.query(`SELECT public.wb_publish_site($1,$2) x`, [site,'Dopo importazione'])).rows[0].x
ok(r.pages === 0, 'pubblicando dopo l importazione nessuna pagina va online (sono bozze)')
let pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(pub.pages.length === 0, 'il sito pubblico non vede nessuna pagina: identico a prima')

// ── 3. L'operatore pubblica la promo (indirizzo nuovo)
await db.query(`UPDATE wb_pages SET status='published' WHERE slug='/promo-estate'`)
r = (await db.query(`SELECT public.wb_publish_site($1,$2) x`, [site,'Promo estate'])).rows[0].x
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(pub.pages.length === 1 && pub.pages[0].slug === '/promo-estate', 'la promo e online, la home no')
ok(pub.pages[0].overrides_route === false, 'la promo non sostituisce niente: e un indirizzo nuovo')

// ── 4. Modificare una pagina pubblicata NON cambia il sito
await db.query(`UPDATE wb_pages SET draft_content='{"sections":[{"id":"x","type":"cta"}]}'::jsonb WHERE slug='/promo-estate'`)
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(pub.pages[0].content.sections.length === 0, 'la modifica resta nella bozza: il sito non cambia')
r = (await db.query(`SELECT public.wb_publish_site($1,$2) x`, [site,'Promo v2'])).rows[0].x
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(pub.pages[0].content.sections.length === 1, 'dopo Pubblica la modifica e online')

// ── 5. Sostituzione della home, con interruttore
await db.query(`UPDATE wb_pages SET status='published', overrides_route=true WHERE slug='/'`)
await db.query(`SELECT public.wb_publish_site($1,$2)`, [site,'Home dal builder'])
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
const home = pub.pages.find(p => p.slug === '/')
ok(home && home.overrides_route === true, 'la home ora prende il posto della pagina React')

// ── 6. Ripristino
const v = (await db.query(`SELECT id, number, label FROM wb_versions WHERE site_id=$1 ORDER BY number`, [site])).rows
const daRipristinare = v.find(x => x.label === 'Promo estate')
await db.query(`SELECT public.wb_restore_version($1)`, [daRipristinare.id])
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(pub.pages.length === 1 && pub.pages[0].content.sections.length === 0, 'ripristino: il sito torna alla versione scelta')
const bozza = (await db.query(`SELECT draft_content FROM wb_pages WHERE slug='/promo-estate'`)).rows[0].draft_content
ok(bozza.sections.length === 1, 'il ripristino NON tocca la bozza su cui si stava lavorando')
const dopo = (await db.query(`SELECT count(*)::int n FROM wb_versions WHERE site_id=$1`, [site])).rows[0].n
ok(dopo === v.length + 1, 'il ripristino crea una versione nuova: lo storico non si riscrive')

// ── 7. Validazione bloccante
await db.query(`INSERT INTO wb_pages (site_id, slug, title, status, draft_content) VALUES ($1,'','Rotta','published','{"sections":[]}'::jsonb)`, [site])
try { await db.query(`SELECT public.wb_publish_site($1)`, [site]); process.exit(1) }
catch (e) { ok(/senza slug/.test(e.message), 'una pagina senza indirizzo blocca la pubblicazione') }
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(pub.pages.length === 1, 'dopo il fallimento resta online la versione precedente')
await db.query(`DELETE FROM wb_pages WHERE slug=''`)

// ── 8. Vincoli
try { await db.query(`INSERT INTO wb_pages (site_id, slug, title) VALUES ($1,'/','Doppia')`, [site]); process.exit(1) }
catch { console.log('OK   due pagine con lo stesso indirizzo sono impossibili') }
try { await db.query(`INSERT INTO wb_pages (site_id, slug, title, is_home) VALUES ($1,'/altra','X',true)`, [site]); process.exit(1) }
catch { console.log('OK   due home sono impossibili') }
try { await db.query(`INSERT INTO wb_pages (site_id, slug, title, status) VALUES ($1,'/y','Y','inventato')`, [site]); process.exit(1) }
catch { console.log('OK   uno stato inventato viene rifiutato') }

// ── 9. Isolamento fra aziende
await db.query(`INSERT INTO wb_sites (tenant_id, key, name) VALUES ('altra','dr7','Altro cliente')`)
const altro = (await db.query(`SELECT id FROM wb_sites WHERE tenant_id='altra'`)).rows[0].id
await db.query(`INSERT INTO wb_pages (site_id, slug, title, status, draft_content) VALUES ($1,'/segreta','Segreta','published','{"sections":[]}'::jsonb)`, [altro])
await db.query(`SELECT public.wb_publish_site($1)`, [altro])
pub = (await db.query(`SELECT public.wb_public_site('dr7','dr7') s`)).rows[0].s
ok(!pub.pages.some(p => p.slug === '/segreta'), 'il sito DR7 non vede le pagine di un altro cliente')
const altroPub = (await db.query(`SELECT public.wb_public_site('dr7','altra') s`)).rows[0].s
ok(altroPub.pages.some(p => p.slug === '/segreta'), "l'altro cliente vede le sue")

// ── 10. Bucket e audit
const b = (await db.query(`SELECT public, file_size_limit FROM storage.buckets WHERE id='website-media'`)).rows[0]
ok(b.public === true, 'il bucket dei media e in lettura pubblica')
const azioni = (await db.query(`SELECT action, count(*)::int n FROM wb_audit_log GROUP BY action ORDER BY action`)).rows
console.log('OK   registro:', azioni.map(a => `${a.action}×${a.n}`).join(', '))

console.log('\nSCENARIO COMPLETO: tutto verificato.')
