import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import {
  calculateDynamicPrice,
  type RevenueConfig,
  type PricingInput,
  type PricingTrace,
} from '../../src/utils/revenuePricingEngine'
import { computeVehicleMonthlyRevenue } from './utils/vehicleRevenue'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Converts Pro's named season tiers + month→tier map into the engine's
// season_rules format (one rule per month, MM-DD ranges).
function buildSeasonRulesFromProConfig(proDynamic: any): Array<{ name: string; type: string; start_date: string; end_date: string; coeff: number }> {
  const coeffs = Array.isArray(proDynamic?.season_coefficients) ? proDynamic.season_coefficients : []
  const monthMap: Record<string, string> = (proDynamic?.season_by_month && typeof proDynamic.season_by_month === 'object') ? proDynamic.season_by_month : {}
  if (!coeffs.length || Object.keys(monthMap).length === 0) return []

  const tierToCoeff = new Map<string, number>()
  const tierToLabel = new Map<string, string>()
  for (const c of coeffs) {
    if (c && typeof c.key === 'string' && typeof c.coeff === 'number') {
      tierToCoeff.set(c.key, c.coeff)
      tierToLabel.set(c.key, typeof c.label === 'string' ? c.label : c.key)
    }
  }

  const daysInMonth = (m: number) => {
    // Use 2024 (leap) just for Feb safety; last day across years is 28/29 — engine uses MM-DD string compare, so pick 28 for Feb to stay inclusive.
    if (m === 2) return 28
    if ([4, 6, 9, 11].includes(m)) return 30
    return 31
  }

  const rules: Array<{ name: string; type: string; start_date: string; end_date: string; coeff: number }> = []
  for (let m = 1; m <= 12; m++) {
    const tier = monthMap[String(m)]
    if (!tier) continue
    const coeff = tierToCoeff.get(tier)
    if (typeof coeff !== 'number') continue
    const mm = String(m).padStart(2, '0')
    const lastDay = String(daysInMonth(m)).padStart(2, '0')
    rules.push({
      name: tierToLabel.get(tier) || tier,
      type: tier,
      start_date: `${mm}-01`,
      end_date: `${mm}-${lastDay}`,
      coeff,
    })
  }
  return rules
}

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
      calendar_gap_coefficients: proDynamic.calendar_gap_coefficients?.length
        ? mapDurCoeffs(proDynamic.calendar_gap_coefficients) : [],
      // Build engine-format season_rules from Pro's named tiers + month→tier map.
      season_rules: buildSeasonRulesFromProConfig(proDynamic),
      day_type_coefficients: Array.isArray(proDynamic.day_type_coefficients)
        ? proDynamic.day_type_coefficients.map((d: any) => ({ key: d.key, label: d.label, coeff: Number(d.coeff) || 1.0 })) : [],
      vehicle_occupation_coefficients: Array.isArray(proDynamic.vehicle_occupation_coefficients)
        ? proDynamic.vehicle_occupation_coefficients.map((d: any) => ({ key: d.key, label: d.label, coeff: Number(d.coeff) || 1.0 })) : [],
      promo_push_coefficients: Array.isArray(proDynamic.promo_push_coefficients)
        ? proDynamic.promo_push_coefficients.map((d: any) => ({ key: d.key, label: d.label, coeff: Number(d.coeff) || 1.0 })) : [],
      special_dates: (proDynamic.special_dates && typeof proDynamic.special_dates === 'object') ? proDynamic.special_dates : {},
      special_periods: Array.isArray(proDynamic.special_periods)
        ? proDynamic.special_periods.filter((p: any) => p && typeof p.start_date === 'string')
        : [],
      active_promo_level: proDynamic.active_promo_level || '',
      vehicle_revenue_targets: (proDynamic.vehicle_revenue_targets && typeof proDynamic.vehicle_revenue_targets === 'object')
        ? proDynamic.vehicle_revenue_targets : {},
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
      .select('id, display_name, daily_rate, category, status, plate')
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

    // 3b. Per-vehicle own occupancy over last 30 days (for vehicle_occupation_coefficients)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: thisVehicleBookings } = await supabase
      .from('bookings')
      .select('pickup_date, dropoff_date')
      .eq('vehicle_id', vehicle.id)
      .not('status', 'in', '(cancelled,annullata)')
      .gte('pickup_date', thirtyDaysAgo)
      .lte('dropoff_date', thirtyDaysAhead)
    let vehicleOwnOccupiedDays = 0
    for (const b of (thisVehicleBookings || [])) {
      const p = new Date(b.pickup_date).getTime()
      const d = new Date(b.dropoff_date).getTime()
      vehicleOwnOccupiedDays += Math.max(1, Math.ceil((d - p) / (1000 * 60 * 60 * 24)))
    }
    const vehicleOwnOccupancyPct = Math.min(100, Math.round((vehicleOwnOccupiedDays / 60) * 100))

    // 3c. Calendar gap: days from pickup to nearest previous booking's dropoff on same vehicle
    const pickupMs = new Date(pickup_date).getTime()
    const { data: priorBookings } = await supabase
      .from('bookings')
      .select('dropoff_date')
      .eq('vehicle_id', vehicle.id)
      .not('status', 'in', '(cancelled,annullata)')
      .lt('dropoff_date', pickup_date)
      .order('dropoff_date', { ascending: false })
      .limit(1)
    let calendarGapDays: number | undefined
    if (priorBookings && priorBookings.length > 0) {
      const prevDropMs = new Date(priorBookings[0].dropoff_date).getTime()
      calendarGapDays = Math.max(0, Math.floor((pickupMs - prevDropMs) / (1000 * 60 * 60 * 24)))
    }

    // 3d. Vehicle monthly revenue — SAME calculation the Report uses, so the
    // per-vehicle target coefficient ("Spinta Veicolo") activates against the
    // number the admin sees in Reports. Skipped when no target is configured
    // for this vehicle to avoid the extra query.
    let vehicleMonthlyRevenueEur: number | undefined
    const hasTarget = !!config.vehicle_revenue_targets?.[vehicle.id]
    if (hasTarget) {
      const nowRome = new Date()
      const year = nowRome.getUTCFullYear()
      const monthNum = nowRome.getUTCMonth() + 1
      const { totalRevenue } = await computeVehicleMonthlyRevenue(
        supabase,
        { id: vehicle.id, plate: vehicle.plate, display_name: vehicle.display_name },
        year,
        monthNum,
      )
      vehicleMonthlyRevenueEur = totalRevenue
    }

    // 4. Build pricing input and run the shared engine
    const pricingInput: PricingInput = {
      vehicleId: vehicle.id,
      vehicleName: vehicle.display_name,
      vehicleDailyRateCents: vehicle.daily_rate * 100,
      vehicleCategory,
      pickupDate: pickup_date,
      dropoffDate: dropoff_date,
      occupancyPct,
      vehicleOwnOccupancyPct,
      calendarGapDays,
      vehicleMonthlyRevenueEur,
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
