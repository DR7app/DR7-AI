import React, { useState } from 'react'
import EuropeanDateInput from './EuropeanDateInput'
import CalendarRangePicker from './admin/CalendarRangePicker'
import SceltaMese from './admin/SceltaMese'

/**
 * DateRangeFilter — filtro periodo comune a tutte le tab con elenchi
 * (Prenotazioni, Calendario, Contratti, Clienti, Cauzioni, Preventivi,
 * Lavaggio, Meccanica, Da Saldare, Nexi, Danni & Penali).
 *
 * 23/09/2026 (direzione): stessa barra dei Report — Tutto, Oggi, Mese, 7gg,
 * 30gg, Anno, Custom, menu dei mesi, due date GG/MM/AAAA e calendario. Sulle liste parte da
 * "Tutto" (nessun filtro), come prima. L'interfaccia non cambia: ogni tab
 * tiene il suo stato { from, to } e il suo campo data nella query.
 *
 * Usage:
 *   const [range, setRange] = useState({ from: '', to: '' })
 *   <DateRangeFilter value={range} onChange={setRange} />
 *   if (range.from) query = query.gte('pickup_date', range.from)
 *   if (range.to)   query = query.lte('pickup_date', range.to + 'T23:59:59')
 */

export interface DateRange {
  from: string // YYYY-MM-DD (empty string = no lower bound)
  to: string   // YYYY-MM-DD (empty string = no upper bound)
}

interface DateRangeFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
  /** Etichetta sopra la barra (default "Periodo"). */
  fromLabel?: string
  toLabel?: string
  /** Mostra i pulsanti Tutto / Oggi / Mese / 7gg / 30gg / Anno / Custom. */
  showPresets?: boolean
  /** Senza etichetta sopra. */
  compact?: boolean
  className?: string
  /** 25/09/2026: false = niente "Tutto", per le schermate che hanno sempre
   *  bisogno di due date (buste paga, KPI, storico OTP...). */
  conTutto?: boolean
}

type Preset = 'tutto' | 'oggi' | 'mese' | '7gg' | '30gg' | 'anno' | 'custom'

const PRESET: { key: Preset; label: string }[] = [
  { key: 'tutto', label: 'Tutto' },
  { key: 'oggi', label: 'Oggi' },
  { key: 'mese', label: 'Mese' },
  { key: '7gg', label: '7gg' },
  { key: '30gg', label: '30gg' },
  { key: 'anno', label: 'Anno' },
  { key: 'custom', label: 'Custom' },
]

function toISO(d: Date): string {
  // YYYY-MM-DD locale (mai toISOString: in UTC sposta di un giorno)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Date del preset, come nella barra dei Report: Mese e Anno sono interi. */
function intervallo(p: Exclude<Preset, 'custom'>): DateRange {
  if (p === 'tutto') return { from: '', to: '' }
  const oggi = new Date()
  const a = toISO(oggi)
  if (p === 'oggi') return { from: a, to: a }
  if (p === '7gg') { const d = new Date(oggi); d.setDate(d.getDate() - 6); return { from: toISO(d), to: a } }
  if (p === '30gg') { const d = new Date(oggi); d.setDate(d.getDate() - 29); return { from: toISO(d), to: a } }
  if (p === 'anno') return { from: toISO(new Date(oggi.getFullYear(), 0, 1)), to: toISO(new Date(oggi.getFullYear(), 11, 31)) }
  return { from: toISO(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), to: toISO(new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0)) }
}

/** Il preset che corrisponde alle date attuali, altrimenti Custom. */
function presetDi(v: DateRange): Preset {
  for (const p of PRESET) {
    if (p.key === 'custom') continue
    const r = intervallo(p.key)
    if (r.from === v.from && r.to === v.to) return p.key
  }
  return 'custom'
}

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  value,
  onChange,
  fromLabel = 'Periodo',
  showPresets = true,
  compact = false,
  className = '',
  conTutto = true,
}) => {
  // "Custom" cliccato senza ancora date proprie: resta evidenziato finche'
  // non si sceglie un altro preset.
  const [customScelto, setCustomScelto] = useState(false)
  const attivo: Preset = customScelto ? 'custom' : presetDi(value)
  const classeData = 'px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-xs font-mono tabular-nums w-28'

  return (
    <div className={className}>
      {!compact && <label className="block text-xs text-theme-text-muted mb-1">{fromLabel === 'Da' ? 'Periodo' : fromLabel}</label>}
      <div className="flex flex-wrap items-center gap-2">
        {showPresets && (
          <div className="inline-flex rounded-md border border-theme-border bg-theme-bg-tertiary p-0.5 text-xs">
            {PRESET.filter(p => conTutto || p.key !== 'tutto').map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  if (p.key === 'custom') { setCustomScelto(true); return }
                  setCustomScelto(false)
                  onChange(intervallo(p.key))
                }}
                className={`px-3 py-1 rounded ${attivo === p.key ? 'bg-dr7-gold text-white font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {/* 25/09/2026: menu dei mesi come nel Report Noleggio. */}
        <SceltaMese da={value.from} a={value.to} onChange={(f, t) => { setCustomScelto(false); onChange({ from: f, to: t }) }} />
        <EuropeanDateInput
          value={value.from}
          onChange={(v) => { setCustomScelto(false); onChange({ ...value, from: v }) }}
          className={classeData}
        />
        <span className="text-theme-text-muted text-xs">→</span>
        <EuropeanDateInput
          value={value.to}
          onChange={(v) => { setCustomScelto(false); onChange({ ...value, to: v }) }}
          className={classeData}
        />
        <CalendarRangePicker
          from={value.from || undefined}
          to={value.to || undefined}
          onChange={(f, t) => { setCustomScelto(false); onChange({ from: f, to: t }) }}
        />
      </div>
    </div>
  )
}

export default DateRangeFilter
