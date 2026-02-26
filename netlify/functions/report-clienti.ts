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
    // Fetch all bookings with valid statuses
    const { data: allBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, customer_id, customer_name, customer_email, price_total, status, service_type, booking_details, pickup_date, dropoff_date, appointment_date')
      .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending', 'Confirmed', 'Completed', 'Active'])

    if (bookingsError) throw bookingsError

    // Classify bookings by type, excluding internals
    type BookingType = 'rental' | 'car_wash' | 'mechanical'

    function classifyBooking(b: any): BookingType | null {
      const details = b.booking_details || {}
      if (details.internal === true) return null
      if (details.createdBy === 'automatic_system') return null

      const name = (b.customer_name || '').trim().toUpperCase()
      if (name.startsWith('INTERNO') || name.startsWith('LAVAGGIO RIENTRO')) return null

      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash') return 'car_wash'
      if (st === 'mechanical_service' || st === 'mechanical') return 'mechanical'
      // Rental: no service_type and has pickup+dropoff dates
      if (!st && b.pickup_date && b.dropoff_date) return 'rental'
      return null
    }

    // Group by customer
    const customerMap: Record<string, {
      customerId: string
      name: string
      email: string
      totalSpendCents: number
      rentalSpendCents: number
      rentalCount: number
      carWashCount: number
      mechanicalCount: number
      totalRentalDays: number
    }> = {}

    let totalRentals = 0
    let totalCarWashes = 0
    let totalMechanical = 0

    ;(allBookings || []).forEach(b => {
      const type = classifyBooking(b)
      if (!type) return

      // Resolve customer key
      const custId = b.customer_id || b.booking_details?.customer?.customerId || ''
      const custEmail = b.customer_email || b.booking_details?.customer?.email || ''
      const key = custId || custEmail || b.id

      if (!customerMap[key]) {
        customerMap[key] = {
          customerId: custId,
          name: b.customer_name || b.booking_details?.customer?.fullName || '',
          email: custEmail,
          totalSpendCents: 0,
          rentalSpendCents: 0,
          rentalCount: 0,
          carWashCount: 0,
          mechanicalCount: 0,
          totalRentalDays: 0,
        }
      }

      const priceCents = b.price_total || 0
      customerMap[key].totalSpendCents += priceCents

      if (type === 'rental') {
        customerMap[key].rentalCount += 1
        customerMap[key].rentalSpendCents += priceCents
        totalRentals += 1
        // Compute rental days
        if (b.pickup_date && b.dropoff_date) {
          const pickup = new Date(b.pickup_date)
          const dropoff = new Date(b.dropoff_date)
          const diffMs = dropoff.getTime() - pickup.getTime()
          const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
          customerMap[key].totalRentalDays += days
        }
      } else if (type === 'car_wash') {
        customerMap[key].carWashCount += 1
        totalCarWashes += 1
      } else if (type === 'mechanical') {
        customerMap[key].mechanicalCount += 1
        totalMechanical += 1
      }

      // Update name/email if better data is available
      if (!customerMap[key].name && (b.customer_name || b.booking_details?.customer?.fullName)) {
        customerMap[key].name = b.customer_name || b.booking_details?.customer?.fullName || ''
      }
      if (!customerMap[key].email && custEmail) {
        customerMap[key].email = custEmail
      }
    })

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

    // Sort by total spend descending
    customerList.sort((a, b) => b.totalSpendCents - a.totalSpendCents)

    // Convert cents to EUR
    const totalRevenue = customerList.reduce((s, c) => s + c.totalSpendCents, 0) / 100
    const totalBookings = totalRentals + totalCarWashes + totalMechanical

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalCustomers: customerList.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalBookings,
        totalRentals,
        totalCarWashes,
        totalMechanical,
        customers: customerList.map(c => ({
          customerId: c.customerId,
          name: c.name || 'Sconosciuto',
          email: c.email || '-',
          totalSpend: Math.round(c.totalSpendCents / 100 * 100) / 100,
          rentalCount: c.rentalCount,
          carWashCount: c.carWashCount,
          mechanicalCount: c.mechanicalCount,
          totalCount: c.rentalCount + c.carWashCount + c.mechanicalCount,
          totalRentalDays: c.totalRentalDays,
          avgDailyRate: c.totalRentalDays > 0
            ? Math.round(c.rentalSpendCents / c.totalRentalDays) / 100
            : 0,
        }))
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
