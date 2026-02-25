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

    // Filter to rental bookings only (same logic as monthly-report.ts)
    const rentalBookings = (allBookings || []).filter(b => {
      if (!b.pickup_date || !b.dropoff_date) return false
      const st = (b.service_type || '').trim().toLowerCase()
      if (st === 'car_wash' || st === 'mechanical_service' || st === 'mechanical') return false
      const details = b.booking_details || {}
      if (details.internal === true) return false
      if (details.createdBy === 'automatic_system') return false
      return true
    })

    // Group by customer
    const customerMap: Record<string, {
      customerId: string
      name: string
      email: string
      totalSpendCents: number
      bookingsCount: number
    }> = {}

    rentalBookings.forEach(b => {
      // Resolve customer ID: column first, then booking_details fallback
      const custId = b.customer_id || b.booking_details?.customer?.customerId || ''
      const custEmail = b.customer_email || b.booking_details?.customer?.email || ''
      // Use customer_id as primary key, fallback to email
      const key = custId || custEmail || b.id

      if (!customerMap[key]) {
        customerMap[key] = {
          customerId: custId,
          name: b.customer_name || b.booking_details?.customer?.fullName || '',
          email: custEmail,
          totalSpendCents: 0,
          bookingsCount: 0,
        }
      }

      customerMap[key].totalSpendCents += (b.price_total || 0)
      customerMap[key].bookingsCount += 1
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
    const customerIds = customerList
      .map(c => c.customerId)
      .filter(id => id && id.length > 0)

    if (customerIds.length > 0) {
      const CHUNK_SIZE = 100
      for (let i = 0; i < customerIds.length; i += CHUNK_SIZE) {
        const chunk = customerIds.slice(i, i + CHUNK_SIZE)
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
      }
    }

    // Sort by total spend descending
    customerList.sort((a, b) => b.totalSpendCents - a.totalSpendCents)

    // Convert cents to EUR
    const totalRevenue = customerList.reduce((s, c) => s + c.totalSpendCents, 0) / 100
    const totalBookings = customerList.reduce((s, c) => s + c.bookingsCount, 0)

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalCustomers: customerList.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalBookings,
        customers: customerList.map(c => ({
          customerId: c.customerId,
          name: c.name || 'Sconosciuto',
          email: c.email || '-',
          totalSpend: Math.round(c.totalSpendCents / 100 * 100) / 100,
          bookingsCount: c.bookingsCount,
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
