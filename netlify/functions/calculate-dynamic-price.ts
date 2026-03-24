import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface CoefficientBracket {
  min_pct?: number; max_pct?: number
  min_days?: number; max_days?: number
  coeff: number; label: string
}

interface SeasonRule {
  name: string; start_date: string; end_date: string
  coeff: number; type: string
}

interface BreakdownItem {
  label: string; coeff: number; description: string
}

function matchBracket(brackets: CoefficientBracket[], value: number, field: 'pct' | 'days'): CoefficientBracket | null {
  const minKey = field === 'pct' ? 'min_pct' : 'min_days'
  const maxKey = field === 'pct' ? 'max_pct' : 'max_days'
  for (const b of brackets) {
    const min = b[minKey] ?? 0
    const max = b[maxKey] ?? 9999
    if (value >= min && value < max) return b
  }
  return brackets.length > 0 ? brackets[brackets.length - 1] : null
}

function matchSeason(rules: SeasonRule[], pickupDate: string, dropoffDate: string): SeasonRule | null {
  // Check if any part of the rental period overlaps with a season rule
  const pickup = new Date(pickupDate)
  const pickupMM = String(pickup.getMonth() + 1).padStart(2, '0')
  const pickupDD = String(pickup.getDate()).padStart(2, '0')
  const pickupMMDD = `${pickupMM}-${pickupDD}`

  const dropoff = new Date(dropoffDate)
  const dropoffMM = String(dropoff.getMonth() + 1).padStart(2, '0')
  const dropoffDD = String(dropoff.getDate()).padStart(2, '0')
  const dropoffMMDD = `${dropoffMM}-${dropoffDD}`

  // Find highest-priority (highest coeff) matching season
  let best: SeasonRule | null = null
  for (const rule of rules) {
    const crosses = rule.start_date > rule.end_date // e.g., 12-20 to 01-06
    let overlaps = false

    if (crosses) {
      // Wraps around year boundary
      overlaps = pickupMMDD >= rule.start_date || pickupMMDD <= rule.end_date ||
                 dropoffMMDD >= rule.start_date || dropoffMMDD <= rule.end_date
    } else {
      overlaps = (pickupMMDD >= rule.start_date && pickupMMDD <= rule.end_date) ||
                 (dropoffMMDD >= rule.start_date && dropoffMMDD <= rule.end_date) ||
                 (pickupMMDD <= rule.start_date && dropoffMMDD >= rule.end_date)
    }

    if (overlaps && (!best || rule.coeff > best.coeff)) {
      best = rule
    }
  }
  return best
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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

    if (!configRow.enabled) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ enabled: false })
      }
    }

    const config = configRow.config || {}

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

    // 3. Determine base price (€/day): config override > category fallback > vehicle daily_rate
    const basePrices = config.base_prices || {}
    const vehicleCategory = vehicle.category || 'urban'
    let basePrice = vehicle.daily_rate / 100 // cents to EUR

    if (basePrices[vehicle_id]) {
      basePrice = basePrices[vehicle_id]
    } else if (basePrices[`category:${vehicleCategory}`]) {
      basePrice = basePrices[`category:${vehicleCategory}`]
    }

    // 4. Calculate rental days
    const pickupMs = new Date(pickup_date).getTime()
    const dropoffMs = new Date(dropoff_date).getTime()
    const rentalDays = Math.max(1, Math.ceil((dropoffMs - pickupMs) / (1000 * 60 * 60 * 24)))

    // 5. Calculate days ahead (advance booking)
    const nowMs = Date.now()
    const daysAhead = Math.max(0, Math.floor((pickupMs - nowMs) / (1000 * 60 * 60 * 24)))

    // 6. Calculate fleet occupation for this category during rental period
    const { data: categoryVehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('category', vehicleCategory)
      .neq('status', 'retired')

    const totalInCategory = categoryVehicles?.length || 1

    const { data: overlappingBookings } = await supabase
      .from('bookings')
      .select('vehicle_id')
      .in('vehicle_id', (categoryVehicles || []).map(v => v.id))
      .not('status', 'in', '(cancelled,annullata,completed,completata)')
      .lte('pickup_date', dropoff_date)
      .gte('dropoff_date', pickup_date)

    const busyVehicleIds = new Set((overlappingBookings || []).map(b => b.vehicle_id))
    const occupationPct = Math.round((busyVehicleIds.size / totalInCategory) * 100)

    // 7. Match coefficient brackets
    const breakdown: BreakdownItem[] = []

    const occBracket = matchBracket(config.occupation_coefficients || [], occupationPct, 'pct')
    const occCoeff = occBracket?.coeff ?? 1.0
    breakdown.push({
      label: 'Occupazione flotta',
      coeff: occCoeff,
      description: occBracket?.label || `${occupationPct}% occupata`
    })

    const advBracket = matchBracket(config.advance_coefficients || [], daysAhead, 'days')
    const advCoeff = advBracket?.coeff ?? 1.0
    breakdown.push({
      label: 'Anticipo prenotazione',
      coeff: advCoeff,
      description: advBracket?.label || `${daysAhead} giorni prima`
    })

    const durBracket = matchBracket(config.duration_coefficients || [], rentalDays, 'days')
    const durCoeff = durBracket?.coeff ?? 1.0
    breakdown.push({
      label: 'Durata noleggio',
      coeff: durCoeff,
      description: durBracket?.label || `${rentalDays} giorni`
    })

    const seasonMatch = matchSeason(config.season_rules || [], pickup_date, dropoff_date)
    const seasonCoeff = seasonMatch?.coeff ?? 1.0
    breakdown.push({
      label: 'Stagionalità',
      coeff: seasonCoeff,
      description: seasonMatch?.name || 'Nessuna regola stagionale'
    })

    // 8. Calculate final price
    let dailyPrice = basePrice * occCoeff * advCoeff * durCoeff * seasonCoeff

    // Apply min/max limits
    const minPrices = config.min_prices || {}
    const maxPrices = config.max_prices || {}
    const minPrice = minPrices[vehicle_id] ?? minPrices[`category:${vehicleCategory}`] ?? 0
    const maxPrice = maxPrices[vehicle_id] ?? maxPrices[`category:${vehicleCategory}`] ?? Infinity

    let minHit = false
    let maxHit = false
    if (dailyPrice < minPrice) { dailyPrice = minPrice; minHit = true }
    if (maxPrice < Infinity && dailyPrice > maxPrice) { dailyPrice = maxPrice; maxHit = true }

    const totalPrice = Math.round(dailyPrice * rentalDays * 100) / 100
    dailyPrice = Math.round(dailyPrice * 100) / 100

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        enabled: true,
        suggestedPrice: totalPrice,
        dailyRate: dailyPrice,
        rentalDays,
        basePrice: Math.round(basePrice * 100) / 100,
        breakdown,
        occupationPct,
        daysAhead,
        limits: { minHit, maxHit, minPrice, maxPrice: maxPrice === Infinity ? null : maxPrice },
        vehicleName: vehicle.display_name,
        category: vehicleCategory
      })
    }
  } catch (error: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message })
    }
  }
}
