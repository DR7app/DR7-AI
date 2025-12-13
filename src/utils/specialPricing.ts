/**
 * Special Pricing Rules for Specific Clients
 */

export interface SpecialPricingRule {
    customerName: string
    dailyRate: number
    discountThreshold: number // days
    discountPercent: number
    includesUnlimitedKm: boolean
    includesKasko: 'base' | 'gold' | 'platinum' | null // Assuming insurance options map to these IDs
}

// Check ReservationsTab.tsx or common types for precise insurance option IDs.
// Based on previous context, IDs seem to be like 'kasko_base', 'kasko_gold' etc.
// Let's verify standard IDs first, but for now we'll use string literal types.

export const SPECIAL_PRICING_RULES: SpecialPricingRule[] = [
    {
        customerName: 'massimo runchina',
        dailyRate: 305, // €305 fixed per day
        discountThreshold: 3, // From 3rd day (meaning 3 days or more)
        discountPercent: 10, // 10% discount
        includesUnlimitedKm: true,
        includesKasko: 'base' // Maps to KASKO_BASE usually
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
