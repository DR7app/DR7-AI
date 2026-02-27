import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Keywords from PenaltyModal labels that indicate PHYSICAL DAMAGE to the vehicle
const DANNI_KEYWORDS = [
  'fermo veicolo',
  'fermo del veicolo',
  'foro da sigaretta',
  'foro sigaretta',
  'gonfia e ripara',
  'bomboletta',
  'veicolo sporco',
  'igienizzazione',
  'controlli elettronici',
  'disattivazione controlli',
  'cani',
  'pelo di cane',
  'pista',
  'competizioni',
  'incidente',
  'danni',
]

// Keywords from PenaltyModal labels that indicate CONTRACTUAL VIOLATIONS
const PENALI_KEYWORDS = [
  'fumo',
  'odore',
  'cenere',
  'guidatore non',
  'carburante',
  'multe',
  'sanzioni',
  'assenza intestatario',
  'ritardo',
  'check-out',
  'checkout',
  'subnoleggio',
  'neopatentati',
  'non abilitati',
  'patente',
  'riconsegna',
]

function classifyInvoice(items: any[]): 'danni' | 'penali' | null {
  for (const item of items) {
    const desc = (item.description || '').toLowerCase()

    // New format: "Danno prenotazione XXXXXXXX - ..." → always danni
    if (desc.includes('danno prenotazione')) return 'danni'

    // Legacy format: "Penale prenotazione XXXXXXXX - ..." → classify by keywords
    if (!desc.includes('penale prenotazione')) continue

    const dashIdx = desc.indexOf(' - ')
    const motivo = dashIdx >= 0 ? desc.substring(dashIdx + 3) : desc

    for (const kw of DANNI_KEYWORDS) {
      if (motivo.includes(kw.toLowerCase())) return 'danni'
    }
    for (const kw of PENALI_KEYWORDS) {
      if (motivo.includes(kw.toLowerCase())) return 'penali'
    }
  }
  return 'penali'
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    // Fetch all bookings, vehicles, cauzioni, and fatture in parallel
    const [bookingsRes, vehiclesRes, cauzioniRes, fattureRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, user_id, customer_name, customer_email, price_total, status, service_type, booking_details, pickup_date, dropoff_date, appointment_date, vehicle_id')
        .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending', 'Confirmed', 'Completed', 'Active']),
      supabase
        .from('vehicles')
        .select('id, category'),
      supabase
        .from('cauzioni')
        .select('cliente_id, importo')
        .eq('stato', 'Bloccata'),
      supabase
        .from('fatture')
        .select('id, booking_id, importo_totale, items, customer_name')
    ])

    if (bookingsRes.error) throw bookingsRes.error

    // Build vehicle category lookup
    const vehicleCategoryMap = new Map<string, string>()
    if (vehiclesRes.data) {
      vehiclesRes.data.forEach(v => {
        if (v.id && v.category) vehicleCategoryMap.set(v.id, v.category)
      })
    }

    // Build danni (cashed cauzioni) lookup by cliente_id: { importo, count }
    const danniCauzioniMap = new Map<string, { importo: number; count: number }>()
    if (cauzioniRes.data) {
      cauzioniRes.data.forEach((c: any) => {
        if (c.cliente_id) {
          const existing = danniCauzioniMap.get(c.cliente_id) || { importo: 0, count: 0 }
          existing.importo += Number(c.importo) || 0
          existing.count += 1
          danniCauzioniMap.set(c.cliente_id, existing)
        }
      })
    }

    // Process fatture: classify penalty invoices into penali/danni per customer
    // Build booking_id → customer key lookup first (populated during booking processing)
    const bookingToCustomerKey = new Map<string, string>()

    // Classify bookings by type, excluding internals
    type BookingType = 'supercar' | 'urban' | 'aziendali' | 'car_wash' | 'mechanical'

    function classifyBooking(b: any): BookingType | null {
      const details = b.booking_details || {}
      if (details.internal === true) return null
      if (details.createdBy === 'automatic_system') return null

      const name = (b.customer_name || '').trim().toUpperCase()
      if (name.startsWith('INTERNO') || name.startsWith('LAVAGGIO RIENTRO')) return null

      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash') return 'car_wash'
      if (st === 'mechanical_service' || st === 'mechanical') return 'mechanical'

      if (!st && b.pickup_date && b.dropoff_date) {
        const vid = b.vehicle_id || details.vehicle_id || ''
        const cat = vehicleCategoryMap.get(vid) || ''
        if (cat === 'aziendali') return 'aziendali'
        if (cat === 'urban') return 'urban'
        return 'supercar'
      }
      return null
    }

    // Per-customer tracking with per-category breakdowns
    interface CustomerData {
      customerId: string
      name: string
      email: string
      supercar_spesa_cents: number
      supercar_prenotazioni: number
      supercar_giorni: number
      urban_spesa_cents: number
      urban_prenotazioni: number
      urban_giorni: number
      aziendali_spesa_cents: number
      aziendali_prenotazioni: number
      aziendali_giorni: number
      lavaggi_spesa_cents: number
      lavaggi_prenotazioni: number
      meccanica_spesa_cents: number
      meccanica_prenotazioni: number
      penali_spesa_eur: number
      penali_eventi: number
      danni_spesa_eur: number
      danni_eventi: number
    }

    const customerMap: Record<string, CustomerData> = {}

    function getOrCreate(key: string, custId: string, name: string, email: string): CustomerData {
      if (!customerMap[key]) {
        customerMap[key] = {
          customerId: custId,
          name,
          email,
          supercar_spesa_cents: 0, supercar_prenotazioni: 0, supercar_giorni: 0,
          urban_spesa_cents: 0, urban_prenotazioni: 0, urban_giorni: 0,
          aziendali_spesa_cents: 0, aziendali_prenotazioni: 0, aziendali_giorni: 0,
          lavaggi_spesa_cents: 0, lavaggi_prenotazioni: 0,
          meccanica_spesa_cents: 0, meccanica_prenotazioni: 0,
          penali_spesa_eur: 0, penali_eventi: 0,
          danni_spesa_eur: 0, danni_eventi: 0,
        }
      }
      return customerMap[key]
    }

    ;(bookingsRes.data || []).forEach(b => {
      const type = classifyBooking(b)
      if (!type) return

      const custId = b.user_id || b.booking_details?.customer?.customerId || ''
      const custEmail = b.customer_email || b.booking_details?.customer?.email || ''
      const key = custId || custEmail || b.id
      const custName = b.customer_name || b.booking_details?.customer?.fullName || ''

      // Map booking_id → customer key for fatture lookup
      if (b.id) bookingToCustomerKey.set(b.id, key)

      const c = getOrCreate(key, custId, custName, custEmail)

      const priceCents = b.price_total || 0
      const isRental = type === 'supercar' || type === 'urban' || type === 'aziendali'

      if (isRental) {
        let days = 0
        if (b.pickup_date && b.dropoff_date) {
          const pickup = new Date(b.pickup_date)
          const dropoff = new Date(b.dropoff_date)
          const diffMs = dropoff.getTime() - pickup.getTime()
          days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
        }

        if (type === 'supercar') {
          c.supercar_spesa_cents += priceCents
          c.supercar_prenotazioni += 1
          c.supercar_giorni += days
        } else if (type === 'urban') {
          c.urban_spesa_cents += priceCents
          c.urban_prenotazioni += 1
          c.urban_giorni += days
        } else {
          c.aziendali_spesa_cents += priceCents
          c.aziendali_prenotazioni += 1
          c.aziendali_giorni += days
        }
      } else if (type === 'car_wash') {
        c.lavaggi_spesa_cents += priceCents
        c.lavaggi_prenotazioni += 1
      } else if (type === 'mechanical') {
        c.meccanica_spesa_cents += priceCents
        c.meccanica_prenotazioni += 1
      }

      // Update name/email if better data
      if (!c.name && custName) c.name = custName
      if (!c.email && custEmail) c.email = custEmail
    })

    // Process fatture: classify penalty invoices and assign to customers
    if (fattureRes.data) {
      fattureRes.data.forEach((f: any) => {
        if (!f.items || !Array.isArray(f.items)) return
        const hasPenalty = f.items.some((item: any) =>
          item.description && (item.description.includes('Penale prenotazione') || item.description.includes('Danno prenotazione'))
        )
        if (!hasPenalty) return

        const classification = classifyInvoice(f.items)
        if (!classification) return

        // Resolve customer key via booking_id or fallback to customer_name
        let key: string | undefined
        if (f.booking_id) {
          key = bookingToCustomerKey.get(f.booking_id)
        }
        if (!key && f.customer_name) {
          // Try to find a customer entry matching by name
          key = Object.keys(customerMap).find(k => {
            const cm = customerMap[k]
            return cm.name && cm.name.toLowerCase() === f.customer_name.toLowerCase()
          })
          // If not found, create entry keyed by customer_name
          if (!key) {
            key = `fattura_name_${f.customer_name}`
            getOrCreate(key, '', f.customer_name, '')
          }
        }
        if (!key) return

        const c = customerMap[key]
        if (!c) return

        const amount = Number(f.importo_totale) || 0 // fatture.importo_totale is EUR

        if (classification === 'penali') {
          c.penali_spesa_eur += amount
          c.penali_eventi += 1
        } else {
          c.danni_spesa_eur += amount
          c.danni_eventi += 1
        }
      })
    }

    // Apply cashed cauzioni as danni
    for (const [clienteId, data] of danniCauzioniMap.entries()) {
      // Find existing customer entry by customerId
      let key = Object.keys(customerMap).find(k => customerMap[k].customerId === clienteId)
      if (!key) {
        // Create a new entry for customers with cauzioni but no bookings
        key = clienteId
        getOrCreate(key, clienteId, '', '')
      }
      const c = customerMap[key]
      c.danni_spesa_eur += data.importo
      c.danni_eventi += data.count
    }

    const customerList = Object.values(customerMap)

    // Enrich names from customers_extended (batch in chunks of 100)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const customerIds = customerList
      .map(c => c.customerId)
      .filter(id => id && uuidRegex.test(id))

    if (customerIds.length > 0) {
      const CHUNK_SIZE = 100
      for (let i = 0; i < customerIds.length; i += CHUNK_SIZE) {
        const chunk = customerIds.slice(i, i + CHUNK_SIZE)
        try {
          const { data: customers } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, email')
            .in('id', chunk)

          if (customers) {
            const custLookup = new Map(customers.map(c => [c.id, c]))
            customerList.forEach(cl => {
              const enriched = custLookup.get(cl.customerId)
              if (enriched) {
                const fullName = [enriched.nome, enriched.cognome].filter(Boolean).join(' ')
                if (fullName) cl.name = fullName
                if (enriched.email && !cl.email) cl.email = enriched.email
              }
            })
          }
        } catch (enrichErr) {
          console.warn('Customer enrichment failed for chunk, skipping:', enrichErr)
        }
      }
    }

    // Convert to EUR and build response
    const toEur = (cents: number) => Math.round(cents / 100 * 100) / 100
    const round2 = (n: number) => Math.round(n * 100) / 100

    // Sort by total spend descending
    customerList.sort((a, b) => {
      const aTotal = (a.supercar_spesa_cents + a.urban_spesa_cents + a.aziendali_spesa_cents + a.lavaggi_spesa_cents + a.meccanica_spesa_cents) / 100 + a.penali_spesa_eur + a.danni_spesa_eur
      const bTotal = (b.supercar_spesa_cents + b.urban_spesa_cents + b.aziendali_spesa_cents + b.lavaggi_spesa_cents + b.meccanica_spesa_cents) / 100 + b.penali_spesa_eur + b.danni_spesa_eur
      return bTotal - aTotal
    })

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalCustomers: customerList.length,
        customers: customerList.map(c => {
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
            supercar_spesa, supercar_prenotazioni: c.supercar_prenotazioni, supercar_giorni: c.supercar_giorni,
            urban_spesa, urban_prenotazioni: c.urban_prenotazioni, urban_giorni: c.urban_giorni,
            aziendali_spesa, aziendali_prenotazioni: c.aziendali_prenotazioni, aziendali_giorni: c.aziendali_giorni,
            lavaggi_spesa, lavaggi_prenotazioni: c.lavaggi_prenotazioni,
            meccanica_spesa, meccanica_prenotazioni: c.meccanica_prenotazioni,
            penali_spesa, penali_eventi: c.penali_eventi,
            danni_spesa, danni_eventi: c.danni_eventi,
            totale_giorni,
            totale_prenotazioni,
            totale_spesa,
          }
        })
      })
    }
  } catch (error: any) {
    console.error('Report clienti error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    }
  }
}
