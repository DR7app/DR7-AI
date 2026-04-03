import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import {
  calculateDynamicPrice,
  parseConfigFromDB,
  type PricingInput,
  type PricingTrace,
} from '../../src/utils/revenuePricingEngine'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { vehicle_id, pickup_date, dropoff_date } = JSON.parse(event.body || '{}')

    if (!vehicle_id || !pickup_date || !dropoff_date) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: 'Missing required fields: vehicle_id, pickup_date, dropoff_date' })
      }
    }

    // 1. Fetch revenue config
    const { data: configRow, error: configError } = await supabase
      .from('revenue_config')
      .select('*')
      .limit(1)
      .single()

    if (configError || !configRow) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ enabled: false, reason: 'No revenue config found' })
      }
    }

    const config = parseConfigFromDB(configRow)

    if (!config.enabled) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ enabled: false, mode: config.mode })
      }
    }

    // 2. Fetch vehicle
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, display_name, daily_rate, category, status')
      .eq('id', vehicle_id)
      .single()

    if (vehicleError || !vehicle) {
      return {
        statusCode: 404, headers,
        body: JSON.stringify({ error: 'Vehicle not found' })
      }
    }

    // 3. Calculate fleet occupation for this category
    const vehicleCategory = vehicle.category || 'urban'

    const { data: categoryVehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('category', vehicleCategory)
      .neq('status', 'retired')

    const totalInCategory = categoryVehicles?.length || 1

    const { data: overlappingBookings } = await supabase
      .from('bookings')
      .select('vehicle_id')
      .in('vehicle_id', (categoryVehicles || []).map((v: { id: string }) => v.id))
      .not('status', 'in', '(cancelled,annullata,completed,completata)')
      .lte('pickup_date', dropoff_date)
      .gte('dropoff_date', pickup_date)

    const busyVehicleIds = new Set((overlappingBookings || []).map((b: { vehicle_id: string }) => b.vehicle_id))
    const occupancyPct = Math.round((busyVehicleIds.size / totalInCategory) * 100)

    // 4. Build pricing input and run the shared engine
    const pricingInput: PricingInput = {
      vehicleId: vehicle.id,
      vehicleName: vehicle.display_name,
      vehicleDailyRateCents: vehicle.daily_rate * 100,
      vehicleCategory,
      pickupDate: pickup_date,
      dropoffDate: dropoff_date,
      occupancyPct,
    }

    const trace: PricingTrace = calculateDynamicPrice(config, pricingInput)

    // 5. Return full trace (includes all debug/audit info)
    return {
      statusCode: 200, headers,
      body: JSON.stringify(trace)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: message })
    }
  }
}
