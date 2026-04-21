/**
 * Revenue Management Pricing Engine
 * ===================================
 * SINGLE SOURCE OF TRUTH for all dynamic pricing calculations.
 *
 * Used by:
 * - Admin preview/simulator (RevenuePricingTab)
 * - Booking flow suggestion (ReservationsTab)
 * - Backend pricing endpoint (calculate-dynamic-price.ts)
 *
 * Monetary convention:
 * - vehicle.daily_rate is stored in CENTS in the DB
 * - all overrides/config prices are in EUROS (as entered by admin)
 * - final output prices are in EUROS
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type RevenueMode = 'disabled' | 'suggestion' | 'auto_apply'

export interface CoefficientRow {
  min_pct?: number
  max_pct?: number
  min_days?: number
  max_days?: number
  coeff: number
  label: string
}

export interface SeasonRule {
  name: string
  start_date: string  // MM-DD
  end_date: string    // MM-DD
  coeff: number
  type: string
}

export interface NamedCoefficient {
  key: string
  label: string
  coeff: number
}

export interface RevenueConfig {
  enabled: boolean
  mode: RevenueMode
  base_prices: Record<string, number>       // key: vehicleId or "category:<name>"
  min_prices: Record<string, number>        // same key convention
  max_prices: Record<string, number>        // same key convention
  occupation_coefficients: CoefficientRow[]
  advance_coefficients: CoefficientRow[]
  duration_coefficients: CoefficientRow[]
  calendar_gap_coefficients: CoefficientRow[]
  season_rules: SeasonRule[]
  day_type_coefficients: NamedCoefficient[]
  vehicle_occupation_coefficients: NamedCoefficient[]
  promo_push_coefficients: NamedCoefficient[]
  special_dates: Record<string, string>     // YYYY-MM-DD -> day_type key
  active_promo_level: string
}

export interface PricingInput {
  vehicleId: string
  vehicleName: string
  vehicleDailyRateCents: number   // from DB, in cents
  vehicleCategory: string
  pickupDate: string              // ISO date string
  dropoffDate: string             // ISO date string
  occupancyPct: number            // 0-100 (fleet-wide for this category)
  vehicleOwnOccupancyPct?: number // 0-100 (this vehicle only, last N days)
  calendarGapDays?: number        // gap before this booking on same vehicle's calendar
}

export interface BreakdownItem {
  label: string
  coeff: number
  description: string
}

export interface PricingTrace {
  vehicleId: string
  vehicleName: string
  category: string
  vehicleBaseRateEur: number
  categoryOverrideEur: number | null
  vehicleOverrideEur: number | null
  selectedBaseRateEur: number
  selectedBaseRateSource: 'vehicle_override' | 'category_override' | 'vehicle_daily_rate'
  occupancyPct: number
  occupancyCoefficient: number
  occupancyCoefficientLabel: string
  advanceCoefficient: number
  advanceCoefficientLabel: string
  durationCoefficient: number
  durationCoefficientLabel: string
  seasonalityCoefficient: number
  seasonalityCoefficientLabel: string
  rawDailyRate: number
  minPrice: number | null
  maxPrice: number | null
  minHit: boolean
  maxHit: boolean
  finalDailyRateEur: number
  rentalDays: number
  finalTotalEur: number
  mode: RevenueMode
  enabled: boolean
  breakdown: BreakdownItem[]
}

// ─── Default config ─────────────────────────────────────────────────────────

export function getDefaultConfig(): RevenueConfig {
  return {
    enabled: true,
    mode: 'auto_apply',
    base_prices: {},
    min_prices: {},
    max_prices: {},
    occupation_coefficients: [
      { min_pct: 0, max_pct: 40, coeff: 0.90, label: 'Bassa occupazione' },
      { min_pct: 40, max_pct: 70, coeff: 1.00, label: 'Occupazione normale' },
      { min_pct: 70, max_pct: 90, coeff: 1.15, label: 'Alta occupazione' },
      { min_pct: 90, max_pct: 101, coeff: 1.30, label: 'Occupazione critica' },
    ],
    advance_coefficients: [
      { min_days: 0, max_days: 2, coeff: 1.25, label: 'Last minute' },
      { min_days: 2, max_days: 7, coeff: 1.10, label: 'Prenotazione breve' },
      { min_days: 7, max_days: 30, coeff: 1.00, label: 'Anticipo standard' },
      { min_days: 30, max_days: 9999, coeff: 0.95, label: 'Prenotazione anticipata' },
    ],
    duration_coefficients: [
      { min_days: 1, max_days: 3, coeff: 1.00, label: 'Breve durata' },
      { min_days: 3, max_days: 7, coeff: 0.95, label: 'Settimanale' },
      { min_days: 7, max_days: 14, coeff: 0.90, label: 'Bi-settimanale' },
      { min_days: 14, max_days: 30, coeff: 0.85, label: 'Mensile' },
      { min_days: 30, max_days: 9999, coeff: 0.80, label: 'Lungo termine' },
    ],
    calendar_gap_coefficients: [],
    season_rules: [],
    day_type_coefficients: [],
    vehicle_occupation_coefficients: [],
    promo_push_coefficients: [],
    special_dates: {},
    active_promo_level: '',
  }
}

// ─── Bracket matching ───────────────────────────────────────────────────────

/**
 * Match a value against coefficient brackets.
 * Uses [min, max) with max_pct=101 to include 100%.
 * Returns null if no bracket matches.
 */
export function matchBracket(
  brackets: CoefficientRow[],
  value: number,
  field: 'pct' | 'days'
): CoefficientRow | null {
  const minKey = field === 'pct' ? 'min_pct' : 'min_days'
  const maxKey = field === 'pct' ? 'max_pct' : 'max_days'

  for (const b of brackets) {
    const min = b[minKey] ?? 0
    const max = b[maxKey] ?? 9999
    if (value >= min && value < max) return b
  }
  return null  // no match → default coefficient 1.00
}

/**
 * Match a season rule for a rental period.
 * If multiple match, pick highest coeff.
 */
export function matchSeason(
  rules: SeasonRule[],
  pickupDate: string,
  dropoffDate: string
): SeasonRule | null {
  const pickup = new Date(pickupDate)
  const pickupMM = String(pickup.getMonth() + 1).padStart(2, '0')
  const pickupDD = String(pickup.getDate()).padStart(2, '0')
  const pickupMMDD = `${pickupMM}-${pickupDD}`

  const dropoff = new Date(dropoffDate)
  const dropoffMM = String(dropoff.getMonth() + 1).padStart(2, '0')
  const dropoffDD = String(dropoff.getDate()).padStart(2, '0')
  const dropoffMMDD = `${dropoffMM}-${dropoffDD}`

  let best: SeasonRule | null = null
  for (const rule of rules) {
    if (!rule.start_date || !rule.end_date) continue
    const crosses = rule.start_date > rule.end_date

    let overlaps = false
    if (crosses) {
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

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string
  message: string
}

export function validateConfig(config: RevenueConfig): ValidationError[] {
  const errors: ValidationError[] = []

  // Validate occupation coefficients
  for (let i = 0; i < config.occupation_coefficients.length; i++) {
    const row = config.occupation_coefficients[i]
    const min = row.min_pct ?? 0
    const max = row.max_pct ?? 0
    if (min < 0 || min > 100) errors.push({ field: `occupation_coefficients[${i}].min_pct`, message: `Min occupazione deve essere 0-100, trovato: ${min}` })
    if (max < 0 || max > 101) errors.push({ field: `occupation_coefficients[${i}].max_pct`, message: `Max occupazione deve essere 0-101, trovato: ${max}` })
    if (min > max) errors.push({ field: `occupation_coefficients[${i}]`, message: `Min (${min}) > Max (${max})` })
    if (row.coeff <= 0) errors.push({ field: `occupation_coefficients[${i}].coeff`, message: `Coefficiente deve essere > 0, trovato: ${row.coeff}` })

    // Check overlaps with other rows
    for (let j = i + 1; j < config.occupation_coefficients.length; j++) {
      const other = config.occupation_coefficients[j]
      const oMin = other.min_pct ?? 0
      const oMax = other.max_pct ?? 0
      if (min < oMax && max > oMin) {
        errors.push({ field: `occupation_coefficients[${i}]`, message: `Range [${min}-${max}) sovrapposto con riga ${j + 1} [${oMin}-${oMax})` })
      }
    }
  }

  // Validate advance coefficients
  for (let i = 0; i < config.advance_coefficients.length; i++) {
    const row = config.advance_coefficients[i]
    if (row.coeff <= 0) errors.push({ field: `advance_coefficients[${i}].coeff`, message: `Coefficiente deve essere > 0` })
    const min = row.min_days ?? 0
    const max = row.max_days ?? 0
    if (min < 0) errors.push({ field: `advance_coefficients[${i}].min_days`, message: `Min giorni non può essere negativo` })
    if (min > max) errors.push({ field: `advance_coefficients[${i}]`, message: `Min (${min}) > Max (${max})` })
  }

  // Validate duration coefficients
  for (let i = 0; i < config.duration_coefficients.length; i++) {
    const row = config.duration_coefficients[i]
    if (row.coeff <= 0) errors.push({ field: `duration_coefficients[${i}].coeff`, message: `Coefficiente deve essere > 0` })
    const min = row.min_days ?? 0
    const max = row.max_days ?? 0
    if (min < 0) errors.push({ field: `duration_coefficients[${i}].min_days`, message: `Min giorni non può essere negativo` })
    if (min > max) errors.push({ field: `duration_coefficients[${i}]`, message: `Min (${min}) > Max (${max})` })
  }

  // Validate season rules
  for (let i = 0; i < config.season_rules.length; i++) {
    const rule = config.season_rules[i]
    if (rule.coeff <= 0) errors.push({ field: `season_rules[${i}].coeff`, message: `Coefficiente deve essere > 0` })
    if (!rule.start_date || !/^\d{2}-\d{2}$/.test(rule.start_date)) {
      errors.push({ field: `season_rules[${i}].start_date`, message: `Formato data non valido (atteso: MM-DD)` })
    }
    if (!rule.end_date || !/^\d{2}-\d{2}$/.test(rule.end_date)) {
      errors.push({ field: `season_rules[${i}].end_date`, message: `Formato data non valido (atteso: MM-DD)` })
    }
  }

  // Validate base prices (no negatives)
  for (const [key, val] of Object.entries(config.base_prices)) {
    if (val < 0) errors.push({ field: `base_prices.${key}`, message: `Prezzo base non può essere negativo: ${val}` })
  }
  for (const [key, val] of Object.entries(config.min_prices)) {
    if (val < 0) errors.push({ field: `min_prices.${key}`, message: `Prezzo minimo non può essere negativo: ${val}` })
  }
  for (const [key, val] of Object.entries(config.max_prices)) {
    if (val < 0) errors.push({ field: `max_prices.${key}`, message: `Prezzo massimo non può essere negativo: ${val}` })
  }

  return errors
}

// ─── Core Pricing Engine ────────────────────────────────────────────────────

/**
 * THE pricing formula. Single source of truth.
 *
 * finalDailyRate =
 *   selectedBaseRate
 *   × occupancyCoefficient
 *   × advanceCoefficient (demandCoefficient)
 *   × durationCoefficient
 *   × seasonalityCoefficient
 *
 * Clamped to [minPrice, maxPrice] if configured.
 */
export function calculateDynamicPrice(
  config: RevenueConfig,
  input: PricingInput
): PricingTrace {
  const vehicleBaseRateEur = input.vehicleDailyRateCents / 100

  // ─── 1. Base rate priority: vehicle override > category override > vehicle daily_rate ───
  const vehicleOverride = config.base_prices[input.vehicleId]
  const categoryOverride = config.base_prices[`category:${input.vehicleCategory}`]

  let selectedBaseRateEur: number
  let selectedBaseRateSource: PricingTrace['selectedBaseRateSource']

  if (vehicleOverride != null && vehicleOverride > 0) {
    selectedBaseRateEur = vehicleOverride
    selectedBaseRateSource = 'vehicle_override'
  } else if (categoryOverride != null && categoryOverride > 0) {
    selectedBaseRateEur = categoryOverride
    selectedBaseRateSource = 'category_override'
  } else {
    selectedBaseRateEur = vehicleBaseRateEur
    selectedBaseRateSource = 'vehicle_daily_rate'
  }

  // ─── 2. Rental days ───
  const pickupMs = new Date(input.pickupDate).getTime()
  const dropoffMs = new Date(input.dropoffDate).getTime()
  const rentalDays = Math.max(1, Math.ceil((dropoffMs - pickupMs) / (1000 * 60 * 60 * 24)))

  // ─── 3. Days ahead ───
  const nowMs = Date.now()
  const daysAhead = Math.max(0, Math.floor((pickupMs - nowMs) / (1000 * 60 * 60 * 24)))

  // ─── 4. Coefficients ───
  const breakdown: BreakdownItem[] = []

  const occBracket = matchBracket(config.occupation_coefficients, input.occupancyPct, 'pct')
  const occCoeff = occBracket?.coeff ?? 1.0
  breakdown.push({
    label: 'Coefficienti Occupazione',
    coeff: occCoeff,
    description: occBracket?.label || `${input.occupancyPct}% occupata`
  })

  const advBracket = matchBracket(config.advance_coefficients, daysAhead, 'days')
  const advCoeff = advBracket?.coeff ?? 1.0
  breakdown.push({
    label: 'Coefficienti Anticipo',
    coeff: advCoeff,
    description: advBracket?.label || `${daysAhead} giorni prima`
  })

  const durBracket = matchBracket(config.duration_coefficients, rentalDays, 'days')
  const durCoeff = durBracket?.coeff ?? 1.0
  breakdown.push({
    label: 'Coefficienti Durata',
    coeff: durCoeff,
    description: durBracket?.label || `${rentalDays} giorni`
  })

  const seasonMatch = matchSeason(config.season_rules, input.pickupDate, input.dropoffDate)
  const seasonCoeff = seasonMatch?.coeff ?? 1.0
  breakdown.push({
    label: 'Coefficienti Stagione',
    coeff: seasonCoeff,
    description: seasonMatch?.name || 'Nessuna regola stagionale'
  })

  // Calendar gap: range-based lookup on calendarGapDays input
  let gapCoeff = 1.0
  let gapLabel = 'Nessun dato gap'
  if ((config.calendar_gap_coefficients || []).length && typeof input.calendarGapDays === 'number') {
    const gapBracket = matchBracket(config.calendar_gap_coefficients, input.calendarGapDays, 'days')
    if (gapBracket) {
      gapCoeff = gapBracket.coeff
      gapLabel = gapBracket.label
    }
  }
  breakdown.push({
    label: 'Coefficienti Gap Calendario',
    coeff: gapCoeff,
    description: gapLabel
  })

  // Day type: pickup date -> special_dates[YYYY-MM-DD] -> day_type key -> coeff
  let dayTypeCoeff = 1.0
  let dayTypeLabel = 'Giorno standard'
  const pickupYmd = input.pickupDate.slice(0, 10)
  const dayTypeKey = config.special_dates?.[pickupYmd]
  if (dayTypeKey) {
    const dayTypeMatch = (config.day_type_coefficients || []).find(d => d.key === dayTypeKey)
    if (dayTypeMatch) {
      dayTypeCoeff = dayTypeMatch.coeff
      dayTypeLabel = dayTypeMatch.label
    }
  }
  breakdown.push({
    label: 'Coefficienti Tipo Giorno',
    coeff: dayTypeCoeff,
    description: dayTypeLabel
  })

  // Vehicle own occupation: bucketed match on vehicleOwnOccupancyPct into named keys
  let vehOccCoeff = 1.0
  let vehOccLabel = 'Nessun dato singolo veicolo'
  if ((config.vehicle_occupation_coefficients || []).length && typeof input.vehicleOwnOccupancyPct === 'number') {
    const pct = input.vehicleOwnOccupancyPct
    // Map pct to named bucket: key can be 'basso'/'medio'/'alto' or '0-30'/etc.
    let bucketKey = 'medio'
    if (pct < 33) bucketKey = 'basso'
    else if (pct < 66) bucketKey = 'medio'
    else bucketKey = 'alto'
    const vehOccMatch = (config.vehicle_occupation_coefficients || []).find(v => v.key === bucketKey)
      ?? (config.vehicle_occupation_coefficients || [])[Math.min(
        Math.floor(pct / (100 / Math.max(1, (config.vehicle_occupation_coefficients || []).length))),
        (config.vehicle_occupation_coefficients || []).length - 1
      )]
    if (vehOccMatch) {
      vehOccCoeff = vehOccMatch.coeff
      vehOccLabel = `${vehOccMatch.label} (${pct}%)`
    }
  }
  breakdown.push({
    label: 'Coefficienti Occupazione Veicolo',
    coeff: vehOccCoeff,
    description: vehOccLabel
  })

  // Promo push: lookup by active_promo_level
  let promoCoeff = 1.0
  let promoLabel = 'Nessuna promo attiva'
  if (config.active_promo_level) {
    const promoMatch = (config.promo_push_coefficients || []).find(p => p.key === config.active_promo_level)
    if (promoMatch) {
      promoCoeff = promoMatch.coeff
      promoLabel = promoMatch.label
    }
  }
  breakdown.push({
    label: 'Coefficienti Spinta Direzionale (Promo)',
    coeff: promoCoeff,
    description: promoLabel
  })

  // ─── 5. Formula ───
  let rawDailyRate = selectedBaseRateEur * occCoeff * advCoeff * durCoeff * seasonCoeff * gapCoeff * dayTypeCoeff * vehOccCoeff * promoCoeff

  // ─── 6. Min/Max clamp ───
  const minPrice = config.min_prices[input.vehicleId]
    ?? config.min_prices[`category:${input.vehicleCategory}`]
    ?? null
  const maxPrice = config.max_prices[input.vehicleId]
    ?? config.max_prices[`category:${input.vehicleCategory}`]
    ?? null

  let finalDailyRate = rawDailyRate
  let minHit = false
  let maxHit = false

  if (minPrice != null && finalDailyRate < minPrice) {
    finalDailyRate = minPrice
    minHit = true
  }
  if (maxPrice != null && finalDailyRate > maxPrice) {
    finalDailyRate = maxPrice
    maxHit = true
  }

  // Round to 2 decimals
  finalDailyRate = Math.round(finalDailyRate * 100) / 100
  rawDailyRate = Math.round(rawDailyRate * 100) / 100
  const finalTotalEur = Math.round(finalDailyRate * rentalDays * 100) / 100

  return {
    vehicleId: input.vehicleId,
    vehicleName: input.vehicleName,
    category: input.vehicleCategory,
    vehicleBaseRateEur,
    categoryOverrideEur: categoryOverride ?? null,
    vehicleOverrideEur: vehicleOverride ?? null,
    selectedBaseRateEur,
    selectedBaseRateSource,
    occupancyPct: input.occupancyPct,
    occupancyCoefficient: occCoeff,
    occupancyCoefficientLabel: occBracket?.label || 'Nessuna regola',
    advanceCoefficient: advCoeff,
    advanceCoefficientLabel: advBracket?.label || 'Nessuna regola',
    durationCoefficient: durCoeff,
    durationCoefficientLabel: durBracket?.label || 'Nessuna regola',
    seasonalityCoefficient: seasonCoeff,
    seasonalityCoefficientLabel: seasonMatch?.name || 'Nessuna regola stagionale',
    rawDailyRate,
    minPrice,
    maxPrice,
    minHit,
    maxHit,
    finalDailyRateEur: finalDailyRate,
    rentalDays,
    finalTotalEur,
    mode: config.mode,
    enabled: config.enabled,
    breakdown,
  }
}

/**
 * Parse raw DB config row into a typed RevenueConfig.
 * Handles missing/malformed fields gracefully.
 */
export function parseConfigFromDB(row: {
  enabled?: boolean
  mode?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>
} | null): RevenueConfig {
  if (!row) return getDefaultConfig()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (row.config || {}) as Record<string, any>
  const validModes: RevenueMode[] = ['disabled', 'suggestion', 'auto_apply']
  const rawMode = String(row.mode || 'suggestion')
  // Map legacy mode names
  let mode: RevenueMode
  if (rawMode === 'auto' || rawMode === 'auto_with_approval') {
    mode = 'auto_apply'
  } else if (validModes.includes(rawMode as RevenueMode)) {
    mode = rawMode as RevenueMode
  } else {
    mode = 'suggestion'
  }

  // Use defaults if coefficient arrays are empty/missing — never let them be []
  const defaults = getDefaultConfig()
  const occCoeffs = c.occupation_coefficients as CoefficientRow[] | undefined
  const advCoeffs = c.advance_coefficients as CoefficientRow[] | undefined
  const durCoeffs = c.duration_coefficients as CoefficientRow[] | undefined

  return {
    enabled: row.enabled ?? true,
    mode,
    base_prices: (c.base_prices as Record<string, number>) || {},
    min_prices: (c.min_prices as Record<string, number>) || {},
    max_prices: (c.max_prices as Record<string, number>) || {},
    occupation_coefficients: occCoeffs?.length ? occCoeffs : defaults.occupation_coefficients,
    advance_coefficients: advCoeffs?.length ? advCoeffs : defaults.advance_coefficients,
    duration_coefficients: durCoeffs?.length ? durCoeffs : defaults.duration_coefficients,
    calendar_gap_coefficients: (c.calendar_gap_coefficients as CoefficientRow[]) || [],
    season_rules: (c.season_rules as SeasonRule[]) || [],
    day_type_coefficients: (c.day_type_coefficients as NamedCoefficient[]) || [],
    vehicle_occupation_coefficients: (c.vehicle_occupation_coefficients as NamedCoefficient[]) || [],
    promo_push_coefficients: (c.promo_push_coefficients as NamedCoefficient[]) || [],
    special_dates: (c.special_dates as Record<string, string>) || {},
    active_promo_level: (c.active_promo_level as string) || '',
  }
}
