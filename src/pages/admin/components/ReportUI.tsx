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
 */
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
