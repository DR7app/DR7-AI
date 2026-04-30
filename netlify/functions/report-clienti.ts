import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Keywords from PenaltyModal labels that indicate PHYSICAL DAMAGE to the vehicle
const DANNI_KEYWORDS = [
  'fermo veicolo', 'fermo del veicolo', 'foro da sigaretta', 'foro sigaretta',
  'gonfia e ripara', 'bomboletta', 'veicolo sporco', 'igienizzazione',
  'controlli elettronici', 'disattivazione controlli', 'cani', 'pelo di cane',
  'pista', 'competizioni', 'incidente', 'danni',
]

const PENALI_KEYWORDS = [
  'fumo', 'odore', 'cenere', 'guidatore non', 'carburante', 'multe',
  'sanzioni', 'assenza intestatario', 'ritardo', 'check-out', 'checkout',
  'subnoleggio', 'neopatentati', 'non abilitati', 'patente', 'riconsegna',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyInvoice(items: any[]): 'danni' | 'penali' | null {
  for (const item of items) {
    const desc = (item.description || '').toLowerCase()
    if (desc.includes('danno prenotazione')) return 'danni'
    if (!desc.includes('penale prenotazione')) continue
    const dashIdx = desc.indexOf(' - ')
    const motivo = dashIdx >= 0 ? desc.substring(dashIdx + 3) : desc
    for (const kw of DANNI_KEYWORDS) if (motivo.includes(kw.toLowerCase())) return 'danni'
    for (const kw of PENALI_KEYWORDS) if (motivo.includes(kw.toLowerCase())) return 'penali'
  }
  return 'penali'
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

  try {
    // 0) Pull every customer in customers_extended — this is the canonical roster.
    //    Even customers with zero bookings appear in the report.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allCustomers: any[] = []
    {
      const PAGE = 1000
      let from = 0
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase
          .from('customers_extended')
          .select('id, user_id, nome, cognome, ragione_sociale, denominazione, ente_ufficio, tipo_cliente, email, telefono, status, status_cliente, created_at')
          .range(from, from + PAGE - 1)
        if (error) break
        if (!data || data.length === 0) break
        allCustomers.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
    }

    // 1) Bookings, vehicles, cauzioni, fatture, dr7 club, wallet — in parallel.
    const [bookingsRes, vehiclesRes, cauzioniRes, fattureRes, clubRes, walletRes, rechargeRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, user_id, customer_name, customer_email, customer_phone, price_total, status, service_type, payment_method, payment_status, booking_details, pickup_date, dropoff_date, appointment_date, vehicle_id, booked_at, created_at'),
      supabase.from('vehicles').select('id, category'),
      supabase.from('cauzioni').select('cliente_id, importo, stato, riferimento_contratto_id'),
      supabase.from('fatture').select('id, booking_id, importo_totale, items, customer_name, customer_email'),
      supabase.from('dr7_club_subscriptions').select('user_id, plan, status, expires_at').eq('status', 'active'),
      supabase.from('user_credit_balance').select('user_id, balance'),
      supabase.from('credit_wallet_purchases').select('user_id, recharge_amount, payment_status, created_at'),
    ])

    if (bookingsRes.error) throw bookingsRes.error

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
    type BookingType = 'supercar' | 'urban' | 'aziendali' | 'car_wash' | 'mechanical'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function classifyBooking(b: any): BookingType | null {
      const details = b.booking_details || {}
      if (details.internal === true) return null
      if (details.createdBy === 'automatic_system') return null
      const name = (b.customer_name || '').trim().toUpperCase()
      if (name.startsWith('INTERNO') || name.startsWith('LAVAGGIO RIENTRO')) return null
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash') return 'car_wash'
      if (st === 'mechanical_service' || st === 'mechanical') return 'mechanical'
      if (b.pickup_date && b.dropoff_date) {
        const vid = b.vehicle_id || details.vehicle_id || ''
        const cat = vehicleCategoryMap.get(vid) || ''
        if (cat === 'aziendali') return 'aziendali'
        if (cat === 'urban') return 'urban'
        return 'supercar'
      }
      return null
    }

    const bookingToCustomerKey = new Map<string, string>()

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

      // Pending penali/danni inside booking_details (not yet invoiced) — count
      // these for ALL bookings, even cancelled/internal, so the customer's risk
      // record is never silently dropped.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pendingPenali = (details.penalties || []).filter((p: any) => p.paymentStatus === 'pending')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pendingDanni = (details.danni || []).filter((d: any) => d.paymentStatus === 'pending')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of pendingPenali) {
        const total = p.total || (p.amount || 0) * (p.quantity || 1)
        c.penali_spesa_eur += total; c.penali_eventi += 1
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of pendingDanni) {
        const total = d.total || (d.amount || 0) * (d.quantity || 1)
        c.danni_spesa_eur += total; c.danni_eventi += 1
      }

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
        } else {
          c.aziendali_spesa_cents += priceCents; c.aziendali_prenotazioni += 1; c.aziendali_giorni += days
        }
      } else if (type === 'car_wash') {
        c.lavaggi_spesa_cents += priceCents; c.lavaggi_prenotazioni += 1
      } else if (type === 'mechanical') {
        c.meccanica_spesa_cents += priceCents; c.meccanica_prenotazioni += 1
      }
    }

    // 8) Fatture — invoiced penali/danni go in. Match by booking_id, then email, then name.
    if (fattureRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const f of fattureRes.data as any[]) {
        if (!f.items || !Array.isArray(f.items)) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasPenalty = f.items.some((it: any) =>
          it.description && (it.description.includes('Penale prenotazione') || it.description.includes('Danno prenotazione')))
        if (!hasPenalty) continue

        const cls = classifyInvoice(f.items)
        if (!cls) continue

        let key: string | undefined
        if (f.booking_id && bookingToCustomerKey.has(f.booking_id)) key = bookingToCustomerKey.get(f.booking_id)
        if (!key && f.customer_email) {
          const e = norm(f.customer_email)
          if (idByEmail.has(e)) key = idByEmail.get(e)!
        }
        if (!key && f.customer_name) {
          const target = norm(f.customer_name)
          key = Object.keys(customerMap).find(k => norm(customerMap[k].name) === target)
        }
        if (!key) {
          // Last resort — synthesize so the activity isn't silently dropped.
          key = resolveKey({ name: f.customer_name, email: f.customer_email })
        }

        const c = customerMap[key]
        const amount = Number(f.importo_totale) || 0
        if (cls === 'penali') { c.penali_spesa_eur += amount; c.penali_eventi += 1 }
        else { c.danni_spesa_eur += amount; c.danni_eventi += 1 }
      }
    }

    // 9) Cauzioni — match by cliente_id, fall back to riferimento_contratto_id (booking).
    //    Bloccata = security deposit currently held. Incassata = cashed in for damage,
    //    so it counts as a danno (mirrors what GestioneDanniTab / CauzioniTab show).
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
        if (stato === 'bloccata') {
          c.cauzioni_attive_count += 1
          c.cauzioni_attive_eur += importo
        } else if (stato === 'incassata') {
          // Cashed-in security deposit = damage payment.
          c.danni_spesa_eur += importo
          c.danni_eventi += 1
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
