import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import Button from './Button'
import Input from './Input'
import Select from './Select'
import AddressAutocomplete from './AddressAutocomplete'
import {
  USCITA_SERVICE_TYPE,
  USCITA_MOTIVAZIONI,
  USCITA_LUOGHI,
  USCITA_SERVIZI_EXTRA,
  USCITA_PAYMENT_STATES,
  USCITA_CAUZIONE_STATES,
  USCITA_STATI,
  uscitaStatoToBookingStatus,
  emptyVehicleCard,
  type UscitaStato,
  type UscitaVehicleCard,
  type UscitaServizioExtra,
} from '../../../utils/uscitaStraordinaria'

interface VehicleLite {
  id: string
  display_name: string
  plate?: string | null
  category?: string | null
}

interface Autista {
  id: string
  full_name: string
  phone: string
}

interface Props {
  open: boolean
  onClose: () => void
  vehicles: VehicleLite[]
  onSaved?: () => void
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `c${Math.random().toString(36).slice(2)}`)

function eurToCents(eur: string): number {
  const s = String(eur ?? '0').trim().replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// 24h HH:MM, granularità 15 min — stesso formato usato in tutta l'app (niente
// picker nativo AM/PM con scroll dei minuti).
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts = [{ value: '', label: '—' }]
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      opts.push({ value: v, label: v })
    }
  }
  return opts
})()

interface BookingHit {
  id: string
  customer_name: string | null
  vehicle_name: string | null
  vehicle_plate: string | null
  pickup_date: string | null
}

// "Collega a Booking": ricerca per cliente / veicolo / targa, come altrove.
function BookingLinkPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<BookingHit[]>([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<BookingHit | null>(null)

  useEffect(() => {
    if (selected) return
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let cancel = false
    const t = setTimeout(async () => {
      const safe = term.replace(/[%,()]/g, ' ')
      const { data } = await supabase
        .from('bookings')
        .select('id, customer_name, vehicle_name, vehicle_plate, pickup_date')
        .not('status', 'in', '(cancelled,annullata)')
        .or(`customer_name.ilike.%${safe}%,vehicle_name.ilike.%${safe}%,vehicle_plate.ilike.%${safe}%`)
        .order('pickup_date', { ascending: false })
        .limit(8)
      if (!cancel) { setResults(data || []); setOpen(true) }
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [q, selected])

  const pick = (b: BookingHit) => { setSelected(b); setOpen(false); setQ(''); onChange(b.id) }
  const clear = () => { setSelected(null); setQ(''); onChange(null) }

  if (selected || value) {
    const label = selected
      ? `${selected.customer_name || 'Cliente'} · ${selected.vehicle_name || ''}${selected.vehicle_plate ? ` (${selected.vehicle_plate})` : ''}`
      : `Booking ${String(value).slice(0, 8).toUpperCase()}`
    return (
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-theme-text-primary">{label}</span>
        <button type="button" onClick={clear} className="text-xs text-red-400 hover:text-red-300">Scollega</button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Cerca per cliente, veicolo o targa…"
        className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary"
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-theme-border bg-theme-bg-primary shadow-xl">
          {results.map(b => (
            <button key={b.id} type="button" onClick={() => pick(b)}
              className="block w-full text-left px-3 py-2 text-sm text-theme-text-primary hover:bg-theme-bg-tertiary border-b border-theme-border/40 last:border-0">
              <span className="font-medium">{b.customer_name || 'Cliente'}</span>
              <span className="text-theme-text-muted"> · {b.vehicle_name || ''}{b.vehicle_plate ? ` (${b.vehicle_plate})` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function UscitaStraordinariaModal({ open, onClose, vehicles, onSaved }: Props) {
  const [title, setTitle] = useState('')
  const [stato, setStato] = useState<UscitaStato>('Programmata')
  const [noteOperative, setNoteOperative] = useState('')
  const [noteIntegrative, setNoteIntegrative] = useState('')
  const [cards, setCards] = useState<UscitaVehicleCard[]>([emptyVehicleCard(uid())])
  const [saving, setSaving] = useState(false)

  // Autisti registry (customers tagged metadata.role='autista')
  const [autisti, setAutisti] = useState<Autista[]>([])
  const [loadingAutisti, setLoadingAutisti] = useState(false)
  const [showNewAutista, setShowNewAutista] = useState(false)
  const [newAutista, setNewAutista] = useState({ nome: '', cognome: '', telefono: '' })
  const [creatingAutista, setCreatingAutista] = useState(false)

  const loadAutisti = useCallback(async () => {
    setLoadingAutisti(true)
    try {
      const res = await authFetch('/.netlify/functions/autisti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.autisti)) setAutisti(data.autisti)
      else toast.error('Autisti non caricati: ' + (data.error || res.statusText))
    } catch (e) {
      toast.error('Errore caricamento autisti: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoadingAutisti(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    loadAutisti()
    // Reset draft each time the modal opens.
    setTitle('')
    setStato('Programmata')
    setNoteOperative('')
    setNoteIntegrative('')
    setCards([emptyVehicleCard(uid())])
    setShowNewAutista(false)
    setNewAutista({ nome: '', cognome: '', telefono: '' })
  }, [open, loadAutisti])

  if (!open) return null

  const patchCard = (localId: string, patch: Partial<UscitaVehicleCard>) =>
    setCards(prev => prev.map(c => (c.localId === localId ? { ...c, ...patch } : c)))

  const addCard = () => setCards(prev => [...prev, emptyVehicleCard(uid())])
  const removeCard = (localId: string) => setCards(prev => (prev.length > 1 ? prev.filter(c => c.localId !== localId) : prev))

  const toggleAutista = (card: UscitaVehicleCard, autistaId: string) => {
    const has = card.autista_ids.includes(autistaId)
    const autista_ids = has ? card.autista_ids.filter(id => id !== autistaId) : [...card.autista_ids, autistaId]
    const vehicle_to_drive = { ...card.vehicle_to_drive }
    if (has) delete vehicle_to_drive[autistaId]
    else vehicle_to_drive[autistaId] = card.vehicle_id || ''
    patchCard(card.localId, { autista_ids, vehicle_to_drive })
  }

  const toggleMotivazione = (card: UscitaVehicleCard, m: string) => {
    const has = card.motivazioni.includes(m)
    patchCard(card.localId, { motivazioni: has ? card.motivazioni.filter(x => x !== m) : [...card.motivazioni, m] })
  }

  const addServizio = (card: UscitaVehicleCard) =>
    patchCard(card.localId, {
      servizi_extra: [...card.servizi_extra, { name: '', quantity: 1, price: '', stato: '', note_operative: '', note_integrative: '' }],
    })
  const patchServizio = (card: UscitaVehicleCard, idx: number, patch: Partial<UscitaServizioExtra>) =>
    patchCard(card.localId, { servizi_extra: card.servizi_extra.map((s, i) => (i === idx ? { ...s, ...patch } : s)) })
  const removeServizio = (card: UscitaVehicleCard, idx: number) =>
    patchCard(card.localId, { servizi_extra: card.servizi_extra.filter((_, i) => i !== idx) })

  async function handleCreateAutista() {
    const full = `${newAutista.nome} ${newAutista.cognome}`.trim()
    if (!full) { toast.error('Inserisci almeno il nome'); return }
    setCreatingAutista(true)
    try {
      const res = await authFetch('/.netlify/functions/autisti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...newAutista }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.autista) {
        toast.success(`Autista "${data.autista.full_name}" creato`)
        setAutisti(prev => [...prev, data.autista].sort((a, b) => a.full_name.localeCompare(b.full_name)))
        setShowNewAutista(false)
        setNewAutista({ nome: '', cognome: '', telefono: '' })
      } else {
        toast.error('Autista non creato: ' + (data.error || res.statusText))
      }
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setCreatingAutista(false)
    }
  }

  const toIso = (date: string, time: string) => {
    if (!date) return null
    return `${date}T${time || '00:00'}:00`
  }

  function paymentStatusForCard(card: UscitaVehicleCard): string {
    switch (card.payment.state) {
      case 'Già pagato': return 'paid'
      case 'Pagamento parziale': return 'partial'
      case 'Da incassare': return 'pending'
      case 'Non previsto':
      default: return 'paid' // nulla da incassare → non resta in Da Saldare
    }
  }

  async function handleSave() {
    // Validate cards
    const valid = cards.filter(c => c.vehicle_id && c.pickup_date)
    if (valid.length === 0) {
      toast.error('Aggiungi almeno un veicolo con data di ritiro.')
      return
    }

    setSaving(true)
    const groupId = uid()
    const autistiSnapshot = (ids: string[]) =>
      ids.map(id => { const a = autisti.find(x => x.id === id); return a ? { id: a.id, full_name: a.full_name, phone: a.phone } : { id, full_name: '', phone: '' } })

    try {
      // Conflict check per card: same vehicle overlapping a non-cancelled booking
      // (excluding the linked booking the uscita serves).
      for (const c of valid) {
        const pickIso = toIso(c.pickup_date, c.pickup_time)
        const dropIso = toIso(c.dropoff_date || c.pickup_date, c.dropoff_time) || pickIso
        if (!pickIso) continue
        const { data: clash } = await supabase
          .from('bookings')
          .select('id, customer_name, pickup_date, dropoff_date, booking_details')
          .eq('vehicle_id', c.vehicle_id)
          .not('status', 'in', '(cancelled,annullata)')
          .lte('pickup_date', dropIso)
          .gte('dropoff_date', pickIso)
        const realClash = (clash || []).find(b => b.id !== c.linked_booking_id)
        if (realClash) {
          const v = vehicles.find(x => x.id === c.vehicle_id)
          toast.error(`Veicolo ${v?.display_name || ''} già occupato nell'intervallo selezionato (${realClash.customer_name || 'prenotazione'}).`, { duration: 9000 })
          setSaving(false)
          return
        }
      }

      const rows = valid.map(c => {
        const v = vehicles.find(x => x.id === c.vehicle_id)
        const pickIso = toIso(c.pickup_date, c.pickup_time)
        const dropIso = toIso(c.dropoff_date || c.pickup_date, c.dropoff_time) || pickIso
        const payStatus = paymentStatusForCard(c)
        const priceCents = c.payment.amount ? eurToCents(c.payment.amount) : 0
        const label = (title.trim() || c.motivazioni[0] || 'Uscita Straordinaria')
        return {
          service_type: USCITA_SERVICE_TYPE,
          vehicle_type: 'car',
          vehicle_id: c.vehicle_id,
          vehicle_name: v?.display_name || '',
          vehicle_plate: c.plate || v?.plate || null,
          customer_name: `Uscita: ${label}`,
          pickup_date: pickIso,
          dropoff_date: dropIso,
          pickup_location: c.pickup_place || '',
          dropoff_location: c.dropoff_place || '',
          price_total: priceCents,
          currency: 'EUR',
          status: uscitaStatoToBookingStatus(stato),
          payment_status: payStatus,
          payment_method: c.payment.method || null,
          amount_paid: payStatus === 'paid' ? priceCents : eurToCents(c.payment.amount && c.payment.state === 'Pagamento parziale' ? '0' : '0'),
          booking_details: {
            amountPaid: payStatus === 'paid' ? priceCents : 0,
            uscita: {
              group_id: groupId,
              title: title.trim(),
              stato,
              autista_ids: c.autista_ids,
              autisti: autistiSnapshot(c.autista_ids),
              vehicle_to_drive: c.vehicle_to_drive,
              pickup: { date: c.pickup_date, time: c.pickup_time, place: c.pickup_place, address: c.pickup_address },
              dropoff: { date: c.dropoff_date, time: c.dropoff_time, place: c.dropoff_place, address: c.dropoff_address },
              motivazioni: c.motivazioni,
              linked_booking_id: c.linked_booking_id,
              payment: c.payment,
              cauzione: c.cauzione,
              servizi_extra: c.servizi_extra,
              note_operative: c.note_operative || noteOperative,
              note_integrative: c.note_integrative || noteIntegrative,
            },
          },
        }
      })

      const { error } = await supabase.from('bookings').insert(rows)
      if (error) throw error

      toast.success(`Uscita Straordinaria salvata (${rows.length} veicolo${rows.length > 1 ? 'i' : ''}).`)
      onSaved?.()
      onClose()
    } catch (e) {
      console.error('[UscitaStraordinaria] save error:', e)
      toast.error('Errore salvataggio: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  const vehicleOptions = [{ value: '', label: '— Seleziona veicolo —' }, ...vehicles.map(v => ({ value: v.id, label: `${v.display_name}${v.plate ? ` (${v.plate})` : ''}` }))]
  const luogoOptions = [{ value: '', label: '—' }, ...USCITA_LUOGHI.map(l => ({ value: l, label: l }))]

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-4">
      <div className="w-full max-w-4xl my-4 rounded-2xl bg-theme-bg-primary border border-theme-border shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-theme-border bg-theme-bg-primary px-5 py-4 rounded-t-2xl">
          <h2 className="text-lg font-bold text-theme-text-primary">+ Uscita Straordinaria</h2>
          <button onClick={onClose} aria-label="Chiudi" className="flex h-9 w-9 items-center justify-center rounded-full bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary text-xl">×</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Operation header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Titolo uscita" value={title} onChange={e => setTitle(e.target.value)} placeholder="Es. Consegne mattina sabato" />
            <Select label="Stato" value={stato} onChange={e => setStato(e.target.value as UscitaStato)} options={USCITA_STATI.map(s => ({ value: s, label: s }))} />
          </div>

          {/* Autisti registry */}
          <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-theme-text-primary">Autisti disponibili {loadingAutisti && <span className="text-theme-text-muted">(caricamento…)</span>}</span>
              <button type="button" onClick={() => setShowNewAutista(v => !v)} className="text-xs underline text-dr7-gold">+ Nuovo Autista</button>
            </div>
            {showNewAutista && (
              <div className="mb-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <Input label="Nome" value={newAutista.nome} onChange={e => setNewAutista(s => ({ ...s, nome: e.target.value }))} />
                <Input label="Cognome" value={newAutista.cognome} onChange={e => setNewAutista(s => ({ ...s, cognome: e.target.value }))} />
                <Input label="Telefono (WhatsApp)" value={newAutista.telefono} onChange={e => setNewAutista(s => ({ ...s, telefono: e.target.value }))} placeholder="+39…" />
                <Button type="button" onClick={handleCreateAutista} disabled={creatingAutista} className="text-sm">{creatingAutista ? 'Salvataggio…' : 'Salva autista'}</Button>
              </div>
            )}
            <p className="text-[11px] text-theme-text-muted">Gli autisti selezionati per ogni veicolo riceveranno la notifica con il mezzo assegnato. Salvati nei Clienti/Lead con tag “Autista”.</p>
          </div>

          {/* Vehicle cards */}
          {cards.map((card, idx) => {
            const driveOptions = [{ value: '', label: '— Stesso veicolo —' }, ...vehicles.map(v => ({ value: v.id, label: `${v.display_name}${v.plate ? ` (${v.plate})` : ''}` }))]
            return (
              <div key={card.localId} className="rounded-xl border border-theme-border bg-theme-bg-secondary/40 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-theme-text-primary">Veicolo / Tratta #{idx + 1}</span>
                  {cards.length > 1 && (
                    <button type="button" onClick={() => removeCard(card.localId)} className="text-xs text-red-400 hover:text-red-300">Rimuovi</button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Veicolo" value={card.vehicle_id} onChange={e => patchCard(card.localId, { vehicle_id: e.target.value, plate: vehicles.find(v => v.id === e.target.value)?.plate || '' })} options={vehicleOptions} />
                  <Input label="Targa" value={card.plate} onChange={e => patchCard(card.localId, { plate: e.target.value })} placeholder="auto da veicolo" />
                </div>

                {/* Autisti for this card + vehicle to drive */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">Autisti assegnati</label>
                  <div className="flex flex-wrap gap-2">
                    {autisti.length === 0 && <span className="text-xs text-theme-text-muted">Nessun autista — aggiungine uno sopra.</span>}
                    {autisti.map(a => {
                      const active = card.autista_ids.includes(a.id)
                      return (
                        <button key={a.id} type="button" onClick={() => toggleAutista(card, a.id)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${active ? 'bg-dr7-gold text-black border-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border'}`}>
                          {a.full_name}{!a.phone && ' (no tel.)'}
                        </button>
                      )
                    })}
                  </div>
                  {card.autista_ids.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {card.autista_ids.map(aid => {
                        const a = autisti.find(x => x.id === aid)
                        return (
                          <div key={aid} className="flex items-center gap-2">
                            <span className="text-xs text-theme-text-muted w-32 shrink-0 truncate">{a?.full_name || aid} guida:</span>
                            <select value={card.vehicle_to_drive[aid] || ''} onChange={e => patchCard(card.localId, { vehicle_to_drive: { ...card.vehicle_to_drive, [aid]: e.target.value } })}
                              className="flex-1 bg-theme-bg-secondary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary">
                              {driveOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Motivazioni */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">Motivazione</label>
                  <div className="flex flex-wrap gap-2">
                    {USCITA_MOTIVAZIONI.map(m => {
                      const active = card.motivazioni.includes(m)
                      return (
                        <button key={m} type="button" onClick={() => toggleMotivazione(card, m)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border'}`}>
                          {m}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Pickup / Dropoff */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-theme-text-muted">Partenza</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Data" type="date" value={card.pickup_date} onChange={e => patchCard(card.localId, { pickup_date: e.target.value })} />
                      <Select label="Ora" value={card.pickup_time} onChange={e => patchCard(card.localId, { pickup_time: e.target.value })} options={TIME_OPTIONS} />
                    </div>
                    <Select label="Luogo" value={card.pickup_place} onChange={e => patchCard(card.localId, { pickup_place: e.target.value })} options={luogoOptions} />
                    <div>
                      <label className="block text-sm font-medium text-theme-text-primary mb-2">Indirizzo preciso</label>
                      <AddressAutocomplete value={card.pickup_address} onChange={v => patchCard(card.localId, { pickup_address: v })} placeholder="Via, civico, CAP, città" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-theme-text-muted">Destinazione</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Data" type="date" value={card.dropoff_date} onChange={e => patchCard(card.localId, { dropoff_date: e.target.value })} />
                      <Select label="Ora" value={card.dropoff_time} onChange={e => patchCard(card.localId, { dropoff_time: e.target.value })} options={TIME_OPTIONS} />
                    </div>
                    <Select label="Luogo" value={card.dropoff_place} onChange={e => patchCard(card.localId, { dropoff_place: e.target.value })} options={luogoOptions} />
                    <div>
                      <label className="block text-sm font-medium text-theme-text-primary mb-2">Indirizzo preciso</label>
                      <AddressAutocomplete value={card.dropoff_address} onChange={v => patchCard(card.localId, { dropoff_address: v })} placeholder="Via, civico, CAP, città" />
                    </div>
                  </div>
                </div>

                {/* Linked booking — ricerca per cliente / veicolo / targa */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">Collega a Booking (opzionale)</label>
                  <BookingLinkPicker value={card.linked_booking_id} onChange={id => patchCard(card.localId, { linked_booking_id: id })} />
                  <p className="mt-1 text-[11px] text-theme-text-muted">Se l'auto esce per servire questa prenotazione, non viene segnalato conflitto.</p>
                </div>

                {/* Payment + Cauzione */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-theme-text-muted">Pagamento</div>
                    <Select value={card.payment.state} onChange={e => patchCard(card.localId, { payment: { ...card.payment, state: e.target.value as typeof card.payment.state } })} options={USCITA_PAYMENT_STATES.map(s => ({ value: s, label: s }))} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Importo €" type="number" step="0.01" value={card.payment.amount} onChange={e => patchCard(card.localId, { payment: { ...card.payment, amount: e.target.value } })} />
                      <Input label="Metodo" value={card.payment.method} onChange={e => patchCard(card.localId, { payment: { ...card.payment, method: e.target.value } })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-theme-text-muted">Cauzione</div>
                    <Select value={card.cauzione.state} onChange={e => patchCard(card.localId, { cauzione: { ...card.cauzione, state: e.target.value as typeof card.cauzione.state } })} options={USCITA_CAUZIONE_STATES.map(s => ({ value: s, label: s }))} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Importo €" type="number" step="0.01" value={card.cauzione.amount} onChange={e => patchCard(card.localId, { cauzione: { ...card.cauzione, amount: e.target.value } })} />
                      <Input label="Metodo" value={card.cauzione.method} onChange={e => patchCard(card.localId, { cauzione: { ...card.cauzione, method: e.target.value } })} />
                    </div>
                  </div>
                </div>

                {/* Servizi extra */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-theme-text-primary">Servizi extra</label>
                    <button type="button" onClick={() => addServizio(card)} className="text-xs underline text-dr7-gold">+ Aggiungi servizio</button>
                  </div>
                  {card.servizi_extra.map((s, i) => (
                    <div key={i} className="mb-2 grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <select value={USCITA_SERVIZI_EXTRA.includes(s.name as typeof USCITA_SERVIZI_EXTRA[number]) ? s.name : (s.name ? '__custom__' : '')}
                          onChange={e => patchServizio(card, i, { name: e.target.value === '__custom__' ? '' : e.target.value })}
                          className="w-full bg-theme-bg-secondary border border-theme-border rounded px-2 py-1.5 text-xs text-theme-text-primary">
                          <option value="">— Servizio —</option>
                          {USCITA_SERVIZI_EXTRA.map(x => <option key={x} value={x}>{x}</option>)}
                          <option value="__custom__">Personalizzato…</option>
                        </select>
                        {!USCITA_SERVIZI_EXTRA.includes(s.name as typeof USCITA_SERVIZI_EXTRA[number]) && (
                          <input value={s.name} onChange={e => patchServizio(card, i, { name: e.target.value })} placeholder="Nome servizio" className="mt-1 w-full bg-theme-bg-secondary border border-theme-border rounded px-2 py-1.5 text-xs text-theme-text-primary" />
                        )}
                      </div>
                      <input type="number" min={1} value={s.quantity} onChange={e => patchServizio(card, i, { quantity: Number(e.target.value) || 1 })} className="col-span-2 bg-theme-bg-secondary border border-theme-border rounded px-2 py-1.5 text-xs text-theme-text-primary" placeholder="Qtà" />
                      <input type="number" step="0.01" value={s.price} onChange={e => patchServizio(card, i, { price: e.target.value })} className="col-span-3 bg-theme-bg-secondary border border-theme-border rounded px-2 py-1.5 text-xs text-theme-text-primary" placeholder="Prezzo €" />
                      <button type="button" onClick={() => removeServizio(card, i)} className="col-span-2 text-xs text-red-400 hover:text-red-300">Rimuovi</button>
                    </div>
                  ))}
                </div>

                {/* Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-primary mb-2">Note operative</label>
                    <textarea value={card.note_operative} onChange={e => patchCard(card.localId, { note_operative: e.target.value })} rows={2} className="w-full bg-theme-bg-secondary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-primary mb-2">Note integrative (in notifica autista)</label>
                    <textarea value={card.note_integrative} onChange={e => patchCard(card.localId, { note_integrative: e.target.value })} rows={2} className="w-full bg-theme-bg-secondary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
                  </div>
                </div>
              </div>
            )
          })}

          <button type="button" onClick={addCard} className="w-full rounded-xl border border-dashed border-theme-border py-3 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary hover:border-dr7-gold">
            + Aggiungi veicolo / tratta
          </button>

          {/* Global notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">Note operative (generali)</label>
              <textarea value={noteOperative} onChange={e => setNoteOperative(e.target.value)} rows={2} className="w-full bg-theme-bg-secondary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-2">Note integrative (generali)</label>
              <textarea value={noteIntegrative} onChange={e => setNoteIntegrative(e.target.value)} rows={2} className="w-full bg-theme-bg-secondary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-theme-border bg-theme-bg-primary px-5 py-4 rounded-b-2xl">
          <Button type="button" variant="secondary" onClick={onClose}>Annulla</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva Uscita'}</Button>
        </div>
      </div>
    </div>
  )
}
