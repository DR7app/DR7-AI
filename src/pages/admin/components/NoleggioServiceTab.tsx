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
          .select('id, customer_name, vehicle_name, vehicle_plate, status, payment_status, pickup_date, dropoff_date, price_total, created_at')
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
  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Prenotazioni`} action={<button onClick={reload} disabled={loading} className={BTN_PRIMARY}>{loading ? 'Caricamento…' : 'Aggiorna'}</button>} />
      {error && <ErrorBox msg={error} />}
      {!loading && bookings.length === 0 && !error && <EmptyBox msg={`Nessuna prenotazione ${labels.title.toLowerCase()} al momento.`} />}
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
                  <td className="px-3 py-2"><Badge value={b.status} /></td>
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

/* ------------------------------ CALENDARIO ------------------------------ */

function CalendarView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const { bookings, loading } = useBookings(serviceType)
  const [monthOffset, setMonthOffset] = useState(0)
  const { cells, monthLabel } = useMemo(() => buildMonth(monthOffset, bookings), [monthOffset, bookings])
  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Calendario`} action={
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthOffset(o => o - 1)} className={BTN_GHOST}>‹</button>
          <span className="text-sm text-theme-text-primary min-w-[140px] text-center capitalize">{monthLabel}</span>
          <button onClick={() => setMonthOffset(o => o + 1)} className={BTN_GHOST}>›</button>
        </div>
      } />
      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}
      <div className="grid grid-cols-7 gap-1">
        {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => <div key={d} className="text-center text-xs text-theme-text-muted py-1">{d}</div>)}
        {cells.map((c, i) => (
          <div key={i} className={`min-h-[72px] rounded-lg border p-1 ${c ? 'border-theme-border bg-theme-bg-secondary' : 'border-transparent'}`}>
            {c && (<>
              <div className="text-xs text-theme-text-muted">{c.day}</div>
              {c.items.slice(0, 3).map(b => <div key={b.id} className="mt-0.5 text-[10px] truncate px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-300" title={b.customer_name || ''}>{b.customer_name || labels.asset}</div>)}
              {c.items.length > 3 && <div className="text-[10px] text-theme-text-muted mt-0.5">+{c.items.length - 3}</div>}
            </>)}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildMonth(offset: number, bookings: BookingRow[]) {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + offset)
  const year = base.getFullYear(), month = base.getMonth()
  const monthLabel = base.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
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

  function openNew() { setEditingId(null); setForm(EMPTY_PREV); setShowForm(true) }
  function openEdit(p: PreventivoRow) {
    setEditingId(p.id)
    setForm({
      customer_name: p.customer_name || '', customer_phone: p.customer_phone || '', asset_name: p.asset_name || '',
      start_date: p.start_date ? p.start_date.substring(0, 10) : '', end_date: p.end_date ? p.end_date.substring(0, 10) : '',
      amount: centsToEur(p.amount), notes: p.notes || '', status: p.status || 'bozza',
    })
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
