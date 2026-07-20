import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { isTestPlate } from '../../../utils/testPlates'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import DateRangeFilter from '../../../components/DateRangeFilter'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnpaidBooking {
  id: string
  service_type: 'rental' | 'car_wash' | 'mechanical_service'
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_id?: string
  user_id?: string
  customer_codice_fiscale?: string
  customer_indirizzo?: string
  customer_numero_civico?: string
  customer_citta?: string
  customer_cap?: string
  customer_provincia?: string
  service_name?: string
  vehicle_name?: string
  vehicle_plate?: string
  appointment_date?: string
  appointment_time?: string
  pickup_date?: string
  dropoff_date?: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
  created_at: string
}

interface FatturaItem {
  fatturaId: string
  fatturaNumero: string
  bookingId: string
  description: string
  total: number
  amountPaid: number
  paymentStatus: string
  type: 'penalties' | 'danni'
  itemIndex: number
}

interface PendingItem {
  bookingId: string
  booking: UnpaidBooking
  label: string
  amount: number         // EUR total
  amountPaid: number     // EUR paid
  remaining: number      // EUR remaining
  paymentStatus: string
  source: 'booking_details' | 'fattura'
  fatturaId?: string
  fatturaNumero?: string
  itemIndex?: number
  type: 'penalties' | 'danni'
  originalIndex: number
}

interface CustomerGroup {
  customerKey: string
  customerName: string
  customerEmail: string
  customerPhone: string
  noleggioBookings: UnpaidBooking[]
  primeWashBookings: UnpaidBooking[]
  penaliItems: PendingItem[]
  danniItems: PendingItem[]
  totalRemaining: number  // in cents
  chargedViaMit: number   // cents already collected via addebito MIT
}

// ── Display helpers ───────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'bg-pink-500/20 text-pink-300 border-pink-500/40',
]

function getInitials(name: string): string {
  return (name || '?').split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase() || '?'
}

function paletteFor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

function relativeIt(days: number | null): string {
  if (days == null) return '—'
  if (days <= 0) return 'oggi'
  if (days === 1) return 'ieri'
  if (days < 30) return `${days} giorni fa`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} ${months === 1 ? 'mese' : 'mesi'} fa`
  const years = Math.floor(days / 365)
  return `${years} ${years === 1 ? 'anno' : 'anni'} fa`
}

function priorityFromDays(days: number | null): { label: string; classes: string } {
  if (days == null) return { label: 'N/D', classes: 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border' }
  if (days >= 30) return { label: 'Alta', classes: 'bg-red-500/15 text-red-300 border-red-500/40' }
  if (days >= 7) return { label: 'Media', classes: 'bg-amber-500/15 text-amber-300 border-amber-500/40' }
  return { label: 'Bassa', classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function UnpaidBookingsTab() {
  const [bookings, setBookings] = useState<UnpaidBooking[]>([])
  const [fatturaItemsMap, setFatturaItemsMap] = useState<Record<string, FatturaItem[]>>({})
  const [mitChargedMap, setMitChargedMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filterService, setFilterService] = useState<'all' | 'rental' | 'prime_wash'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // 2026-06-01: filtro periodo Da/A — su pickup_date dei booking
  // associati al cliente. Cliente passa se ha almeno un booking nel range.
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [partialPayItemKey, setPartialPayItemKey] = useState<string | null>(null)
  const [partialPayValue, setPartialPayValue] = useState('')
  const [editAmountKey, setEditAmountKey] = useState<string | null>(null)
  const [editAmountValue, setEditAmountValue] = useState('')
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'amount' | 'name'>('amount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [processingKey, setProcessingKey] = useState<string | null>(null)
  // Sollecito pagamento — chiave del gruppo per cui è in corso l'invio del
  // promemoria WhatsApp (disabilita il bottone durante l'invio).
  const [sollecitoSendingKey, setSollecitoSendingKey] = useState<string | null>(null)
  // Per-row actions dropdown (3-dots menu on desktop row layout)
  const [openActionsRowKey, setOpenActionsRowKey] = useState<string | null>(null)

  // Addebito state
  const [showAddebitoModal, setShowAddebitoModal] = useState(false)
  const [addebitoGroup, setAddebitoGroup] = useState<CustomerGroup | null>(null)
  const [addebitoContractId, setAddebitoContractId] = useState<string | null>(null)
  const [addebitoDanniPhotos, setAddebitoDanniPhotos] = useState<string[]>([])
  const [addebitoSending, setAddebitoSending] = useState(false)
  const [addebitoItemAmount, setAddebitoItemAmount] = useState<number | null>(null) // cents, null = full group
  const [addebitoItemLabel, setAddebitoItemLabel] = useState<string | null>(null)
  const [addebitoCarryForward, setAddebitoCarryForward] = useState<number>(0) // cents carry-forward from other unpaid items

  // Partial link state
  const [partialLinkKey, setPartialLinkKey] = useState<string | null>(null)
  const [partialLinkValue, setPartialLinkValue] = useState('')

  // Payment-method picker (asked before any "Segna Pagato" / "Salda Tutto"
  // path so the booking row is stamped with HOW the customer paid).
  const [payMethodPicker, setPayMethodPicker] = useState<{
    description: string
    onConfirm: (method: string) => void | Promise<void>
  } | null>(null)
  const [selectedPayMethod, setSelectedPayMethod] = useState<string>('Contanti')
  // 2026-06-04: metodi pagamento dalla fonte unica (Centralina Pro).
  const paymentMethods = usePaymentMethods()

  function askPaymentMethod(description: string, onConfirm: (method: string) => void | Promise<void>) {
    setSelectedPayMethod('Contanti')
    setPayMethodPicker({ description, onConfirm })
  }

  useEffect(() => {
    loadUnpaidBookings()

    const subscription = supabase
      .channel('unpaid-bookings-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => loadUnpaidBookings()
      )
      .subscribe()

    return () => { subscription.unsubscribe() }
  }, [])

  // ── Addebito ──────────────────────────────────────────────────────────

  async function openAddebitoNexi(group: CustomerGroup, itemAmountCents?: number, itemLabel?: string) {
    setAddebitoGroup(group)
    setAddebitoSending(false)
    setAddebitoContractId(null)
    setAddebitoDanniPhotos([])

    // Calculate carry-forward: remaining from OTHER items when charging a single item
    let carryForward = 0
    if (itemAmountCents != null) {
      // totalRemaining includes ALL items; subtract this item to get carry-forward
      carryForward = Math.max(0, group.totalRemaining - itemAmountCents)
    }
    setAddebitoCarryForward(carryForward)
    // Total charge = item amount + carry-forward from other unpaid items
    setAddebitoItemAmount(itemAmountCents != null ? itemAmountCents + carryForward : null)
    setAddebitoItemLabel(itemLabel ?? null)
    setShowAddebitoModal(true)

    // Collect danni photos from all bookings in the group
    const allPhotos: string[] = []
    const allBookings = [...group.noleggioBookings, ...group.primeWashBookings]
    for (const b of allBookings) {
      const danni = b.booking_details?.danni || []
      for (const d of danni) {
        if (d.photos && Array.isArray(d.photos)) {
          allPhotos.push(...d.photos)
        }
      }
    }
    setAddebitoDanniPhotos(allPhotos)

    // Lookup contract_id: 1) customer metadata, 2) nexi_transactions by email
    let contractId: string | null = null

    // Try customer metadata first (most reliable — saved on every payment)
    if (group.customerEmail) {
      const { data: cust } = await supabase
        .from('customers_extended')
        .select('metadata')
        .eq('email', group.customerEmail.toLowerCase().trim())
        .maybeSingle()
      if (cust?.metadata?.nexi_contract_id) {
        contractId = cust.metadata.nexi_contract_id
      }
    }

    // Fallback: search nexi_transactions
    if (!contractId) {
      const { data: txs } = await supabase
        .from('nexi_transactions')
        .select('metadata')
        .eq('customer_email', group.customerEmail)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(10)
      contractId = txs?.find(t => t.metadata?.contract_id)?.metadata?.contract_id || null
    }

    // Fallback: check booking_details.nexi_contract_id
    if (!contractId) {
      const allBookings = [...group.noleggioBookings, ...group.primeWashBookings]
      for (const b of allBookings) {
        if (b.booking_details?.nexi_contract_id) {
          contractId = b.booking_details.nexi_contract_id
          break
        }
      }
    }

    setAddebitoContractId(contractId)
    if (!contractId) {
      toast.error('Nessun Contract ID Nexi trovato per questo cliente')
    }
  }

  async function handleAddebitoUnpaid() {
    if (!addebitoGroup) return
    const amountCents = addebitoItemAmount != null ? addebitoItemAmount : addebitoGroup.totalRemaining
    const amount = amountCents / 100
    if (amount <= 0) return
    setAddebitoSending(true)
    try {
      const res = await authFetch('/.netlify/functions/nexi-nuovo-addebito', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: null,
          bookingId: addebitoGroup.noleggioBookings[0]?.id || addebitoGroup.primeWashBookings[0]?.id || null,
          customerName: addebitoGroup.customerName,
          customerEmail: addebitoGroup.customerEmail,
          contractNumber: addebitoGroup.noleggioBookings[0]?.id?.substring(0, 8)?.toUpperCase() || 'N/A',
          amount: amount.toFixed(2),
          causale: addebitoItemLabel ? `${addebitoItemLabel} - ${addebitoGroup.customerName}` : `Saldo dovuto - ${addebitoGroup.customerName}`,
          contractId: addebitoContractId || null,
          recurring: false,
          intervalHours: null,
          photoUrls: addebitoDanniPhotos,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(data.message || 'Addebito programmato')
        setShowAddebitoModal(false)
      } else {
        toast.error(data.error || 'Errore')
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore: ' + _errMsg)
    } finally {
      setAddebitoSending(false)
    }
  }

  // ── Data Layer (preserved from original) ──────────────────────────────────

  async function loadUnpaidBookings() {
    setLoading(true)
    try {
      // Test-plate exclusion is done in JS (after the fetch) instead of via
      // PostgREST `.not('vehicle_plate', 'in', ...)` because SQL three-valued
      // logic drops NULL-plate rows from `column NOT IN (...)`. Car wash
      // bookings often have NULL plate, so a DB-side filter silently hid
      // them from "In attesa di pagamento" even though they appeared in
      // the wash calendar.

      // Primary fetch: active/pending bookings that might be unpaid.
      const { data: activeData, error: activeErr } = await supabase
        .from('bookings')
        .select('*')
        .not('status', 'in', '(cancelled,annullata,completed,completata,deleted)')
        .neq('customer_name', 'Lavaggio Rientro')
        .order('created_at', { ascending: false })

      if (activeErr) throw activeErr

      // Secondary fetch: cancelled / completed bookings that still have
      // unpaid penali or danni. Without this, a penale added against a
      // cancelled booking would never appear in "In attesa di pagamento".
      const { data: terminalWithItems } = await supabase
        .from('bookings')
        .select('*')
        .in('status', ['cancelled', 'annullata', 'completed', 'completata'])
        .neq('customer_name', 'Lavaggio Rientro')
        .or('booking_details->penalties.neq.[],booking_details->danni.neq.[]')
        .order('created_at', { ascending: false })

      // Tertiary fetch: completed/completata bookings where the booking
      // itself is STILL UNPAID. Car wash bookings get auto-flagged
      // 'completed' once the appointment time passes; if the customer paid
      // cash on-site and the admin hasn't clicked "Segna Pagato" yet, the
      // row has status='completed' + payment_status='pending' — and
      // without this fetch it disappears from "In attesa di pagamento"
      // because the primary query excludes completed statuses.
      const { data: terminalUnpaid } = await supabase
        .from('bookings')
        .select('*')
        .in('status', ['completed', 'completata'])
        .not('payment_status', 'in', '(paid,completed,succeeded)')
        .neq('customer_name', 'Lavaggio Rientro')
        .order('created_at', { ascending: false })

      // 2026-05-30: a cancelled/completed booking should only stay in
      // "In attesa di pagamento" if a penale/danno is ACTUALLY UNPAID.
      // The PostgREST `.or(...neq.[])` above only proves the arrays are
      // non-empty, so a cancelled rental whose penali/danni are all paid
      // was re-included forever and the red X "wouldn't make it disappear".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasUnpaidDebtItem = (b: any): boolean => {
        for (const key of ['penalties', 'danni'] as const) {
          const arr = b?.booking_details?.[key]
          if (!Array.isArray(arr)) continue
          for (const it of arr) {
            if (it?.paymentStatus === 'paid') continue
            const total = Number(it?.total ?? ((Number(it?.amount) || 0) * (Number(it?.quantity) || 1))) || 0
            const paid = Number(it?.amountPaid) || 0
            if (paid < total) return true
          }
        }
        return false
      }

      const seen = new Set((activeData || []).map(b => b.id))
      const merged = [
        ...(activeData || []),
        ...((terminalWithItems || []).filter(b => !seen.has(b.id) && hasUnpaidDebtItem(b))),
      ]
      for (const b of (terminalUnpaid || [])) {
        if (!seen.has(b.id) && !merged.some(m => m.id === b.id)) {
          merged.push(b)
        }
      }
      // Filter out test plates in JS (NULL-safe: NULL plates pass through).
      // Exception: test bookings created on/after TEST_VISIBLE_FROM ARE shown
      // in Da Saldare so the team can validate extension/da-saldare flows on
      // TEST000 / TEST002 without polluting the tab with legacy test data.
      const TEST_VISIBLE_FROM = '2026-05-05T00:00:00Z'
      const data = merged.filter(b => {
        if (!isTestPlate(b.vehicle_plate)) return true
        return !!b.created_at && b.created_at >= TEST_VISIBLE_FROM
      })
      const error = null as null | { message: string }

      if (error) throw error

      const { data: fatture } = await supabase
        .from('fatture')
        .select('id, booking_id, numero_fattura, items')

      const fItemsMap: Record<string, FatturaItem[]> = {}
      const bookingIdsWithFatturaItems = new Set<string>()

      for (const f of (fatture || [])) {
        if (!f.items || !Array.isArray(f.items) || !f.booking_id) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        f.items.forEach((fi: any, idx: number) => {
          if (!fi.description) return
          const desc = fi.description as string
          const isDanniPenali = desc.includes('Penale prenotazione') || desc.includes('Danno prenotazione')
          if (!isDanniPenali) return
          if (fi.paymentStatus === 'paid') return

          const total = fi.total || (fi.unit_price || 0) * (fi.quantity || 1)
          const type: 'penalties' | 'danni' = desc.includes('Danno prenotazione') ? 'danni' : 'penalties'
          const item: FatturaItem = {
            fatturaId: f.id,
            fatturaNumero: f.numero_fattura || '',
            bookingId: f.booking_id,
            description: desc,
            total,
            amountPaid: fi.amountPaid || 0,
            paymentStatus: fi.paymentStatus || 'pending',
            type,
            itemIndex: idx,
          }
          if (!fItemsMap[f.booking_id]) fItemsMap[f.booking_id] = []
          fItemsMap[f.booking_id].push(item)
          bookingIdsWithFatturaItems.add(f.booking_id)
        })
      }

      setFatturaItemsMap(fItemsMap)

      // Fetch charged amounts from pending_addebiti
      const { data: addebiti } = await supabase
        .from('pending_addebiti')
        .select('customer_email, charged_amount_cents, amount_cents, status')
        .eq('status', 'charged')

      const mitMap: Record<string, number> = {}
      for (const a of (addebiti || [])) {
        if (a.customer_email) {
          // Use charged_amount_cents if available, otherwise fall back to amount_cents (full charge)
          const charged = a.charged_amount_cents || a.amount_cents || 0
          if (charged > 0) {
            const key = a.customer_email.toLowerCase().trim()
            mitMap[key] = (mitMap[key] || 0) + charged
          }
        }
      }
      setMitChargedMap(mitMap)

      const isPaid = (s: string) => s === 'paid' || s === 'completed' || s === 'succeeded'

      const unpaidBookings = (data || []).filter(booking => {
        // Any non-paid status means the booking is unpaid. Previously the
        // filter only matched 'pending'/'unpaid', so Prime Wash rows with
        // 'partial', 'nexi_pay_by_link', empty string or NULL were invisible
        // even though they still owe money.
        if (!isPaid(booking.payment_status)) return true

        const extensions = booking.booking_details?.extension_history || []
        // 2026-05-28: extension entra in "In attesa di pagamento" SOLO se
        // status non-paid AND amount > 0. Estensioni Da Saldare a €0
        // (es. solo cambio data senza extra) non hanno nulla da incassare,
        // quindi non devono apparire nella lista insoluti.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (extensions.some((ext: any) => {
          const unpaid = ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link'
          if (!unpaid) return false
          const amt = Number(ext.additional_amount) || 0
          const paid = Number(ext.amount_paid) || 0
          // Owes something only if there's actually a positive residual.
          return (amt - paid) > 0
        })) return true

        const penalties = booking.booking_details?.penalties || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (penalties.some((p: any) => {
          const unpaid = !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial' || p.paymentStatus === 'nexi_pay_by_link'
          if (!unpaid) return false
          // 2026-06-06: usare il TOTALE reale (p.total, o amount×quantity) meno
          // lo sconto — NON p.amount, che e' il prezzo UNITARIO. Una penale con
          // quantity>1 (es. Sforo Km 43×9=387, amount=9, amountPaid=300) veniva
          // letta come amt=9 < paid=300 => "pagata", facendo sparire la
          // prenotazione PAGATA da Da Saldare nonostante il residuo aperto.
          const total = Number(p.total) || (Number(p.amount) || 0) * (Number(p.quantity) || 1)
          const discount = Number(p.discount) || 0
          const paid = Number(p.amountPaid) || 0
          return (total - discount - paid) > 0
        })) return true

        const danni = booking.booking_details?.danni || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (danni.some((d: any) => {
          const unpaid = !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial' || d.paymentStatus === 'nexi_pay_by_link'
          if (!unpaid) return false
          // 2026-06-06: stesso fix delle penali — usa il totale reale (total o
          // amount×quantity) meno lo sconto, non d.amount (prezzo unitario).
          const total = Number(d.total) || (Number(d.amount) || 0) * (Number(d.quantity) || 1)
          const discount = Number(d.discount) || 0
          const paid = Number(d.amountPaid) || 0
          return (total - discount - paid) > 0
        })) return true

        // Only keep for fattura items if the booking itself is NOT paid
        if (bookingIdsWithFatturaItems.has(booking.id) && !isPaid(booking.payment_status)) return true

        return false
      })

      setBookings(unpaidBookings)
    } catch (error) {
      console.error('Failed to load unpaid bookings:', error)
    } finally {
      setLoading(false)
    }
  }

  // ── Payment & Delete functions (preserved) ─────────────────────────────────

  // 2026-06-04: quando un lavaggio Prime Wash viene segnato pagato da qui,
  // propaga stato + metodo ai blocchi shadow collegati (auto di cortesia /
  // supercar) via parent_carwash_booking_id. Per i noleggi normali non c'è
  // nessuna riga collegata → no-op innocuo.
  async function propagatePaidToCarwashShadows(bookingId: string, paid: boolean, method?: string | null) {
    try {
      await supabase.from('bookings').update({
        payment_status: paid ? 'paid' : 'pending',
        payment_method: method || null,
      }).contains('booking_details', { parent_carwash_booking_id: bookingId })
    } catch (e) {
      console.error('[UnpaidBookings] shadow payment cascade failed:', e)
    }
  }

  // remainingEurBeingPaid: quanto è REALMENTE ancora da pagare per questa voce
  // (dal residuo mostrato in UI). Serve a evitare fatture integrative fantasma
  // quando si ri-segna "pagato" una voce GIÀ saldata (residuo ~0): la ricostruzione
  // netto→lordo dell'importo già fatturato può sottostimare e generare un delta
  // inesistente. Bug reale: Michele Concas, 0/800 → seconda fattura da €350.
  async function updatePaymentStatus(bookingId: string, newStatus: string, paymentMethod?: string, remainingEurBeingPaid?: number) {
    try {
      // When marking paid, also set amount_paid = price_total so the calendar
      // detail panel (and any other consumer that computes remaining as
      // total - amount_paid) shows zero owed. Without this, "segna pagato"
      // left amount_paid stale and the panel kept showing the gap as
      // "da saldare".
      const updatePayload: Record<string, unknown> = {
        payment_status: newStatus,
        status: newStatus === 'paid' ? 'confirmed' : 'pending',
        updated_at: new Date().toISOString()
      }
      if (paymentMethod) {
        updatePayload.payment_method = paymentMethod
      }
      if (newStatus === 'paid') {
        const { data: bookingRow } = await supabase
          .from('bookings')
          .select('price_total, booking_details')
          .eq('id', bookingId)
          .maybeSingle()
        const totalCents = Number(bookingRow?.price_total || 0)
        if (totalCents > 0) {
          updatePayload.amount_paid = totalCents
          const newDetails = {
            ...(bookingRow?.booking_details || {}),
            amountPaid: totalCents,
          }
          updatePayload.booking_details = newDetails
        }
      }
      const { error } = await supabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', bookingId)

      if (error) throw error
      await propagatePaidToCarwashShadows(bookingId, newStatus === 'paid', paymentMethod)
      toast.success('Stato pagamento aggiornato!')
      {
        const { data: bookingForLog } = await supabase
          .from('bookings')
          .select('customer_name, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total')
          .eq('id', bookingId)
          .maybeSingle()
        logAdminAction('mark_paid', 'booking', bookingId, {
          ...buildBookingContext(bookingForLog),
          method: newStatus,
        })
      }

      if (newStatus === 'paid') {
        // Get service_type + payment_method per decidere se generare fattura.
        const { data: bookingData } = await supabase
          .from('bookings')
          .select('service_type, payment_method')
          .eq('id', bookingId)
          .maybeSingle()
        // Car rental = NOT car_wash and NOT mechanical
        const st = bookingData?.service_type
        const isCarRental = !st || st === 'rental' || st === 'car_rental' ||
          (st !== 'car_wash' && st !== 'mechanical' && st !== 'mechanical_service')
        const isCarWash = st === 'car_wash'
        // Tour Noleggio Aria/Mare/Soggiorni: NESSUN contratto da firmare
        // (la fattura invece resta — isCarRental non viene cambiato).
        const isTour = st === 'heli_rental' || st === 'boat_rental' || st === 'stay_rental'
        // Credit Wallet: la fattura e' gia' stata generata al momento della
        // ricarica del wallet. Generarne un'altra qui sarebbe doppia
        // fatturazione. Salta tutto il blocco fattura per questo metodo.
        const pm = (bookingData?.payment_method || '').toLowerCase()
        const isCreditWallet = pm === 'credit wallet' || pm === 'credit_wallet' || pm === 'credit'
        logger.log('[updatePaymentStatus] service_type:', st, 'isCarRental:', isCarRental, 'isCarWash:', isCarWash, 'isCreditWallet:', isCreditWallet)

        // DR7 Privilege — fire-and-forget sul pagamento per QUALSIASI servizio
        // (car wash + noleggio). Backend e' idempotente via dr7_privilege_sent_at.
        if (newStatus === 'paid') {
          fetch('/.netlify/functions/trigger-dr7-privilege', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId, kind: isCarWash ? 'lavaggio' : 'noleggio' }),
          }).catch(() => { /* non-blocking */ })
        }

        // 1. Generate fattura — SOLO se NON e' Credit Wallet (in quel caso
        //    la fattura e' gia' stata generata alla ricarica del wallet, non
        //    qui).
        // Logic:
        //   • If NO fattura exists yet → full fattura on the booking total.
        //   • If a fattura ALREADY exists and the booking was previously
        //     modified upward (price_total > sum of fatture items for this
        //     booking), generate a DELTA fattura for just the new amount
        //     that's being paid now. Prevents the "Fattura già esistente"
        //     blocker when an admin raises the price by e.g. 5 € and marks
        //     the extra paid.
        if (isCreditWallet) {
          logger.log('[updatePaymentStatus] Credit Wallet: skip fattura generation (gia\' generata alla ricarica wallet)')
          toast.success('Segnato come pagato (fattura gia\' presente per ricarica wallet)')
        } else try {
          const { data: fatture } = await supabase
            .from('fatture')
            .select('id, numero_fattura, items')
            .eq('booking_id', bookingId)

          const { data: bk } = await supabase
            .from('bookings')
            .select('price_total, booking_details')
            .eq('id', bookingId)
            .maybeSingle()

          const bookingTotalCents = bk?.price_total || 0
          // booking.price_total is GROSS (IVA-included) — admin-typed amounts
          // are always gross in this project. Fattura items however are stored
          // as NET (unit_price / total divided by 1.22). We MUST convert items
          // to gross before comparing, otherwise the "delta" equals roughly
          // the IVA of the existing invoice and "Segna Pagato" emits a bogus
          // extra fattura for an amount the admin never typed.
          let alreadyInvoicedCents = 0
          for (const f of (fatture || [])) {
            if (!Array.isArray(f.items)) continue
            for (const item of f.items) {
              const netEur = item.total != null
                ? Number(item.total)
                : Number(item.unit_price || 0) * Number(item.quantity || 1)
              const vatRate = Number(item.vat_rate || 0)
              const grossCents = netEur * (1 + vatRate / 100) * 100
              if (Number.isFinite(grossCents)) alreadyInvoicedCents += Math.round(grossCents)
            }
          }
          const deltaCents = Math.max(0, bookingTotalCents - alreadyInvoicedCents)

          if ((fatture || []).length === 0) {
            // First fattura for this booking — full amount.
            const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bookingId, includeIVA: true })
            })
            if (invoiceRes.ok) {
              const invoiceData = await invoiceRes.json()
              toast.success(`Fattura ${invoiceData.invoice?.numero_fattura || ''} generata`)
            }
          } else if (deltaCents > 0) {
            // Previously invoiced, but there's a new positive delta — emit a
            // delta invoice for just the new amount.
            // GUARD (2026-07-20): se conosciamo il residuo REALE ancora da pagare
            // (remainingEurBeingPaid), il delta NON può superarlo, e se è ~0 non
            // si fattura nulla. Evita la fattura integrativa fantasma quando si
            // ri-segna "pagato" una voce già saldata (bug Michele Concas 0/800→€350).
            const remainingCents = typeof remainingEurBeingPaid === 'number' ? Math.round(remainingEurBeingPaid * 100) : undefined
            if (typeof remainingCents === 'number' && remainingCents <= 50) {
              logger.log('[Segna Pagato] Residuo reale ~0: nessuna fattura integrativa (voce già saldata).')
            } else {
              const cappedDeltaCents = typeof remainingCents === 'number' ? Math.min(deltaCents, remainingCents) : deltaCents
              const deltaEur = cappedDeltaCents / 100
              const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, includeIVA: true, extensionAmount: deltaEur })
              })
              if (invoiceRes.ok) {
                const invoiceData = await invoiceRes.json()
                toast.success(`Fattura integrativa €${deltaEur.toFixed(2)} generata (${invoiceData.invoice?.numero_fattura || ''})`)
              } else {
                const err = await invoiceRes.json().catch(() => ({} as any))
                toast.error(`Fattura integrativa non generata: ${err.error || `HTTP ${invoiceRes.status}`}`, { duration: 8000 })
              }
            }
          } else {
            // Fattura exists and covers the full booking total — nothing new
            // to invoice. Silent log, no user-facing "gia' esistente" toast
            // which historically confused admins.
            logger.log('[Segna Pagato] Fattura already covers booking total — nothing to invoice')
          }
        } catch (invoiceErr) {
          logger.warn('Auto-invoice generation failed:', invoiceErr)
        }

        // 2. Generate contract + send signing link (ONLY for car rentals)
        // Skip when the booking already has a signed contract — re-sending a
        // signing link to a customer who has already signed (status was
        // "Confermata da saldare" precisely because the signature came back)
        // is the bug we're guarding against.
        if (isCarRental) {
          if (!isTour) {
          const { data: existingContract } = await supabase
            .from('contracts')
            .select('signed_pdf_url')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (existingContract?.signed_pdf_url) {
            logger.log('[Segna Pagato] Contract already signed for booking', bookingId, '— skipping regenerate + signature-init')
          } else {
            try {
              const genRes = await authFetch('/.netlify/functions/generate-contract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, silent: true })
              })
              if (!genRes.ok) {
                const genErr = await genRes.json().catch(() => ({} as any))
                logger.warn('[Segna Pagato] generate-contract failed:', genErr)
                toast.error(`Contratto non generato: ${genErr.error || `HTTP ${genRes.status}`}`, { duration: 8000 })
              } else {
                // Delegate the contract lookup to signature-init (service-role
                // backend bypasses RLS). Skips the frontend SELECT that could
                // silently return null when the admin JWT isn't allowed to read
                // contracts — which was the exact reason "Segna pagato" wasn't
                // triggering the signing link before.
                const sigRes = await fetch('/.netlify/functions/signature-init', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bookingId })
                })
                if (sigRes.ok) {
                  toast.success('Contratto e link firma inviati al cliente')
                } else {
                  const sigErr = await sigRes.json().catch(() => ({} as any))
                  logger.warn('[Segna Pagato] signature-init failed:', sigErr)
                  toast.error(`Link firma non inviato: ${sigErr.error || `HTTP ${sigRes.status}`}`, { duration: 8000 })
                }
              }
            } catch (sigErr) {
              logger.warn('Contract/signing link generation failed:', sigErr)
              toast.error(`Errore contratto: ${sigErr instanceof Error ? sigErr.message : 'sconosciuto'}`, { duration: 8000 })
            }
          }
          } // fine if (!isTour) — i Tour Aria/Mare NON hanno contratto

          // 3. Conferma al cliente. Tour -> template Tour (pro_conferma_tour);
          //    noleggio auto -> rental_new_customer (come prima).
          try {
            const { data: fullBooking } = await supabase
              .from('bookings')
              .select('*')
              .eq('id', bookingId)
              .single()
            const custPhone = fullBooking?.customer_phone || fullBooking?.booking_details?.customer?.phone
            if (custPhone && fullBooking) {
              const bd = fullBooking.booking_details || {}
              const firstName = (fullBooking.customer_name || '').split(' ')[0] || 'Cliente'
              const pk = fullBooking.pickup_date ? new Date(fullBooking.pickup_date) : null
              const dataStr = pk ? pk.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' }) : ''
              const oraStr = pk ? pk.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : ''
              const totEur = ((Number(fullBooking.price_total) || 0) / 100).toFixed(2)
              const ref = (bookingId || '').substring(0, 8).toUpperCase()
              const body = isTour
                ? {
                    customPhone: custPhone,
                    templateKey: 'tour_new_customer',
                    booking: { service_type: fullBooking.service_type },
                    templateVars: {
                      nome: firstName, customer_name: fullBooking.customer_name || '',
                      esperienza: fullBooking.vehicle_name || '', servizio: fullBooking.vehicle_name || '', service_name: fullBooking.vehicle_name || '',
                      data: dataStr, date: dataStr, orario: oraStr, ora: oraStr, time: oraStr,
                      posti: String(bd.seat_count || ''), seat_count: String(bd.seat_count || ''),
                      total: totEur, totale: totEur, importo: totEur, amount: totEur,
                      payment_info: 'Pagato', pagamento: 'Pagato',
                      booking_id: ref, booking_ref: ref, id: ref, note: bd.note || '',
                    },
                    skipHeader: true,
                  }
                : {
                    customPhone: custPhone,
                    booking: { ...fullBooking, service_type: 'car_rental', payment_status: 'paid', isEdit: false },
                  }
              const confRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              })
              const confResult = await confRes.json()
              logger.log('[Segna Pagato] Confirmation WhatsApp result:', confResult)
              if (confResult.skipped) {
                toast(`Template ${confResult.reason}: messaggio conferma NON inviato`, { icon: '⚠️' })
              } else if (confRes.ok) {
                toast.success('Messaggio conferma prenotazione inviato')
              }
            }
          } catch (confErr) {
            console.error('[Segna Pagato] Confirmation message failed:', confErr)
          }
        }
      }

      loadUnpaidBookings()
    } catch (error: unknown) {
      console.error('Failed to update payment status:', error)
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      const errorMessage = _errMsg || JSON.stringify(error)
      toast.error(`Errore: ${errorMessage}`)
    }
  }

  async function removeSinglePenaltyDanno(booking: UnpaidBooking, type: 'penalties' | 'danni', originalIndex: number) {
    try {
      // Re-fetch fresh booking_details to avoid overwriting concurrent changes
      const { data: fresh, error: fetchErr } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', booking.id)
        .single()
      if (fetchErr) throw fetchErr

      const details = fresh?.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = [...(details[type] || [])]
      arr.splice(originalIndex, 1)

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...details, [type]: arr } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success(`${type === 'danni' ? 'Danno' : 'Penale'} rimosso!`)
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      console.error('Failed to remove item:', error)
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function updateSinglePenaltyDannoAmount(booking: UnpaidBooking, type: 'penalties' | 'danni', originalIndex: number, newAmount: number) {
    try {
      // Re-fetch fresh booking_details to avoid overwriting concurrent changes
      const { data: fresh, error: fetchErr } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', booking.id)
        .single()
      if (fetchErr) throw fetchErr

      const details = fresh?.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = [...(details[type] || [])]
      if (arr[originalIndex]) {
        arr[originalIndex] = { ...arr[originalIndex], total: newAmount, amount: newAmount, quantity: 1 }
      }

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...details, [type]: arr } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Importo aggiornato!')
      setEditAmountKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      console.error('Failed to update amount:', error)
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function deleteSingleExtension(booking: UnpaidBooking, extIndex: number) {
    try {
      const extensions = [...(booking.booking_details?.extension_history || [])]
      const deletedExt = extensions[extIndex]
      if (!deletedExt) return
      extensions.splice(extIndex, 1)

      // Revert dropoff_date: if no extensions remain, use the deleted one's previous_dropoff.
      // If other extensions remain, use the last remaining extension's new_dropoff.
      let revertedDropoff: string | undefined
      let revertedTotal: number | undefined
      if (extensions.length === 0 && deletedExt.previous_dropoff) {
        revertedDropoff = deletedExt.previous_dropoff
        // Subtract extension amount from total
        const extAmount = deletedExt.additional_amount || 0
        const currentTotal = booking.price_total || 0
        revertedTotal = Math.max(0, currentTotal - extAmount)
      } else if (extensions.length > 0) {
        // Last remaining extension's new_dropoff becomes the dropoff_date
        const lastExt = extensions[extensions.length - 1]
        revertedDropoff = lastExt.new_dropoff
        // Subtract only the deleted extension's amount
        const extAmount = deletedExt.additional_amount || 0
        const currentTotal = booking.price_total || 0
        revertedTotal = Math.max(0, currentTotal - extAmount)
      }

      const updatePayload: any = {
        booking_details: { ...booking.booking_details, extension_history: extensions },
      }
      if (revertedDropoff) updatePayload.dropoff_date = revertedDropoff
      if (revertedTotal !== undefined) updatePayload.price_total = revertedTotal

      const { error } = await supabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Estensione rimossa e date ripristinate!')
      logAdminAction('delete_extension', 'booking', booking.id, buildBookingContext(booking))
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function markSingleExtensionPaid(booking: UnpaidBooking, extIndex: number, paymentMethod?: string) {
    try {
      const extensions = [...(booking.booking_details?.extension_history || [])]
      const ext = extensions[extIndex]
      if (!ext) return

      // 2026-05-28: registra anche il metodo di pagamento sull'estensione,
      // cosi' la fattura puo' usarlo + audit log ha tracciabilita'.
      extensions[extIndex] = {
        ...ext,
        payment_status: 'paid',
        ...(paymentMethod ? { payment_method: paymentMethod, paid_at: new Date().toISOString() } : {}),
      }

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...booking.booking_details, extension_history: extensions } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Estensione segnata come pagata!')
      logAdminAction('mark_extension_paid', 'booking', booking.id, {
        ...buildBookingContext(booking),
        extension_index: extIndex,
        amount: ext.additional_amount,
      })

      // Generate fattura for the extension
      const extAmount = ext.additional_amount || 0
      if (extAmount > 0) {
        try {
          const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id, includeIVA: true, extensionAmount: extAmount })
          })
          if (invoiceRes.ok) {
            toast.success('Fattura estensione generata!')
          } else {
            const errData = await invoiceRes.json()
            const errMsg = errData.message || errData.error || 'Errore sconosciuto'
            toast.error(`Fattura estensione non generata: ${errMsg}`, { duration: 8000 })
          }
        } catch (invoiceError) {
          console.error('Failed to generate extension fattura:', invoiceError)
        }
      }

      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function handleExtensionPartialPayment(booking: UnpaidBooking, extIndex: number, paymentAmount: number) {
    try {
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        toast.error('Importo non valido')
        return
      }
      const extensions = [...(booking.booking_details?.extension_history || [])]
      const ext = extensions[extIndex]
      if (!ext) {
        toast.error('Estensione non trovata')
        return
      }

      const total = ext.additional_amount || 0
      const currentPaid = ext.amount_paid || 0
      const newPaid = Math.min(currentPaid + paymentAmount, total)

      extensions[extIndex] = {
        ...ext,
        amount_paid: newPaid,
        payment_status: newPaid >= total ? 'paid' : 'partial'
      }

      const { error } = await supabase
        .from('bookings')
        .update({ booking_details: { ...booking.booking_details, extension_history: extensions } })
        .eq('id', booking.id)

      if (error) throw error
      toast.success('Pagamento parziale estensione registrato!')
      logAdminAction('partial_payment', 'booking', booking.id, {
        ...buildBookingContext(booking),
        amount: paymentAmount,
        extension_index: extIndex,
      })
      setPartialPayItemKey(null)

      // Generate fattura when fully paid
      if (newPaid >= total && total > 0) {
        try {
          const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id, includeIVA: true, extensionAmount: total })
          })
          if (invoiceRes.ok) {
            toast.success('Fattura estensione generata!')
          } else {
            const errData = await invoiceRes.json()
            const errMsg = errData.message || errData.error || 'Errore sconosciuto'
            toast.error(`Fattura estensione non generata: ${errMsg}`, { duration: 8000 })
          }
        } catch (invoiceError) {
          console.error('Failed to generate extension fattura:', invoiceError)
        }
      }

      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function deleteSingleBooking(bookingId: string) {
    try {
      const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single()

      // 2026-05-28: rimosso il guard "Impossibile eliminare una prenotazione
      // gia' pagata". Direzione vuole poter eliminare da "In attesa di
      // pagamento" qualsiasi riga li' presente — la riga e' in questo tab
      // perche' qualcosa e' insoluto (es. estensione Da Saldare su booking
      // gia' pagato). Il prompt "Confermi? Si/No" basta come protezione.
      if (booking) {
        try {
          await fetch('/.netlify/functions/delete-calendar-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: booking.id,
              customerName: booking.customer_name,
              vehicleName: booking.vehicle_name || booking.service_name || 'Servizio'
            }),
          })
        } catch (calError) {
          logger.warn('Failed to delete from Google Calendar:', calError)
        }
      }

      const res = await authFetch('/.netlify/functions/delete-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete booking')
      }

      toast.success('Prenotazione eliminata!')
      logAdminAction('delete_unpaid_booking', 'booking', bookingId, buildBookingContext(booking))
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : ((error as any)?.message || JSON.stringify(error))
      console.error('Failed to delete booking:', error)
      toast.error('Errore: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function handleFatturaItemPayment(fi: FatturaItem, paymentAmount: number) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture')
        .select('id, items')
        .eq('id', fi.fatturaId)
        .single()

      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        const existing = items[fi.itemIndex]
        const total = existing.total || (existing.unit_price || 0) * (existing.quantity || 1)
        const newAmountPaid = Math.min((existing.amountPaid || 0) + paymentAmount, total)
        items[fi.itemIndex] = {
          ...existing,
          amountPaid: newAmountPaid,
          paymentStatus: newAmountPaid >= total ? 'paid' : 'partial',
        }
      }

      const { error: updateErr } = await supabase
        .from('fatture')
        .update({ items })
        .eq('id', fi.fatturaId)

      if (updateErr) throw updateErr
      toast.success('Pagamento registrato')
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function sendPayByLink(booking: UnpaidBooking, amountEur: number, description: string) {
    // Structured so that (a) link generation errors show clearly, and (b)
    // NOTHING between link creation and the WhatsApp send can abort the flow.
    // Clipboard, toast, or any other browser-gated API that throws
    // "The request is not allowed by the user agent…" (Safari/iOS after an
    // await breaks user-gesture context) is fully isolated.
    toast.loading('Generazione link...', { id: 'paylink' })

    // 1. Create Nexi link
    let result: { paymentUrl?: string; error?: string } = {}
    try {
      // 2026-05-28: paymentPurpose='booking_topup' — la callback Nexi
      // (nexi-payment-callback.ts:683+) usa questo branch per accumulare
      // amount_paid invece di marcare il booking fully paid in un colpo.
      // Senza questo, una Link Parziale di €100 su €500 marcava TUTTO
      // pagato (callback ramo 'booking' default a riga 882). Adesso:
      // newPaidCents = priorPaid + transaction → fullyPaid solo se >= total.
      const res = await authFetch('/.netlify/functions/nexi-pay-by-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: amountEur,
          customerEmail: booking.customer_email || booking.booking_details?.customer?.email || '',
          customerName: booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente',
          description,
          expirationDays: 7,
          paymentPurpose: 'booking_topup',
        })
      })
      result = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(result.error || 'Errore generazione link', { id: 'paylink' })
        return
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore generazione link'
      toast.error(msg, { id: 'paylink' })
      return
    }

    toast.dismiss('paylink')
    if (!result.paymentUrl) {
      toast.error('Link non generato')
      return
    }

    // 2. Best-effort clipboard — ALWAYS ignore any failure. Wrapped twice so
    // that even a synchronous throw (e.g. navigator.clipboard === undefined in
    // some iframe contexts) can't leak.
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(result.paymentUrl).catch(() => {})
      }
    } catch { /* clipboard blocked — ignore */ }

    // 3. Send via WhatsApp (independent of clipboard outcome)
    const phone = booking.customer_phone || booking.booking_details?.customer?.phone
    if (!phone) {
      toast.success(`Link generato: ${result.paymentUrl}`, { duration: 10000 })
      return
    }

    try {
      const bookingRef = (booking.id || '').substring(0, 8).toUpperCase() || 'N/A'
      const customerName = booking.customer_name || 'Cliente'
      const amountStr = amountEur.toFixed(2)
      const sendRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customPhone: phone,
          // BUG FIX 2026-05-13: era hardcoded 'pro_richiesta_pagamento' →
          // bypassava handled_events. Adesso legacy key + booking
          // service_type così il resolver sceglie il template Prime Wash
          // custom se presente (es. "Link pagamento lavaggi"), o cade
          // sul canonical rental se rental.
          templateKey: 'payment_link_customer',
          booking: { service_type: (booking as { service_type?: string })?.service_type || 'rental' },
          // Pass every alias the Pro template might use so nothing leaks as
          // raw `{...}` in the outbound message.
          templateVars: {
            '{customer_name}': customerName,
            '{nome}': customerName.split(' ')[0] || 'Cliente',
            '{amount}': amountStr,
            '{total}': amountStr,
            '{importo}': amountStr,
            '{link}': result.paymentUrl,
            '{payment_link}': result.paymentUrl,
            '{booking_ref}': bookingRef,
            '{booking_id}': bookingRef,
          },
          skipHeader: false,
        })
      })
      const sendJson = await sendRes.json().catch(() => ({}))
      if (sendJson?.skipped && sendJson?.reason === 'pro_template_unavailable') {
        toast.error('Template per "payment_link_customer" mancante in Messaggi di Sistema Pro')
      } else if (!sendRes.ok) {
        toast.error(`Invio WhatsApp fallito: ${sendJson?.message || 'errore sconosciuto'}`)
      } else {
        toast.success('Link inviato via WhatsApp!')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invio WhatsApp fallito'
      toast.error(msg)
    }
  }

  // ── Sollecito pagamento ─────────────────────────────────────────────────
  // Invia un promemoria WhatsApp (template Pro "pro_promemoria_pagamento")
  // al cliente con debito ancora aperto. Stampa booking_details.sollecito su
  // OGNI booking del gruppo (last_sent_at + count) così l'auto-resend ogni 48h
  // (sollecito-pagamento-cron) può continuare il follow-up fino a max 3 invii.
  async function handleSendSollecito(group: CustomerGroup) {
    if (sollecitoSendingKey) return
    const phone =
      group.noleggioBookings[0]?.customer_phone
      || group.primeWashBookings[0]?.customer_phone
      || group.noleggioBookings[0]?.booking_details?.customer?.phone
      || group.primeWashBookings[0]?.booking_details?.customer?.phone
    if (!phone) {
      toast.error('Nessun numero di telefono per questo cliente')
      return
    }
    const customerName = group.customerName || 'Cliente'
    const firstName = customerName.split(' ')[0] || 'Cliente'
    const amountStr = (group.totalRemaining / 100).toFixed(2)
    setSollecitoSendingKey(group.customerKey)
    try {
      const sendRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customPhone: phone,
          templateKey: 'sollecito_pagamento',
          booking: { service_type: group.noleggioBookings[0]?.service_type || 'rental' },
          templateVars: {
            '{nome}': firstName,
            '{customer_name}': customerName,
            '{importo}': amountStr,
            '{amount}': amountStr,
            '{total}': amountStr,
          },
        }),
      })
      const sendJson = await sendRes.json().catch(() => ({}))
      if (sendJson?.skipped && sendJson?.reason === 'pro_template_unavailable') {
        toast.error('Template "Promemoria Pagamento" mancante o disabilitato in Messaggi di Sistema Pro')
        return
      }
      if (!sendRes.ok || sendJson?.skipped) {
        toast.error(`Invio sollecito fallito: ${sendJson?.message || sendJson?.reason || 'errore sconosciuto'}`)
        return
      }

      // Stamp the sollecito on every booking of the group (merge, don't clobber
      // other booking_details keys). last_sent_at + incremented count drive the
      // 48h auto-resend cron.
      const nowIso = new Date().toISOString()
      const allBookings = [...group.noleggioBookings, ...group.primeWashBookings]
      for (const b of allBookings) {
        const existing = b.booking_details || {}
        const prevCount = Number(existing?.sollecito?.count || 0)
        await supabase
          .from('bookings')
          .update({
            booking_details: {
              ...existing,
              sollecito: { last_sent_at: nowIso, count: prevCount + 1 },
            },
          })
          .eq('id', b.id)
      }
      toast.success('Sollecito inviato')
      loadUnpaidBookings()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invio sollecito fallito'
      toast.error(msg)
    } finally {
      setSollecitoSendingKey(null)
    }
  }

  async function markSingleFatturaItemPaid(fi: FatturaItem) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture').select('id, items').eq('id', fi.fatturaId).single()
      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        const existing = items[fi.itemIndex]
        const total = existing.total || (existing.unit_price || 0) * (existing.quantity || 1)
        items[fi.itemIndex] = { ...existing, amountPaid: total, paymentStatus: 'paid' }
      }

      await supabase.from('fatture').update({ items }).eq('id', fi.fatturaId)
      logAdminAction('mark_fattura_item_paid', 'fattura', fi.fatturaId, {
        fattura_number: fi.fatturaNumero,
        description: fi.description,
        type: fi.type,
        amount: fi.total - fi.amountPaid,
      })
      toast.success('Pagamento registrato')
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markAllTypePaid(booking: UnpaidBooking, type: 'penalties' | 'danni') {
    const key = `type:${booking.id}:${type}`
    if (processingKey) return
    setProcessingKey(key)
    try {
      // Re-fetch fresh booking_details
      const { data: fresh } = await supabase.from('bookings').select('booking_details').eq('id', booking.id).single()
      const details = fresh?.booking_details || booking.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = details[type] || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pending = arr.filter((item: any) => item.paymentStatus !== 'paid')

      // 1. FIRST: Mark items as paid in DB (this must succeed)
      if (pending.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated = arr.map((item: any) => {
          if (item.paymentStatus !== 'paid') {
            const total = item.total || (item.amount || 0) * (item.quantity || 1)
            return { ...item, paymentStatus: 'paid', amountPaid: total }
          }
          return item
        })
        const { error: updateErr } = await supabase.from('bookings').update({ booking_details: { ...details, [type]: updated } }).eq('id', booking.id)
        if (updateErr) throw updateErr
      }

      // Mark fattura source items as paid
      const fItems = (fatturaItemsMap[booking.id] || []).filter(fi => fi.type === type)
      for (const fi of fItems) {
        await markSingleFatturaItemPaid(fi)
      }

      toast.success(`${type === 'danni' ? 'Danni' : 'Penali'} segnati come pagati`)
      logAdminAction('mark_type_paid', 'booking', booking.id, {
        ...buildBookingContext(booking),
        type,
        items_count: pending.length,
      })

      // 2. THEN: Try to generate fattura (non-blocking — payment is already marked)
      if (pending.length > 0) {
        // Carry the per-item discount that DanniPenaliModal stored when the
        // admin set "Prezzo finale desiderato". Items go to the fattura at
        // their FULL price (so the subtotale matches what the customer
        // initially saw); the sum of discounts is sent as discountAmount and
        // the fattura renders Subtotal / Sconto / Totale correctly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoiceItems = pending.map((item: any) => {
          // 2026-06-06: fatturare il TOTALE della penale (prezzo pieno), non il
          // solo residuo. I pagamenti parziali ("Parziale") NON emettono
          // fattura, quindi fatturando solo il residuo l'acconto gia' incassato
          // (es. 300 su 387) non verrebbe MAI fatturato. Lo sconto viaggia a
          // parte come discountAmount (vedi commento sopra), cosi' Subtotale /
          // Sconto / Totale restano corretti.
          const total = item.total || (item.amount || 0) * (item.quantity || 1)
          return { label: item.label, amount: total, quantity: 1 }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }).filter((i: any) => i.amount > 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const totalDiscount = pending.reduce((sum: number, item: any) => sum + (Number(item.discount) || 0), 0)

        if (invoiceItems.length > 0) {
          try {
            const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: booking.id,
                customerId: booking.customer_id || booking.user_id,
                items: invoiceItems,
                discountAmount: totalDiscount > 0 ? totalDiscount : undefined,
                type: type === 'danni' ? 'danni' : undefined,
                paymentStatus: 'paid'
              })
            })
            if (res.ok) {
              const data = await res.json()
              toast.success(`Fattura ${data.invoice?.numero_fattura || ''} generata`)
            } else {
              const err = await res.json()
              toast.error('Fattura non generata: ' + (err.message || err.error || 'errore'))
            }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (invErr: any) {
            toast.error('Fattura non generata: ' + (invErr.message || 'errore'))
          }
        }
      }

      loadUnpaidBookings()
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _errMsg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setProcessingKey(null)
    }
  }

  async function handleTypePartialPayment(booking: UnpaidBooking, type: 'penalties' | 'danni', paymentAmount: number) {
    try {
      let remaining = paymentAmount
      // Re-fetch fresh booking_details
      const { data: fresh } = await supabase.from('bookings').select('booking_details').eq('id', booking.id).single()
      const details = fresh?.booking_details || booking.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = [...(details[type] || [])]
      let changed = false
      for (let i = 0; i < arr.length; i++) {
        if (remaining <= 0) break
        const item = arr[i]
        if (item.paymentStatus === 'paid') continue
        // 2026-05-30 BUG FIX: includi 'nexi_pay_by_link' tra gli stati pagabili.
        // Un item con link inviato ("in attesa di pagamento — Pay by Link inviato")
        // ha paymentStatus='nexi_pay_by_link': prima veniva SALTATO dal loop, quindi
        // "Parziale" non scriveva nulla ma mostrava lo stesso il toast di successo
        // → l'admin vedeva "ok" ma la riga non cambiava (es. Cani/pelo di cane).
        if (item.paymentStatus
            && item.paymentStatus !== 'pending'
            && item.paymentStatus !== 'partial'
            && item.paymentStatus !== 'nexi_pay_by_link') continue
        const total = item.total || (item.amount || 0) * (item.quantity || 1)
        const itemRemaining = total - (item.amountPaid || 0)
        const toApply = Math.min(remaining, itemRemaining)
        if (toApply > 0) {
          const newPaid = (item.amountPaid || 0) + toApply
          arr[i] = { ...item, amountPaid: newPaid, paymentStatus: newPaid >= total ? 'paid' : 'partial' }
          remaining -= toApply
          changed = true
        }
      }
      if (changed) {
        await supabase.from('bookings').update({ booking_details: { ...details, [type]: arr } }).eq('id', booking.id)
      }

      if (remaining > 0) {
        const fItems = (fatturaItemsMap[booking.id] || []).filter(fi => fi.type === type)
        for (const fi of fItems) {
          if (remaining <= 0) break
          const fiRemaining = fi.total - fi.amountPaid
          const toApply = Math.min(remaining, fiRemaining)
          if (toApply > 0) {
            await handleFatturaItemPayment(fi, toApply)
            remaining -= toApply
          }
        }
      }

      // 2026-05-30: non mentire all'admin. Mostra successo solo se qualcosa è
      // stato davvero applicato (item booking_details o fattura).
      if (changed || remaining < paymentAmount) {
        toast.success('Pagamento parziale registrato')
      } else {
        toast.error('Nessun importo applicato — la voce potrebbe essere già saldata o non trovata.')
      }
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function handleBookingPartialPayment(bookingId: string, amount: number) {
    try {
      if (!bookingId || !Number.isFinite(amount) || amount <= 0) {
        toast.error('Importo non valido')
        return
      }
      // Local state may be momentarily stale because the realtime subscription
      // resets `bookings` between the "Parziale" click and the OK click. Fetch
      // fresh from DB so we never silently bail.
      let booking = bookings.find(b => b.id === bookingId)
      if (!booking) {
        const { data: fresh, error: fetchErr } = await supabase
          .from('bookings')
          .select('id, price_total, booking_details, service_type')
          .eq('id', bookingId)
          .maybeSingle()
        if (fetchErr) throw fetchErr
        if (!fresh) {
          toast.error('Prenotazione non trovata')
          return
        }
        booking = fresh as unknown as UnpaidBooking
      }

      const details = booking.booking_details || {}
      const currentPaid = Number(details.amountPaid) || 0
      const newPaid = currentPaid + Math.round(amount * 100)
      const isFullyPaid = newPaid >= booking.price_total

      const { error } = await supabase
        .from('bookings')
        .update({
          booking_details: { ...details, amountPaid: newPaid },
          payment_status: isFullyPaid ? 'paid' : 'partial'
        })
        .eq('id', bookingId)

      if (error) throw error
      toast.success(`Pagamento parziale €${amount.toFixed(2)} registrato`)

      // DR7 Privilege — fire when partial completes the full balance.
      if (isFullyPaid) {
        const isCarWash = booking.service_type === 'car_wash'
        fetch('/.netlify/functions/trigger-dr7-privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId, kind: isCarWash ? 'lavaggio' : 'noleggio' }),
        }).catch(() => { /* non-blocking */ })
      }

      setPartialPayItemKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markAllCustomerItemsPaid(group: CustomerGroup, type: 'penalties' | 'danni') {
    const key = `allitems:${group.customerKey}:${type}`
    if (processingKey) return // Already processing something
    setProcessingKey(key)
    try {
      const items = type === 'penalties' ? group.penaliItems : group.danniItems
      if (items.length === 0) { setProcessingKey(null); return }

      // Collect invoice line items from booking_details source items
      const invoiceLineItems: { label: string; amount: number; quantity: number }[] = []
      const bookingUpdates = new Map<string, { booking: UnpaidBooking; indices: number[] }>()

      for (const item of items) {
        if (item.source === 'booking_details' && item.remaining > 0) {
          invoiceLineItems.push({ label: item.label, amount: item.remaining, quantity: 1 })
          if (!bookingUpdates.has(item.bookingId)) {
            bookingUpdates.set(item.bookingId, { booking: item.booking, indices: [] })
          }
          bookingUpdates.get(item.bookingId)!.indices.push(item.originalIndex)
        }
      }

      // 1. FIRST: Mark all booking_details items as paid in DB
      for (const [bookingId, { booking, indices }] of bookingUpdates) {
        const details = booking.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details[type] || [])]
        for (const idx of indices) {
          if (arr[idx]) {
            const total = arr[idx].total || (arr[idx].amount || 0) * (arr[idx].quantity || 1)
            arr[idx] = { ...arr[idx], paymentStatus: 'paid', amountPaid: total }
          }
        }
        await supabase.from('bookings').update({ booking_details: { ...details, [type]: arr } }).eq('id', bookingId)
      }

      // Mark all fattura source items as paid
      const fatturaItems = items.filter(i => i.source === 'fattura')
      for (const fItem of fatturaItems) {
        const fi = (fatturaItemsMap[fItem.bookingId] || []).find(f => f.fatturaId === fItem.fatturaId && f.itemIndex === fItem.itemIndex)
        if (fi) await markSingleFatturaItemPaid(fi)
      }

      toast.success(`Tutti ${type === 'danni' ? 'i danni' : 'le penali'} segnati come pagati`)

      // 2. THEN: Try to generate fattura (non-blocking — payment is already marked)
      if (invoiceLineItems.length > 0) {
        const firstItem = items.find(i => i.source === 'booking_details')!
        try {
          const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: firstItem.bookingId,
              customerId: firstItem.booking.customer_id || firstItem.booking.user_id,
              items: invoiceLineItems,
              type: type === 'danni' ? 'danni' : undefined,
              paymentStatus: 'paid'
            })
          })
          if (res.ok) {
            const data = await res.json()
            toast.success(`Fattura ${data.invoice?.numero_fattura || ''} generata`)
          } else {
            const err = await res.json()
            toast.error('Fattura non generata: ' + (err.message || err.error || 'errore'))
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (invErr: any) {
          toast.error('Fattura non generata: ' + (invErr.message || 'errore'))
        }
      }

      loadUnpaidBookings()
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _errMsg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setProcessingKey(null)
    }
  }

  async function markBookingAndExtensionsPaid(booking: UnpaidBooking) {
    try {
      const isPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid' || booking.payment_status === 'partial'
      const vehicle = booking.vehicle_name || booking.booking_details?.vehicle?.name || 'Noleggio'
      const plate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || ''

      // 1. Collect unpaid line items for fattura
      const invoiceLineItems: { label: string; amount: number; quantity: number }[] = []

      // Add base booking only if it's actually unpaid
      if (isPending) {
        const totalCents = booking.price_total || 0
        const paidCents = booking.booking_details?.amountPaid || 0
        const remainingEur = Math.max(0, (totalCents - paidCents) / 100)
        if (remainingEur > 0) {
          invoiceLineItems.push({
            label: `Noleggio ${vehicle}${plate ? ` (${plate})` : ''}`,
            amount: remainingEur,
            quantity: 1
          })
        }
      }

      // 2. Mark pending extensions as paid and collect their amounts
      const extensions = [...(booking.booking_details?.extension_history || [])]
      for (let i = 0; i < extensions.length; i++) {
        if (extensions[i].payment_status === 'pending' || extensions[i].payment_status === 'partial' || extensions[i].payment_status === 'nexi_pay_by_link') {
          const extTotal = extensions[i].additional_amount || 0
          const extPaid = extensions[i].amount_paid || 0
          const extRemaining = Math.max(0, extTotal - extPaid)
          if (extRemaining > 0) {
            let days = extensions[i].additional_days
            if (!days && extensions[i].previous_dropoff && extensions[i].new_dropoff) {
              const prev = new Date(extensions[i].previous_dropoff)
              const next = new Date(extensions[i].new_dropoff)
              days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
            }
            invoiceLineItems.push({
              label: `Estensione +${days || '?'}gg ${vehicle}`,
              amount: extRemaining,
              quantity: 1
            })
          }
          extensions[i] = { ...extensions[i], payment_status: 'paid', amount_paid: extensions[i].additional_amount || 0 }
        }
      }

      // 2b. 2026-07-01 BUG FIX: segna come pagate le penali + danni della
      // prenotazione SENZA emettere un'altra fattura (la fattura e' gia' stata
      // fatta). Prima "Segna Pagato" lasciava le penali (es. Sforo Km) aperte in
      // "Da Saldare": qui le togliamo dalla lista, nessun nuovo documento fiscale
      // (non vengono aggiunte a invoiceLineItems).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const penaltiesArr: any[] = [...(booking.booking_details?.penalties || [])]
      for (let i = 0; i < penaltiesArr.length; i++) {
        const p = penaltiesArr[i]
        const unpaid = !p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial' || p.paymentStatus === 'nexi_pay_by_link'
        if (!unpaid) continue
        const pNet = (p.total || (p.amount || 0) * (p.quantity || 1)) - (p.discount || 0)
        penaltiesArr[i] = { ...p, paymentStatus: 'paid', amountPaid: pNet }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const danniArr: any[] = [...(booking.booking_details?.danni || [])]
      for (let i = 0; i < danniArr.length; i++) {
        const d = danniArr[i]
        const unpaid = !d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial' || d.paymentStatus === 'nexi_pay_by_link'
        if (!unpaid) continue
        const dNet = (d.total || (d.amount || 0) * (d.quantity || 1)) - (d.discount || 0)
        danniArr[i] = { ...d, paymentStatus: 'paid', amountPaid: dNet }
      }

      // 3. Generate fattura FIRST — if it fails, abort before marking as paid
      if (invoiceLineItems.length > 0) {
        const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            customerId: booking.customer_id || booking.user_id,
            items: invoiceLineItems,
            rawDescriptions: true,
            paymentStatus: 'paid'
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Errore generazione fattura — nessun elemento segnato come pagato.')
        }
        const data = await res.json()
        toast.success(`Fattura ${data.invoice?.numero_fattura || ''} generata!`)
      }

      // 4. Fattura succeeded — NOW update booking in DB.
      // 2026-06-03 BUG FIX: oltre a payment_status, azzera il RESIDUO portando
      // amount_paid = price_total (e booking_details.amountPaid). price_total
      // include già le estensioni (handleConfirmExtend lo incrementa), quindi
      // questo copre base + estensioni. Prima NON veniva aggiornato: la
      // prenotazione risultava "pagata" ma il cliente vedeva ancora il residuo
      // (es. €500) perché remaining = price_total - amountPaid restava > 0.
      const totalCents = Number(booking.price_total || 0)
      const { error } = await supabase.from('bookings').update({
        payment_status: 'paid',
        status: 'confirmed',
        amount_paid: totalCents,
        booking_details: { ...booking.booking_details, amountPaid: totalCents, extension_history: extensions, penalties: penaltiesArr, danni: danniArr }
      }).eq('id', booking.id)
      if (error) throw error
      await propagatePaidToCarwashShadows(booking.id, true, booking.payment_method)
      toast.success('Tutto segnato come pagato!')
      logAdminAction('mark_booking_extensions_paid', 'booking', booking.id, buildBookingContext(booking))

      // DR7 Privilege — fire-and-forget. Backend (utils/dr7Privilege) is
      // idempotent via dr7_privilege_sent_at.
      {
        const isCarWash = booking.service_type === 'car_wash'
        fetch('/.netlify/functions/trigger-dr7-privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id, kind: isCarWash ? 'lavaggio' : 'noleggio' }),
        }).catch(() => { /* non-blocking */ })
      }

      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function markAllCustomerPaid(group: CustomerGroup, paymentMethod?: string) {
    const key = `allcustomer:${group.customerKey}`
    if (processingKey) return
    setProcessingKey(key)
    try {
      // Collect ALL line items for ONE combined fattura
      const invoiceLineItems: { label: string; amount: number; quantity: number }[] = []

      // Pick a bookingId to anchor the fattura (first available)
      let anchorBookingId = group.noleggioBookings[0]?.id || group.primeWashBookings[0]?.id || group.penaliItems[0]?.bookingId || group.danniItems[0]?.bookingId
      let anchorCustomerId = ''

      // 1. Noleggio bookings + extensions → collect line items (DO NOT mark paid yet — fattura first)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noleggioUpdates: { bookingId: string; extensions: any[]; booking: UnpaidBooking }[] = []
      for (const booking of group.noleggioBookings) {
        if (!anchorCustomerId) anchorCustomerId = booking.customer_id || booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = booking.id

        const vehicle = booking.vehicle_name || booking.booking_details?.vehicle?.name || booking.booking_details?.vehicle_name || 'Noleggio'
        const plate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || booking.booking_details?.vehicle_plate || ''
        const isPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid' || booking.payment_status === 'partial'

        if (isPending) {
          const totalCents = booking.price_total || 0
          const paidCents = booking.booking_details?.amountPaid || 0
          const remainingEur = Math.max(0, (totalCents - paidCents) / 100)
          if (remainingEur > 0) {
            invoiceLineItems.push({
              label: `Noleggio ${vehicle}${plate ? ` (${plate})` : ''}`,
              amount: remainingEur,
              quantity: 1
            })
          }
        }

        const extensions = [...(booking.booking_details?.extension_history || [])]
        for (let i = 0; i < extensions.length; i++) {
          if (extensions[i].payment_status === 'pending' || extensions[i].payment_status === 'partial' || extensions[i].payment_status === 'nexi_pay_by_link') {
            const extTotal = extensions[i].additional_amount || 0
            const extPaid = extensions[i].amount_paid || 0
            const extRemaining = Math.max(0, extTotal - extPaid)
            if (extRemaining > 0) {
              let days = extensions[i].additional_days
              if (!days && extensions[i].previous_dropoff && extensions[i].new_dropoff) {
                const prev = new Date(extensions[i].previous_dropoff)
                const next = new Date(extensions[i].new_dropoff)
                days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
              }
              invoiceLineItems.push({
                label: `Estensione +${days || '?'}gg ${vehicle}`,
                amount: extRemaining,
                quantity: 1
              })
            }
            extensions[i] = { ...extensions[i], payment_status: 'paid', amount_paid: extensions[i].additional_amount || 0 }
          }
        }

        noleggioUpdates.push({ bookingId: booking.id, extensions, booking })
      }

      // 2. Prime Wash bookings → collect line items (DO NOT mark paid yet — fattura first)
      const primeWashBookingIds: string[] = []
      for (const booking of group.primeWashBookings) {
        if (!anchorCustomerId) anchorCustomerId = booking.customer_id || booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = booking.id

        const serviceName = booking.service_name || 'Servizio'
        const totalCents = booking.price_total || 0
        const paidCents = booking.booking_details?.amountPaid || 0
        const remainingEur = Math.max(0, (totalCents - paidCents) / 100)
        if (remainingEur > 0) {
          invoiceLineItems.push({ label: serviceName, amount: remainingEur, quantity: 1 })
        }

        primeWashBookingIds.push(booking.id)
      }

      // 3. Penali → collect line items (DO NOT mark paid yet — fattura first)
      const penaliBookingUpdates = new Map<string, { booking: UnpaidBooking; indices: number[] }>()
      for (const item of group.penaliItems) {
        if (!anchorCustomerId) anchorCustomerId = item.booking.customer_id || item.booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = item.bookingId

        if (item.source === 'booking_details' && item.remaining > 0) {
          invoiceLineItems.push({ label: `Penale - ${item.label}`, amount: item.remaining, quantity: 1 })
          if (!penaliBookingUpdates.has(item.bookingId)) {
            penaliBookingUpdates.set(item.bookingId, { booking: item.booking, indices: [] })
          }
          penaliBookingUpdates.get(item.bookingId)!.indices.push(item.originalIndex)
        }
      }

      // 4. Danni → collect line items (DO NOT mark paid yet — fattura first)
      const danniBookingUpdates = new Map<string, { booking: UnpaidBooking; indices: number[] }>()
      for (const item of group.danniItems) {
        if (!anchorCustomerId) anchorCustomerId = item.booking.customer_id || item.booking.user_id || ''
        if (!anchorBookingId) anchorBookingId = item.bookingId

        if (item.source === 'booking_details' && item.remaining > 0) {
          invoiceLineItems.push({ label: `Danno - ${item.label}`, amount: item.remaining, quantity: 1 })
          if (!danniBookingUpdates.has(item.bookingId)) {
            danniBookingUpdates.set(item.bookingId, { booking: item.booking, indices: [] })
          }
          danniBookingUpdates.get(item.bookingId)!.indices.push(item.originalIndex)
        }
      }

      // 5. Generate fattura FIRST — if it fails, abort before marking anything as paid
      if (invoiceLineItems.length > 0 && anchorBookingId) {
        const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: anchorBookingId,
            customerId: anchorCustomerId,
            items: invoiceLineItems,
            rawDescriptions: true,
            paymentStatus: 'paid'
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Errore generazione fattura — nessun elemento segnato come pagato.')
        }
        const data = await res.json()
        toast.success(`Fattura unica ${data.invoice?.numero_fattura || ''} generata per ${group.customerName}!`)
      }

      // 6. Fattura succeeded (or no items) — NOW mark everything as paid in DB
      for (const { bookingId, extensions, booking } of noleggioUpdates) {
        const noleggioUpdate: Record<string, unknown> = {
          payment_status: 'paid', status: 'confirmed',
          booking_details: { ...booking.booking_details, extension_history: extensions }
        }
        if (paymentMethod) noleggioUpdate.payment_method = paymentMethod
        await supabase.from('bookings').update(noleggioUpdate).eq('id', bookingId)

        // DR7 Privilege — fire-and-forget per noleggio. Backend idempotente.
        fetch('/.netlify/functions/trigger-dr7-privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId, kind: 'noleggio' }),
        }).catch(() => { /* non-blocking */ })

        // Each newly-paid rental needs its contract regenerated and the firma
        // link re-sent to the customer — UNLESS the customer has already
        // signed. In that case the booking was "Confermata da saldare"
        // because the signature came back; re-sending would push a new
        // signing link for a contract the customer already signed.
        // Best-effort — any failure here is logged but does not abort the batch.
        try {
          const { data: signedCheck } = await supabase
            .from('contracts')
            .select('signed_pdf_url')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (signedCheck?.signed_pdf_url) {
            logger.log('[markAllCustomerPaid] Contract already signed for', bookingId, '— skipping regenerate + signature-init')
          } else {
            await authFetch('/.netlify/functions/generate-contract', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bookingId, silent: true })
            })
            const { data: contractForSig } = await supabase
              .from('contracts')
              .select('id, pdf_url')
              .eq('booking_id', bookingId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (contractForSig?.id && contractForSig?.pdf_url) {
              await fetch('/.netlify/functions/signature-init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractId: contractForSig.id, bookingId })
              })
            }
          }
        } catch (sigErr) {
          logger.warn('[markAllCustomerPaid] contract/firma pipeline failed for', bookingId, sigErr)
        }
      }

      for (const pwId of primeWashBookingIds) {
        const pwUpdate: Record<string, unknown> = { payment_status: 'paid', status: 'confirmed' }
        if (paymentMethod) pwUpdate.payment_method = paymentMethod
        await supabase.from('bookings').update(pwUpdate).eq('id', pwId)
        // Propaga ai blocchi cortesia/supercar collegati a questo lavaggio.
        await propagatePaidToCarwashShadows(pwId, true, paymentMethod)

        // DR7 Privilege — fire-and-forget per lavaggio. Backend idempotente.
        fetch('/.netlify/functions/trigger-dr7-privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: pwId, kind: 'lavaggio' }),
        }).catch(() => { /* non-blocking */ })
      }

      for (const [bookingId, { booking, indices }] of penaliBookingUpdates) {
        const details = booking.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details.penalties || [])]
        for (const idx of indices) {
          if (arr[idx]) {
            const total = arr[idx].total || (arr[idx].amount || 0) * (arr[idx].quantity || 1)
            arr[idx] = { ...arr[idx], paymentStatus: 'paid', amountPaid: total }
          }
        }
        await supabase.from('bookings').update({ booking_details: { ...details, penalties: arr } }).eq('id', bookingId)
      }

      for (const [bookingId, { booking, indices }] of danniBookingUpdates) {
        const details = booking.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details.danni || [])]
        for (const idx of indices) {
          if (arr[idx]) {
            const total = arr[idx].total || (arr[idx].amount || 0) * (arr[idx].quantity || 1)
            arr[idx] = { ...arr[idx], paymentStatus: 'paid', amountPaid: total }
          }
        }
        await supabase.from('bookings').update({ booking_details: { ...details, danni: arr } }).eq('id', bookingId)
      }

      // 7. Mark fattura-source penali/danni items as paid
      const fatturaSourceItems = [...group.penaliItems, ...group.danniItems].filter(i => i.source === 'fattura')
      for (const fItem of fatturaSourceItems) {
        const fi = (fatturaItemsMap[fItem.bookingId] || []).find(f => f.fatturaId === fItem.fatturaId && f.itemIndex === fItem.itemIndex)
        if (fi) await markSingleFatturaItemPaid(fi)
      }

      if (invoiceLineItems.length === 0) {
        toast.success(`Tutto pagato per ${group.customerName}!`)
      }

      logAdminAction('mark_all_customer_paid', 'customer', group.customerKey, {
        customer: group.customerName,
        noleggio_count: group.noleggioBookings.length,
        prime_wash_count: group.primeWashBookings.length,
        penalties_count: group.penaliItems.length,
        danni_count: group.danniItems.length,
        total: invoiceLineItems.reduce((sum, i) => sum + i.amount, 0),
      })
      loadUnpaidBookings()
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _errMsg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setProcessingKey(null)
    }
  }

  async function updateBookingAmount(bookingId: string, newAmountEur: number) {
    try {
      const newAmountCents = Math.round(newAmountEur * 100)
      const { error } = await supabase
        .from('bookings')
        .update({ price_total: newAmountCents })
        .eq('id', bookingId)

      if (error) throw error
      toast.success('Importo aggiornato!')
      setEditAmountKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function deleteFatturaItem(fi: FatturaItem) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture')
        .select('id, items')
        .eq('id', fi.fatturaId)
        .single()

      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      items.splice(fi.itemIndex, 1)

      const { error: updateErr } = await supabase
        .from('fatture')
        .update({ items })
        .eq('id', fi.fatturaId)

      if (updateErr) throw updateErr
      toast.success('Elemento fattura eliminato!')
      setConfirmDeleteKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  async function updateFatturaItemAmount(fi: FatturaItem, newAmountEur: number) {
    try {
      const { data: fattura, error: fetchErr } = await supabase
        .from('fatture')
        .select('id, items')
        .eq('id', fi.fatturaId)
        .single()

      if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
      if (items[fi.itemIndex]) {
        items[fi.itemIndex] = {
          ...items[fi.itemIndex],
          total: newAmountEur,
          unit_price: newAmountEur,
          quantity: 1,
        }
      }

      const { error: updateErr } = await supabase
        .from('fatture')
        .update({ items })
        .eq('id', fi.fatturaId)

      if (updateErr) throw updateErr
      toast.success('Importo fattura aggiornato!')
      setEditAmountKey(null)
      loadUnpaidBookings()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    }
  }

  // ── Helper functions (preserved) ───────────────────────────────────────────

  const getEffectiveType = (booking: UnpaidBooking): 'rental' | 'prime_wash' | 'other' => {
    if (booking.service_type === 'rental') return 'rental'
    if (booking.service_type === 'car_wash' || booking.service_type === 'mechanical_service') return 'prime_wash'
    if (booking.vehicle_name || booking.booking_details?.vehicle) return 'rental'
    if (booking.service_name) {
      const sn = booking.service_name.toLowerCase()
      if (sn.includes('lavaggio') || sn.includes('wash') || sn.includes('meccanica') || sn.includes('mechanical')) return 'prime_wash'
    }
    return 'rental'
  }

  const getRemainingAmount = (booking: UnpaidBooking) => {
    let remaining = 0

    // 2026-05-21: aggiunto 'partial' ai pending. Booking parziale
    // (es. €200 pagati su €689 → payment_status='partial') cadeva
    // sull'else che gestisce solo extensions, quindi totalRemaining
    // restava 0 e il card mostrava "€0,00 1 voce" — l'admin non
    // vedeva il residuo da incassare.
    if (booking.payment_status === 'pending'
        || booking.payment_status === 'unpaid'
        || booking.payment_status === 'partial') {
      const total = booking.price_total || 0
      const paid = booking.booking_details?.amountPaid || 0
      remaining += Math.max(0, total - paid)
    } else {
      const extensions = booking.booking_details?.extension_history || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions.forEach((ext: any) => {
        if ((ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link') && ext.additional_amount) {
          const extTotal = ext.additional_amount * 100
          const extPaid = (ext.amount_paid || 0) * 100
          remaining += Math.max(0, extTotal - extPaid)
        }
      })
    }

    const penalties = booking.booking_details?.penalties || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    penalties.forEach((p: any) => {
      if (!p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial' || p.paymentStatus === 'nexi_pay_by_link') {
        const total = p.total || (p.amount || 0) * (p.quantity || 1)
        // `discount` is set by DanniPenaliModal when the admin used
        // "Prezzo finale desiderato". Owed = total − discount − paid.
        const discount = p.discount || 0
        const paid = p.amountPaid || 0
        remaining += Math.round((total - discount - paid) * 100)
      }
    })

    const danni = booking.booking_details?.danni || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    danni.forEach((d: any) => {
      if (!d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial' || d.paymentStatus === 'nexi_pay_by_link') {
        const total = d.total || (d.amount || 0) * (d.quantity || 1)
        const discount = d.discount || 0
        const paid = d.amountPaid || 0
        remaining += Math.round((total - discount - paid) * 100)
      }
    })

    const fItems = fatturaItemsMap[booking.id] || []
    fItems.forEach(fi => {
      remaining += Math.round((fi.total - fi.amountPaid) * 100)
    })

    return remaining
  }

  const getPendingExtensions = (booking: UnpaidBooking) => {
    const extensions = booking.booking_details?.extension_history || []
    return extensions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((ext: any, idx: number) => ({ ext, idx }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(({ ext }: any) => {
        const unpaid = ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link'
        if (!unpaid) return false
        // 2026-05-28: nascondi estensioni con residuo 0 (es. Da Saldare €0
        // = solo cambio data senza extra). Allineato al booking filter
        // sopra a riga ~440.
        const amt = Number(ext.additional_amount) || 0
        const paid = Number(ext.amount_paid) || 0
        return (amt - paid) > 0
      })
  }

  const getPendingWithIndex = (booking: UnpaidBooking, arrayKey: 'penalties' | 'danni') => {
    const arr = booking.booking_details?.[arrayKey] || []
    return arr
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any, realIdx: number) => ({ item, realIdx }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(({ item }: any) => {
        const unpaid = !item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'partial' || item.paymentStatus === 'nexi_pay_by_link'
        if (!unpaid) return false
        // 2026-06-06: usa il totale reale (total o amount×quantity) meno sconto,
        // NON item.amount (prezzo unitario). Stesso bug del filtro insoluti
        // (~riga 491): una penale con quantity>1 (Sforo Km 43×9) spariva.
        const total = Number(item.total) || (Number(item.amount) || 0) * (Number(item.quantity) || 1)
        const discount = Number(item.discount) || 0
        const paid = Number(item.amountPaid) || 0
        return (total - discount - paid) > 0
      })
  }

  // ── Build Customer Groups ──────────────────────────────────────────────────

  const customerGroups = useMemo((): CustomerGroup[] => {
    const groupMap = new Map<string, CustomerGroup>()

    for (const booking of bookings) {
      const name = booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'
      const key = name.toLowerCase().trim()

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          customerKey: key,
          customerName: name,
          customerEmail: booking.customer_email || booking.booking_details?.customer?.email || '',
          customerPhone: booking.customer_phone || booking.booking_details?.customer?.phone || '',
          noleggioBookings: [],
          primeWashBookings: [],
          penaliItems: [],
          danniItems: [],
          totalRemaining: 0,
          chargedViaMit: 0,
        })
      }

      const group = groupMap.get(key)!
      // Update contact info if empty (pick from any booking that has it)
      if (!group.customerEmail && (booking.customer_email || booking.booking_details?.customer?.email)) {
        group.customerEmail = booking.customer_email || booking.booking_details?.customer?.email
      }
      if (!group.customerPhone && (booking.customer_phone || booking.booking_details?.customer?.phone)) {
        group.customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone
      }

      const effectiveType = getEffectiveType(booking)

      // Only show in Noleggio/PW column if the main booking payment is unpaid
      // (or has unpaid extensions). If the booking is paid but has only unpaid
      // danni/penali, it belongs ONLY in those columns. "Unpaid" = anything
      // not in (paid, completed, succeeded) so partial / nexi_pay_by_link /
      // empty status all surface correctly.
      const mainIsUnpaid = !(booking.payment_status === 'paid'
        || booking.payment_status === 'completed'
        || booking.payment_status === 'succeeded')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // 2026-06-13: contano solo le estensioni con residuo > 0. Un'estensione
      // €0 (Da Saldare = solo cambio data, nulla da pagare) NON deve far
      // comparire il noleggio già pagato in questa tab. Allineato a
      // getRemainingAmount / getPendingExtensions (che già filtrano il residuo 0).
      const hasUnpaidExtensions = (booking.booking_details?.extension_history || []).some((ext: any) => {
        const unpaid = ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link'
        if (!unpaid) return false
        const amt = Number(ext.additional_amount) || 0
        const paid = Number(ext.amount_paid) || 0
        return (amt - paid) > 0
      })

      if (mainIsUnpaid || hasUnpaidExtensions) {
        if (effectiveType === 'rental') {
          group.noleggioBookings.push(booking)
        } else {
          group.primeWashBookings.push(booking)
        }
      }

      // Collect pending penalties from booking_details
      const pendingPenalties = getPendingWithIndex(booking, 'penalties')
      for (const { item, realIdx } of pendingPenalties) {
        const total = item.total || (item.amount || 0) * (item.quantity || 1)
        const paid = item.amountPaid || 0
        group.penaliItems.push({
          bookingId: booking.id,
          booking,
          label: item.label || 'Penale',
          amount: total,
          amountPaid: paid,
          remaining: total - paid,
          paymentStatus: item.paymentStatus || 'pending',
          source: 'booking_details',
          type: 'penalties',
          originalIndex: realIdx,
        })
      }

      // Collect pending danni from booking_details
      const pendingDanni = getPendingWithIndex(booking, 'danni')
      for (const { item, realIdx } of pendingDanni) {
        const total = item.total || (item.amount || 0) * (item.quantity || 1)
        const paid = item.amountPaid || 0
        group.danniItems.push({
          bookingId: booking.id,
          booking,
          label: item.label || 'Danno',
          amount: total,
          amountPaid: paid,
          remaining: total - paid,
          paymentStatus: item.paymentStatus || 'pending',
          source: 'booking_details',
          type: 'danni',
          originalIndex: realIdx,
        })
      }

      // Collect from fattura items
      const fItems = fatturaItemsMap[booking.id] || []
      for (const fi of fItems) {
        const target = fi.type === 'danni' ? group.danniItems : group.penaliItems
        target.push({
          bookingId: booking.id,
          booking,
          label: `${fi.description} (${fi.fatturaNumero})`,
          amount: fi.total,
          amountPaid: fi.amountPaid,
          remaining: fi.total - fi.amountPaid,
          paymentStatus: fi.paymentStatus,
          source: 'fattura',
          fatturaId: fi.fatturaId,
          fatturaNumero: fi.fatturaNumero,
          itemIndex: fi.itemIndex,
          type: fi.type,
          originalIndex: fi.itemIndex,
        })
      }

      group.totalRemaining += getRemainingAmount(booking)
    }

    // Subtract MIT charged amounts from totalRemaining
    for (const group of groupMap.values()) {
      const emailKey = (group.customerEmail || '').toLowerCase().trim()
      const charged = mitChargedMap[emailKey] || 0
      if (charged > 0) {
        group.chargedViaMit = charged
        group.totalRemaining = Math.max(0, group.totalRemaining - charged)
      }
    }

    let groups = Array.from(groupMap.values())

    // Apply filter. Penali belong to the rental tab (they are billed against a
    // rental), danni likewise. A customer whose main rental is already PAID but
    // has an outstanding penale/danno (e.g. Nexi Pay by Link still in flight)
    // must still appear here — otherwise the "In attesa di pagamento" item is
    // invisible and the admin thinks the link was never sent.
    if (filterService === 'rental') {
      groups = groups.filter(g =>
        g.noleggioBookings.length > 0
        || g.penaliItems.length > 0
        || g.danniItems.length > 0
      )
    } else if (filterService === 'prime_wash') {
      groups = groups.filter(g => g.primeWashBookings.length > 0)
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      groups = groups.filter(g =>
        g.customerName.toLowerCase().includes(q) ||
        g.customerEmail.toLowerCase().includes(q) ||
        g.customerPhone.includes(q)
      )
    }

    // 2026-06-01: filtro periodo — cliente passa se almeno un booking
    // (rental o prime_wash) ha pickup_date nel range.
    if (dateRange.from || dateRange.to) {
      groups = groups.filter(g => {
        const allBks = [...(g.noleggioBookings || []), ...(g.primeWashBookings || [])]
        return allBks.some(bk => {
          const d = String((bk as { pickup_date?: string }).pickup_date || '').slice(0, 10)
          if (!d) return false
          if (dateRange.from && d < dateRange.from) return false
          if (dateRange.to && d > dateRange.to) return false
          return true
        })
      })
    }

    // Sort
    groups.sort((a, b) => {
      if (sortBy === 'amount') {
        return sortDir === 'desc' ? b.totalRemaining - a.totalRemaining : a.totalRemaining - b.totalRemaining
      }
      // name
      const cmp = a.customerName.localeCompare(b.customerName, 'it')
      return sortDir === 'desc' ? -cmp : cmp
    })

    return groups
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, fatturaItemsMap, mitChargedMap, filterService, searchQuery, dateRange, sortBy, sortDir])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalUnpaid = customerGroups.reduce((sum, g) => sum + g.totalRemaining, 0)
  const allGroups = useMemo(() => {
    // Stats computed on unfiltered bookings (respecting column assignment logic)
    const gMap = new Map<string, { rental: boolean; pw: boolean; penali: boolean; danni: boolean }>()
    for (const b of bookings) {
      const key = (b.customer_name || '').toLowerCase().trim()
      if (!gMap.has(key)) gMap.set(key, { rental: false, pw: false, penali: false, danni: false })
      const g = gMap.get(key)!
      const mainUnpaid = b.payment_status === 'pending' || b.payment_status === 'unpaid'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasUnpaidExt = (b.booking_details?.extension_history || []).some((ext: any) => ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link')
      if (mainUnpaid || hasUnpaidExt) {
        if (getEffectiveType(b) === 'rental') g.rental = true
        else g.pw = true
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasPen = (b.booking_details?.penalties || []).some((p: any) => p.paymentStatus !== 'paid')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasDan = (b.booking_details?.danni || []).some((d: any) => d.paymentStatus !== 'paid')
      if (hasPen || (fatturaItemsMap[b.id] || []).some(fi => fi.type === 'penalties')) g.penali = true
      if (hasDan || (fatturaItemsMap[b.id] || []).some(fi => fi.type === 'danni')) g.danni = true
    }
    const vals = Array.from(gMap.values())
    return {
      total: gMap.size,
      rental: vals.filter(v => v.rental).length,
      pw: vals.filter(v => v.pw).length,
      penali: vals.filter(v => v.penali).length,
      danni: vals.filter(v => v.danni).length,
    }
  }, [bookings, fatturaItemsMap])

  const totalChargedViaMit = useMemo(
    () => Object.values(mitChargedMap).reduce((a, b) => a + b, 0),
    [mitChargedMap]
  )

  const topDebtors = useMemo(
    () => [...customerGroups]
      .sort((a, b) => b.totalRemaining - a.totalRemaining)
      .slice(0, 5),
    [customerGroups]
  )

  const performanceStats = useMemo(() => {
    const totalUnpaidCents = customerGroups.reduce((s, g) => s + g.totalRemaining, 0)
    const denom = totalUnpaidCents + totalChargedViaMit
    const recoveryRate = denom > 0 ? Math.round((totalChargedViaMit / denom) * 100) : 0
    const clientsWithMit = customerGroups.filter(g => g.chargedViaMit > 0).length
    const avgPerClient = customerGroups.length > 0 ? totalUnpaidCents / customerGroups.length : 0

    // New KPIs for the 5-card strip (mockup style):
    //  - scadutoCents: sum of remaining for clients whose oldest unpaid item
    //    is older than 14 days
    //  - probabilitaIncasso: % of clients with a tokenized card on file
    //    (chargedViaMit > 0 means we already used the saved card → it works)
    //  - incassiMese: total recovered via MIT charges (proxy for "this month",
    //    refined later when we wire a fatture-by-month query)
    let scadutoCents = 0
    let oldestSum = 0
    let oldestCount = 0
    for (const g of customerGroups) {
      const dates = [
        ...g.noleggioBookings.map(b => b.created_at),
        ...g.primeWashBookings.map(b => b.created_at),
        ...g.penaliItems.map(p => p.booking.created_at),
        ...g.danniItems.map(p => p.booking.created_at),
      ].filter(Boolean) as string[]
      if (dates.length === 0) continue
      const oldest = dates.reduce((a, b) => a < b ? a : b)
      const d = daysSince(oldest)
      if (d != null) {
        oldestSum += d
        oldestCount++
        if (d >= 14) scadutoCents += g.totalRemaining
      }
    }
    const avgAgeDays = oldestCount > 0 ? Math.round(oldestSum / oldestCount) : 0
    const probabilitaIncasso = customerGroups.length > 0
      ? Math.round((customerGroups.filter(g => g.chargedViaMit > 0 || g.totalRemaining === 0).length / customerGroups.length) * 100)
      : 0
    const incassiMese = totalChargedViaMit

    return { recoveryRate, clientsWithMit, avgPerClient, avgAgeDays, scadutoCents, probabilitaIncasso, incassiMese }
  }, [customerGroups, totalChargedViaMit])

  // ── Mobile accordion toggle ────────────────────────────────────────────────

  function handleSort(col: 'amount' | 'name') {
    if (sortBy === col) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(col)
      setSortDir(col === 'amount' ? 'desc' : 'asc')
    }
  }

  function SortArrow({ col }: { col: 'amount' | 'name' }) {
    if (sortBy !== col) return <span className="text-theme-text-muted/30 ml-1">↕</span>
    return <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  function toggleExpanded(key: string) {
    setExpandedCustomers(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Inline partial pay helper ──────────────────────────────────────────────

  function PartialPayInput({ itemKey, onSubmit, onCancel }: { itemKey: string; onSubmit: (v: number) => void; onCancel: () => void }) {
    if (partialPayItemKey !== itemKey) return null
    return (
      <div className="flex items-center gap-1 mt-1">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
          <input
            type="number" step="0.01" min="0.01"
            value={partialPayValue}
            onChange={e => setPartialPayValue(e.target.value)}
            placeholder="Importo"
            className="w-full pl-5 pr-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) onSubmit(v) }
              if (e.key === 'Escape') onCancel()
            }}
            autoFocus
          />
        </div>
        <button
          onClick={() => { const v = parseFloat(partialPayValue); if (!isNaN(v) && v > 0) onSubmit(v) }}
          disabled={!partialPayValue || parseFloat(partialPayValue) <= 0}
          className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold disabled:opacity-30"
        >OK</button>
        <button onClick={onCancel} className="px-2 py-1 bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded text-xs">x</button>
      </div>
    )
  }

  // ── Edit amount helper ─────────────────────────────────────────────────────

  function EditAmountInput({ itemKey, currentAmount, onSubmit, onCancel }: { itemKey: string; currentAmount: number; onSubmit: (v: number) => void; onCancel: () => void }) {
    if (editAmountKey !== itemKey) return null
    return (
      <div className="flex items-center gap-1 mt-1">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-xs">€</span>
          <input
            type="number" step="0.01" min="0.01"
            value={editAmountValue}
            onChange={e => setEditAmountValue(e.target.value)}
            placeholder={currentAmount.toFixed(2)}
            className="w-full pl-5 pr-2 py-1 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-dr7-gold/50"
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseFloat(editAmountValue); if (!isNaN(v) && v > 0) onSubmit(v) }
              if (e.key === 'Escape') onCancel()
            }}
            autoFocus
          />
        </div>
        <button
          onClick={() => { const v = parseFloat(editAmountValue); if (!isNaN(v) && v > 0) onSubmit(v) }}
          disabled={!editAmountValue || parseFloat(editAmountValue) <= 0}
          className="px-2 py-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white rounded text-xs font-semibold disabled:opacity-30"
        >OK</button>
        <button onClick={onCancel} className="px-2 py-1 bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded text-xs">x</button>
      </div>
    )
  }

  // ── Confirm delete helper ──────────────────────────────────────────────────

  function ConfirmDelete({ itemKey, onConfirm, onCancel }: { itemKey: string; onConfirm: () => void; onCancel: () => void }) {
    if (confirmDeleteKey !== itemKey) return null
    return (
      <div className="flex items-center gap-1 mt-1 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
        <span className="text-xs text-red-400">Confermi?</span>
        <button onClick={onConfirm} className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold">Si</button>
        <button onClick={onCancel} className="px-2 py-0.5 bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover rounded text-xs">No</button>
      </div>
    )
  }

  // ── Render: Noleggio cell content ──────────────────────────────────────────

  function NoleggioCell({ group }: { group: CustomerGroup }) {
    if (group.noleggioBookings.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    return (
      <div className="space-y-3">
        {group.noleggioBookings.map(booking => {
          const vehicle = booking.vehicle_name || booking.booking_details?.vehicle?.name || booking.booking_details?.vehicle_name || '-'
          const plate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || booking.booking_details?.vehicle_plate || ''
          const pickupDate = booking.pickup_date || booking.booking_details?.pickup_date
          const dropoffDate = booking.dropoff_date || booking.booking_details?.dropoff_date
          // 2026-05-28: 'partial' incluso — senza questo, dopo aver registrato
          // un pagamento parziale la riga restava visibile (residuo mostrato)
          // ma TUTTI i bottoni (Pagato / Invia Link / Link Parziale / Parziale)
          // sparivano insieme al badge "In attesa di pagamento", impedendo
          // all'admin di incassare il resto.
          // 2026-05-28 bis: allineato al filtro lista (vedi righe ~440-486):
          // qualsiasi status non-paid mantiene visibili i bottoni. Senza questo,
          // bookings con payment_status = 'nexi_pay_by_link' / null / '' (es.
          // dopo "Invia Link" o righe legacy/test) restavano nella lista senza
          // alcun bottone, lasciando l'admin senza modo di incassare.
          const isPaidStatus = (s: string | null | undefined) => s === 'paid' || s === 'completed' || s === 'succeeded'
          const isPending = !isPaidStatus(booking.payment_status)
          const pendingExts = getPendingExtensions(booking)
          const bkKey = `noleggio:${booking.id}`
          const editKey = `edit:noleggio:${booking.id}`
          const totalCents = booking.price_total || 0
          const paidCents = booking.booking_details?.amountPaid || 0
          const remainingCents = Math.max(0, totalCents - paidCents)

          return (
            <div key={booking.id} className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5">
              <div className="text-sm font-semibold text-theme-text-primary">{vehicle}</div>
              {plate && <div className="text-xs text-theme-text-muted font-mono">{plate}</div>}
              <div className="text-xs text-theme-text-muted">
                {pickupDate && new Date(pickupDate).toLocaleDateString('it-IT')} - {dropoffDate && new Date(dropoffDate).toLocaleDateString('it-IT')}
              </div>
              <div className="text-red-400 font-bold text-sm mt-1">
                €{(remainingCents / 100).toFixed(2)}
                {paidCents > 0 && (
                  <span className="text-xs text-theme-text-muted font-normal ml-1">
                    su €{(totalCents / 100).toFixed(2)}
                  </span>
                )}
              </div>

              {/* "In attesa di pagamento" badge — shown on the main booking
                  whenever a Nexi Pay by Link has been created and not yet paid.
                  Mirrors the badge the extensions row already had. */}
              {isPending && (booking.booking_details?.nexi_payment_link || booking.payment_method === 'Nexi Pay by Link') && (() => {
                const expiresAt = booking.booking_details?.payment_link_expires_at
                const isExpired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false
                return (
                  <div className={`text-[10px] inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border ${isExpired ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-orange-500/15 text-orange-300 border-orange-500/30'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isExpired ? 'bg-red-400' : 'bg-orange-400 animate-pulse'}`} />
                    {isExpired ? 'Link pagamento scaduto' : 'In attesa di pagamento (Nexi Pay by Link inviato)'}
                  </div>
                )
              })()}

              {/* Pending extensions */}
              {pendingExts.length > 0 && (
                <div className="mt-1.5 space-y-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {pendingExts.map(({ ext, idx: extIdx }: any) => {
                    let days = ext.additional_days
                    if (!days && ext.previous_dropoff && ext.new_dropoff) {
                      const prev = new Date(ext.previous_dropoff)
                      const next = new Date(ext.new_dropoff)
                      days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
                    }
                    const extTotal = ext.additional_amount || 0
                    const extPaid = ext.amount_paid || 0
                    const extRemaining = extTotal - extPaid
                    const extPartialKey = `ext:${booking.id}:${extIdx}`
                    return (
                      <div key={extIdx} className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1.5">
                        <div className="text-xs text-purple-400 font-medium">
                          Estensione +{days || '?'}gg
                        </div>
                        <div className="text-purple-400 font-bold text-sm">
                          €{extRemaining.toFixed(2)}
                          {extPaid > 0 && (
                            <span className="text-xs text-theme-text-muted font-normal ml-1">
                              su €{extTotal.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {ext.payment_status === 'partial' && (
                          <div className="text-[10px] text-blue-400">
                            €{extPaid.toFixed(2)} pagati
                          </div>
                        )}
                        <div className="flex gap-1 flex-wrap mt-1 pt-1 border-t border-purple-500/10">
                          <button
                            onClick={() => askPaymentMethod(
                              `Estensione Pagata — €${extRemaining.toFixed(2)} · ${booking.customer_name || 'Cliente'}`,
                              (method) => markSingleExtensionPaid(booking, extIdx, method)
                            )}
                            className="px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                          >Pagato</button>
                          <button
                            onClick={() => sendPayByLink(booking, extRemaining, `Estensione ${booking.vehicle_name || ''}`)}
                            className="px-2 py-0.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                          >Invia Link</button>
                          {/* 2026-05-28: Link Parziale per estensioni — paritetico
                              alla riga booking. sendPayByLink usa paymentPurpose
                              'booking_topup' quindi la callback accumula correttamente. */}
                          {partialLinkKey !== extPartialKey && (
                            <button
                              onClick={() => { setPartialLinkKey(extPartialKey); setPartialLinkValue('') }}
                              className="px-2 py-0.5 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                            >Link Parziale</button>
                          )}
                          {partialLinkKey === extPartialKey && (
                            <div className="flex items-center gap-1 w-full mt-1">
                              <input type="number" step="0.01" min="1" max={extRemaining}
                                value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                                placeholder={`Max €${extRemaining.toFixed(2)}`}
                                className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                                autoFocus
                              />
                              <button onClick={() => {
                                const amt = parseFloat(partialLinkValue)
                                if (!amt || amt <= 0) return
                                sendPayByLink(booking, Math.min(amt, extRemaining), `Estensione ${booking.vehicle_name || ''} (parziale)`)
                                setPartialLinkKey(null)
                              }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                              <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                            </div>
                          )}
                          {partialPayItemKey !== extPartialKey && (
                            <button
                              onClick={() => { setPartialPayItemKey(extPartialKey); setPartialPayValue('') }}
                              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                            >Parziale</button>
                          )}
                          {confirmDeleteKey !== extPartialKey ? (
                            <button
                              onClick={() => setConfirmDeleteKey(extPartialKey)}
                              className="px-2 py-0.5 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                            >x</button>
                          ) : (
                            <div className="flex gap-1 items-center">
                              <button
                                onClick={() => deleteSingleExtension(booking, extIdx)}
                                className="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-semibold"
                              >Conferma</button>
                              <button
                                onClick={() => setConfirmDeleteKey(null)}
                                className="px-2 py-0.5 bg-gray-600 text-white rounded text-xs font-semibold"
                              >Annulla</button>
                            </div>
                          )}
                        </div>
                        <PartialPayInput
                          itemKey={extPartialKey}
                          onSubmit={(v) => handleExtensionPartialPayment(booking, extIdx, v)}
                          onCancel={() => setPartialPayItemKey(null)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Segna Tutto Pagato — booking + extensions in one fattura */}
              {((isPending ? 1 : 0) + pendingExts.length) >= 2 && (
                <button
                  onClick={() => markBookingAndExtensionsPaid(booking)}
                  className="w-full mt-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors"
                >Segna Tutto Pagato (fattura unica)</button>
              )}

              {/* Action buttons */}
              <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-blue-500/10">
                {isPending && (
                  <button
                    onClick={() => askPaymentMethod(
                      `Pagato — €${(remainingCents / 100).toFixed(2)} · ${booking.customer_name || 'Cliente'}`,
                      (method) => updatePaymentStatus(booking.id, 'paid', method, remainingCents / 100)
                    )}
                    className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                  >Pagato</button>
                )}
                {isPending && (
                  <button
                    onClick={() => sendPayByLink(booking, remainingCents / 100, `Noleggio ${booking.vehicle_name || ''}`)}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                  >Invia Link</button>
                )}
                {isPending && partialLinkKey !== bkKey && (
                  <button
                    onClick={() => { setPartialLinkKey(bkKey); setPartialLinkValue('') }}
                    className="px-2 py-1 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                  >Link Parziale</button>
                )}
                {partialLinkKey === bkKey && (
                  <div className="flex items-center gap-1 w-full mt-1">
                    <input type="number" step="0.01" min="1" max={remainingCents / 100}
                      value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                      placeholder={`Max €${(remainingCents / 100).toFixed(2)}`}
                      className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                      autoFocus
                    />
                    <button onClick={() => {
                      const amt = parseFloat(partialLinkValue)
                      if (!amt || amt <= 0) return
                      sendPayByLink(booking, Math.min(amt, remainingCents / 100), `Noleggio ${booking.vehicle_name || ''} (parziale)`)
                      setPartialLinkKey(null)
                    }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                    <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                  </div>
                )}
                {isPending && partialPayItemKey !== bkKey && (
                  <button
                    onClick={() => { setPartialPayItemKey(bkKey); setPartialPayValue('') }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                  >Parziale</button>
                )}
                {editAmountKey !== editKey && (
                  <button
                    onClick={() => { setEditAmountKey(editKey); setEditAmountValue((totalCents / 100).toFixed(2)) }}
                    className="px-2 py-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white rounded text-xs font-semibold"
                  >Modifica</button>
                )}
                {confirmDeleteKey !== bkKey && (
                  <button
                    onClick={() => setConfirmDeleteKey(bkKey)}
                    className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >x</button>
                )}
              </div>
              <PartialPayInput
                itemKey={bkKey}
                onSubmit={(v) => { handleBookingPartialPayment(booking.id, v) }}
                onCancel={() => setPartialPayItemKey(null)}
              />
              <EditAmountInput
                itemKey={editKey}
                currentAmount={totalCents / 100}
                onSubmit={(v) => updateBookingAmount(booking.id, v)}
                onCancel={() => setEditAmountKey(null)}
              />
              <ConfirmDelete
                itemKey={bkKey}
                onConfirm={() => deleteSingleBooking(booking.id)}
                onCancel={() => setConfirmDeleteKey(null)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render: Prime Wash cell content ────────────────────────────────────────

  function PrimeWashCell({ group }: { group: CustomerGroup }) {
    if (group.primeWashBookings.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    return (
      <div className="space-y-3">
        {group.primeWashBookings.map(booking => {
          const serviceName = booking.service_name || '-'
          const bkKey = `pw:${booking.id}`
          const editKey = `edit:pw:${booking.id}`
          const totalCents = booking.price_total || 0
          const paidCents = booking.booking_details?.amountPaid || 0
          const remainingCents = Math.max(0, totalCents - paidCents)

          return (
            <div key={booking.id} className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-2.5">
              <div className="text-sm font-semibold text-theme-text-primary uppercase">{serviceName}</div>
              <div className="text-xs text-theme-text-muted">
                {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT')} {booking.appointment_time || ''}
              </div>
              <div className="text-red-400 font-bold text-sm mt-1">
                €{(remainingCents / 100).toFixed(2)}
                {paidCents > 0 && (
                  <span className="text-xs text-theme-text-muted font-normal ml-1">
                    su €{(totalCents / 100).toFixed(2)}
                  </span>
                )}
              </div>

              <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-cyan-500/10">
                <button
                  onClick={() => askPaymentMethod(
                    `Pagato — €${(remainingCents / 100).toFixed(2)} · ${booking.customer_name || 'Cliente'}`,
                    (method) => updatePaymentStatus(booking.id, 'paid', method)
                  )}
                  className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                >Pagato</button>
                <button
                  onClick={() => sendPayByLink(booking, remainingCents / 100, `Prime Wash ${serviceName}`)}
                  className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                >Invia Link</button>
                {partialLinkKey !== bkKey && (
                  <button
                    onClick={() => { setPartialLinkKey(bkKey); setPartialLinkValue('') }}
                    className="px-2 py-1 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                  >Link Parziale</button>
                )}
                {partialLinkKey === bkKey && (
                  <div className="flex items-center gap-1 w-full mt-1">
                    <input type="number" step="0.01" min="1" max={remainingCents / 100}
                      value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                      placeholder={`Max €${(remainingCents / 100).toFixed(2)}`}
                      className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                      autoFocus
                    />
                    <button onClick={() => {
                      const amt = parseFloat(partialLinkValue)
                      if (!amt || amt <= 0) return
                      sendPayByLink(booking, Math.min(amt, remainingCents / 100), `Prime Wash ${serviceName} (parziale)`)
                      setPartialLinkKey(null)
                    }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                    <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                  </div>
                )}
                {partialPayItemKey !== bkKey && (
                  <button
                    onClick={() => { setPartialPayItemKey(bkKey); setPartialPayValue('') }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                  >Parziale</button>
                )}
                {editAmountKey !== editKey && (
                  <button
                    onClick={() => { setEditAmountKey(editKey); setEditAmountValue((totalCents / 100).toFixed(2)) }}
                    className="px-2 py-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white rounded text-xs font-semibold"
                  >Modifica</button>
                )}
                {confirmDeleteKey !== bkKey && (
                  <button
                    onClick={() => setConfirmDeleteKey(bkKey)}
                    className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >x</button>
                )}
              </div>
              <PartialPayInput
                itemKey={bkKey}
                onSubmit={(v) => { handleBookingPartialPayment(booking.id, v) }}
                onCancel={() => setPartialPayItemKey(null)}
              />
              <EditAmountInput
                itemKey={editKey}
                currentAmount={totalCents / 100}
                onSubmit={(v) => updateBookingAmount(booking.id, v)}
                onCancel={() => setEditAmountKey(null)}
              />
              <ConfirmDelete
                itemKey={bkKey}
                onConfirm={() => deleteSingleBooking(booking.id)}
                onCancel={() => setConfirmDeleteKey(null)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render: Penali/Danni cell content (shared) ─────────────────────────────

  function PendingItemsCell({ items, type, onMarkAllPaid, onAddebito, onAddebitoItem, chargedViaMit }: { items: PendingItem[]; type: 'penalties' | 'danni'; onMarkAllPaid?: () => void; onAddebito?: () => void; onAddebitoItem?: (amountCents: number, label: string) => void; chargedViaMit?: number }) {
    if (items.length === 0) return <span className="text-theme-text-muted text-sm italic">-</span>

    const colorClasses = type === 'penalties'
      ? { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400', divider: 'border-yellow-500/10' }
      : { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', divider: 'border-red-500/10' }

    return (
      <div className="space-y-2">
        {items.length >= 2 && onMarkAllPaid && (
          <button
            onClick={onMarkAllPaid}
            disabled={!!processingKey}
            className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >{processingKey ? 'Elaborazione...' : `Segna Tutti Pagato (${items.length})`}</button>
        )}
        {onAddebito && (
          <button
            onClick={onAddebito}
            className="w-full px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >Addebito</button>
        )}
        {chargedViaMit != null && chargedViaMit > 0 && (() => {
          const totalItemsCents = Math.round(items.reduce((s, i) => s + i.remaining, 0) * 100)
          return (
            <div className="text-xs text-orange-400 bg-orange-900/20 border border-orange-700/30 rounded-lg px-3 py-1.5 font-medium">
              Da incassare: €{(totalItemsCents / 100).toFixed(2)}
            </div>
          )
        })()}
        {items.map((item, idx) => {
          const itemKey = `${type}:${item.bookingId}:${item.source}:${item.originalIndex}`
          const partialKey = `partial:${itemKey}`
          const editKey = `edit:${itemKey}`

          return (
            <div key={idx} className={`${colorClasses.bg} border ${colorClasses.border} rounded-lg p-2.5`}>
              <div className="text-xs text-theme-text-primary font-medium">{item.label}</div>
              <div className={`font-bold text-sm ${colorClasses.text}`}>
                €{item.remaining.toFixed(2)}
                {item.paymentStatus === 'partial' && item.amount > item.remaining && (
                  <span className="ml-1.5 text-[11px] font-normal text-theme-text-muted line-through">€{item.amount.toFixed(2)}</span>
                )}
              </div>
              {item.paymentStatus === 'partial' && (
                <div className="text-[10px] inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/40 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  Parziale — €{item.amountPaid.toFixed(2)} pagato · €{item.remaining.toFixed(2)} da incassare
                </div>
              )}
              {item.paymentStatus === 'nexi_pay_by_link' && (
                <div className="text-[10px] inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                  In attesa di pagamento (Nexi Pay by Link inviato)
                </div>
              )}

              <div className={`flex gap-1 flex-wrap mt-2 pt-2 border-t ${colorClasses.divider}`}>
                {item.source === 'booking_details' ? (
                  <>
                    <button
                      onClick={() => markAllTypePaid(item.booking, type)}
                      disabled={!!processingKey}
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold disabled:opacity-50"
                    >Pagato</button>
                    <button
                      onClick={() => sendPayByLink(item.booking, item.remaining, `${type === 'penalties' ? 'Penale' : 'Danno'} — ${item.label}`)}
                      className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold"
                    >Invia Link</button>
                    {partialLinkKey !== itemKey && partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialLinkKey(itemKey); setPartialLinkValue('') }}
                        className="px-2 py-1 bg-purple-400 hover:bg-purple-500 text-white rounded text-xs font-semibold"
                      >Link Parziale</button>
                    )}
                    {partialLinkKey === itemKey && (
                      <div className="flex items-center gap-1 w-full mt-1">
                        <input type="number" step="0.01" min="1" max={item.remaining}
                          value={partialLinkValue} onChange={e => setPartialLinkValue(e.target.value)}
                          placeholder={`Max €${item.remaining.toFixed(2)}`}
                          className="flex-1 px-2 py-1 bg-theme-bg-tertiary border border-purple-500/50 rounded text-xs text-theme-text-primary"
                          autoFocus
                        />
                        <button onClick={() => {
                          const amt = parseFloat(partialLinkValue)
                          if (!amt || amt <= 0) return
                          sendPayByLink(item.booking, Math.min(amt, item.remaining), `${type === 'penalties' ? 'Penale' : 'Danno'} — ${item.label} (parziale)`)
                          setPartialLinkKey(null)
                        }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-semibold">Invia</button>
                        <button onClick={() => setPartialLinkKey(null)} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">X</button>
                      </div>
                    )}
                    {partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialPayItemKey(partialKey); setPartialPayValue('') }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                      >Parziale</button>
                    )}
                    {onAddebitoItem && (
                      <button
                        onClick={() => onAddebitoItem(Math.round(item.remaining * 100), item.label)}
                        className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold"
                      >Addebito</button>
                    )}
                    {editAmountKey !== editKey && (
                      <button
                        onClick={() => { setEditAmountKey(editKey); setEditAmountValue(item.amount.toFixed(2)) }}
                        className="px-2 py-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white rounded text-xs font-semibold"
                      >Modifica</button>
                    )}
                    <button
                      onClick={() => removeSinglePenaltyDanno(item.booking, type, item.originalIndex)}
                      className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                    >x</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                        if (fi) markSingleFatturaItemPaid(fi)
                      }}
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold"
                    >Pagato</button>
                    {partialPayItemKey !== partialKey && (
                      <button
                        onClick={() => { setPartialPayItemKey(partialKey); setPartialPayValue('') }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                      >Parziale</button>
                    )}
                    {onAddebitoItem && (
                      <button
                        onClick={() => onAddebitoItem(Math.round(item.remaining * 100), item.label)}
                        className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold"
                      >Addebito</button>
                    )}
                    {editAmountKey !== editKey && (
                      <button
                        onClick={() => { setEditAmountKey(editKey); setEditAmountValue(item.amount.toFixed(2)) }}
                        className="px-2 py-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white rounded text-xs font-semibold"
                      >Modifica</button>
                    )}
                    <button
                      onClick={() => {
                        const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                        if (fi) deleteFatturaItem(fi)
                      }}
                      className="px-2 py-1 bg-red-600/80 hover:bg-red-700 text-white rounded text-xs font-semibold"
                    >x</button>
                  </>
                )}
              </div>

              <PartialPayInput
                itemKey={partialKey}
                onSubmit={(v) => {
                  if (item.source === 'booking_details') {
                    handleTypePartialPayment(item.booking, type, v)
                  } else {
                    const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                    if (fi) handleFatturaItemPayment(fi, v)
                  }
                  setPartialPayItemKey(null)
                }}
                onCancel={() => setPartialPayItemKey(null)}
              />
              {item.source === 'booking_details' ? (
                <EditAmountInput
                  itemKey={editKey}
                  currentAmount={item.amount}
                  onSubmit={(v) => updateSinglePenaltyDannoAmount(item.booking, type, item.originalIndex, v)}
                  onCancel={() => setEditAmountKey(null)}
                />
              ) : (
                <EditAmountInput
                  itemKey={editKey}
                  currentAmount={item.amount}
                  onSubmit={(v) => {
                    const fi = (fatturaItemsMap[item.bookingId] || []).find(f => f.fatturaId === item.fatturaId && f.itemIndex === item.itemIndex)
                    if (fi) updateFatturaItemAmount(fi, v)
                  }}
                  onCancel={() => setEditAmountKey(null)}
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento prenotazioni da saldare...</p>
      </div>
    )
  }

  // ── Main Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-dr7-gold/5 rounded-full blur-3xl pointer-events-none"/>
        <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-red-500/5 rounded-full blur-3xl pointer-events-none"/>
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-dr7-gold/10 border border-dr7-gold/30 grid place-items-center flex-shrink-0">
              <svg className="w-5 h-5 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h18M7 14h.01M11 14h.01M5 6h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">In attesa di pagamento</h2>
                {/* AI badge — heuristic-only for now (rules in performanceStats),
                    but the visual cue tells the operator this section uses
                    intelligenza assistita for sollecit + priorita\'. */}
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                  AI
                </span>
              </div>
              <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">
                Gestisci incassi, solleciti e recupera clienti in modo intelligente
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-theme-bg-tertiary border border-theme-border text-[11px] text-theme-text-muted">
              {customerGroups.length} {customerGroups.length === 1 ? 'cliente' : 'clienti'} in lista
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 hover:bg-cyan-600 transition-colors"
              title="Registra un nuovo incasso manuale (placeholder, da wirare)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Nuovo Incasso
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-theme-bg-tertiary border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
              title="Esporta lista insolventi (placeholder, da wirare)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              Esporta
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards + AI Insights — su lg sta tutto in una riga: 5 KPI a
          sinistra (col 1-5 di 7) + pannello AI Insights a destra (col 6-7).
          Sotto lg le card si impilano (KPI in 2 col, Insights full width). */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 lg:gap-4">
        <div className="col-span-2 lg:col-span-5 grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
        {/* 1. Totale da incassare */}
        <div className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-red-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-red-300/80 uppercase tracking-wider font-semibold">Totale da incassare</div>
              <div className="w-7 h-7 rounded-lg bg-red-500/15 border border-red-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-red-400 mt-2.5 tabular-nums">
              €{(totalUnpaid / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">
              {customerGroups.length} {customerGroups.length === 1 ? 'cliente' : 'clienti'} in lista
            </div>
          </div>
        </div>

        {/* 2. Clienti debitori */}
        <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-purple-300/80 uppercase tracking-wider font-semibold">Clienti debitori</div>
              <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-purple-400 mt-2.5 tabular-nums">{allGroups.total}</div>
            <div className="text-[11px] text-theme-text-muted mt-1">
              {allGroups.rental} noleggio &middot; {allGroups.pw} prime wash
            </div>
          </div>
        </div>

        {/* 3. Scaduto (> 14 giorni) */}
        <div className="relative overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/10 via-orange-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-orange-300/80 uppercase tracking-wider font-semibold">Scaduto</div>
              <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-orange-400 mt-2.5 tabular-nums">
              €{(performanceStats.scadutoCents / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">oltre 14 giorni</div>
          </div>
        </div>

        {/* 4. Probabilità incasso */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider font-semibold">Probabilità Incasso</div>
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-emerald-400 mt-2.5 tabular-nums">
              {performanceStats.probabilitaIncasso}%
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">
              {performanceStats.clientsWithMit} con carta on file
            </div>
          </div>
        </div>

        {/* 5. Incassi questo mese */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-blue-300/80 uppercase tracking-wider font-semibold">Incassi Questo Mese</div>
              <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-blue-400 mt-2.5 tabular-nums">
              €{(performanceStats.incassiMese / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">recuperati via addebito</div>
          </div>
        </div>
        </div>{/* end 5-KPI inner grid */}

        {/* AI Insights — pannello a destra (col 6-7 su lg). Regole euristiche
            sui dati gia\' disponibili in performanceStats e customerGroups,
            niente LLM. Click su un insight scrolla / filtra la lista (TBD). */}
        <div className="col-span-2 relative overflow-hidden rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-transparent p-4">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 grid place-items-center">
                  <svg className="w-3.5 h-3.5 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="text-sm font-bold text-theme-text-primary">AI Insights</div>
              </div>
              <button type="button" className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold">Vedi tutti</button>
            </div>

            {/* Computed insights — pure rules on existing data */}
            {(() => {
              const noCardCount = customerGroups.filter(g => g.chargedViaMit === 0 && g.totalRemaining > 0).length
              // count groups with oldest item > 14 days (re-use the scaduto calc semantics)
              let overdueCount = 0
              for (const g of customerGroups) {
                const dates = [
                  ...g.noleggioBookings.map(b => b.created_at),
                  ...g.primeWashBookings.map(b => b.created_at),
                  ...g.penaliItems.map(p => p.booking.created_at),
                  ...g.danniItems.map(p => p.booking.created_at),
                ].filter(Boolean) as string[]
                if (dates.length === 0) continue
                const oldest = dates.reduce((a, b) => a < b ? a : b)
                const d = daysSince(oldest)
                if (d != null && d >= 14) overdueCount++
              }
              const insights: { n: string; title: string; sub: string; tone: 'red' | 'amber' | 'cyan' }[] = []
              if (noCardCount > 0) insights.push({
                n: String(noCardCount),
                title: noCardCount === 1 ? 'cliente con probabilità bassa di incasso' : 'clienti con probabilità bassa di incasso',
                sub: 'Nessuna carta tokenizzata — richiedi addebito MIT',
                tone: 'red',
              })
              if (overdueCount > 0) insights.push({
                n: String(overdueCount),
                title: overdueCount === 1 ? 'cliente oltre 14 giorni' : 'clienti oltre 14 giorni',
                sub: `€${(performanceStats.scadutoCents / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} scaduti`,
                tone: 'amber',
              })
              if (performanceStats.probabilitaIncasso < 60) insights.push({
                n: `${performanceStats.probabilitaIncasso}%`,
                title: 'probabilità incasso sotto soglia',
                sub: `Solo ${performanceStats.clientsWithMit}/${customerGroups.length} hanno carta on file`,
                tone: 'cyan',
              })
              if (insights.length === 0) insights.push({
                n: '✓',
                title: 'Tutto sotto controllo',
                sub: 'Nessun cliente in ritardo o senza copertura',
                tone: 'cyan',
              })
              const tones = {
                red: 'bg-red-500/15 text-red-400 border-red-500/30',
                amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
              }
              return (
                <div className="space-y-2">
                  {insights.map((ins, i) => (
                    <div key={i} className="flex items-start gap-2.5 bg-theme-bg-primary/40 border border-theme-border/50 rounded-xl px-3 py-2">
                      <div className={`shrink-0 w-7 h-7 rounded-lg ${tones[ins.tone]} border grid place-items-center font-bold text-xs tabular-nums`}>{ins.n}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-theme-text-primary font-semibold truncate">{ins.title}</div>
                        <div className="text-[11px] text-theme-text-muted truncate">{ins.sub}</div>
                      </div>
                      <svg className="w-4 h-4 text-theme-text-muted shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Filters + Search — search a sinistra, 5 filter pills a destra
          come da mockup. I primi 4 sono select-like (drop-down), il 5o
          apre filtri avanzati. Servizio selezionato influenza la lista. */}
      <div className="bg-theme-bg-secondary rounded-2xl p-3 lg:p-4 border border-theme-border">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 lg:gap-3">
          {/* Search */}
          <div className="relative flex-1 lg:max-w-md">
            {/* 2026-06-01: filtro periodo Da/A (sopra la search bar) */}
            <div className="mb-2">
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </div>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cerca cliente, email, telefono, targa..."
              className="pl-9 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 w-full transition-all"
            />
          </div>

          {/* Filter pills */}
          <div className="flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
            {/* Categoria (servizio) — funzionale */}
            <select
              value={filterService}
              onChange={e => setFilterService(e.target.value as typeof filterService)}
              className="appearance-none px-3 pr-7 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover transition-colors cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '0.75rem' }}
            >
              <option value="all">Tutte le categorie ({allGroups.total})</option>
              <option value="rental">Noleggio ({allGroups.rental})</option>
              <option value="prime_wash">Prime Wash ({allGroups.pw})</option>
            </select>

            {/* Stato — placeholder (TBD wiring) */}
            <select
              defaultValue=""
              className="appearance-none px-3 pr-7 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover transition-colors cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '0.75rem' }}
              title="Filtro stato (in arrivo)"
            >
              <option value="">Tutti gli stati</option>
              <option value="aperto">Aperto</option>
              <option value="parziale">Parzialmente pagato</option>
              <option value="sollecitato">Sollecitato</option>
            </select>

            {/* Priorità — placeholder */}
            <select
              defaultValue=""
              className="appearance-none px-3 pr-7 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover transition-colors cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '0.75rem' }}
              title="Filtro priorità (in arrivo)"
            >
              <option value="">Tutte le priorità</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="bassa">Bassa</option>
            </select>

            {/* Data — placeholder */}
            <select
              defaultValue=""
              className="appearance-none px-3 pr-7 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover transition-colors cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '0.75rem' }}
              title="Filtro data (in arrivo)"
            >
              <option value="">Tutte le date</option>
              <option value="7d">Ultimi 7 giorni</option>
              <option value="30d">Ultimi 30 giorni</option>
              <option value="90d">Ultimi 90 giorni</option>
              <option value="overdue">Solo scaduti</option>
            </select>

            {/* Filtri avanzati — placeholder button */}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
              title="Filtri avanzati (in arrivo)"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
              </svg>
              Filtri avanzati
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile Card View ─────────────────────────────────────────────── */}
      <div className="lg:hidden space-y-3">
        {/* Mobile sort bar */}
        <div className="flex gap-2">
          <button
            onClick={() => handleSort('name')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortBy === 'name' ? 'bg-dr7-gold text-theme-bg-primary' : 'bg-theme-bg-tertiary text-theme-text-muted'}`}
          >Nome {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</button>
          <button
            onClick={() => handleSort('amount')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortBy === 'amount' ? 'bg-dr7-gold text-theme-bg-primary' : 'bg-theme-bg-tertiary text-theme-text-muted'}`}
          >Importo {sortBy === 'amount' && (sortDir === 'asc' ? '↑' : '↓')}</button>
        </div>
        {customerGroups.map(group => {
          const isExpanded = expandedCustomers.has(group.customerKey)
          const hasNoleggio = group.noleggioBookings.length > 0
          const hasPW = group.primeWashBookings.length > 0
          const hasPenali = group.penaliItems.length > 0
          const hasDanni = group.danniItems.length > 0

          return (
            <div key={group.customerKey} className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
              {/* Accordion Header */}
              <button
                onClick={() => toggleExpanded(group.customerKey)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-theme-text-primary truncate flex items-center gap-1.5">
                    <span className="truncate">{group.customerName}</span>
                    <ClientStatusBadge email={group.customerEmail} />
                  </div>
                  <div className="flex gap-2 mt-0.5">
                    {hasNoleggio && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">Noleggio</span>}
                    {hasPW && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300">Prime Wash</span>}
                    {hasPenali && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-300">Penali</span>}
                    {hasDanni && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">Danni</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <span className="text-red-400 font-bold">€{(group.totalRemaining / 100).toFixed(2)}</span>
                    {group.chargedViaMit > 0 && (
                      <div className="text-[10px] text-green-400">Incassato: €{(group.chargedViaMit / 100).toFixed(2)}</div>
                    )}
                  </div>
                  <svg className={`w-5 h-5 text-theme-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Accordion Body */}
              {isExpanded && (
                <div className="border-t border-theme-border p-3 space-y-4">
                  {/* Contact info */}
                  <div className="text-xs text-theme-text-muted space-y-0.5">
                    {group.customerEmail && <div>{group.customerEmail}</div>}
                    {group.customerPhone && <div>{group.customerPhone}</div>}
                  </div>

                  {/* Salda Tutto button */}
                  {(group.noleggioBookings.length + group.primeWashBookings.length + group.penaliItems.length + group.danniItems.length) >= 2 ? (
                    <button
                      onClick={() => askPaymentMethod(
                        `Salda Tutto — €${(group.totalRemaining / 100).toFixed(2)} per ${group.customerName}`,
                        (method) => markAllCustomerPaid(group, method)
                      )}
                      disabled={!!processingKey}
                      className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >{processingKey ? 'Elaborazione...' : 'Salda Tutto — Fattura Unica'}</button>
                  ) : (
                    /* Single booking: Segna Pagato (car rental triggers fattura + contract + signing link) */
                    group.noleggioBookings[0] && (
                      <button
                        onClick={() => askPaymentMethod(
                          `Segna Pagato — €${(group.totalRemaining / 100).toFixed(2)} per ${group.customerName}`,
                          (method) => updatePaymentStatus(group.noleggioBookings[0].id, 'paid', method, group.totalRemaining / 100)
                        )}
                        className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >Segna Pagato</button>
                    )
                  )}

                  {/* Pay by Link Tutto */}
                  <button
                    onClick={() => {
                      const totalEur = group.totalRemaining / 100
                      if (totalEur <= 0) return
                      const firstBooking = group.noleggioBookings[0] || group.primeWashBookings[0] || group.penaliItems[0]?.booking || group.danniItems[0]?.booking
                      if (!firstBooking) return
                      sendPayByLink(firstBooking, totalEur, `Saldo completo — ${group.customerName}`)
                    }}
                    className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold transition-colors"
                  >Pay by Link Tutto — €{(group.totalRemaining / 100).toFixed(2)}</button>

                  {/* Addebito button */}
                  <button
                    onClick={() => openAddebitoNexi(group)}
                    className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition-colors"
                  >Addebito (auto-retry -10%)</button>

                  {/* Invia Sollecito — promemoria pagamento WhatsApp (auto-resend 48h, max 3) */}
                  {(() => {
                    const sending = sollecitoSendingKey === group.customerKey
                    const lastSentAt = [...group.noleggioBookings, ...group.primeWashBookings]
                      .map(b => b.booking_details?.sollecito?.last_sent_at)
                      .filter(Boolean)
                      .sort()
                      .pop() as string | undefined
                    const hoursAgo = lastSentAt
                      ? Math.floor((Date.now() - new Date(lastSentAt).getTime()) / 3600000)
                      : null
                    return (
                      <>
                        <button
                          onClick={() => handleSendSollecito(group)}
                          disabled={sending}
                          className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >{sending ? 'Invio...' : 'Invia Sollecito'}</button>
                        {hoursAgo != null && (
                          <p className="text-xs text-theme-text-muted text-center -mt-1">
                            Sollecito inviato {hoursAgo <= 0 ? 'poco fa' : `${hoursAgo}h fa`}
                          </p>
                        )}
                      </>
                    )
                  })()}

                  {/* Noleggio section */}
                  {hasNoleggio && (
                    <div>
                      <div className="text-xs font-bold text-blue-400 uppercase mb-1.5">Noleggio</div>
                      <NoleggioCell group={group} />
                    </div>
                  )}

                  {/* Prime Wash section */}
                  {hasPW && (
                    <div>
                      <div className="text-xs font-bold text-cyan-400 uppercase mb-1.5">Prime Wash</div>
                      <PrimeWashCell group={group} />
                    </div>
                  )}

                  {/* Penali section */}
                  {hasPenali && (
                    <div>
                      <div className="text-xs font-bold text-yellow-400 uppercase mb-1.5">Penali</div>
                      <PendingItemsCell items={group.penaliItems} type="penalties" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'penalties')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                    </div>
                  )}

                  {/* Danni section */}
                  {hasDanni && (
                    <div>
                      <div className="text-xs font-bold text-red-400 uppercase mb-1.5">Danni</div>
                      <PendingItemsCell items={group.danniItems} type="danni" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'danni')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {customerGroups.length === 0 && (
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
            {searchQuery ? 'Nessun cliente trovato' : 'Nessuna prenotazione da saldare!'}
          </div>
        )}
      </div>

      {/* ── Desktop layout: per-customer row list + sidebar ─────────────── */}
      <div className="hidden lg:flex gap-4 items-start">
        <div className="flex-1 min-w-0 bg-theme-bg-secondary rounded-2xl border border-theme-border overflow-hidden">
        {/* Column headers — 8 colonne come da mockup */}
        <div className="grid gap-3 px-4 py-3 text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold border-b border-theme-border items-center"
             style={{ gridTemplateColumns: 'minmax(220px,1.6fr) minmax(110px,0.9fr) minmax(160px,1.4fr) 110px 100px 110px 130px 200px' }}>
          <div className="flex items-center gap-2">
            <button onClick={() => handleSort('name')} className="flex items-center text-theme-text-primary hover:text-dr7-gold transition-colors text-[10px] uppercase">
              Cliente<SortArrow col="name" />
            </button>
          </div>
          <button onClick={() => handleSort('amount')} className="flex items-center text-red-400 hover:text-red-300 transition-colors text-[10px] uppercase">
            Totale Insoluto<SortArrow col="amount" />
          </button>
          <div>Breakdown</div>
          <div>Stato</div>
          <div>Priorità</div>
          <div>Prob. Incasso</div>
          <div>Ultima Attività</div>
          <div className="text-right">Azioni</div>
        </div>

        {/* Rows */}
        {customerGroups.map(group => {
          const allDates = [
            ...group.noleggioBookings.map(b => b.created_at),
            ...group.primeWashBookings.map(b => b.created_at),
            ...group.penaliItems.map(p => p.booking.created_at),
            ...group.danniItems.map(p => p.booking.created_at),
          ].filter(Boolean) as string[]
          const latestActivity = allDates.length ? allDates.reduce((a, b) => a > b ? a : b) : null
          const oldestActivity = allDates.length ? allDates.reduce((a, b) => a < b ? a : b) : null
          const lastActivityDays = daysSince(latestActivity)
          const oldestDays = daysSince(oldestActivity)
          const priority = priorityFromDays(oldestDays)
          const recoveredEur = group.chargedViaMit / 100
          const remainingEur = group.totalRemaining / 100
          const totalGroupEur = recoveredEur + remainingEur
          const recoveryPct = totalGroupEur > 0 ? Math.min(100, Math.round((recoveredEur / totalGroupEur) * 100)) : 0
          const initials = getInitials(group.customerName)
          const avatarColor = paletteFor(group.customerKey)
          const itemCount = group.noleggioBookings.length + group.primeWashBookings.length + group.penaliItems.length + group.danniItems.length

          // Per-category totals for the BREAKDOWN chips
          const noleggioCents = group.noleggioBookings.reduce((s, b) => s + Math.max(0, (b.price_total || 0) - (b.booking_details?.amountPaid || 0)), 0)
          const pwCents = group.primeWashBookings.reduce((s, b) => s + Math.max(0, (b.price_total || 0) - (b.booking_details?.amountPaid || 0)), 0)
          const penaliCents = group.penaliItems.reduce((s, p) => s + Math.round((p.remaining || 0) * 100), 0)
          const danniCents = group.danniItems.reduce((s, p) => s + Math.round((p.remaining || 0) * 100), 0)
          const fmtChip = (cents: number) => `€${(cents / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

          // Probability donut: % of total that has been recovered via MIT
          // (acts as "we can collect" indicator — high = card on file works)
          const probScore = recoveryPct > 0 ? recoveryPct : (group.chargedViaMit > 0 ? 60 : 30)
          const donutCircum = 2 * Math.PI * 14 // r=14
          const donutDash = (probScore / 100) * donutCircum
          const donutColor = probScore >= 70 ? 'stroke-emerald-400' : probScore >= 40 ? 'stroke-amber-400' : 'stroke-red-400'

          const isActionsOpen = openActionsRowKey === group.customerKey
          // Per-service detail (Noleggio/Prime Wash/Penali/Danni) is always
          // shown on desktop — user explicitly wanted the original data
          // visible inline, not behind a "Mostra dettaglio" click.

          return (
            <div key={group.customerKey} className="border-b border-theme-border/30 hover:bg-theme-bg-tertiary/30">
              <div className="grid gap-3 px-4 py-3 items-center"
                   style={{ gridTemplateColumns: 'minmax(220px,1.6fr) minmax(110px,0.9fr) minmax(160px,1.4fr) 110px 100px 110px 130px 200px' }}>

                {/* CLIENTE */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-10 h-10 rounded-full grid place-items-center text-xs font-bold border shrink-0 ${avatarColor}`}>{initials}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-theme-text-primary flex items-center gap-1.5">
                      <span className="truncate">{group.customerName}</span>
                      <ClientStatusBadge email={group.customerEmail} />
                    </div>
                    {group.customerEmail && <div className="text-[11px] text-theme-text-muted truncate max-w-[200px]">{group.customerEmail}</div>}
                    {group.customerPhone && <div className="text-[10px] text-theme-text-muted truncate font-mono">{group.customerPhone}</div>}
                  </div>
                </div>

                {/* TOTALE INSOLUTO */}
                <div>
                  <div className="text-red-400 font-bold text-lg tabular-nums leading-none">
                    €{remainingEur.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-theme-text-muted mt-0.5">
                    {itemCount} {itemCount === 1 ? 'voce' : 'voci'}
                  </div>
                </div>

                {/* BREAKDOWN chips */}
                <div className="flex flex-wrap gap-1">
                  {noleggioCents > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">N {fmtChip(noleggioCents)}</span>}
                  {pwCents > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">PW {fmtChip(pwCents)}</span>}
                  {penaliCents > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">P {fmtChip(penaliCents)}</span>}
                  {danniCents > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-300 border border-red-500/30">D {fmtChip(danniCents)}</span>}
                  {noleggioCents === 0 && pwCents === 0 && penaliCents === 0 && danniCents === 0 && (
                    <span className="text-[10px] text-theme-text-muted">—</span>
                  )}
                </div>

                {/* STATO */}
                <div>
                  {group.chargedViaMit > 0 && remainingEur === 0 ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Saldato</span>
                  ) : group.chargedViaMit > 0 ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">Parziale</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-500/15 text-red-400 border border-red-500/30">Aperto</span>
                  )}
                </div>

                {/* PRIORITÀ */}
                <div>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase font-bold tracking-wide ${priority.classes}`}>
                    {priority.label}
                  </span>
                  {oldestDays != null && <div className="text-[10px] text-theme-text-muted mt-0.5">{oldestDays}gg</div>}
                </div>

                {/* PROB. INCASSO donut */}
                <div className="flex items-center gap-2">
                  <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3" className="text-theme-bg-tertiary"/>
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className={donutColor} strokeLinecap="round"
                            strokeDasharray={`${donutDash} ${donutCircum}`} />
                  </svg>
                  <div className="text-xs font-bold tabular-nums text-theme-text-primary">{probScore}%</div>
                </div>

                {/* ULTIMA ATTIVITÀ */}
                <div className="text-[11px] text-theme-text-muted">
                  <div className="text-theme-text-primary">{relativeIt(lastActivityDays)}</div>
                  {oldestDays != null && oldestDays !== lastActivityDays && (
                    <div className="text-[10px]">primo: {oldestDays}gg</div>
                  )}
                </div>

                {/* AZIONI — bottone principale "Salda Tutto / Segna Pagato"
                    visibile direttamente sulla riga (uscito dal menu 3-dots
                    perche' troppo nascosto). Il menu 3-dots rimane per
                    azioni secondarie (Pay by Link, Nexi addebito, ecc.). */}
                <div className="relative flex justify-end items-center gap-1">
                  {remainingEur > 0 && (
                    <button
                      disabled={!!processingKey}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (itemCount >= 2) {
                          askPaymentMethod(`Salda Tutto — €${remainingEur.toFixed(2)} per ${group.customerName}`, (method) => markAllCustomerPaid(group, method))
                        } else if (group.noleggioBookings[0]) {
                          askPaymentMethod(`Segna Pagato — €${remainingEur.toFixed(2)} per ${group.customerName}`, (method) => updatePaymentStatus(group.noleggioBookings[0].id, 'paid', method, remainingEur))
                        } else if (group.primeWashBookings[0]) {
                          askPaymentMethod(`Segna Pagato — €${remainingEur.toFixed(2)} per ${group.customerName}`, (method) => updatePaymentStatus(group.primeWashBookings[0].id, 'paid', method, remainingEur))
                        }
                      }}
                      title={itemCount >= 2 ? 'Crea una fattura unica con TUTTE le voci di questo cliente' : 'Segna come pagato'}
                      className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold whitespace-nowrap shadow-sm transition-colors"
                    >
                      {itemCount >= 2 ? `Salda Tutto · €${remainingEur.toFixed(0)}` : `Segna Pagato`}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenActionsRowKey(isActionsOpen ? null : group.customerKey) }}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-primary/50 transition-colors"
                    title="Altre azioni"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                    </svg>
                  </button>

                  {isActionsOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setOpenActionsRowKey(null)} />
                      <div className="absolute right-0 top-9 z-50 w-56 bg-theme-bg-secondary border border-theme-border rounded-xl shadow-2xl py-1 text-sm">
                        {itemCount >= 2 ? (
                          <button
                            disabled={!!processingKey}
                            onClick={() => {
                              setOpenActionsRowKey(null)
                              askPaymentMethod(`Salda Tutto — €${remainingEur.toFixed(2)} per ${group.customerName}`, (method) => markAllCustomerPaid(group, method))
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary text-emerald-400 disabled:opacity-50"
                          >Salda Tutto (fattura unica)</button>
                        ) : group.noleggioBookings[0] && (
                          <button
                            onClick={() => {
                              setOpenActionsRowKey(null)
                              askPaymentMethod(`Segna Pagato — €${remainingEur.toFixed(2)} per ${group.customerName}`, (method) => updatePaymentStatus(group.noleggioBookings[0].id, 'paid', method, remainingEur))
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary text-emerald-400"
                          >Segna Pagato</button>
                        )}
                        <button
                          onClick={() => {
                            setOpenActionsRowKey(null)
                            if (remainingEur <= 0) return
                            const fb = group.noleggioBookings[0] || group.primeWashBookings[0] || group.penaliItems[0]?.booking || group.danniItems[0]?.booking
                            if (fb) sendPayByLink(fb, remainingEur, `Saldo completo — ${group.customerName}`)
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary text-purple-400"
                        >Pay by Link — €{remainingEur.toFixed(2)}</button>
                        <button
                          onClick={() => { setOpenActionsRowKey(null); openAddebitoNexi(group) }}
                          className="w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary text-orange-400"
                        >Addebito MIT</button>
                        <button
                          onClick={() => { setOpenActionsRowKey(null); handleSendSollecito(group) }}
                          disabled={sollecitoSendingKey === group.customerKey}
                          className="w-full text-left px-3 py-2 hover:bg-theme-bg-tertiary text-amber-400 disabled:opacity-50"
                        >{sollecitoSendingKey === group.customerKey ? 'Invio…' : 'Invia Sollecito'}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Inline detail — sempre visibile. Riusa i componenti
                  NoleggioCell/PrimeWashCell/PendingItemsCell esistenti per
                  non perdere la business logic (Pagato / Pay by Link /
                  Link Parziale / Parziale / Addebito / Modifica per ogni
                  voce). I 4 sub-header colorati replicano le vecchie
                  colonne del table. */}
              {(
                <div className="bg-theme-bg-primary/30 border-t border-theme-border/30 px-4 py-3 grid grid-cols-2 xl:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold mb-1">Noleggio</div>
                    <NoleggioCell group={group} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold mb-1">Prime Wash</div>
                    <PrimeWashCell group={group} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold mb-1">Penali</div>
                    <PendingItemsCell items={group.penaliItems} type="penalties" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'penalties')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-red-400 font-semibold mb-1">Danni</div>
                    <PendingItemsCell items={group.danniItems} type="danni" onMarkAllPaid={() => markAllCustomerItemsPaid(group, 'danni')} onAddebito={() => openAddebitoNexi(group)} onAddebitoItem={(amt, label) => openAddebitoNexi(group, amt, label)} chargedViaMit={group.chargedViaMit} />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {customerGroups.length === 0 && (
          <div className="px-4 py-12 text-center text-theme-text-muted">
            {searchQuery ? 'Nessun cliente trovato' : 'Nessuna prenotazione da saldare!'}
          </div>
        )}
        </div>

        {/* Right sidebar */}
        <aside className="w-80 flex-shrink-0 space-y-4 sticky top-4">
          {/* Top 5 Debitori */}
          <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Top 5 Debitori</h3>
              <span className="text-[10px] text-theme-text-muted">per importo</span>
            </div>
            {topDebtors.length === 0 ? (
              <div className="text-xs text-theme-text-muted py-4 text-center">Nessun debitore</div>
            ) : (
              <div className="space-y-3">
                {topDebtors.map((g) => {
                  const initials = getInitials(g.customerName)
                  const color = paletteFor(g.customerKey)
                  const recoveredEur = g.chargedViaMit / 100
                  const remainingEur = g.totalRemaining / 100
                  const totalEur = recoveredEur + remainingEur
                  const recoveryPct = totalEur > 0 ? Math.min(100, Math.round((recoveredEur / totalEur) * 100)) : 0
                  return (
                    <div key={g.customerKey}>
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border flex-shrink-0 ${color}`}>{initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-theme-text-primary font-semibold truncate">{g.customerName}</div>
                          <div className="text-[10px] text-theme-text-muted truncate">{g.customerEmail || g.customerPhone || '—'}</div>
                        </div>
                        <div className="text-xs font-bold text-red-400 tabular-nums whitespace-nowrap">€{remainingEur.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                      </div>
                      {g.chargedViaMit > 0 && (
                        <div className="mt-1 ml-10.5 pl-0">
                          <div className="flex items-center justify-between text-[9px] text-emerald-400/80 mb-0.5">
                            <span>Recuperato {recoveryPct}%</span>
                            <span className="tabular-nums">€{recoveredEur.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                          </div>
                          <div className="h-1 bg-theme-bg-tertiary rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${recoveryPct}%` }}/>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Riepilogo per categoria */}
          <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-4">
            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider mb-3">Riepilogo</h3>
            {(() => {
              const cats = [
                { label: 'Noleggio', count: allGroups.rental, color: 'bg-blue-400', textColor: 'text-blue-300', bgColor: 'bg-blue-500/10' },
                { label: 'Prime Wash', count: allGroups.pw, color: 'bg-cyan-400', textColor: 'text-cyan-300', bgColor: 'bg-cyan-500/10' },
                { label: 'Penali', count: allGroups.penali, color: 'bg-yellow-400', textColor: 'text-yellow-300', bgColor: 'bg-yellow-500/10' },
                { label: 'Danni', count: allGroups.danni, color: 'bg-red-400', textColor: 'text-red-300', bgColor: 'bg-red-500/10' },
              ]
              const max = Math.max(1, ...cats.map(c => c.count))
              return (
                <div className="space-y-2.5">
                  {cats.map(c => (
                    <div key={c.label}>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className={`font-medium ${c.textColor}`}>{c.label}</span>
                        <span className="text-theme-text-primary font-bold tabular-nums">{c.count}</span>
                      </div>
                      <div className={`h-1.5 rounded-full ${c.bgColor} overflow-hidden`}>
                        <div
                          className={`h-full ${c.color} transition-all duration-300`}
                          style={{ width: `${(c.count / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
            <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
              <span className="text-theme-text-muted">Totale clienti</span>
              <span className="text-theme-text-primary font-bold tabular-nums">{allGroups.total}</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Performance / Recupero metrics */}
      <div className="bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-4 lg:p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Prestazione recupero crediti</h3>
            <p className="text-[10px] text-theme-text-muted mt-0.5">Calcolato sui dati attuali · esclusi periodi</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider font-semibold">Tasso recupero</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1.5 tabular-nums">{performanceStats.recoveryRate}%</div>
            <div className="h-1 bg-theme-bg-tertiary rounded-full overflow-hidden mt-2">
              <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${performanceStats.recoveryRate}%` }}/>
            </div>
            <div className="text-[10px] text-theme-text-muted mt-1">recuperato vs totale</div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="text-[10px] text-amber-300/80 uppercase tracking-wider font-semibold">Età media debito</div>
            <div className="text-2xl font-bold text-amber-400 mt-1.5 tabular-nums">{performanceStats.avgAgeDays}<span className="text-sm font-medium text-amber-400/70 ml-1">gg</span></div>
            <div className="text-[10px] text-theme-text-muted mt-3">dal primo sospeso del cliente</div>
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="text-[10px] text-blue-300/80 uppercase tracking-wider font-semibold">Importo medio</div>
            <div className="text-2xl font-bold text-blue-400 mt-1.5 tabular-nums">€{(performanceStats.avgPerClient / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <div className="text-[10px] text-theme-text-muted mt-3">da incassare per cliente</div>
          </div>

          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="text-[10px] text-purple-300/80 uppercase tracking-wider font-semibold">Clienti con MIT</div>
            <div className="text-2xl font-bold text-purple-400 mt-1.5 tabular-nums">{performanceStats.clientsWithMit}<span className="text-sm font-medium text-purple-400/70 ml-1">/ {customerGroups.length}</span></div>
            <div className="text-[10px] text-theme-text-muted mt-3">addebito automatico attivo</div>
          </div>
        </div>
      </div>

      {/* Payment-method picker — opens before any "Segna Pagato" / "Salda Tutto"
          path so the booking row is stamped with HOW the customer paid. */}
      {payMethodPicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-bold text-theme-text-primary">Come è stato pagato?</h3>
            <p className="text-sm text-theme-text-muted">{payMethodPicker.description}</p>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Metodo di pagamento</label>
              <select
                value={selectedPayMethod}
                onChange={e => setSelectedPayMethod(e.target.value)}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-green-500"
              >
                {paymentMethods.map(pm => (
                  <option key={pm.key} value={pm.label}>{pm.label}</option>
                ))}
                {selectedPayMethod && !paymentMethods.some(pm => pm.label === selectedPayMethod) && (
                  <option value={selectedPayMethod}>{selectedPayMethod}</option>
                )}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPayMethodPicker(null)}
                className="px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-primary text-theme-text-primary rounded-lg text-sm font-medium transition-colors"
              >Annulla</button>
              <button
                onClick={async () => {
                  const method = selectedPayMethod
                  const onConfirm = payMethodPicker.onConfirm
                  setPayMethodPicker(null)
                  await onConfirm(method)
                }}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >Conferma</button>
            </div>
          </div>
        </div>
      )}

      {/* Addebito Modal */}
      {showAddebitoModal && addebitoGroup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-theme-text-primary">
              Addebito{addebitoItemLabel ? ` — ${addebitoItemLabel}` : ''} — {addebitoGroup.customerName}
            </h3>
            <div className="text-sm text-theme-text-secondary space-y-1">
              <p><strong>Email:</strong> {addebitoGroup.customerEmail}</p>
              <p><strong>Da incassare:</strong> <span className="text-red-400 font-bold">€{((addebitoItemAmount != null ? addebitoItemAmount : addebitoGroup.totalRemaining) / 100).toFixed(2)}</span></p>
              {addebitoItemAmount != null && addebitoCarryForward > 0 && (
                <div className="text-xs bg-orange-900/20 border border-orange-700/30 rounded-lg p-2 mt-1 space-y-0.5">
                  <p className="text-theme-text-muted">
                    {addebitoItemLabel}: <span className="text-theme-text-primary font-semibold">€{((addebitoItemAmount - addebitoCarryForward) / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-theme-text-muted">
                    Saldo precedente non riscosso: <span className="text-orange-400 font-semibold">+€{(addebitoCarryForward / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-theme-text-primary font-bold pt-0.5 border-t border-orange-700/20">
                    Totale addebito: €{(addebitoItemAmount / 100).toFixed(2)}
                  </p>
                </div>
              )}
              <p><strong>Contract ID:</strong> {addebitoContractId ? <span className="font-mono text-xs text-green-400">{addebitoContractId}</span> : <span className="text-red-400">Non trovato</span>}</p>
            </div>

            {/* Danni photos from booking */}
            {addebitoDanniPhotos.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Foto Danni ({addebitoDanniPhotos.length})</label>
                <div className="flex gap-2 flex-wrap">
                  {addebitoDanniPhotos.map((url, i) => (
                    <img key={i} src={url} alt={`Danno ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-theme-border" />
                  ))}
                </div>
                <p className="text-xs text-theme-text-muted mt-1">Allegate automaticamente dalla scheda danni</p>
              </div>
            )}

            <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-xs text-yellow-300">
              <strong>Flusso:</strong> Email formale inviata subito → seconda email con foto danni → addebito MIT con auto-retry -10%.
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowAddebitoModal(false)}
                disabled={addebitoSending}
                className="px-4 py-2 rounded-lg text-sm bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={handleAddebitoUnpaid}
                disabled={addebitoSending || !addebitoContractId}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {addebitoSending ? 'Invio...' : `Invia Email e Programma Addebito €${((addebitoItemAmount != null ? addebitoItemAmount : addebitoGroup.totalRemaining) / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
