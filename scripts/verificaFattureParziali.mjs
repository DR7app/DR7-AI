// 14/10/2026: prova del trigger trg_fatture_pagate_dal_booking (migrazione
// 20261014_fatture_non_pagate_e_parziali) su un Postgres in memoria.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
await db.exec(`
  create table public.bookings (id uuid primary key, booking_details jsonb, payment_status text, amount_paid integer);
  create table public.fatture (id uuid primary key default gen_random_uuid(), booking_id uuid, tipo_fattura text, stato text,
    importo_totale numeric, extension_index integer, created_at timestamptz default now(), numero_fattura text,
    data_emissione date, customer_name text, sdi_status text, aruba_invoice_id text);
`)
await db.exec(readFileSync(new URL('../supabase/migrations/20261014_fatture_non_pagate_e_parziali.sql', import.meta.url), 'utf8'))

let falliti = 0
const ok = (cond, msg) => { console.log(cond ? 'OK  ' : 'FAIL', msg); if (!cond) falliti++ }
const stato = async id => (await db.query('select stato from fatture where id=$1', [id])).rows[0].stato

const B = '00000000-0000-0000-0000-000000000001'
const F1 = '10000000-0000-0000-0000-000000000001', F2 = '10000000-0000-0000-0000-000000000002'
await db.query(`insert into fatture (id, booking_id, tipo_fattura, stato, importo_totale, created_at) values
  ($1,$3,'penale','pending',300, now() - interval '1 hour'), ($2,$3,'penale','pending',700, now())`, [F1, F2, B])
const penale = (extra) => JSON.stringify({ penalties: [{ label: 'Sforo', total: 1000, importoFatturato: 1000,
  fattureEmesse: [{ id: F1, importo: 300 }, { id: F2, importo: 700 }], ...extra }] })
await db.query(`insert into bookings values ($1, $2, 'paid', 0)`, [B, penale({ paymentStatus: 'pending' })])
ok(await stato(F1) === 'pending', 'penale non pagata: fattura resta non pagata')
await db.query(`update bookings set booking_details=$2 where id=$1`, [B, penale({ paymentStatus: 'partial', amountPaid: 300 })])
ok(await stato(F1) === 'paid' && await stato(F2) === 'pending', 'acconto 300: pagata solo la prima fattura')
await db.query(`update bookings set booking_details=$2 where id=$1`, [B, penale({ paymentStatus: 'paid', amountPaid: 1000 })])
ok(await stato(F2) === 'paid', 'saldo: pagata anche la seconda')

const N = '00000000-0000-0000-0000-000000000002'
const P1 = '20000000-0000-0000-0000-000000000001', P2 = '20000000-0000-0000-0000-000000000002', PEN = '20000000-0000-0000-0000-000000000003'
await db.query(`insert into bookings values ($1, '{}', 'pending', 0)`, [N])
await db.query(`insert into fatture (id, booking_id, tipo_fattura, stato, importo_totale, created_at) values
  ($1,$4,'parziale','pending',400, now() - interval '2 hour'), ($2,$4,'parziale','pending',600, now() - interval '1 hour'),
  ($3,$4,'penale','pending',50, now())`, [P1, P2, PEN, N])
await db.query(`update bookings set amount_paid=40000, payment_status='partial' where id=$1`, [N])
ok(await stato(P1) === 'paid' && await stato(P2) === 'pending', 'noleggio acconto 400: pagata la prima parziale')
await db.query(`update bookings set payment_status='paid' where id=$1`, [N])
ok(await stato(P2) === 'paid', 'noleggio pagato: pagata anche la seconda parziale')
ok(await stato(PEN) === 'pending', 'la penale sulla stessa prenotazione non viene toccata dal noleggio')

const C = '00000000-0000-0000-0000-000000000003'
await db.query(`insert into fatture (booking_id, tipo_fattura, stato, importo_totale) values ($1,'parziale','pending',100)`, [C])
await db.query(`insert into fatture (booking_id, tipo_fattura, stato, importo_totale) values ($1,'parziale','pending',100)`, [C])
ok(true, 'due parziali sulla stessa prenotazione accettate dall\'indice')
let respinta = false
await db.query(`insert into fatture (booking_id, stato, importo_totale) values ($1,'pending',100)`, [C])
try { await db.query(`insert into fatture (booking_id, stato, importo_totale) values ($1,'pending',100)`, [C]) } catch { respinta = true }
ok(respinta, 'due principali sulla stessa prenotazione restano respinte')

process.exit(falliti ? 1 : 0)
