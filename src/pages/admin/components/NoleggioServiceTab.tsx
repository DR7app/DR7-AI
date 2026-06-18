// NoleggioServiceTab — tab riutilizzabile per Noleggio Mare (barche) e
// Noleggio Aria (elicottero). Stesso schema sotto-tab del Car Wash
// (Prenotazioni · Calendario · Catalogo · Preventivi) ma su un service_type
// dedicato ('boat_rental' / 'heli_rental'). Prime Wash NON e' toccato.
//
// Prenotazioni + Calendario: tabella `bookings`.
// Catalogo: tabella `noleggio_catalog`. Preventivi: tabella `noleggio_preventivi`.
import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import toast from 'react-hot-toast'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'

// Stati pagamento standard DR7 (come Noleggio auto / Car Wash): la label è
// quella mostrata, il value è il payment_status salvato sul booking.
const PAY_STATUS_OPTIONS = [
  { value: 'pending', label: 'Da Saldare' },
  { value: 'partial', label: 'Parziale' },
  { value: 'paid', label: 'Pagato' },
]
const isNexiPbl = (method: string) => /nexi/i.test(method)

export type NoleggioServiceType = 'boat_rental' | 'heli_rental' | 'stay_rental'
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

interface BookingRow {
  id: string
  customer_name: string | null
  customer_phone: string | null
  vehicle_name: string | null
  vehicle_plate: string | null
  status: string | null
  payment_status: string | null
  payment_method: string | null
  pickup_date: string | null
  dropoff_date: string | null
  price_total: number | null
  created_at: string | null
  booking_details: { passengers?: { name: string; seat?: string; phone?: string }[]; seat_count?: number; seats?: string; note?: string | null } | null
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
  if (view === 'tours') return <ToursView serviceType={serviceType} labels={labels} />
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
          .select('id, customer_name, customer_phone, vehicle_name, vehicle_plate, status, payment_status, payment_method, pickup_date, dropoff_date, price_total, created_at, booking_details')
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
  // Aria/Mare = tour a posti: la lista mostra Partenza + Posti (non Ritiro/Riconsegna).
  const isTour = serviceType === 'heli_rental' || serviceType === 'boat_rental'

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
        .select('id, name, image_url, is_active, capacity, price_per_day')
        .eq('service_type', serviceType)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (cancelled) return
      if (e) setAssetsError(missingTableHint(e.message))
      else setAssets((data || []) as CalAsset[])
    })()
    return () => { cancelled = true }
  }, [serviceType])

  // Metodi di pagamento da Centralina Pro (niente hardcoded).
  const paymentMethods = usePaymentMethods()

  // Modal create/edit (stessa logica del Calendario, accessibile dalla lista)
  const [showForm, setShowForm] = useState(false)
  const [detailBooking, setDetailBooking] = useState<BookingRow | null>(null)
  const [form, setForm] = useState<CalBookingForm>(EMPTY_CAL_FORM)
  const [formAsset, setFormAsset] = useState('')
  const [payStatus, setPayStatus] = useState('pending') // Da Saldare
  const [payMethod, setPayMethod] = useState('')
  const [passengers, setPassengers] = useState<{ name: string; seat: string }[]>([])
  const [origDetails, setOrigDetails] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Posti disponibili per l'elicottero scelto (1..capacità del catalogo) per
  // il dropdown "quale posto per quale passeggero". Solo Noleggio Aria.
  const selectedAssetObj = assets.find(a => a.name === formAsset)
  const selectedAssetCapacity = selectedAssetObj?.capacity || 0
  const selectedAssetPriceCents = selectedAssetObj?.price_per_day || 0
  const seatOptions = Array.from({ length: selectedAssetCapacity }, (_, i) => String(i + 1))

  // Totale calcolato automaticamente (Aria): n° passeggeri × prezzo posto del
  // catalogo. Solo se il prezzo catalogo è impostato (>0), così non azzera un
  // totale digitato a mano quando il prezzo è "su richiesta".
  useEffect(() => {
    if (serviceType !== 'heli_rental' || !showForm) return
    if (passengers.length > 0 && selectedAssetPriceCents > 0) {
      setForm(f => ({ ...f, price_eur: centsToEur(passengers.length * selectedAssetPriceCents) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers.length, formAsset, showForm])

  function openCreate() {
    const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    setForm({ ...EMPTY_CAL_FORM, pickup_date: todayYmd, dropoff_date: todayYmd })
    setFormAsset(assets[0]?.name || '')
    setPayStatus('pending'); setPayMethod('')
    setPassengers([]); setOrigDetails({})
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
    setPayStatus(b.payment_status || 'pending')
    setPayMethod(b.payment_method || '')
    setPassengers((b.booking_details?.passengers || []).map(p => ({ name: p.name || '', seat: p.seat || '' })) as { name: string; seat: string }[])
    setOrigDetails((b.booking_details as Record<string, unknown>) || {})
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
    // Passeggeri -> booking_details.passengers (preserva le altre chiavi su modifica).
    const cleanPassengers = passengers.map(p => ({ name: p.name.trim(), ...(p.seat ? { seat: p.seat } : {}) })).filter(p => p.name)
    const details: Record<string, unknown> = { ...origDetails }
    if (cleanPassengers.length) details.passengers = cleanPassengers
    else delete details.passengers
    const payload = {
      service_type: serviceType,
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim() || null,
      guest_name: form.customer_name.trim(), guest_phone: form.customer_phone.trim() || null,
      vehicle_name: formAsset || null,
      pickup_date: toIso(form.pickup_date, form.pickup_time),
      dropoff_date: toIso(form.dropoff_date, form.dropoff_time),
      price_total: eurToCents(form.price_eur),
      status: 'confirmed',
      payment_status: payStatus,
      payment_method: payMethod || null,
      booking_details: details,
    }
    const { data, error: e } = form.id
      ? await supabase.from('bookings').update(payload).eq('id', form.id).select('id').single()
      : await supabase.from('bookings').insert({ ...payload, created_at: new Date().toISOString() }).select('id').single()
    if (e) { setSaving(false); setFormError(e.message); return }

    // Nexi - Pay by Link + Da Saldare: genera e invia il link (stesso flusso
    // di Noleggio auto / Car Wash). Solo alla creazione.
    const bookingId = (data as { id: string } | null)?.id
    if (!form.id && bookingId && payStatus === 'pending' && isNexiPbl(payMethod)) {
      try {
        const amountEuros = (eurToCents(form.price_eur)) / 100
        const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId, amount: amountEuros, customerEmail: '', customerName: form.customer_name.trim() || 'Cliente', description: `${labels.title} - ${formAsset || ''}`.trim(), expirationHours: 1 }),
        })
        const linkData = await linkRes.json()
        if (linkRes.ok && linkData.paymentUrl) {
          await supabase.from('bookings').update({ booking_details: { ...details, nexi_payment_link: linkData.paymentUrl, nexi_order_id: linkData.orderId || null, payment_link_created_at: new Date().toISOString(), payment_link_expires_at: linkData.expiresAt || new Date(Date.now() + 3600000).toISOString() } }).eq('id', bookingId)
          const phone = form.customer_phone.trim()
          if (phone) {
            const firstName = form.customer_name.trim().split(' ')[0] || 'Cliente'
            const amountStr = amountEuros.toFixed(2)
            const ref = (bookingId || '').substring(0, 8).toUpperCase()
            await fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customPhone: phone, templateKey: 'payment_link_customer', booking: { service_type: 'rental' }, templateVars: { customer_name: firstName, nome: firstName, amount: amountStr, total: amountStr, importo: amountStr, totale: amountStr, link: linkData.paymentUrl, payment_link: linkData.paymentUrl, booking_id: ref, booking_ref: ref, expiry: '1 ora' }, skipHeader: true }),
            })
          }
          toast.success('Prenotazione creata e link di pagamento inviato!')
        } else {
          toast.error('Prenotazione creata ma errore link pagamento: ' + (linkData.error || ''))
        }
      } catch (le) { toast.error('Errore Pay by Link: ' + (le as Error).message) }
    }

    setSaving(false); setShowForm(false); reload()
  }
  // Libera i posti tour collegati al booking (tornano available) prima di eliminarlo.
  async function freeTourSeats(bookingId: string) {
    try {
      await supabase.from('noleggio_tour_seats')
        .update({ status: 'available', booking_id: null, customer_name: null, customer_phone: null })
        .eq('booking_id', bookingId)
    } catch { /* tabella tour assente per stay/altri: ignora */ }
  }

  async function deleteBooking() {
    if (!form.id) return
    if (!window.confirm('Eliminare questa prenotazione?')) return
    setSaving(true); setFormError('')
    await freeTourSeats(form.id)
    const { error: e } = await supabase.from('bookings').delete().eq('id', form.id)
    setSaving(false)
    if (e) { setFormError(e.message); return }
    setShowForm(false); reload()
  }

  async function deleteBookingRow(b: BookingRow) {
    if (!window.confirm(`Eliminare la prenotazione di ${b.customer_name || 'questo cliente'}?`)) return
    await freeTourSeats(b.id)
    const { error: e } = await supabase.from('bookings').delete().eq('id', b.id)
    if (e) { setFormError(e.message); return }
    reload()
  }

  return (
    <div className="space-y-4">
      <Header title={`${labels.title} — Prenotazioni`} action={
        <button onClick={() => {
          // Aria/Mare = tour a posti: "Nuova prenotazione" porta al flusso Tour
          // (scegli partenza -> posti -> passeggeri -> pagamento), come richiesto.
          if (serviceType === 'heli_rental') window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'aria-tours' } }))
          else if (serviceType === 'boat_rental') window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'mare-tours' } }))
          else openCreate()
        }} className={BTN_PRIMARY}>+ Nuova prenotazione</button>
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
                <th className="text-left px-3 py-2 font-medium">{isTour ? 'Partenza' : 'Ritiro'}</th>
                <th className="text-left px-3 py-2 font-medium">{isTour ? 'Posti' : 'Riconsegna'}</th>
                <th className="text-left px-3 py-2 font-medium">Stato</th>
                <th className="text-right px-3 py-2 font-medium">Totale</th>
                <th className="text-right px-3 py-2 font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <tr key={b.id} className="border-t border-theme-border hover:bg-theme-bg-hover">
                  <td className="px-3 py-2 text-theme-text-primary">{b.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary">{b.vehicle_name || b.vehicle_plate || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{fmtDate(b.pickup_date)}</td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">{isTour ? (b.booking_details?.seat_count ?? b.booking_details?.passengers?.length ?? '—') : fmtDate(b.dropoff_date)}</td>
                  <td className="px-3 py-2"><Badge value={b.status} /></td>
                  <td className="px-3 py-2 text-right text-theme-text-primary tabular-nums">{eur(b.price_total)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setDetailBooking(b)} className="text-cyan-400 hover:underline mr-3">Dettagli</button>
                    <button onClick={() => openEdit(b)} className="text-theme-text-secondary hover:underline mr-3">Modifica</button>
                    <button onClick={() => deleteBookingRow(b)} className="text-red-400 hover:underline">Elimina</button>
                  </td>
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
                <LeadPicker initialQuery={form.customer_name} onPick={(name, phone) => setForm(f => ({ ...f, customer_name: name || f.customer_name, customer_phone: phone || f.customer_phone }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Cliente</label>
                <input className={INPUT_CLS} placeholder="Nome cliente" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Telefono</label>
                <input className={INPUT_CLS} placeholder="Telefono (opzionale)" value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
              </div>

              {/* Passeggeri: nome + (solo Aria) dropdown del posto per ciascuno */}
              <div className="sm:col-span-2 border-t border-theme-border pt-3 mt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-theme-text-muted">Passeggeri {passengers.length > 0 && `(${passengers.length})`}</label>
                  <button type="button" onClick={() => setPassengers(p => [...p, { name: '', seat: '' }])} className="text-xs text-dr7-gold font-semibold hover:underline">+ Aggiungi passeggero</button>
                </div>
                {passengers.length === 0 && (
                  <p className="text-[11px] text-theme-text-muted mt-1">Nessun passeggero. Clicca "+ Aggiungi passeggero"{serviceType === 'heli_rental' ? ' e scegli il posto per ciascuno.' : '.'}</p>
                )}
                <div className="mt-2 space-y-2">
                  {passengers.map((p, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <div className="flex-1">
                        <LeadPicker
                          label=""
                          placeholder={`Passeggero ${i + 1}: scegli un cliente o scrivi il nome`}
                          initialQuery={p.name}
                          onQueryChange={q => setPassengers(arr => arr.map((x, j) => j === i ? { ...x, name: q } : x))}
                          onPick={name => setPassengers(arr => arr.map((x, j) => j === i ? { ...x, name } : x))}
                        />
                      </div>
                      {serviceType === 'heli_rental' && (
                        <select className={INPUT_CLS + ' max-w-[150px]'} value={p.seat}
                          onChange={e => setPassengers(arr => arr.map((x, j) => j === i ? { ...x, seat: e.target.value } : x))}>
                          <option value="">Posto…</option>
                          {seatOptions.map(s => <option key={s} value={s} disabled={passengers.some((q, j) => j !== i && q.seat === s)}>Posto {s}</option>)}
                        </select>
                      )}
                      <button type="button" onClick={() => setPassengers(arr => arr.filter((_, j) => j !== i))} className="text-red-400 text-xl leading-none px-1 shrink-0" title="Rimuovi">×</button>
                    </div>
                  ))}
                </div>
                {serviceType === 'heli_rental' && selectedAssetCapacity === 0 && passengers.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-400">Imposta la capacità (posti) di questo elicottero nel Catalogo per scegliere i posti.</p>
                )}
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
                <label className="text-xs text-theme-text-muted">Stato Pagamento</label>
                <select className={INPUT_CLS} value={payStatus} onChange={e => setPayStatus(e.target.value)}>
                  {PAY_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-theme-text-muted">Metodo di Pagamento</label>
                <select className={INPUT_CLS} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="">— seleziona —</option>
                  {paymentMethods.filter(m => m.is_enabled !== false).map(m => <option key={m.key || m.label} value={m.label}>{m.label}</option>)}
                </select>
                {paymentMethods.length === 0 && <p className="mt-1 text-[11px] text-amber-400">Nessun metodo configurato in Centralina Pro &gt; Fiscale.</p>}
                {isNexiPbl(payMethod) && payStatus === 'pending' && <p className="mt-1 text-[11px] text-theme-text-muted">Verrà generato e inviato il link di pagamento Nexi al cliente.</p>}
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

      {detailBooking && (() => {
        const b = detailBooking
        const bd = b.booking_details
        const pax = bd?.passengers || []
        const Row = ({ k, v }: { k: string; v: ReactNode }) => (
          <div className="flex justify-between gap-4 py-1 border-b border-theme-border/60 last:border-0">
            <span className="text-theme-text-muted text-sm">{k}</span>
            <span className="text-theme-text-primary text-sm text-right">{v || '—'}</span>
          </div>
        )
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailBooking(null)}>
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-theme-text-primary">Dettagli prenotazione</h3>
                <button onClick={() => setDetailBooking(null)} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">&times;</button>
              </div>
              <div>
                <Row k="Cliente" v={b.customer_name} />
                <Row k="Telefono" v={b.customer_phone} />
                <Row k={labels.asset} v={b.vehicle_name} />
                <Row k={isTour ? 'Partenza' : 'Ritiro'} v={fmtDate(b.pickup_date)} />
                <Row k="Posti" v={bd?.seat_count ?? pax.length} />
                <Row k="Stato" v={<Badge value={b.status} />} />
                <Row k="Pagamento" v={<Badge value={b.payment_status} />} />
                <Row k="Metodo" v={b.payment_method} />
                <Row k="Totale" v={eur(b.price_total)} />
                {bd?.note && <Row k="Note" v={bd.note} />}
              </div>
              {pax.length > 0 && (
                <div className="border border-theme-border rounded-lg overflow-hidden">
                  <div className="bg-theme-bg-tertiary px-3 py-2 text-xs font-semibold text-theme-text-secondary">Passeggeri</div>
                  {pax.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 border-t border-theme-border text-sm">
                      <span className="text-theme-text-muted">{p.seat ? `Posto ${p.seat}` : `Passeggero ${i + 1}`}</span>
                      <span className="text-theme-text-primary">{p.name || '—'}{p.phone ? ` · ${p.phone}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => { const bk = detailBooking; setDetailBooking(null); openEdit(bk) }} className={BTN_GHOST}>Modifica</button>
                <button onClick={() => setDetailBooking(null)} className={BTN_PRIMARY}>Chiudi</button>
              </div>
            </div>
          </div>
        )
      })()}
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

interface CalAsset { id: string; name: string; image_url: string | null; is_active?: boolean; capacity?: number | null; price_per_day?: number | null }

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

// Sezione calendario sola-lettura: prossime partenze tour con seat map colorata
// (riusa seatVisual). Ogni partenza = una riga, ogni posto = uno slot col nome
// cliente. Le prenotazioni si fanno dalla tab Tour.
function TourCalendarSection({ serviceType }: { serviceType: NoleggioServiceType }) {
  const [rows, setRows] = useState<{ dep: TourDeparture; assetName: string; seats: TourSeat[] }[]>([])
  const [pay, setPay] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: cats } = await supabase.from('noleggio_catalog').select('id, name').eq('service_type', serviceType)
      const catMap = new Map<string, string>((cats || []).map((c: { id: string; name: string }) => [c.id, c.name]))
      const catIds = Array.from(catMap.keys())
      if (!catIds.length) { if (!cancelled) { setRows([]); setLoading(false) } return }
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
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">Tour & Posti — prossime partenze</h3>
      {rows.map(({ dep, assetName, seats }) => (
        <div key={dep.id} className="border border-theme-border rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-theme-text-primary font-medium">{assetName}</span>
            <span className="text-theme-text-secondary tabular-nums">{fmtYmd(dep.departure_date)} · {dep.departure_time.slice(0, 5)}</span>
            <span className="text-xs text-theme-text-muted">{seats.filter(s => s.status === 'sold').length}/{dep.total_seats} venduti</span>
          </div>
          <div className="flex flex-wrap gap-2">
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
        </div>
      ))}
    </div>
  )
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
      guest_name: form.customer_name.trim(), guest_phone: form.customer_phone.trim() || null,
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

      {/* Tour & Posti: prossime partenze con la mappa posti (verde pagato /
          giallo in attesa / rosso non pagato), sola lettura. */}
      <TourCalendarSection serviceType={serviceType} />

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
          <LeadPicker initialQuery={form.customer_name} onPick={(name, phone) => setForm(f => ({ ...f, customer_name: name || f.customer_name, customer_phone: phone || f.customer_phone }))} />
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
const EMPTY_DEP_FORM = { departure_date: '', departure_time: '10:00', total_seats: '6', price_eur: '' }
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
// verde = pagato · rosso = venduto ma non pagato · giallo = in attesa (carrello)
// · grigio = bloccato · contorno verde = libero · bianco = scelto ora.
function seatVisual(seat: TourSeat, payStatus: string | undefined, selected: boolean): { cls: string; lbl: string } {
  if (selected) return { cls: 'border-white bg-white text-black', lbl: 'scelto' }
  if (seat.status === 'available') return { cls: 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20', lbl: 'libero' }
  if (seat.status === 'blocked') return { cls: 'border-theme-border text-theme-text-muted bg-theme-bg-tertiary line-through', lbl: 'bloccato' }
  if (seat.status === 'held') return { cls: 'border-amber-500/60 text-amber-300 bg-amber-500/20', lbl: 'in attesa' }
  // sold
  const paid = ['paid', 'succeeded', 'completed'].includes((payStatus || '').toLowerCase())
  if (paid) return { cls: 'border-emerald-500 text-emerald-100 bg-emerald-600/40', lbl: 'pagato' }
  return { cls: 'border-red-500/70 text-red-200 bg-red-600/30', lbl: 'non pagato' }
}

function ToursView({ serviceType, labels }: { serviceType: NoleggioServiceType; labels: NoleggioServiceLabels }) {
  const [assets, setAssets] = useState<CatalogRow[]>([])
  const [assetId, setAssetId] = useState('')
  const [departures, setDepartures] = useState<TourDeparture[]>([])
  const [seats, setSeats] = useState<Record<string, TourSeat[]>>({})
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
  const [tourPayStatus, setTourPayStatus] = useState('pending') // Da Saldare
  const [tourPayMethod, setTourPayMethod] = useState('')
  const [tourConfirm, setTourConfirm] = useState(false) // Conferma Prenotazione
  const tourPaymentMethods = usePaymentMethods()
  const [booking, setBooking] = useState(false)
  const [manageMode, setManageMode] = useState<Set<string>>(new Set()) // partenze in modalità "gestisci posti"

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: e } = await supabase
        .from('noleggio_catalog')
        .select('id, service_type, name, description, price_per_day, capacity, image_url, is_active, sort_order')
        .eq('service_type', serviceType)
        .order('sort_order', { ascending: true }).order('name', { ascending: true })
      if (cancelled) return
      if (e) setError(missingTableHint(e.message))
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
      .select('*').eq('catalog_id', id)
      .order('departure_date', { ascending: true }).order('departure_time', { ascending: true })
    if (e) setError(tourTableHint(e.message))
    else setDepartures((data || []) as TourDeparture[])
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

  function clearCart() { setCartDep(null); setCartSeats(new Set()); setCust({ name: '', phone: '' }); setSeatNames({}); setSeatPhones({}); setTourNote(''); setTourPayStatus('pending'); setTourPayMethod(''); setTourConfirm(false) }

  // Crea la prenotazione dai posti nel carrello e li assegna al cliente.
  // booking confirmed + payment_status pending => posti ROSSI (non pagati).
  async function createTourBooking(dep: TourDeparture) {
    const ids = Array.from(cartSeats)
    if (!ids.length) return
    if (!cust.name.trim() || !cust.phone.trim()) { setError('Inserisci nome e telefono del cliente.'); return }
    const chosen = (seats[dep.id] || []).filter(s => cartSeats.has(s.id))
    const priceOf = (s: TourSeat) => s.price_cents != null ? s.price_cents : (dep.price_per_seat_cents != null ? dep.price_per_seat_cents : (selectedAsset?.price_per_day || 0))
    const totalCents = chosen.reduce((t, s) => t + priceOf(s), 0)
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
      booking_details: { tour_departure_id: dep.id, seats: labelsStr, seat_count: chosen.length, passengers: passengersDetail, note: tourNote.trim() || null, manually_confirmed: tourConfirm, ...(tourConfirm ? { manually_confirmed_at: new Date().toISOString() } : {}) },
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

    // Fattura automatica: come gli altri servizi, se il metodo NON è wallet
    // e il pagamento è Pagato, genera la fattura. La regola auto_invoice arriva
    // da Centralina Pro (payment_methods[].auto_invoice).
    const methodCfg = tourPaymentMethods.find(m => m.label === tourPayMethod)
    const isWallet = /wallet|credit/i.test(tourPayMethod)
    if (isPaid && tourPayMethod && !isWallet && methodCfg?.auto_invoice !== false) {
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
      catalog_id: assetId,
      departure_date: form.departure_date,
      departure_time: form.departure_time || '10:00',
      total_seats: total,
      price_per_seat_cents: form.price_eur ? eurToCents(form.price_eur) : null,
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

  function seatSummary(dep: TourDeparture): string {
    const list = seats[dep.id]
    if (!list) return `${dep.total_seats} posti`
    const sold = list.filter(s => s.status === 'sold').length
    return `${sold}/${dep.total_seats} venduti`
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
                  <span className="text-xs text-theme-text-muted">{seatSummary(dep)}</span>
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
                      <span><span className="inline-block w-3 h-3 rounded-sm bg-red-600/60 align-middle" /> non pagato</span>
                      <span><span className="inline-block w-3 h-3 rounded-sm bg-emerald-600 align-middle" /> pagato</span>
                      <span><span className="inline-block w-3 h-3 rounded-sm bg-theme-bg-tertiary border border-theme-border align-middle" /> bloccato</span>
                    </div>
                    <button
                      onClick={() => setManageMode(m => { const n = new Set(m); if (n.has(dep.id)) n.delete(dep.id); else n.add(dep.id); return n })}
                      className={`text-xs px-2 py-1 rounded ${manageMode.has(dep.id) ? 'bg-dr7-gold text-black font-semibold' : 'border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                      {manageMode.has(dep.id) ? 'Esci da gestione posti' : 'Gestisci posti (blocca)'}
                    </button>
                  </div>

                  {!seats[dep.id] && <div className="text-theme-text-muted text-sm">Caricamento posti…</div>}
                  {seats[dep.id] && (
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
                    const cartTotalCents = (seats[dep.id] || []).filter(s => cartSeats.has(s.id))
                      .reduce((t, s) => t + (s.price_cents != null ? s.price_cents : (dep.price_per_seat_cents != null ? dep.price_per_seat_cents : (selectedAsset?.price_per_day || 0))), 0)
                    return (
                    <div className="mt-4 border border-dr7-gold/40 rounded-lg p-3 space-y-3 bg-theme-bg-tertiary/50">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-sm text-theme-text-primary font-medium">{cartSeats.size} posto/i nel carrello — assegna un cliente</div>
                        <div className="text-right">
                          <div className="text-[11px] text-theme-text-muted">Totale ({cartSeats.size} × prezzo posto)</div>
                          <div className="text-lg font-bold text-theme-text-primary">{eur(cartTotalCents)}</div>
                        </div>
                      </div>
                      <LeadPicker onPick={(name, phone) => setCust({ name: name || cust.name, phone: phone || cust.phone })} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className={INPUT_CLS} placeholder="Nome cliente (contatto)" value={cust.name} onChange={e => setCust({ ...cust, name: e.target.value })} />
                        <input className={INPUT_CLS} placeholder="Telefono" value={cust.phone} onChange={e => setCust({ ...cust, phone: e.target.value })} />
                      </div>
                      {/* Nome del passeggero per OGNI posto (sempre visibile).
                          Vuoto = usa il nome del contatto qui sopra. */}
                      <div className="space-y-2">
                        <div className="text-xs text-theme-text-muted">Nome passeggero per ogni posto (opzionale)</div>
                        {(seats[dep.id] || []).filter(s => cartSeats.has(s.id)).map(s => (
                          <div key={s.id} className="flex items-center gap-2">
                            <span className="text-xs text-theme-text-muted w-16 shrink-0">Posto {s.seat_label}</span>
                            <div className="flex-1">
                              <LeadPicker
                                label=""
                                placeholder={`Posto ${s.seat_label}: scegli un cliente o scrivi il nome`}
                                initialQuery={seatNames[s.id] || ''}
                                onQueryChange={q => setSeatNames(m => ({ ...m, [s.id]: q }))}
                                onPick={(name, phone) => { setSeatNames(m => ({ ...m, [s.id]: name })); setSeatPhones(m => ({ ...m, [s.id]: phone || '' })) }}
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
                      : 'Clic sui posti liberi per metterli nel carrello, poi assegna il cliente. Il cliente riceverà il link di pagamento (posto rosso = confermato non pagato).'}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-theme-text-muted">Data</label>
                <input className={INPUT_CLS} type="date" value={form.departure_date} onChange={e => setForm({ ...form, departure_date: e.target.value })} />
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

// Selettore cliente dai Lead (tabella `customers`): cerca per nome/telefono/
// email e richiama onPick(nome, telefono). Usato in Prenotazioni e Preventivi.
interface Lead { id: string; name: string; phone: string; email: string }
// Stessa sorgente della tab Clienti: customers_extended via /.netlify/functions/
// list-customers (service role, bypassa RLS, paginato = TUTTI i clienti). Niente
// query diretta su `customers` (mostrava solo un sottoinsieme).
async function fetchLeads(): Promise<Lead[]> {
  try {
    const res = await fetch('/.netlify/functions/list-customers')
    const json = await res.json()
    const rows: Record<string, unknown>[] = json?.customers || []
    return rows.map((c, i) => {
      const g = (k: string) => (c[k] == null ? '' : String(c[k])).trim()
      const name = g('full_name') || `${g('nome') || g('first_name')} ${g('cognome') || g('last_name')}`.trim() || g('ragione_sociale') || g('denominazione')
      const phone = g('telefono') || g('phone') || g('mobile') || g('cellulare')
      return { id: g('id') || g('user_id') || `lead-${i}`, name, phone, email: g('email') }
    }).filter(l => l.name || l.phone || l.email)
  } catch {
    return []
  }
}
function LeadPicker({ onPick, initialQuery = '', label = 'Seleziona cliente dai Lead', placeholder = 'Cerca un cliente per nome, telefono o email…', onQueryChange }: { onPick: (name: string, phone: string) => void; initialQuery?: string; label?: string; placeholder?: string; onQueryChange?: (q: string) => void }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(false)
  useEffect(() => { setQuery(initialQuery) }, [initialQuery])
  useEffect(() => {
    let cancelled = false
    fetchLeads().then(ls => { if (!cancelled) setLeads(ls) })
    return () => { cancelled = true }
  }, [])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return leads.slice(0, 8)
    return leads.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.phone.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [leads, query])
  return (
    <div className="relative">
      {label !== '' && <label className="text-xs text-theme-text-muted">{label} {leads.length > 0 && <span className="text-theme-text-muted/70">({leads.length})</span>}</label>}
      <input
        className={INPUT_CLS}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); onQueryChange?.(e.target.value) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg">
          {matches.map((l, i) => (
            <button
              key={`${l.id}-${i}`}
              type="button"
              onMouseDown={e => { e.preventDefault(); onPick(l.name, l.phone); setQuery(l.name); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover border-b border-theme-border last:border-0"
            >
              <div className="text-sm text-theme-text-primary">{l.name || '(senza nome)'}</div>
              <div className="text-xs text-theme-text-muted">{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
