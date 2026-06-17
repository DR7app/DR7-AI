/**
 * Lavaggio hours helper (admin browser side).
 *
 * Reads `centralina_pro_config.config.lavaggio_hours` once at module
 * load, caches the result, and exposes synchronous helpers for the
 * admin Car Wash booking flow.
 *
 * Default fallback matches the legacy hardcoded schedule:
 *   - Lun-Ven: 09:00-13:00 + 15:00-19:00
 *   - Sab:     09:00-17:00
 *   - Dom:     CHIUSO
 *
 * Operators edit the schedule in admin > Centralina Pro > Orari Lavaggio.
 * Changes take effect on next page reload.
 */

import { supabase } from '../supabaseClient'
import { getHolidayForDate } from '../data/italianHolidays'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TimeWindow { start: string; end: string }
export interface DayHours { is_open: boolean; windows: TimeWindow[] }
export type WeekHours = Record<DayKey, DayHours>
export interface LavaggioHoursConfig {
    hours: WeekHours
    slot_minutes: number
}

const DEFAULT_DAY: DayHours = { is_open: true, windows: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '19:00' }] }
const DEFAULT_SAT: DayHours = { is_open: true, windows: [{ start: '09:00', end: '17:00' }] }
const DEFAULT_SUN: DayHours = { is_open: false, windows: [] }

const DEFAULT_CONFIG: LavaggioHoursConfig = {
    slot_minutes: 5,
    hours: {
        mon: DEFAULT_DAY, tue: DEFAULT_DAY, wed: DEFAULT_DAY,
        thu: DEFAULT_DAY, fri: DEFAULT_DAY, sat: DEFAULT_SAT, sun: DEFAULT_SUN,
    },
}

let CONFIG: LavaggioHoursConfig = DEFAULT_CONFIG

;(async () => {
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config ?? null) as Record<string, unknown> | null
        const lh = cfg?.lavaggio_hours as Partial<LavaggioHoursConfig> | undefined
        if (lh && lh.hours && typeof lh.hours === 'object') {
            const slot = typeof lh.slot_minutes === 'number' && lh.slot_minutes > 0 ? lh.slot_minutes : DEFAULT_CONFIG.slot_minutes
            CONFIG = {
                slot_minutes: slot,
                hours: { ...DEFAULT_CONFIG.hours, ...lh.hours } as WeekHours,
            }
        }
    } catch {
        // keep DEFAULT_CONFIG
    }
})()

/** Map a JS Date.getDay() (0=Sun) to our DayKey. */
function dayKeyFromDate(date: Date): DayKey {
    const d = date.getDay()
    return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as DayKey[])[d]
}

function timeToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
}
function minutesToTime(min: number): string {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// 2026-05-30: festività nazionali italiane sono CHIUSE come la domenica.
// Admin puo' comunque forzare via OTP override; customer wizard non
// mostra slot in giornata festiva.
const HOLIDAY_CLOSED: DayHours = { is_open: false, windows: [] }

/** Returns the configured day hours for a given date. */
export function getDayHours(date: Date): DayHours {
    if (getHolidayForDate(date)) return HOLIDAY_CLOSED
    const key = dayKeyFromDate(date)
    return CONFIG.hours[key] ?? DEFAULT_CONFIG.hours[key]
}

/** Slot granularity (minutes) currently configured. */
export function getSlotMinutes(): number {
    return CONFIG.slot_minutes || DEFAULT_CONFIG.slot_minutes
}

/**
 * Returns time-ranges where a booking can START so it FINISHES within
 * a configured window (given its duration in minutes).
 * If the day is closed or has no windows, returns [].
 */
export function getAllowedTimeRangesForDate(
    date: Date,
    durationMinutes: number,
): { start: string; end: string }[] {
    const day = getDayHours(date)
    if (!day.is_open) return []
    return day.windows
        .map((w) => {
            const startMin = timeToMinutes(w.start)
            const lastStartMin = timeToMinutes(w.end) - durationMinutes
            if (lastStartMin < startMin) return null
            return { start: w.start, end: minutesToTime(lastStartMin) }
        })
        .filter((r): r is { start: string; end: string } => r !== null)
}

/**
 * Generate the full list of bookable slot times for a given date,
 * using the configured granularity. The last slot in each window is
 * `windowEnd - slotMinutes` (i.e. a booking starting at the very last
 * slot still has at least one full slot to complete).
 */
export function generateLavaggioSlotsForDate(date: Date): string[] {
    const day = getDayHours(date)
    if (!day.is_open) return []
    const step = getSlotMinutes()
    const out: string[] = []
    for (const w of day.windows) {
        const startMin = timeToMinutes(w.start)
        const endMin = timeToMinutes(w.end)
        for (let m = startMin; m < endMin; m += step) {
            out.push(minutesToTime(m))
        }
    }
    return out
}

/** True if `time` (HH:MM) falls inside an open window for the date. */
export function isInLavaggioHours(date: Date, time: string): boolean {
    const day = getDayHours(date)
    if (!day.is_open) return false
    const t = timeToMinutes(time)
    return day.windows.some((w) => t >= timeToMinutes(w.start) && t < timeToMinutes(w.end))
}

/**
 * All slot times across the WHOLE day (00:00 → 24:00) at the configured
 * granularity. The admin picker shows every hour and puts a 🔴 on the ones
 * outside the lavaggio opening hours — same format as the Noleggio picker.
 */
export function generateAllDayLavaggioSlots(): string[] {
    const step = getSlotMinutes()
    const out: string[] = []
    for (let m = 0; m < 24 * 60; m += step) out.push(minutesToTime(m))
    return out
}
