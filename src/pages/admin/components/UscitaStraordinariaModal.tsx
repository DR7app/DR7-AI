import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import Button from './Button'
import Input from './Input'
import Select from './Select'
import AddressAutocomplete from './AddressAutocomplete'
import NewClientModal from './NewClientModal'
import {
  USCITA_SERVICE_TYPE,
  USCITA_MOTIVAZIONI,
  USCITA_LUOGHI,
  USCITA_SERVIZI_EXTRA,
  USCITA_PAYMENT_STATES,
  USCITA_CAUZIONE_STATES,
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
  // 2026-06-03: rimosse le note globali a livello modal — direzione vuole
  // UNA sola textarea "Note" per card. Le due variabili sotto restano per
  // backward-compat coi reset (init/save) ma sono sempre stringa vuota.
  const noteOperative = ''
  const noteIntegrative = ''
  const [cards, setCards] = useState<UscitaVehicleCard[]>([emptyVehicleCard(uid())])
  const [saving, setSaving] = useState(false)

  // Autisti registry (customers tagged metadata.role='autista')
  const [autisti, setAutisti] = useState<Autista[]>([])
  const [loadingAutisti, setLoadingAutisti] = useState(false)
  // 2026-06-03: il vecchio mini-form inline (showNewAutista + handleCreateAutista)
  // e' stato sostituito dal NewClientModal completo. Cosi' l'admin riempie tutti
  // i campi del cliente (CF, indirizzo, ecc.) e seleziona il badge "Autista".
  // Tag metadata.role='autista' viene aggiunto automaticamente al salvataggio
  // via metadata pre-popolata.
  const [clientModalOpen, setClientModalOpen] = useState(false)

  // 2026-06-03: Luoghi di Partenza/Destinazione presi da Centralina Pro
  // (servizi.pickup_locations) — stessa lista del Booking form. Prima la
  // tendina mostrava categorie (Gommista/Carrozzeria/Officina/ecc.) che sono
  // gia' nel campo Motivazione → UX duplicata e sbagliata.
  const [proLocations, setProLocations] = useState<Array<{ id: string; label: string; fee: number }>>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config as { pickup_locations?: Array<{ id: string; label: string; is_active?: boolean; fee?: number; km?: number }>; delivery?: { price_per_km?: number } } | null) || {}
      const rate = Number(cfg.delivery?.price_per_km) || 0
      const list = (cfg.pickup_locations || [])
        .filter(p => p.is_active !== false)
        .map(p => ({
          id: p.id,
          label: p.label,
          fee: p.fee != null ? Number(p.fee) : Math.round((Number(p.km) || 0) * rate * 100) / 100,
        }))
      setProLocations(list)
    })()
    return () => { cancelled = true }
  }, [])

  // LOCATIONS: stessa shape del Booking form. Built-ins + Pro + domicilio.
  const luogoOptionsFromPro = useMemo(() => [
    { value: 'dr7_office', label: 'Viale Marconi, 229, 09131 Cagliari CA' },
    ...proLocations.map(p => ({
      value: p.id,
      label: p.fee > 0 ? `${p.label} (+€${p.fee.toFixed(2)})` : p.label,
    })),
    { value: 'domicilio', label: 'Consegna a domicilio (inserisci indirizzo)' },
  ], [proLocations])

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
    // 2026-06-03: noteOperative/noteIntegrative globali rimossi → niente reset.
    setCards([emptyVehicleCard(uid())])
    setClientModalOpen(false)
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

  // 2026-06-03: handleCreateAutista (mini-form inline) sostituito da
  // onClientCreated callback del NewClientModal. Quando l'admin salva il
  // cliente con metadata.role='autista' pre-popolato, il modal si chiude
  // e la lista autisti viene ricaricata automaticamente.
  async function handleClientCreated(newClientId: string) {
    // 1. Se il cliente appena creato e' un autista, lo aggancia subito
    //    al tag via /.netlify/functions/autisti?action=toggle. Cosi'
    //    chi non sapeva del badge metadata "role:autista" e' coperto
    //    automaticamente.
    try {
      await authFetch('/.netlify/functions/autisti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_role', customerId: newClientId, isAutista: true }),
      })
    } catch (err) {
      console.warn('[UscitaStraordinaria] set_role autista tag fallito (non fatale):', err)
    }
    // 2. Ricarica la lista autisti — la nuova persona ora appare nel dropdown.
    await loadAutisti()
    setClientModalOpen(false)
    toast.success('Autista creato e taggato')
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
        // 2026-06-04: data di ritorno opzionale (consegna/sola andata). Se
        // manca, l'uscita è un evento di UN solo giorno → dropoff = pickup.
        const dropIso = c.dropoff_date ? (toIso(c.dropoff_date, c.dropoff_time) || pickIso) : pickIso
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
        // 2026-06-04: ritorno opzionale → uscita di un solo giorno se assente.
        const dropIso = c.dropoff_date ? (toIso(c.dropoff_date, c.dropoff_time) || pickIso) : pickIso
        const payStatus = paymentStatusForCard(c)
        const priceCents = c.payment.amount ? eurToCents(c.payment.amount) : 0
        const label = (title.trim() || c.motivazioni[0] || 'Uscita Straordinaria')
        return {
          service_type: USCITA_SERVICE_TYPE,
          vehicle_type: 'car',
          // 2026-06-03: bookings ha CHECK constraint
          // (booking_source IN ('website','admin','api')). Senza questo
          // valore l'insert tornava 400 silenzioso (PostgREST non
          // verbalizza il check failed nel response body).
          booking_source: 'admin',
          vehicle_id: c.vehicle_id,
          vehicle_name: v?.display_name || '',
          vehicle_plate: c.plate || v?.plate || null,
          customer_name: `Uscita: ${label}`,
          // bookings ha un CHECK (user_id IS NOT NULL OR guest_name <> ''):
          // l'uscita è interna (nessun cliente) → usiamo guest_name per
          // soddisfare il vincolo, altrimenti l'insert torna 400.
          guest_name: `Uscita: ${label}`,
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

      // Notifiche bot per-autista: ognuno riceve SOLO le sue attività.
      const byAutista = new Map<string, UscitaVehicleCard[]>()
      for (const c of valid) for (const aid of c.autista_ids) {
        if (!byAutista.has(aid)) byAutista.set(aid, [])
        byAutista.get(aid)!.push(c)
      }
      // 2026-06-03: notifica autista via template Pro (key pro_uscita_autista).
      // Se il template non e' configurato in Messaggi di Sistema Pro, fallback
      // a customMessage hardcoded col template ufficiale fornito direzione.
      // Una notifica PER OGNI CARD (uscita assegnata) — l'autista riceve un
      // messaggio per ciascun veicolo, ognuno con i suoi dettagli.
      const fmtDate = (d: string) => (d ? d.split('-').reverse().join('/') : '—')
      const lookupBookingRef = async (bookingId: string | null): Promise<string> => {
        if (!bookingId) return '—'
        try {
          const { data } = await supabase
            .from('bookings')
            .select('id, customer_name, vehicle_name, vehicle_plate')
            .eq('id', bookingId)
            .maybeSingle()
          if (!data) return `#${bookingId.slice(0, 8).toUpperCase()}`
          const ref = `#${String(data.id).slice(0, 8).toUpperCase()}`
          const who = data.customer_name || ''
          const what = `${data.vehicle_name || ''}${data.vehicle_plate ? ` (${data.vehicle_plate})` : ''}`.trim()
          return [ref, who, what].filter(Boolean).join(' · ')
        } catch { return `#${bookingId.slice(0, 8).toUpperCase()}` }
      }
      let notified = 0
      let noPhone = 0
      for (const [aid, aCards] of byAutista) {
        const a = autisti.find(x => x.id === aid)
        if (!a) continue
        if (!a.phone) { noPhone++; continue }
        const firstName = (a.full_name || '').split(' ')[0] || a.full_name || 'Autista'
        for (const c of aCards) {
          const driveV = vehicles.find(v => v.id === (c.vehicle_to_drive[aid] || c.vehicle_id))
          const bookingRefStr = await lookupBookingRef(c.linked_booking_id)
          const svcExtras = c.servizi_extra
            .map(s => [s.name, s.quantity > 1 ? `x${s.quantity}` : '', s.price ? `€${s.price}` : ''].filter(Boolean).join(' '))
            .filter(Boolean)
            .join(', ')
          const payStr = c.payment.state === 'Non previsto'
            ? 'Non previsto'
            : `${c.payment.state}${c.payment.amount ? ` €${c.payment.amount}` : ''}`
          const cauStr = c.cauzione.state === 'Non prevista'
            ? 'Non prevista'
            : `${c.cauzione.state}${c.cauzione.amount ? ` €${c.cauzione.amount}` : ''}`
          const noteInt = (c.note_integrative || noteIntegrative || '').trim() || '—'
          const motivazione = c.motivazioni.length ? c.motivazioni.join(', ') : '—'
          // 2026-06-03: splitta il luogo in NOME (citta'/posto) + INDIRIZZO
          // (via). Direzione vuole che il messaggio autista mostri:
          //   Luogo ritiro: DR7 Office Cagliari
          //   Indirizzo ritiro: Viale Marconi 229
          // Prima il template sostituiva {luogo_ritiro} con l'id grezzo
          // (es. 'dr7_office') oppure con tutto l'indirizzo concatenato.
          // luogoParts() ritorna { name, address } per ogni location id.
          const luogoParts = (placeId: string, freeAddress: string): { name: string; address: string } => {
            if (!placeId) return { name: '—', address: freeAddress || '—' }
            if (placeId === 'dr7_office') {
              // Sede DR7 — hardcoded perche' la PickupLocation schema non
              // separa name/address (label = solo indirizzo lungo).
              return { name: 'DR7 Office Cagliari', address: 'Viale Marconi 229' }
            }
            if (placeId === 'domicilio') {
              return { name: 'Domicilio', address: freeAddress || '—' }
            }
            // Pro locations (aeroporti, porti, hotel) — usiamo la label
            // come name. La schema PickupLocation non ha address dedicato,
            // quindi address resta '—' (o l'indirizzo libero se compilato).
            const opt = luogoOptionsFromPro.find(o => o.value === placeId)
            const baseLabel = opt?.label || placeId
            // Rimuove il suffisso fee per il name (es. "Aeroporto Cagliari
            // Elmas (+€27.00)" → "Aeroporto Cagliari Elmas").
            const cleanName = baseLabel.replace(/\s*\(\+€[\d.,]+\)\s*$/, '').trim()
            return { name: cleanName, address: freeAddress || '—' }
          }
          const partenza = luogoParts(c.pickup_place, c.pickup_address)
          const ritorno = luogoParts(c.dropoff_place, c.dropoff_address)
          const templateVars: Record<string, string> = {
            nome_autista: firstName,
            veicolo: driveV?.display_name || '',
            targa: driveV?.plate || c.plate || '—',
            data_ritiro: fmtDate(c.pickup_date),
            ora_ritiro: c.pickup_time || '—',
            luogo_ritiro: partenza.name,
            indirizzo_ritiro: partenza.address,
            data_riconsegna: fmtDate(c.dropoff_date),
            ora_riconsegna: c.dropoff_time || '—',
            luogo_riconsegna: ritorno.name,
            indirizzo_riconsegna: ritorno.address,
            motivazione_uscita: motivazione,
            booking_collegato: bookingRefStr,
            stato_pagamento: payStr,
            stato_cauzione: cauStr,
            servizi_extra: svcExtras || '—',
            note_integrative: noteInt,
          }
          // Fallback hardcoded — testo ufficiale direzione 2026-06-03.
          const fallbackMsg = `Salve ${templateVars.nome_autista},
ti è stata assegnata una nuova uscita straordinaria.

Dettagli incarico:
• Veicolo assegnato: ${templateVars.veicolo}
• Targa: ${templateVars.targa}
• Data ritiro: ${templateVars.data_ritiro}
• Ora ritiro: ${templateVars.ora_ritiro}
• Luogo ritiro: ${templateVars.luogo_ritiro}
• Indirizzo ritiro: ${templateVars.indirizzo_ritiro}
• Data riconsegna: ${templateVars.data_riconsegna}
• Ora riconsegna: ${templateVars.ora_riconsegna}
• Luogo riconsegna: ${templateVars.luogo_riconsegna}
• Indirizzo riconsegna: ${templateVars.indirizzo_riconsegna}
• Motivazione uscita: ${templateVars.motivazione_uscita}
• Booking collegato: ${templateVars.booking_collegato}

Condizioni operative:
• Pagamento: ${templateVars.stato_pagamento}
• Cauzione: ${templateVars.stato_cauzione}
• Servizi extra / experience: ${templateVars.servizi_extra}

Note integrative:
${templateVars.note_integrative}

Ti chiediamo gentilmente di verificare tutti i dettagli prima dell'uscita e di rispettare gli orari indicati.

Grazie per la collaborazione.
DR7`
          try {
            // 2026-06-03: lookup template per LABEL (la modale Messaggi di
            // Sistema Pro non espone il campo message_key — auto-generato dal
            // backend al salvataggio). Direzione ha chiamato il template
            // "Notifica Autista — Uscita Straordinaria". Stesso pattern di
            // Preventivi / Status Promotion (memory: preventivi_template_keys.md).
            const LABEL = 'Notifica Autista — Uscita Straordinaria'
            const { data: tpl } = await supabase
              .from('system_messages')
              .select('message_body, is_enabled')
              .eq('label', LABEL)
              .maybeSingle()
            let body = ''
            if (tpl && tpl.is_enabled !== false && tpl.message_body) {
              // Sostituisce manualmente le variabili — niente template engine
              // server-side perche' qui passiamo customMessage.
              body = tpl.message_body
              for (const [k, v] of Object.entries(templateVars)) {
                body = body.split(`{${k}}`).join(v)
              }
            } else {
              // Fallback hardcoded col testo ufficiale direzione.
              body = fallbackMsg
            }
            await fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customPhone: a.phone, customMessage: body, type: 'Uscita Straordinaria Autista' }),
            })
            notified++
          } catch (e) {
            console.warn('[UscitaStraordinaria] notifica autista fallita:', a.full_name, e)
          }
        }
      }

      const notifyMsg = notified > 0 ? ` · ${notified} autista notificat${notified > 1 ? 'i' : 'o'}` : ''
      const noPhoneMsg = noPhone > 0 ? ` (${noPhone} senza telefono)` : ''
      toast.success(`Uscita Straordinaria salvata (${rows.length} veicolo${rows.length > 1 ? 'i' : ''})${notifyMsg}${noPhoneMsg}.`)
      onSaved?.()
      onClose()
    } catch (e) {
      console.error('[UscitaStraordinaria] save error:', e)
      // Estrai un messaggio leggibile anche dagli errori PostgREST (oggetti
      // con message/details/hint) invece del generico "[object Object]".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const er = e as any
      const msg = e instanceof Error ? e.message
        : (er?.message || er?.details || er?.hint || er?.error || (er ? JSON.stringify(er) : 'Errore sconosciuto'))
      toast.error('Errore salvataggio: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  const vehicleOptions = [{ value: '', label: '— Seleziona veicolo —' }, ...vehicles.map(v => ({ value: v.id, label: `${v.display_name}${v.plate ? ` (${v.plate})` : ''}` }))]
  // luogoOptions per le tendine Partenza/Destinazione: sorgente unica = Centralina Pro.
  // Includiamo il placeholder vuoto in cima per "non selezionato".
  const luogoOptions = [{ value: '', label: '—' }, ...luogoOptionsFromPro]
  void USCITA_LUOGHI // legacy export: non piu' usato, conservato per backward-compat

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
          {/* 2026-06-04: campo "Stato" rimosso dalla creazione — una nuova
              uscita parte sempre come 'Programmata'. Lo stato si gestisce dopo,
              dal calendario / lista. */}
          <div className="grid grid-cols-1 gap-3">
            <Input label="Titolo uscita" value={title} onChange={e => setTitle(e.target.value)} placeholder="Es. Consegne mattina sabato" />
          </div>

          {/* Autisti registry */}
          <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-theme-text-primary">Autisti disponibili {loadingAutisti && <span className="text-theme-text-muted">(caricamento…)</span>}</span>
              {/* 2026-06-03: apre NewClientModal con il tag autista pre-impostato
                  invece del vecchio mini-form inline. Cosi' l'admin riempie tutti
                  i campi (CF, indirizzo, patente, ecc.) e l'autista viene
                  salvato in customers_extended come cliente completo + taggato. */}
              <button
                type="button"
                onClick={() => setClientModalOpen(true)}
                className="text-xs underline text-dr7-gold cursor-pointer"
              >
                + Nuovo Autista
              </button>
            </div>
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
                  {/* Dropdown: scala con molti autisti. Seleziona → si aggiunge
                      alla lista sotto (con veicolo da guidare + rimuovi). */}
                  <select
                    value=""
                    onChange={e => {
                      const v = e.target.value
                      if (!v) return
                      // 2026-06-03: opzione speciale "__new__" apre NewClientModal
                      // direttamente dal dropdown invece di costringere l'admin a
                      // tornare in alto al panel "+ Nuovo Autista". UX critica
                      // quando la lista autisti e' vuota.
                      if (v === '__new__') {
                        setClientModalOpen(true)
                        return
                      }
                      toggleAutista(card, v)
                    }}
                    className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary"
                  >
                    <option value="">+ Aggiungi autista…</option>
                    <option value="__new__">➕ Crea nuovo autista…</option>
                    {autisti.filter(a => !card.autista_ids.includes(a.id)).map(a => (
                      <option key={a.id} value={a.id}>{a.full_name}{!a.phone ? ' (no tel.)' : ''}</option>
                    ))}
                  </select>
                  {autisti.length === 0 && <p className="mt-1 text-xs text-theme-text-muted">Nessun autista in archivio — seleziona “Crea nuovo autista” dal menu o usa il pulsante “+ Nuovo Autista” in alto.</p>}
                  {card.autista_ids.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {card.autista_ids.map(aid => {
                        const a = autisti.find(x => x.id === aid)
                        return (
                          <div key={aid} className="flex items-center gap-2 rounded-lg bg-theme-bg-tertiary/40 border border-theme-border px-2 py-1.5">
                            <span className="text-xs font-medium text-theme-text-primary w-28 shrink-0 truncate">{a?.full_name || aid}</span>
                            <span className="text-[11px] text-theme-text-muted shrink-0">guida:</span>
                            <select value={card.vehicle_to_drive[aid] || ''} onChange={e => patchCard(card.localId, { vehicle_to_drive: { ...card.vehicle_to_drive, [aid]: e.target.value } })}
                              className="flex-1 min-w-0 bg-theme-bg-secondary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary">
                              {driveOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <button type="button" onClick={() => toggleAutista(card, aid)} className="text-red-400 hover:text-red-300 text-base shrink-0 px-1 leading-none" title="Rimuovi autista">×</button>
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
                    <Select label="Luogo" value={card.pickup_place} onChange={e => {
                      const v = e.target.value
                      // Se cambi via dal domicilio, pulisci l'indirizzo libero.
                      patchCard(card.localId, { pickup_place: v, ...(v !== 'domicilio' ? { pickup_address: '' } : {}) })
                    }} options={luogoOptions} />
                    {/* 2026-06-03: AddressAutocomplete solo per "Consegna a
                        domicilio", come nel Booking form. Per gli altri luoghi
                        (aeroporti, sede DR7) l'indirizzo e' implicito. */}
                    {card.pickup_place === 'domicilio' && (
                      <div>
                        <label className="block text-sm font-medium text-theme-text-primary mb-2">Indirizzo</label>
                        <AddressAutocomplete value={card.pickup_address} onChange={v => patchCard(card.localId, { pickup_address: v })} placeholder="Via, civico, CAP, città" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-theme-text-muted">Destinazione <span className="normal-case font-normal text-theme-text-muted">— ritorno opzionale</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Data (opzionale)" type="date" value={card.dropoff_date} onChange={e => patchCard(card.localId, { dropoff_date: e.target.value })} />
                      <Select label="Ora" value={card.dropoff_time} onChange={e => patchCard(card.localId, { dropoff_time: e.target.value })} options={TIME_OPTIONS} />
                    </div>
                    <Select label="Luogo" value={card.dropoff_place} onChange={e => {
                      const v = e.target.value
                      patchCard(card.localId, { dropoff_place: v, ...(v !== 'domicilio' ? { dropoff_address: '' } : {}) })
                    }} options={luogoOptions} />
                    {card.dropoff_place === 'domicilio' && (
                      <div>
                        <label className="block text-sm font-medium text-theme-text-primary mb-2">Indirizzo</label>
                        <AddressAutocomplete value={card.dropoff_address} onChange={v => patchCard(card.localId, { dropoff_address: v })} placeholder="Via, civico, CAP, città" />
                      </div>
                    )}
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

                {/* Servizi extra — sezione in evidenza (importante per
                    experience: champagne, allestimenti, transfer luxury…). */}
                <div className="rounded-xl border-2 border-theme-border bg-theme-bg-tertiary/40 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-theme-text-primary text-lg leading-none">★</span>
                    <label className="text-base font-bold text-theme-text-primary">Servizi Extra / Experience</label>
                    {card.servizi_extra.length > 0 && (
                      <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-theme-bg-tertiary text-theme-text-primary border border-theme-border">{card.servizi_extra.length}</span>
                    )}
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
                  <button
                    type="button"
                    onClick={() => addServizio(card)}
                    className="w-full mt-1 py-2.5 rounded-lg border-2 border-dashed border-theme-border text-theme-text-primary font-bold text-sm hover:bg-theme-bg-hover hover:border-theme-text-muted transition-colors"
                  >
                    + Aggiungi servizio extra
                  </button>
                </div>

                {/* 2026-06-03: UNA sola textarea "Note" per card. Prima
                    c'erano 4 campi (note_operative + note_integrative per
                    card, e gli stessi due a livello globale) — direzione si
                    lamentava della duplicazione. La nota va sia nel WhatsApp
                    autista ({note_integrative}) sia nei booking_details. */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">Note</label>
                  <textarea value={card.note_integrative} onChange={e => patchCard(card.localId, { note_integrative: e.target.value, note_operative: e.target.value })} rows={3} placeholder="Indicazioni per l'autista, dettagli operativi, riferimenti…" className="w-full bg-theme-bg-secondary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
                </div>
              </div>
            )
          })}

          <button type="button" onClick={addCard} className="w-full rounded-xl border border-dashed border-theme-border py-3 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary hover:border-dr7-gold">
            + Aggiungi veicolo / tratta
          </button>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-theme-border bg-theme-bg-primary px-5 py-4 rounded-b-2xl">
          <Button type="button" variant="secondary" onClick={onClose}>Annulla</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva Uscita'}</Button>
        </div>
      </div>

      {/* 2026-06-03: NewClientModal per creare un nuovo Autista. Pre-popolato
          con metadata.role='autista' tramite initialData. Dopo il salvataggio
          handleClientCreated forza il tag e ricarica la lista autisti. */}
      <NewClientModal
        isOpen={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        onClientCreated={handleClientCreated}
        initialData={{ metadata: { role: 'autista' } }}
      />
    </div>
  )
}
