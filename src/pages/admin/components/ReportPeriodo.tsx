/**
 * Barra "Periodo" comune a tutti i Report.
 *
 * 23/09/2026 (direzione): la stessa barra del Report Noleggio (Oggi, Mese,
 * 7gg, 30gg, Anno, Custom, date europee scritte a mano, calendario) su ogni
 * pagina Report. Il report tiene il suo pulsante Aggiorna e legge `da`/`a`
 * (YYYY-MM-DD, ora italiana) da `usePeriodoReport`.
 */
import { useState } from 'react'
import CalendarRangePicker from '../../../components/admin/CalendarRangePicker'
import { formattaDataEu, rimettiCursore } from '../../../utils/dataEuMentreScrivi'

export type PresetPeriodo = 'oggi' | 'mese' | '7gg' | '30gg' | 'anno' | 'custom'

const PRESET: { key: PresetPeriodo; label: string }[] = [
  { key: 'oggi', label: 'Oggi' },
  { key: 'mese', label: 'Mese' },
  { key: '7gg', label: '7gg' },
  { key: '30gg', label: '30gg' },
  { key: 'anno', label: 'Anno' },
  { key: 'custom', label: 'Custom' },
]

/** YYYY-MM-DD in ora locale (mai toISOString: in UTC sposta di un giorno). */
function fmtLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isoAEu(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function euAIso(eu: string): string | null {
  const m = eu.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!m) return null
  const d = m[1].padStart(2, '0')
  const mo = m[2].padStart(2, '0')
  let y = m[3]
  if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y
  const dt = new Date(`${y}-${mo}-${d}T00:00:00`)
  if (isNaN(dt.getTime()) || dt.getDate() !== Number(d) || dt.getMonth() + 1 !== Number(mo)) return null
  return `${y}-${mo}-${d}`
}

/** Date del preset, come nel Report Noleggio: Mese e Anno sono interi. */
export function intervalloDelPreset(preset: PresetPeriodo, oggi = new Date()): { da: string; a: string } {
  const a = fmtLocale(oggi)
  if (preset === '7gg') { const d = new Date(oggi); d.setDate(d.getDate() - 6); return { da: fmtLocale(d), a } }
  if (preset === '30gg') { const d = new Date(oggi); d.setDate(d.getDate() - 29); return { da: fmtLocale(d), a } }
  if (preset === 'anno') return { da: fmtLocale(new Date(oggi.getFullYear(), 0, 1)), a: fmtLocale(new Date(oggi.getFullYear(), 11, 31)) }
  if (preset === 'mese') return { da: fmtLocale(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), a: fmtLocale(new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0)) }
  return { da: a, a }
}

export interface PeriodoReport {
  preset: PresetPeriodo
  da: string
  a: string
  scegliPreset: (p: PresetPeriodo) => void
  impostaIntervallo: (da: string, a: string) => void
}

/** Stato del periodo di un report. Parte da "Mese" come il Report Noleggio. */
export function usePeriodoReport(iniziale: PresetPeriodo = 'mese'): PeriodoReport {
  const [preset, setPreset] = useState<PresetPeriodo>(iniziale)
  const [intervallo, setIntervallo] = useState(() => intervalloDelPreset(iniziale === 'custom' ? 'mese' : iniziale))
  return {
    preset,
    da: intervallo.da,
    a: intervallo.a,
    scegliPreset: (p) => {
      setPreset(p)
      if (p !== 'custom') setIntervallo(intervalloDelPreset(p))
    },
    impostaIntervallo: (da, a) => {
      setPreset('custom')
      setIntervallo({ da, a })
    },
  }
}

const CLASSE_DATA = 'px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-xs font-mono tabular-nums w-28'

/** La barra: preset, due date scritte a mano e calendario. */
export function ReportPeriodo({ periodo, label = 'Periodo' }: { periodo: PeriodoReport; label?: string }) {
  const [bozzaDa, setBozzaDa] = useState<string | null>(null)
  const [bozzaA, setBozzaA] = useState<string | null>(null)

  const campo = (valore: string, bozza: string | null, setBozza: (v: string | null) => void, applica: (iso: string) => void) => (
    <input
      type="text"
      inputMode="numeric"
      placeholder="GG/MM/AAAA"
      maxLength={10}
      value={bozza ?? isoAEu(valore)}
      onChange={(e) => {
        const el = e.target
        const { testo, caret } = formattaDataEu(el.value, el.selectionStart)
        setBozza(testo)
        rimettiCursore(el, caret)
        const iso = euAIso(testo)
        if (iso) applica(iso)
      }}
      onBlur={() => setBozza(null)}
      className={CLASSE_DATA}
    />
  )

  return (
    <div>
      <label className="block text-xs text-theme-text-muted mb-1">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-theme-border bg-theme-bg-tertiary p-0.5 text-xs">
          {PRESET.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setBozzaDa(null); setBozzaA(null); periodo.scegliPreset(p.key) }}
              className={`px-3 py-1 rounded ${periodo.preset === p.key ? 'bg-dr7-gold text-white font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {campo(periodo.da, bozzaDa, setBozzaDa, iso => periodo.impostaIntervallo(iso, periodo.a))}
        <span className="text-theme-text-muted text-xs">→</span>
        {campo(periodo.a, bozzaA, setBozzaA, iso => periodo.impostaIntervallo(periodo.da, iso))}
        <CalendarRangePicker
          from={periodo.da}
          to={periodo.a}
          onChange={(f, t) => { setBozzaDa(null); setBozzaA(null); periodo.impostaIntervallo(f, t) }}
        />
      </div>
    </div>
  )
}
