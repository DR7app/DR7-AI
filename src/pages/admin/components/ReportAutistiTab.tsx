import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import DateRangeFilter from '../../../components/DateRangeFilter'
import { USCITA_SERVICE_TYPE, bookingStatusToUscitaStato } from '../../../utils/uscitaStraordinaria'

interface AutistaLite { id: string; full_name: string; phone: string }

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

// Colori per stato uscita — usati sia nel donut che nei badge/legenda.
const STATO_COLOR: Record<string, string> = {
  'Programmata': '#3b82f6',
  'In Corso': '#f59e0b',
  'Completata': '#10b981',
  'Annullata': '#ef4444',
  'Da Verificare': '#d946ef',
}
const STATO_ORDER = ['Programmata', 'In Corso', 'Completata', 'Annullata', 'Da Verificare']

// ─── Widget di presentazione (stesso linguaggio del Report Operatori) ──────────
function KpiCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string
  accent?: 'gold' | 'emerald' | 'sky' | 'violet' | 'rose' | 'amber' | 'cyan' | 'lime'
}) {
  const dotColor: Record<NonNullable<typeof accent>, string> = {
    gold: 'bg-amber-400', emerald: 'bg-emerald-400', sky: 'bg-sky-400', violet: 'bg-violet-400',
    rose: 'bg-rose-400', amber: 'bg-amber-400', cyan: 'bg-cyan-400', lime: 'bg-lime-400',
  }
  const dot = dotColor[accent || 'gold']
  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{label}</span>
      </div>
      <div className="text-2xl font-bold text-theme-text-primary tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-theme-text-muted truncate mt-1">{sub}</div>}
    </div>
  )
}

function Sparkline({ values, color = '#fbbf24' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div className="h-24 flex items-center justify-center text-theme-text-muted text-xs">Dati insufficienti</div>
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 100, h = 40
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24">
      <polyline fill="none" stroke={color} strokeWidth="1.2" points={pts} />
      <polyline fill={`${color}22`} stroke="none" points={`0,${h} ${pts} ${w},${h}`} />
    </svg>
  )
}

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const size = 140, stroke = 22, radius = (size - stroke) / 2
  const circ = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(127,127,127,0.12)" strokeWidth={stroke} />
        {data.filter(d => d.value > 0).map((d, i) => {
          const frac = total > 0 ? d.value / total : 0
          const dash = circ * frac
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={d.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
            />
          )
          offset += dash
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold text-theme-text-primary">{total}</div>
        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Movimenti</div>
      </div>
    </div>
  )
}

// Lista a barre orizzontali "Top N" (stesso stile dei Top 5 del Report Operatori).
function TopBars({ items, color }: { items: { name: string; value: number }[]; color: string }) {
  if (items.length === 0) return <div className="text-[11px] text-theme-text-muted">Nessun dato</div>
  const max = Math.max(...items.map(x => x.value), 1)
  return (
    <div className="space-y-1.5">
      {items.map((t, i) => {
        const pct = Math.round((t.value / max) * 100)
        return (
          <div key={i}>
            <div className="flex justify-between text-[11px]">
              <span className="text-theme-text-primary truncate">{t.name}</span>
              <span className="text-theme-text-muted tabular-nums">{t.value}</span>
            </div>
            <div className="h-1.5 bg-theme-bg-tertiary rounded overflow-hidden mt-0.5">
              <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ReportAutistiTab() {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [bookings, setBookings] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<Map<string, VehicleLite>>(new Map())
  const [autisti, setAutisti] = useState<AutistaLite[]>([])

  // Tutti gli autisti registrati (anche senza attività nel periodo).
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/.netlify/functions/autisti', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list' }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(data.autisti)) setAutisti(data.autisti)
      } catch { /* non-blocking */ }
    })()
  }, [])

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

  // Per-autista summary — parte da TUTTI gli autisti registrati (anche con 0
  // movimenti nel periodo), poi aggancia i conteggi dei movimenti.
  const summary = useMemo(() => {
    const counts = new Map<string, { count: number; last: string | null; name: string }>()
    for (const r of rows) {
      const cur = counts.get(r.autistaId) || { count: 0, last: null, name: r.autistaName }
      cur.count += 1
      if (r.date && (!cur.last || r.date > cur.last)) cur.last = r.date
      if (r.autistaName && r.autistaName !== '—') cur.name = r.autistaName
      counts.set(r.autistaId, cur)
    }
    const base = autisti.map(a => {
      const c = counts.get(a.id)
      return { id: a.id, name: a.full_name, phone: a.phone || '', count: c?.count || 0, last: c?.last || null }
    })
    // Autisti presenti nei movimenti ma non più nella lista (es. tag rimosso).
    for (const [id, c] of counts) {
      if (!base.some(b => b.id === id)) base.push({ id, name: c.name, phone: '', count: c.count, last: c.last })
    }
    return base.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [rows, autisti])

  // ─── Dati derivati per i grafici ─────────────────────────────────────────────
  // Andamento movimenti per giorno (ordine cronologico).
  const trendValues = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      if (!r.date) continue
      const day = String(r.date).slice(0, 10)
      m.set(day, (m.get(day) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1])
  }, [rows])

  const topAutisti = useMemo(
    () => summary.filter(s => s.count > 0).slice(0, 5).map(s => ({ name: s.name, value: s.count })),
    [summary],
  )

  const topVeicoli = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      if (r.vehicleLabel && r.vehicleLabel !== '—') m.set(r.vehicleLabel, (m.get(r.vehicleLabel) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => ({ name: e[0], value: e[1] }))
  }, [rows])

  const statoDist = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.stato, (m.get(r.stato) || 0) + 1)
    const ordered = STATO_ORDER.filter(s => m.has(s)).map(s => ({ label: s, value: m.get(s) || 0, color: STATO_COLOR[s] }))
    // Stati extra non previsti (per sicurezza)
    for (const [s, v] of m) {
      if (!STATO_ORDER.includes(s)) ordered.push({ label: s, value: v, color: '#9ca3af' })
    }
    return ordered
  }, [rows])

  // KPI
  const usciteCount = useMemo(() => new Set(rows.map(r => r.bookingId)).size, [rows])
  const veicoliCount = useMemo(() => new Set(rows.filter(r => r.vehicleLabel !== '—').map(r => r.vehicleLabel)).size, [rows])
  const attiviCount = useMemo(() => summary.filter(s => s.count > 0).length, [summary])
  const statoCount = (s: string) => statoDist.find(d => d.label === s)?.value || 0
  const completate = statoCount('Completata')
  const inCorso = statoCount('In Corso')
  const programmate = statoCount('Programmata')
  const tassoCompletamento = usciteCount > 0 ? Math.round((completate / rows.length) * 100) : 0

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

  const topAutista = summary.find(s => s.count > 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-theme-text-primary">Report Autisti</h2>
          <p className="text-sm text-theme-text-muted mt-1">Attività delle Uscite Straordinarie: chi ha movimentato quale veicolo, quando e perché.</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} compact />
      </div>

      {/* LAYOUT: main + sidebar (come Report Operatori) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        {/* MAIN COLUMN */}
        <div className="space-y-4">
          {/* KPI ROW */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <KpiCard label="Movimenti" value={rows.length} accent="gold" />
            <KpiCard label="Uscite" value={usciteCount} sub="prenotazioni" accent="amber" />
            <KpiCard label="Autisti" value={autisti.length} sub={`${attiviCount} attivi`} accent="emerald" />
            <KpiCard label="Veicoli Mossi" value={veicoliCount} accent="sky" />
            <KpiCard label="Completate" value={completate} accent="lime" />
            <KpiCard label="In Corso" value={inCorso} accent="amber" />
            <KpiCard label="Programmate" value={programmate} accent="violet" />
            <KpiCard label="Completamento" value={`${tassoCompletamento}%`} accent={tassoCompletamento >= 80 ? 'emerald' : 'rose'} />
          </div>

          {/* 4 WIDGETS ROW */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
              <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Andamento Movimenti</div>
              <Sparkline values={trendValues} color="#fbbf24" />
              <div className="text-[10px] text-theme-text-muted mt-1">{range.from || '—'} → {range.to || 'oggi'}</div>
            </div>
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
              <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Top 5 Autisti per Movimenti</div>
              <TopBars items={topAutisti} color="#d4af37" />
            </div>
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
              <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Top 5 Veicoli più Movimentati</div>
              <TopBars items={topVeicoli} color="#10b981" />
            </div>
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
              <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Distribuzione per Stato</div>
              <div className="flex items-center gap-3">
                <DonutChart data={statoDist} total={rows.length} />
                <div className="flex-1 space-y-1 text-[11px]">
                  {statoDist.length === 0 && <div className="text-theme-text-muted">Nessun dato</div>}
                  {statoDist.slice(0, 6).map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.color }} />
                      <span className="text-theme-text-primary truncate">{d.label}</span>
                      <span className="ml-auto text-theme-text-muted tabular-nums">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
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
                    <th className="px-4 py-2">Telefono</th>
                    <th className="px-4 py-2">Movimenti</th>
                    <th className="px-4 py-2">Ultimo movimento</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s, i) => (
                    <tr key={i} className="border-t border-theme-border/40">
                      <td className="px-4 py-2 font-medium text-theme-text-primary">{s.name}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{s.phone || '—'}</td>
                      <td className="px-4 py-2"><span className={s.count > 0 ? 'text-theme-text-primary font-semibold' : 'text-theme-text-muted'}>{s.count}</span></td>
                      <td className="px-4 py-2 text-theme-text-secondary">{fmtDate(s.last)}</td>
                    </tr>
                  ))}
                  {summary.length === 0 && !loading && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-theme-text-muted">Nessun autista registrato. Tagga un cliente come Autista dalla scheda Clienti.</td></tr>
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

        {/* SIDEBAR */}
        <aside className="space-y-3">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Insight</div>
            <div className="space-y-2.5 text-sm">
              <div>
                <div className="text-[10px] text-theme-text-muted">Autista più attivo</div>
                <div className="text-theme-text-primary font-semibold truncate">{topAutista ? topAutista.name : '—'}</div>
                {topAutista && <div className="text-[11px] text-theme-text-muted">{topAutista.count} movimenti</div>}
              </div>
              <div className="border-t border-theme-border/50 pt-2">
                <div className="text-[10px] text-theme-text-muted">Veicolo più movimentato</div>
                <div className="text-theme-text-primary font-semibold truncate">{topVeicoli[0]?.name || '—'}</div>
                {topVeicoli[0] && <div className="text-[11px] text-theme-text-muted">{topVeicoli[0].value} uscite</div>}
              </div>
              <div className="border-t border-theme-border/50 pt-2">
                <div className="text-[10px] text-theme-text-muted">Tasso completamento</div>
                <div className={`font-semibold ${tassoCompletamento >= 80 ? 'text-emerald-500' : 'text-rose-500'}`}>{tassoCompletamento}%</div>
              </div>
            </div>
          </div>

          <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Legenda Stati</div>
            <div className="space-y-1.5 text-[11px]">
              {STATO_ORDER.map(s => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: STATO_COLOR[s] }} />
                  <span className="text-theme-text-secondary">{s}</span>
                  <span className="ml-auto text-theme-text-muted tabular-nums">{statoCount(s)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
