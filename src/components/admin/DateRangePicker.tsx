import { useEffect, useRef, useState } from 'react'

export type DateRangePreset = '7' | '30' | '90' | '365' | 'all' | 'custom'

export type DateRangeValue = {
  preset: DateRangePreset
  from?: string  // YYYY-MM-DD, inclusive
  to?: string    // YYYY-MM-DD, inclusive
}

type Props = {
  value: DateRangeValue
  onChange: (v: DateRangeValue) => void
  className?: string
}

const PRESETS: Array<{ k: DateRangePreset; l: string }> = [
  { k: '7', l: '7g' },
  { k: '30', l: '30g' },
  { k: '90', l: '90g' },
  { k: '365', l: '12m' },
  { k: 'all', l: 'Tutto' },
  { k: 'custom', l: 'Personalizzato' },
]

export default function DateRangePicker({ value, onChange, className }: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!popoverOpen) return
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [popoverOpen])

  function pickPreset(k: DateRangePreset) {
    if (k === 'custom') {
      setPopoverOpen(true)
      onChange({ preset: 'custom', from: value.from, to: value.to })
      return
    }
    setPopoverOpen(false)
    onChange({ preset: k })
  }

  const customLabel = (() => {
    if (value.preset !== 'custom') return 'Personalizzato'
    if (value.from && value.to) {
      const fmt = (s: string) => {
        const [y, m, d] = s.split('-')
        return `${d}/${m}/${y.slice(2)}`
      }
      return `${fmt(value.from)} – ${fmt(value.to)}`
    }
    if (value.from) return `Da ${value.from}`
    if (value.to) return `A ${value.to}`
    return 'Personalizzato'
  })()

  return (
    <div className={`relative inline-flex rounded-full bg-theme-bg-tertiary/40 p-1 border border-theme-border ${className || ''}`}>
      {PRESETS.map(p => {
        const active = value.preset === p.k
        const label = p.k === 'custom' ? customLabel : p.l
        return (
          <button
            key={p.k}
            type="button"
            onClick={() => pickPreset(p.k)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
              active
                ? 'bg-theme-bg-primary text-theme-text-primary shadow-sm border border-theme-border'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >{label}</button>
        )
      })}

      {popoverOpen && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 z-20 w-72 p-3 rounded-xl border border-theme-border bg-theme-bg-primary shadow-lg"
        >
          <div className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-2">Intervallo personalizzato</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-theme-text-secondary">Da</span>
              <input
                type="date"
                value={value.from || ''}
                max={value.to || undefined}
                onChange={(e) => onChange({ preset: 'custom', from: e.target.value || undefined, to: value.to })}
                className="px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded-md text-theme-text-primary focus:outline-none focus:border-dr7-gold"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-theme-text-secondary">A</span>
              <input
                type="date"
                value={value.to || ''}
                min={value.from || undefined}
                onChange={(e) => onChange({ preset: 'custom', from: value.from, to: e.target.value || undefined })}
                className="px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded-md text-theme-text-primary focus:outline-none focus:border-dr7-gold"
              />
            </label>
          </div>
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => onChange({ preset: 'custom', from: undefined, to: undefined })}
              className="text-xs text-theme-text-muted hover:text-theme-text-primary"
            >Pulisci</button>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-dr7-gold text-white hover:opacity-90"
            >Applica</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Helper: derive `from`/`to` cutoff Dates from a value. Returns inclusive
 * range — entries with `date >= from` AND `date <= toExclusiveEnd` are kept.
 * For day presets, `from = now - preset days`, `to = now`.
 * For 'all' preset, returns nulls (no filtering).
 * For 'custom' with from/to, parses inputs as local-time dates and
 * sets `to` to end-of-day to be inclusive.
 */
export function resolveDateRange(value: DateRangeValue): { from: Date | null; to: Date | null } {
  if (value.preset === 'all') return { from: null, to: null }
  if (value.preset === 'custom') {
    const from = value.from ? new Date(value.from + 'T00:00:00') : null
    const to = value.to ? new Date(value.to + 'T23:59:59.999') : null
    return { from, to }
  }
  const days = parseInt(value.preset, 10)
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from, to: null }
}

/**
 * Filter check helper: returns true if `dateStr` is within `range`.
 * `null` / unparseable dates are kept (no date = passes filter).
 */
export function isInRange(dateStr: string | null | undefined, range: { from: Date | null; to: Date | null }): boolean {
  if (!dateStr) return true
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return true
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}
