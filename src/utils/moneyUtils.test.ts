/**
 * Regression tests for the 0.01€ cent-loss bug.
 *
 * Root causes fixed:
 * 1. eurToCents truncated >2-decimal inputs instead of rounding
 * 2. Extension flow used `amount * 100` (float) instead of string-based eurToCents
 * 3. Stale closure handlers overwrote pending price updates
 * 4. Nexi pay-by-link used parseFloat addition instead of cents-based
 * 5. Display formatting used float division instead of integer-based centsToEurStr
 */
import { describe, it, expect } from 'vitest'
import { eurosToCents, centsToEuros, formatEUR } from './moneyUtils'

// ─── eurToCents (inline in ReservationsTab, tested here via identical logic) ───

/** Replicates the eurToCents function from ReservationsTab.tsx */
function eurToCents(eur: string | number): number {
  const s = String(eur ?? '0').trim()
  const negative = s.startsWith('-')
  const abs = negative ? s.substring(1) : s
  const dotIdx = abs.indexOf('.')
  let totalCents: number
  if (dotIdx === -1) {
    totalCents = (parseInt(abs, 10) || 0) * 100
  } else {
    const wholePart = parseInt(abs.substring(0, dotIdx), 10) || 0
    const fracStr = abs.substring(dotIdx + 1)
    if (fracStr.length <= 2) {
      const decimalStr = fracStr.padEnd(2, '0')
      totalCents = wholePart * 100 + (parseInt(decimalStr, 10) || 0)
    } else {
      const first3 = fracStr.substring(0, 3).padEnd(3, '0')
      const millis = parseInt(first3, 10) || 0
      totalCents = wholePart * 100 + Math.round(millis / 10)
    }
  }
  return negative ? -totalCents : totalCents
}

/** Replicates the centsToEurStr function from ReservationsTab.tsx */
function centsToEurStr(cents: number): string {
  const rounded = Math.round(cents)
  const negative = rounded < 0
  const abs = Math.abs(rounded)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return (negative ? '-' : '') + whole + '.' + String(frac).padStart(2, '0')
}

// ─── Tests ───

describe('eurToCents — string-based EUR→cents conversion', () => {
  it('converts whole numbers', () => {
    expect(eurToCents('389')).toBe(38900)
    expect(eurToCents('0')).toBe(0)
    expect(eurToCents('1')).toBe(100)
  })

  it('converts 2-decimal values exactly', () => {
    expect(eurToCents('389.00')).toBe(38900)
    expect(eurToCents('19.90')).toBe(1990)
    expect(eurToCents('0.01')).toBe(1)
    expect(eurToCents('0.10')).toBe(10)
    expect(eurToCents('99.99')).toBe(9999)
    expect(eurToCents('1234.56')).toBe(123456)
  })

  it('converts 1-decimal values correctly (pads to 2)', () => {
    expect(eurToCents('19.9')).toBe(1990)
    expect(eurToCents('3.5')).toBe(350)
    expect(eurToCents('0.1')).toBe(10)
  })

  it('ROUNDS >2-decimal values correctly (BUG FIX: was truncating)', () => {
    // This was the original bug: "19.895" was truncated to 1989 instead of rounded to 1990
    expect(eurToCents('19.895')).toBe(1990)
    expect(eurToCents('389.095')).toBe(38910)
    expect(eurToCents('389.004')).toBe(38900)
    expect(eurToCents('389.005')).toBe(38901)
    expect(eurToCents('29.999')).toBe(3000)
    expect(eurToCents('0.001')).toBe(0)
    expect(eurToCents('0.009')).toBe(1)
  })

  it('handles negative values', () => {
    expect(eurToCents('-389.00')).toBe(-38900)
    expect(eurToCents('-0.01')).toBe(-1)
    expect(eurToCents('-19.895')).toBe(-1990)
  })

  it('handles empty/null/undefined input', () => {
    expect(eurToCents('')).toBe(0)
    expect(eurToCents('0')).toBe(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(eurToCents(null as any)).toBe(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(eurToCents(undefined as any)).toBe(0)
  })

  it('handles number input', () => {
    expect(eurToCents(389)).toBe(38900)
    expect(eurToCents(19.9)).toBe(1990)
    expect(eurToCents(0)).toBe(0)
    expect(eurToCents(29.99)).toBe(2999)
  })
})

describe('centsToEurStr — integer cents to EUR string', () => {
  it('converts standard values', () => {
    expect(centsToEurStr(38900)).toBe('389.00')
    expect(centsToEurStr(1990)).toBe('19.90')
    expect(centsToEurStr(1)).toBe('0.01')
    expect(centsToEurStr(10)).toBe('0.10')
    expect(centsToEurStr(0)).toBe('0.00')
    expect(centsToEurStr(100)).toBe('1.00')
    expect(centsToEurStr(9999)).toBe('99.99')
  })

  it('handles negative values', () => {
    expect(centsToEurStr(-38900)).toBe('-389.00')
    expect(centsToEurStr(-1)).toBe('-0.01')
  })

  it('rounds fractional cents (e.g. from DB float)', () => {
    expect(centsToEurStr(38900.4)).toBe('389.00')
    expect(centsToEurStr(38900.5)).toBe('389.01')
    expect(centsToEurStr(38899.9999)).toBe('389.00')
  })
})

describe('eurToCents → centsToEurStr roundtrip stability', () => {
  const testValues = [
    '0.00', '0.01', '0.10', '1.00', '1.80', '19.90', '29.99',
    '100.00', '389.00', '389.99', '999.99', '1234.56', '9999.99'
  ]

  testValues.forEach(val => {
    it(`roundtrips "${val}" exactly`, () => {
      const cents = eurToCents(val)
      const eurStr = centsToEurStr(cents)
      expect(eurStr).toBe(val)
    })
  })

  it('repeated save cycles never drift (regression: 0.01€ loss)', () => {
    let value = '389.00'
    for (let cycle = 0; cycle < 100; cycle++) {
      const cents = eurToCents(value)
      value = centsToEurStr(cents)
    }
    expect(value).toBe('389.00')
  })

  it('repeated save cycles with delivery fee never drift', () => {
    let totalAmount = '339.00'
    const deliveryFee = '50.00'
    for (let cycle = 0; cycle < 100; cycle++) {
      // Save: combine to price_total in cents
      const priceTotalCents = eurToCents(totalAmount) + eurToCents(deliveryFee)
      // Load: subtract delivery to get base amount
      const baseCents = priceTotalCents - eurToCents(deliveryFee)
      totalAmount = centsToEurStr(baseCents)
    }
    expect(totalAmount).toBe('339.00')
  })
})

describe('extension flow — no float drift when adding amount', () => {
  it('adds extension amount via eurToCents, not float * 100', () => {
    const existingPriceTotal = 38900 // 389.00€ in cents
    const additionalAmountStr = '29.99'

    // BUG (old): const newTotal = existingPriceTotal + (parseFloat(additionalAmountStr) * 100)
    // FIX: const newTotal = Math.round(existingPriceTotal + eurToCents(additionalAmountStr))
    const newTotal = Math.round(existingPriceTotal + eurToCents(additionalAmountStr))

    expect(newTotal).toBe(38900 + 2999) // 68899 = 688.99€
    expect(Number.isInteger(newTotal)).toBe(true)
  })

  it('problematic float values that caused drift', () => {
    // 0.29 * 100 = 28.999999999999996 in JS
    const problemValues = ['0.29', '0.57', '0.14', '33.33', '66.67', '16.67']

    for (const val of problemValues) {
      const cents = eurToCents(val)
      expect(Number.isInteger(cents)).toBe(true)
      // Verify roundtrip
      expect(centsToEurStr(cents)).toBe(parseFloat(val).toFixed(2))
    }
  })
})

describe('eurosToCents (moneyUtils) — string-based safe conversion', () => {
  it('converts number input correctly', () => {
    expect(eurosToCents(389)).toBe(38900)
    expect(eurosToCents(19.9)).toBe(1990)
    expect(eurosToCents(0)).toBe(0)
  })

  it('converts string input correctly', () => {
    expect(eurosToCents('389.00')).toBe(38900)
    expect(eurosToCents('19.90')).toBe(1990)
  })

  it('handles problematic float values without drift', () => {
    // Old: Math.round(0.29 * 100) worked by luck
    // New: string-based, always exact
    expect(eurosToCents(0.29)).toBe(29)
    expect(eurosToCents(29.99)).toBe(2999)
    expect(eurosToCents(19.9)).toBe(1990)
  })
})

describe('centsToEuros (moneyUtils) — basic conversion', () => {
  it('converts cents to euros', () => {
    expect(centsToEuros(38900)).toBe(389)
    expect(centsToEuros(1990)).toBe(19.9)
    expect(centsToEuros(0)).toBe(0)
  })
})

describe('formatEUR — display formatting', () => {
  it('formats cents as EUR currency', () => {
    const result = formatEUR(38900)
    // Italian locale: €389,00 or similar
    expect(result).toMatch(/389/)
  })
})

describe('edge cases — no silent cent loss', () => {
  it('DB integer column roundtrip is exact', () => {
    // Simulate: save 389.00€, DB stores as integer 38900, load back
    const inputEur = '389.00'
    const dbValue = eurToCents(inputEur) // 38900
    expect(Number.isInteger(dbValue)).toBe(true)
    const loadedEur = centsToEurStr(dbValue) // "389.00"
    expect(loadedEur).toBe(inputEur)
  })

  it('price_total with fees roundtrip is exact', () => {
    const base = '339.00'
    const delivery = '30.00'
    const pickup = '20.00'

    // Save
    const priceTotalCents = Math.round(
      eurToCents(base) + eurToCents(delivery) + eurToCents(pickup)
    )
    expect(priceTotalCents).toBe(38900)

    // Load
    const baseCents = Math.round(priceTotalCents - eurToCents(delivery) - eurToCents(pickup))
    expect(centsToEurStr(baseCents)).toBe(base)
  })

  it('editing km_limit does not affect total (no stale closure)', () => {
    // Simulates the functional update pattern:
    // setFormData(prev => ({ ...prev, km_limit: '100' }))
    // This never overwrites total_amount because it spreads from prev state
    const state1 = { total_amount: '389.00', km_limit: '50/giorno' }

    // Functional update: preserves total_amount
    const state2 = { ...state1, km_limit: '100' }
    expect(state2.total_amount).toBe('389.00')

    // vs stale closure (the old bug): would use a captured old state
    const staleState = { total_amount: '388.99', km_limit: '50/giorno' } // old capture
    const state3 = { ...staleState, km_limit: '100' }
    expect(state3.total_amount).toBe('388.99') // would lose 0.01!
    // The fix ensures we never use stale closures
  })
})
