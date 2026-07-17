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
// 2026-07-17: blocchi/chiusure straordinarie. Un blocco sottrae una fascia
// oraria (o l'intera giornata) alle finestre di apertura, per un intervallo di
// date, eventualmente solo in certi giorni della settimana.
export interface LavaggioBlock {
    id: string
    from: string       // 'YYYY-MM-DD' inclusivo; vuoto = nessun limite iniziale
    to: string         // 'YYYY-MM-DD' inclusivo; vuoto = nessun limite finale
    weekdays: number[] // 0=Dom..6=Sab; vuoto = ogni giorno
    start: string      // 'HH:MM'; vuoto (con end vuoto) = intera giornata
    end: string        // 'HH:MM'
    note?: string
    active: boolean
}
export interface LavaggioHoursConfig {
    hours: WeekHours
    slot_minutes: number
    blocks?: LavaggioBlock[]
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
                blocks: Array.isArray(lh.blocks) ? lh.blocks : [],
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

function ymd(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Blocchi/chiusure straordinarie applicabili a questa data. */
function getApplicableBlocks(date: Date): LavaggioBlock[] {
    const ds = ymd(date)
    const dow = date.getDay()
    return (CONFIG.blocks || []).filter((b) =>
        !!b && b.active !== false
        && (!b.from || ds >= b.from)
        && (!b.to || ds <= b.to)
        && (!Array.isArray(b.weekdays) || b.weekdays.length === 0 || b.weekdays.includes(dow)),
    )
}

/** Sottrae la fascia [bStart,bEnd] (minuti) dalle finestre, spezzandole. */
function subtractRange(windows: TimeWindow[], bStart: number, bEnd: number): TimeWindow[] {
    const out: TimeWindow[] = []
    for (const w of windows) {
        const wS = timeToMinutes(w.start), wE = timeToMinutes(w.end)
        if (bEnd <= wS || bStart >= wE) { out.push(w); continue } // nessuna sovrapposizione
        if (bStart > wS) out.push({ start: w.start, end: minutesToTime(bStart) }) // resto sinistro
        if (bEnd < wE) out.push({ start: minutesToTime(bEnd), end: w.end })        // resto destro
    }
    return out
}

/** Returns the configured day hours for a given date (blocchi inclusi). */
export function getDayHours(date: Date): DayHours {
    if (getHolidayForDate(date)) return HOLIDAY_CLOSED
    const key = dayKeyFromDate(date)
    const base = CONFIG.hours[key] ?? DEFAULT_CONFIG.hours[key]
    const blocks = getApplicableBlocks(date)
    if (blocks.length === 0) return base
    let windows = base.is_open ? [...base.windows] : []
    for (const b of blocks) {
        if (!b.start || !b.end) { windows = []; break } // blocco intera giornata
        windows = subtractRange(windows, timeToMinutes(b.start), timeToMinutes(b.end))
    }
    return { is_open: windows.length > 0, windows }
}

/** Slot granularity (minutes) currently configured. */
export function getSlotMinutes(): number {
    return CONFIG.slot_minutes || DEFAULT_CONFIG.slot_minutes
}

/**
 * True se lo slot (data + ora HH:MM) cade dentro un BLOCCO/chiusura straordinaria.
 * Serve al gestionale per gate OTP: forzare un orario bloccato richiede override.
 * Restituisce anche la nota del blocco (per il messaggio OTP).
 */
export function getSlotBlock(date: Date, time: string): LavaggioBlock | null {
    const blocks = getApplicableBlocks(date)
    if (blocks.length === 0) return null
    const t = timeToMinutes(time)
    for (const b of blocks) {
        if (!b.start || !b.end) return b // intera giornata
        if (t >= timeToMinutes(b.start) && t < timeToMinutes(b.end)) return b
    }
    return null
}
export function isSlotBlocked(date: Date, time: string): boolean {
    return getSlotBlock(date, time) !== null
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
