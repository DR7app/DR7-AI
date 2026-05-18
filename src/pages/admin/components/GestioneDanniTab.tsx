import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import { logAdminAction } from '../../../utils/logAdminAction'

// ── Keyword classification (mirrors report-danni.ts) ──────────────────────────
const DANNI_KEYWORDS = [
  'fermo veicolo', 'fermo del veicolo', 'foro da sigaretta', 'foro sigaretta',
  'gonfia e ripara', 'bomboletta', 'veicolo sporco', 'igienizzazione',
  'controlli elettronici', 'disattivazione controlli', 'cani', 'pelo di cane',
  'pista', 'competizioni', 'incidente', 'danni',
]
const PENALI_KEYWORDS = [
  'fumo', 'odore', 'cenere', 'guidatore non', 'carburante', 'multe',
  'sanzioni', 'assenza intestatario', 'ritardo', 'check-out', 'checkout',
  'subnoleggio', 'neopatentati', 'non abilitati', 'patente', 'riconsegna',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyInvoiceItems(items: any[]): 'danni' | 'penali' | null {
  for (const item of items) {
    const desc = (item.description || '').toLowerCase()
    if (desc.includes('danno prenotazione')) return 'danni'
    if (!desc.includes('penale prenotazione')) continue
    const dashIdx = desc.indexOf(' - ')
    const motivo = dashIdx >= 0 ? desc.substring(dashIdx + 3) : desc
    for (const kw of DANNI_KEYWORDS) { if (motivo.includes(kw.toLowerCase())) return 'danni' }
    for (const kw of PENALI_KEYWORDS) { if (motivo.includes(kw.toLowerCase())) return 'penali' }
  }
  return 'penali'
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PenaltyDannoItem {
  bookingId: string
  bookingLabel: string // e.g. "Fiat 500 — 2026-01-15"
  label: string
  amount: number
  quantity: number
  total: number
  amountPaid: number // amount already paid in EUR (default 0)
  paymentStatus: 'pending' | 'partial' | 'paid'
  note: string
  date: string
  status: 'pending' | 'invoiced'
  fatturaNumero?: string
  fatturaId?: string
  arrayKey: 'penalties' | 'danni'
  arrayIndex: number // index in the booking_details array (for pending items)
  photos?: string[] // danni photo URLs
}

interface CustomerGroup {
  key: string // normalized name
  customerName: string
  customerEmail: string
  penaliItems: PenaltyDannoItem[]
  danniItems: PenaltyDannoItem[]
  penaliTotal: number
  danniTotal: number
  mostRecentBookingId: string | null
}

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function normalizeKey(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function openFatturaPdf(invoiceId: string) {
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(`<html><body style="font-family:system-ui,sans-serif;text-align:center;padding:50px;">Generazione fattura in corso...</body></html>`)
  }
  try {
    const response = await authFetch('/.netlify/functions/generate-invoice-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId })
    })
    if (!response.ok) throw new Error('Failed to generate invoice PDF')
    const html = await response.text()
    if (printWindow) { printWindow.document.open(); printWindow.document.write(html); printWindow.document.close() }
  } catch (err) {
    console.error('Open fattura PDF error:', err)
    if (printWindow) printWindow.close()
    toast.error('Errore apertura fattura')
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GestioneDanniTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [customers, setCustomers] = useState<CustomerGroup[]>([])
  const [search, setSearch] = useState('')

  // Modal state
  const [editModal, setEditModal] = useState<{
    customer: CustomerGroup
    type: 'penali' | 'danni'
  } | null>(null)

  // New-item form inside modal
  const [newLabel, setNewLabel] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [saving, setSaving] = useState(false)

  // Photo viewer modal
  const [photoModal, setPhotoModal] = useState<{ customerName: string; photos: string[] } | null>(null)

  // Pay by link
  const [payByLinkLoading, setPayByLinkLoading] = useState<string | null>(null)

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      // 1. Fetch all bookings with booking_details
      const { data: bookings, error: bErr } = await supabase
        .from('bookings')
        .select('id, customer_name, customer_email, vehicle_name, pickup_date, booking_details, booked_at')

      if (bErr) throw bErr

      // 2. Fetch penalty/damage fatture
      const { data: fatture, error: fErr } = await supabase
        .from('fatture')
        .select('id, booking_id, numero_fattura, importo_totale, items, customer_name, customer_email')

      if (fErr) throw fErr

      // Build a booking lookup for fatture
      const bookingMap = new Map<string, { customer_name: string; customer_email: string; vehicle_name: string; pickup_date: string }>()
      for (const b of (bookings || [])) {
        bookingMap.set(b.id, {
          customer_name: b.customer_name || '',
          customer_email: b.customer_email || '',
          vehicle_name: b.vehicle_name || '',
          pickup_date: b.pickup_date || '',
        })
      }

      // Aggregate by customer
      const map = new Map<string, CustomerGroup>()

      function getOrCreate(name: string, email: string): CustomerGroup {
        const key = normalizeKey(name)
        if (!key) return { key: '_unknown', customerName: 'Sconosciuto', customerEmail: '', penaliItems: [], danniItems: [], penaliTotal: 0, danniTotal: 0, mostRecentBookingId: null }
        let g = map.get(key)
        if (!g) {
          g = { key, customerName: name.trim(), customerEmail: email || '', penaliItems: [], danniItems: [], penaliTotal: 0, danniTotal: 0, mostRecentBookingId: null }
          map.set(key, g)
        }
        if (!g.customerEmail && email) g.customerEmail = email
        return g
      }

      // 3a. Scan bookings for pending penalties & danni
      for (const b of (bookings || [])) {
        const details = b.booking_details || {}
        const bookingLabel = `${b.vehicle_name || '—'} — ${b.pickup_date || '—'}`

        for (const arrayKey of ['penalties', 'danni'] as const) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const entries: any[] = details[arrayKey] || []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          entries.forEach((entry: any, idx: number) => {
            const g = getOrCreate(b.customer_name || '', b.customer_email || '')
            const total = entry.total || (entry.amount || 0) * (entry.quantity || 1)
            const amountPaid = entry.amountPaid || 0
            const paymentStatus: 'pending' | 'partial' | 'paid' =
              entry.paymentStatus === 'paid' ? 'paid' :
              entry.paymentStatus === 'partial' ? 'partial' :
              amountPaid > 0 && amountPaid < total ? 'partial' : 'pending'
            const item: PenaltyDannoItem = {
              bookingId: b.id,
              bookingLabel,
              label: entry.label || entry.description || '—',
              amount: entry.amount || total,
              quantity: entry.quantity || 1,
              total,
              amountPaid,
              paymentStatus,
              note: entry.note || '',
              date: entry.date || '',
              status: 'pending',
              arrayKey,
              arrayIndex: idx,
              photos: arrayKey === 'danni' && entry.photos ? entry.photos : undefined,
            }
            if (arrayKey === 'penalties') {
              g.penaliItems.push(item)
              g.penaliTotal += total
            } else {
              g.danniItems.push(item)
              g.danniTotal += total
            }
            // Track most recent booking
            if (!g.mostRecentBookingId) g.mostRecentBookingId = b.id
          })
        }

        // Also track the most recent booking per customer even without penalties
        const g = map.get(normalizeKey(b.customer_name || ''))
        if (g && !g.mostRecentBookingId) g.mostRecentBookingId = b.id
      }

      // 3b. Scan fatture for invoiced penalty/damage items
      // Track which booking IDs already have entries from booking_details to avoid duplicates
      const bookingIdsWithDetails = new Set<string>()
      for (const b of (bookings || [])) {
        const details = b.booking_details || {}
        const hasPenalties = Array.isArray(details.penalties) && details.penalties.length > 0
        const hasDanni = Array.isArray(details.danni) && details.danni.length > 0
        if (hasPenalties || hasDanni) bookingIdsWithDetails.add(b.id)
      }

      for (const f of (fatture || [])) {
        if (!f.items || !Array.isArray(f.items)) continue
        // Skip if this booking's penalties/danni were already added from booking_details
        if (f.booking_id && bookingIdsWithDetails.has(f.booking_id)) continue

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasPenalty = f.items.some((item: any) =>
          item.description && (item.description.includes('Penale prenotazione') || item.description.includes('Danno prenotazione'))
        )
        if (!hasPenalty) continue

        const classification = classifyInvoiceItems(f.items)
        if (!classification) continue

        // Resolve customer name
        let custName = f.customer_name || ''
        let custEmail = f.customer_email || ''
        if (f.booking_id && bookingMap.has(f.booking_id)) {
          const bk = bookingMap.get(f.booking_id)!
          if (!custName) custName = bk.customer_name
          if (!custEmail) custEmail = bk.customer_email
        }
        if (!custName) continue

        const g = getOrCreate(custName, custEmail)
        const bookingInfo = f.booking_id ? bookingMap.get(f.booking_id) : null
        const bookingLabel = bookingInfo
          ? `${bookingInfo.vehicle_name || '—'} — ${bookingInfo.pickup_date || '—'}`
          : `Fattura ${f.numero_fattura || ''}`

        // Each fattura item becomes one entry
        for (const fi of f.items) {
          if (!fi.description) continue
          const desc = fi.description as string
          if (!desc.includes('Penale prenotazione') && !desc.includes('Danno prenotazione')) continue

          const total = fi.total || (fi.unit_price || 0) * (fi.quantity || 1)
          const fiAmountPaid = fi.amountPaid ?? total
          const fiPaymentStatus: 'pending' | 'partial' | 'paid' =
            fi.paymentStatus === 'partial' ? 'partial' :
            fi.paymentStatus === 'pending' ? 'pending' :
            fiAmountPaid < total ? 'partial' : 'paid'
          const item: PenaltyDannoItem = {
            bookingId: f.booking_id || '',
            bookingLabel,
            label: desc,
            amount: fi.unit_price || total,
            quantity: fi.quantity || 1,
            total,
            amountPaid: fiAmountPaid,
            paymentStatus: fiPaymentStatus,
            note: '',
            date: '',
            status: 'invoiced',
            fatturaNumero: f.numero_fattura || undefined,
            fatturaId: f.id || undefined,
            arrayKey: classification === 'danni' ? 'danni' : 'penalties',
            arrayIndex: -1,
          }
          if (classification === 'penali') {
            g.penaliItems.push(item)
            g.penaliTotal += total
          } else {
            g.danniItems.push(item)
            g.danniTotal += total
          }
        }
      }

      // Keep only customers with at least one item, also ensure we track any booking ID
      // for each customer (for adding new items)
      for (const b of (bookings || [])) {
        const g = map.get(normalizeKey(b.customer_name || ''))
        if (g && !g.mostRecentBookingId) {
          g.mostRecentBookingId = b.id
        }
      }

      const result = Array.from(map.values())
        .filter(g => g.penaliItems.length > 0 || g.danniItems.length > 0)
        .sort((a, b) => (b.penaliTotal + b.danniTotal) - (a.penaliTotal + a.danniTotal))

      setCustomers(result)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('GestioneDanniTab load error:', err)
      setError(_errMsg || 'Errore nel caricamento dei dati.')
    } finally {
      setLoading(false)
    }
  }

  // ── Pay by Link for danni ─────────────────────────────────────────────────
  async function handlePayByLink(customer: CustomerGroup) {
    const unpaidDanni = customer.danniItems.filter(d => d.paymentStatus !== 'paid')
    const totalEur = unpaidDanni.reduce((s, d) => s + (d.total - d.amountPaid), 0)
    if (totalEur <= 0) {
      toast.error('Nessun danno da pagare')
      return
    }

    setPayByLinkLoading(customer.key)
    try {
      const res = await authFetch('/.netlify/functions/nexi-pay-by-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: customer.mostRecentBookingId || null,
          amount: totalEur,
          customerEmail: customer.customerEmail,
          customerName: customer.customerName,
          description: `Danni — ${customer.customerName}`,
          expirationHours: 1,
        }),
      })
      const data = await res.json()
      if (res.ok && data.paymentUrl) {
        // Try clipboard, but don't fail if blocked
        try { await navigator.clipboard.writeText(data.paymentUrl) } catch { /* clipboard not available */ }
        toast.success(`Pay by Link creato! €${totalEur.toFixed(2)}\n${data.paymentUrl}`, { duration: 8000 })
      } else {
        toast.error(data.error || 'Errore creazione link')
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore Pay by Link: ' + _errMsg)
    } finally {
      setPayByLinkLoading(null)
    }
  }

  // ── Open photo viewer for a customer ──────────────────────────────────────
  function openPhotos(customer: CustomerGroup) {
    const allPhotos: string[] = []
    for (const item of customer.danniItems) {
      if (item.photos && item.photos.length > 0) {
        allPhotos.push(...item.photos)
      }
    }
    if (allPhotos.length === 0) {
      toast.error('Nessuna foto danni trovata per questo cliente')
      return
    }
    setPhotoModal({ customerName: customer.customerName, photos: allPhotos })
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return customers
    const q = search.trim().toLowerCase()
    return customers.filter(c =>
      c.customerName.toLowerCase().includes(q) ||
      c.customerEmail.toLowerCase().includes(q)
    )
  }, [customers, search])

  // ── Grand totals ───────────────────────────────────────────────────────────
  const grandPenali = customers.reduce((s, c) => s + c.penaliTotal, 0)
  const grandDanni = customers.reduce((s, c) => s + c.danniTotal, 0)

  // ── Delete all pending items of a type for a customer ────────────────────
  async function handleDeleteAllPending(customer: CustomerGroup, type: 'penali' | 'danni') {
    const arrayKey = type === 'penali' ? 'penalties' : 'danni'
    const pendingItems = (type === 'penali' ? customer.penaliItems : customer.danniItems)
      .filter(i => i.status === 'pending')

    if (pendingItems.length === 0) return

    setSaving(true)
    try {
      // Group by bookingId so we batch updates per booking
      const byBooking = new Map<string, PenaltyDannoItem[]>()
      for (const item of pendingItems) {
        const list = byBooking.get(item.bookingId) || []
        list.push(item)
        byBooking.set(item.bookingId, list)
      }

      for (const [bookingId, items] of byBooking) {
        const { data: booking, error: fetchErr } = await supabase
          .from('bookings')
          .select('booking_details')
          .eq('id', bookingId)
          .single()

        if (fetchErr) throw fetchErr

        const details = booking?.booking_details || {}
        // Remove all entries at the given indices (delete from end to preserve indices)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details[arrayKey] || [])]
        const indicesToRemove = items.map(i => i.arrayIndex).sort((a, b) => b - a)
        for (const idx of indicesToRemove) {
          arr.splice(idx, 1)
        }

        const { error: updateErr } = await supabase
          .from('bookings')
          .update({ booking_details: { ...details, [arrayKey]: arr } })
          .eq('id', bookingId)

        if (updateErr) throw updateErr
      }

      // Log aggregato: UN evento con count + voci, così Operatori vede
      // "eliminato 10 penali/danni" invece di N righe separate.
      const firstBookingId = pendingItems[0]?.bookingId || null
      const totalAmount = pendingItems.reduce((s, i) => s + Number(i.total || 0), 0)
      const labels = pendingItems.slice(0, 20).map(i => i.label)
      logAdminAction('edit_booking', 'booking', firstBookingId || undefined, {
        _subaction: type === 'penali' ? 'delete_penali_bulk' : 'delete_danni_bulk',
        count: pendingItems.length,
        customer_name: customer.customerName,
        total_amount: totalAmount,
        labels,
        booking_ids: Array.from(byBooking.keys()),
      })

      toast.success(`${type === 'penali' ? 'Penali' : 'Danni'} eliminati`)
      await loadData()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal: delete a single item (pending or invoiced) ──────────────────────
  async function handleDeleteItem(item: PenaltyDannoItem) {
    setSaving(true)
    try {
      if (item.status === 'pending') {
        // Remove from booking_details array
        const { data: booking, error: fetchErr } = await supabase
          .from('bookings')
          .select('booking_details')
          .eq('id', item.bookingId)
          .single()

        if (fetchErr) throw fetchErr

        const details = booking?.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details[item.arrayKey] || [])]
        arr.splice(item.arrayIndex, 1)

        const { error: updateErr } = await supabase
          .from('bookings')
          .update({ booking_details: { ...details, [item.arrayKey]: arr } })
          .eq('id', item.bookingId)

        if (updateErr) throw updateErr
      } else if (item.status === 'invoiced' && item.fatturaNumero) {
        // Remove this line item from the fattura's items array (fattura stays, just fewer items)
        const { data: fattura, error: fetchErr } = await supabase
          .from('fatture')
          .select('id, items, importo_totale')
          .eq('numero_fattura', item.fatturaNumero)
          .single()

        if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fatturaItems: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
        // Find matching line item by description
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchIdx = fatturaItems.findIndex((fi: any) => fi.description === item.label)

        if (matchIdx >= 0) {
          const removedTotal = fatturaItems[matchIdx].total || (fatturaItems[matchIdx].unit_price || 0) * (fatturaItems[matchIdx].quantity || 1)
          fatturaItems.splice(matchIdx, 1)

          if (fatturaItems.length === 0) {
            // No items left — delete the fattura
            const { error: delErr } = await supabase.from('fatture').delete().eq('id', fattura.id)
            if (delErr) throw delErr
          } else {
            // Update fattura with remaining items and adjusted total
            const newTotal = Math.max(0, (fattura.importo_totale || 0) - removedTotal)
            const { error: updateErr } = await supabase
              .from('fatture')
              .update({ items: fatturaItems, importo_totale: newTotal })
              .eq('id', fattura.id)
            if (updateErr) throw updateErr
          }
        }
      }

      // Log del singolo delete con _subaction per mostrare in Operatori
      // "Eliminazione penale" / "Eliminazione danno" invece di edit_booking.
      logAdminAction('edit_booking', 'booking', item.bookingId, {
        _subaction: item.arrayKey === 'penalties' ? 'delete_penale' : 'delete_danno',
        label: item.label,
        amount: item.total,
        status: item.status,
        fattura_numero: item.fatturaNumero || null,
      })

      toast.success('Voce eliminata')
      setEditModal(null)
      await loadData()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal: update amount of a pending or invoiced item ──────────────────────
  async function handleUpdateAmount(item: PenaltyDannoItem, newTotal: number) {
    setSaving(true)
    try {
      if (item.status === 'pending') {
        // Update booking_details array
        const { data: booking, error: fetchErr } = await supabase
          .from('bookings')
          .select('booking_details')
          .eq('id', item.bookingId)
          .single()

        if (fetchErr) throw fetchErr

        const details = booking?.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details[item.arrayKey] || [])]
        if (arr[item.arrayIndex]) {
          arr[item.arrayIndex] = { ...arr[item.arrayIndex], amount: newTotal, total: newTotal, quantity: 1 }
        }

        const { error: updateErr } = await supabase
          .from('bookings')
          .update({ booking_details: { ...details, [item.arrayKey]: arr } })
          .eq('id', item.bookingId)

        if (updateErr) throw updateErr
      } else if (item.status === 'invoiced' && item.fatturaNumero) {
        // Update fattura line item
        const { data: fattura, error: fetchErr } = await supabase
          .from('fatture')
          .select('id, items, importo_totale')
          .eq('numero_fattura', item.fatturaNumero)
          .single()

        if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fatturaItems: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchIdx = fatturaItems.findIndex((fi: any) => fi.description === item.label)

        if (matchIdx >= 0) {
          const oldTotal = fatturaItems[matchIdx].total || (fatturaItems[matchIdx].unit_price || 0) * (fatturaItems[matchIdx].quantity || 1)
          fatturaItems[matchIdx] = { ...fatturaItems[matchIdx], unit_price: newTotal, total: newTotal, quantity: 1 }
          const newImporto = Math.max(0, (fattura.importo_totale || 0) - oldTotal + newTotal)

          const { error: updateErr } = await supabase
            .from('fatture')
            .update({ items: fatturaItems, importo_totale: newImporto })
            .eq('id', fattura.id)

          if (updateErr) throw updateErr
        }
      }

      toast.success('Importo aggiornato')
      setEditModal(null)
      await loadData()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal: register a partial (or full) payment on a pending/partial item ──
  async function handlePartialPayment(item: PenaltyDannoItem, paymentAmount: number) {
    setSaving(true)
    try {
      if (item.status === 'pending') {
        // Update booking_details array
        const { data: booking, error: fetchErr } = await supabase
          .from('bookings')
          .select('booking_details')
          .eq('id', item.bookingId)
          .single()

        if (fetchErr) throw fetchErr

        const details = booking?.booking_details || {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any[] = [...(details[item.arrayKey] || [])]
        if (arr[item.arrayIndex]) {
          const existing = arr[item.arrayIndex]
          const newAmountPaid = (existing.amountPaid || 0) + paymentAmount
          const total = existing.total || (existing.amount || 0) * (existing.quantity || 1)
          const fullyPaid = newAmountPaid >= total
          const nowIso = new Date().toISOString()
          // Storico pagamenti per supportare report tipo "quanto tempo
          // ha impiegato il cliente a saldare". paidAt = data dell'ultimo
          // pagamento; payments[] tiene la lista completa con importo
          // e timestamp per audit.
          const prevPayments = Array.isArray(existing.payments) ? existing.payments : []
          arr[item.arrayIndex] = {
            ...existing,
            amountPaid: Math.min(newAmountPaid, total),
            paymentStatus: fullyPaid ? 'paid' : 'partial',
            paidAt: fullyPaid ? nowIso : (existing.paidAt || null),
            payments: [...prevPayments, { amount: paymentAmount, paidAt: nowIso }],
          }
        }

        const { error: updateErr } = await supabase
          .from('bookings')
          .update({ booking_details: { ...details, [item.arrayKey]: arr } })
          .eq('id', item.bookingId)

        if (updateErr) throw updateErr
      } else if (item.status === 'invoiced' && item.fatturaNumero) {
        // Update fattura — reduce importo_totale by payment, track amountPaid in items
        const { data: fattura, error: fetchErr } = await supabase
          .from('fatture')
          .select('id, items, importo_totale')
          .eq('numero_fattura', item.fatturaNumero)
          .single()

        if (fetchErr || !fattura) throw fetchErr || new Error('Fattura non trovata')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fatturaItems: any[] = Array.isArray(fattura.items) ? [...fattura.items] : []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchIdx = fatturaItems.findIndex((fi: any) => fi.description === item.label)

        if (matchIdx >= 0) {
          const fi = fatturaItems[matchIdx]
          const fiTotal = fi.total || (fi.unit_price || 0) * (fi.quantity || 1)
          const newAmountPaid = (fi.amountPaid || 0) + paymentAmount
          fatturaItems[matchIdx] = {
            ...fi,
            amountPaid: Math.min(newAmountPaid, fiTotal),
            paymentStatus: newAmountPaid >= fiTotal ? 'paid' : 'partial',
          }

          const { error: updateErr } = await supabase
            .from('fatture')
            .update({ items: fatturaItems })
            .eq('id', fattura.id)

          if (updateErr) throw updateErr
        }
      }

      toast.success('Pagamento registrato')
      setEditModal(null)
      await loadData()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal: add new item ────────────────────────────────────────────────────
  async function handleAddItem() {
    if (!editModal) return
    const amount = parseFloat(newAmount)
    if (!newLabel.trim() || isNaN(amount) || amount <= 0) {
      toast.error('Inserisci descrizione e importo valido')
      return
    }

    const bookingId = editModal.customer.mostRecentBookingId
    if (!bookingId) {
      toast.error('Nessuna prenotazione trovata per questo cliente')
      return
    }

    const arrayKey = editModal.type === 'penali' ? 'penalties' : 'danni'

    setSaving(true)
    try {
      const { data: booking, error: fetchErr } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', bookingId)
        .single()

      if (fetchErr) throw fetchErr

      const details = booking?.booking_details || {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing: any[] = details[arrayKey] || []
      const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })

      const newEntry = {
        label: newLabel.trim(),
        amount,
        quantity: 1,
        total: amount,
        note: '',
        date: italyDate,
        paymentStatus: 'pending',
      }

      const { error: updateErr } = await supabase
        .from('bookings')
        .update({ booking_details: { ...details, [arrayKey]: [...existing, newEntry] } })
        .eq('id', bookingId)

      if (updateErr) throw updateErr

      toast.success(`${editModal.type === 'penali' ? 'Penale' : 'Danno'} aggiunto`)
      setNewLabel('')
      setNewAmount('')
      setEditModal(null)
      await loadData()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Danni & Penali</h2>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 bg-theme-bg-secondary border border-theme-border rounded-full text-theme-text-primary text-sm hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
        >
          {loading ? 'Caricamento...' : 'Aggiorna'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
          <p className="text-theme-text-muted">Caricamento...</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Clienti</p>
              <p className="text-2xl font-bold text-theme-text-primary">{customers.length}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Totale Penali</p>
              <p className="text-2xl font-bold text-orange-400">{formatCurrency(grandPenali)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Totale Danni</p>
              <p className="text-2xl font-bold text-red-400">{formatCurrency(grandDanni)}</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca cliente..."
              className="w-full pl-10 pr-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all text-sm"
            />
          </div>

          {/* Desktop table */}
          <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-right px-4 py-3">Penali</th>
                    <th className="text-center px-4 py-3"></th>
                    <th className="text-right px-4 py-3">Danni</th>
                    <th className="text-center px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.key} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-theme-text-primary">{c.customerName}</p>
                        {c.customerEmail && <p className="text-xs text-theme-text-muted">{c.customerEmail}</p>}
                      </td>
                      <td className="text-right px-4 py-3">
                        <span className={`font-semibold ${c.penaliTotal > 0 ? 'text-orange-400' : 'text-theme-text-muted'}`}>
                          {formatCurrency(c.penaliTotal)}
                        </span>
                        <span className="text-xs text-theme-text-muted ml-1">({c.penaliItems.length})</span>
                      </td>
                      <td className="text-center px-2 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => { setEditModal({ customer: c, type: 'penali' }); setNewLabel(''); setNewAmount('') }}
                            className="px-3 py-1 text-xs bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 rounded-full transition-colors"
                          >
                            Modifica
                          </button>
                          <button
                            onClick={() => handleDeleteAllPending(c, 'penali')}
                            disabled={saving}
                            className="px-3 py-1 text-xs bg-orange-500/10 text-orange-400/70 hover:bg-orange-500/20 hover:text-orange-400 rounded-full transition-colors disabled:opacity-30"
                          >
                            Elimina
                          </button>
                        </div>
                      </td>
                      <td className="text-right px-4 py-3">
                        <span className={`font-semibold ${c.danniTotal > 0 ? 'text-red-400' : 'text-theme-text-muted'}`}>
                          {formatCurrency(c.danniTotal)}
                        </span>
                        <span className="text-xs text-theme-text-muted ml-1">({c.danniItems.length})</span>
                      </td>
                      <td className="text-center px-2 py-3">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <button
                            onClick={() => { setEditModal({ customer: c, type: 'danni' }); setNewLabel(''); setNewAmount('') }}
                            className="px-3 py-1 text-xs bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded-full transition-colors"
                          >
                            Modifica
                          </button>
                          <button
                            onClick={() => handleDeleteAllPending(c, 'danni')}
                            disabled={saving}
                            className="px-3 py-1 text-xs bg-red-500/10 text-red-400/70 hover:bg-red-500/20 hover:text-red-400 rounded-full transition-colors disabled:opacity-30"
                          >
                            Elimina
                          </button>
                          {c.danniItems.some(d => d.photos && d.photos.length > 0) && (
                            <button
                              onClick={() => openPhotos(c)}
                              className="px-3 py-1 text-xs bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 rounded-full transition-colors"
                            >
                              Documenti Integrativi
                            </button>
                          )}
                          {c.danniItems.some(d => d.paymentStatus !== 'paid') && (
                            <button
                              onClick={() => handlePayByLink(c)}
                              disabled={payByLinkLoading === c.key}
                              className="px-3 py-1 text-xs bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 rounded-full transition-colors disabled:opacity-50"
                            >
                              {payByLinkLoading === c.key ? 'Creazione...' : 'Pay by Link'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden p-3 space-y-3">
              {filtered.map(c => (
                <div key={c.key} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                  <div className="mb-3">
                    <p className="font-semibold text-theme-text-primary text-sm">{c.customerName}</p>
                    {c.customerEmail && <p className="text-xs text-theme-text-muted">{c.customerEmail}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-orange-400">{formatCurrency(c.penaliTotal)}</p>
                      <p className="text-xs text-theme-text-muted mb-2">Penali ({c.penaliItems.length})</p>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => { setEditModal({ customer: c, type: 'penali' }); setNewLabel(''); setNewAmount('') }}
                          className="px-3 py-1 text-xs bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 rounded-full transition-colors"
                        >
                          Modifica
                        </button>
                        <button
                          onClick={() => handleDeleteAllPending(c, 'penali')}
                          disabled={saving}
                          className="px-3 py-1 text-xs bg-orange-500/10 text-orange-400/70 hover:bg-orange-500/20 hover:text-orange-400 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Elimina
                        </button>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-red-400">{formatCurrency(c.danniTotal)}</p>
                      <p className="text-xs text-theme-text-muted mb-2">Danni ({c.danniItems.length})</p>
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        <button
                          onClick={() => { setEditModal({ customer: c, type: 'danni' }); setNewLabel(''); setNewAmount('') }}
                          className="px-3 py-1 text-xs bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded-full transition-colors"
                        >
                          Modifica
                        </button>
                        <button
                          onClick={() => handleDeleteAllPending(c, 'danni')}
                          disabled={saving}
                          className="px-3 py-1 text-xs bg-red-500/10 text-red-400/70 hover:bg-red-500/20 hover:text-red-400 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Elimina
                        </button>
                        {c.danniItems.some(d => d.photos && d.photos.length > 0) && (
                          <button
                            onClick={() => openPhotos(c)}
                            className="px-3 py-1 text-xs bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 rounded-full transition-colors mt-1"
                          >
                            Documenti
                          </button>
                        )}
                        {c.danniItems.some(d => d.paymentStatus !== 'paid') && (
                          <button
                            onClick={() => handlePayByLink(c)}
                            disabled={payByLinkLoading === c.key}
                            className="px-3 py-1 text-xs bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 rounded-full transition-colors mt-1 disabled:opacity-50"
                          >
                            {payByLinkLoading === c.key ? '...' : 'Pay by Link'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-theme-text-muted">
                  {search ? 'Nessun risultato per la ricerca.' : 'Nessun danno o penale registrato.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────────────────── */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => !saving && setEditModal(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-theme-bg-secondary/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-white/10 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle (mobile) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="px-6 pt-4 sm:pt-6 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-theme-text-primary tracking-tight">
                    {editModal.type === 'penali' ? 'Penali' : 'Danni'}
                  </h2>
                  <p className="text-[13px] text-theme-text-muted mt-0.5">
                    {editModal.customer.customerName}
                  </p>
                </div>
                <button
                  onClick={() => !saving && setEditModal(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Scrollable items list */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
              {/* Existing items */}
              {(editModal.type === 'penali' ? editModal.customer.penaliItems : editModal.customer.danniItems).map((item, idx) => (
                <ItemRow
                  key={`${item.bookingId}-${item.arrayIndex}-${idx}`}
                  item={item}
                  accentColor={editModal.type === 'penali' ? 'orange' : 'red'}
                  onDelete={() => handleDeleteItem(item)}
                  onUpdateAmount={(val) => handleUpdateAmount(item, val)}
                  onPartialPayment={(val) => handlePartialPayment(item, val)}
                  saving={saving}
                />
              ))}

              {(editModal.type === 'penali' ? editModal.customer.penaliItems : editModal.customer.danniItems).length === 0 && (
                <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-6 text-center">
                  <p className="text-theme-text-muted text-sm">Nessuna voce registrata.</p>
                </div>
              )}

              {/* Add new item */}
              <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
                <p className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-widest mb-3">
                  Aggiungi {editModal.type === 'penali' ? 'penale' : 'danno'}
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="Descrizione"
                    disabled={saving}
                    className={`w-full px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 ${editModal.type === 'penali' ? 'focus:ring-orange-500/50' : 'focus:ring-red-500/50'}`}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem() } }}
                  />
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted text-[13px]">&euro;</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newAmount}
                        onChange={e => setNewAmount(e.target.value)}
                        placeholder="Importo"
                        disabled={saving}
                        className={`w-full pl-7 pr-2 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-theme-text-primary text-[13px] placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 ${editModal.type === 'penali' ? 'focus:ring-orange-500/50' : 'focus:ring-red-500/50'}`}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem() } }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddItem}
                      disabled={saving || !newLabel.trim() || !newAmount || parseFloat(newAmount) <= 0}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0 ${editModal.type === 'penali' ? 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/25' : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer with total */}
            <div className="border-t border-white/[0.08] bg-theme-bg-secondary/98 backdrop-blur-xl px-6 py-4 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-theme-text-muted">
                  {(editModal.type === 'penali' ? editModal.customer.penaliItems : editModal.customer.danniItems).length} voci
                </span>
                <span className={`text-2xl font-bold tracking-tight tabular-nums ${editModal.type === 'penali' ? 'text-orange-400' : 'text-red-400'}`}>
                  {formatCurrency(editModal.type === 'penali' ? editModal.customer.penaliTotal : editModal.customer.danniTotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo Viewer Modal (Documenti Integrativi) ───────────────────── */}
      {photoModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setPhotoModal(null)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-2xl max-h-[92vh] flex flex-col bg-theme-bg-secondary/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-white/10 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            <div className="px-6 pt-4 sm:pt-6 pb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-theme-text-primary tracking-tight">Documenti Integrativi</h2>
                <p className="text-[13px] text-theme-text-muted mt-0.5">{photoModal.customerName} — {photoModal.photos.length} foto</p>
              </div>
              <button
                onClick={() => setPhotoModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photoModal.photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={url}
                      alt={`Danno ${i + 1}`}
                      className="w-full h-40 object-cover rounded-xl border border-white/10 hover:border-blue-400/50 transition-all cursor-pointer"
                    />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Item Row subcomponent ────────────────────────────────────────────────────
function ItemRow({ item, accentColor, onDelete, onUpdateAmount, onPartialPayment, saving }: {
  item: PenaltyDannoItem
  accentColor: 'orange' | 'red'
  onDelete: () => void
  onUpdateAmount: (val: number) => void
  onPartialPayment: (val: number) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(item.total.toString())
  const [paying, setPaying] = useState(false)
  const [payValue, setPayValue] = useState('')

  const isPending = item.status === 'pending'
  const isPartial = item.paymentStatus === 'partial'
  const canPay = item.paymentStatus === 'pending' || item.paymentStatus === 'partial'
  const remaining = item.total - item.amountPaid
  const accent = accentColor === 'orange' ? 'orange' : 'red'

  function handleSaveEdit() {
    const val = parseFloat(editValue)
    if (isNaN(val) || val <= 0) return
    onUpdateAmount(val)
    setEditing(false)
  }

  function handleSavePayment() {
    const val = parseFloat(payValue)
    if (isNaN(val) || val <= 0 || val > remaining + 0.005) return
    onPartialPayment(val)
    setPaying(false)
    setPayValue('')
  }

  return (
    <div className={`rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06] ${isPending ? `bg-${accent}-500/[0.04]` : ''}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] leading-tight text-theme-text-primary font-medium">{item.label}</p>
          <p className="text-[11px] text-theme-text-muted leading-tight mt-0.5">
            {item.bookingLabel}
          </p>
          {item.note && (
            <p className="text-[11px] text-theme-text-muted/70 italic mt-0.5">{item.note}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {item.paymentStatus === 'paid' || item.status === 'invoiced' ? (
              item.status === 'invoiced' && item.fatturaId ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openFatturaPdf(item.fatturaId!) }}
                  title="Apri la fattura PDF"
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium hover:bg-green-500/25 hover:underline inline-flex items-center gap-1"
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  Fatturato{item.fatturaNumero ? ` — ${item.fatturaNumero}` : ''}
                </button>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
                  {item.status === 'invoiced'
                    ? `Fatturato${item.fatturaNumero ? ` — ${item.fatturaNumero}` : ''}`
                    : 'Pagato'}
                </span>
              )
            ) : isPartial ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                Parziale — {formatCurrency(item.amountPaid)}/{formatCurrency(item.total)}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 font-medium">Da saldare</span>
            )}
            {item.date && <span className="text-[10px] text-theme-text-muted">{item.date}</span>}
          </div>
          {isPartial && (
            <p className="text-[11px] text-blue-400 mt-0.5">{formatCurrency(remaining)} rimanenti</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {paying ? (
            <div className="flex items-center gap-1">
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-[12px]">&euro;</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={remaining}
                  value={payValue}
                  onChange={e => setPayValue(e.target.value)}
                  placeholder={remaining.toFixed(2)}
                  className={`w-20 pl-5 pr-1 py-1 bg-white/[0.06] border border-white/[0.08] rounded-lg text-theme-text-primary text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500/50`}
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePayment(); if (e.key === 'Escape') { setPaying(false); setPayValue('') } }}
                  autoFocus
                />
              </div>
              <button onClick={handleSavePayment} disabled={saving || !payValue || parseFloat(payValue) <= 0} className="w-6 h-6 rounded-full bg-green-500/15 text-green-400 hover:bg-green-500/25 flex items-center justify-center disabled:opacity-30">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button onClick={() => { setPaying(false); setPayValue('') }} className="w-6 h-6 rounded-full bg-white/10 text-theme-text-muted hover:bg-white/20 flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ) : editing ? (
            <div className="flex items-center gap-1">
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-[12px]">&euro;</span>
                <input
                  type="number"
                  step="0.01"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  className={`w-20 pl-5 pr-1 py-1 bg-white/[0.06] border border-white/[0.08] rounded-lg text-theme-text-primary text-[12px] focus:outline-none focus:ring-1 focus:ring-${accent}-500/50`}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditing(false) }}
                  autoFocus
                />
              </div>
              <button onClick={handleSaveEdit} disabled={saving} className="w-6 h-6 rounded-full bg-green-500/15 text-green-400 hover:bg-green-500/25 flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button onClick={() => setEditing(false)} className="w-6 h-6 rounded-full bg-white/10 text-theme-text-muted hover:bg-white/20 flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ) : (
            <>
              <span className={`font-semibold tabular-nums text-[14px] text-${accent}-400`}>
                {formatCurrency(item.total)}
              </span>
              {canPay && (
                <button
                  onClick={() => { setPayValue(''); setPaying(true) }}
                  disabled={saving}
                  className="w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 flex items-center justify-center transition-all disabled:opacity-30"
                  title="Registra pagamento"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                  </svg>
                </button>
              )}
              <button
                  onClick={() => { setEditValue(item.total.toString()); setEditing(true) }}
                  disabled={saving}
                  className="w-6 h-6 rounded-full bg-white/10 text-theme-text-muted hover:bg-white/20 flex items-center justify-center transition-all disabled:opacity-30"
                  title="Modifica importo"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              <button
                onClick={onDelete}
                disabled={saving}
                className={`w-6 h-6 rounded-full bg-${accent}-500/10 text-${accent}-400 hover:bg-${accent}-500/20 flex items-center justify-center transition-all disabled:opacity-30`}
                title="Elimina"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
