// NoleggioServiceTab — tab riutilizzabile per Noleggio Mare (barche) e
// Noleggio Aria (elicottero). Stesso schema sotto-tab del Car Wash
// (Prenotazioni · Calendario · Catalogo · Preventivi) ma su un service_type
// dedicato ('boat_rental' / 'heli_rental'). Prime Wash NON e' toccato.
//
// Prenotazioni + Calendario: tabella `bookings`.
// Catalogo: tabella `noleggio_catalog`. Preventivi: tabella `noleggio_preventivi`.
import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../../../supabaseClient'

export type NoleggioServiceType = 'boat_rental' | 'heli_rental' | 'stay_rental'
export type NoleggioView = 'bookings' | 'calendar' | 'catalog' | 'preventivi'

export interface NoleggioServiceLabels {
  title: string        // "Noleggio Mare"
  asset: string        // "Barca" / "Elicottero"
  assetPlural: string  // "Barche" / "Elicotteri"
}

interface NoleggioServiceTabProps {
  serviceType: NoleggioServiceType
  view: NoleggioView
  labels: NoleggioServiceLabels
}

interface BookingRow {
  id: string
  customer_name: string | null
  customer_phone: string | null
  vehicle_name: string | null
  vehicle_plate: string | null
  status: string | null
  payment_status: string | null
  pickup_date: string | null
  dropoff_date: string | null
  price_total: number | null
  created_at: string | null
}

interface CatalogRow {
  id: string
  service_type: string
  name: string
  description: string | null
  price_per_day: number
  capacity: number | null
  image_url: string | null
  is_active: boolean
  sort_order: number
}

interface PreventivoRow {
  id: string
  service_type: string
  customer_name: string | null
  customer_phone: string | null
  asset_name: string | null
  start_date: string | null
  end_date: string | null
  amount: number
  notes: string | null
  status: string
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
  bozza: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  inviato: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  accettato: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rifiutato: 'bg-red-500/15 text-red-400 border-red-500/30',
}

const INPUT_CLS = 'px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm w-full placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold'
const BTN_PRIMARY = 'px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:bg-[#0A8FA3] transition-colors disabled:opacity-50'
const BTN_GHOST = 'px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary text-sm hover:bg-theme-bg-hover'

function eur(cents: number | null | undefined): string {
  return ((Number(cents) || 0) / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}
function eurToCents(s: string): number {
  const n = parseFloat((s || '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
function centsToEur(c: number): string {
  return ((Number(c) || 0) / 100).toFixed(2)
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
  } catch { return s }
}

export default function NoleggioServiceTab({ serviceType, view, labels }: NoleggioServiceTabProps) {
  if (view === 'bookings') return <BookingsView serviceType={serviceType} labels={labels} />
  if (view === 'calendar') return <CalendarView serviceType={serviceType} labels={labels} />
  if (view === 'catalog') return <CatalogView serviceType={serviceType} labels={labels} />
  return <PreventiviView serviceType={serviceType} labels={labels} />
}

/* ----------------------------- PRENOTAZIONI ----------------------------- */

function useBookings(serviceType: NoleggioServiceType) {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const acc: BookingRow[] = []
      for (let start = 0; ; start += 1000) {
        const { data, error: e } = await supabase
          .from('bookings')
          .select('id, customer_name, customer_phone, vehicle_name, vehicle_plate, status, payment_status, pickup_date, dropoff_date, price_total, created_at')
          .eq('service_type', serviceType)
          .order('pickup_date', { ascending: false })
          .range(start, start + 999)
        if (e) throw e
        if (!data || data.length === 0) break
        acc.push(...(data as BookingRow[]))
        if (data.length < 1000) break
      }
      setBookings(acc)
    } catch (err) { setError(err instanceof Error ? err.message : 'Errore nel caricamento') }
    finally { setLoading(false) }
  }, [serviceType])
  useEffect(() => { load() }, [load])
  return { bookings, loading, error, reload: load }
}

function BookingsView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const { bookings, loading, error, reload } = useBookings(serviceType)

  // Asset = TUTTO il catalogo di questo servizio (stessa query della tab
  // Catalogo: NESSUN filtro is_active, cosi' la select mostra ogni voce
  // inserita nel catalogo, non solo le attive).
  const [assets, setAssets] = useState<CalAsset[]>([])
  const [assetsError, setAssetsError] = useState('')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: e } = await supabase
        .from('noleggio_catalog')
        .select('id, name, image_url, is_active')
        .eq('service_type', serviceType)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (cancelled) return
      if (e) setAssetsError(missingTableHint(e.message))
      else setAssets((data || []) as CalAsset[])
    })()
    return () => { cancelled = true }
  }, [serviceType])

  // Modal create/edit (stessa logica del Calendario, accessibile dalla lista)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CalBookingForm>(EMPTY_CAL_FORM)
  const [formAsset, setFormAsset] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  function openCreate() {
    const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    setForm({ ...EMPTY_CAL_FORM, pickup_date: todayYmd, dropoff_date: todayYmd })
    setFormAsset(assets[0]?.name || '')
    setFormError('')
    setShowForm(true)
  }
  function openEdit(b: BookingRow) {
    const pk = b.pickup_date ? new Date(b.pickup_date) : null
    const dr = b.dropoff_date ? new Date(b.dropoff_date) : null
    const ymd = (d: Date | null) => d ? d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) : ''
    const hm = (d: Date | null) => d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '10:00'
    setForm({
      id: b.id,
      customer_name: b.customer_name || '',
      customer_phone: b.customer_phone || '',
      pickup_date: ymd(pk), pickup_time: hm(pk),
      dropoff_date: ymd(dr), dropoff_time: hm(dr),
      price_eur: centsToEur(b.price_total || 0),
      status: (b.status || 'confirmed'),
    })
    setFormAsset(b.vehicle_name || '')
    setFormError('')
    setShowForm(true)
  }

  function toIso(date: string, time: string): string | null {
    if (!date) return null
    const romeOffsetMin = romeOffsetMinutes(date)
    const utcMs = Date.UTC(
      Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)),
      Number((time || '00:00').slice(0, 2)), Number((time || '00:00').slice(3, 5)),
    ) - romeOffsetMin * 60_000
    return new Date(utcMs).toISOString()
  }

  async function saveBooking() {
    if (!form.customer_name.trim()) { setFormError('Il nome cliente è obbligatorio.'); return }
    setSaving(true); setFormError('')
    const payload = {
      service_type: serviceType,
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim() || null,
      vehicle_name: formAsset || null,
      pickup_date: toIso(form.pickup_date, form.pickup_time),
      dropoff_date: toIso(form.dropoff_date, form.dropoff_time),
      price_total: eurToCents(form.price_eur),
      status: form.status,
    }
    const { error: e } = form.id
      ? await supabase.from('bookings').update(payload).eq('id', form.id)
      : await supabase.from('bookings').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (e) { setFormError(e.message); return }
    setShowForm(false); reload()
  }
  async function deleteBooking() {
    if (!form.id) return
    if (!window.confirm('Eliminare questa prenotazione?')) return
    setSaving(true); setFormError('')
    const { error: e } = await supabase.from('bookings').delete().eq('id', form.id)
    setSaving(false)
    if (e) { setFormError(e.message); return }
    setShowForm(false); reload()
  }

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Prenotazioni`} action={
        <div className="flex items-center gap-2">
          <button onClick={openCreate} className={BTN_PRIMARY}>+ Nuova prenotazione</button>
          <button onClick={reload} disabled={loading} className={BTN_GHOST}>{loading ? 'Caricamento…' : 'Aggiorna'}</button>
        </div>
      } />
      {error && <ErrorBox msg={error} />}
      {!loading && bookings.length === 0 && !error && <EmptyBox msg={`Nessuna prenotazione ${labels.title.toLowerCase()} al momento. Crea la prima con "+ Nuova prenotazione".`} />}
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
                <tr key={b.id} onClick={() => openEdit(b)} className="border-t border-theme-border hover:bg-theme-bg-hover cursor-pointer">
                  <td className="px-3 py-2 text-theme-text-primary">{b.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary">{b.vehicle_name || b.vehicle_plate || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{fmtDate(b.pickup_date)}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{fmtDate(b.dropoff_date)}</td>
                  <td className="px-3 py-2"><Badge value={b.status} /></td>
                  <td className="px-3 py-2 text-right text-theme-text-primary tabular-nums">{eur(b.price_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal create/edit prenotazione */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-theme-text-primary">{form.id ? 'Modifica prenotazione' : 'Nuova prenotazione'}</h3>
            {formError && <ErrorBox msg={formError} />}
            {assetsError && <ErrorBox msg={assetsError} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">{labels.asset} <span className="text-theme-text-muted/70">({assets.length} dal catalogo)</span></label>
                <select className={INPUT_CLS} value={formAsset} onChange={e => setFormAsset(e.target.value)}>
                  {assets.length === 0 && <option value="">Nessun asset nel catalogo</option>}
                  {assets.map(a => <option key={a.id} value={a.name}>{a.name}{a.is_active ? '' : ' (non attivo)'}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Cliente</label>
                <input className={INPUT_CLS} placeholder="Nome cliente" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Telefono</label>
                <input className={INPUT_CLS} placeholder="Telefono (opzionale)" value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Ritiro</label>
                <input className={INPUT_CLS} type="date" value={form.pickup_date} onChange={e => setForm({ ...form, pickup_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Ora ritiro</label>
                <input className={INPUT_CLS} type="time" value={form.pickup_time} onChange={e => setForm({ ...form, pickup_time: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Riconsegna</label>
                <input className={INPUT_CLS} type="date" value={form.dropoff_date} onChange={e => setForm({ ...form, dropoff_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Ora riconsegna</label>
                <input className={INPUT_CLS} type="time" value={form.dropoff_time} onChange={e => setForm({ ...form, dropoff_time: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Totale (€)</label>
                <input className={INPUT_CLS} inputMode="decimal" placeholder="0,00" value={form.price_eur} onChange={e => setForm({ ...form, price_eur: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Stato</label>
                <select className={INPUT_CLS} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  {CAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                {form.id && (
                  <button onClick={deleteBooking} disabled={saving} className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10 disabled:opacity-50">Elimina</button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} disabled={saving} className={BTN_GHOST}>Annulla</button>
                <button onClick={saveBooking} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Salvataggio…' : (form.id ? 'Salva' : 'Crea')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ CALENDARIO ------------------------------ */
// Timeline per-asset (righe asset a sinistra · giorni del mese in alto · barre
// prenotazione ritiro→riconsegna), stesso formato del Calendario Noleggio Terra
// (CalendarTab.tsx). Versione "lean": niente centralina/realtime/netlify, solo
// noleggio_catalog (righe) + bookings filtrate per service_type (barre).

const CAL_CELL_W = 45 // larghezza colonna giorno
const CAL_ROW_H = 56  // altezza riga asset
const CAL_LEFT_W = 220 // larghezza colonna sinistra (asset)
const CAL_HEADER_H = 42

interface CalAsset { id: string; name: string; image_url: string | null; is_active?: boolean }

// Bucket di colore per la barra, in linea con la palette già usata nel file
// (Badge): confermato/attivo = ciano, in attesa = ambra, cancellata = rosso.
function barStyle(status: string | null, paymentStatus: string | null): { bar: string } {
  const s = (status || '').toLowerCase()
  if (s === 'cancelled' || s === 'annullata') return { bar: 'bg-red-500/70 border-red-400/50' }
  if (s === 'completed' || s === 'completata') return { bar: 'bg-zinc-500/70 border-zinc-400/50' }
  const pending = s === 'pending' || paymentStatus === 'pending' || paymentStatus === 'unpaid'
  if (pending) return { bar: 'bg-amber-500/80 border-amber-400/50' }
  // confirmed / active / confermata
  return { bar: 'bg-cyan-500/80 border-cyan-400/50' }
}

// yyyy-mm-dd in fuso Europe/Rome a partire da un timestamp ISO (UTC).
function romeYmd(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) // en-CA → YYYY-MM-DD
}
// giorno del mese (1..31) in fuso Europe/Rome.
function romeDayOfMonth(iso: string): number {
  return parseInt(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }).slice(8, 10), 10)
}

type CalBookingForm = {
  id: string | null
  customer_name: string
  customer_phone: string
  pickup_date: string // yyyy-mm-dd
  pickup_time: string // HH:MM
  dropoff_date: string
  dropoff_time: string
  price_eur: string
  status: string
}
const CAL_STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled']
const EMPTY_CAL_FORM: CalBookingForm = {
  id: null, customer_name: '', customer_phone: '',
  pickup_date: '', pickup_time: '10:00', dropoff_date: '', dropoff_time: '10:00',
  price_eur: '', status: 'confirmed',
}

function CalendarView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const { bookings, loading: bookingsLoading, reload } = useBookings(serviceType)
  const [assets, setAssets] = useState<CalAsset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [error, setError] = useState('')
  const [monthOffset, setMonthOffset] = useState(0)

  // Modal create/edit
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CalBookingForm>(EMPTY_CAL_FORM)
  const [formAsset, setFormAsset] = useState<string>('') // vehicle_name pre-compilato
  const [saving, setSaving] = useState(false)

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('noleggio_catalog')
      .select('id, name, image_url, is_active')
      .eq('service_type', serviceType)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (e) setError(missingTableHint(e.message))
    else setAssets((data || []) as CalAsset[])
    setAssetsLoading(false)
  }, [serviceType])
  useEffect(() => { loadAssets() }, [loadAssets])

  // Mese visualizzato
  const base = useMemo(() => { const b = new Date(); b.setDate(1); b.setMonth(b.getMonth() + monthOffset); return b }, [monthOffset])
  const year = base.getFullYear(), month = base.getMonth()
  const monthLabel = base.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month])
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])
  const monthYmdPrefix = `${year}-${String(month + 1).padStart(2, '0')}`

  // Match barre → riga asset per nome (case-insensitive trim). Le prenotazioni
  // senza asset corrispondente finiscono in "Altro / Non assegnato".
  const { rowsByAsset, unassigned } = useMemo(() => {
    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()
    const map = new Map<string, BookingRow[]>() // assetId → bookings
    assets.forEach(a => map.set(a.id, []))
    const nameToId = new Map<string, string>()
    assets.forEach(a => nameToId.set(norm(a.name), a.id))
    const orphans: BookingRow[] = []
    bookings.forEach(b => {
      const id = nameToId.get(norm(b.vehicle_name))
      if (id) map.get(id)!.push(b)
      else orphans.push(b)
    })
    return { rowsByAsset: map, unassigned: orphans }
  }, [assets, bookings])

  // Barre visibili nel mese per una lista di prenotazioni: clamp ai giorni del
  // mese, posiziona left/width in px sulla griglia giorni.
  const barsFor = useCallback((rows: BookingRow[]) => {
    const out: { booking: BookingRow; left: number; width: number }[] = []
    rows.forEach(b => {
      if (!b.pickup_date) return
      const pYmd = romeYmd(b.pickup_date)
      const dYmd = b.dropoff_date ? romeYmd(b.dropoff_date) : pYmd
      // overlap col mese visualizzato
      if (dYmd < `${monthYmdPrefix}-01` || pYmd > `${monthYmdPrefix}-${String(daysInMonth).padStart(2, '0')}`) return
      const startDay = pYmd.startsWith(monthYmdPrefix) ? romeDayOfMonth(b.pickup_date) : 1
      const endDay = dYmd.startsWith(monthYmdPrefix) ? romeDayOfMonth(b.dropoff_date || b.pickup_date) : daysInMonth
      const left = (startDay - 1) * CAL_CELL_W
      const width = Math.max(CAL_CELL_W, (endDay - startDay + 1) * CAL_CELL_W)
      out.push({ booking: b, left, width })
    })
    return out
  }, [monthYmdPrefix, daysInMonth])

  const today = new Date()
  const isTodayDay = (day: number) =>
    today.getDate() === day && today.getMonth() === month && today.getFullYear() === year

  // --- Modal handlers ---
  function openCreate(assetName: string, day: number) {
    const ymd = `${monthYmdPrefix}-${String(day).padStart(2, '0')}`
    const next = new Date(year, month, day + 1)
    const nextYmd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    setForm({ ...EMPTY_CAL_FORM, pickup_date: ymd, dropoff_date: nextYmd })
    setFormAsset(assetName)
    setShowForm(true)
  }
  function openEdit(b: BookingRow, assetName: string) {
    const pk = b.pickup_date ? new Date(b.pickup_date) : null
    const dr = b.dropoff_date ? new Date(b.dropoff_date) : null
    const ymd = (d: Date | null) => d ? d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) : ''
    const hm = (d: Date | null) => d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '10:00'
    setForm({
      id: b.id,
      customer_name: b.customer_name || '',
      customer_phone: b.customer_phone || '',
      pickup_date: ymd(pk), pickup_time: hm(pk),
      dropoff_date: ymd(dr), dropoff_time: hm(dr),
      price_eur: centsToEur(b.price_total || 0),
      status: (b.status || 'confirmed'),
    })
    setFormAsset(assetName)
    setShowForm(true)
  }

  // Combina data + ora (interpretate come Europe/Rome) in un ISO UTC.
  function toIso(date: string, time: string): string | null {
    if (!date) return null
    // I valori sono digitati come ora locale Rome; salviamo UTC. Costruiamo
    // la stringa con l'offset Rome corrente per quella data.
    const naive = new Date(`${date}T${time || '00:00'}:00`)
    if (Number.isNaN(naive.getTime())) return null
    // Calcola offset Rome (minuti) per la data scelta e converte in UTC.
    const romeOffsetMin = romeOffsetMinutes(date)
    const utcMs = Date.UTC(
      Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)),
      Number((time || '00:00').slice(0, 2)), Number((time || '00:00').slice(3, 5)),
    ) - romeOffsetMin * 60_000
    return new Date(utcMs).toISOString()
  }

  async function saveBooking() {
    if (!form.customer_name.trim()) { setError('Il nome cliente è obbligatorio.'); return }
    const pickupIso = toIso(form.pickup_date, form.pickup_time)
    const dropoffIso = toIso(form.dropoff_date, form.dropoff_time)
    setSaving(true); setError('')
    const payload = {
      service_type: serviceType,
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim() || null,
      vehicle_name: formAsset,
      pickup_date: pickupIso,
      dropoff_date: dropoffIso,
      price_total: eurToCents(form.price_eur),
      status: form.status,
    }
    const { error: e } = form.id
      ? await supabase.from('bookings').update(payload).eq('id', form.id)
      : await supabase.from('bookings').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (e) { setError(e.message); return }
    setShowForm(false); reload()
  }
  async function deleteBooking() {
    if (!form.id) return
    if (!window.confirm('Eliminare questa prenotazione?')) return
    setSaving(true); setError('')
    const { error: e } = await supabase.from('bookings').delete().eq('id', form.id)
    setSaving(false)
    if (e) { setError(e.message); return }
    setShowForm(false); reload()
  }

  const loading = assetsLoading || bookingsLoading
  const gridW = daysArray.length * CAL_CELL_W

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Calendario`} action={
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthOffset(o => o - 1)} className={BTN_GHOST}>‹</button>
          <span className="text-sm text-theme-text-primary min-w-[160px] text-center capitalize">{monthLabel}</span>
          <button onClick={() => setMonthOffset(o => o + 1)} className={BTN_GHOST}>›</button>
        </div>
      } />
      {error && <ErrorBox msg={error} />}
      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}

      {!loading && assets.length === 0 && !error && (
        <EmptyBox msg={`Nessun ${labels.asset.toLowerCase()} nel catalogo. Aggiungi prima gli asset nella tab Catalogo.`} />
      )}

      {assets.length > 0 && (
        <div className="border border-theme-border rounded-lg overflow-auto bg-theme-bg-primary">
          <div style={{ minWidth: CAL_LEFT_W + gridW }}>
            {/* Header giorni */}
            <div className="flex sticky top-0 z-30 bg-theme-bg-primary border-b border-theme-border" style={{ height: CAL_HEADER_H }}>
              <div
                className="sticky left-0 z-40 shrink-0 bg-theme-bg-primary border-r border-theme-border flex items-center px-3 text-xs font-semibold uppercase tracking-wider text-theme-text-muted"
                style={{ width: CAL_LEFT_W }}
              >
                {labels.asset}
              </div>
              <div className="flex">
                {daysArray.map(day => {
                  const d = new Date(year, month, day)
                  return (
                    <div
                      key={day}
                      className={`flex flex-col items-center justify-center border-r border-theme-border/60 shrink-0 ${isTodayDay(day) ? 'bg-dr7-gold/30' : ''}`}
                      style={{ width: CAL_CELL_W }}
                    >
                      <span className="text-[10px] text-theme-text-primary">{day}</span>
                      <span className="text-[8px] uppercase text-theme-text-muted">{d.toLocaleDateString('it-IT', { weekday: 'short' })}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Righe asset */}
            {assets.map(asset => (
              <CalRow
                key={asset.id}
                asset={asset}
                bars={barsFor(rowsByAsset.get(asset.id) || [])}
                daysArray={daysArray}
                year={year} month={month}
                isTodayDay={isTodayDay}
                onCellClick={(day) => openCreate(asset.name, day)}
                onBarClick={(b) => openEdit(b, asset.name)}
              />
            ))}

            {/* Riga prenotazioni non assegnate (solo se presenti) */}
            {unassigned.length > 0 && (
              <CalRow
                asset={{ id: '__unassigned__', name: 'Altro / Non assegnato', image_url: null }}
                bars={barsFor(unassigned)}
                daysArray={daysArray}
                year={year} month={month}
                isTodayDay={isTodayDay}
                onCellClick={() => { /* niente create su riga non assegnata */ }}
                onBarClick={(b) => openEdit(b, b.vehicle_name || '')}
                disableCreate
              />
            )}
          </div>
        </div>
      )}

      {/* Modal create/edit */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-theme-text-primary">{form.id ? 'Modifica prenotazione' : 'Nuova prenotazione'}</h3>
              <span className="text-sm text-theme-text-secondary">{formAsset || '—'}</span>
            </div>
            {error && <ErrorBox msg={error} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Cliente</label>
                <input className={INPUT_CLS} placeholder="Nome cliente" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Telefono</label>
                <input className={INPUT_CLS} placeholder="Telefono (opzionale)" value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Ritiro</label>
                <input className={INPUT_CLS} type="date" value={form.pickup_date} onChange={e => setForm({ ...form, pickup_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Ora ritiro</label>
                <input className={INPUT_CLS} type="time" value={form.pickup_time} onChange={e => setForm({ ...form, pickup_time: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Riconsegna</label>
                <input className={INPUT_CLS} type="date" value={form.dropoff_date} onChange={e => setForm({ ...form, dropoff_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Ora riconsegna</label>
                <input className={INPUT_CLS} type="time" value={form.dropoff_time} onChange={e => setForm({ ...form, dropoff_time: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Totale (€)</label>
                <input className={INPUT_CLS} inputMode="decimal" placeholder="0,00" value={form.price_eur} onChange={e => setForm({ ...form, price_eur: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Stato</label>
                <select className={INPUT_CLS} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  {CAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                {form.id && (
                  <button onClick={deleteBooking} disabled={saving} className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10 disabled:opacity-50">Elimina</button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} disabled={saving} className={BTN_GHOST}>Annulla</button>
                <button onClick={saveBooking} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Salvataggio…' : (form.id ? 'Salva' : 'Crea')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Offset (minuti) del fuso Europe/Rome per una data yyyy-mm-dd: +60 (CET) o
// +120 (CEST). Calcolato confrontando la stessa istante formattato in Rome vs UTC.
function romeOffsetMinutes(ymd: string): number {
  const noonUtc = new Date(`${ymd}T12:00:00Z`)
  const romeHour = parseInt(noonUtc.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }).slice(0, 2), 10)
  return (romeHour - 12) * 60
}

function CalRow({
  asset, bars, daysArray, year, month, isTodayDay, onCellClick, onBarClick, disableCreate,
}: {
  asset: CalAsset
  bars: { booking: BookingRow; left: number; width: number }[]
  daysArray: number[]
  year: number
  month: number
  isTodayDay: (day: number) => boolean
  onCellClick: (day: number) => void
  onBarClick: (b: BookingRow) => void
  disableCreate?: boolean
}) {
  return (
    <div className="flex border-b border-theme-border group relative" style={{ height: CAL_ROW_H }}>
      {/* Colonna sinistra asset */}
      <div
        className="sticky left-0 z-20 shrink-0 bg-theme-bg-primary group-hover:bg-theme-bg-secondary border-r border-theme-border flex items-center gap-2 px-3"
        style={{ width: CAL_LEFT_W }}
      >
        <div className="w-10 h-7 shrink-0 rounded bg-theme-bg-tertiary border border-theme-border overflow-hidden flex items-center justify-center">
          {asset.image_url ? (
            <img src={asset.image_url} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-theme-bg-tertiary" />
          )}
        </div>
        <span className="text-sm text-theme-text-primary truncate" title={asset.name}>{asset.name}</span>
      </div>

      {/* Griglia giorni + barre */}
      <div className="relative shrink-0" style={{ width: daysArray.length * CAL_CELL_W }}>
        {/* celle sfondo + click create */}
        <div className="flex h-full">
          {daysArray.map(day => (
            <div
              key={day}
              className={`h-full shrink-0 border-r border-theme-border/50 ${isTodayDay(day) ? 'bg-dr7-gold/15' : ''} ${disableCreate ? '' : 'hover:bg-theme-text-primary/5 cursor-pointer'}`}
              style={{ width: CAL_CELL_W }}
              onClick={disableCreate ? undefined : () => onCellClick(day)}
              title={disableCreate ? undefined : `Nuova prenotazione: ${day}/${month + 1}/${year}`}
            />
          ))}
        </div>
        {/* barre */}
        <div className="absolute inset-0 pointer-events-none">
          {bars.map(({ booking, left, width }) => {
            const st = barStyle(booking.status, booking.payment_status)
            return (
              <div
                key={booking.id}
                className={`absolute top-1/2 -translate-y-1/2 h-8 rounded border shadow-sm pointer-events-auto cursor-pointer overflow-hidden flex items-center px-2 hover:brightness-110 transition ${st.bar}`}
                style={{ left, width }}
                onClick={(e) => { e.stopPropagation(); onBarClick(booking) }}
                title={booking.customer_name || ''}
              >
                <span className="text-[10px] font-semibold text-white truncate">{booking.customer_name || '—'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------- CATALOGO ------------------------------- */

const EMPTY_CATALOG = { name: '', description: '', price_per_day: '', capacity: '', image_url: '', is_active: true }

function CatalogView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const [items, setItems] = useState<CatalogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY_CATALOG>(EMPTY_CATALOG)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  // Upload immagine come nel Catalogo Prime Wash: niente URL, solo file.
  // Stesso bucket 'catalog-images', cartella dedicata al noleggio.
  async function uploadImage(file: File) {
    if (!file.type.startsWith('image/')) { setError('Solo file immagine (PNG, JPG, WEBP).'); return }
    setUploadingImage(true); setError('')
    try {
      const ext = file.name.split('.').pop() || 'png'
      const fileName = `noleggio-${serviceType}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('catalog-images')
        .upload(`noleggio-catalog/${fileName}`, file, { cacheControl: '31536000', upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('catalog-images').getPublicUrl(`noleggio-catalog/${fileName}`)
      setForm(prev => ({ ...prev, image_url: urlData?.publicUrl || '' }))
    } catch (err: unknown) {
      setError('Errore upload immagine: ' + (err as Error).message)
    } finally {
      setUploadingImage(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('noleggio_catalog')
      .select('id, service_type, name, description, price_per_day, capacity, image_url, is_active, sort_order')
      .eq('service_type', serviceType)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (e) setError(missingTableHint(e.message))
    else setItems((data || []) as CatalogRow[])
    setLoading(false)
  }, [serviceType])
  useEffect(() => { load() }, [load])

  function openNew() { setEditingId(null); setForm(EMPTY_CATALOG); setShowForm(true) }
  function openEdit(it: CatalogRow) {
    setEditingId(it.id)
    setForm({ name: it.name, description: it.description || '', price_per_day: centsToEur(it.price_per_day), capacity: it.capacity != null ? String(it.capacity) : '', image_url: it.image_url || '', is_active: it.is_active })
    setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Il nome è obbligatorio.'); return }
    setSaving(true); setError('')
    const payload = {
      service_type: serviceType,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price_per_day: eurToCents(form.price_per_day),
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
      image_url: form.image_url.trim() || null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }
    const { error: e } = editingId
      ? await supabase.from('noleggio_catalog').update(payload).eq('id', editingId)
      : await supabase.from('noleggio_catalog').insert(payload)
    setSaving(false)
    if (e) { setError(missingTableHint(e.message)); return }
    setShowForm(false); load()
  }
  async function toggleActive(it: CatalogRow) {
    await supabase.from('noleggio_catalog').update({ is_active: !it.is_active, updated_at: new Date().toISOString() }).eq('id', it.id)
    load()
  }
  async function remove(it: CatalogRow) {
    if (!window.confirm(`Eliminare "${it.name}" dal catalogo?`)) return
    await supabase.from('noleggio_catalog').delete().eq('id', it.id)
    load()
  }

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Catalogo ${labels.assetPlural}`} action={<button onClick={openNew} className={BTN_PRIMARY}>+ Nuova {labels.asset}</button>} />
      {error && <ErrorBox msg={error} />}

      {showForm && (
        <div className="border border-theme-border rounded-lg p-4 bg-theme-bg-secondary space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={INPUT_CLS} placeholder={`Nome ${labels.asset.toLowerCase()}`} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={INPUT_CLS} placeholder="Prezzo / giorno (€)" inputMode="decimal" value={form.price_per_day} onChange={e => setForm({ ...form, price_per_day: e.target.value })} />
            <input className={INPUT_CLS} placeholder="Capienza (persone)" inputMode="numeric" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
            <div className="flex items-center gap-2">
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => { if (e.target.files?.[0]) { uploadImage(e.target.files[0]); e.target.value = '' } }} />
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage} className={BTN_GHOST}>
                {uploadingImage ? 'Caricamento…' : (form.image_url ? 'Cambia immagine' : 'Carica immagine')}
              </button>
              {form.image_url && (
                <>
                  <img src={form.image_url} alt="" className="w-10 h-10 object-cover rounded" />
                  <button type="button" onClick={() => setForm({ ...form, image_url: '' })} className="text-red-400 text-xs">Rimuovi</button>
                </>
              )}
            </div>
          </div>
          <textarea className={INPUT_CLS} placeholder="Descrizione (opzionale)" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Attivo
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Salvataggio…' : (editingId ? 'Salva modifiche' : 'Aggiungi')}</button>
            <button onClick={() => setShowForm(false)} className={BTN_GHOST}>Annulla</button>
          </div>
        </div>
      )}

      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}
      {!loading && items.length === 0 && !error && <EmptyBox msg={`Nessun elemento nel catalogo ${labels.assetPlural.toLowerCase()}.`} />}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(it => (
            <div key={it.id} className={`border rounded-lg overflow-hidden bg-theme-bg-secondary ${it.is_active ? 'border-theme-border' : 'border-theme-border opacity-60'}`}>
              {it.image_url && <img src={it.image_url} alt={it.name} className="w-full h-32 object-cover" />}
              <div className="p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-theme-text-primary">{it.name}</div>
                  <div className="text-dr7-gold font-semibold text-sm whitespace-nowrap">{eur(it.price_per_day)}/g</div>
                </div>
                {it.capacity != null && <div className="text-xs text-theme-text-muted">{it.capacity} persone</div>}
                {it.description && <div className="text-xs text-theme-text-secondary line-clamp-2">{it.description}</div>}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => openEdit(it)} className={BTN_GHOST}>Modifica</button>
                  <button onClick={() => toggleActive(it)} className={BTN_GHOST}>{it.is_active ? 'Disattiva' : 'Attiva'}</button>
                  <button onClick={() => remove(it)} className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10">Elimina</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------ PREVENTIVI ------------------------------ */

const EMPTY_PREV = { customer_name: '', customer_phone: '', asset_name: '', start_date: '', end_date: '', amount: '', notes: '', status: 'bozza' }
const PREV_STATUSES = ['bozza', 'inviato', 'accettato', 'rifiutato']

function PreventiviView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const [rows, setRows] = useState<PreventivoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY_PREV>(EMPTY_PREV)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Lead/clienti per la selezione cliente nel preventivo (tabella `customers`).
  const [leads, setLeads] = useState<{ id: string; full_name: string | null; phone: string | null; email: string | null }[]>([])
  const [leadQuery, setLeadQuery] = useState('')
  const [leadOpen, setLeadOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, full_name, phone, email')
        .order('full_name', { ascending: true })
        .limit(2000)
      if (!cancelled) setLeads((data || []) as typeof leads)
    })()
    return () => { cancelled = true }
  }, [])
  const leadMatches = useMemo(() => {
    const q = leadQuery.trim().toLowerCase()
    if (!q) return leads.slice(0, 8)
    return leads.filter(l =>
      (l.full_name || '').toLowerCase().includes(q) ||
      (l.phone || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q)
    ).slice(0, 8)
  }, [leads, leadQuery])
  function pickLead(l: { full_name: string | null; phone: string | null }) {
    setForm(f => ({ ...f, customer_name: l.full_name || f.customer_name, customer_phone: l.phone || f.customer_phone }))
    setLeadQuery(l.full_name || '')
    setLeadOpen(false)
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('noleggio_preventivi')
      .select('id, service_type, customer_name, customer_phone, asset_name, start_date, end_date, amount, notes, status, created_at')
      .eq('service_type', serviceType)
      .order('created_at', { ascending: false })
    if (e) setError(missingTableHint(e.message))
    else setRows((data || []) as PreventivoRow[])
    setLoading(false)
  }, [serviceType])
  useEffect(() => { load() }, [load])

  function openNew() { setEditingId(null); setForm(EMPTY_PREV); setLeadQuery(''); setLeadOpen(false); setShowForm(true) }
  function openEdit(p: PreventivoRow) {
    setEditingId(p.id)
    setForm({
      customer_name: p.customer_name || '', customer_phone: p.customer_phone || '', asset_name: p.asset_name || '',
      start_date: p.start_date ? p.start_date.substring(0, 10) : '', end_date: p.end_date ? p.end_date.substring(0, 10) : '',
      amount: centsToEur(p.amount), notes: p.notes || '', status: p.status || 'bozza',
    })
    setLeadQuery(p.customer_name || ''); setLeadOpen(false)
    setShowForm(true)
  }
  async function save() {
    setSaving(true); setError('')
    const payload = {
      service_type: serviceType,
      customer_name: form.customer_name.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      asset_name: form.asset_name.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      amount: eurToCents(form.amount),
      notes: form.notes.trim() || null,
      status: form.status,
      updated_at: new Date().toISOString(),
    }
    const { error: e } = editingId
      ? await supabase.from('noleggio_preventivi').update(payload).eq('id', editingId)
      : await supabase.from('noleggio_preventivi').insert(payload)
    setSaving(false)
    if (e) { setError(missingTableHint(e.message)); return }
    setShowForm(false); load()
  }
  async function remove(p: PreventivoRow) {
    if (!window.confirm('Eliminare questo preventivo?')) return
    await supabase.from('noleggio_preventivi').delete().eq('id', p.id)
    load()
  }
  function waLink(p: PreventivoRow): string {
    const phone = (p.customer_phone || '').replace(/\D/g, '')
    const msg = `Ciao ${p.customer_name || ''}, ecco il preventivo ${labels.title}: ${p.asset_name || labels.asset} — ${eur(p.amount)}.`
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Preventivi`} action={<button onClick={openNew} className={BTN_PRIMARY}>+ Nuovo preventivo</button>} />
      {error && <ErrorBox msg={error} />}

      {showForm && (
        <div className="border border-theme-border rounded-lg p-4 bg-theme-bg-secondary space-y-3">
          {/* Selezione cliente dai lead (tab Clienti). Cerca per nome/telefono/email. */}
          <div className="relative">
            <label className="text-xs text-theme-text-muted">Seleziona cliente dai Lead {leads.length > 0 && <span className="text-theme-text-muted/70">({leads.length})</span>}</label>
            <input
              className={INPUT_CLS}
              placeholder="Cerca un cliente per nome, telefono o email…"
              value={leadQuery}
              onChange={e => { setLeadQuery(e.target.value); setLeadOpen(true) }}
              onFocus={() => setLeadOpen(true)}
              onBlur={() => setTimeout(() => setLeadOpen(false), 150)}
            />
            {leadOpen && leadMatches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg">
                {leadMatches.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); pickLead(l) }}
                    className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover border-b border-theme-border last:border-0"
                  >
                    <div className="text-sm text-theme-text-primary">{l.full_name || '(senza nome)'}</div>
                    <div className="text-xs text-theme-text-muted">{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={INPUT_CLS} placeholder="Cliente" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
            <input className={INPUT_CLS} placeholder="Telefono (WhatsApp)" value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
            <input className={INPUT_CLS} placeholder={labels.asset} value={form.asset_name} onChange={e => setForm({ ...form, asset_name: e.target.value })} />
            <input className={INPUT_CLS} placeholder="Importo (€)" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            <input className={INPUT_CLS} type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            <input className={INPUT_CLS} type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
            <select className={INPUT_CLS} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              {PREV_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <textarea className={INPUT_CLS} placeholder="Note" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Salvataggio…' : (editingId ? 'Salva' : 'Crea preventivo')}</button>
            <button onClick={() => setShowForm(false)} className={BTN_GHOST}>Annulla</button>
          </div>
        </div>
      )}

      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}
      {!loading && rows.length === 0 && !error && <EmptyBox msg="Nessun preventivo." />}
      {rows.length > 0 && (
        <div className="overflow-x-auto border border-theme-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">{labels.asset}</th>
                <th className="text-left px-3 py-2 font-medium">Periodo</th>
                <th className="text-left px-3 py-2 font-medium">Stato</th>
                <th className="text-right px-3 py-2 font-medium">Importo</th>
                <th className="text-right px-3 py-2 font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="border-t border-theme-border hover:bg-theme-bg-hover">
                  <td className="px-3 py-2 text-theme-text-primary">{p.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary">{p.asset_name || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{p.start_date ? p.start_date.substring(0, 10) : '—'} → {p.end_date ? p.end_date.substring(0, 10) : '—'}</td>
                  <td className="px-3 py-2"><Badge value={p.status} /></td>
                  <td className="px-3 py-2 text-right text-theme-text-primary tabular-nums">{eur(p.amount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {p.customer_phone && <a href={waLink(p)} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline mr-3">WhatsApp</a>}
                    <button onClick={() => openEdit(p)} className="text-theme-text-secondary hover:underline mr-3">Modifica</button>
                    <button onClick={() => remove(p)} className="text-red-400 hover:underline">Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- SHARED UI ------------------------------ */

function Header({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="text-lg font-semibold text-theme-text-primary">{title}</h2>
      {action}
    </div>
  )
}
function Badge({ value }: { value: string | null }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_BADGE[(value || '').toLowerCase()] || 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'}`}>{value || '—'}</span>
}
function ErrorBox({ msg }: { msg: string }) {
  return <div className="bg-red-500/15 border border-red-500/40 text-red-300 px-4 py-3 rounded-lg text-sm">{msg}</div>
}
function EmptyBox({ msg }: { msg: string }) {
  return <div className="text-theme-text-muted text-sm py-10 text-center border border-theme-border rounded-lg">{msg}</div>
}
function missingTableHint(msg: string): string {
  if (/noleggio_catalog|noleggio_preventivi|does not exist|relation .* does not exist|schema cache/i.test(msg)) {
    return 'Tabelle non ancora create: esegui la migration Stage 2 (noleggio_catalog / noleggio_preventivi) nel SQL editor Supabase.'
  }
  return msg
}
