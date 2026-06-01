import React, { useMemo } from 'react'
import EuropeanDateInput from './EuropeanDateInput'

/**
 * DateRangeFilter — shared component used across every admin tab.
 *
 * Two inputs (Da / A) in DD/MM/YYYY format + quick presets + reset.
 * Each tab owns the state and the date field used in the Supabase query.
 *
 * Usage:
 *   const [range, setRange] = useState({ from: '', to: '' })
 *   <DateRangeFilter value={range} onChange={setRange} />
 *   // then in the query:
 *   if (range.from) query = query.gte('pickup_date', range.from)
 *   if (range.to)   query = query.lte('pickup_date', range.to + 'T23:59:59')
 *
 * Format: from/to are ISO (YYYY-MM-DD) for DB queries. Display is DD/MM/YYYY.
 */

export interface DateRange {
  from: string // YYYY-MM-DD (empty string = no lower bound)
  to: string   // YYYY-MM-DD (empty string = no upper bound)
}

interface DateRangeFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
  /** Custom labels (default: "Da" / "A") */
  fromLabel?: string
  toLabel?: string
  /** Show preset buttons (Oggi / Ieri / Settimana / Mese / Trimestre / Anno) */
  showPresets?: boolean
  /** Compact mode: hide labels, stack tighter */
  compact?: boolean
  className?: string
}

function toISO(d: Date): string {
  // Local YYYY-MM-DD (avoid UTC offset shifting the day)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  value,
  onChange,
  fromLabel = 'Da',
  toLabel = 'A',
  showPresets = true,
  compact = false,
  className = '',
}) => {
  const presets = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)) // Monday
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)
    const yearStart = new Date(today.getFullYear(), 0, 1)
    return [
      { label: 'Oggi',       from: toISO(today),         to: toISO(today)   },
      { label: 'Ieri',       from: toISO(yesterday),     to: toISO(yesterday) },
      { label: 'Settimana',  from: toISO(weekStart),     to: toISO(today)   },
      { label: 'Mese',       from: toISO(monthStart),    to: toISO(today)   },
      { label: 'Trimestre',  from: toISO(quarterStart),  to: toISO(today)   },
      { label: 'Anno',       from: toISO(yearStart),     to: toISO(today)   },
    ]
  }, [])

  const inputCls = 'px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-dr7-gold w-32'
  const presetCls = 'px-2.5 py-1 rounded-full border bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:border-dr7-gold/40 text-xs transition-colors'
  const activePresetCls = 'px-2.5 py-1 rounded-full border bg-dr7-gold/20 border-dr7-gold text-dr7-gold text-xs'

  const isActivePreset = (p: { from: string; to: string }) =>
    value.from === p.from && value.to === p.to

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {!compact && (
        <span className="text-xs text-theme-text-muted">Periodo:</span>
      )}
      <div className="flex items-center gap-1">
        {!compact && <span className="text-xs text-theme-text-secondary">{fromLabel}</span>}
        <EuropeanDateInput
          value={value.from}
          onChange={(v) => onChange({ ...value, from: v })}
          className={inputCls}
        />
      </div>
      <div className="flex items-center gap-1">
        {!compact && <span className="text-xs text-theme-text-secondary">{toLabel}</span>}
        <EuropeanDateInput
          value={value.to}
          onChange={(v) => onChange({ ...value, to: v })}
          className={inputCls}
        />
      </div>
      {showPresets && presets.map(p => (
        <button
          key={p.label}
          type="button"
          onClick={() => onChange({ from: p.from, to: p.to })}
          className={isActivePreset(p) ? activePresetCls : presetCls}
        >
          {p.label}
        </button>
      ))}
      {(value.from || value.to) && (
        <button
          type="button"
          onClick={() => onChange({ from: '', to: '' })}
          className="px-2.5 py-1 rounded-full border bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:text-red-400 hover:border-red-400/40 text-xs transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  )
}

export default DateRangeFilter
