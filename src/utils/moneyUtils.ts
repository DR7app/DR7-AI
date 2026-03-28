/**
 * Monetary Unit Contract: CENTS
 * All price fields in the database are stored as INTEGER CENTS
 * Example: 60000 cents = €600.00
 * 
 * This utility provides consistent EUR formatting across the application
 */

/**
 * Format an amount in cents as EUR with Italian locale formatting
 * @param amountInCents - Amount in cents (integer)
 * @returns Formatted string like "€1.234,56"
 */
export function formatEUR(amountInCents: number): string {
    // Convert cents to euros
    const amountInEuros = amountInCents / 100

    // Format with Italian locale (thousands separator: dot, decimal separator: comma)
    return new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amountInEuros)
}

/**
 * Convert cents to euros (for calculations, not display)
 * @param amountInCents - Amount in cents (integer)
 * @returns Amount in euros (decimal)
 */
export function centsToEuros(amountInCents: number): number {
    return amountInCents / 100
}

/**
 * Convert euros to cents (for storage).
 * Uses string-based parsing when possible to avoid floating-point drift.
 * @param amountInEuros - Amount in euros (decimal number or string)
 * @returns Amount in cents (integer)
 */
export function eurosToCents(amountInEuros: number | string): number {
    const s = String(amountInEuros).trim()
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
            // >2 decimals: round using first 3 digits
            const first3 = fracStr.substring(0, 3).padEnd(3, '0')
            const millis = parseInt(first3, 10) || 0
            totalCents = wholePart * 100 + Math.round(millis / 10)
        }
    }
    return negative ? -totalCents : totalCents
}
