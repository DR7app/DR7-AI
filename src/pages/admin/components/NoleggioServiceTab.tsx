// NoleggioServiceTab — tab riutilizzabile per Noleggio Mare (barche) e
// Noleggio Aria (elicottero). Stesso schema sotto-tab del Car Wash
// (Prenotazioni · Calendario · Catalogo · Preventivi) ma su un service_type
// dedicato ('boat_rental' / 'heli_rental'). Prime Wash NON e' toccato.
//
// Stage 1: Prenotazioni + Calendario funzionano sulla tabella `bookings`.
// Stage 2: Catalogo (tabella `noleggio_catalog`) + Preventivi.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'

export type NoleggioServiceType = 'boat_rental' | 'heli_rental'
export type NoleggioView = 'bookings' | 'calendar' | 'catalog' | 'preventivi'

export interface NoleggioServiceLabels {
  /** Etichetta principale, es. "Noleggio Mare" */
  title: string
  /** Nome del bene noleggiato al singolare, es. "Barca" / "Elicottero" */
  asset: string
  /** Plurale, es. "Barche" / "Elicotteri" */
  assetPlural: string
}

interface NoleggioServiceTabProps {
  serviceType: NoleggioServiceType
  view: NoleggioView
  labels: NoleggioServiceLabels
}

interface BookingRow {
  id: string
  customer_name: string | null
  vehicle_name: string | null
  vehicle_plate: string | null
  status: string | null
  payment_status: string | null
  pickup_date: string | null
  dropoff_date: string | null
  price_total: number | null
  booking_details: Record<string, unknown> | null
  created_at: string | null
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  confermata: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  active: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  completed: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  completata: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
  annullata: 'bg-red-500/15 text-red-400 border-red-500/30',
}

function eur(cents: number | null | undefined): string {
  const v = (Number(cents) || 0) / 100
  return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
    })
  } catch { return s }
}

export default function NoleggioServiceTab({ serviceType, view, labels }: NoleggioServiceTabProps) {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Paginazione: PostgREST limita a 1000 righe per request (vedi report).
      const acc: BookingRow[] = []
      for (let start = 0; ; start += 1000) {
        const { data, error: e } = await supabase
          .from('bookings')
          .select('id, customer_name, vehicle_name, vehicle_plate, status, payment_status, pickup_date, dropoff_date, price_total, booking_details, created_at')
          .eq('service_type', serviceType)
          .order('pickup_date', { ascending: false })
          .range(start, start + 999)
        if (e) throw e
        if (!data || data.length === 0) break
        acc.push(...(data as BookingRow[]))
        if (data.length < 1000) break
      }
      setBookings(acc)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel caricamento')
    } finally {
      setLoading(false)
    }
  }, [serviceType])

  useEffect(() => { load() }, [load])

  if (view === 'bookings') {
    return <BookingsView labels={labels} bookings={bookings} loading={loading} error={error} onReload={load} />
  }
  if (view === 'calendar') {
    return <CalendarView labels={labels} bookings={bookings} loading={loading} />
  }
  if (view === 'catalog') {
    return <PlaceholderView title={`Catalogo ${labels.assetPlural}`} note="Stage 2: gestione catalogo (tabella noleggio_catalog) in arrivo." />
  }
  return <PlaceholderView title={`Preventivi ${labels.title}`} note="Stage 2: preventivi in arrivo." />
}

function BookingsView({ labels, bookings, loading, error, onReload }: {
  labels: NoleggioServiceLabels
  bookings: BookingRow[]
  loading: boolean
  error: string
  onReload: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-theme-text-primary">{labels.title} — Prenotazioni</h2>
        <button
          onClick={onReload}
          disabled={loading}
          className="px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
        >
          {loading ? 'Caricamento…' : 'Aggiorna'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {!loading && bookings.length === 0 && !error && (
        <div className="text-theme-text-muted text-sm py-10 text-center border border-theme-border rounded-lg">
          Nessuna prenotazione {labels.title.toLowerCase()} al momento.
        </div>
      )}

      {bookings.length > 0 && (
        <div className="overflow-x-auto border border-theme-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">{labels.asset}</th>
                <th className="text-left px-3 py-2 font-medium">Ritiro</th>
                <th className="text-left px-3 py-2 font-medium">Riconsegna</th>
                <th className="text-left px-3 py-2 font-medium">Stato</th>
                <th className="text-right px-3 py-2 font-medium">Totale</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <tr key={b.id} className="border-t border-theme-border hover:bg-theme-bg-hover">
                  <td className="px-3 py-2 text-theme-text-primary">{b.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary">{b.vehicle_name || b.vehicle_plate || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{fmtDate(b.pickup_date)}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{fmtDate(b.dropoff_date)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_BADGE[(b.status || '').toLowerCase()] || 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'}`}>
                      {b.status || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-theme-text-primary tabular-nums">{eur(b.price_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CalendarView({ labels, bookings, loading }: {
  labels: NoleggioServiceLabels
  bookings: BookingRow[]
  loading: boolean
}) {
  const [monthOffset, setMonthOffset] = useState(0)
  const { cells, monthLabel } = useMemo(() => buildMonth(monthOffset, bookings), [monthOffset, bookings])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-theme-text-primary">{labels.title} — Calendario</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthOffset(o => o - 1)} className="px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover">‹</button>
          <span className="text-sm text-theme-text-primary min-w-[140px] text-center capitalize">{monthLabel}</span>
          <button onClick={() => setMonthOffset(o => o + 1)} className="px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover">›</button>
        </div>
      </div>
      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}
      <div className="grid grid-cols-7 gap-1">
        {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
          <div key={d} className="text-center text-xs text-theme-text-muted py-1">{d}</div>
        ))}
        {cells.map((c, i) => (
          <div key={i} className={`min-h-[72px] rounded-lg border p-1 ${c ? 'border-theme-border bg-theme-bg-secondary' : 'border-transparent'}`}>
            {c && (
              <>
                <div className="text-xs text-theme-text-muted">{c.day}</div>
                {c.items.slice(0, 3).map(b => (
                  <div key={b.id} className="mt-0.5 text-[10px] truncate px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-300" title={b.customer_name || ''}>
                    {b.customer_name || labels.asset}
                  </div>
                ))}
                {c.items.length > 3 && <div className="text-[10px] text-theme-text-muted mt-0.5">+{c.items.length - 3}</div>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildMonth(offset: number, bookings: BookingRow[]) {
  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() + offset)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // Monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const byDay = new Map<number, BookingRow[]>()
  bookings.forEach(b => {
    if (!b.pickup_date) return
    const d = new Date(b.pickup_date)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate()
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(b)
    }
  })

  const cells: ({ day: number; items: BookingRow[] } | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, items: byDay.get(day) || [] })
  while (cells.length % 7 !== 0) cells.push(null)
  return { cells, monthLabel }
}

function PlaceholderView({ title, note }: { title: string; note: string }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-theme-text-primary">{title}</h2>
      <div className="text-theme-text-muted text-sm py-10 text-center border border-dashed border-theme-border rounded-lg">
        {note}
      </div>
    </div>
  )
}
