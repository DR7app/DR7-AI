// NoleggioServiceTab — tab riutilizzabile per Noleggio Mare (barche) e
// Noleggio Aria (elicottero). Stesso schema sotto-tab del Car Wash
// (Prenotazioni · Calendario · Catalogo · Preventivi) ma su un service_type
// dedicato ('boat_rental' / 'heli_rental'). Prime Wash NON e' toccato.
//
// Prenotazioni + Calendario: tabella `bookings`.
// Catalogo: tabella `noleggio_catalog`. Preventivi: tabella `noleggio_preventivi`.
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import toast from 'react-hot-toast'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { LeadPicker } from './LeadPicker'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { INPUT_CLS, eur, eurToCents, centsToEur } from './noleggioFormBits'
import CalendarTab from './CalendarTab'
import ReservationsTab from './ReservationsTab'
import TelefonoConPrefisso from '../../../components/TelefonoConPrefisso'
import { risorsa } from '../../../utils/basePath'

// Stati pagamento standard DR7 (come Noleggio auto / Car Wash): la label è
// quella mostrata, il value è il payment_status salvato sul booking.
const PAY_STATUS_OPTIONS = [
  { value: 'pending', label: 'Da Saldare' },
  { value: 'partial', label: 'Parziale' },
  { value: 'paid', label: 'Pagato' },
]
const isNexiPbl = (method: string) => /nexi/i.test(method)

// 2026-08-14: 'car_wash' entra qui SOLO per la vista Preventivi — Lavaggio &
// Meccanica ha le sue tab dedicate per prenotazioni, calendario e catalogo
// (CarWashBookingsTab & co.), che restano quelle. Riusare PreventiviView
// evita un secondo schermo preventivi da mantenere in parallelo.
export type NoleggioServiceType = 'boat_rental' | 'heli_rental' | 'stay_rental' | 'car_wash' | 'car_rental'

/**
 * Il Noleggio Terra non ha un `noleggio_catalog`: i suoi mezzi sono la FLOTTA
 * (`vehicles`). Le partenze Tour lo agganciano con `vehicle_id` invece di
 * `catalog_id` (migration 20260814200000). Duplicare la flotta in un secondo
 * catalogo avrebbe significato tenerne due allineati a mano.
 */
export function tourUsaFlotta(serviceType: NoleggioServiceType): boolean {
  return serviceType === 'car_rental'
}
/** Colonna della partenza che punta al mezzo, per business. */
export function tourColonnaMezzo(serviceType: NoleggioServiceType): 'vehicle_id' | 'catalog_id' {
  return tourUsaFlotta(serviceType) ? 'vehicle_id' : 'catalog_id'
}
export type NoleggioView = 'bookings' | 'calendar' | 'catalog' | 'preventivi' | 'tours'

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


interface TourDurationOpt {
  minutes: number
  price: number          // EUR (intero) per persona
  label: string
  description?: string
  best_value?: boolean
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
  tour_durations?: TourDurationOpt[]
}

interface PreventivoRow {
  id: string
  service_type: string
  customer_name: string | null
  customer_phone: string | null
  asset_name: string | null
  asset_id?: string | null
  start_date: string | null
  end_date: string | null
  start_time?: string | null
  end_time?: string | null
  is_tour?: boolean | null
  duration_label?: string | null
  duration_minutes?: number | null
  passengers?: number | null
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

const BTN_PRIMARY = 'px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:bg-[#0A8FA3] transition-colors disabled:opacity-50'
const BTN_GHOST = 'px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary text-sm hover:bg-theme-bg-hover'

export default function NoleggioServiceTab({ serviceType, view, labels }: NoleggioServiceTabProps) {
  // 2026-08-14 (roadmap #11) — Le prenotazioni del Noleggio MARE usano ora la
  // stessa tab del Noleggio Terra, non piu' una lista e un form scritti a
  // parte.
  //
  // Perche': in una sola giornata il form del Mare ha perso il prezzo al
  // salvataggio, salvato prenotazioni a 0,00 euro, messo 'confirmed' senza
  // pagamento ne' conferma, creato doppioni al doppio click e interpretato lo
  // "sconto" al contrario. Nessuno di questi difetti esisteva su Terra: erano
  // due implementazioni della stessa cosa, e la seconda non aveva ricevuto le
  // correzioni della prima. Un solo codice, un solo comportamento.
  //
  // 2026-08-24 (direzione): anche Aria e Soggiorni passano di qui. I Tour a
  // posti restano nella loro sotto-tab "Tour": le prenotazioni normali del
  // business non hanno mai avuto motivo di usare un form diverso da Terra.
  if (view === 'bookings') return <ReservationsTab serviceType={serviceType} />
  if (view === 'calendar') return <CalendarView serviceType={serviceType} labels={labels} />
  if (view === 'catalog') return <CatalogView serviceType={serviceType} labels={labels} />
  if (view === 'tours') return <ToursView serviceType={serviceType} labels={labels} />
  return <PreventiviView serviceType={serviceType} labels={labels} />
}

/* ------------------------------------------------------------------------
 * 2026-08-24 (direzione): "il formato delle Prenotazioni di NOLEGGIO TERRA
 * deve essere l'esempio per Mare e Aria". La lista scritta a parte per
 * Mare, Aria e Soggiorni (BookingsView) e' stata rimossa: era una seconda
 * implementazione della stessa cosa, e le correzioni fatte su Terra non
 * arrivavano mai qui. Adesso ogni business apre ReservationsTab, che prende
 * i mezzi dal catalogo del business (barche, elicotteri, alloggi) e mostra
 * le stesse sezioni di Terra, servizi compresi.
 * ------------------------------------------------------------------------ */

/* ------------------------------ CALENDARIO ------------------------------ */
// Timeline per-asset (righe asset a sinistra · giorni del mese in alto · barre
// prenotazione ritiro→riconsegna), stesso formato del Calendario Noleggio Terra
// (CalendarTab.tsx). Versione "lean": niente centralina/realtime/netlify, solo
// noleggio_catalog (righe) + bookings filtrate per service_type (barre).

// 2026-08-14 (roadmap #11): rimossi le costanti di layout e gli helper della
// griglia scritta apposta per Mare/Aria/Soggiorni (CAL_CELL_W, CAL_ROW_H,
// barStyle, romeYmd, romeDayOfMonth...). Il calendario ora e' CalendarTab,
// lo stesso del Noleggio Terra: tenere qui i resti avrebbe invitato a
// riscrivere la seconda versione alla prima modifica.

// Sezione calendario sola-lettura: prossime partenze tour con seat map colorata
// (riusa seatVisual). Ogni partenza = una riga, ogni posto = uno slot col nome
// cliente. Le prenotazioni si fanno dalla tab Tour.
function TourCalendarSection({ serviceType, year, month }: { serviceType: NoleggioServiceType; year: number; month: number }) {
  const [rows, setRows] = useState<{ dep: TourDeparture; assetName: string; seats: TourSeat[] }[]>([])
  const [pay, setPay] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: cats } = await supabase.from('noleggio_catalog').select('id, name').eq('service_type', serviceType)
      const catMap = new Map<string, string>((cats || []).map((c: { id: string; name: string }) => [c.id, c.name]))
      const catIds = Array.from(catMap.keys())
      if (!catIds.length) { if (!cancelled) { setRows([]); setLoading(false) } return }
      // TUTTE le prossime partenze (da oggi in poi): così i tour si vedono
      // SEMPRE, indipendentemente dal mese mostrato nella timeline.
      void year; void month
      const todayYmd = new Date().toLocaleDateString('en-CA')
      const { data: deps } = await supabase.from('noleggio_tour_departures').select('*')
        .in('catalog_id', catIds).gte('departure_date', todayYmd)
        .order('departure_date', { ascending: true }).order('departure_time', { ascending: true })
      const depList = (deps || []) as TourDeparture[]
      if (!depList.length) { if (!cancelled) { setRows([]); setLoading(false) } return }
      const { data: allSeats } = await supabase.from('noleggio_tour_seats').select('*')
        .in('departure_id', depList.map(d => d.id)).order('seat_position', { ascending: true })
      const seatList = (allSeats || []) as TourSeat[]
      const seatsByDep = new Map<string, TourSeat[]>()
      seatList.forEach(s => { const a = seatsByDep.get(s.departure_id) || []; a.push(s); seatsByDep.set(s.departure_id, a) })
      const bookingIds = Array.from(new Set(seatList.map(s => s.booking_id).filter(Boolean))) as string[]
      if (bookingIds.length) {
        const { data: bk } = await supabase.from('bookings').select('id, payment_status').in('id', bookingIds)
        if (bk && !cancelled) setPay(Object.fromEntries(bk.map((b: { id: string; payment_status: string }) => [b.id, b.payment_status])))
      }
      if (cancelled) return
      setRows(depList.map(d => ({ dep: d, assetName: catMap.get(d.catalog_id) || '', seats: seatsByDep.get(d.id) || [] })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [serviceType])

  if (loading) return <div className="text-theme-text-muted text-sm">Caricamento tour…</div>
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">Tour & Posti — prossime partenze (clicca per i dettagli)</h3>
      {rows.map(({ dep, assetName, seats }) => {
        const sold = seats.filter(s => s.status === 'sold').length
        const open = expanded === dep.id
        return (
          <div key={dep.id} className="border border-theme-border rounded-lg overflow-hidden">
            <button onClick={() => setExpanded(open ? null : dep.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-theme-bg-hover flex-wrap">
              <span className="text-theme-text-muted">{open ? '▾' : '▸'}</span>
              <span className="text-theme-text-primary font-medium">{assetName}</span>
              <span className="text-theme-text-secondary tabular-nums">{fmtYmd(dep.departure_date)} · {dep.departure_time.slice(0, 5)}</span>
              <span className="text-xs text-theme-text-muted">{sold}/{dep.total_seats} venduti</span>
            </button>
            {open && (
              <div className="px-4 pb-4 flex flex-wrap gap-2">
                {seats.map(seat => {
                  const v = seatVisual(seat, seat.booking_id ? pay[seat.booking_id] : undefined, false)
                  return (
                    <div key={seat.id} title={seat.customer_name || ''} className={`w-16 h-16 rounded-lg border text-xs flex flex-col items-center justify-center px-1 ${v.cls}`}>
                      <span className="font-semibold">{seat.seat_label}</span>
                      <span className="text-[9px] leading-tight">{v.lbl}</span>
                      {seat.customer_name && <span className="text-[8px] leading-tight truncate max-w-[56px]">{seat.customer_name.split(' ')[0]}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CalendarView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const oggi = new Date()
  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Calendario`} />
      <CalendarTab serviceType={serviceType} />
      <TourCalendarSection serviceType={serviceType} year={oggi.getFullYear()} month={oggi.getMonth()} />
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
    if (e) setError(missingTableHint(e.message, (e as { code?: string }).code))
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
    if (e) { setError(missingTableHint(e.message, (e as { code?: string }).code)); return }
    setShowForm(false); load()
  }
  async function toggleActive(it: CatalogRow) {
    // 2026-08-24: l'errore veniva ingoiato — si cliccava e non succedeva
    // niente, senza sapere perche'.
    const { error: e } = await supabase.from('noleggio_catalog')
      .update({ is_active: !it.is_active, updated_at: new Date().toISOString() }).eq('id', it.id)
    if (e) { setError(missingTableHint(e.message, (e as { code?: string }).code)); return }
    setError('')
    load()
  }
  async function remove(it: CatalogRow) {
    if (!window.confirm(`Eliminare "${it.name}" dal catalogo?`)) return
    const { error: e } = await supabase.from('noleggio_catalog').delete().eq('id', it.id)
    if (e) { setError(missingTableHint(e.message, (e as { code?: string }).code)); return }
    setError('')
    load()
  }

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Catalogo ${labels.assetPlural}`} action={<button onClick={openNew} className={BTN_PRIMARY}>+ Nuova {labels.asset}</button>} />
      {error && <ErrorBox msg={error} />}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && !uploadingImage && setShowForm(false)}>
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-theme-text-primary">{editingId ? `Modifica ${labels.asset.toLowerCase()}` : `Nuova ${labels.asset.toLowerCase()}`}</h3>
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
        </div>
      )}

      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}
      {!loading && items.length === 0 && !error && <EmptyBox msg={`Nessun elemento nel catalogo ${labels.assetPlural.toLowerCase()}.`} />}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(it => (
            <div key={it.id} className={`border rounded-lg overflow-hidden bg-theme-bg-secondary ${it.is_active ? 'border-theme-border' : 'border-theme-border opacity-60'}`}>
              {it.image_url && <img src={it.image_url} alt={it.name} className="w-full h-44 object-contain bg-theme-bg-tertiary" />}
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

// 2026-08-24: il preventivo ora ha le stesse leve di Terra — mezzo scelto dal
// CATALOGO (non piu' digitato a mano), orari, e la modalita' tour con durata e
// passeggeri. `asset_name` resta valorizzato per stampe e storico.
const EMPTY_PREV = {
  customer_name: '', customer_phone: '', asset_id: '', asset_name: '',
  start_date: '', end_date: '', start_time: '', end_time: '',
  is_tour: false, duration_label: '', duration_minutes: '', passengers: '',
  amount: '', notes: '', status: 'bozza',
}
const PREV_STATUSES = ['bozza', 'inviato', 'accettato', 'rifiutato']

function PreventiviView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const [rows, setRows] = useState<PreventivoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY_PREV>(EMPTY_PREV)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  // Catalogo del business: alimenta la tendina del mezzo. Senza, l'admin
  // doveva riscrivere a mano il nome dell'elicottero gia' presente a catalogo.
  const [catalogo, setCatalogo] = useState<CatalogRow[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('noleggio_catalog')
        .select('id, service_type, name, description, price_per_day, capacity, image_url, is_active, sort_order, tour_durations')
        .eq('service_type', serviceType)
        .eq('is_active', true)
        .order('sort_order').order('name')
      setCatalogo((data || []) as CatalogRow[])
    })()
  }, [serviceType])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('noleggio_preventivi')
      .select('id, service_type, customer_name, customer_phone, asset_name, asset_id, start_date, end_date, start_time, end_time, is_tour, duration_label, duration_minutes, passengers, amount, notes, status, created_at')
      .eq('service_type', serviceType)
      .order('created_at', { ascending: false })
    if (e) setError(missingTableHint(e.message, (e as { code?: string }).code))
    else setRows((data || []) as PreventivoRow[])
    setLoading(false)
  }, [serviceType])
  useEffect(() => { load() }, [load])

  function openNew() { setEditingId(null); setForm(EMPTY_PREV); setShowForm(true) }
  function openEdit(p: PreventivoRow) {
    setEditingId(p.id)
    setForm({
      customer_name: p.customer_name || '', customer_phone: p.customer_phone || '',
      asset_id: p.asset_id || '', asset_name: p.asset_name || '',
      start_date: p.start_date ? p.start_date.substring(0, 10) : '', end_date: p.end_date ? p.end_date.substring(0, 10) : '',
      start_time: p.start_time || '', end_time: p.end_time || '',
      is_tour: p.is_tour === true,
      duration_label: p.duration_label || '',
      duration_minutes: p.duration_minutes != null ? String(p.duration_minutes) : '',
      passengers: p.passengers != null ? String(p.passengers) : '',
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
      asset_id: form.asset_id || null,
      // Il nome resta salvato: se il mezzo viene poi tolto dal catalogo, il
      // preventivo storico continua a dire di che cosa parlava.
      asset_name: (form.asset_id
        ? (catalogo.find(c => c.id === form.asset_id)?.name || form.asset_name)
        : form.asset_name).trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      is_tour: !!form.is_tour,
      duration_label: form.duration_label.trim() || null,
      duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes),
      passengers: form.passengers === '' ? null : Number(form.passengers),
      amount: eurToCents(form.amount),
      notes: form.notes.trim() || null,
      status: form.status,
      updated_at: new Date().toISOString(),
    }
    const { error: e } = editingId
      ? await supabase.from('noleggio_preventivi').update(payload).eq('id', editingId)
      : await supabase.from('noleggio_preventivi').insert(payload)
    setSaving(false)
    if (e) { setError(missingTableHint(e.message, (e as { code?: string }).code)); return }
    setShowForm(false); load()
  }
  async function remove(p: PreventivoRow) {
    if (!window.confirm('Eliminare questo preventivo?')) return
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== p.id)) // rimozione ottimistica: sparisce subito
    const { error: e } = await supabase.from('noleggio_preventivi').delete().eq('id', p.id)
    if (e) { setRows(prev); toast.error('Eliminazione non riuscita: ' + e.message); return }
    toast.success('Preventivo eliminato')
  }

  // Stessa logica dei preventivi Noleggio Terra: Accetta / Rifiuta lo stato.
  async function setPrevStatus(p: PreventivoRow, status: string) {
    const prev = rows
    setRows(rs => rs.map(r => r.id === p.id ? { ...r, status } : r))
    const { error: e } = await supabase.from('noleggio_preventivi').update({ status, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (e) { setRows(prev); toast.error('Errore: ' + e.message); return }
    toast.success(status === 'accettato' ? 'Preventivo accettato' : status === 'rifiutato' ? 'Preventivo rifiutato' : 'Aggiornato')
  }

  // Converti in prenotazione: crea la prenotazione Mare/Aria dal preventivo
  // (cliente, asset, date, importo) con stato Da Saldare — come ConvertPreventivoModal
  // del Noleggio Terra. Poi segna il preventivo 'convertito'.
  async function convertToBooking(p: PreventivoRow) {
    if (p.status === 'convertito') { toast('Preventivo già convertito'); return }
    if (!window.confirm(`Convertire il preventivo di ${p.customer_name || 'questo cliente'} in prenotazione (Da Saldare)?`)) return
    const toIso = (d: string | null, t: string) => d ? new Date(`${d.substring(0, 10)}T${t}:00`).toISOString() : null
    // Il lavaggio e' un APPUNTAMENTO, non un noleggio a cavallo di due date:
    // CarWashBookingsTab elenca e filtra per `appointment_date`. Senza questi
    // campi la prenotazione nasce invisibile nella sua stessa tab.
    const isLavaggio = serviceType === 'car_wash'
    const inizio = toIso(p.start_date, isLavaggio ? '09:00' : '10:00')
    const campiLavaggio = isLavaggio
      ? {
          appointment_date: inizio,
          appointment_time: '09:00',
          pickup_date: inizio,
          dropoff_date: inizio,
          pickup_location: 'DR7 - Car Wash',
          dropoff_location: 'DR7 - Car Wash',
          service_name: p.asset_name || 'Lavaggio',
        }
      : {
          pickup_date: inizio,
          dropoff_date: toIso(p.end_date || p.start_date, '18:00'),
        }
    const catalogoIdPerNome = catalogo.find(c => (c.name || '').trim().toLowerCase() === (p.asset_name || '').trim().toLowerCase())?.id || null
    const payload = {
      service_type: serviceType,
      customer_name: p.customer_name || 'Cliente',
      customer_phone: p.customer_phone || null,
      guest_name: p.customer_name || 'Cliente',
      guest_phone: p.customer_phone || null,
      vehicle_name: p.asset_name || labels.asset,
      ...campiLavaggio,
      price_total: p.amount || 0,
      status: 'confirmed',
      payment_status: 'pending', // Da Saldare, come una nuova prenotazione
      // vehicle_id dal catalogo (match sul nome scelto nel preventivo): e' cio'
      // che permette al Report di attribuire l'incasso al mezzo giusto anche se
      // il nome viene poi corretto o rinominato a catalogo.
      booking_details: { from_preventivo_id: p.id, ...(catalogoIdPerNome ? { vehicle_id: catalogoIdPerNome } : {}), ...(p.notes ? { note: p.notes } : {}) },
      created_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('bookings').insert(payload).select('id').single()
    if (error) { toast.error('Conversione fallita: ' + error.message); return }
    await supabase.from('noleggio_preventivi').update({ status: 'convertito', updated_at: new Date().toISOString() }).eq('id', p.id)
    setRows(rs => rs.map(r => r.id === p.id ? { ...r, status: 'convertito' } : r))
    toast.success('Convertito in prenotazione (Da Saldare) — vai in Prenotazioni per incassare')
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
          <LeadPicker initialQuery={form.customer_name} onPick={(name, phone) => setForm(f => ({ ...f, customer_name: name || f.customer_name, customer_phone: phone || f.customer_phone }))} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={INPUT_CLS} placeholder="Cliente" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
            <TelefonoConPrefisso className={`flex-1 min-w-0 ${INPUT_CLS}`} selectClassName={`w-[104px] shrink-0 ${INPUT_CLS}`} mostraAnteprima={false}
              placeholder="Telefono (WhatsApp)" value={form.customer_phone} onChange={v => setForm({ ...form, customer_phone: v })} />
            {/* 2026-08-24: il mezzo si SCEGLIE dal catalogo. Prima era un campo
                libero e bisognava riscrivere il nome di un elicottero gia'
                inserito. Resta la voce "altro" per i casi fuori catalogo. */}
            <select
              className={INPUT_CLS}
              value={form.asset_id || (form.asset_name ? '__altro__' : '')}
              onChange={e => {
                const v = e.target.value
                if (v === '__altro__') { setForm(f => ({ ...f, asset_id: '' })); return }
                const c = catalogo.find(x => x.id === v)
                setForm(f => ({
                  ...f, asset_id: v, asset_name: c?.name || '',
                  // Il prezzo del catalogo precompila l'importo solo se vuoto:
                  // un importo gia' scritto a mano non viene sovrascritto.
                  amount: f.amount || (c?.price_per_day ? centsToEur(c.price_per_day) : ''),
                }))
              }}
            >
              <option value="">— Scegli {labels.asset.toLowerCase()} —</option>
              {catalogo.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.capacity ? ` (${c.capacity} p.)` : ''}</option>
              ))}
              <option value="__altro__">Altro (scrivi a mano)</option>
            </select>
            {!form.asset_id && (
              <input className={INPUT_CLS} placeholder={`${labels.asset} (fuori catalogo)`} value={form.asset_name} onChange={e => setForm({ ...form, asset_name: e.target.value })} />
            )}
            <input className={INPUT_CLS} placeholder="Importo (€)" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            <EuropeanDateInput className={INPUT_CLS} value={form.start_date} onChange={(__v: string) => setForm({ ...form, start_date: __v })} />
            <EuropeanDateInput className={INPUT_CLS} value={form.end_date} onChange={(__v: string) => setForm({ ...form, end_date: __v })} />
            {/* Orari, come sui preventivi Terra. */}
            <input type="time" className={INPUT_CLS} value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
            <input type="time" className={INPUT_CLS} value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
            <select className={INPUT_CLS} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              {PREV_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Tour o noleggio: cambia cosa si preventiva. */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
              <input type="checkbox" checked={form.is_tour} onChange={e => setForm({ ...form, is_tour: e.target.checked })} />
              Preventivo per un tour
            </label>
            {form.is_tour && (() => {
              const sel = catalogo.find(c => c.id === form.asset_id)
              const durate = sel?.tour_durations || []
              return (
                <div className="flex flex-wrap items-center gap-2">
                  {durate.length > 0 && (
                    <select
                      className={INPUT_CLS}
                      value={durate.some(d => d.label === form.duration_label) ? form.duration_label : '__custom__'}
                      onChange={e => {
                        if (e.target.value === '__custom__') return
                        const d = durate.find(x => x.label === e.target.value)
                        if (d) setForm(f => ({
                          ...f, duration_label: d.label, duration_minutes: String(d.minutes),
                          amount: String(d.price),
                        }))
                      }}
                    >
                      {durate.map((d, i) => <option key={i} value={d.label}>{d.label} — €{d.price}/persona</option>)}
                      <option value="__custom__">Personalizzata…</option>
                    </select>
                  )}
                  <input className={INPUT_CLS} placeholder="Durata (es. 30 MIN)" value={form.duration_label} onChange={e => setForm({ ...form, duration_label: e.target.value })} />
                  <input className={INPUT_CLS} placeholder="Minuti" inputMode="numeric" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value.replace(/[^0-9]/g, '') })} />
                  <input className={INPUT_CLS} placeholder="Passeggeri" inputMode="numeric" value={form.passengers} onChange={e => setForm({ ...form, passengers: e.target.value.replace(/[^0-9]/g, '') })} />
                </div>
              )
            })()}
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
                    {p.status !== 'convertito' && (
                      <button onClick={() => convertToBooking(p)} className="text-dr7-gold hover:underline font-semibold mr-3">Converti</button>
                    )}
                    {p.status !== 'accettato' && p.status !== 'convertito' && (
                      <button onClick={() => setPrevStatus(p, 'accettato')} className="text-emerald-400 hover:underline mr-3">Accetta</button>
                    )}
                    {p.status !== 'rifiutato' && p.status !== 'convertito' && (
                      <button onClick={() => setPrevStatus(p, 'rifiutato')} className="text-amber-400 hover:underline mr-3">Rifiuta</button>
                    )}
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

/* --------------------------------- TOUR --------------------------------- */
// Partenze (data + orario) + seat map nominale per ogni asset del catalogo.
// Tabelle: noleggio_tour_departures + noleggio_tour_seats
// (migration 20260617_helicopter_tour_departures_seats.sql).

interface TourDeparture {
  id: string
  catalog_id: string
  departure_date: string
  departure_time: string
  total_seats: number
  price_per_seat_cents: number | null
  status: string
  notes: string | null
  duration_minutes?: number | null
  duration_label?: string | null
}
interface TourSeat {
  id: string
  departure_id: string
  seat_label: string
  seat_position: number
  price_cents: number | null
  status: string
  customer_name: string | null
  customer_phone: string | null
  booking_id: string | null
}
const EMPTY_DEP_FORM = { departure_date: '', departure_time: '10:00', total_seats: '6', price_eur: '', duration_label: '', duration_minutes: '' }
function fmtYmd(ymd: string): string {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}
function tourTableHint(msg: string): string {
  if (/noleggio_tour_departures|noleggio_tour_seats|does not exist|relation .* does not exist|schema cache/i.test(msg)) {
    return 'Tabelle Tour non ancora create: esegui la migration 20260617_helicopter_tour_departures_seats.sql nel SQL editor Supabase.'
  }
  return msg
}

// Colore posto in base allo stato + pagamento del booking collegato:
// verde = libero (disponibile) · rosso = occupato (venduto, pagato o no, come
// sul sito) · giallo = in attesa (carrello) · grigio = bloccato · bianco = scelto ora.
function seatVisual(seat: TourSeat, _payStatus: string | undefined, selected: boolean): { cls: string; lbl: string } {
  if (selected) return { cls: 'border-white bg-white text-black', lbl: 'scelto' }
  if (seat.status === 'available') return { cls: 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20', lbl: 'libero' }
  if (seat.status === 'blocked') return { cls: 'border-theme-border text-theme-text-muted bg-theme-bg-tertiary line-through', lbl: 'bloccato' }
  if (seat.status === 'held') return { cls: 'border-amber-500/60 text-amber-300 bg-amber-500/20', lbl: 'in attesa' }
  // sold = ROSSO sia pagato che non pagato (come sul sito pubblico)
  return { cls: 'border-red-500/70 text-red-200 bg-red-600/30', lbl: 'occupato' }
}

// Posizioni dei posti (in % sull'immagine cabina) per modello elicottero.
// Bell 407 GX/GXP: 1 anteriore, 2-3 centrali, 4-5-6 panca posteriore.
const HELI_407_SEATS: Record<number, { x: number; y: number }> = {
  1: { x: 50, y: 24 },
  2: { x: 44, y: 41 }, 3: { x: 56, y: 41 },
  4: { x: 40, y: 49 }, 5: { x: 50, y: 49 }, 6: { x: 59, y: 49 },
}

// Colore PIENO del pallino posto sulla mappa foto (visibile sulla cabina scura).
function seatDot(seat: TourSeat, _payStatus: string | undefined, selected: boolean): string {
  if (selected) return 'bg-white text-black ring-white'
  if (seat.status === 'available') return 'bg-emerald-500/90 text-white ring-emerald-300'
  if (seat.status === 'blocked') return 'bg-zinc-600/80 text-zinc-300 ring-zinc-500 line-through'
  if (seat.status === 'held') return 'bg-amber-500 text-black ring-amber-300'
  // Occupato (venduto) = ROSSO sia pagato che non pagato (come sul sito pubblico)
  return 'bg-red-600 text-white ring-red-300'
}

// Mappa posti ELICOTTERO: foto cabina numerata con pallini cliccabili sopra
// ogni posto, colorati per stato pagamento. Stessa logica onSeatClick della griglia.
function HeliSeatMap({ seats, dep, cartDep, cartSeats, pay, onSeatClick }: {
  seats: TourSeat[]; dep: TourDeparture; cartDep: string | null; cartSeats: Set<string>;
  pay: Record<string, string>; onSeatClick: (dep: TourDeparture, seat: TourSeat) => void;
}) {
  const occupied = seats.filter(s => s.customer_name && (s.status === 'sold' || s.status === 'held'))
  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start">
      <div className="relative mx-auto w-full max-w-[240px] select-none shrink-0">
        <img src={risorsa("heli-407-seatmap.png")} alt="Mappa posti elicottero" draggable={false}
          className="w-full rounded-xl border border-theme-border" />
        {seats.map(seat => {
          const posn = HELI_407_SEATS[seat.seat_position]
          if (!posn) return null
          const selected = cartDep === dep.id && cartSeats.has(seat.id)
          const dot = seatDot(seat, seat.booking_id ? pay[seat.booking_id] : undefined, selected)
          const clickable = seat.status === 'available' || selected
          return (
            <button key={seat.id} type="button" onClick={() => onSeatClick(dep, seat)}
              title={seat.customer_name || `Posto ${seat.seat_label}`}
              style={{ left: `${posn.x}%`, top: `${posn.y}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center ring-2 shadow-lg transition ${dot} ${clickable ? 'hover:scale-110 cursor-pointer' : 'cursor-default'}`}>
              {seat.seat_label}
            </button>
          )
        })}
      </div>
      {occupied.length > 0 && (
        <div className="text-xs text-theme-text-secondary space-y-1 pt-1">
          <div className="font-semibold text-theme-text-muted uppercase tracking-wide text-[10px]">Passeggeri</div>
          {occupied.map(s => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-bold bg-theme-bg-tertiary border border-theme-border">{s.seat_label}</span>
              <span className="truncate max-w-[140px]">{s.customer_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ToursView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const [assets, setAssets] = useState<CatalogRow[]>([])
  const [assetId, setAssetId] = useState('')
  const [departures, setDepartures] = useState<TourDeparture[]>([])
  const [seats, setSeats] = useState<Record<string, TourSeat[]>>({})
  // Conteggio posti liberi per partenza, caricato subito (senza espandere).
  const [seatStats, setSeatStats] = useState<Record<string, { available: number; total: number }>>({})
  const [pay, setPay] = useState<Record<string, string>>({}) // booking_id -> payment_status
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_DEP_FORM)
  const [editingDepId, setEditingDepId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Prenotazione posti (carrello -> cliente)
  const [cartDep, setCartDep] = useState<string | null>(null)
  const [cartSeats, setCartSeats] = useState<Set<string>>(new Set())
  const [cust, setCust] = useState({ name: '', phone: '' })
  const [seatNames, setSeatNames] = useState<Record<string, string>>({}) // seatId -> nome passeggero
  const [seatPhones, setSeatPhones] = useState<Record<string, string>>({}) // seatId -> telefono passeggero (se scelto dai clienti)
  const [tourNote, setTourNote] = useState('') // note prenotazione
  const [tourPriceOverride, setTourPriceOverride] = useState('') // prezzo manuale (€): vuoto = prezzo automatico
  const [tourPayStatus, setTourPayStatus] = useState('pending') // Da Saldare
  const [tourPayMethod, setTourPayMethod] = useState('')
  const [tourConfirm, setTourConfirm] = useState(false) // Conferma Prenotazione
  const tourPaymentMethods = usePaymentMethods(serviceType)
  const [booking, setBooking] = useState(false)
  const [manageMode, setManageMode] = useState<Set<string>>(new Set()) // partenze in modalità "gestisci posti"

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Terra legge la flotta, gli altri business il loro catalogo. Le righe
      // della flotta vengono normalizzate nella forma CatalogRow, cosi' tutto
      // il resto della vista (tendina, prezzo di default, posti) non cambia.
      if (tourUsaFlotta(serviceType)) {
        const { data, error: e } = await supabase
          .from('vehicles')
          .select('id, display_name, daily_rate, status')
          .order('display_name', { ascending: true })
        if (cancelled) return
        if (e) { setError(e.message); return }
        const list = (data || []).map(v => ({
          id: v.id,
          service_type: serviceType,
          name: v.display_name,
          description: null,
          price_per_day: Math.round(Number(v.daily_rate || 0) * 100), // il catalogo tiene i centesimi
          capacity: null,
          image_url: null,
          is_active: v.status !== 'retired',
          sort_order: 0,
        })) as unknown as CatalogRow[]
        setAssets(list)
        setAssetId(prev => prev || list[0]?.id || '')
        return
      }
      const { data, error: e } = await supabase
        .from('noleggio_catalog')
        .select('id, service_type, name, description, price_per_day, capacity, image_url, is_active, sort_order, tour_durations')
        .eq('service_type', serviceType)
        .order('sort_order', { ascending: true }).order('name', { ascending: true })
      if (cancelled) return
      if (e) setError(missingTableHint(e.message, (e as { code?: string }).code))
      else {
        const list = (data || []) as CatalogRow[]
        setAssets(list)
        setAssetId(prev => prev || list[0]?.id || '')
      }
    })()
    return () => { cancelled = true }
  }, [serviceType])

  const loadDepartures = useCallback(async (id: string) => {
    if (!id) { setDepartures([]); return }
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('noleggio_tour_departures')
      .select('*').eq(tourColonnaMezzo(serviceType), id)
      .order('departure_date', { ascending: true }).order('departure_time', { ascending: true })
    if (e) setError(tourTableHint(e.message))
    else {
      const deps = (data || []) as TourDeparture[]
      setDepartures(deps)
      // Conteggio posti liberi per ogni partenza, subito (così entrando si vede
      // quanti posti restano senza dover espandere).
      const depIds = deps.map(d => d.id)
      if (depIds.length) {
        const { data: seatRows } = await supabase
          .from('noleggio_tour_seats').select('departure_id, status').in('departure_id', depIds)
        const stats: Record<string, { available: number; total: number }> = {}
        deps.forEach(d => { stats[d.id] = { available: 0, total: d.total_seats } })
          ; (seatRows || []).forEach((r: { departure_id: string; status: string }) => {
            const s = stats[r.departure_id]; if (!s) return
            if (r.status === 'available') s.available++
          })
        setSeatStats(stats)
      } else setSeatStats({})
    }
    setLoading(false)
  }, [])
  useEffect(() => { loadDepartures(assetId) }, [assetId, loadDepartures])

  async function loadSeats(depId: string) {
    const { data, error: e } = await supabase
      .from('noleggio_tour_seats').select('*').eq('departure_id', depId)
      .order('seat_position', { ascending: true })
    if (e) return
    let list = (data || []) as TourSeat[]
    // Stato pagamento dei booking collegati -> per il colore verde/rosso
    const bookingIds = Array.from(new Set(list.map(x => x.booking_id).filter(Boolean))) as string[]
    let foundIds = new Set<string>()
    if (bookingIds.length) {
      const { data: bk } = await supabase.from('bookings').select('id, payment_status').in('id', bookingIds)
      if (bk) {
        foundIds = new Set(bk.map((b: { id: string }) => b.id))
        setPay(p => ({ ...p, ...Object.fromEntries(bk.map((b: { id: string; payment_status: string }) => [b.id, b.payment_status])) }))
      }
    }
    // AUTO-HEAL: posti "venduti" il cui booking è stato eliminato (orfani) ->
    // tornano liberi automaticamente, senza SQL manuale.
    const orphanIds = list.filter(s => s.booking_id && !foundIds.has(s.booking_id)).map(s => s.id)
    if (orphanIds.length) {
      await supabase.from('noleggio_tour_seats')
        .update({ status: 'available', booking_id: null, customer_name: null, customer_phone: null })
        .in('id', orphanIds)
      list = list.map(s => orphanIds.includes(s.id) ? { ...s, status: 'available', booking_id: null, customer_name: null, customer_phone: null } : s)
    }
    setSeats(s => ({ ...s, [depId]: list }))
    setSeatStats(st => ({ ...st, [depId]: { available: list.filter(s => s.status === 'available').length, total: list.length } }))
  }
  function toggleExpand(depId: string) {
    if (expanded === depId) { setExpanded(null); return }
    setExpanded(depId)
    if (!seats[depId]) loadSeats(depId)
  }

  // Click su un posto: in modalità "gestisci" blocca/sblocca; altrimenti
  // (default) lo aggiunge/toglie dal carrello per la prenotazione.
  function onSeatClick(dep: TourDeparture, seat: TourSeat) {
    if (manageMode.has(dep.id)) {
      if (seat.status === 'sold' || seat.status === 'held') return
      cycleSeat(seat)
      return
    }
    if (seat.status !== 'available') return
    if (cartDep !== dep.id) { setCartDep(dep.id); setCartSeats(new Set([seat.id])); return }
    setCartSeats(prev => { const n = new Set(prev); if (n.has(seat.id)) n.delete(seat.id); else n.add(seat.id); return n })
  }

  function clearCart() { setCartDep(null); setCartSeats(new Set()); setCust({ name: '', phone: '' }); setSeatNames({}); setSeatPhones({}); setTourNote(''); setTourPriceOverride(''); setTourPayStatus('pending'); setTourPayMethod(''); setTourConfirm(false) }

  // Crea la prenotazione dai posti nel carrello e li assegna al cliente.
  // booking confirmed + payment_status pending => posti ROSSI (non pagati).
  async function createTourBooking(dep: TourDeparture) {
    const ids = Array.from(cartSeats)
    if (!ids.length) return
    if (!cust.name.trim() || !cust.phone.trim()) { setError('Inserisci nome e telefono del cliente.'); return }
    const chosen = (seats[dep.id] || []).filter(s => cartSeats.has(s.id))
    const priceOf = (s: TourSeat) => s.price_cents != null ? s.price_cents : (dep.price_per_seat_cents != null ? dep.price_per_seat_cents : (selectedAsset?.price_per_day || 0))
    // Prezzo manuale: se l'operatore ha scritto un importo, quello è il TOTALE
    // della prenotazione (override completo). Vuoto = totale automatico.
    const autoTotalCents = chosen.reduce((t, s) => t + priceOf(s), 0)
    const totalCents = tourPriceOverride.trim() ? eurToCents(tourPriceOverride) : autoTotalCents
    const pickupISO = new Date(`${dep.departure_date}T${dep.departure_time}`).toISOString()
    const labelsStr = chosen.map(s => s.seat_label).join(', ')
    setBooking(true); setError('')
    const passengersDetail = chosen.map(s => ({ seat: s.seat_label, name: (seatNames[s.id] || '').trim() || cust.name.trim(), phone: (seatPhones[s.id] || '').trim() || undefined }))
    const passengersLabel = passengersDetail.map(p => `Posto ${p.seat}: ${p.name}`).join('\n')
    const { data: bk, error: be } = await supabase.from('bookings').insert({
      service_type: serviceType,
      vehicle_name: selectedAsset?.name || labels.title,
      pickup_date: pickupISO, dropoff_date: pickupISO,
      price_total: totalCents,
      // Stato come Noleggio/Car Wash: Da Saldare senza Conferma -> 'pending'
      // (va in "In attesa di pagamento"); Pagato o Conferma spuntata -> 'confirmed'.
      status: (tourPayStatus === 'pending' && !tourConfirm) ? 'pending' : 'confirmed',
      payment_status: tourPayStatus, payment_method: tourPayMethod || null,
      customer_name: cust.name.trim(), customer_phone: cust.phone.trim(),
      // Soddisfa il check bookings_user_or_guest_check (serve user_id OPPURE
      // guest_name). Il cliente arriva dai Lead, non da un account: usiamo i
      // campi guest come fa il Car Wash.
      guest_name: cust.name.trim(), guest_phone: cust.phone.trim() || null,
      // manually_confirmed NON è una colonna di bookings: va in booking_details (come ReservationsTab).
      // vehicle_id = id del mezzo a catalogo: e' l'aggancio che il Report usa
      // per attribuire l'incasso. Senza, resta solo il nome esatto (vedi sopra).
      booking_details: { tour_departure_id: dep.id, ...(selectedAsset?.id ? { vehicle_id: selectedAsset.id } : {}), seats: labelsStr, seat_count: chosen.length, passengers: passengersDetail, note: tourNote.trim() || null, manually_confirmed: tourConfirm, ...(tourConfirm ? { manually_confirmed_at: new Date().toISOString() } : {}) },
      created_at: new Date().toISOString(),
    }).select('id').single()
    if (be || !bk) { setBooking(false); setError('Errore prenotazione: ' + (be?.message || '')); return }
    const bookingId = (bk as { id: string }).id
    // Aggiorna ogni posto col proprio nome passeggero (fallback al contatto).
    for (const s of chosen) {
      await supabase.from('noleggio_tour_seats')
        .update({ status: 'sold', booking_id: bookingId, customer_name: (seatNames[s.id] || '').trim() || cust.name.trim(), customer_phone: cust.phone.trim() })
        .eq('id', s.id)
    }

    // Pay by Link Nexi — STESSO flusso di Noleggio auto / Car Wash:
    // nexi-pay-by-link -> salva il link in booking_details -> WhatsApp
    // 'payment_link_customer'. payment_status resta 'pending' (posto ROSSO);
    // al pagamento il callback Nexi lo porta a paid -> posto VERDE.
    const amountEuros = totalCents / 100
    const phone = cust.phone.trim()
    const firstName = cust.name.trim().split(' ')[0] || 'Cliente'
    // Link di pagamento SOLO se metodo Nexi - Pay by Link e Da Saldare (come ovunque).
    if (isNexiPbl(tourPayMethod) && tourPayStatus === 'pending') {
      try {
        const description = `Tour DR7 ${selectedAsset?.name || ''} - ${labelsStr} (${fmtYmd(dep.departure_date)} ${dep.departure_time.slice(0, 5)})`
        const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId, amount: amountEuros, customerEmail: '', customerName: cust.name.trim() || 'Cliente', description, expirationHours: 1 }),
        })
        const linkData = await linkRes.json()
        if (linkRes.ok && linkData.paymentUrl) {
          await supabase.from('bookings').update({
            booking_details: {
              tour_departure_id: dep.id, seats: labelsStr, seat_count: chosen.length, passengers: passengersDetail,
              nexi_payment_link: linkData.paymentUrl,
              nexi_order_id: linkData.orderId || null,
              payment_link_created_at: new Date().toISOString(),
              payment_link_expires_at: linkData.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          }).eq('id', bookingId)
          if (phone) {
            const amountStr = amountEuros.toFixed(2)
            const bookingRef = (bookingId || '').substring(0, 8).toUpperCase()
            const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: phone,
                templateKey: 'payment_link_customer',
                booking: { service_type: 'rental' },
                templateVars: {
                  customer_name: firstName, nome: firstName,
                  amount: amountStr, total: amountStr, importo: amountStr, totale: amountStr,
                  link: linkData.paymentUrl, payment_link: linkData.paymentUrl,
                  booking_id: bookingRef, booking_ref: bookingRef, expiry: '1 ora',
                },
                skipHeader: true,
              }),
            })
            const waJson = await waResp.json().catch(() => ({}))
            if (!waResp.ok || waJson?.skipped) {
              setError(`Link generato ma WhatsApp non inviato: ${waJson?.error || waJson?.reason || 'template "Richiesta Pagamento" non configurato/abilitato in Messaggi di Sistema Pro'}. Link: ${linkData.paymentUrl}`)
            }
          }
          toast.success('Prenotazione creata e link di pagamento inviato al cliente!')
        } else {
          setError('Errore generazione link pagamento Nexi: ' + (linkData.error || JSON.stringify(linkData)))
          toast.error('Errore link pagamento')
        }
      } catch (linkErr) {
        setError('Errore Pay by Link: ' + (linkErr as Error).message)
      }
    } else {
      toast.success('Prenotazione creata!')
    }

    // Conferma prenotazione tour: come Noleggio/Car Wash — parte se Pagato
    // OPPURE se l'admin ha spuntato "Conferma Prenotazione" (anche Da Saldare).
    // Body editabile in Messaggi di Sistema Pro (evento tour_new_customer ->
    // template pro_conferma_tour). Solo se NON è Nexi Pay by Link pending
    // (in quel caso parte già il link).
    const isPaid = ['paid', 'completed', 'succeeded'].includes(tourPayStatus)
    const sentNexiLink = isNexiPbl(tourPayMethod) && tourPayStatus === 'pending'
    void firstName
    if ((isPaid || tourConfirm) && !sentNexiLink) {
      const ref = (bookingId || '').substring(0, 8).toUpperCase()
      const paymentInfo = isPaid ? 'Pagato' : 'Da saldare'
      // Destinatari conferma: il contatto + OGNI passeggero che ha un telefono
      // (scelto dai clienti). Dedup per cifre, così ogni cliente riceve la sua conferma.
      const recips: { phone: string; name: string }[] = []
      const seen = new Set<string>()
      const addRecip = (ph: string, nm: string) => {
        const digits = (ph || '').replace(/\D/g, '')
        if (digits.length < 6 || seen.has(digits)) return
        seen.add(digits); recips.push({ phone: ph, name: nm })
      }
      addRecip(phone, cust.name.trim())
      passengersDetail.forEach(p => { if (p.phone) addRecip(p.phone, p.name) })
      for (const r of recips) {
        const rFirst = (r.name || '').split(' ')[0] || 'Cliente'
        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: r.phone,
            templateKey: 'tour_new_customer',
            booking: { service_type: serviceType },
            templateVars: {
              nome: rFirst, customer_name: r.name,
              esperienza: selectedAsset?.name || labels.title, servizio: selectedAsset?.name || labels.title, service_name: selectedAsset?.name || labels.title,
              data: fmtYmd(dep.departure_date), date: fmtYmd(dep.departure_date),
              orario: dep.departure_time.slice(0, 5), ora: dep.departure_time.slice(0, 5), time: dep.departure_time.slice(0, 5),
              posti: String(chosen.length), seat_count: String(chosen.length), posti_prenotati: String(chosen.length),
              passeggeri: passengersLabel, passengers: passengersLabel,
              total: amountEuros.toFixed(2), totale: amountEuros.toFixed(2), importo: amountEuros.toFixed(2), amount: amountEuros.toFixed(2),
              payment_info: paymentInfo, pagamento: paymentInfo,
              booking_id: ref, booking_ref: ref, id: ref,
              note: tourNote.trim(),
            },
            skipHeader: true,
          }),
        }).catch(() => { /* best effort */ })
      }
    }

    // 2026-08: gate auto-fattura per metodo = SOLO server (Centralina Pro >
    // Fiscale). Su 'Pagato' chiamiamo sempre; il server salta wallet e metodi
    // con auto_invoice=false. Niente pre-check locale (divergeva).
    if (isPaid && tourPayMethod) {
      await fetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      }).catch(() => { /* best effort */ })
    }

    setBooking(false); clearCart()
    loadSeats(dep.id)
  }

  function openNewDeparture() {
    setEditingDepId(null); setForm(EMPTY_DEP_FORM); setError(''); setShowForm(true)
  }
  function openEditDeparture(dep: TourDeparture) {
    setEditingDepId(dep.id)
    setForm({
      departure_date: dep.departure_date,
      departure_time: (dep.departure_time || '10:00').slice(0, 5),
      total_seats: String(dep.total_seats),
      price_eur: dep.price_per_seat_cents != null ? centsToEur(dep.price_per_seat_cents) : '',
      duration_label: dep.duration_label || '',
      duration_minutes: dep.duration_minutes != null ? String(dep.duration_minutes) : '',
    })
    setError(''); setShowForm(true)
  }

  async function createDeparture() {
    if (!assetId) { setError('Seleziona prima un asset dal catalogo.'); return }
    if (!form.departure_date) { setError('Inserisci la data della partenza.'); return }
    const total = Math.max(1, parseInt(form.total_seats, 10) || 1)
    setSaving(true); setError('')

    if (editingDepId) {
      // MODIFICA: aggiorna i campi; se aumentano i posti aggiunge gli slot
      // mancanti, se diminuiscono NON tocca i posti esistenti (evita di
      // cancellare posti venduti). I posti già presenti restano invariati.
      const { error: ue } = await supabase.from('noleggio_tour_departures').update({
        departure_date: form.departure_date,
        departure_time: form.departure_time || '10:00',
        total_seats: total,
        price_per_seat_cents: form.price_eur ? eurToCents(form.price_eur) : null,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes, 10) : null,
        duration_label: form.duration_label || null,
      }).eq('id', editingDepId)
      if (ue) { setSaving(false); setError(tourTableHint(ue.message)); return }
      const existing = (seats[editingDepId] || [])
      const existingCount = existing.length || (await supabase.from('noleggio_tour_seats').select('id', { count: 'exact', head: true }).eq('departure_id', editingDepId)).count || 0
      if (total > existingCount) {
        const add = Array.from({ length: total - existingCount }, (_, i) => ({ departure_id: editingDepId, seat_label: String(existingCount + i + 1), seat_position: existingCount + i + 1 }))
        await supabase.from('noleggio_tour_seats').insert(add)
      }
      setSaving(false); setShowForm(false); setForm(EMPTY_DEP_FORM); setEditingDepId(null)
      setSeats(s => { const n = { ...s }; delete n[editingDepId]; return n })
      loadDepartures(assetId)
      return
    }

    const { data, error: e } = await supabase.from('noleggio_tour_departures').insert({
      [tourColonnaMezzo(serviceType)]: assetId,
      departure_date: form.departure_date,
      departure_time: form.departure_time || '10:00',
      total_seats: total,
      price_per_seat_cents: form.price_eur ? eurToCents(form.price_eur) : null,
      duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes, 10) : null,
      duration_label: form.duration_label || null,
      status: 'scheduled',
    }).select('id').single()
    if (e || !data) { setSaving(false); setError(tourTableHint(e?.message || 'Errore creazione partenza')); return }
    const depId = (data as { id: string }).id
    const rows = Array.from({ length: total }, (_, i) => ({ departure_id: depId, seat_label: String(i + 1), seat_position: i + 1 }))
    await supabase.from('noleggio_tour_seats').insert(rows)
    setSaving(false); setShowForm(false); setForm(EMPTY_DEP_FORM)
    loadDepartures(assetId)
  }

  async function deleteDeparture(dep: TourDeparture) {
    if (!window.confirm(`Eliminare la partenza del ${fmtYmd(dep.departure_date)} alle ${dep.departure_time.slice(0, 5)}? I posti collegati verranno rimossi.`)) return
    const { error: e } = await supabase.from('noleggio_tour_departures').delete().eq('id', dep.id)
    if (e) { setError(e.message); return }
    loadDepartures(assetId)
  }

  async function cycleSeat(seat: TourSeat) {
    if (seat.status === 'sold' || seat.status === 'held') return
    const next = seat.status === 'blocked' ? 'available' : 'blocked'
    const { error: e } = await supabase.from('noleggio_tour_seats').update({ status: next }).eq('id', seat.id)
    if (!e) setSeats(s => ({ ...s, [seat.departure_id]: (s[seat.departure_id] || []).map(x => x.id === seat.id ? { ...x, status: next } : x) }))
  }

  // Posti ancora liberi (prenotabili). Usa i posti già caricati se la partenza
  // è stata espansa, altrimenti il conteggio bulk caricato all'ingresso.
  function seatFree(dep: TourDeparture): number | null {
    const list = seats[dep.id]
    if (list) return list.filter(s => s.status === 'available').length
    const st = seatStats[dep.id]
    return st ? st.available : null
  }
  function seatSummary(dep: TourDeparture): string {
    const free = seatFree(dep)
    if (free == null) return `${dep.total_seats} posti`
    return `${free}/${dep.total_seats} liberi`
  }

  const selectedAsset = assets.find(a => a.id === assetId)

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Tour & Posti`} action={
        <button onClick={openNewDeparture} disabled={!assetId} className={BTN_PRIMARY}>+ Nuova partenza</button>
      } />
      {error && <ErrorBox msg={error} />}

      {assets.length === 0 && !error && (
        <EmptyBox msg={`Nessun ${labels.asset.toLowerCase()} nel catalogo. Aggiungi prima un ${labels.asset.toLowerCase()} nella tab Catalogo: sarà il tour da programmare.`} />
      )}

      {assets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-theme-text-muted">{labels.asset}:</span>
          <select className={INPUT_CLS + ' max-w-xs'} value={assetId} onChange={e => setAssetId(e.target.value)}>
            {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {loading && <div className="text-theme-text-muted text-sm">Caricamento…</div>}

      {!loading && assetId && departures.length === 0 && !error && (
        <EmptyBox msg={`Nessuna partenza per ${selectedAsset?.name || 'questo tour'}. Crea la prima con "+ Nuova partenza".`} />
      )}

      {departures.length > 0 && (
        <div className="space-y-2">
          {departures.map(dep => (
            <div key={dep.id} className="border border-theme-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-theme-bg-tertiary">
                <button onClick={() => toggleExpand(dep.id)} className="flex items-center gap-3 text-left flex-1 flex-wrap">
                  <span className="text-theme-text-muted">{expanded === dep.id ? '▾' : '▸'}</span>
                  <span className="text-theme-text-primary font-medium tabular-nums">{fmtYmd(dep.departure_date)}</span>
                  <span className="text-theme-text-secondary tabular-nums">{dep.departure_time.slice(0, 5)}</span>
                  {dep.duration_label && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-theme-border bg-theme-bg-hover text-theme-text-secondary">{dep.duration_label}</span>
                  )}
                  {(() => {
                    const free = seatFree(dep)
                    const cls = free == null ? 'bg-theme-bg-hover text-theme-text-muted border-theme-border'
                      : free === 0 ? 'bg-red-600/20 text-red-300 border-red-500/40'
                        : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                    return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{free === 0 ? 'Esaurito' : seatSummary(dep)}</span>
                  })()}
                  {dep.price_per_seat_cents != null && <span className="text-xs text-theme-text-muted">· {eur(dep.price_per_seat_cents)}/posto</span>}
                </button>
                <button onClick={() => openEditDeparture(dep)} className="text-theme-text-secondary text-xs hover:underline">Modifica</button>
                <button onClick={() => deleteDeparture(dep)} className="text-red-400 text-xs hover:underline">Elimina</button>
              </div>
              {expanded === dep.id && (
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <div className="flex items-center gap-3 text-[11px] text-theme-text-muted flex-wrap">
                      <span><span className="inline-block w-3 h-3 rounded-sm border border-emerald-500/50 bg-emerald-500/10 align-middle" /> libero</span>
                      <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-500/60 align-middle" /> in attesa</span>
                      <span><span className="inline-block w-3 h-3 rounded-sm bg-red-600 align-middle" /> occupato</span>
                      <span><span className="inline-block w-3 h-3 rounded-sm bg-theme-bg-tertiary border border-theme-border align-middle" /> bloccato</span>
                    </div>
                    <button
                      onClick={() => setManageMode(m => { const n = new Set(m); if (n.has(dep.id)) n.delete(dep.id); else n.add(dep.id); return n })}
                      className={`text-xs px-2 py-1 rounded ${manageMode.has(dep.id) ? 'bg-dr7-gold text-black font-semibold' : 'border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                      {manageMode.has(dep.id) ? 'Esci da gestione posti' : 'Gestisci posti (blocca)'}
                    </button>
                  </div>

                  {!seats[dep.id] && <div className="text-theme-text-muted text-sm">Caricamento posti…</div>}
                  {seats[dep.id] && serviceType === 'heli_rental' && (
                    <HeliSeatMap seats={seats[dep.id]} dep={dep} cartDep={cartDep} cartSeats={cartSeats} pay={pay} onSeatClick={onSeatClick} />
                  )}
                  {seats[dep.id] && serviceType !== 'heli_rental' && (
                    <div className="flex flex-wrap gap-2">
                      {seats[dep.id].map(seat => {
                        const selected = cartDep === dep.id && cartSeats.has(seat.id)
                        const v = seatVisual(seat, seat.booking_id ? pay[seat.booking_id] : undefined, selected)
                        return (
                          <button key={seat.id} onClick={() => onSeatClick(dep, seat)} title={seat.customer_name || ''}
                            className={`w-16 h-16 rounded-lg border text-xs flex flex-col items-center justify-center px-1 ${v.cls}`}>
                            <span className="font-semibold">{seat.seat_label}</span>
                            <span className="text-[9px] leading-tight">{v.lbl}</span>
                            {seat.customer_name && <span className="text-[8px] leading-tight truncate max-w-[56px]">{seat.customer_name.split(' ')[0]}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Carrello -> assegna cliente */}
                  {cartDep === dep.id && cartSeats.size > 0 && !manageMode.has(dep.id) && (() => {
                    // Totale calcolato AUTOMATICAMENTE: posti selezionati × prezzo posto
                    // (override posto -> prezzo partenza -> prezzo catalogo).
                    const cartAutoTotalCents = (seats[dep.id] || []).filter(s => cartSeats.has(s.id))
                      .reduce((t, s) => t + (s.price_cents != null ? s.price_cents : (dep.price_per_seat_cents != null ? dep.price_per_seat_cents : (selectedAsset?.price_per_day || 0))), 0)
                    // Prezzo manuale: se compilato, sostituisce il totale automatico.
                    const hasOverride = tourPriceOverride.trim() !== ''
                    const cartTotalCents = hasOverride ? eurToCents(tourPriceOverride) : cartAutoTotalCents
                    return (
                    <div className="mt-4 border border-dr7-gold/40 rounded-lg p-3 space-y-3 bg-theme-bg-tertiary/50">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-sm text-theme-text-primary font-medium">{cartSeats.size} posto/i nel carrello — assegna un cliente</div>
                        <div className="text-right">
                          <div className="text-[11px] text-theme-text-muted">{hasOverride ? 'Totale (prezzo manuale)' : `Totale (${cartSeats.size} × prezzo posto)`}</div>
                          <div className="text-lg font-bold text-theme-text-primary">{eur(cartTotalCents)}</div>
                        </div>
                      </div>
                      {/* Prezzo personalizzato: l'operatore può imporre il totale che vuole. */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                        <div>
                          <label className="text-xs text-theme-text-muted">Prezzo personalizzato (€) — totale prenotazione</label>
                          <input
                            className={INPUT_CLS}
                            inputMode="decimal"
                            placeholder={`Auto: ${eur(cartAutoTotalCents)} — lascia vuoto per il prezzo automatico`}
                            value={tourPriceOverride}
                            onChange={e => setTourPriceOverride(e.target.value)}
                          />
                        </div>
                        {hasOverride && (
                          <button type="button" onClick={() => setTourPriceOverride('')} className={BTN_GHOST + ' justify-self-start'}>
                            Ripristina prezzo automatico ({eur(cartAutoTotalCents)})
                          </button>
                        )}
                      </div>
                      <LeadPicker onPick={(name, phone) => setCust({ name: name || cust.name, phone: phone || cust.phone })} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className={INPUT_CLS} placeholder="Nome cliente (contatto)" value={cust.name} onChange={e => setCust({ ...cust, name: e.target.value })} />
                        <TelefonoConPrefisso className={`flex-1 min-w-0 ${INPUT_CLS}`} selectClassName={`w-[104px] shrink-0 ${INPUT_CLS}`} mostraAnteprima={false}
                          placeholder="Telefono" value={cust.phone} onChange={v => setCust({ ...cust, phone: v })} />
                      </div>
                      {/* Nome del passeggero per OGNI posto (sempre visibile).
                          Vuoto = usa il nome del contatto qui sopra. */}
                      <div className="space-y-2">
                        <div className="text-xs text-theme-text-muted">Passeggero per ogni posto — nome + telefono (così ognuno riceve la conferma)</div>
                        {(seats[dep.id] || []).filter(s => cartSeats.has(s.id)).map(s => (
                          <div key={s.id} className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
                            <span className="text-xs text-theme-text-muted w-16 shrink-0 pt-2">Posto {s.seat_label}</span>
                            <div className="flex-1 min-w-[160px]">
                              <LeadPicker
                                label=""
                                placeholder={`Posto ${s.seat_label}: scegli un cliente o scrivi il nome`}
                                initialQuery={seatNames[s.id] || ''}
                                onQueryChange={q => setSeatNames(m => ({ ...m, [s.id]: q }))}
                                onPick={(name, phone) => { setSeatNames(m => ({ ...m, [s.id]: name })); setSeatPhones(m => ({ ...m, [s.id]: phone || '' })) }}
                              />
                            </div>
                            <div className="w-full sm:max-w-[250px]">
                              <TelefonoConPrefisso
                                className={`flex-1 min-w-0 ${INPUT_CLS}`}
                                selectClassName={`w-[96px] shrink-0 ${INPUT_CLS}`}
                                mostraAnteprima={false}
                                placeholder="Telefono passeggero"
                                value={seatPhones[s.id] || ''}
                                onChange={v => setSeatPhones(m => ({ ...m, [s.id]: v }))}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="text-xs text-theme-text-muted">Note (opzionale)</label>
                        <textarea className={INPUT_CLS} rows={2} placeholder="Note sulla prenotazione…" value={tourNote} onChange={e => setTourNote(e.target.value)} />
                      </div>
                      {/* Pagamento — come ovunque (Centralina Pro) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-theme-text-muted">Stato Pagamento</label>
                          <select className={INPUT_CLS} value={tourPayStatus} onChange={e => setTourPayStatus(e.target.value)}>
                            {PAY_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-theme-text-muted">Metodo di Pagamento</label>
                          <select className={INPUT_CLS} value={tourPayMethod} onChange={e => setTourPayMethod(e.target.value)}>
                            <option value="">— seleziona —</option>
                            {tourPaymentMethods.filter(m => m.is_enabled !== false).map(m => <option key={m.key || m.label} value={m.label}>{m.label}</option>)}
                          </select>
                        </div>
                      </div>
                      {isNexiPbl(tourPayMethod) && tourPayStatus === 'pending' && <p className="text-[11px] text-theme-text-muted">Verrà generato e inviato il link di pagamento Nexi al cliente.</p>}
                      <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
                        <input type="checkbox" checked={tourConfirm} onChange={e => setTourConfirm(e.target.checked)} />
                        Conferma Prenotazione (invia messaggio di conferma al cliente)
                      </label>
                      {error && <ErrorBox msg={error} />}
                      <div className="flex justify-end gap-2">
                        <button onClick={clearCart} disabled={booking} className={BTN_GHOST}>Svuota</button>
                        <button onClick={() => createTourBooking(dep)} disabled={booking} className={BTN_PRIMARY}>{booking ? 'Creazione…' : 'Crea prenotazione'}</button>
                      </div>
                    </div>
                    )
                  })()}

                  <p className="mt-3 text-[11px] text-theme-text-muted">
                    {manageMode.has(dep.id)
                      ? 'Modalità gestione: clic su un posto libero per bloccarlo (o sbloccarlo).'
                      : 'Clic sui posti liberi (verdi) per metterli nel carrello, poi assegna il cliente. Il cliente riceverà il link di pagamento (posto rosso = occupato).'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-theme-text-primary">{editingDepId ? 'Modifica partenza' : 'Nuova partenza'} — {selectedAsset?.name || ''}</h3>
            {error && <ErrorBox msg={error} />}
            {/* Durata: preset rapido (se presenti) + campi LIBERI sempre modificabili.
                Niente prezzi/durate bloccati: l'admin può impostare qualsiasi durata e prezzo. */}
            <div className="mb-3 space-y-2">
              {selectedAsset?.tour_durations && selectedAsset.tour_durations.length > 0 && (
                <div>
                  <label className="text-xs text-theme-text-muted">Durata (preset rapido — opzionale)</label>
                  <select
                    className={INPUT_CLS}
                    value={selectedAsset.tour_durations.some(x => x.label === form.duration_label) ? form.duration_label : '__custom__'}
                    onChange={e => {
                      if (e.target.value === '__custom__') return
                      const d = selectedAsset!.tour_durations!.find(x => x.label === e.target.value)
                      if (d) setForm(f => ({ ...f, duration_label: d.label, duration_minutes: String(d.minutes), price_eur: String(d.price) }))
                    }}
                  >
                    {selectedAsset.tour_durations.map((d, i) => (
                      <option key={i} value={d.label}>{d.label} — €{d.price}/persona{d.best_value ? ' ★' : ''}</option>
                    ))}
                    <option value="__custom__">Personalizzata…</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-theme-text-muted">Durata (etichetta)</label>
                  <input className={INPUT_CLS} placeholder="es. 30 MIN" value={form.duration_label} onChange={e => setForm({ ...form, duration_label: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-theme-text-muted">Minuti</label>
                  <input className={INPUT_CLS} type="number" min={1} placeholder="es. 30" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-theme-text-muted">Data</label>
                <EuropeanDateInput className={INPUT_CLS} value={form.departure_date} onChange={(__v: string) => setForm({ ...form, departure_date: __v })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Orario</label>
                <input className={INPUT_CLS} type="time" value={form.departure_time} onChange={e => setForm({ ...form, departure_time: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Posti totali</label>
                <input className={INPUT_CLS} type="number" min={1} value={form.total_seats} onChange={e => setForm({ ...form, total_seats: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted">Prezzo posto (€)</label>
                <input className={INPUT_CLS} inputMode="decimal" placeholder="opzionale" value={form.price_eur} onChange={e => setForm({ ...form, price_eur: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowForm(false)} disabled={saving} className={BTN_GHOST}>Annulla</button>
              <button onClick={createDeparture} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Salvataggio…' : (editingDepId ? 'Salva partenza' : 'Crea partenza')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- SHARED UI ------------------------------ */

// LeadPicker estratto in ./LeadPicker (riusato da Lavaggi/Meccanica).

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
/**
 * 2026-08-24: prima bastava che il messaggio CONTENESSE "noleggio_catalog"
 * per dire "tabelle non ancora create". Cosi' un vincolo violato o un
 * permesso RLS — errori veri, con una causa precisa — venivano raccontati
 * come una migration mancante: si andava a cercare una tabella che c'era
 * gia'. Ora si distingue per codice, e il messaggio del database resta
 * sempre visibile in coda.
 */
function missingTableHint(msg: string, code?: string): string {
  const dettaglio = msg ? ` (dettaglio: ${msg})` : ''
  if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table|schema cache/i.test(msg)) {
    return `Tabella non ancora creata: esegui la migration Stage 2 (noleggio_catalog / noleggio_preventivi) nel SQL editor Supabase.${dettaglio}`
  }
  if (code === '23514' || /violates check constraint/i.test(msg)) {
    return `Il database non accetta questo valore: un vincolo (CHECK) lo esclude. Se hai appena aggiunto un nuovo tipo di servizio, va allargato il vincolo.${dettaglio}`
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return `Permessi insufficienti su questa tabella (RLS): l'utente admin non e' autorizzato a scrivere.${dettaglio}`
  }
  if (code === '23505') return `Esiste gia' un elemento con questi dati.${dettaglio}`
  if (code === '42703') return `Colonna mancante: la tabella e' piu' vecchia del gestionale, manca una migration.${dettaglio}`
  return msg
}
