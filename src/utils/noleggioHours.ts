/**
 * Noleggio (rental) hours helper — admin browser side.
 *
 * Mirror of website's `utils/noleggioHours.ts` — reads
 * `centralina_pro_config.config.noleggio_hours` once at module load,
 * caches the result, and exposes synchronous helpers for admin
 * Reservations / Preventivi flows.
 *
 * Default fallback matches the legacy hardcoded schedule:
 *   Pickup
 *     Lun-Ven: 10:30-12:30 + 16:30-18:30
 *     Sab:     10:30-16:30
 *     Dom:     CHIUSO
 *   Riconsegna
 *     Lun-Ven: 09:00-11:00 + 15:00-17:00
 *     Sab:     09:00-15:00
 *     Dom:     CHIUSO
 *
 * Operators edit the schedule in admin > Centralina Pro > Orari Noleggio.
 * Changes take effect on next page reload.
 */

import { supabase } from '../supabaseClient'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TimeWindow { start: string; end: string }
export interface DayHours { is_open: boolean; windows: TimeWindow[] }
export type WeekHours = Record<DayKey, DayHours>
export interface NoleggioHoursConfig {
    hours_pickup: WeekHours
    hours_return: WeekHours
    slot_minutes: number
}

const PICKUP_WEEKDAY: DayHours = { is_open: true, windows: [{ start: '10:30', end: '12:30' }, { start: '16:30', end: '18:30' }] }
const PICKUP_SAT: DayHours = { is_open: true, windows: [{ start: '10:30', end: '16:30' }] }
const RETURN_WEEKDAY: DayHours = { is_open: true, windows: [{ start: '09:00', end: '11:00' }, { start: '15:00', end: '17:00' }] }
const RETURN_SAT: DayHours = { is_open: true, windows: [{ start: '09:00', end: '15:00' }] }
const CLOSED: DayHours = { is_open: false, windows: [] }

const DEFAULT_CONFIG: NoleggioHoursConfig = {
    slot_minutes: 15,
    hours_pickup: {
        mon: PICKUP_WEEKDAY, tue: PICKUP_WEEKDAY, wed: PICKUP_WEEKDAY,
        thu: PICKUP_WEEKDAY, fri: PICKUP_WEEKDAY, sat: PICKUP_SAT, sun: CLOSED,
    },
    hours_return: {
        mon: RETURN_WEEKDAY, tue: RETURN_WEEKDAY, wed: RETURN_WEEKDAY,
        thu: RETURN_WEEKDAY, fri: RETURN_WEEKDAY, sat: RETURN_SAT, sun: CLOSED,
    },
}

let CONFIG: NoleggioHoursConfig = DEFAULT_CONFIG

;(async () => {
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config ?? null) as Record<string, unknown> | null
        const nh = cfg?.noleggio_hours as Partial<NoleggioHoursConfig> | undefined
        if (nh && (nh.hours_pickup || nh.hours_return)) {
            const slot = typeof nh.slot_minutes === 'number' && nh.slot_minutes > 0 ? nh.slot_minutes : DEFAULT_CONFIG.slot_minutes
            CONFIG = {
                slot_minutes: slot,
                hours_pickup: { ...DEFAULT_CONFIG.hours_pickup, ...(nh.hours_pickup || {}) } as WeekHours,
                hours_return: { ...DEFAULT_CONFIG.hours_return, ...(nh.hours_return || {}) } as WeekHours,
            }
        }
    } catch {
        // keep DEFAULT_CONFIG
    }
})()

const DAY_INDEX: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function dayKeyFromDate(date: Date): DayKey {
    return DAY_INDEX[date.getDay()]
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

export function getSlotMinutes(): number {
    return CONFIG.slot_minutes || DEFAULT_CONFIG.slot_minutes
}

export function getPickupDayHours(date: Date): DayHours {
    return CONFIG.hours_pickup[dayKeyFromDate(date)] ?? DEFAULT_CONFIG.hours_pickup[dayKeyFromDate(date)]
}

export function getReturnDayHours(date: Date): DayHours {
    return CONFIG.hours_return[dayKeyFromDate(date)] ?? DEFAULT_CONFIG.hours_return[dayKeyFromDate(date)]
}

function generateSlots(day: DayHours, step: number): string[] {
    if (!day.is_open) return []
    const out: string[] = []
    for (const w of day.windows) {
        const startMin = timeToMinutes(w.start)
        const endMin = timeToMinutes(w.end)
        for (let m = startMin; m <= endMin; m += step) {
            out.push(minutesToTime(m))
        }
    }
    return out
}

/** Office-hour minute ranges [[startMin, endMin], ...] for a given date.
 *  Returns [] when closed. Used for "is in office hours?" checks against
 *  arbitrary admin-typed times (Preventivi/Reservations OTP-override flow).
 */
export function getOfficeMinuteRangesForDate(
    dateStr: string | Date,
    kind: 'pickup' | 'return' = 'pickup',
): [number, number][] {
    let date: Date
    if (typeof dateStr === 'string') {
        if (!dateStr) return []
        date = new Date(dateStr + 'T12:00:00')
    } else {
        date = dateStr
    }
    if (isNaN(date.getTime())) return []
    const day = kind === 'return' ? getReturnDayHours(date) : getPickupDayHours(date)
    if (!day.is_open) return []
    return day.windows.map((w) => [timeToMinutes(w.start), timeToMinutes(w.end)])
}

/** True if HH:MM falls inside an office window for the date/kind. */
export function isWithinOfficeHoursForDate(
    dateStr: string | Date,
    time: string,
    kind: 'pickup' | 'return' = 'pickup',
): boolean {
    const ranges = getOfficeMinuteRangesForDate(dateStr, kind)
    if (ranges.length === 0) return false
    const m = timeToMinutes(time)
    return ranges.some(([a, b]) => m >= a && m <= b)
}

/** All bookable pickup slot times for the date. [] if closed. */
export function getPickupTimesForDate(date: Date): string[] {
    return generateSlots(getPickupDayHours(date), getSlotMinutes())
}

/** All bookable return slot times for the date. [] if closed. */
export function getReturnTimesForDate(date: Date): string[] {
    return generateSlots(getReturnDayHours(date), getSlotMinutes())
}

/** Pretty "10:30-12:30 / 16:30-18:30" for the configured day. */
export function describeOfficeHours(
    dateStr: string | Date,
    kind: 'pickup' | 'return' = 'pickup',
): string {
    const ranges = getOfficeMinuteRangesForDate(dateStr, kind)
    if (ranges.length === 0) return 'Chiuso'
    return ranges.map(([a, b]) => `${minutesToTime(a)}–${minutesToTime(b)}`).join(' / ')
}
