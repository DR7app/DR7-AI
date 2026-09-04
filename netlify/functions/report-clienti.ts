import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { addebitiFattura, fattureDaIgnorare, penaliDanniPerPrenotazione, type RigaFatturaAddebito } from './utils/addebitiCliente'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// PostgREST tronca ogni select a 1000 righe: senza paginazione il report
// perdeva prenotazioni, fatture e cauzioni oltre la prima pagina, quindi la
// spesa dei clienti risultava piu' bassa del reale.
//
// 29/08/2026 — le pagine venivano chieste UNA ALLA VOLTA: l'anagrafica da
// 2.100 schede (22.000 sulla demo) voleva un giro di rete ogni mille righe e
// il report ci metteva decine di secondi. Ora la prima pagina porta anche il
// totale delle righe e tutte le altre partono insieme: il costo torna a
// essere quello di un solo giro di rete, non di venti.
//
// 04/09/2026 — le pagine partono INSIEME ma la select non aveva un ORDER BY:
// senza ordinamento PostgREST non garantisce che due `range()` diversi vedano
// la stessa sequenza di righe, quindi una prenotazione poteva finire in due
// pagine e un'altra in nessuna. Risultato: prenotazioni che sparivano dal
// Report Clienti a caso (e ricomparivano al ricaricamento). Si ordina per la
// prima colonna chiesta — sulle tabelle che superano le 1000 righe
// (customers_extended, bookings, fatture) e' `id`, quindi un ordine totale.
async function fetchAll<T = Record<string, unknown>>(table: string, columns: string, tweak?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const PAGE = 1000
  const ordine = columns.split(',')[0].trim()
  const query = (conConteggio: boolean) => {
    let q: any = conConteggio // eslint-disable-line @typescript-eslint/no-explicit-any
      ? supabase.from(table).select(columns, { count: 'exact' })
      : supabase.from(table).select(columns)
    if (tweak) q = tweak(q)
    if (ordine) q = q.order(ordine, { ascending: true })
    return q
  }

  const prima = await query(true).range(0, PAGE - 1)
  if (prima.error) throw prima.error
  const righe: T[] = [...((prima.data || []) as T[])]
  const totale = typeof prima.count === 'number' ? prima.count : righe.length
  if (righe.length < PAGE || totale <= PAGE) return righe

  const altre: Promise<any>[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let start = PAGE; start < totale; start += PAGE) {
    altre.push(query(false).range(start, start + PAGE - 1))
  }
  for (const res of await Promise.all(altre)) {
    if (res.error) throw res.error
    righe.push(...((res.data || []) as T[]))
  }
  return righe
}

// 29/08/2026 — "column customers_extended.status_cliente does not exist": il
// Report Clienti restava una banda rossa e nessun cliente. PostgREST rifiuta
// l'INTERA select se UNA colonna non c'e', quindi un campo accessorio faceva
// sparire tutta l'anagrafica. `status_cliente` non e' creata da nessuna
// migrazione e non la scrive nessuno: su questo database non esiste, su altre
// istanze DR7 puo' esserci. Quindi si chiedono solo le colonne che il database
// ha davvero — stessa regola gia' usata da list-site-users.
const colonneCache = new Map<string, Set<string> | null>()
async function colonnePresenti(tabella: string): Promise<Set<string> | null> {
  if (colonneCache.has(tabella)) return colonneCache.get(tabella)!
  let presenti: Set<string> | null = null
  try {
    const { data, error } = await supabase.from(tabella).select('*').limit(1)
    // Tabella vuota o errore: non sappiamo lo schema, si chiede tutto come prima.
    if (!error && data && data.length > 0) presenti = new Set(Object.keys(data[0]))
  } catch { /* si resta su null */ }
  colonneCache.set(tabella, presenti)
  return presenti
}

/** Toglie dalla lista le colonne che questo database non ha. */
async function soloColonneEsistenti(tabella: string, colonne: string): Promise<string> {
  const presenti = await colonnePresenti(tabella)
  if (!presenti) return colonne
  const volute = colonne.split(',').map(c => c.trim()).filter(Boolean)
  const ok = volute.filter(c => presenti.has(c))
  const mancanti = volute.filter(c => !presenti.has(c))
  if (mancanti.length) console.warn(`[report-clienti] colonne assenti su ${tabella}: ${mancanti.join(', ')}`)
  return ok.length ? ok.join(', ') : colonne
}

const norm = (s: string | null | undefined): string => (s || '').trim().toLowerCase()
const phoneKey = (s: string | null | undefined): string => {
  const digits = (s || '').replace(/\D/g, '')
  return digits ? digits.slice(-9) : ''
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // 04/09/2026 — Report Clienti scaricava TUTTE le prenotazioni di sempre e il
  // selettore "periodo" della tab si limitava a nascondere dei clienti: gli
  // importi restavano quelli di tutta la vita del cliente, quindi non potevano
  // combaciare con il Report Noleggio dello stesso mese. Ora la plage arriva
  // qui e le somme riguardano SOLO quel periodo (assente = tutto lo storico,
  // che e' il preset "Sempre").
  const periodoFrom = (event.queryStringParameters?.from || '').slice(0, 10) || null
  const periodoTo = (event.queryStringParameters?.to || '').slice(0, 10) || null
  const periodoFromMs = periodoFrom ? new Date(periodoFrom + 'T00:00:00').getTime() : null
  const periodoToMs = periodoTo ? new Date(periodoTo + 'T23:59:59.999').getTime() : null

  try {
    // 0) Anagrafica + attivita': tutte le tabelle partono insieme.
    //    Prima l'anagrafica veniva letta per intera PRIMA di far partire le
    //    altre sette letture: due attese in fila invece di una sola.
    //    customers_extended e' la lista canonica — anche chi non ha mai
    //    prenotato compare nel report.
    const dodiciMesiFa = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const [allCustomers, bookingsAll, vehiclesAll, cauzioniAll, fattureAll, clubAll, walletAll, rechargeAll] = await Promise.all([
      (async () => fetchAll<any>(
        'customers_extended',
        await soloColonneEsistenti(
          'customers_extended',
          'id, user_id, nome, cognome, ragione_sociale, denominazione, ente_ufficio, tipo_cliente, email, telefono, status, status_cliente, created_at',
        ),
      ))(),
      fetchAll<any>('bookings', 'id, user_id, customer_name, customer_email, customer_phone, price_total, status, service_type, payment_method, payment_status, booking_details, pickup_date, dropoff_date, appointment_date, vehicle_id, vehicle_plate, booked_at, created_at, updated_at'),
      fetchAll<any>('vehicles', 'id, category'),
      fetchAll<any>('cauzioni', 'cliente_id, importo, stato, riferimento_contratto_id'),
      // tipo_fattura/stato/related_invoice_id servono a scartare le note di
      // credito e la fattura che annullano: senza, un documento annullato
      // contava DUE volte in positivo (caso Luca Pilloni, 04/09/2026).
      fetchAll<any>('fatture', 'id, booking_id, importo_totale, items, customer_name, customer_email, tipo_fattura, stato, related_invoice_id'),
      fetchAll<any>('dr7_club_subscriptions', 'user_id, plan, status, expires_at', q => q.eq('status', 'active')),
      fetchAll<any>('user_credit_balance', 'user_id, balance'),
      // Le ricariche fuori periodo o non riuscite venivano scaricate tutte e
      // buttate via qui: ora le scarta il database. Il ramo `is.null` tiene
      // le righe senza data, che il filtro in memoria contava comunque.
      fetchAll<any>('credit_wallet_purchases', 'user_id, recharge_amount, payment_status, created_at',
        q => q.in('payment_status', ['succeeded', 'paid', 'completed'])
              .or(`created_at.gte.${dodiciMesiFa},created_at.is.null`)),
    ])
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const bookingsRes = { data: bookingsAll }
    const vehiclesRes = { data: vehiclesAll }
    const cauzioniRes = { data: cauzioniAll }
    const fattureRes = { data: fattureAll }
    const clubRes = { data: clubAll }
    const walletRes = { data: walletAll }
    const rechargeRes = { data: rechargeAll }

    // 2) Build vehicle category lookup
    const vehicleCategoryMap = new Map<string, string>()
    if (vehiclesRes.data) {
      vehiclesRes.data.forEach(v => { if (v.id && v.category) vehicleCategoryMap.set(v.id, v.category) })
    }

    // 3) DR7 Club active user_ids
    const dr7UserIds = new Set<string>()
    if (clubRes.data) clubRes.data.forEach((s: { user_id: string }) => { if (s.user_id) dr7UserIds.add(s.user_id) })

    // 4) Wallet balance per user_id (cents)
    const walletByUser = new Map<string, number>()
    if (walletRes.data) {
      walletRes.data.forEach((w: { user_id: string; balance: number }) => {
        if (w.user_id) walletByUser.set(w.user_id, Number(w.balance) || 0)
      })
    }

    // 5) Total card recharges per user_id (cents) — last 12 months
    const rechargeTotalByUser = new Map<string, number>()
    if (rechargeRes.data) {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
      rechargeRes.data.forEach((r: { user_id: string; recharge_amount: number; payment_status: string; created_at: string }) => {
        if (!r.user_id) return
        if (!['succeeded', 'paid', 'completed'].includes(r.payment_status)) return
        if (new Date(r.created_at).getTime() < oneYearAgo) return
        rechargeTotalByUser.set(r.user_id, (rechargeTotalByUser.get(r.user_id) || 0) + (Number(r.recharge_amount) || 0))
      })
    }

    // 6) Build per-customer state.
    interface CustomerData {
      customerId: string
      name: string
      email: string
      phone: string
      tipo_cliente: string | null
      status_cliente: string | null
      dr7_club: boolean
      wallet_balance_eur: number
      wallet_recharges_12m_eur: number
      // Rentals by category (cents)
      supercar_spesa_cents: number
      supercar_prenotazioni: number
      supercar_giorni: number
      urban_spesa_cents: number
      urban_prenotazioni: number
      urban_giorni: number
      aziendali_spesa_cents: number
      aziendali_prenotazioni: number
      aziendali_giorni: number
      // Services
      lavaggi_spesa_cents: number
      lavaggi_prenotazioni: number
      meccanica_spesa_cents: number
      meccanica_prenotazioni: number
      // Penali / Danni (eur)
      penali_spesa_eur: number
      penali_eventi: number
      danni_spesa_eur: number
      danni_eventi: number
      // Cauzioni
      cauzioni_attive_count: number
      cauzioni_attive_eur: number
      // Cancellations
      annullate_count: number
      // Activity dates
      prima_prenotazione: string | null
      ultima_prenotazione: string | null
    }

    const customerMap: Record<string, CustomerData> = {}
    const idByEmail = new Map<string, string>()    // email → customerId (for matching bookings/fatture without user_id)
    const idByUser = new Map<string, string>()     // user_id → customerId
    const idByPhone = new Map<string, string>()    // phone(last9) → customerId

    function newRow(customerId: string, name: string, email: string, phone: string): CustomerData {
      return {
        customerId, name, email, phone,
        tipo_cliente: null, status_cliente: null, dr7_club: false,
        wallet_balance_eur: 0, wallet_recharges_12m_eur: 0,
        supercar_spesa_cents: 0, supercar_prenotazioni: 0, supercar_giorni: 0,
        urban_spesa_cents: 0, urban_prenotazioni: 0, urban_giorni: 0,
        aziendali_spesa_cents: 0, aziendali_prenotazioni: 0, aziendali_giorni: 0,
        lavaggi_spesa_cents: 0, lavaggi_prenotazioni: 0,
        meccanica_spesa_cents: 0, meccanica_prenotazioni: 0,
        penali_spesa_eur: 0, penali_eventi: 0,
        danni_spesa_eur: 0, danni_eventi: 0,
        cauzioni_attive_count: 0, cauzioni_attive_eur: 0,
        annullate_count: 0,
        prima_prenotazione: null, ultima_prenotazione: null,
      }
    }

    // 6a) Pre-populate from customers_extended — every client gets a row.
    for (const c of allCustomers) {
      let displayName = ''
      if (c.tipo_cliente === 'azienda') displayName = c.ragione_sociale || c.denominazione || ''
      else if (c.tipo_cliente === 'pubblica_amministrazione') displayName = c.ente_ufficio || c.denominazione || ''
      else displayName = `${c.nome || ''} ${c.cognome || ''}`.trim()

      const row = newRow(c.id, displayName || 'Sconosciuto', c.email || '', c.telefono || '')
      row.tipo_cliente = c.tipo_cliente || null
      // Schema legacy: ClientiTab writes status_cliente, CustomersTab writes status — honour either.
      const manual = (c.status_cliente && c.status_cliente !== 'standard') ? c.status_cliente
                    : (c.status && c.status !== 'standard' ? c.status : null)
      row.status_cliente = manual
      if (c.user_id && dr7UserIds.has(c.user_id)) row.dr7_club = true
      if (c.user_id && walletByUser.has(c.user_id)) row.wallet_balance_eur = (walletByUser.get(c.user_id) || 0) / 100
      if (c.user_id && rechargeTotalByUser.has(c.user_id)) row.wallet_recharges_12m_eur = (rechargeTotalByUser.get(c.user_id) || 0) / 100

      customerMap[c.id] = row
      if (c.email) idByEmail.set(norm(c.email), c.id)
      if (c.user_id) idByUser.set(c.user_id, c.id)
      const pk = phoneKey(c.telefono)
      if (pk) idByPhone.set(pk, c.id)
    }

    // 6b) Helper: locate (or create) a row from booking/fattura identifiers.
    //     Order: customers_extended.id → user_id → email → phone → fallback synthetic key.
    function resolveKey(opts: { uid?: string | null; email?: string | null; phone?: string | null; name?: string | null }): string {
      const { uid, email, phone, name } = opts
      if (uid && idByUser.has(uid)) return idByUser.get(uid)!
      const e = norm(email)
      if (e && idByEmail.has(e)) return idByEmail.get(e)!
      const p = phoneKey(phone)
      if (p && idByPhone.has(p)) return idByPhone.get(p)!
      // Fallback: customer not in customers_extended — synthesize a row so we still see the activity.
      const synth = uid || e || p || `unknown_${(name || '').toLowerCase()}`
      if (!customerMap[synth]) {
        customerMap[synth] = newRow(uid || '', name || 'Sconosciuto', email || '', phone || '')
      }
      // Index the synth so subsequent bookings collapse onto it.
      if (uid && !idByUser.has(uid)) idByUser.set(uid, synth)
      if (e && !idByEmail.has(e)) idByEmail.set(e, synth)
      if (p && !idByPhone.has(p)) idByPhone.set(p, synth)
      return synth
    }

    // 7) Bookings — classify and aggregate. Cancelled go into annullate_count.
    type BookingType = 'supercar' | 'urban' | 'aziendali' | 'altri' | 'car_wash' | 'mechanical'

    // Le stesse esclusioni del Report Noleggio (monthly-report.ts, STEP 1).
    // Senza queste il Report Clienti contava righe che il Report Noleggio
    // scarta — prenotazioni admin e mezzi di prova — e i due schermi non
    // potevano tornare.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function isRigaDiServizio(b: any): boolean {
      const details = b.booking_details || {}
      if (details.internal === true) return true
      if (details.createdBy === 'automatic_system') return true
      const name = (b.customer_name || '').trim().toUpperCase()
      if (name.startsWith('INTERNO') || name.startsWith('LAVAGGIO RIENTRO')) return true
      if (name.toLowerCase().includes('admin dr7')) return true
      if (norm(b.customer_email) === 'admin@dr7.app') return true
      if (norm(details?.customer?.email) === 'admin@dr7.app') return true
      const targa = (b.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
      if (targa === 'TEST000' || targa === 'TEST002') return true
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function classifyBooking(b: any): BookingType | null {
      if (isRigaDiServizio(b)) return null
      const details = b.booking_details || {}
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash') return 'car_wash'
      if (st === 'mechanical_service' || st === 'mechanical') return 'mechanical'
      // Un'uscita straordinaria e' uno spostamento interno: ha pickup e
      // dropoff come un noleggio, quindi finiva fra le Supercar del cliente,
      // ma non e' un ricavo e il Report Noleggio la esclude sempre.
      if (st === 'uscita_straordinaria') return null
      if (b.pickup_date && b.dropoff_date) {
        // Mare / Aria / Soggiorni usano `noleggio_catalog`, non la flotta auto:
        // la categoria non si trovava e finivano tutti in "Supercar".
        if (st === 'boat_rental' || st === 'heli_rental' || st === 'stay_rental') return 'altri'
        const vid = b.vehicle_id || details.vehicle_id || ''
        const cat = vehicleCategoryMap.get(vid) || ''
        if (cat === 'aziendali') return 'aziendali'
        if (cat === 'urban') return 'urban'
        return 'supercar'
      }
      return null
    }

    /** La prenotazione ricade nel periodo richiesto? Stessa regola del Report
     *  Noleggio: si esclude cio' che si e' chiuso prima dell'inizio, e un
     *  ritiro successivo alla fine entra solo se PAGATO dentro il periodo
     *  (l'anticipata). Senza periodo passa tutto. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function nelPeriodo(b: any, type: BookingType): boolean {
      if (!periodoFrom && !periodoTo) return true
      if (type === 'car_wash' || type === 'mechanical') {
        const g = String(b.appointment_date || b.pickup_date || b.booked_at || b.created_at || '').slice(0, 10)
        if (!g) return true
        if (periodoFrom && g < periodoFrom) return false
        if (periodoTo && g > periodoTo) return false
        return true
      }
      const pickup = String(b.pickup_date || '').slice(0, 10)
      const dropoff = String(b.dropoff_date || '').slice(0, 10)
      if (periodoFrom && dropoff && dropoff < periodoFrom) return false
      if (periodoTo && pickup && pickup > periodoTo) {
        const pagata = ['paid', 'completed', 'succeeded'].includes(norm(b.payment_status))
        if (!pagata) return false
        const pagataIl = b.booking_details?.nexi_paid_at || b.updated_at || b.created_at || ''
        if (!pagataIl) return false
        const ms = new Date(pagataIl).getTime()
        if (Number.isNaN(ms)) return false
        if (periodoFromMs != null && ms < periodoFromMs) return false
        if (periodoToMs != null && ms > periodoToMs) return false
        return true
      }
      return true
    }

    const bookingToCustomerKey = new Map<string, string>()
    let prenotazioniConAddebiti = new Set<string>()

    // Walk every booking — cancelled, internal, unclassified included — so
    // downstream lookups (fatture by booking_id, cauzioni by riferimento_contratto_id)
    // can always resolve back to a customer. Spend aggregation is the only step
    // gated by classifyBooking() since "internal" bookings shouldn't inflate KPIs.
    for (const b of (bookingsRes.data || [])) {
      const details = b.booking_details || {}
      const uid = b.user_id || details?.customer?.customerId || null
      const email = b.customer_email || details?.customer?.email || null
      const phone = b.customer_phone || details?.customer?.phone || null
      const name = b.customer_name || details?.customer?.fullName || null

      const key = resolveKey({ uid, email, phone, name })
      bookingToCustomerKey.set(b.id, key)
      const c = customerMap[key]

      const bookingDateIso = b.booked_at || b.created_at || b.pickup_date || b.appointment_date || null
      if (bookingDateIso) {
        const ts = new Date(bookingDateIso).toISOString()
        if (!c.prima_prenotazione || ts < c.prima_prenotazione) c.prima_prenotazione = ts
        if (!c.ultima_prenotazione || ts > c.ultima_prenotazione) c.ultima_prenotazione = ts
      }

      // I penali e i danni si contano DOPO, in un passaggio unico che mette
      // insieme booking_details e fatture senza doppioni (vedi punto 8): qui
      // si registra solo a chi appartiene la prenotazione.

      const status = norm(b.status)
      if (status === 'cancelled' || status === 'annullata') {
        c.annullate_count += 1
        continue
      }

      const type = classifyBooking(b)
      if (!type) continue

      const priceCents = Number(b.price_total) || 0
      const isRental = type === 'supercar' || type === 'urban' || type === 'aziendali'
      if (isRental) {
        let days = 0
        if (b.pickup_date && b.dropoff_date) {
          const diffMs = new Date(b.dropoff_date).getTime() - new Date(b.pickup_date).getTime()
          days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
        }
        if (type === 'supercar') {
          c.supercar_spesa_cents += priceCents; c.supercar_prenotazioni += 1; c.supercar_giorni += days
        } else if (type === 'urban') {
          c.urban_spesa_cents += priceCents; c.urban_prenotazioni += 1; c.urban_giorni += days
        } else if (type === 'altri') {
          c.altri_spesa_cents += priceCents; c.altri_prenotazioni += 1; c.altri_giorni += days
        } else {
          c.aziendali_spesa_cents += priceCents; c.aziendali_prenotazioni += 1; c.aziendali_giorni += days
        }
      } else if (type === 'car_wash') {
        c.lavaggi_spesa_cents += priceCents; c.lavaggi_prenotazioni += 1
      } else if (type === 'mechanical') {
        c.meccanica_spesa_cents += priceCents; c.meccanica_prenotazioni += 1
      }
    }

    // 8) Penali e danni — UNA sola volta per prenotazione, mettendo insieme
    //    booking_details e fatture (vedi utils/addebitiCliente.ts). Prima si
    //    sommavano tutte e due le fonti, si contava l'INTERO importo della
    //    fattura in una sola categoria e le note di credito contavano in
    //    positivo: la stessa pratica da 5.000 EUR ne mostrava 15.171,90.
    {
      const addebiti = penaliDanniPerPrenotazione(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bookingsRes.data || []).map((b: any) => ({ id: b.id, booking_details: b.booking_details })),
        (fattureRes.data || []) as RigaFatturaAddebito[],
      )
      for (const [bookingId, voci] of addebiti) {
        const key = bookingToCustomerKey.get(bookingId)
        if (!key || !customerMap[key]) continue
        const c = customerMap[key]
        c.penali_spesa_eur += voci.penali
        c.penali_eventi += voci.eventiPenali
        c.danni_spesa_eur += voci.danni
        c.danni_eventi += voci.eventiDanni
      }
      prenotazioniConAddebiti = new Set(addebiti.keys())

      // Fatture penale/danno senza prenotazione agganciata (o su prenotazioni
      // sparite): si attribuiscono al cliente per email, poi per nome.
      const fuori = fattureDaIgnorare((fattureRes.data || []) as RigaFatturaAddebito[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const f of (fattureRes.data || []) as any[]) {
        if (fuori.has(f.id)) continue
        if (f.booking_id && bookingToCustomerKey.has(f.booking_id)) continue
        const { penali, danni, vociPenali, vociDanni } = addebitiFattura(f.items)
        if (penali <= 0 && danni <= 0) continue

        let key: string | undefined
        if (f.customer_email) {
          const e = norm(f.customer_email)
          if (idByEmail.has(e)) key = idByEmail.get(e)!
        }
        if (!key && f.customer_name) {
          const target = norm(f.customer_name)
          key = Object.keys(customerMap).find(k => norm(customerMap[k].name) === target)
        }
        if (!key) key = resolveKey({ name: f.customer_name, email: f.customer_email })

        const c = customerMap[key]
        c.penali_spesa_eur += penali
        c.penali_eventi += vociPenali
        c.danni_spesa_eur += danni
        c.danni_eventi += vociDanni
      }
    }

    // 9) Cauzioni — match by cliente_id, fall back to riferimento_contratto_id (booking).
    //    Stati (vedi CauzioniTab): 'Attiva' / 'In scadenza' / 'Incassata' = soldi
    //    del cliente ancora in mano a DR7 ma DA RESTITUIRE -> cauzione aperta.
    //    'Bloccata' = trattenuta da DR7, quindi un danno pagato col deposito.
    //    Prima era il contrario: 'Incassata' finiva nei danni (gonfiandoli) e
    //    'Bloccata' compariva come cauzione ancora aperta.
    if (cauzioniRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const cau of cauzioniRes.data as any[]) {
        let key: string | undefined = cau.cliente_id && customerMap[cau.cliente_id] ? cau.cliente_id : undefined
        if (!key && cau.riferimento_contratto_id && bookingToCustomerKey.has(cau.riferimento_contratto_id)) {
          key = bookingToCustomerKey.get(cau.riferimento_contratto_id)
        }
        if (!key) continue
        const c = customerMap[key]
        const stato = norm(cau.stato)
        const importo = Number(cau.importo) || 0
        if (stato === 'restituita' || stato === 'sbloccata') continue
        if (stato === 'bloccata') {
          // Il danno e' gia' contato se la pratica ha una voce o una fattura:
          // la cauzione e' solo il mezzo con cui e' stato pagato.
          if (cau.riferimento_contratto_id && prenotazioniConAddebiti.has(cau.riferimento_contratto_id)) continue
          c.danni_spesa_eur += importo
          c.danni_eventi += 1
        } else {
          c.cauzioni_attive_count += 1
          c.cauzioni_attive_eur += importo
        }
      }
    }

    // 10) Build response. Sort by total spend desc.
    const customerList = Object.values(customerMap)
    const toEur = (cents: number) => Math.round(cents) / 100
    const round2 = (n: number) => Math.round(n * 100) / 100

    const built = customerList.map(c => {
      const supercar_spesa = toEur(c.supercar_spesa_cents)
      const urban_spesa = toEur(c.urban_spesa_cents)
      const aziendali_spesa = toEur(c.aziendali_spesa_cents)
      const lavaggi_spesa = toEur(c.lavaggi_spesa_cents)
      const meccanica_spesa = toEur(c.meccanica_spesa_cents)
      const penali_spesa = round2(c.penali_spesa_eur)
      const danni_spesa = round2(c.danni_spesa_eur)
      const totale_giorni = c.supercar_giorni + c.urban_giorni + c.aziendali_giorni
      const totale_prenotazioni = c.supercar_prenotazioni + c.urban_prenotazioni + c.aziendali_prenotazioni + c.lavaggi_prenotazioni + c.meccanica_prenotazioni
      const totale_spesa = round2(supercar_spesa + urban_spesa + aziendali_spesa + lavaggi_spesa + meccanica_spesa + penali_spesa + danni_spesa)

      return {
        customerId: c.customerId,
        name: c.name || 'Sconosciuto',
        email: c.email || '-',
        phone: c.phone || '-',
        tipo_cliente: c.tipo_cliente,
        status_cliente: c.status_cliente,
        dr7_club: c.dr7_club,
        wallet_balance: round2(c.wallet_balance_eur),
        wallet_recharges_12m: round2(c.wallet_recharges_12m_eur),
        supercar_spesa, supercar_prenotazioni: c.supercar_prenotazioni, supercar_giorni: c.supercar_giorni,
        urban_spesa, urban_prenotazioni: c.urban_prenotazioni, urban_giorni: c.urban_giorni,
        aziendali_spesa, aziendali_prenotazioni: c.aziendali_prenotazioni, aziendali_giorni: c.aziendali_giorni,
        lavaggi_spesa, lavaggi_prenotazioni: c.lavaggi_prenotazioni,
        meccanica_spesa, meccanica_prenotazioni: c.meccanica_prenotazioni,
        penali_spesa, penali_eventi: c.penali_eventi,
        danni_spesa, danni_eventi: c.danni_eventi,
        annullate_count: c.annullate_count,
        cauzioni_attive_count: c.cauzioni_attive_count,
        cauzioni_attive: round2(c.cauzioni_attive_eur),
        prima_prenotazione: c.prima_prenotazione,
        ultima_prenotazione: c.ultima_prenotazione,
        totale_giorni,
        totale_prenotazioni,
        totale_spesa,
      }
    })

    built.sort((a, b) => b.totale_spesa - a.totale_spesa)

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalCustomers: built.length,
        customers: built,
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Report clienti error:', error)
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error', details: error.message }) }
  }
}
