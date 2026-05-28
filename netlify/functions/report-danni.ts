import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Keywords from PenaltyModal labels that indicate PHYSICAL DAMAGE to the vehicle
// Matches: fermo_incidente, fermo_alto_valore, fermo_utilitarie, fermo_furgoni,
// foro_sigaretta, gonfia_ripara, sporco, igienizzazione, controlli_elettronici, cani, pista
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
// Matches: fumo, guidatore_non_indicato, carburante_*, multe, assenza_intestatario,
// ritardo_checkout_*, subnoleggio, neopatentati, patente_mancante, ritardo_riconsegna
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

    // Check danni keywords first (physical damage)
    for (const kw of DANNI_KEYWORDS) {
      if (motivo.includes(kw.toLowerCase())) return 'danni'
    }

    // Check penali keywords (contractual violations)
    for (const kw of PENALI_KEYWORDS) {
      if (motivo.includes(kw.toLowerCase())) return 'penali'
    }
  }
  // No motivo or unrecognized — default to penali
  return 'penali'
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  const params = event.queryStringParameters || {}
  const reportType = params.type || 'danni' // 'danni' or 'penali' or 'all'

  if (reportType !== 'danni' && reportType !== 'penali' && reportType !== 'all') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid type. Use "danni", "penali" or "all"' })
    }
  }

  try {
    // ── Entry-level records returned alongside the per-vehicle aggregation
    //    so the new ReportPenaliDanniTab can build temporal / status /
    //    service-type charts without a second round-trip.
    //
    // service_type values normalized to: 'noleggio' | 'lavaggio' | 'meccanica'
    //   (rental → noleggio, car_wash → lavaggio, mechanical_* → meccanica)
    type Entry = {
      id: string
      date: string | null
      type: 'danni' | 'penali'
      category: string                 // human-readable bucket (e.g. "Ritardo", "Carrozzeria", "Fumo")
      customerName: string
      vehicleName: string
      vehiclePlate: string
      description: string
      amount: number
      status: 'paid' | 'pending' | 'cancelled' | 'blocked'
      serviceType: 'noleggio' | 'lavaggio' | 'meccanica' | 'altro'
      source: 'fattura' | 'pending' | 'cauzione'
    }
    const entries: Entry[] = []

    // Lightweight description → categoria bucket. Maps PenaltyModal labels
    // into the broader "Causa" buckets shown in the Tipologia / Cause donut.
    function categorize(desc: string): string {
      const d = desc.toLowerCase()
      if (d.includes('incidente') || d.includes('carrozzeria') || d.includes('foro')) return 'Carrozzeria'
      if (d.includes('fermo')) return 'Fermo Veicolo'
      if (d.includes('sporco') || d.includes('igienizz') || d.includes('cani') || d.includes('pelo')) return 'Pulizia / Igienizzazione'
      if (d.includes('fumo') || d.includes('cenere') || d.includes('odore')) return 'Fumo a Bordo'
      if (d.includes('ritardo') || d.includes('riconsegna') || d.includes('check')) return 'Ritardo Riconsegna'
      if (d.includes('carburante')) return 'Carburante'
      if (d.includes('multa') || d.includes('sanzion')) return 'Multe'
      if (d.includes('subnoleggio') || d.includes('guidatore') || d.includes('intestatario')) return 'Violazioni Contrattuali'
      if (d.includes('km') || d.includes('eccesso') || d.includes('sforo')) return 'Sforo Km'
      if (d.includes('patente') || d.includes('neopatentat')) return 'Documenti'
      if (d.includes('pista') || d.includes('competizion')) return 'Uso Improprio'
      return 'Altro'
    }

    function normalizeServiceType(st: string | null | undefined, bookingHasDates: boolean): Entry['serviceType'] {
      const s = (st || '').toLowerCase().trim()
      if (s === 'car_wash') return 'lavaggio'
      if (s === 'mechanical_service' || s === 'mechanical') return 'meccanica'
      if (s === 'car_rental' || s === 'rental') return 'noleggio'
      // No explicit service_type — infer from dates (rentals have pickup/dropoff)
      if (bookingHasDates) return 'noleggio'
      return 'altro'
    }

    // Fetch all fatture (invoices). `stato` drives the paid/pending/cancelled
    // bucketing for the report — no `data_pagamento` column exists on this
    // table (verified 2026-05-28: only report-danni referenced it, FatturaTab
    // uses `stato` exclusively). Querying it caused a 500 on the function.
    const { data: fatture, error: fattureError } = await supabase
      .from('fatture')
      .select('id, booking_id, importo_totale, items, customer_name, data_emissione, stato')

    if (fattureError) throw fattureError

    // Filter to penalty invoices, then classify as danni or penali
    const matchingInvoices = (fatture || []).filter(f => {
      if (!f.items || !Array.isArray(f.items)) return false
      const hasPenalty = f.items.some((item: any) =>
        item.description && (item.description.includes('Penale prenotazione') || item.description.includes('Danno prenotazione'))
      )
      if (!hasPenalty) return false
      const cls = classifyInvoice(f.items)
      return reportType === 'all' ? cls !== null : cls === reportType
    })

    // Get booking IDs to resolve vehicle / service info
    const bookingIds = matchingInvoices
      .map(f => f.booking_id)
      .filter((id): id is string => !!id)

    const bookingLookup = new Map<string, {
      vehicle_name: string
      vehicle_plate: string
      service_type: string | null
      has_dates: boolean
    }>()

    if (bookingIds.length > 0) {
      const CHUNK_SIZE = 100
      for (let i = 0; i < bookingIds.length; i += CHUNK_SIZE) {
        const chunk = bookingIds.slice(i, i + CHUNK_SIZE)
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, vehicle_name, vehicle_plate, service_type, pickup_date, dropoff_date')
          .in('id', chunk)

        if (bookings) {
          bookings.forEach(b => {
            bookingLookup.set(b.id, {
              vehicle_name: b.vehicle_name || '',
              vehicle_plate: b.vehicle_plate || '',
              service_type: b.service_type || null,
              has_dates: !!(b.pickup_date && b.dropoff_date),
            })
          })
        }
      }
    }

    // Aggregate by vehicle plate
    const vehicleMap: Record<string, {
      vehicleName: string
      vehiclePlate: string
      customerName: string
      count: number
      totalAmount: number
    }> = {}

    matchingInvoices.forEach(f => {
      const booking = f.booking_id ? bookingLookup.get(f.booking_id) : null
      const plate = (booking?.vehicle_plate || 'Sconosciuto').replace(/\s/g, '').toUpperCase()
      const name = booking?.vehicle_name || 'Sconosciuto'

      if (!vehicleMap[plate]) {
        vehicleMap[plate] = {
          vehicleName: name,
          vehiclePlate: plate,
          customerName: f.customer_name || '',
          count: 0,
          totalAmount: 0,
        }
      }

      vehicleMap[plate].count += 1
      vehicleMap[plate].totalAmount += (f.importo_totale || 0)
      if (vehicleMap[plate].vehicleName === 'Sconosciuto' && name !== 'Sconosciuto') {
        vehicleMap[plate].vehicleName = name
      }
      if (!vehicleMap[plate].customerName && f.customer_name) {
        vehicleMap[plate].customerName = f.customer_name
      }

      // Push one entry per fattura (one fattura = one practice).
      const cls = classifyInvoice(f.items) || 'penali'
      const mainItem = (f.items || []).find((it: any) =>
        it.description && (it.description.includes('Penale prenotazione') || it.description.includes('Danno prenotazione'))
      )
      const desc = mainItem?.description || ''
      const motivo = desc.includes(' - ') ? desc.substring(desc.indexOf(' - ') + 3) : desc
      const stato = (f.stato || '').toLowerCase()
      const status: Entry['status'] =
        stato === 'pagata' || stato === 'paid' ? 'paid'
        : stato === 'annullata' || stato === 'cancelled' ? 'cancelled'
        : 'pending'
      entries.push({
        id: f.id,
        date: f.data_emissione || null,
        type: cls,
        category: categorize(motivo),
        customerName: f.customer_name || '',
        vehicleName: name,
        vehiclePlate: plate,
        description: motivo || desc,
        amount: Number(f.importo_totale) || 0,
        status,
        serviceType: normalizeServiceType(booking?.service_type, !!booking?.has_dates),
        source: 'fattura',
      })
    })

    // Also scan bookings.booking_details for pending penalties/danni (Da Saldare, no fattura)
    // Skip bookings that already have a matching fattura to avoid double-counting
    {
      const bookingIdsWithFattura = new Set(bookingIds)
      // bookings.booking_details.penalties[] uses the ENGLISH key (see memory:
      // booking_details_penalties_key.md), bookings.booking_details.danni[] is
      // Italian. Mixed-language schema is intentional — don't unify.
      const sourceKeys: Array<{ key: 'danni' | 'penalties'; type: 'danni' | 'penali' }> =
        reportType === 'all'
          ? [{ key: 'danni', type: 'danni' }, { key: 'penalties', type: 'penali' }]
          : reportType === 'danni'
            ? [{ key: 'danni', type: 'danni' }]
            : [{ key: 'penalties', type: 'penali' }]

      const { data: allBookings } = await supabase
        .from('bookings')
        .select('id, vehicle_name, vehicle_plate, customer_name, booking_details, service_type, pickup_date, dropoff_date, status')

      if (allBookings) {
        for (const b of allBookings) {
          // Skip if this booking already has a fattura counted above
          if (bookingIdsWithFattura.has(b.id)) continue

          for (const { key: detailsKey, type: entryType } of sourceKeys) {
            const list = b.booking_details?.[detailsKey]
            if (!Array.isArray(list) || list.length === 0) continue

            const plate = (b.vehicle_plate || 'Sconosciuto').replace(/\s/g, '').toUpperCase()
            const name = b.vehicle_name || 'Sconosciuto'
            const hasDates = !!(b.pickup_date && b.dropoff_date)
            const bookingCancelled = (b.status || '').toLowerCase().match(/cancell|annull/)

            for (const entry of list) {
              const entryTotal = entry.total || (entry.amount || 0) * (entry.quantity || 1)
              if (entryTotal <= 0) continue

              if (!vehicleMap[plate]) {
                vehicleMap[plate] = {
                  vehicleName: name,
                  vehiclePlate: plate,
                  customerName: b.customer_name || '',
                  count: 0,
                  totalAmount: 0,
                }
              }

              vehicleMap[plate].count += 1
              vehicleMap[plate].totalAmount += entryTotal
              if (vehicleMap[plate].vehicleName === 'Sconosciuto' && name !== 'Sconosciuto') {
                vehicleMap[plate].vehicleName = name
              }
              if (!vehicleMap[plate].customerName && b.customer_name) {
                vehicleMap[plate].customerName = b.customer_name
              }

              const desc: string = entry.label || entry.description || entry.motivo || ''
              entries.push({
                id: `${b.id}:${entry.id || entry.code || desc.slice(0, 16)}`,
                date: entry.date || entry.created_at || b.pickup_date || null,
                type: entryType,
                category: categorize(desc),
                customerName: b.customer_name || '',
                vehicleName: name,
                vehiclePlate: plate,
                description: desc,
                amount: Number(entryTotal) || 0,
                status: bookingCancelled ? 'cancelled' : 'pending',
                serviceType: normalizeServiceType(b.service_type, hasDates),
                source: 'pending',
              })
            }
          }
        }
      }
    }

    // For danni report: also include cashed cauzioni (stato='Bloccata')
    if (reportType === 'danni' || reportType === 'all') {
      // 2026-05-28: era `data_creazione, data_blocco` — colonne inesistenti
      // (schema reale: created_at, data_incasso, data_restituzione, ecc.).
      // La query falliva silenziosamente (error non catturato) e i danni da
      // cauzione bloccata sparivano dal report.
      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('id, veicolo_id, cliente_id, importo, created_at, data_incasso, stato')
        .eq('stato', 'Bloccata')

      if (cauzioni && cauzioni.length > 0) {
        // Resolve vehicle info for cauzioni
        const veicoloIds = [...new Set(cauzioni.map(c => c.veicolo_id).filter(Boolean))]
        const veicoloLookup = new Map<string, { display_name: string; plate: string }>()

        if (veicoloIds.length > 0) {
          const { data: vehicles } = await supabase
            .from('vehicles')
            .select('id, display_name, plate')
            .in('id', veicoloIds)

          if (vehicles) {
            vehicles.forEach(v => {
              veicoloLookup.set(v.id, { display_name: v.display_name || '', plate: v.plate || '' })
            })
          }
        }

        // Resolve customer names for cauzioni
        const clienteIds = [...new Set(cauzioni.map(c => c.cliente_id).filter(Boolean))]
        const clienteLookup = new Map<string, string>()

        if (clienteIds.length > 0) {
          const { data: customers } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome')
            .in('id', clienteIds)

          if (customers) {
            customers.forEach(c => {
              clienteLookup.set(c.id, [c.nome, c.cognome].filter(Boolean).join(' '))
            })
          }
        }

        cauzioni.forEach(c => {
          const vehicle = c.veicolo_id ? veicoloLookup.get(c.veicolo_id) : null
          const plate = (vehicle?.plate || 'Sconosciuto').replace(/\s/g, '').toUpperCase()
          const name = vehicle?.display_name || 'Sconosciuto'
          const custName = c.cliente_id ? (clienteLookup.get(c.cliente_id) || '') : ''

          if (!vehicleMap[plate]) {
            vehicleMap[plate] = {
              vehicleName: name,
              vehiclePlate: plate,
              customerName: custName,
              count: 0,
              totalAmount: 0,
            }
          }

          vehicleMap[plate].count += 1
          vehicleMap[plate].totalAmount += Number(c.importo) || 0
          if (vehicleMap[plate].vehicleName === 'Sconosciuto' && name !== 'Sconosciuto') {
            vehicleMap[plate].vehicleName = name
          }
          if (!vehicleMap[plate].customerName && custName) {
            vehicleMap[plate].customerName = custName
          }

          // Cauzione bloccata = danno (importo trattenuto).
          // serviceType: assume noleggio (cauzioni are only created for rentals).
          entries.push({
            id: c.id,
            date: c.data_incasso || c.created_at || null,
            type: 'danni',
            category: 'Cauzione Trattenuta',
            customerName: custName,
            vehicleName: name,
            vehiclePlate: plate,
            description: 'Cauzione bloccata',
            amount: Number(c.importo) || 0,
            status: 'blocked',
            serviceType: 'noleggio',
            source: 'cauzione',
          })
        })
      }
    }

    const vehicleList = Object.values(vehicleMap)
    vehicleList.sort((a, b) => b.totalAmount - a.totalAmount)

    const totalCount = vehicleList.reduce((s, v) => s + v.count, 0)
    const totalAmount = vehicleList.reduce((s, v) => s + v.totalAmount, 0)

    return {
      statusCode: 200,
      body: JSON.stringify({
        type: reportType,
        totalVehicles: vehicleList.length,
        totalCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        vehicles: vehicleList.map(v => ({
          vehicleName: v.vehicleName,
          vehiclePlate: v.vehiclePlate,
          customerName: v.customerName || '-',
          count: v.count,
          totalAmount: Math.round(v.totalAmount * 100) / 100,
        })),
        entries: entries.map(e => ({
          ...e,
          amount: Math.round(e.amount * 100) / 100,
        })),
      })
    }
  } catch (error: any) {
    console.error('Report danni/penali error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    }
  }
}
