import { useMemo, useState } from 'react'

const ROME_TZ = 'Europe/Rome'

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly'

export interface ScheduledCampaign {
    id: string
    title: string
    status: string
    scheduled_at: string | null
    recurrence_type: RecurrenceType
    recurrence_interval: number
    recurrence_end_at: string | null
    cancelled_at: string | null
    last_run_at: string | null
}

interface Occurrence {
    campaign: ScheduledCampaign
    fireAt: Date
    /** YYYY-MM-DD in Europe/Rome */
    dayKey: string
    /** "HH:MM" in Europe/Rome */
    hhmm: string
    isPast: boolean
}

function romeDayKey(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}

function romeHHMM(d: Date): string {
    return d.toLocaleTimeString('it-IT', {
        timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    })
}

function startOfMonth(year: number, month: number): Date {
    // First day of month at 00:00 local
    return new Date(year, month, 1)
}

function addMonths(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function buildMonthGrid(viewYear: number, viewMonth: number): Date[] {
    // 6×7 = 42 cells, Monday-first
    const first = startOfMonth(viewYear, viewMonth)
    const dow = (first.getDay() + 6) % 7  // 0 = Monday
    const start = new Date(first)
    start.setDate(first.getDate() - dow)
    const cells: Date[] = []
    for (let i = 0; i < 42; i++) {
        const d = new Date(start)
        d.setDate(start.getDate() + i)
        cells.push(d)
    }
    return cells
}

function expandOccurrences(
    campaign: ScheduledCampaign,
    rangeStart: Date,
    rangeEnd: Date,
): Occurrence[] {
    if (!campaign.scheduled_at) return []
    if (campaign.cancelled_at) return []

    const out: Occurrence[] = []
    const now = Date.now()
    const rangeStartMs = rangeStart.getTime()
    const rangeEndMs = rangeEnd.getTime()
    const endAt = campaign.recurrence_end_at ? new Date(campaign.recurrence_end_at).getTime() : Infinity
    const start = new Date(campaign.scheduled_at)

    if (campaign.recurrence_type === 'none') {
        const t = start.getTime()
        if (t >= rangeStartMs && t <= rangeEndMs && t <= endAt) {
            out.push({
                campaign,
                fireAt: start,
                dayKey: romeDayKey(start),
                hhmm: romeHHMM(start),
                isPast: t < now || campaign.status !== 'scheduled',
            })
        }
        return out
    }

    const step = Math.max(1, campaign.recurrence_interval || 1)
    const cursor = new Date(start)
    let safety = 500
    while (safety-- > 0) {
        const t = cursor.getTime()
        if (t > rangeEndMs) break
        if (t > endAt) break
        if (t >= rangeStartMs) {
            out.push({
                campaign,
                fireAt: new Date(cursor),
                dayKey: romeDayKey(cursor),
                hhmm: romeHHMM(cursor),
                isPast: t < now,
            })
        }
        if (campaign.recurrence_type === 'daily') cursor.setDate(cursor.getDate() + step)
        else if (campaign.recurrence_type === 'weekly') cursor.setDate(cursor.getDate() + 7 * step)
        else if (campaign.recurrence_type === 'monthly') cursor.setMonth(cursor.getMonth() + step)
        else break
    }
    return out
}

const MONTH_NAMES = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

interface Props {
    campaigns: ScheduledCampaign[]
    onCampaignClick: (campaign: ScheduledCampaign, fireAt: Date) => void
}

export default function CampaignCalendarView({ campaigns, onCampaignClick }: Props) {
    const today = new Date()
    const [viewYear, setViewYear] = useState(today.getFullYear())
    const [viewMonth, setViewMonth] = useState(today.getMonth())

    const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

    const occurrencesByDay = useMemo(() => {
        const rangeStart = cells[0]
        const rangeEnd = new Date(cells[cells.length - 1])
        rangeEnd.setHours(23, 59, 59, 999)
        const map = new Map<string, Occurrence[]>()
        for (const c of campaigns) {
            for (const occ of expandOccurrences(c, rangeStart, rangeEnd)) {
                const arr = map.get(occ.dayKey) || []
                arr.push(occ)
                map.set(occ.dayKey, arr)
            }
        }
        for (const [k, arr] of map) {
            arr.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
            map.set(k, arr)
        }
        return map
    }, [cells, campaigns])

    const todayKey = romeDayKey(today)

    function gotoPrev() {
        const d = addMonths(new Date(viewYear, viewMonth, 1), -1)
        setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
    }
    function gotoNext() {
        const d = addMonths(new Date(viewYear, viewMonth, 1), 1)
        setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
    }
    function gotoToday() {
        setViewYear(today.getFullYear()); setViewMonth(today.getMonth())
    }

    return (
        <div className="bg-theme-bg-tertiary p-4 rounded-lg border border-theme-border">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-theme-text-primary">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                </h3>
                <div className="flex gap-2">
                    <button
                        onClick={gotoPrev}
                        className="px-3 py-1 text-sm rounded border border-theme-border hover:bg-theme-bg-hover text-theme-text-primary"
                    >
                        ←
                    </button>
                    <button
                        onClick={gotoToday}
                        className="px-3 py-1 text-sm rounded border border-theme-border hover:bg-theme-bg-hover text-theme-text-primary"
                    >
                        Oggi
                    </button>
                    <button
                        onClick={gotoNext}
                        className="px-3 py-1 text-sm rounded border border-theme-border hover:bg-theme-bg-hover text-theme-text-primary"
                    >
                        →
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-px text-xs text-theme-text-muted mb-1">
                {WEEKDAY_LABELS.map(l => (
                    <div key={l} className="text-center py-1 font-medium uppercase tracking-wide">{l}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-px bg-theme-border rounded overflow-hidden">
                {cells.map((d, i) => {
                    const inMonth = d.getMonth() === viewMonth
                    const dayKey = romeDayKey(d)
                    const isToday = dayKey === todayKey
                    const occs = occurrencesByDay.get(dayKey) || []
                    return (
                        <div
                            key={i}
                            className={[
                                'min-h-[88px] p-1.5 bg-theme-bg-tertiary',
                                inMonth ? '' : 'opacity-40',
                                isToday ? 'ring-1 ring-dr7-gold' : '',
                            ].join(' ')}
                        >
                            <div className="text-xs text-theme-text-secondary mb-1">
                                {d.getDate()}
                            </div>
                            <div className="space-y-0.5">
                                {occs.slice(0, 3).map((occ, oi) => (
                                    <button
                                        key={`${occ.campaign.id}-${oi}`}
                                        onClick={() => onCampaignClick(occ.campaign, occ.fireAt)}
                                        className={[
                                            'w-full text-left text-[11px] truncate px-1.5 py-0.5 rounded',
                                            occ.isPast
                                                ? 'bg-theme-bg-hover text-theme-text-muted line-through'
                                                : occ.campaign.recurrence_type !== 'none'
                                                    ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                                                    : 'bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30',
                                        ].join(' ')}
                                        title={`${occ.hhmm} — ${occ.campaign.title}`}
                                    >
                                        <span className="font-mono mr-1">{occ.hhmm}</span>
                                        {occ.campaign.title}
                                    </button>
                                ))}
                                {occs.length > 3 && (
                                    <div className="text-[10px] text-theme-text-muted px-1.5">
                                        +{occs.length - 3} altri
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="mt-3 flex flex-wrap gap-3 text-xs text-theme-text-muted">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded bg-dr7-gold/30 border border-dr7-gold/40"></span>
                    Singolo invio
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded bg-blue-500/30 border border-blue-500/40"></span>
                    Ricorrente
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded bg-theme-bg-hover border border-theme-border"></span>
                    Già fatto
                </span>
            </div>
        </div>
    )
}
