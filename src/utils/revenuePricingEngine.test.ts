import { describe, it, expect } from 'vitest'
import {
  calculateDynamicPrice,
  calculateDayTypeMeanCoeff,
  matchBracket,
  matchSeason,
  validateConfig,
  parseConfigFromDB,
  getDefaultConfig,
  type RevenueConfig,
  type PricingInput,
  type CoefficientRow,
} from './revenuePricingEngine'

// ─── Helper to create a standard input ─────────────────────────────────────

function makeInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    vehicleId: 'v1',
    vehicleName: 'Test Car',
    vehicleDailyRateCents: 10000, // EUR 100.00
    vehicleCategory: 'urban',
    pickupDate: '2026-04-10',
    dropoffDate: '2026-04-13', // 3 days
    occupancyPct: 50,
    ...overrides,
  }
}

function makeConfig(overrides: Partial<RevenueConfig> = {}): RevenueConfig {
  return {
    ...getDefaultConfig(),
    enabled: true,
    mode: 'suggestion',
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. DISABLED MODE — uses vehicle base rate only
// ═══════════════════════════════════════════════════════════════════════════

describe('Mode: disabled', () => {
  it('returns enabled=false and mode=disabled', () => {
    const config = makeConfig({ enabled: false, mode: 'disabled' })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.enabled).toBe(false)
    expect(result.mode).toBe('disabled')
  })

  it('still calculates pricing (for preview purposes)', () => {
    const config = makeConfig({ enabled: false, mode: 'disabled' })
    const result = calculateDynamicPrice(config, makeInput())
    // Engine always calculates, caller decides whether to use it
    expect(result.finalDailyRateEur).toBeGreaterThan(0)
    expect(result.finalTotalEur).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. SUGGESTION MODE — computes rate but does not auto-apply
// ═══════════════════════════════════════════════════════════════════════════

describe('Mode: suggestion', () => {
  it('returns mode=suggestion', () => {
    const config = makeConfig({ mode: 'suggestion' })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.mode).toBe('suggestion')
    expect(result.enabled).toBe(true)
  })

  it('computes a suggested rate', () => {
    const config = makeConfig({ mode: 'suggestion' })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.finalDailyRateEur).toBeGreaterThan(0)
    expect(result.finalTotalEur).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. AUTO_APPLY MODE — applies computed dynamic rate
// ═══════════════════════════════════════════════════════════════════════════

describe('Mode: auto_apply', () => {
  it('returns mode=auto_apply', () => {
    const config = makeConfig({ mode: 'auto_apply' })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.mode).toBe('auto_apply')
    expect(result.enabled).toBe(true)
  })

  it('computes the same rate as suggestion mode', () => {
    const configSugg = makeConfig({ mode: 'suggestion' })
    const configAuto = makeConfig({ mode: 'auto_apply' })
    const input = makeInput()
    const resultSugg = calculateDynamicPrice(configSugg, input)
    const resultAuto = calculateDynamicPrice(configAuto, input)
    expect(resultAuto.finalDailyRateEur).toBe(resultSugg.finalDailyRateEur)
    expect(resultAuto.finalTotalEur).toBe(resultSugg.finalTotalEur)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. VEHICLE OVERRIDE wins over CATEGORY OVERRIDE
// ═══════════════════════════════════════════════════════════════════════════

describe('Base rate priority', () => {
  it('vehicle override wins over category override', () => {
    const config = makeConfig({
      base_prices: { 'v1': 200, 'category:urban': 150 },
      occupation_coefficients: [],
      advance_coefficients: [],
      duration_coefficients: [],
      season_rules: [],
    })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.selectedBaseRateEur).toBe(200)
    expect(result.selectedBaseRateSource).toBe('vehicle_override')
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 5. CATEGORY OVERRIDE wins over vehicle base rate when no vehicle override
  // ═══════════════════════════════════════════════════════════════════════

  it('category override wins when no vehicle override', () => {
    const config = makeConfig({
      base_prices: { 'category:urban': 150 },
      occupation_coefficients: [],
      advance_coefficients: [],
      duration_coefficients: [],
      season_rules: [],
    })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.selectedBaseRateEur).toBe(150)
    expect(result.selectedBaseRateSource).toBe('category_override')
  })

  it('vehicle daily rate used when no overrides', () => {
    const config = makeConfig({
      base_prices: {},
      occupation_coefficients: [],
      advance_coefficients: [],
      duration_coefficients: [],
      season_rules: [],
    })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.selectedBaseRateEur).toBe(100) // 10000 cents = EUR 100
    expect(result.selectedBaseRateSource).toBe('vehicle_daily_rate')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. OCCUPANCY COEFFICIENT selection
// ═══════════════════════════════════════════════════════════════════════════

describe('Occupancy coefficient matching', () => {
  const brackets: CoefficientRow[] = [
    { min_pct: 0, max_pct: 40, coeff: 0.90, label: 'Bassa' },
    { min_pct: 40, max_pct: 70, coeff: 1.00, label: 'Normale' },
    { min_pct: 70, max_pct: 90, coeff: 1.15, label: 'Alta' },
    { min_pct: 90, max_pct: 101, coeff: 1.30, label: 'Critica' },
  ]

  it('selects correct bracket for 0%', () => {
    expect(matchBracket(brackets, 0, 'pct')?.coeff).toBe(0.90)
  })

  it('selects correct bracket for 50%', () => {
    expect(matchBracket(brackets, 50, 'pct')?.coeff).toBe(1.00)
  })

  it('selects correct bracket for 75%', () => {
    expect(matchBracket(brackets, 75, 'pct')?.coeff).toBe(1.15)
  })

  it('selects correct bracket for 95%', () => {
    expect(matchBracket(brackets, 95, 'pct')?.coeff).toBe(1.30)
  })

  it('selects correct bracket for 100%', () => {
    expect(matchBracket(brackets, 100, 'pct')?.coeff).toBe(1.30)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 7. NO MATCHING COEFFICIENT defaults to 1.00
  // ═══════════════════════════════════════════════════════════════════════

  it('returns null when no bracket matches', () => {
    expect(matchBracket([], 50, 'pct')).toBeNull()
  })

  it('engine uses 1.00 when no coefficient matches', () => {
    const config = makeConfig({
      base_prices: {},
      occupation_coefficients: [],
      advance_coefficients: [],
      duration_coefficients: [],
      season_rules: [],
    })
    const result = calculateDynamicPrice(config, makeInput())
    // All coefficients should be 1.00
    result.breakdown.forEach(item => {
      expect(item.coeff).toBe(1.00)
    })
    expect(result.finalDailyRateEur).toBe(100) // base rate unchanged
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. OVERLAPPING RANGES are rejected by validation
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation: overlapping ranges', () => {
  it('detects overlapping occupation ranges', () => {
    const config = makeConfig({
      occupation_coefficients: [
        { min_pct: 0, max_pct: 50, coeff: 0.90, label: 'A' },
        { min_pct: 30, max_pct: 70, coeff: 1.00, label: 'B' }, // overlaps with A
      ],
    })
    const errors = validateConfig(config)
    const overlapErrors = errors.filter(e => e.message.includes('sovrapposto'))
    expect(overlapErrors.length).toBeGreaterThan(0)
  })

  it('accepts non-overlapping ranges', () => {
    const config = makeConfig({
      occupation_coefficients: [
        { min_pct: 0, max_pct: 50, coeff: 0.90, label: 'A' },
        { min_pct: 50, max_pct: 101, coeff: 1.00, label: 'B' },
      ],
    })
    const errors = validateConfig(config)
    const overlapErrors = errors.filter(e => e.message.includes('sovrapposto'))
    expect(overlapErrors.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. INVALID OCCUPANCY VALUES are rejected
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation: invalid occupancy', () => {
  it('rejects min_pct > 100', () => {
    const config = makeConfig({
      occupation_coefficients: [
        { min_pct: 110, max_pct: 120, coeff: 1.0, label: 'Bad' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.field.includes('min_pct'))).toBe(true)
  })

  it('rejects negative min_pct', () => {
    const config = makeConfig({
      occupation_coefficients: [
        { min_pct: -10, max_pct: 50, coeff: 1.0, label: 'Bad' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.field.includes('min_pct'))).toBe(true)
  })

  it('rejects min > max', () => {
    const config = makeConfig({
      occupation_coefficients: [
        { min_pct: 80, max_pct: 50, coeff: 1.0, label: 'Bad' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.message.includes('Min') && e.message.includes('Max'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. NEGATIVE PRICES are rejected
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation: negative prices', () => {
  it('rejects negative base price', () => {
    const config = makeConfig({ base_prices: { 'v1': -50 } })
    const errors = validateConfig(config)
    expect(errors.some(e => e.field.includes('base_prices'))).toBe(true)
  })

  it('rejects negative min price', () => {
    const config = makeConfig({ min_prices: { 'v1': -10 } })
    const errors = validateConfig(config)
    expect(errors.some(e => e.field.includes('min_prices'))).toBe(true)
  })

  it('rejects zero coefficient', () => {
    const config = makeConfig({
      occupation_coefficients: [
        { min_pct: 0, max_pct: 50, coeff: 0, label: 'Zero' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.message.includes('> 0'))).toBe(true)
  })

  it('rejects negative coefficient', () => {
    const config = makeConfig({
      advance_coefficients: [
        { min_days: 0, max_days: 10, coeff: -1.5, label: 'Neg' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.message.includes('> 0'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. SAVE THEN RELOAD returns same config (parseConfigFromDB roundtrip)
// ═══════════════════════════════════════════════════════════════════════════

describe('Config persistence roundtrip', () => {
  it('parseConfigFromDB roundtrips correctly', () => {
    const original = makeConfig({
      base_prices: { 'v1': 150, 'category:exotic': 300 },
      min_prices: { 'category:urban': 50 },
      max_prices: { 'v1': 500 },
      occupation_coefficients: [
        { min_pct: 0, max_pct: 50, coeff: 0.90, label: 'Low' },
      ],
    })

    // Simulate DB row
    const dbRow = {
      enabled: original.enabled,
      mode: original.mode,
      config: {
        base_prices: original.base_prices,
        min_prices: original.min_prices,
        max_prices: original.max_prices,
        occupation_coefficients: original.occupation_coefficients,
        advance_coefficients: original.advance_coefficients,
        duration_coefficients: original.duration_coefficients,
        season_rules: original.season_rules,
      },
    }

    const parsed = parseConfigFromDB(dbRow)
    expect(parsed.enabled).toBe(original.enabled)
    expect(parsed.mode).toBe(original.mode)
    expect(parsed.base_prices).toEqual(original.base_prices)
    expect(parsed.min_prices).toEqual(original.min_prices)
    expect(parsed.max_prices).toEqual(original.max_prices)
    expect(parsed.occupation_coefficients).toEqual(original.occupation_coefficients)
  })

  it('handles null DB row gracefully', () => {
    const parsed = parseConfigFromDB(null)
    expect(parsed.enabled).toBe(false)
    expect(parsed.mode).toBe('suggestion')
  })

  it('maps legacy mode names', () => {
    const parsed = parseConfigFromDB({ enabled: true, mode: 'auto', config: {} })
    expect(parsed.mode).toBe('auto_apply')

    const parsed2 = parseConfigFromDB({ enabled: true, mode: 'auto_with_approval', config: {} })
    expect(parsed2.mode).toBe('auto_apply')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 12. PREVIEW matches backend production pricing exactly
// ═══════════════════════════════════════════════════════════════════════════

describe('Preview matches production', () => {
  it('same config + same input = same result regardless of mode', () => {
    const config = makeConfig({
      base_prices: { 'v1': 120 },
      occupation_coefficients: [
        { min_pct: 0, max_pct: 50, coeff: 0.90, label: 'Low' },
        { min_pct: 50, max_pct: 101, coeff: 1.10, label: 'High' },
      ],
    })
    const input = makeInput({ occupancyPct: 60 })

    const resultSugg = calculateDynamicPrice({ ...config, mode: 'suggestion' }, input)
    const resultAuto = calculateDynamicPrice({ ...config, mode: 'auto_apply' }, input)

    expect(resultSugg.finalDailyRateEur).toBe(resultAuto.finalDailyRateEur)
    expect(resultSugg.finalTotalEur).toBe(resultAuto.finalTotalEur)
    expect(resultSugg.selectedBaseRateEur).toBe(resultAuto.selectedBaseRateEur)
    expect(resultSugg.breakdown).toEqual(resultAuto.breakdown)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 13 & 14. BOOKING FLOW integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Booking flow integration logic', () => {
  it('when enabled=true and mode=auto_apply, price should be applied', () => {
    const config = makeConfig({ mode: 'auto_apply' })
    const result = calculateDynamicPrice(config, makeInput())
    // Integration test: caller checks mode === 'auto_apply' to auto-set price
    expect(result.mode).toBe('auto_apply')
    expect(result.enabled).toBe(true)
    expect(result.finalTotalEur).toBeGreaterThan(0)
  })

  it('when enabled=false, booking flow should bypass revenue management', () => {
    const config = makeConfig({ enabled: false, mode: 'disabled' })
    const result = calculateDynamicPrice(config, makeInput())
    expect(result.enabled).toBe(false)
    // Caller should check result.enabled === false and skip applying price
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FORMULA CORRECTNESS
// ═══════════════════════════════════════════════════════════════════════════

describe('Formula correctness', () => {
  it('finalDailyRate = base * occ * adv * dur * season', () => {
    const config = makeConfig({
      base_prices: { 'v1': 100 },
      occupation_coefficients: [
        { min_pct: 0, max_pct: 101, coeff: 1.20, label: 'All' },
      ],
      advance_coefficients: [
        { min_days: 0, max_days: 9999, coeff: 1.10, label: 'All' },
      ],
      duration_coefficients: [
        { min_days: 0, max_days: 9999, coeff: 0.90, label: 'All' },
      ],
      season_rules: [
        { name: 'Test', start_date: '04-01', end_date: '04-30', coeff: 1.05, type: 'media' },
      ],
    })

    const result = calculateDynamicPrice(config, makeInput({ occupancyPct: 50 }))

    // Expected: 100 * 1.20 * 1.10 * 0.90 * 1.05 = 124.74
    const expected = Math.round(100 * 1.20 * 1.10 * 0.90 * 1.05 * 100) / 100
    expect(result.finalDailyRateEur).toBe(expected)
    expect(result.rentalDays).toBe(3) // Apr 10 to Apr 13
    expect(result.finalTotalEur).toBe(Math.round(expected * 3 * 100) / 100)
  })

  it('applies min/max clamping correctly', () => {
    const config = makeConfig({
      base_prices: { 'v1': 50 },
      min_prices: { 'v1': 80 },
      max_prices: { 'v1': 200 },
      occupation_coefficients: [],
      advance_coefficients: [],
      duration_coefficients: [],
      season_rules: [],
    })

    const result = calculateDynamicPrice(config, makeInput())
    // Base = 50, all coefficients = 1.0, so raw = 50
    // Min = 80, so clamped to 80
    expect(result.finalDailyRateEur).toBe(80)
    expect(result.minHit).toBe(true)
    expect(result.maxHit).toBe(false)
  })

  it('max clamping works', () => {
    const config = makeConfig({
      base_prices: { 'v1': 300 },
      max_prices: { 'v1': 200 },
      occupation_coefficients: [],
      advance_coefficients: [],
      duration_coefficients: [],
      season_rules: [],
    })

    const result = calculateDynamicPrice(config, makeInput())
    expect(result.finalDailyRateEur).toBe(200)
    expect(result.maxHit).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SEASON MATCHING
// ═══════════════════════════════════════════════════════════════════════════

describe('Season matching', () => {
  it('matches summer season', () => {
    const rules = [
      { name: 'Estate', start_date: '06-15', end_date: '09-15', coeff: 1.20, type: 'alta' },
    ]
    const result = matchSeason(rules, '2026-07-01', '2026-07-10')
    expect(result?.coeff).toBe(1.20)
  })

  it('matches year-wrapping season (Christmas)', () => {
    const rules = [
      { name: 'Natale', start_date: '12-20', end_date: '01-06', coeff: 1.25, type: 'picco' },
    ]
    const result = matchSeason(rules, '2026-12-25', '2027-01-02')
    expect(result?.coeff).toBe(1.25)
  })

  it('no match returns null', () => {
    const rules = [
      { name: 'Estate', start_date: '06-15', end_date: '09-15', coeff: 1.20, type: 'alta' },
    ]
    const result = matchSeason(rules, '2026-02-01', '2026-02-05')
    expect(result).toBeNull()
  })

  it('picks highest coeff when multiple match', () => {
    const rules = [
      { name: 'Media', start_date: '04-01', end_date: '04-30', coeff: 1.10, type: 'media' },
      { name: 'Picco Pasqua', start_date: '04-10', end_date: '04-20', coeff: 1.30, type: 'picco' },
    ]
    const result = matchSeason(rules, '2026-04-12', '2026-04-15')
    expect(result?.coeff).toBe(1.30)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TRACE/AUDIT completeness
// ═══════════════════════════════════════════════════════════════════════════

describe('Audit trace completeness', () => {
  it('includes all required trace fields', () => {
    const config = makeConfig()
    const result = calculateDynamicPrice(config, makeInput())

    expect(result).toHaveProperty('vehicleId')
    expect(result).toHaveProperty('vehicleName')
    expect(result).toHaveProperty('category')
    expect(result).toHaveProperty('vehicleBaseRateEur')
    expect(result).toHaveProperty('categoryOverrideEur')
    expect(result).toHaveProperty('vehicleOverrideEur')
    expect(result).toHaveProperty('selectedBaseRateEur')
    expect(result).toHaveProperty('selectedBaseRateSource')
    expect(result).toHaveProperty('occupancyPct')
    expect(result).toHaveProperty('occupancyCoefficient')
    expect(result).toHaveProperty('advanceCoefficient')
    expect(result).toHaveProperty('durationCoefficient')
    expect(result).toHaveProperty('seasonalityCoefficient')
    expect(result).toHaveProperty('rawDailyRate')
    expect(result).toHaveProperty('finalDailyRateEur')
    expect(result).toHaveProperty('rentalDays')
    expect(result).toHaveProperty('finalTotalEur')
    expect(result).toHaveProperty('mode')
    expect(result).toHaveProperty('enabled')
    expect(result).toHaveProperty('breakdown')
    expect(result.breakdown.length).toBe(4) // occ, adv, dur, season
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION: season rules
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation: season rules', () => {
  it('rejects invalid date format', () => {
    const config = makeConfig({
      season_rules: [
        { name: 'Bad', start_date: '2026-01-01', end_date: '04-30', coeff: 1.0, type: 'media' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.message.includes('MM-DD'))).toBe(true)
  })

  it('rejects zero coefficient in season rule', () => {
    const config = makeConfig({
      season_rules: [
        { name: 'Bad', start_date: '04-01', end_date: '04-30', coeff: 0, type: 'media' },
      ],
    })
    const errors = validateConfig(config)
    expect(errors.some(e => e.message.includes('> 0'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// calculateDayTypeMeanCoeff — arithmetic mean over every day of the period
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateDayTypeMeanCoeff', () => {
  // Reference weekday coefficients matching the Centralina Pro defaults.
  const weekdayTiers = [
    { key: 'monday',    label: 'Lunedì',    coeff: 0.95 },
    { key: 'tuesday',   label: 'Martedì',   coeff: 0.95 },
    { key: 'wednesday', label: 'Mercoledì', coeff: 0.95 },
    { key: 'thursday',  label: 'Giovedì',   coeff: 1.00 },
    { key: 'friday',    label: 'Venerdì',   coeff: 1.50 },
    { key: 'saturday',  label: 'Sabato',    coeff: 1.50 },
    { key: 'sunday',    label: 'Domenica',  coeff: 1.25 },
    { key: 'prefestivo', label: 'Prefestivo', coeff: 1.50 },
    { key: 'evento_top', label: 'Evento top', coeff: 1.50 },
  ]

  it('returns 1.0 neutral when day_type_coefficients is empty (backward compat)', () => {
    const r = calculateDayTypeMeanCoeff([], {}, '2026-04-24', 3)
    expect(r.coeff).toBe(1.0)
    expect(r.perDay.length).toBe(3)
  })

  it('is the arithmetic mean of venerdì, sabato, domenica for a Fri→Sun rental', () => {
    // 2026-04-24 is a Friday (Gregorian)
    const r = calculateDayTypeMeanCoeff(weekdayTiers, {}, '2026-04-24', 3)
    expect(r.perDay.map(p => p.key)).toEqual(['friday', 'saturday', 'sunday'])
    // (1.50 + 1.50 + 1.25) / 3 = 1.4166…
    expect(r.coeff).toBeCloseTo((1.5 + 1.5 + 1.25) / 3, 10)
  })

  it('counts a repeated weekday multiple times', () => {
    // 8-day rental starting Saturday 2026-04-25 covers two Saturdays.
    const r = calculateDayTypeMeanCoeff(weekdayTiers, {}, '2026-04-25', 8)
    const keys = r.perDay.map(p => p.key)
    expect(keys.filter(k => k === 'saturday').length).toBe(2)
    expect(keys.length).toBe(8)
  })

  it('uses special_dates override instead of the weekday tier when defined', () => {
    // 2026-04-24 (Friday) marked as "evento_top" — its coeff replaces the friday coeff.
    // Second day (Saturday 2026-04-25) has no override and keeps its weekday tier.
    const r = calculateDayTypeMeanCoeff(
      weekdayTiers,
      { '2026-04-24': 'evento_top' },
      '2026-04-24',
      2,
    )
    expect(r.perDay[0].key).toBe('evento_top')
    expect(r.perDay[1].key).toBe('saturday')
    expect(r.coeff).toBeCloseTo((1.5 + 1.5) / 2, 10)
  })

  it('falls back to 1.0 for a day whose key is not in the tier list', () => {
    // Only Friday defined. Saturday and Sunday have no matching row → contribute 1.0.
    const onlyFriday = [{ key: 'friday', label: 'Venerdì', coeff: 2.0 }]
    const r = calculateDayTypeMeanCoeff(onlyFriday, {}, '2026-04-24', 3)
    expect(r.perDay[0].coeff).toBe(2.0)
    expect(r.perDay[1].coeff).toBe(1.0)
    expect(r.perDay[2].coeff).toBe(1.0)
    expect(r.coeff).toBeCloseTo((2 + 1 + 1) / 3, 10)
  })

  it('treats rentalDays < 1 as a single day', () => {
    const r = calculateDayTypeMeanCoeff(weekdayTiers, {}, '2026-04-24', 0)
    expect(r.perDay.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// calculateDynamicPrice — day_type mean is applied end-to-end
// ═══════════════════════════════════════════════════════════════════════════

describe('Day-type mean integration (end-to-end via calculateDynamicPrice)', () => {
  it('uses the mean day-type coeff in the final formula for a Fri→Sun rental', () => {
    const config = makeConfig({
      base_prices: { v1: 100 }, // keep base deterministic
      min_prices: {}, max_prices: {},
      occupation_coefficients: [], advance_coefficients: [],
      duration_coefficients: [], calendar_gap_coefficients: [],
      season_rules: [],
      day_type_coefficients: [
        { key: 'monday',    label: 'Lunedì',    coeff: 1.0 },
        { key: 'tuesday',   label: 'Martedì',   coeff: 1.0 },
        { key: 'wednesday', label: 'Mercoledì', coeff: 1.0 },
        { key: 'thursday',  label: 'Giovedì',   coeff: 1.0 },
        { key: 'friday',    label: 'Venerdì',   coeff: 1.5 },
        { key: 'saturday',  label: 'Sabato',    coeff: 1.5 },
        { key: 'sunday',    label: 'Domenica',  coeff: 1.25 },
      ],
      special_dates: {},
    })
    const input = makeInput({
      vehicleId: 'v1',
      pickupDate: '2026-04-24', // Friday
      dropoffDate: '2026-04-27', // Monday = 3 days
    })
    const result = calculateDynamicPrice(config, input)
    const dayTypeRow = result.breakdown.find(b => b.label === 'Coefficienti Tipo Giorno')
    expect(dayTypeRow?.coeff).toBeCloseTo((1.5 + 1.5 + 1.25) / 3, 10)
    // rawDailyRate should include that mean factor (other coeffs are 1.0 here).
    // The engine rounds to 2 decimals internally, so use matching precision.
    expect(result.rawDailyRate).toBeCloseTo(100 * (1.5 + 1.5 + 1.25) / 3, 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Per-vehicle monthly revenue target → coefficient
// ═══════════════════════════════════════════════════════════════════════════

describe('vehicle_revenue_targets (Spinta Veicolo)', () => {
  function flatConfig() {
    // All other coefficients neutralised so we can read the target in isolation.
    return makeConfig({
      base_prices: { v1: 100 },
      min_prices: {}, max_prices: {},
      occupation_coefficients: [], advance_coefficients: [],
      duration_coefficients: [], calendar_gap_coefficients: [],
      season_rules: [], day_type_coefficients: [],
      vehicle_occupation_coefficients: [],
      promo_push_coefficients: [],
      active_promo_level: '',
    })
  }

  it('does NOT activate the coefficient when no target is configured for the vehicle', () => {
    const result = calculateDynamicPrice(flatConfig(), makeInput({ vehicleId: 'v1' }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.0)
  })

  it('does NOT activate when monthly revenue is below the lowest tier', () => {
    const config = flatConfig()
    config.vehicle_revenue_targets = { v1: { tiers: [{ min_revenue: 10000, coeff: 1.2 }] } }
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v1',
      vehicleMonthlyRevenueEur: 4999,
    }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.0)
    expect(row?.description).toMatch(/prossima soglia/i)
  })

  it('activates when monthly revenue reaches a tier', () => {
    const config = flatConfig()
    config.vehicle_revenue_targets = { v1: { tiers: [{ min_revenue: 10000, coeff: 1.2 }] } }
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v1',
      vehicleMonthlyRevenueEur: 10000, // equal to minimum → counts as reached
    }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.2)
    expect(row?.description).toMatch(/raggiunto/i)
    // Base 100 × 1.2 with every other coeff at 1.0 = 120
    expect(result.rawDailyRate).toBeCloseTo(120, 1)
  })

  it('picks the HIGHEST tier whose minimum has been reached', () => {
    const config = flatConfig()
    config.vehicle_revenue_targets = {
      v1: { tiers: [
        { min_revenue: 4000, coeff: 1.10 },
        { min_revenue: 4500, coeff: 1.15 },
        { min_revenue: 5000, coeff: 1.20 },
      ] },
    }
    // Revenue €4700 → reaches 4000 and 4500 tiers, but not 5000. Highest wins.
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v1',
      vehicleMonthlyRevenueEur: 4700,
    }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.15)
  })

  it('tier order in the array does not matter — highest reached always wins', () => {
    const config = flatConfig()
    config.vehicle_revenue_targets = {
      v1: { tiers: [
        { min_revenue: 5000, coeff: 1.20 }, // highest
        { min_revenue: 4000, coeff: 1.10 }, // lowest
        { min_revenue: 4500, coeff: 1.15 }, // middle
      ] },
    }
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v1',
      vehicleMonthlyRevenueEur: 9999, // reaches all tiers
    }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.20)
  })

  it('is vehicle-scoped — another vehicle is unaffected by v1 target', () => {
    const config = flatConfig()
    config.vehicle_revenue_targets = { v1: { tiers: [{ min_revenue: 1, coeff: 2.0 }] } }
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v2',
      vehicleMonthlyRevenueEur: 99999,
    }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.0)
  })

  it('ignores half-configured tiers (empty min_revenue or empty coeff)', () => {
    const config = flatConfig()
    config.vehicle_revenue_targets = {
      v1: { tiers: [
        { min_revenue: '', coeff: 1.5 },  // missing min → ignored
        { min_revenue: 5000, coeff: '' }, // missing coeff → ignored
        { min_revenue: 6000, coeff: 1.3 }, // valid
      ] },
    }
    // Revenue €7000 reaches the third tier only (the other two are invalid).
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v1',
      vehicleMonthlyRevenueEur: 7000,
    }))
    const row = result.breakdown.find(b => b.label === 'Spinta Veicolo (Obiettivo Mensile)')
    expect(row?.coeff).toBe(1.3)
  })

  it('parseConfigFromDB migrates the legacy single-object shape to tiers[]', () => {
    // Raw DB rows keep their fields under `config`, not at the top level.
    const parsed = parseConfigFromDB({
      enabled: true,
      mode: 'suggestion',
      config: {
        vehicle_revenue_targets: {
          v1: { min_revenue: 4000, coeff: 1.1 }, // legacy shape
        },
      },
    })
    expect(parsed.vehicle_revenue_targets.v1.tiers).toEqual([
      { min_revenue: 4000, coeff: 1.1 },
    ])
  })

  it('combines multiplicatively with the global promo', () => {
    const config = flatConfig()
    config.promo_push_coefficients = [{ key: 'soft', label: 'Promo soft', coeff: 0.9 }]
    config.active_promo_level = 'soft'
    config.vehicle_revenue_targets = { v1: { tiers: [{ min_revenue: 1000, coeff: 1.2 }] } }
    const result = calculateDynamicPrice(config, makeInput({
      vehicleId: 'v1',
      vehicleMonthlyRevenueEur: 2000,
    }))
    // 100 × 0.9 (promo) × 1.2 (vehicle target) = 108
    expect(result.rawDailyRate).toBeCloseTo(108, 1)
  })
})
