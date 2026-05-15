import React, { useEffect, useMemo, useState } from 'react'

// Tab dedicata al Profilo Google Business (mybusinessbusinessinformation +
// businessprofileperformance). Estratta da ReportTrafficTab a maggio 2026
// perché le metriche GBP rispondono a una domanda diversa ("come ti trovano
// su Google Maps/Search") e usano una API + quota separate (errori di
// quota tipo "Requests per minute" non devono affollare la tab traffico).

const RANGES = [
  { key: '7d',  label: '7 giorni' },
  { key: '28d', label: '28 giorni' },
  { key: '90d', label: '90 giorni' },
  { key: '180d', label: '6 mesi' },
  { key: '365d', label: '1 anno' },
] as const
type RangeKey = typeof RANGES[number]['key']

interface GbpKpis { views: number; calls: number; directions: number; websiteClicks: number; bookings: number }
interface GbpPayload { configured: boolean; range: string; kpis: GbpKpis | null; warnings: string[]; needsReauth?: boolean; noLocationFound?: boolean }

const fmtInt = (v: number) => v.toLocaleString('it-IT')

function KpiTile({ label, value, valueClass = 'text-theme-text-primary' }: { label: string; value: number; valueClass?: string }) {
  return (
    <div className="bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-3 flex flex-col gap-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-theme-text-muted truncate">{label}</div>
      <div className={`text-xl font-bold ${valueClass} tabular-nums`}>{fmtInt(value)}</div>
      <div className="text-[11px] font-medium text-theme-text-muted">—</div>
    </div>
  )
}

export default function ReportGoogleBusinessTab() {
  const [range, setRange] = useState<RangeKey>('28d')
  const [gbp, setGbp] = useState<GbpPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let abort = false
    setLoading(true)
    fetch(`/.netlify/functions/gbp-report?range=${range}`)
      .then(r => r.json())
      .then((p: GbpPayload) => { if (!abort) { setGbp(p); setLoading(false) } })
      .catch(() => { if (!abort) setLoading(false) })
    return () => { abort = true }
  }, [range])

  const rangeLabel = useMemo(() => RANGES.find(r => r.key === range)?.label ?? '', [range])

  return (
    <div className="space-y-3">
      {/* Header + range picker */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-blue-400"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
            Rendimento Google My Business
          </h2>
          <p className="text-xs text-theme-text-muted mt-0.5">Dati dalla scheda Google (Maps/Search) — DR7 Cagliari</p>
        </div>
        <div className="flex gap-1 text-xs">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded-md border transition-colors ${range === r.key ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' : 'border-theme-border text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI block / warnings */}
      <div className="bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-theme-text-primary">Profilo Google Business — DR7 Cagliari</h3>
          <span className="text-[10px] text-theme-text-muted">{rangeLabel}</span>
        </div>

        {loading ? (
          <div className="text-xs text-theme-text-muted py-3">Caricamento…</div>
        ) : gbp?.needsReauth ? (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-3 text-xs text-amber-900 dark:text-amber-100">
            Per vedere i dati del profilo Google Business serve una nuova autorizzazione (scope <code>business.manage</code>).{' '}
            <a href="/.netlify/functions/ga-oauth-start" className="underline font-semibold">Riconnetti il tuo account Google</a> e
            quando Google ti chiede i permessi spunta anche "Gestisci la tua scheda di Google Business".
          </div>
        ) : gbp?.noLocationFound ? (
          <div className="text-xs text-theme-text-muted py-2">Nessuna scheda Google Business associata a questo account.</div>
        ) : gbp && gbp.warnings.length > 0 && !gbp.kpis ? (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 text-xs text-amber-300">
            {gbp.warnings.join(' · ')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiTile label="Visualizzazioni" value={gbp?.kpis?.views ?? 0} valueClass="text-cyan-400" />
              <KpiTile label="Chiamate" value={gbp?.kpis?.calls ?? 0} valueClass="text-emerald-400" />
              <KpiTile label="Indicazioni" value={gbp?.kpis?.directions ?? 0} valueClass="text-fuchsia-400" />
              <KpiTile label="Click sito web" value={gbp?.kpis?.websiteClicks ?? 0} valueClass="text-orange-400" />
              <KpiTile label="Prenotazioni" value={gbp?.kpis?.bookings ?? 0} valueClass="text-violet-400" />
            </div>
            {gbp && gbp.warnings.length > 0 && (
              <div className="mt-3 text-[11px] text-amber-400">{gbp.warnings.join(' · ')}</div>
            )}
          </>
        )}
      </div>

      <div className="text-[11px] text-theme-text-muted italic">
        Le metriche del profilo Google si riferiscono a quante volte la tua scheda DR7 Cagliari appare nei
        risultati di Google Maps/Search e quanti utenti cliccano per chiamarti, chiedere indicazioni o
        visitare il sito web. Sono separate dal traffico del sito (Rendimento Sito).
      </div>
    </div>
  )
}
