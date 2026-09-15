#!/usr/bin/env node
/**
 * verificaWalletPrenotazione.mjs — prova su un Postgres vero, in memoria,
 * l'addebito automatico dal Credit Wallet.
 *
 *   npm run wallet:verifica
 *
 * Perche' esiste: la regola sta TUTTA nel database (trigger su `bookings`).
 * Un errore li' non lo vede nessuna schermata: lo vede il cliente a cui il
 * credito viene prelevato due volte, o mai. Qui si ripercorre la vita di una
 * prenotazione pagata col wallet — creazione, modifica del totale, cambio di
 * metodo, annullamento — e si controlla il saldo dopo ogni passo.
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

// Doppioni di cio' che su Supabase c'e' gia': solo le colonne che il trigger
// legge o scrive.
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
  user_id uuid,
  email text,
  nome text,
  cognome text
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
`)

const MIGRAZIONE = new URL('../supabase/migrations/20260915000000_wallet_addebito_prenotazione.sql', import.meta.url)
await db.exec(fs.readFileSync(MIGRAZIONE, 'utf8'))

const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'KO  '} ${m}`); if (!c) process.exit(1) }
const q = async (s, p) => (await db.query(s, p)).rows
const uno = async (s, p) => (await q(s, p))[0]

const eur = n => Number(n).toFixed(2)
const saldo = async u => Number((await uno(`SELECT balance b FROM user_credit_balance WHERE user_id=$1`, [u]))?.b ?? 0)
const movimenti = async id => q(
  `SELECT transaction_type t, amount a, reference_type rt, description d
     FROM credit_transactions WHERE reference_id=$1 ORDER BY created_at, id`, [id])

let seq = 0
const nuovoCliente = async (credito, email) => {
  seq += 1
  const u = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
  await db.query(`INSERT INTO user_credit_balance (user_id, balance) VALUES ($1,$2)`, [u, credito])
  await db.query(`INSERT INTO customers_extended (user_id, email, nome) VALUES ($1,$2,'Cliente')`,
    [u, email ?? `cliente${seq}@dr7.app`])
  return u
}

const prenota = async (o = {}) => uno(
  `INSERT INTO bookings (user_id, customer_email, vehicle_name, vehicle_plate, service_type,
                         price_total, amount_paid, payment_method, payment_status, status)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
  [o.userId ?? null, o.email ?? null, o.veicolo ?? 'Lamborghini Urus', o.targa ?? 'GA123AA',
   o.servizio ?? 'car_rental', o.totale ?? 0, o.pagato ?? null,
   o.metodo ?? 'Credit Wallet', o.statoPagamento ?? 'paid', o.stato ?? 'confirmed'])

console.log('\n── 1. Riconoscere il metodo di pagamento ───────────────────────')
for (const m of ['Credit Wallet', 'credit_wallet', 'Wallet', 'credit', 'Credito', 'CREDIT WALLET', 'wallet DR7']) {
  ok((await uno(`SELECT dr7_metodo_e_credit_wallet($1) r`, [m])).r === true, `"${m}" -> wallet`)
}
for (const m of ['Carta di Credito', 'Carta Punti', 'Gift Card', 'gift_card', 'Contanti', 'Bonifico', 'Nexi - Pay by Link', '', null]) {
  ok((await uno(`SELECT dr7_metodo_e_credit_wallet($1) r`, [m])).r === false, `"${m ?? 'null'}" -> non wallet`)
}

console.log('\n── 2. Prenotazione pagata col wallet: il credito scende subito ──')
const c1 = await nuovoCliente(500)
const b1 = await prenota({ userId: c1, totale: 20000 }) // 200,00 EUR
ok(await saldo(c1) === 300, `saldo 500 -> ${eur(await saldo(c1))} dopo un noleggio da 200`)
let mv = await movimenti(b1.id)
ok(mv.length === 1 && mv[0].t === 'debit' && Number(mv[0].a) === 200, 'un solo movimento di addebito, da 200')
ok(mv[0].rt === 'booking_payment' && /DR7-/.test(mv[0].d), `collegato alla prenotazione: "${mv[0].d}"`)

console.log('\n── 3. Risalvare la stessa prenotazione non riaddebita ──────────')
await db.query(`UPDATE bookings SET notes='chiamare il cliente' WHERE id=$1`, [b1.id])
await db.query(`UPDATE bookings SET status='active' WHERE id=$1`, [b1.id])
await db.query(`UPDATE bookings SET payment_method='Credit Wallet', payment_status='paid' WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 300, 'tre salvataggi dopo, il saldo e ancora 300')
ok((await movimenti(b1.id)).length === 1, 'sempre un solo movimento')

console.log('\n── 4. Il totale cambia: si movimenta solo la differenza ────────')
await db.query(`UPDATE bookings SET price_total=25000 WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 250, `totale 200 -> 250: saldo ${eur(await saldo(c1))} (addebitati altri 50)`)
await db.query(`UPDATE bookings SET price_total=18000 WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 320, `totale 250 -> 180: saldo ${eur(await saldo(c1))} (restituiti 70)`)

console.log('\n── 5. Cambio metodo: il wallet viene rimborsato ────────────────')
await db.query(`UPDATE bookings SET payment_method='Contanti' WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 500, `pagata in contanti: il wallet torna a ${eur(await saldo(c1))}`)
mv = await movimenti(b1.id)
ok(mv[mv.length - 1].rt === 'booking_refund', 'ultimo movimento: storno')
await db.query(`UPDATE bookings SET payment_method='Credit Wallet' WHERE id=$1`, [b1.id])
ok(await saldo(c1) === 320, `di nuovo col wallet: ${eur(await saldo(c1))}`)

console.log('\n── 6. Acconto parziale: esce solo quello incassato ─────────────')
const c2 = await nuovoCliente(400)
const b2 = await prenota({ userId: c2, totale: 30000, pagato: 10000, statoPagamento: 'partial' })
ok(await saldo(c2) === 300, `acconto di 100 su 300: saldo ${eur(await saldo(c2))}`)
await db.query(`UPDATE bookings SET payment_status='paid', amount_paid=30000 WHERE id=$1`, [b2.id])
ok(await saldo(c2) === 100, `saldata: escono i restanti 200, saldo ${eur(await saldo(c2))}`)

console.log('\n── 7. Il sito ha gia addebitato: si collega, non si riaddebita ─')
const c3 = await nuovoCliente(1000)
// Cosi' fa il sito: prima l'addebito (RPC deduct_credits / book_with_credits),
// subito dopo l'inserimento della prenotazione. reference_id non esiste ancora.
await db.query(
  `INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description)
   VALUES ($1,'debit',150,850,'Noleggio Ferrari 296 GTB')`, [c3])
await db.query(`UPDATE user_credit_balance SET balance=850 WHERE user_id=$1`, [c3])
const b3 = await prenota({ userId: c3, totale: 15000, metodo: 'credit' })
ok(await saldo(c3) === 850, `nessun secondo prelievo: saldo ${eur(await saldo(c3))}`)
mv = await movimenti(b3.id)
ok(mv.length === 1 && mv[0].rt === 'booking_payment', 'il movimento del sito e ora collegato alla prenotazione')

console.log('\n── 8. Vecchie prenotazioni mai addebitate: nessun rimborso finto ')
const c4 = await nuovoCliente(200)
await db.exec(`ALTER TABLE bookings DISABLE TRIGGER trg_dr7_wallet_sync_prenotazione`)
const b4 = await prenota({ userId: c4, totale: 50000 }) // com'era prima della correzione
await db.exec(`ALTER TABLE bookings ENABLE TRIGGER trg_dr7_wallet_sync_prenotazione`)
await db.query(`UPDATE bookings SET payment_method='Contanti' WHERE id=$1`, [b4.id])
ok(await saldo(c4) === 200, `saldo intatto a ${eur(await saldo(c4))}: non si restituisce cio che non e stato preso`)
ok((await movimenti(b4.id)).length === 0, 'nessun movimento inventato')

console.log('\n── 9. Credito insufficiente: la prenotazione viene RIFIUTATA ──')
const c5 = await nuovoCliente(50)
let rifiutata = null
try {
  await prenota({ userId: c5, totale: 30000 })
} catch (e) {
  rifiutata = e
}
ok(!!rifiutata, 'il salvataggio fallisce invece di svuotare un wallet che non copre')
ok(/Credito Wallet insufficiente/.test(String(rifiutata?.message)), `messaggio per l operatore: "${String(rifiutata?.message).split('\n')[0]}"`)
ok(/50\.00/.test(String(rifiutata?.message)) && /300\.00/.test(String(rifiutata?.message)), 'il messaggio dice quanto c e e quanto serve')
ok(await saldo(c5) === 50, `saldo intatto a ${eur(await saldo(c5))}`)
ok((await q(`SELECT id FROM bookings WHERE user_id=$1`, [c5])).length === 0, 'nessuna prenotazione creata')

// Con un altro metodo di pagamento la stessa prenotazione passa: e' la via
// d'uscita che il messaggio indica all'operatore.
const b5 = await prenota({ userId: c5, totale: 30000, metodo: 'Contanti' })
ok(!!b5.id && await saldo(c5) === 50, 'la stessa prenotazione in contanti si salva, wallet invariato')

// Anche una MODIFICA che porterebbe il wallet sotto zero viene rifiutata.
const c5b = await nuovoCliente(200)
const b5b = await prenota({ userId: c5b, totale: 10000 })
ok(await saldo(c5b) === 100, 'prima: noleggio da 100 su 200 di credito')
let rifiutataModifica = null
try {
  await db.query(`UPDATE bookings SET price_total=90000 WHERE id=$1`, [b5b.id])
} catch (e) {
  rifiutataModifica = e
}
ok(!!rifiutataModifica && /Credito Wallet insufficiente/.test(String(rifiutataModifica?.message)),
   'alzare il totale oltre il credito disponibile: rifiutato')
ok(await saldo(c5b) === 100, `saldo invariato a ${eur(await saldo(c5b))}`)

console.log('\n── 10. Casi che non devono toccare il wallet ───────────────────')
const c6 = await nuovoCliente(300)
await prenota({ userId: c6, totale: 10000, metodo: 'Contanti' })
ok(await saldo(c6) === 300, 'pagamento in contanti: saldo invariato')
await prenota({ userId: c6, totale: 10000, statoPagamento: 'pending' })
ok(await saldo(c6) === 300, 'da saldare: ancora nulla esce dal wallet')
await prenota({ userId: c6, totale: 10000, stato: 'cancelled' })
ok(await saldo(c6) === 300, 'prenotazione annullata: il wallet non si tocca')
await prenota({ userId: c6, totale: 10000, targa: 'TEST01' })
ok(await saldo(c6) === 300, 'veicolo di prova: nessun movimento reale')

console.log('\n── 11. Cliente senza account sito: la prenotazione si salva ────')
const b7 = await uno(
  `INSERT INTO bookings (customer_email, vehicle_name, price_total, payment_method, payment_status, status)
   VALUES ('sconosciuto@example.com','Fiat Panda',5000,'Credit Wallet','paid','confirmed') RETURNING id`)
ok(!!b7.id, 'la prenotazione esiste comunque (nessun blocco)')
ok((await movimenti(b7.id)).length === 0, 'nessun addebito: non c e un wallet a cui attingere')

console.log('\n── 12. Il cliente si trova dall email se manca user_id ─────────')
const c8 = await nuovoCliente(600, 'mario.rossi@dr7.app')
const b8 = await prenota({ email: 'MARIO.ROSSI@DR7.APP', totale: 12000 })
ok(await saldo(c8) === 480, `trovato per email (maiuscole comprese): saldo ${eur(await saldo(c8))}`)
ok((await movimenti(b8.id)).length === 1, 'addebito registrato sul wallet giusto')

console.log('\nTutto verificato.\n')
