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
 * Convert euros to cents (for storage)
 * @param amountInEuros - Amount in euros (decimal)
 * @returns Amount in cents (integer)
 */
export function eurosToCents(amountInEuros: number): number {
    return Math.round(amountInEuros * 100)
}
