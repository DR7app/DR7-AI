#!/usr/bin/env node
/**
 * verificaPrevendite.mjs — prova la migrazione delle Prevendite su un
 * Postgres vero, in memoria, senza toccare Supabase.
 *
 *   npm run prevendite:verifica
 *
 * Perche' esiste: le regole delle prevendite stanno TUTTE nel database —
 * vincoli, scalo dell'utilizzo, ripristino, permessi. Un errore li' non lo
 * vede nessun test dell'interfaccia: lo vede il cliente che prenota. Qui lo
 * scenario viene eseguito per intero, dalla creazione del pacchetto fino
 * all'ultimo utilizzo, comprese le strade storte.
 *
 * Il trigger su `bookings` merita un capitolo a parte (sezione 7): sta sulla
 * tabella delle PRENOTAZIONI, quindi un suo errore non gestito farebbe
 * fallire la prenotazione stessa. Non deve poter succedere mai.
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

// Doppioni di cio' che su Supabase c'e' gia': i ruoli, il token dell'utente
// collegato, le due funzioni di ruolo della migrazione 20260809020000 e la
// tabella delle prenotazioni (solo le colonne che il trigger tocca).
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth._ctx (uid uuid, email text);
INSERT INTO auth._ctx VALUES (NULL, NULL);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth._ctx LIMIT 1 $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('email', (SELECT email FROM auth._ctx LIMIT 1)) $$;
CREATE FUNCTION public.dr7_is_direzione() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(auth.jwt()->>'email','')) = 'ophe@dr7.app' $$;
CREATE FUNCTION public.dr7_admin_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text, payment_status text,
  pickup_date timestamptz, dropoff_date timestamptz,
  vehicle_id text, vehicle_name text,
  booking_details jsonb DEFAULT '{}'::jsonb
);
`)

const MIGRAZIONE = new URL('../supabase/migrations/20260914000000_prevendite.sql', import.meta.url)
await db.exec(fs.readFileSync(MIGRAZIONE, 'utf8'))

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const uno = async (s, p) => (await q(s, p))[0]
const chi = (uid, email) => db.query(`UPDATE auth._ctx SET uid=$1, email=$2`, [uid, email])

const CLIENTE = '11111111-1111-1111-1111-111111111111'
const ALTRO   = '22222222-2222-2222-2222-222222222222'
const prenota = async (bd, opts = {}) => uno(
  `INSERT INTO bookings (status, payment_status, pickup_date, dropoff_date, vehicle_id, vehicle_name, booking_details)
   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [opts.status ?? 'confirmed', opts.pagamento ?? 'paid', opts.dal ?? null, opts.al ?? null,
   opts.veicoloId ?? null, opts.veicolo ?? null, bd])
const residui = async id => (await uno(`SELECT utilizzi_iniziali - utilizzi_usati AS n FROM prevendite_clienti WHERE id=$1`, [id])).n
const stato   = async id => (await uno(`SELECT public.prevendita_stato_reale(p) AS s FROM prevendite_clienti p WHERE id=$1`, [id])).s

console.log('\n── 1. La direzione crea la prevendita ──────────────────────────')
const cat = await uno(`
  INSERT INTO prevendite (nome, prezzo, prezzo_listino, utilizzi_inclusi, veicoli, km_inclusi,
                          assicurazione_inclusa, validita_mesi, max_utilizzi_mese, max_giorni_consecutivi, posti_totali)
  VALUES ('Ferrari 296 GTB - 10 Experience', 2900, 12000, 10,
          '[{"id":"veh-296","nome":"Ferrari 296 GTB","targa":"GA123AA"}]'::jsonb,
          100, 'Kasko Base', 12, 3, 2, 5)
  RETURNING id, nome`)
ok(!!cat.id, `catalogo: "${cat.nome}" — 10 utilizzi, 100 km, max 3/mese, max 2 giorni`)

console.log('\n── 2. Il cliente compra sul sito ───────────────────────────────')
await chi(CLIENTE, 'cliente@dr7.app')
const pc = await uno(`
  INSERT INTO prevendite_clienti (prevendita_id, user_id, customer_email, nome, prezzo_pagato,
    utilizzi_iniziali, veicoli, km_inclusi, assicurazione_inclusa, max_utilizzi_mese,
    max_giorni_consecutivi, payment_status, nexi_order_id)
  SELECT id, $1, 'cliente@dr7.app', nome, prezzo, utilizzi_inclusi, veicoli, km_inclusi,
         assicurazione_inclusa, max_utilizzi_mese, max_giorni_consecutivi, 'pending', 'DR7PVTEST'
    FROM prevendite WHERE id = $2
  RETURNING id`, [CLIENTE, cat.id])
ok(await residui(pc.id) === 10, 'la riga nasce in attesa di pagamento, con 10 utilizzi')

let v = (await uno(`SELECT prevendita_verifica($1,'2026-10-01','2026-10-02','veh-296') r`, [pc.id])).r
ok(v.ok === false && v.stato === 'in_attesa', 'prima di pagare non e spendibile')

await chi(null, null) // il server (service_role): niente auth.uid()
await db.query(`SELECT prevendita_attiva_pagamento($1,'nexi')`, [pc.id])
await chi(CLIENTE, 'cliente@dr7.app')
const dopo = await uno(`SELECT stato, payment_status, data_scadenza FROM prevendite_clienti WHERE id=$1`, [pc.id])
ok(dopo.payment_status === 'succeeded' && dopo.stato === 'attiva', 'dopo il pagamento e attiva')
ok(new Date(dopo.data_scadenza) > new Date(), 'la scadenza e a 12 mesi')
ok((await uno(`SELECT posti_venduti n FROM prevendite WHERE id=$1`, [cat.id])).n === 1, 'la disponibilita scala di uno')

console.log('\n── 3. I vincoli, prima che il cliente scelga le date ───────────')
v = (await uno(`SELECT prevendita_verifica($1,'2026-10-01','2026-10-02','veh-296') r`, [pc.id])).r
ok(v.ok === true && v.km_inclusi === 100, '1 giorno sulla Ferrari: si puo')
v = (await uno(`SELECT prevendita_verifica($1,'2026-10-01','2026-10-05','veh-296') r`, [pc.id])).r
ok(v.ok === false && /2 giorni consecutivi/.test(v.errore), `4 giorni: rifiutato — "${v.errore}"`)
v = (await uno(`SELECT prevendita_verifica($1,'2026-10-01','2026-10-02','veh-urus') r`, [pc.id])).r
ok(v.ok === false, 'su un altro veicolo: rifiutato')
v = (await uno(`SELECT prevendita_verifica($1,'2026-10-01','2026-10-02','veh-ALTRO-ESEMPLARE','ferrari  296   gtb') r`, [pc.id])).r
ok(v.ok === true, 'stesso modello con id diverso (auto raggruppate): accettato per nome')
v = (await uno(`SELECT prevendita_verifica($1,'2028-01-01','2028-01-02','veh-296') r`, [pc.id])).r
ok(v.ok === false && /scade/.test(v.errore), 'oltre la scadenza: rifiutato')

console.log('\n── 4. Prenota: l utilizzo si scala da solo ─────────────────────')
const b1 = await prenota(`{"prevendita_cliente_id":"${pc.id}"}`,
  { status: 'pending', pagamento: 'pending', dal: '2026-10-01T10:30:00Z', al: '2026-10-02T09:00:00Z', veicoloId: 'veh-296', veicolo: 'Ferrari 296 GTB' })
ok(await residui(pc.id) === 10, 'prenotazione ancora in attesa: nessun utilizzo tolto')
await db.query(`UPDATE bookings SET status='confirmed' WHERE id=$1`, [b1.id])
ok(await residui(pc.id) === 9, 'alla conferma l utilizzo si scala: 9 disponibili')
await db.query(`UPDATE bookings SET payment_status='paid' WHERE id=$1`, [b1.id])
ok(await residui(pc.id) === 9, 'la stessa prenotazione non scala due volte (webhook + browser)')

console.log('\n── 5. Il tetto mensile lo tiene il database ────────────────────')
await prenota(`{"prevendita_cliente_id":"${pc.id}"}`, { dal: '2026-10-08T10:30:00Z', al: '2026-10-09T09:00:00Z', veicoloId: 'veh-296', veicolo: 'Ferrari 296 GTB' })
await prenota(`{"prevendita_cliente_id":"${pc.id}"}`, { dal: '2026-10-15T10:30:00Z', al: '2026-10-16T09:00:00Z', veicoloId: 'veh-296', veicolo: 'Ferrari 296 GTB' })
ok(await residui(pc.id) === 7, 'tre utilizzi in ottobre: 7 disponibili')
v = (await uno(`SELECT prevendita_verifica($1,'2026-10-22','2026-10-23','veh-296') r`, [pc.id])).r
ok(v.ok === false && /al mese/.test(v.errore), `il quarto in ottobre e rifiutato — "${v.errore}"`)
await prenota(`{"prevendita_cliente_id":"${pc.id}"}`, { dal: '2026-10-22T10:30:00Z', al: '2026-10-23T09:00:00Z', veicoloId: 'veh-296', veicolo: 'Ferrari 296 GTB' })
ok(await residui(pc.id) === 7, 'e anche forzando la prenotazione l utilizzo NON viene tolto')
v = (await uno(`SELECT prevendita_verifica($1,'2026-11-03','2026-11-04','veh-296') r`, [pc.id])).r
ok(v.ok === true, 'a novembre il conteggio riparte')

console.log('\n── 6. Annullamento: decide la direzione, non il sistema ────────')
await db.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [b1.id])
ok(await residui(pc.id) === 7, "annullando, l'utilizzo NON torna da solo")
const mov = await uno(`SELECT id FROM prevendite_movimenti WHERE booking_id=$1 AND tipo='scalo'`, [b1.id])
await chi(null, null)
await db.query(`SELECT prevendita_ripristina($1,'Annullata nei termini','gestionale')`, [mov.id])
ok(await residui(pc.id) === 8, 'la direzione lo ripristina: 8 disponibili')
await db.query(`SELECT prevendita_ripristina($1,NULL,'gestionale')`, [mov.id])
ok(await residui(pc.id) === 8, 'ripristinarlo due volte non regala utilizzi')
v = (await uno(`SELECT prevendita_verifica($1,'2026-10-28','2026-10-29','veh-296') r`, [pc.id])).r
ok(v.ok === true, "l'utilizzo ripristinato non pesa piu' sul tetto di ottobre")

console.log('\n── 7. Il trigger non puo MAI rompere una prenotazione ──────────')
const prima = (await uno(`SELECT count(*)::int n FROM bookings`)).n
await prenota(`{}`, { veicolo: 'Panda', dal: 'now()', al: 'now()' }).catch(() => null)
await db.query(`INSERT INTO bookings (status,payment_status,vehicle_name,booking_details) VALUES ('confirmed','paid','Clio',NULL)`)
await prenota(`{"prevendita_cliente_id":"non-un-uuid"}`, { dal: '2026-11-01T10:00:00Z', al: '2026-11-02T10:00:00Z', veicolo: 'Urus' })
await prenota(`{"prevendita_cliente_id":"99999999-9999-9999-9999-999999999999"}`, { dal: '2026-11-01T10:00:00Z', al: '2026-11-02T10:00:00Z', veicolo: 'Urus' })
await prenota(`{"prevendita_cliente_id":"${pc.id}"}`, { veicolo: 'Ferrari 296 GTB' }) // senza date
const dopoN = (await uno(`SELECT count(*)::int n FROM bookings`)).n
ok(dopoN - prima === 5, 'prenotazione normale, dettagli vuoti, id storto, prevendita inesistente, date mancanti: tutte salvate')
ok(await residui(pc.id) === 8, 'e nessuna di queste ha toccato gli utilizzi')

console.log('\n── 8. Nessuno puo spendere la prevendita di un altro ───────────')
await chi(ALTRO, 'altro@dr7.app')
v = (await uno(`SELECT prevendita_verifica($1,'2026-12-01','2026-12-02','veh-296') r`, [pc.id])).r
ok(v.ok === false, 'un altro cliente non la vede nemmeno')
v = (await uno(`SELECT prevendita_usa($1,gen_random_uuid(),'2026-12-01','2026-12-02','veh-296',NULL) r`, [pc.id])).r
ok(v.ok === false, 'e non puo scalarla')
v = (await uno(`SELECT prevendita_rettifica($1, 99, NULL, 'tentativo') r`, [pc.id])).r
ok(v.ok === false && /gestionale/.test(v.errore), 'ne puo regalarsi utilizzi')
ok(await residui(pc.id) === 8, 'gli utilizzi sono rimasti 8')

console.log('\n── 9. Rettifica manuale della direzione ────────────────────────')
await chi(null, null)
await db.query(`SELECT prevendita_rettifica($1, 2, 'Accordo commerciale', 'direzione')`, [pc.id])
ok(await residui(pc.id) === 2, 'la direzione porta i residui a 2')
await db.query(`SELECT prevendita_rettifica($1, 0, NULL, 'direzione')`, [pc.id])
ok(await stato(pc.id) === 'terminata', 'a zero residui la prevendita risulta terminata')

console.log('\n── 10. Stati, blocco e registro ────────────────────────────────')
await db.query(`UPDATE prevendite_clienti SET stato='bloccata' WHERE id=$1`, [pc.id])
ok(await stato(pc.id) === 'bloccata', 'la direzione puo bloccarla')
await db.query(`UPDATE prevendite_clienti SET stato='attiva', utilizzi_usati=0, data_scadenza=NOW() - INTERVAL '1 day' WHERE id=$1`, [pc.id])
ok(await stato(pc.id) === 'scaduta', 'una scaduta risulta scaduta anche senza nessun cron')
const reg = await q(`SELECT tipo, count(*)::int n FROM prevendite_movimenti WHERE prevendita_cliente_id=$1 GROUP BY tipo ORDER BY tipo`, [pc.id])
console.log('OK   registro:', reg.map(r => `${r.tipo}×${r.n}`).join(', '))

console.log('\n── 11. La migrazione si puo rilanciare ─────────────────────────')
await db.exec(fs.readFileSync(MIGRAZIONE, 'utf8'))
ok(await residui(pc.id) === 10, 'rilanciarla non cancella e non altera i dati')

console.log('\nSCENARIO COMPLETO: tutto verificato.')
