import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// 2026-06-06: calendario a griglia per selezionare un intervallo arbitrario
// (random range) cliccando le date. Volutamente NON usa <input type="date">
// che segue il locale dell'OS (su Mac US mostra MM/DD/YYYY): la griglia e' resa
// da noi, quindi e' SEMPRE in formato/lingua italiana (dd/mm/yyyy, settimana da
// lunedi, mesi in italiano). Lo stato esterno resta ISO YYYY-MM-DD (formato
// API/Supabase); il componente converte solo per la visualizzazione.

type Props = {
  from?: string // ISO YYYY-MM-DD, inclusivo
  to?: string   // ISO YYYY-MM-DD, inclusivo
  onChange: (from: string, to: string) => void
  className?: string
}

const MONTHS_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
// Settimana italiana: lunedi -> domenica
const WEEKDAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

// Costruisce una stringa ISO locale (no toISOString che sposta in UTC -1 giorno)
function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function isoToEU(iso?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
// getDay() ritorna 0=Dom..6=Sab. Per una griglia che parte da lunedi
// serve 0=Lun..6=Dom.
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7
}

export default function CalendarRangePicker({ from, to, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // 09/11/2026: il calendario si apre in un portale sul body, in posizione
  // fissa sotto il bottone: dentro la barra finiva SOTTO le card successive
  // (es. "Nuovi Clienti" nel Report Clienti), che creano un proprio livello.
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Mese visualizzato nella griglia. Inizializzato sul "from" se presente.
  const initView = from ? new Date(from + 'T00:00:00') : new Date()
  const [viewY, setViewY] = useState(initView.getFullYear())
  const [viewM, setViewM] = useState(initView.getMonth())

  // Quando si riapre il popover, riallinea la vista sul from corrente.
  useEffect(() => {
    if (!open) return
    const base = from ? new Date(from + 'T00:00:00') : new Date()
    setViewY(base.getFullYear())
    setViewM(base.getMonth())
  }, [open, from])

  // Chiusura al click fuori.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Posizione del calendario: sotto il bottone; se sotto non c'e' spazio,
  // sopra. Mai fuori dallo schermo in orizzontale. Segue scroll e resize.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    function calcola() {
      const b = ref.current?.getBoundingClientRect()
      if (!b) return
      const larg = popRef.current?.offsetWidth || 288
      const alt = popRef.current?.offsetHeight || 360
      const margine = 8
      let top = b.bottom + margine
      if (top + alt > window.innerHeight - margine && b.top - margine - alt >= margine) top = b.top - margine - alt
      const left = Math.max(margine, Math.min(b.left, window.innerWidth - larg - margine))
      setPos({ top, left })
    }
    calcola()
    const raf = requestAnimationFrame(calcola)
    window.addEventListener('resize', calcola)
    window.addEventListener('scroll', calcola, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', calcola)
      window.removeEventListener('scroll', calcola, true)
    }
  }, [open])

  // Stato interno di selezione: dopo il primo click teniamo solo "anchor"
  // finche' non arriva il secondo click che chiude il range.
  const [anchor, setAnchor] = useState<string | null>(null)

  function handleDayClick(iso: string) {
    if (!anchor) {
      // Primo click: inizia un nuovo range.
      setAnchor(iso)
      onChange(iso, iso)
      return
    }
    // Secondo click: chiude il range, ordinando gli estremi.
    const a = anchor
    const lo = iso < a ? iso : a
    const hi = iso < a ? a : iso
    setAnchor(null)
    onChange(lo, hi)
  }

  function prevMonth() {
    setViewM(m => { if (m === 0) { setViewY(y => y - 1); return 11 } return m - 1 })
  }
  function nextMonth() {
    setViewM(m => { if (m === 11) { setViewY(y => y + 1); return 0 } return m + 1 })
  }

  // Griglia del mese: blanks iniziali (lunedi-start) + giorni del mese.
  const cells = useMemo(() => {
    const firstDow = mondayIndex(new Date(viewY, viewM, 1).getDay())
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate()
    const out: (string | null)[] = []
    for (let i = 0; i < firstDow; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(toISO(viewY, viewM, d))
    return out
  }, [viewY, viewM])

  // Range effettivo da evidenziare: durante la selezione (anchor presente) si
  // mostra solo l'anchor; altrimenti from..to.
  const selLo = anchor || from
  const selHi = anchor ? anchor : to

  const buttonLabel = from && to
    ? `${isoToEU(from)} – ${isoToEU(to)}`
    : 'Scegli intervallo'

  return (
    <div className={`relative ${className || ''}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-theme-border bg-theme-bg-tertiary text-theme-text-primary text-xs font-mono tabular-nums hover:bg-theme-bg-hover transition-colors"
        title="Apri calendario per selezionare un intervallo"
      >
        <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {buttonLabel}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          className="z-[10000] w-72 p-3 rounded-xl border border-theme-border bg-theme-bg-primary shadow-lg"
        >
          {/* Header: navigazione mese */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="w-7 h-7 flex items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
              aria-label="Mese precedente"
            >‹</button>
            <span className="text-sm font-semibold text-theme-text-primary">{MONTHS_IT[viewM]} {viewY}</span>
            <button
              type="button"
              onClick={nextMonth}
              className="w-7 h-7 flex items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
              aria-label="Mese successivo"
            >›</button>
          </div>

          {/* Intestazione giorni della settimana (lunedi-start) */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS_IT.map(w => (
              <div key={w} className="text-[10px] text-center text-theme-text-muted font-medium py-1">{w}</div>
            ))}
          </div>

          {/* Griglia giorni */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((iso, i) => {
              if (!iso) return <div key={`b${i}`} />
              const isStart = iso === selLo
              const isEnd = iso === selHi
              const inRange = selLo && selHi && iso > selLo && iso < selHi
              const isEdge = isStart || isEnd
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handleDayClick(iso)}
                  className={[
                    'h-8 text-xs rounded-md transition-colors tabular-nums',
                    isEdge
                      ? 'bg-dr7-gold text-white font-bold'
                      : inRange
                        ? 'bg-dr7-gold/20 text-theme-text-primary'
                        : 'text-theme-text-primary hover:bg-theme-bg-hover',
                  ].join(' ')}
                >
                  {parseInt(iso.slice(8, 10), 10)}
                </button>
              )
            })}
          </div>

          {/* Footer: range corrente + chiudi */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-theme-border/50">
            <span className="text-[11px] text-theme-text-muted font-mono tabular-nums">
              {from && to ? `${isoToEU(from)} → ${isoToEU(to)}` : 'Seleziona due date'}
            </span>
            <button
              type="button"
              onClick={() => { setAnchor(null); setOpen(false) }}
              className="px-3 py-1 text-xs font-medium rounded-full bg-dr7-gold text-white hover:opacity-90"
            >Applica</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
