import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

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
  note: string
  date: string
  status: 'pending' | 'invoiced'
  fatturaNumero?: string
  arrayKey: 'penalties' | 'danni'
  arrayIndex: number // index in the booking_details array (for pending items)
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
          const entries: any[] = details[arrayKey] || []
          entries.forEach((entry: any, idx: number) => {
            const g = getOrCreate(b.customer_name || '', b.customer_email || '')
            const total = entry.total || (entry.amount || 0) * (entry.quantity || 1)
            const item: PenaltyDannoItem = {
              bookingId: b.id,
              bookingLabel,
              label: entry.label || entry.description || '—',
              amount: entry.amount || total,
              quantity: entry.quantity || 1,
              total,
              note: entry.note || '',
              date: entry.date || '',
              status: 'pending',
              arrayKey,
              arrayIndex: idx,
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
      for (const f of (fatture || [])) {
        if (!f.items || !Array.isArray(f.items)) continue
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
          const item: PenaltyDannoItem = {
            bookingId: f.booking_id || '',
            bookingLabel,
            label: desc,
            amount: fi.unit_price || total,
            quantity: fi.quantity || 1,
            total,
            note: '',
            date: '',
            status: 'invoiced',
            fatturaNumero: f.numero_fattura || undefined,
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
    } catch (err: any) {
      console.error('GestioneDanniTab load error:', err)
      setError(err.message || 'Errore nel caricamento dei dati.')
    } finally {
      setLoading(false)
    }
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

      toast.success(`${type === 'penali' ? 'Penali' : 'Danni'} eliminati`)
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
        const arr: any[] = [...(details[item.arrayKey] || [])]
        arr.splice(item.arrayIndex, 1)

        const { error: updateErr } = await supabase
          .from('bookings')
          .update({ booking_details: { ...details, [item.arrayKey]: arr } })
          .eq('id', item.bookingId)

        if (updateErr) throw updateErr
      } else if (item.status === 'invoiced' && item.bookingId) {
        // Remove from booking_details array by matching label/amount
        const { data: booking, error: fetchErr } = await supabase
          .from('bookings')
          .select('booking_details')
          .eq('id', item.bookingId)
          .single()

        if (fetchErr) throw fetchErr

        const details = booking?.booking_details || {}
        const arr: any[] = [...(details[item.arrayKey] || [])]
        // Find matching entry by label and amount
        const matchIdx = arr.findIndex((e: any) => {
          const entryLabel = e.label || e.description || ''
          const entryAmount = e.total || e.amount || 0
          return entryLabel === item.label && entryAmount === item.total
        })
        if (matchIdx >= 0) {
          arr.splice(matchIdx, 1)
          const { error: updateErr } = await supabase
            .from('bookings')
            .update({ booking_details: { ...details, [item.arrayKey]: arr } })
            .eq('id', item.bookingId)
          if (updateErr) throw updateErr
        }
        // Fattura is NOT touched
      }

      toast.success('Voce eliminata')
      setEditModal(null)
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Errore')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal: update amount of a pending item ─────────────────────────────────
  async function handleUpdateAmount(item: PenaltyDannoItem, newTotal: number) {
    if (item.status !== 'pending') return
    setSaving(true)
    try {
      const { data: booking, error: fetchErr } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', item.bookingId)
        .single()

      if (fetchErr) throw fetchErr

      const details = booking?.booking_details || {}
      const arr: any[] = [...(details[item.arrayKey] || [])]
      if (arr[item.arrayIndex]) {
        arr[item.arrayIndex] = { ...arr[item.arrayIndex], amount: newTotal, total: newTotal, quantity: 1 }
      }

      const { error: updateErr } = await supabase
        .from('bookings')
        .update({ booking_details: { ...details, [item.arrayKey]: arr } })
        .eq('id', item.bookingId)

      if (updateErr) throw updateErr

      toast.success('Importo aggiornato')
      setEditModal(null)
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
    } catch (err: any) {
      toast.error(err.message || 'Errore')
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
                        <div className="flex items-center justify-center gap-1">
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
                      <div className="flex items-center justify-center gap-1">
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
    </div>
  )
}

// ── Item Row subcomponent ────────────────────────────────────────────────────
function ItemRow({ item, accentColor, onDelete, onUpdateAmount, saving }: {
  item: PenaltyDannoItem
  accentColor: 'orange' | 'red'
  onDelete: () => void
  onUpdateAmount: (val: number) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(item.total.toString())

  const isPending = item.status === 'pending'
  const accent = accentColor === 'orange' ? 'orange' : 'red'

  function handleSaveEdit() {
    const val = parseFloat(editValue)
    if (isNaN(val) || val <= 0) return
    onUpdateAmount(val)
    setEditing(false)
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
          <div className="flex items-center gap-2 mt-1">
            {isPending ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 font-medium">Da saldare</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
                Fatturato{item.fatturaNumero ? ` — ${item.fatturaNumero}` : ''}
              </span>
            )}
            {item.date && <span className="text-[10px] text-theme-text-muted">{item.date}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
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
              {isPending && (
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
              )}
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
