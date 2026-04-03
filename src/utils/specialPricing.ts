/**
 * Special Pricing Rules for Specific Clients
 * Matches website clientPricingRules.ts — keep in sync
 */

export interface SpecialPricingRule {
    customerName: string
    email: string
    dailyRate: number
    discountTiers: { minDays: number; discount: number }[]
    includesUnlimitedKm: boolean
    includesKasko: 'base' | 'gold' | 'platinum' | null
    excludeCarWash: boolean
    noDeposit: boolean
    noCents: boolean
}

const SPECIAL_PRICING_RULES: SpecialPricingRule[] = [
    {
        customerName: 'massimo runchina',
        email: 'massimorunchina69@gmail.com',
        dailyRate: 339,
        discountTiers: [
            { minDays: 7, discount: 0.20 },   // 7+ days: -20%
            { minDays: 4, discount: 0.15 },    // 4-6 days: -15%
            { minDays: 3, discount: 0.10 },    // 3 days: -10%
        ],
        includesUnlimitedKm: true,
        includesKasko: 'base',
        excludeCarWash: true,
        noDeposit: true,
        noCents: true,
    },
    {
        customerName: 'jeanne giraud',
        email: 'jeannegiraud92@gmail.com',
        dailyRate: 305,
        discountTiers: [
            { minDays: 7, discount: 0.20 },
            { minDays: 4, discount: 0.15 },
            { minDays: 3, discount: 0.10 },
        ],
        includesUnlimitedKm: true,
        includesKasko: 'base',
        excludeCarWash: true,
        noDeposit: false,
        noCents: true,
    }
]

export const getSpecialPricing = (customerName: string | null | undefined): SpecialPricingRule | null => {
    if (!customerName) return null
    const normalized = customerName.toLowerCase().trim()
    return SPECIAL_PRICING_RULES.find(rule => rule.customerName === normalized) || null
}

export const calculateSpecialPrice = (rule: SpecialPricingRule, days: number): number => {
    if (days <= 0) return 0

    let total = rule.dailyRate * days

    // Apply tiered discount — first matching tier wins (sorted highest minDays first)
    for (const tier of rule.discountTiers) {
        if (days >= tier.minDays) {
            total = total * (1 - tier.discount)
            break
        }
    }

    // Round to whole euros if noCents
    if (rule.noCents) {
        total = Math.round(total)
    }

    return total
}
