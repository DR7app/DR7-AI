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
  const reportType = params.type || 'danni' // 'danni' or 'penali'

  if (reportType !== 'danni' && reportType !== 'penali') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid type. Use "danni" or "penali"' })
    }
  }

  try {
    // Fetch all fatture (invoices)
    const { data: fatture, error: fattureError } = await supabase
      .from('fatture')
      .select('id, booking_id, importo_totale, items, customer_name, data_emissione')

    if (fattureError) throw fattureError

    // Filter to penalty invoices, then classify as danni or penali
    const matchingInvoices = (fatture || []).filter(f => {
      if (!f.items || !Array.isArray(f.items)) return false
      const hasPenalty = f.items.some((item: any) =>
        item.description && (item.description.includes('Penale prenotazione') || item.description.includes('Danno prenotazione'))
      )
      if (!hasPenalty) return false
      return classifyInvoice(f.items) === reportType
    })

    // Get booking IDs to resolve vehicle info
    const bookingIds = matchingInvoices
      .map(f => f.booking_id)
      .filter((id): id is string => !!id)

    const bookingLookup = new Map<string, { vehicle_name: string; vehicle_plate: string }>()

    if (bookingIds.length > 0) {
      const CHUNK_SIZE = 100
      for (let i = 0; i < bookingIds.length; i += CHUNK_SIZE) {
        const chunk = bookingIds.slice(i, i + CHUNK_SIZE)
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, vehicle_name, vehicle_plate')
          .in('id', chunk)

        if (bookings) {
          bookings.forEach(b => {
            bookingLookup.set(b.id, {
              vehicle_name: b.vehicle_name || '',
              vehicle_plate: b.vehicle_plate || ''
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
    })

    // For danni report: also include cashed cauzioni (stato='Bloccata')
    if (reportType === 'danni') {
      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('veicolo_id, cliente_id, importo')
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
        }))
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
