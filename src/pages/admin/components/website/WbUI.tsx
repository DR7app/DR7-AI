/**
 * WbUI.tsx — i mattoncini dell'interfaccia del Website Builder.
 *
 * Usano i token del gestionale (`bg-theme-*`, `border-theme-*`) e non
 * introducono nessuna libreria nuova: il modulo deve sembrare parte del
 * gestionale, non un'applicazione incollata dentro.
 *
 * Regola di scrittura dei campi: chi li usa non e' un programmatore.
 * Niente "padding", "z-index", "flex": si dice "spazio sopra",
 * "sovrapposizione", "disposizione".
 */

import React from 'react'
import { createPortal } from 'react-dom'

// ─── Contenitori ────────────────────────────────────────────────────────────
export const WbCard: React.FC<{
  title?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}> = ({ title, subtitle, actions, children, className }) => (
  <section className={`bg-theme-bg-secondary/60 border border-theme-border rounded-xl overflow-hidden ${className || ''}`}>
    {(title || actions) && (
      <header className="px-4 py-3 border-b border-theme-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-theme-text-primary truncate">{title}</h2>}
          {subtitle && <p className="text-[11px] text-theme-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </header>
    )}
    <div className="p-4">{children}</div>
  </section>
)

export const WbEmptyState: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="text-center py-10 px-4">
    <p className="text-sm font-medium text-theme-text-primary">{title}</p>
    {text && <p className="text-[12px] text-theme-text-muted mt-1 max-w-md mx-auto">{text}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
)

// ─── Pulsanti ───────────────────────────────────────────────────────────────
type BtnTone = 'primary' | 'default' | 'ghost' | 'danger' | 'success'

const TONE: Record<BtnTone, string> = {
  primary: 'bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-600',
  default: 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary border-theme-border',
  ghost: 'bg-transparent hover:bg-theme-bg-hover text-theme-text-secondary border-transparent',
  danger: 'bg-red-600/90 hover:bg-red-600 text-white border-red-700',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700',
}

export const WbButton: React.FC<{
  children: React.ReactNode
  onClick?: () => void
  tone?: BtnTone
  size?: 'sm' | 'md'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  className?: string
}> = ({ children, onClick, tone = 'default', size = 'md', disabled, title, type = 'button', className }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[13px]'
    } ${TONE[tone]} ${className || ''}`}
  >
    {children}
  </button>
)

export const WbIconButton: React.FC<{
  path: string
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  tone?: 'default' | 'danger'
}> = ({ path, label, onClick, active, disabled, tone = 'default' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`p-1.5 rounded-md border transition-colors disabled:opacity-30 ${
      active
        ? 'bg-cyan-600/20 border-cyan-600/50 text-cyan-400'
        : tone === 'danger'
          ? 'border-transparent text-theme-text-muted hover:text-red-400 hover:bg-red-500/10'
          : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
    }`}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  </button>
)

export const WbIcon: React.FC<{ path: string; size?: number; className?: string }> = ({ path, size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d={path} />
  </svg>
)

export const WB_UI_ICONS = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M4 4l16 16M10.6 10.6a3 3 0 004.2 4.2M6.5 6.6C3.9 8.2 2 12 2 12s3.5 6 10 6c1.6 0 3-.3 4.2-.8M9.9 6.2A9.7 9.7 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3.2 3.7',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  save: 'M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6',
  publish: 'M12 19V6M5 12l7-7 7 7M4 21h16',
  back: 'M15 19l-7-7 7-7',
  desktop: 'M3 5h18v11H3zM8 20h8M12 16v4',
  tablet: 'M6 3h12v18H6zM11 18h2',
  mobile: 'M8 3h8v18H8zM11 18.5h2',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.4-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h4',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  folder: 'M3 7h6l2 2h10v10H3z',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  page: 'M6 3h8l4 4v14H6zM14 3v4h4',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  palette: 'M12 21a9 9 0 110-18c5 0 9 3.6 9 8 0 2.2-1.8 4-4 4h-1.5a1.5 1.5 0 00-1 2.6c.4.4.5 1 .2 1.5-.3.5-.9.9-1.7.9z',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-7.6 4.2M3 4v4h4M12 7v5l3 2',
  seo: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3M8 11h6M11 8v6',
  code: 'M9 8l-5 4 5 4M15 8l5 4-5 4',
  popup: 'M4 5h16v12H4zM8 20h8M9 9h6M9 13h4',
  banner: 'M3 8h18v6H3zM7 18h10',
  promo: 'M4 4h9l7 7-9 9-7-7zM9 9h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  check: 'M4 12l5 5L20 6',
  warning: 'M12 3l10 18H2zM12 9v5M12 18h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  refresh: 'M21 12a9 9 0 11-3-6.7M21 4v5h-5',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
}

// ─── Campi ──────────────────────────────────────────────────────────────────
export const WbField: React.FC<{
  label: string
  help?: string
  children: React.ReactNode
  inline?: boolean
}> = ({ label, help, children, inline }) => (
  <div className={inline ? 'flex items-center justify-between gap-3 py-1.5' : 'py-1.5'}>
    <div className={inline ? 'min-w-0' : ''}>
      <label className="block text-[11px] font-medium text-theme-text-secondary">{label}</label>
      {help && <p className="text-[10px] text-theme-text-muted mt-0.5 leading-snug">{help}</p>}
    </div>
    <div className={inline ? 'shrink-0' : 'mt-1.5'}>{children}</div>
  </div>
)

const inputCls =
  'w-full px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder:text-theme-text-disabled focus:outline-none focus:border-cyan-500/70'

export const WbInput: React.FC<{
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  onBlur?: () => void
}> = ({ value, onChange, placeholder, type = 'text', disabled, onBlur }) => (
  <input
    type={type}
    className={inputCls}
    value={value}
    disabled={disabled}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    onBlur={onBlur}
  />
)

export const WbTextarea: React.FC<{
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  mono?: boolean
}> = ({ value, onChange, rows = 4, placeholder, mono }) => (
  <textarea
    className={`${inputCls} resize-y ${mono ? 'font-mono text-[12px]' : ''}`}
    rows={rows}
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
  />
)

export const WbSelect: React.FC<{
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}> = ({ value, onChange, options, disabled }) => (
  <select className={inputCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
)

export const WbToggle: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}> = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-cyan-600' : 'bg-theme-bg-hover'}`}
  >
    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
)

/**
 * Cursore con il numero accanto. Il campo numerico NON e' `type="number"`:
 * con la tastiera italiana blocca i decimali (regola gia' nota nel
 * gestionale per i campi in euro).
 */
export const WbSlider: React.FC<{
  value: number | undefined
  onChange: (v: number | undefined) => void
  min: number
  max: number
  step?: number
  unit?: string
}> = ({ value, onChange, min, max, step = 1, unit }) => {
  const [testo, setTesto] = React.useState(value == null ? '' : String(value))
  React.useEffect(() => { setTesto(value == null ? '' : String(value)) }, [value])
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min} max={max} step={step}
        value={value ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-cyan-500"
      />
      <input
        inputMode="decimal"
        className="w-16 px-1.5 py-1 text-[12px] text-right bg-theme-bg-tertiary border border-theme-border rounded-md text-theme-text-primary"
        value={testo}
        onChange={(e) => {
          const t = e.target.value
          setTesto(t)
          if (t.trim() === '') { onChange(undefined); return }
          const n = Number(t.replace(',', '.'))
          if (!Number.isNaN(n)) onChange(n)
        }}
      />
      {unit && <span className="text-[10px] text-theme-text-muted w-5">{unit}</span>}
    </div>
  )
}

/**
 * Colore: accetta un token del tema (`var(--wb-color-primary)`) oltre a un
 * colore libero. E' cio' che rende vero il "cambio un colore globale e si
 * aggiorna tutto": chi sceglie il token segue il tema, chi sceglie un
 * colore fisso resta com'e'.
 */
export const WbColor: React.FC<{
  value: string | undefined
  onChange: (v: string | undefined) => void
  tokens?: { key: string; label: string; color: string }[]
}> = ({ value, onChange, tokens }) => {
  const isToken = !!value && value.startsWith('var(')
  const hex = !value || isToken ? '#000000' : value
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded-md border border-theme-border bg-transparent cursor-pointer p-0"
          aria-label="Scegli colore"
        />
        <input
          className={inputCls}
          value={value || ''}
          placeholder="Dal tema"
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {value && (
          <WbIconButton path={WB_UI_ICONS.trash} label="Torna al tema" onClick={() => onChange(undefined)} />
        )}
      </div>
      {tokens && tokens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tokens.map((t) => (
            <button
              key={t.key}
              type="button"
              title={`${t.label} (dal tema)`}
              onClick={() => onChange(`var(--wb-color-${t.key})`)}
              className={`w-5 h-5 rounded border ${value === `var(--wb-color-${t.key})` ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-theme-border'}`}
              style={{ background: t.color }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Finestre ───────────────────────────────────────────────────────────────
export const WbModal: React.FC<{
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}> = ({ open, onClose, title, subtitle, children, footer, size = 'md' }) => {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const w = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : size === 'xl' ? 'max-w-6xl' : 'max-w-xl'
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${w} max-h-[88vh] flex flex-col bg-theme-bg-secondary border border-theme-border rounded-2xl shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3.5 border-b border-theme-border flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
            {subtitle && <p className="text-[11px] text-theme-text-muted mt-0.5">{subtitle}</p>}
          </div>
          <WbIconButton path="M6 6l12 12M18 6L6 18" label="Chiudi" onClick={onClose} />
        </header>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-theme-border flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Conferma per le azioni distruttive. Volutamente NON usata per ogni
 * piccola modifica: chiedere sempre insegna a cliccare "Si" senza leggere.
 */
export const WbConfirm: React.FC<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}> = ({ open, title, message, confirmLabel = 'Conferma', tone = 'danger', onConfirm, onCancel }) => (
  <WbModal
    open={open}
    onClose={onCancel}
    title={title}
    size="sm"
    footer={
      <>
        <WbButton onClick={onCancel}>Annulla</WbButton>
        <WbButton tone={tone} onClick={onConfirm}>{confirmLabel}</WbButton>
      </>
    }
  >
    <p className="text-[13px] text-theme-text-secondary leading-relaxed">{message}</p>
  </WbModal>
)

// ─── Etichette di stato ─────────────────────────────────────────────────────
export const WbBadge: React.FC<{
  children: React.ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}> = ({ children, tone = 'neutral' }) => {
  const cls = {
    neutral: 'bg-theme-bg-hover text-theme-text-secondary border-theme-border',
    success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    danger: 'bg-red-500/15 text-red-400 border-red-500/30',
    info: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  }[tone]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}>{children}</span>
}

export const WB_STATUS_LABEL: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'info' }> = {
  draft: { label: 'Bozza', tone: 'neutral' },
  scheduled: { label: 'Programmata', tone: 'warning' },
  published: { label: 'Pubblicata', tone: 'success' },
  archived: { label: 'Archiviata', tone: 'neutral' },
}

// ─── Formattazione ──────────────────────────────────────────────────────────
/** Data e ora all'europea: 24 ore, giorno/mese/anno. Mai AM/PM. */
export function wbDataOra(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Europe/Rome',
  })
}

export function wbDaAllora(iso: string | null | undefined): string {
  if (!iso) return 'mai'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return 'mai'
  const min = Math.round(diff / 60000)
  if (min < 1) return 'adesso'
  if (min < 60) return `${min} min fa`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h fa`
  const g = Math.round(h / 24)
  if (g < 30) return `${g} g fa`
  return wbDataOra(iso)
}

export function wbPeso(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** `datetime-local` vuole `YYYY-MM-DDTHH:mm` nell'ora locale, non ISO UTC. */
export function wbIsoAInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function wbInputAIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
