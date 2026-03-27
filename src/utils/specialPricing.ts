/**
 * Special Pricing Rules for Specific Clients
 *
 * TODO: Migrate these rules to a Supabase table for runtime configuration.
 * For now, stored as code constants.
 */

export interface SpecialPricingRule {
    customerName: string
    dailyRate: number
    discountThreshold: number // days
    discountPercent: number
    includesUnlimitedKm: boolean
    includesKasko: 'base' | 'gold' | 'platinum' | null
}

// Special pricing rules — should be moved to database in future
const SPECIAL_PRICING_RULES: SpecialPricingRule[] = [
    {
        customerName: 'massimo runchina',
        dailyRate: 305,
        discountThreshold: 3,
        discountPercent: 10,
        includesUnlimitedKm: true,
        includesKasko: 'base'
    }
]

export const getSpecialPricing = (customerName: string | null | undefined): SpecialPricingRule | null => {
    if (!customerName) return null
    const normalized = customerName.toLowerCase().trim()
    return SPECIAL_PRICING_RULES.find(rule => rule.customerName === normalized) || null
}

export const calculateSpecialPrice = (rule: SpecialPricingRule, days: number): number => {
    if (days <= 0) return 0

    let total = rule.dailyRate * days // Base calculation: Rate * Days

    // Apply discount if meeting threshold (e.g. 3 consecutive days)
    if (days >= rule.discountThreshold) {
        total = total * (1 - rule.discountPercent / 100)
    }

    return total
}
