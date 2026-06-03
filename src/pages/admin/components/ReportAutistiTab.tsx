import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import DateRangeFilter from '../../../components/DateRangeFilter'
import { USCITA_SERVICE_TYPE, bookingStatusToUscitaStato } from '../../../utils/uscitaStraordinaria'

interface VehicleLite { id: string; display_name: string; plate?: string | null }

interface UscitaRow {
  bookingId: string
  autistaId: string
  autistaName: string
  date: string | null
  vehicleLabel: string
  motivazioni: string
  fromLabel: string
  toLabel: string
  stato: string
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
}

export default function ReportAutistiTab() {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [bookings, setBookings] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<Map<string, VehicleLite>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('bookings')
        .select('id, vehicle_id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status, booking_details')
        .eq('service_type', USCITA_SERVICE_TYPE)
        .order('pickup_date', { ascending: false })
      if (range.from) q = q.gte('pickup_date', `${range.from}T00:00:00`)
      if (range.to) q = q.lte('pickup_date', `${range.to}T23:59:59`)
      const [{ data: bk }, { data: veh }] = await Promise.all([
        q,
        supabase.from('vehicles').select('id, display_name, plate'),
      ])
      setBookings(bk || [])
      const vmap = new Map<string, VehicleLite>()
      for (const v of (veh || [])) vmap.set(v.id, v)
      setVehicles(vmap)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  const vehLabel = useCallback((id: string | undefined, fallbackName?: string, fallbackPlate?: string) => {
    const v = id ? vehicles.get(id) : undefined
    const name = v?.display_name || fallbackName || ''
    const plate = v?.plate || fallbackPlate || ''
    return `${name}${plate ? ` (${plate})` : ''}`.trim() || '—'
  }, [vehicles])

  // Flatten: one row per (autista, uscita card)
  const rows = useMemo<UscitaRow[]>(() => {
    const out: UscitaRow[] = []
    for (const b of bookings) {
      const u = b.booking_details?.uscita
      if (!u) continue
      const stato = u.stato || bookingStatusToUscitaStato(b.status)
      const motivazioni = Array.isArray(u.motivazioni) ? u.motivazioni.join(', ') : ''
      const fromLabel = [u.pickup?.place, u.pickup?.address].filter(Boolean).join(' · ') || '—'
      const toLabel = [u.dropoff?.place, u.dropoff?.address].filter(Boolean).join(' · ') || '—'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snapshot: any[] = Array.isArray(u.autisti) ? u.autisti : []
      const ids: string[] = Array.isArray(u.autista_ids) ? u.autista_ids : []
      const list = ids.length ? ids : snapshot.map(s => s.id)
      if (list.length === 0) continue
      for (const aid of list) {
        const snap = snapshot.find(s => s.id === aid)
        const driveVehId = u.vehicle_to_drive?.[aid] || b.vehicle_id
        out.push({
          bookingId: b.id,
          autistaId: aid,
          autistaName: snap?.full_name || '—',
          date: b.pickup_date,
          vehicleLabel: vehLabel(driveVehId, b.vehicle_name, b.vehicle_plate),
          motivazioni,
          fromLabel,
          toLabel,
          stato,
        })
      }
    }
    return out
  }, [bookings, vehLabel])

  // Per-autista summary
  const summary = useMemo(() => {
    const m = new Map<string, { name: string; count: number; last: string | null }>()
    for (const r of rows) {
      const cur = m.get(r.autistaId) || { name: r.autistaName, count: 0, last: null }
      cur.count += 1
      if (r.date && (!cur.last || r.date > cur.last)) cur.last = r.date
      if (r.autistaName && r.autistaName !== '—') cur.name = r.autistaName
      m.set(r.autistaId, cur)
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count)
  }, [rows])

  const statoBadge = (s: string) => {
    const map: Record<string, string> = {
      'Programmata': 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
      'In Corso': 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
      'Completata': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
      'Annullata': 'bg-red-500/15 text-red-600 dark:text-red-300',
      'Da Verificare': 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300',
    }
    return map[s] || 'bg-theme-bg-tertiary text-theme-text-secondary'
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-theme-text-primary">Report Autisti</h2>
          <p className="text-sm text-theme-text-muted mt-1">Attività delle Uscite Straordinarie: chi ha movimentato quale veicolo, quando e perché.</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} compact />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-4">
          <div className="text-[11px] uppercase text-theme-text-muted">Movimenti</div>
          <div className="text-2xl font-bold text-theme-text-primary">{rows.length}</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-4">
          <div className="text-[11px] uppercase text-theme-text-muted">Uscite</div>
          <div className="text-2xl font-bold text-theme-text-primary">{new Set(rows.map(r => r.bookingId)).size}</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-4">
          <div className="text-[11px] uppercase text-theme-text-muted">Autisti attivi</div>
          <div className="text-2xl font-bold text-theme-text-primary">{summary.length}</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-4">
          <div className="text-[11px] uppercase text-theme-text-muted">Periodo</div>
          <div className="text-sm font-semibold text-theme-text-primary mt-1">{range.from || '—'} → {range.to || 'oggi'}</div>
        </div>
      </div>

      {/* Per-autista summary */}
      <div className="rounded-xl border border-theme-border overflow-hidden">
        <div className="px-4 py-2.5 bg-theme-bg-secondary/60 text-sm font-semibold text-theme-text-primary border-b border-theme-border">Riepilogo per Autista</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-theme-text-muted text-xs uppercase">
                <th className="px-4 py-2">Autista</th>
                <th className="px-4 py-2">Movimenti</th>
                <th className="px-4 py-2">Ultimo movimento</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s, i) => (
                <tr key={i} className="border-t border-theme-border/40">
                  <td className="px-4 py-2 font-medium text-theme-text-primary">{s.name}</td>
                  <td className="px-4 py-2 text-theme-text-primary">{s.count}</td>
                  <td className="px-4 py-2 text-theme-text-secondary">{fmtDate(s.last)}</td>
                </tr>
              ))}
              {summary.length === 0 && !loading && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-theme-text-muted">Nessuna attività autista nel periodo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail */}
      <div className="rounded-xl border border-theme-border overflow-hidden">
        <div className="px-4 py-2.5 bg-theme-bg-secondary/60 text-sm font-semibold text-theme-text-primary border-b border-theme-border">Dettaglio Movimenti</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-theme-text-muted text-xs uppercase">
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Autista</th>
                <th className="px-4 py-2">Veicolo guidato</th>
                <th className="px-4 py-2">Motivazione</th>
                <th className="px-4 py-2">Partenza → Destinazione</th>
                <th className="px-4 py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.bookingId}-${r.autistaId}-${i}`} className="border-t border-theme-border/40 hover:bg-theme-bg-tertiary/30">
                  <td className="px-4 py-2 whitespace-nowrap text-theme-text-secondary">{fmtDate(r.date)}</td>
                  <td className="px-4 py-2 font-medium text-theme-text-primary">{r.autistaName}</td>
                  <td className="px-4 py-2 text-theme-text-primary">{r.vehicleLabel}</td>
                  <td className="px-4 py-2 text-theme-text-secondary">{r.motivazioni || '—'}</td>
                  <td className="px-4 py-2 text-theme-text-secondary">{r.fromLabel} → {r.toLabel}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statoBadge(r.stato)}`}>{r.stato}</span></td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-theme-text-muted">Nessun movimento nel periodo selezionato.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-theme-text-muted">Caricamento…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
