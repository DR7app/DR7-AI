/**
 * SedePicker — header dropdown that lets direzione switch sede.
 *
 * Visibility rules:
 *   - Only renders when `canSwitchSede` is true (i.e. user has direzione
 *     role AND the brand has ≥2 sedi). For sede-bound operatori it
 *     simply shows the home sede as a static badge.
 *   - "Tutte le sedi" option appears only for brand direzione (cross-sede
 *     overview).
 */
import { useState, useRef, useEffect } from 'react'
import { useBrandSede } from '../contexts/BrandSedeContext'

export default function SedePicker() {
  const {
    currentBrand,
    homeSede,
    selectedSedeId,
    selectedSede,
    availableSedi,
    isBrandDirezione,
    canSwitchSede,
    switchSede,
    loading,
  } = useBrandSede()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (loading) return null

  // No sedi data yet (Phase 0 not applied) — render nothing.
  if (!currentBrand || availableSedi.length === 0) return null

  // Sede-bound operator: show their sede as a static badge (no dropdown).
  if (!canSwitchSede) {
    const label = homeSede?.name || selectedSede?.name || availableSedi[0]?.name
    if (!label) return null
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-theme-bg-tertiary border border-theme-border min-h-[40px]" title={label}>
        <svg className="w-3.5 h-3.5 text-dr7-gold shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-[12px] font-bold text-theme-text-primary truncate max-w-[140px]">{label}</span>
      </div>
    )
  }

  const currentLabel = selectedSedeId === 'ALL'
    ? 'Tutte le sedi'
    : (selectedSede?.name || homeSede?.name || 'Sede')

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-2 pr-2 py-1 rounded-xl bg-theme-bg-tertiary border border-theme-border hover:border-dr7-gold transition-colors min-h-[40px]"
        title={`Sede: ${currentLabel}`}
        aria-label="Seleziona sede"
      >
        <svg className="w-4 h-4 text-dr7-gold shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <div className="flex flex-col items-start leading-tight pr-1 min-w-0">
          <span className="text-[10px] text-theme-text-muted">Sede</span>
          <span className="text-[12px] font-bold text-theme-text-primary truncate max-w-[120px]">{currentLabel}</span>
        </div>
        <svg className={`w-3.5 h-3.5 text-theme-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-theme-bg-secondary border border-theme-border rounded-xl shadow-2xl py-1 text-sm">
          {isBrandDirezione && (
            <button
              onClick={() => { switchSede('ALL'); setOpen(false) }}
              className={`w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary flex items-center justify-between ${selectedSedeId === 'ALL' ? 'text-dr7-gold font-semibold' : 'text-theme-text-primary'}`}
            >
              <span>Tutte le sedi</span>
              {selectedSedeId === 'ALL' && (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}
          {isBrandDirezione && availableSedi.length > 0 && (
            <div className="border-t border-theme-border my-1" />
          )}
          {availableSedi.map(s => {
            const isSelected = selectedSedeId === s.id
            return (
              <button
                key={s.id}
                onClick={() => { switchSede(s.id); setOpen(false) }}
                className={`w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary flex items-center justify-between ${isSelected ? 'text-dr7-gold font-semibold' : 'text-theme-text-primary'}`}
              >
                <span className="flex flex-col">
                  <span>{s.name}</span>
                  {s.city && <span className="text-[10px] text-theme-text-muted">{s.city}</span>}
                </span>
                {isSelected && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
