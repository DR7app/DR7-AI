import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    // Fetch all fatture (invoices)
    const { data: fatture, error: fattureError } = await supabase
      .from('fatture')
      .select('id, booking_id, importo_totale, items, customer_name, data_emissione')

    if (fattureError) throw fattureError

    // Filter to penalty invoices only: items array where description contains "Penale prenotazione"
    const penaltyInvoices = (fatture || []).filter(f => {
      if (!f.items || !Array.isArray(f.items)) return false
      return f.items.some((item: any) =>
        item.description && item.description.includes('Penale prenotazione')
      )
    })

    // Get booking IDs to resolve vehicle info
    const bookingIds = penaltyInvoices
      .map(f => f.booking_id)
      .filter((id): id is string => !!id)

    let bookingLookup = new Map<string, { vehicle_name: string; vehicle_plate: string }>()

    if (bookingIds.length > 0) {
      // Fetch in chunks of 100
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
      penaltyCount: number
      totalAmount: number
    }> = {}

    penaltyInvoices.forEach(f => {
      const booking = f.booking_id ? bookingLookup.get(f.booking_id) : null
      const plate = (booking?.vehicle_plate || 'Sconosciuto').replace(/\s/g, '').toUpperCase()
      const name = booking?.vehicle_name || 'Sconosciuto'

      if (!vehicleMap[plate]) {
        vehicleMap[plate] = {
          vehicleName: name,
          vehiclePlate: plate,
          penaltyCount: 0,
          totalAmount: 0,
        }
      }

      vehicleMap[plate].penaltyCount += 1
      // importo_totale for penalties is already in EUR (not cents)
      vehicleMap[plate].totalAmount += (f.importo_totale || 0)
      // Update name if we have a better one
      if (vehicleMap[plate].vehicleName === 'Sconosciuto' && name !== 'Sconosciuto') {
        vehicleMap[plate].vehicleName = name
      }
    })

    const vehicleList = Object.values(vehicleMap)
    // Sort by total amount descending
    vehicleList.sort((a, b) => b.totalAmount - a.totalAmount)

    const totalDamages = vehicleList.reduce((s, v) => s + v.penaltyCount, 0)
    const totalAmount = vehicleList.reduce((s, v) => s + v.totalAmount, 0)

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalVehiclesWithDamages: vehicleList.length,
        totalDamages,
        totalAmount: Math.round(totalAmount * 100) / 100,
        vehicles: vehicleList.map(v => ({
          vehicleName: v.vehicleName,
          vehiclePlate: v.vehiclePlate,
          penaltyCount: v.penaltyCount,
          totalAmount: Math.round(v.totalAmount * 100) / 100,
        }))
      })
    }
  } catch (error: any) {
    console.error('Report danni error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    }
  }
}
