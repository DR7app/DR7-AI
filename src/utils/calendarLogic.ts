import {
    getRomeDateComponents,
    parseUTCToRome,
    formatRomeDate
} from './timezoneUtils'

// Types
export interface CalendarEvent {
    id: string
    booking: any
    // Rome Local Time components
    startLocal: Date
    endLocal: Date
    // Grid Coordinates (0-based)
    startDayIndex0: number
    endDayIndex0: number // The last day index OCCUPIED by the booking
    endDayIndexExclusive: number // For width calculation (endDayIndex0 + 1)
    // Layout
    laneIndex: number
    leftPx: number
    widthPx: number
}

interface LayoutConfig {
    cellWidth: number // e.g. 40px
    daysInMonth: number // derived from current month context
}

/**
 * 0-based Day Index Helper
 * Returns the 0-based index of the day in the month (e.g. 1st => 0)
 * Uses local getDate() because the input Date is already adjusted to Rome time
 * (or is a native Date behaving as a container for Rome components)
 */
export function toDayIndex0(romeDate: Date): number {
    return romeDate.getDate() - 1
}

/**
 * Normalizes a booking into a deterministic CalendarEvent
 * Handles the "Midnight Rule" and strict inclusive/exclusive logic
 */
export function normalizeBooking(
    booking: any,
    currentYear: number,
    currentMonth0: number, // 0-indexed month
    config: LayoutConfig
): CalendarEvent | null {
    // 1. Convert to Rome Time
    const startRome = parseUTCToRome(booking.pickup_date)
    const endRome = parseUTCToRome(booking.dropoff_date)

    // 2. Extract Components for Logic
    const startComps = getRomeDateComponents(booking.pickup_date)
    const endComps = getRomeDateComponents(booking.dropoff_date)

    // 3. Filter out bookings not relevant to this month projection
    // (Simplified check: overlap logic)
    // We need to map them to the current month's grid (0..daysInMonth-1)

    // Calculate raw indices (potentially < 0 or > daysInMonth for spanning bookings)
    // We need to handle year/month differences

    // Helper to get global day offset from start of current month
    const getGlobalDayDiff = (targetDate: Date, baseYear: number, baseMonth0: number) => {
        // Create a base date for the 1st of the current month at 00:00 Rome time?
        // Safer: Compare timestamps of the "Rome Date Objects"
        // Since parseUTCToRome returns a Date object that "looks like" Rome time but is technically UTC-shifted or local-shifted,
        // we can use standard ms difference if we are careful, OR just compare Y/M/D.

        // Let's use the standard "Rome Date" comparison logic:
        // Create date objects set to Noon to avoid DST shifts affecting day diff? 
        // Or just use the Y/M/D difference.

        const target = new Date(targetDate)
        target.setHours(0, 0, 0, 0)

        const base = new Date(baseYear, baseMonth0, 1, 0, 0, 0, 0)

        // Day difference
        const diffTime = target.getTime() - base.getTime()
        return Math.round(diffTime / (1000 * 60 * 60 * 24))
    }

    // NOTE: This simple diff assumes the "Rome Date" objects are constructed similarly.
    // parseUTCToRome returns a Date object where .getDate() returns the Rome day.
    // So `new Date(year, month, 1)` uses local browser time. 
    // We must ensure we compare apples to apples.
    // The 'startRome' object is a UTC timestamp that *if printed in Rome* shows the right time? 
    // NO. `parseUTCToRome` (from readingutils) returns a `new Date(utcString)`.
    // Wait, `timezoneUtils.ts` says: 
    // "The Date object internally stores UTC time. We just return it - the display functions will handle Rome timezone"
    // ACTUALLY: `parseUTCToRome` just returns `new Date(utcString)`. 
    // So `startRome` is a standard JS Date object representing the moment in time.
    // To get the Rome Day Index, we MUST use `getRomeDateComponents`.

    // Let's rely on `getRomeDateComponents` for strict correctness.

    // Logic: 
    // If booking starts in previous month/year => startDayIndex0 becomes negative (clamped later or used for positioning off-screen).
    // If booking ends in next month/year => endDayIndex0 > daysInMonth.

    // Let's simplify: We only care about rendering. 
    // If it doesn't overlap the current month, return null.

    // Current Month Start/End (Rome Time)
    // We can't easy compare timestamps if we don't know the exact offsets for every day.
    // BUT we strictly strictly only care about "Day Index in the View".

    let startIndex0: number
    let endIndex0: number

    // Start Index
    if (startComps.year < currentYear || (startComps.year === currentYear && startComps.month < (currentMonth0 + 1))) {
        // Starts before this month
        startIndex0 = -999 // clipped
    } else if (startComps.year > currentYear || (startComps.year === currentYear && startComps.month > (currentMonth0 + 1))) {
        // Starts after this month
        return null // Should have been filtered by DB, but safe to ignore
    } else {
        // Starts in this month
        startIndex0 = startComps.day - 1
    }

    // End Index
    // Strict Midnight Rule: If ends at 00:00, it does not occupy that day.
    // e.g. Jan 10 00:00 -> Occupies up to Jan 9 23:59. Last occupied day is Jan 9.

    const endsAtMidnight = endComps.hour === 0 && endComps.minute === 0

    // Calculate "Effective End Day" for occupancy
    // If ends at midnight, effective end day is "Previous Day".
    // BUT we need the index relative to THIS MONTH.

    // Let's look at the Dropoff Date components
    if (endComps.year < currentYear || (endComps.year === currentYear && endComps.month < (currentMonth0 + 1))) {
        return null // Ends before this month starts
    }

    if (endComps.year > currentYear || (endComps.year === currentYear && endComps.month > (currentMonth0 + 1))) {
        // Ends in future month
        endIndex0 = config.daysInMonth + 1 // clipped
    } else {
        // Ends in this month
        let effectiveEndDay = endComps.day
        if (endsAtMidnight) {
            effectiveEndDay -= 1 // Back one day
            // Note: If ends Jan 1 00:00 -> effectiveEndDay = 0. Index = -1.
        }
        endIndex0 = effectiveEndDay - 1
    }

    // Clamp for display (optional, but good for width calc)
    const displayStart = Math.max(0, startIndex0)
    const displayEnd = Math.min(config.daysInMonth - 1, endIndex0)

    // If after clamping, start > end, it's not visible in this 0..N grid
    if (displayStart > displayEnd) return null

    // Width Calculation
    // We use the UNCLAMPED original start to determine strict placement or partial?
    // User wants "Deterministic Projection".
    // If starts Day 5, Ends Day 7 (exclusive logic -> occupies 5, 6, 7-partially? No, user said valid interval)
    // Re-read User: 
    // "Use end-exclusive only for full-day occupancy... If > 00:00, the booking touches the end day."
    // My logic above: if > 00:00, `endsAtMidnight` is false. `endIndex0` = `endComps.day - 1`.
    // Example: Jan 12 10:00. `endIndex0` = 11.
    // This means it OCCUPIES column 11. 
    // Width spanning: from start 9 (index 8) to 12 (index 11).
    // Total columns: 8, 9, 10, 11 (4 days).
    // Width should be `(endIndex0 - startIndex0 + 1) * cellWidth`.

    // Wait, user formula: `width = (endDayIndexExclusive0 - startDayIndex0) * cellWidth`
    // `endDayIndexExclusive0` = `endDayIndex0 + 1`.
    // So width = (11 + 1 - 8) * 40 = 4 * 40 = 160. Correct.

    // What if starts before month?
    // `startIndex0` = -999. 
    // `leftPx` = -999 * 40 ... NO. We must clip visuals to the grid container usually `overflow-hidden`.
    // But for the `leftPx` user said `startDayIndex0 * cellWidth`.
    // If we assume a container that scrolls or masks, we can use negative.
    // BUT simpler to CLAMP the bar to the visible area?
    // User said "No hacks". 
    // If I position absolute left=-500px, it works inside a relative container.

    const endDayIndexExclusive0 = endIndex0 + 1

    return {
        id: booking.id,
        booking,
        startLocal: startRome, // Note: this is the raw Date object which renders as Rome Time via Intl
        endLocal: endRome,
        startDayIndex0: startIndex0,
        endDayIndex0: endIndex0,
        endDayIndexExclusive: endDayIndexExclusive0,
        laneIndex: 0, // Assigned later
        leftPx: startIndex0 * config.cellWidth,
        widthPx: (endDayIndexExclusive0 - startIndex0) * config.cellWidth
    }
}

/**
 * Assigns visual lanes to prevent overlap
 * (Interval Graph Coloring / "Tetris" packing)
 */
export function computeLanes(events: CalendarEvent[]): CalendarEvent[] {
    // 1. Sort by Start Date (then End Date desc for longest first?)
    // Deterministic sort: Start Index asc, then Length desc
    const sorted = [...events].sort((a, b) => {
        if (a.startDayIndex0 !== b.startDayIndex0) return a.startDayIndex0 - b.startDayIndex0
        return (b.endDayIndexExclusive - b.startDayIndexExclusive) - (a.endDayIndexExclusive - a.startDayIndexExclusive)
    })

    const lanes: number[] = [] // stores the endDayIndexExclusive of the last event in each lane

    sorted.forEach(ev => {
        let placed = false

        // Try to find a lane where this event fits
        // Fits if lane's last event end <= ev.start
        // Strictness: visual separation? 
        // If exact touch (end 10, start 10) -> usually allowed on same line if times don't overlap?
        // BUT we are doing DAY-based blocking. 
        // If undefined ends on Day 10 (partial), and next starts Day 10 (partial).
        // They both "occupy" Day 10 column.
        // They MUST stack.
        // So condition: `laneEnd <= ev.startDayIndex0`

        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] <= ev.startDayIndex0) {
                ev.laneIndex = i
                lanes[i] = ev.endDayIndexExclusive
                placed = true
                break
            }
        }

        if (!placed) {
            // New lane
            ev.laneIndex = lanes.length
            lanes.push(ev.endDayIndexExclusive)
        }
    })

    // Restore original order? No, usually return sorted or mapped map
    // Return the modified events (objects are mutable or we clone)
    return sorted
}
