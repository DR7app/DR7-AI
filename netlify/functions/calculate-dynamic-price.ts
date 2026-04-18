import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import {
  calculateDynamicPrice,
  type RevenueConfig,
  type PricingInput,
  type PricingTrace,
} from '../../src/utils/revenuePricingEngine'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Convert Centralina Pro's prezzoDinamico.dynamic to RevenueConfig format.
 * Falls back to revenue_config table if Pro config is empty.
 */
async function loadRevenueConfig(): Promise<RevenueConfig | null> {
  // Try Centralina Pro first
  const { data: proRow } = await supabase
    .from('centralina_pro_config')
    .select('config')
    .eq('id', 'main')
    .maybeSingle()

  const proDynamic = proRow?.config?.prezzoDinamico?.dynamic
  if (proDynamic && typeof proDynamic === 'object') {
    // Convert Pro coefficient format (min/max) to engine format (min_pct/max_pct or min_days/max_days)
    const mapOccCoeffs = (rows: any[]) => rows.map((r: any) => ({
      min_pct: r.min ?? r.min_pct ?? 0,
      max_pct: r.max ?? r.max_pct ?? 100,
      coeff: typeof r.coeff === 'number' ? r.coeff : 1,
      label: r.label || '',
    }))
    const mapAdvCoeffs = (rows: any[]) => rows.map((r: any) => ({
      min_days: r.min ?? r.min_days ?? 0,
      max_days: r.max ?? r.max_days ?? 999,
      coeff: typeof r.coeff === 'number' ? r.coeff : 1,
      label: r.label || '',
    }))
    const mapDurCoeffs = (rows: any[]) => rows.map((r: any) => ({
      min_days: r.min ?? r.min_days ?? 1,
      max_days: r.max ?? r.max_days ?? 999,
      coeff: typeof r.coeff === 'number' ? r.coeff : 1,
      label: r.label || '',
    }))

    // Convert base/min/max prices — remap Pro category IDs to DB category IDs
    const PRO_TO_DB: Record<string, string> = { supercars: 'exotic', urban: 'urban', aziendali: 'aziendali' }
    const remapPrices = (prices: Record<string, any>): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(prices || {})) {
        if (typeof v !== 'number' || v === 0) continue
        // Remap category keys (e.g., "supercars" → "category:exotic")
        if (PRO_TO_DB[k]) {
          out[`category:${PRO_TO_DB[k]}`] = v
        } else {
          out[k] = v // vehicle IDs stay as-is
        }
      }
      return out
    }

    return {
      enabled: proDynamic.enabled ?? true,
      mode: proDynamic.mode || 'suggestion',
      base_prices: remapPrices(proDynamic.base_prices),
      min_prices: remapPrices(proDynamic.min_prices),
      max_prices: remapPrices(proDynamic.max_prices),
      occupation_coefficients: proDynamic.occupation_coefficients?.length
        ? mapOccCoeffs(proDynamic.occupation_coefficients) : [],
      advance_coefficients: proDynamic.advance_coefficients?.length
        ? mapAdvCoeffs(proDynamic.advance_coefficients) : [],
      duration_coefficients: proDynamic.duration_coefficients?.length
        ? mapDurCoeffs(proDynamic.duration_coefficients) : [],
      season_rules: proDynamic.season_rules || [],
    }
  }

  // No Pro config found
  return null
}

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

    // 1. Load revenue config from Centralina Pro (fallback: revenue_config)
    const config = await loadRevenueConfig()

    if (!config || !config.enabled) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ enabled: false, mode: config?.mode || 'disabled' })
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

    // 5. Return full trace
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
