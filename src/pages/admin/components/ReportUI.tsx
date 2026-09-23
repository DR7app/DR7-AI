/**
 * Stile unico dei Report — la "forma Terra".
 *
 * 2026-08-27 (richiesta direzione): ogni tab Report deve avere lo stesso
 * aspetto del Report Noleggio Terra (`ReportsTab.tsx`): titolo, barra dei
 * controlli, schede riassuntive e TABELLE. Niente grafici, niente palette
 * pastello, niente sfondi glass: solo i token del tema (`theme-bg-*`,
 * `theme-border`, `dr7-gold`) esattamente come su Terra.
 *
 * Questi componenti sono la copia riusabile di quel markup: si toccano qui e
 * cambiano su tutti i report insieme.
 *
 * 23/09/2026 (direzione): i grafici tornano, ma SOPRA le tabelle e mai al loro
 * posto — le tabelle restano la lettura all'euro. Un solo modello per tutti i
 * report: `ReportGrafico` (linea + area, come quelli di Prenotazioni Noleggio
 * Terra) dentro `ReportGrafici`. Segue il periodo scelto nel report.
 */
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** Contenitore pagina + titolo, identico all'intestazione di Terra. */
export function ReportShell({ title, subtitle, children }: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">{title}</h2>
          {subtitle && <p className="text-xs text-theme-text-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

/** Barra dei controlli (periodo, filtri, pulsante Aggiorna). */
export function ReportToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 flex-wrap">
        {children}
      </div>
    </div>
  )
}

/** Gruppo etichetta + controllo dentro la toolbar. */
export function ReportField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-theme-text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

/** Pulsante primario oro, come "Aggiorna" su Terra. */
export function ReportButton({ onClick, disabled, children }: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  )
}

/** Pillole di periodo/filtro (attiva = oro), come i preset di Terra. */
export function ReportPills<T extends string>({ value, options, onChange }: {
  value: T
  options: { key: T; label: string }[]
  onChange: (key: T) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-theme-border bg-theme-bg-tertiary p-0.5 text-xs">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`px-3 py-1 rounded ${value === o.key ? 'bg-dr7-gold text-white font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const REPORT_INPUT_CLASS =
  'px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-xs'

export type KpiTone = 'default' | 'gold' | 'green' | 'red' | 'yellow' | 'muted'

const KPI_BORDER: Record<KpiTone, string> = {
  default: 'border-theme-border',
  gold: 'border-dr7-gold/30',
  green: 'border-green-500/30',
  red: 'border-red-500/30',
  yellow: 'border-yellow-500/30',
  muted: 'border-theme-border',
}

const KPI_VALUE: Record<KpiTone, string> = {
  default: 'text-theme-text-primary',
  gold: 'text-dr7-gold',
  green: 'text-green-500',
  red: 'text-red-500',
  yellow: 'text-yellow-400',
  muted: 'text-theme-text-muted',
}

/** Griglia delle schede riassuntive (5 per riga come su Terra). */
export function ReportKpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-5 gap-4">{children}</div>
}

/** Scheda riassuntiva: etichetta piccola, numero grande, nota facoltativa. */
export function ReportKpi({ label, value, sub, tone = 'default' }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: KpiTone
}) {
  return (
    <div className={`bg-theme-bg-secondary/50 rounded-xl border ${KPI_BORDER[tone]} p-4`}>
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className={`text-2xl font-bold ${KPI_VALUE[tone]}`}>{value}</p>
      {sub && <p className="text-[10px] text-theme-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

/** Riquadro con intestazione: contiene tabelle o elenchi. */
export function ReportCard({ title, right, children, className = '', padded = false }: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  /** Contenuto che non e' una tabella: aggiunge il padding interno. */
  padded?: boolean
}) {
  return (
    <div className={`bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="px-4 py-3 border-b border-theme-border flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>}
          {right && <div className="text-xs text-theme-text-muted">{right}</div>}
        </div>
      )}
      {padded ? <div className="p-4">{children}</div> : children}
    </div>
  )
}

/** Tabella standard: intestazione grigia, righe separate, scroll orizzontale. */
export function ReportTable({ head, children, foot }: {
  head: ReactNode
  children: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-theme-bg-primary/50 text-theme-text-muted">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  )
}

/** Riga tabella con lo stesso hover di Terra. */
export function ReportRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors ${onClick ? 'cursor-pointer' : ''}`}
    >
      {children}
    </tr>
  )
}

/** Riga dei totali in fondo alla tabella. */
export function ReportTotalRow({ children }: { children: ReactNode }) {
  return <tr className="border-t-2 border-theme-border bg-theme-bg-primary/30 font-bold text-theme-text-primary">{children}</tr>
}

/** Stato vuoto dentro un riquadro. */
export function ReportEmpty({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-sm text-theme-text-muted">{message}</div>
}

/** Banner di errore, identico a quello di Terra. */
export function ReportError({ message }: { message: string }) {
  return (
    <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
      {message}
    </div>
  )
}


// ─── Grafici ────────────────────────────────────────────────────────────────

export type ReportGraficoColore = 'emerald' | 'cyan' | 'amber' | 'gold' | 'violet' | 'rose'

const COLORI_GRAFICO: Record<ReportGraficoColore, { stroke: string; text: string }> = {
  emerald: { stroke: '#10b981', text: 'text-emerald-400' },
  cyan: { stroke: '#06b6d4', text: 'text-cyan-400' },
  amber: { stroke: '#f59e0b', text: 'text-amber-400' },
  gold: { stroke: '#0A8FA3', text: 'text-dr7-gold' },
  violet: { stroke: '#8b5cf6', text: 'text-violet-400' },
  rose: { stroke: '#f43f5e', text: 'text-rose-400' },
}

/** Un evento da contare: data (YYYY-MM-DD o ISO) e valore (1 per un conteggio). */
export interface ReportPunto {
  data: string | Date
  valore: number
}

type Passo = 'giorno' | 'settimana' | 'mese'

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

/** Giorno di calendario in ora italiana, come YYYY-MM-DD. */
function giornoRoma(d: string | Date): string | null {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return null
  return dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

function daIso(s: string): Date {
  const [y, m, g] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, g))
}

function isoDa(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Inizio del gruppo a cui appartiene il giorno (lunedi' per le settimane). */
function inizioGruppo(giorno: string, passo: Passo): string {
  if (passo === 'giorno') return giorno
  if (passo === 'mese') return giorno.slice(0, 7) + '-01'
  const d = daIso(giorno)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return isoDa(d)
}

function etichettaGruppo(inizio: string, passo: Passo, conAnno = false): string {
  const d = daIso(inizio)
  const mese = MESI_BREVI[d.getUTCMonth()]
  if (passo === 'mese') return `${mese}${conAnno ? ' ' + d.getUTCFullYear() : ''}`
  return `${d.getUTCDate()} ${mese}${conAnno ? ' ' + d.getUTCFullYear() : ''}`
}

/**
 * Raggruppa gli eventi nel periodo [da, a]: per giorno fino a 62 giorni, per
 * settimana fino a 220, per mese oltre. Ogni gruppo del periodo c'e' anche a
 * zero, cosi' la linea non salta i giorni vuoti.
 */
export function serieDelPeriodo(
  punti: ReportPunto[],
  da: string | Date,
  a: string | Date,
  aggrega: 'somma' | 'massimo' = 'somma',
): { passo: Passo; gruppi: { inizio: string; valore: number }[] } {
  const g0 = giornoRoma(da)
  const g1 = giornoRoma(a)
  if (!g0 || !g1 || g1 < g0) return { passo: 'giorno', gruppi: [] }
  const giorni = Math.round((daIso(g1).getTime() - daIso(g0).getTime()) / 86400000) + 1
  const passo: Passo = giorni <= 62 ? 'giorno' : giorni <= 220 ? 'settimana' : 'mese'
  const valori = new Map<string, number>()
  const cur = daIso(g0)
  const fine = daIso(g1)
  while (cur <= fine) {
    const k = inizioGruppo(isoDa(cur), passo)
    if (!valori.has(k)) valori.set(k, 0)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  for (const p of punti) {
    const g = giornoRoma(p.data)
    if (!g || g < g0 || g > g1) continue
    const v = Number(p.valore)
    if (!Number.isFinite(v)) continue
    const k = inizioGruppo(g, passo)
    const prima = valori.get(k) ?? 0
    valori.set(k, aggrega === 'massimo' ? Math.max(prima, v) : prima + v)
  }
  return { passo, gruppi: [...valori.entries()].map(([inizio, valore]) => ({ inizio, valore })) }
}

/** Griglia dei grafici sopra le tabelle (3 per riga su schermo largo). */
export function ReportGrafici({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">{children}</div>
}

/**
 * Grafico linea + area, identico a quelli di Prenotazioni Noleggio Terra.
 * `totale` sostituisce la somma quando la somma non ha senso (es. auto
 * distinte). Passando al mouse si legge il valore del giorno/settimana/mese.
 */
export function ReportGrafico({ titolo, punti, da, a, colore = 'gold', formato, formatoAsse, aggrega = 'somma', totale, totaleEtichetta }: {
  titolo: string
  punti: ReportPunto[]
  da: string | Date
  a: string | Date
  colore?: ReportGraficoColore
  formato: (v: number) => string
  formatoAsse?: (v: number) => string
  aggrega?: 'somma' | 'massimo'
  totale?: number
  totaleEtichetta?: string
}) {
  const [hoverGrezzo, setHover] = useState<number | null>(null)
  const idGrad = `rg-${useId().replace(/:/g, '')}`
  const c = COLORI_GRAFICO[colore]
  const { passo, gruppi } = useMemo(() => serieDelPeriodo(punti, da, a, aggrega), [punti, da, a, aggrega])
  const values = gruppi.map(g => g.valore)
  const n = values.length
  // Cambiando periodo i gruppi diminuiscono: il punto sotto il mouse puo'
  // non esistere piu' e leggerlo faceva cadere l'intera pagina.
  const hover = hoverGrezzo !== null && hoverGrezzo < n ? hoverGrezzo : null
  const asse = formatoAsse || ((v: number) => {
    const r = Math.round(v)
    return Math.abs(r) >= 1000 ? `${Math.round(r / 1000)}K` : String(r)
  })

  const W = 320
  const H = 140
  const padL = 40
  const padR = 12
  const padT = 14
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const max = Math.max(1, ...values) * 1.15
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + (innerH - (Math.max(0, v) / max) * innerH)
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const areaPath = n > 1
    ? `M ${x(0)},${padT + innerH} L ${values.map((v, i) => `${x(i)},${y(v)}`).join(' L ')} L ${x(n - 1)},${padT + innerH} Z`
    : ''
  const piuAnni = n > 0 && gruppi[0].inizio.slice(0, 4) !== gruppi[n - 1].inizio.slice(0, 4)
  const ticks = n <= 1 ? [0] : [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1]
    .filter((v, i, arr) => arr.indexOf(v) === i)
  const tot = typeof totale === 'number' ? totale : values.reduce((s, v) => s + v, 0)
  const nomePasso = passo === 'giorno' ? 'per giorno' : passo === 'settimana' ? 'per settimana' : 'per mese'

  return (
    <div className="relative rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-theme-text-muted truncate">{titolo}</div>
          <div className="text-[9px] text-theme-text-muted opacity-70">{nomePasso}</div>
        </div>
        <div className={`text-xs font-semibold whitespace-nowrap ${c.text}`}>{totaleEtichetta ?? formato(tot)}</div>
      </div>
      {n === 0 ? (
        <div className="h-[140px] flex items-center justify-center text-xs text-theme-text-muted">Nessun dato nel periodo</div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            width="100%"
            height={H}
            role="img"
            aria-label={titolo}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={idGrad} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={c.stroke} stopOpacity="0.35" />
                <stop offset="100%" stopColor={c.stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
              const yPos = padT + innerH * (1 - p)
              return (
                <g key={i}>
                  <line x1={padL} x2={padL + innerW} y1={yPos} y2={yPos} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                </g>
              )
            })}
            {n > 1 ? (
              <>
                <path d={areaPath} fill={`url(#${idGrad})`} />
                <polyline points={points} fill="none" stroke={c.stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </>
            ) : (
              <circle cx={x(0)} cy={y(values[0])} r="3.5" fill={c.stroke} />
            )}
            {values.map((_, i) => (
              <rect
                key={i}
                x={x(i) - innerW / Math.max(1, n) / 2}
                y={padT}
                width={innerW / Math.max(1, n)}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke={c.stroke} strokeOpacity="0.4" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                <circle cx={x(hover)} cy={y(values[hover])} r="3.5" fill={c.stroke} stroke="var(--color-theme-bg-secondary, #111)" strokeWidth="2" />
              </g>
            )}
          </svg>
          {/* 23/09/2026: le scritte degli assi stanno FUORI dall'svg. L'svg si
              allarga alla colonna (preserveAspectRatio="none") e il testo
              dentro veniva stirato in larghezza. */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <div
              key={`y${i}`}
              className="absolute pointer-events-none text-[9px] leading-none text-theme-text-muted opacity-70 text-right tabular-nums"
              style={{ left: 0, width: `calc(${(padL / W) * 100}% - 6px)`, top: padT + innerH * (1 - p) - 4 }}
            >
              {asse(max * p)}
            </div>
          ))}
          {ticks.map(t => (
            <div
              key={`x${t}`}
              className="absolute pointer-events-none text-[9px] leading-none text-theme-text-muted opacity-70 whitespace-nowrap"
              style={{ left: `${(x(t) / W) * 100}%`, top: H - 14, transform: 'translateX(-50%)' }}
            >
              {etichettaGruppo(gruppi[t].inizio, passo, passo === 'mese' && piuAnni)}
            </div>
          ))}
          {hover !== null && (
            <div
              className="absolute pointer-events-none px-2.5 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-[10px] shadow-lg whitespace-nowrap"
              style={{
                left: `${(x(hover) / W) * 100}%`,
                top: `${(y(values[hover]) / H) * 100}%`,
                transform: 'translate(-50%, calc(-100% - 8px))',
              }}
            >
              <div className="text-theme-text-muted">
                {passo === 'settimana' ? 'settimana dal ' : ''}{etichettaGruppo(gruppi[hover].inizio, passo, true)}
              </div>
              <div className={`font-bold ${c.text}`}>{formato(values[hover])}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
