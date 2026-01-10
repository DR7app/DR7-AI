/**
 * Timezone Utilities for Europe/Rome
 * 
 * This module provides reliable timezone conversion utilities to ensure
 * all booking dates are displayed correctly in Europe/Rome timezone,
 * regardless of the server's timezone or the browser's locale settings.
 * 
 * CRITICAL RULES:
 * 1. Database stores all timestamps as UTC (timestamptz)
 * 2. Conversion to Europe/Rome happens ONLY at presentation layer
 * 3. Never use new Date() constructor with extracted components
 * 4. Always use these utilities for any date/time operations in the calendar
 */

const ROME_TIMEZONE = 'Europe/Rome'

/**
 * Parse a UTC timestamp string and return a Date object representing
 * the same moment, with components adjusted for Europe/Rome timezone.
 * 
 * @param utcString - UTC timestamp string (e.g., "2026-01-09T22:00:00Z" or "2026-01-09T22:00:00+00:00")
 * @returns Date object representing the same moment
 * 
 * @example
 * // UTC: Jan 9, 2026 10:00 PM → Rome: Jan 9, 2026 11:00 PM (UTC+1 in winter)
 * const date = parseUTCToRome("2026-01-09T22:00:00Z")
 * console.log(date.getDate()) // 9
 * 
 * @example
 * // UTC: Jan 9, 2026 11:00 PM → Rome: Jan 10, 2026 12:00 AM (next day!)
 * const date = parseUTCToRome("2026-01-09T23:00:00Z")
 * console.log(date.getDate()) // 10
 */
export function parseUTCToRome(utcString: string): Date {
    if (!utcString) {
        console.warn('parseUTCToRome: Empty string provided, returning current date')
        return new Date()
    }

    // Parse the UTC string into a Date object
    const utcDate = new Date(utcString)

    if (isNaN(utcDate.getTime())) {
        console.error('parseUTCToRome: Invalid date string:', utcString)
        return new Date()
    }

    // The Date object internally stores UTC time
    // We just return it - the display functions will handle Rome timezone
    return utcDate
}

/**
 * Extract date components (year, month, day, hour, minute) in Europe/Rome timezone
 * from a UTC timestamp string.
 * 
 * @param utcString - UTC timestamp string
 * @returns Object with date components in Rome timezone
 * 
 * @example
 * const components = getRomeDateComponents("2026-01-09T23:00:00Z")
 * // Returns: { year: 2026, month: 1, day: 10, hour: 0, minute: 0 }
 * // (UTC 11 PM on Jan 9 = Rome midnight on Jan 10)
 */
export function getRomeDateComponents(utcString: string): {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
} {
    const date = parseUTCToRome(utcString)

    // Use Intl.DateTimeFormat to get components in Rome timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: ROME_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })

    const parts = formatter.formatToParts(date)
    const getValue = (type: string) => {
        const part = parts.find(p => p.type === type)
        return part ? parseInt(part.value, 10) : 0
    }

    return {
        year: getValue('year'),
        month: getValue('month'),
        day: getValue('day'),
        hour: getValue('hour'),
        minute: getValue('minute'),
        second: getValue('second')
    }
}

/**
 * Format a Date object as a string in Europe/Rome timezone.
 * 
 * @param date - Date object to format
 * @param options - Intl.DateTimeFormatOptions (optional)
 * @returns Formatted date string in Rome timezone
 * 
 * @example
 * const date = new Date("2026-01-09T22:00:00Z")
 * formatRomeDate(date, { dateStyle: 'short', timeStyle: 'short' })
 * // Returns: "09/01/2026, 23:00" (in Rome timezone)
 */
export function formatRomeDate(
    date: Date,
    options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }
): string {
    return new Intl.DateTimeFormat('it-IT', {
        ...options,
        timeZone: ROME_TIMEZONE
    }).format(date)
}

/**
 * Create a Date object for a specific Europe/Rome local time.
 * This is useful when you want to create a date for "Jan 15, 2026 10:00 AM in Rome"
 * and need the corresponding UTC timestamp.
 * 
 * @param year - Year
 * @param month - Month (1-12, NOT 0-indexed)
 * @param day - Day of month
 * @param hour - Hour (0-23)
 * @param minute - Minute (0-59)
 * @returns Date object representing that Rome local time
 * 
 * @example
 * // Create "Jan 15, 2026 10:00 AM Rome time"
 * const date = createRomeDate(2026, 1, 15, 10, 0)
 * // This will be stored as "2026-01-15T09:00:00Z" (UTC) in winter
 * // or "2026-01-15T08:00:00Z" (UTC) in summer (DST)
 */
export function createRomeDate(
    year: number,
    month: number,
    day: number,
    hour: number = 0,
    minute: number = 0,
    second: number = 0
): Date {
    // Get the offset between UTC and Rome for this date
    const romeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: ROME_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })

    // Create a UTC date and find what it looks like in Rome
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    const romeParts = romeFormatter.formatToParts(utcDate)

    // Extract Rome components
    const getValue = (type: string) => {
        const part = romeParts.find(p => p.type === type)
        return part ? parseInt(part.value, 10) : 0
    }

    const romeHour = getValue('hour')
    const romeDay = getValue('day')

    // Calculate the offset
    const hourDiff = hour - romeHour
    const dayDiff = day - romeDay

    // Adjust the UTC date by the offset
    const adjustedDate = new Date(Date.UTC(
        year,
        month - 1,
        day - dayDiff,
        hour - hourDiff,
        minute,
        second
    ))

    return adjustedDate
}

/**
 * Get the day of month in Europe/Rome timezone for a UTC timestamp.
 * This is a convenience function for calendar rendering.
 * 
 * @param utcString - UTC timestamp string
 * @returns Day of month (1-31) in Rome timezone
 * 
 * @example
 * getRomeDay("2026-01-09T23:00:00Z") // Returns: 10 (next day in Rome)
 */
export function getRomeDay(utcString: string): number {
    return getRomeDateComponents(utcString).day
}

/**
 * Get the month (1-12) in Europe/Rome timezone for a UTC timestamp.
 * 
 * @param utcString - UTC timestamp string
 * @returns Month (1-12) in Rome timezone
 */
export function getRomeMonth(utcString: string): number {
    return getRomeDateComponents(utcString).month
}

/**
 * Get the year in Europe/Rome timezone for a UTC timestamp.
 * 
 * @param utcString - UTC timestamp string
 * @returns Year in Rome timezone
 */
export function getRomeYear(utcString: string): number {
    return getRomeDateComponents(utcString).year
}

/**
 * Check if a UTC timestamp falls on a specific day in Europe/Rome timezone.
 * 
 * @param utcString - UTC timestamp string
 * @param year - Year to check
 * @param month - Month to check (1-12)
 * @param day - Day to check (1-31)
 * @returns true if the timestamp falls on that day in Rome timezone
 */
export function isRomeDate(
    utcString: string,
    year: number,
    month: number,
    day: number
): boolean {
    const components = getRomeDateComponents(utcString)
    return (
        components.year === year &&
        components.month === month &&
        components.day === day
    )
}

/**
 * Debug logging for timezone conversions.
 * Logs the UTC input, Rome conversion, and components.
 * 
 * @param label - Label for the log entry
 * @param utcString - UTC timestamp string
 */
export function debugTimezone(label: string, utcString: string): void {
    const date = parseUTCToRome(utcString)
    const components = getRomeDateComponents(utcString)

    console.log(`🕐 [TIMEZONE DEBUG] ${label}`)
    console.log(`   UTC Input:    "${utcString}"`)
    console.log(`   UTC ISO:      ${date.toISOString()}`)
    console.log(`   Rome Display: ${formatRomeDate(date)}`)
    console.log(`   Rome Components: ${components.year}-${String(components.month).padStart(2, '0')}-${String(components.day).padStart(2, '0')} ${String(components.hour).padStart(2, '0')}:${String(components.minute).padStart(2, '0')}`)
    console.log(`   Rome Day:     ${components.day}`)
}

/**
 * Check if two UTC timestamps represent the same day in Europe/Rome timezone.
 * 
 * @param utcString1 - First UTC timestamp
 * @param utcString2 - Second UTC timestamp
 * @returns true if both timestamps are on the same Rome calendar day
 */
export function isSameRomeDay(utcString1: string, utcString2: string): boolean {
    const comp1 = getRomeDateComponents(utcString1)
    const comp2 = getRomeDateComponents(utcString2)

    return (
        comp1.year === comp2.year &&
        comp1.month === comp2.month &&
        comp1.day === comp2.day
    )
}
