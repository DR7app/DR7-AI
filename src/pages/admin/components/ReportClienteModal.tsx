/**
 * Report Cliente — Full customer profile modal
 * Shows KPIs, booking history, wallet, documents, risk score, economic chart
 */
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { listCardsFromMetadata } from '../../../utils/nexiCards'
import CustomerAddebitoButton from './CustomerAddebitoButton'
import CardDeleteButton from './CardDeleteButton'

interface ReportClienteProps {
  customerId: string
  onClose: () => void
}

interface CustomerData {
  id: string
  tipo_cliente: string
  nome?: string
  cognome?: string
  denominazione?: string
  email?: string
  telefono?: string
  codice_fiscale?: string
  partita_iva?: string
  indirizzo?: string
  numero_civico?: string
  citta_residenza?: string
  provincia_residenza?: string
  codice_postale?: string
  nazione?: string
  data_nascita?: string
  sesso?: string
  status_cliente?: string
  source?: string
  created_at: string
  user_id?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface BookingRecord { id: string; vehicle_name: string; vehicle_plate?: string; pickup_date: string; dropoff_date: string; status: string; payment_status: string; payment_method?: string; price_total: number; service_type?: string; booking_details?: any; created_at: string; booked_at?: string; appointment_date?: string }

interface WalletTx { id: string; amount: number; type?: string; transaction_type?: string; description: string; created_at: string; balance_after?: number }

interface WalletRecharge { id: string; recharge_amount: number | string; payment_status: string; created_at: string }

interface DocRecord { id: string; document_type: string; status: string; uploaded_at: string }

type TabId = 'stato' | 'anagrafica' | 'storico' | 'economica'

export default function ReportClienteModal({ customerId, onClose }: ReportClienteProps) {
  const [customer, setCustomer] = useState<CustomerData | null>(null)
  const [deletedCardIds, setDeletedCardIds] = useState<Set<string>>(new Set())
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([])
  const [interestAccruals, setInterestAccruals] = useState<{ accrual_date: string; principal_eur: number; accrual_eur: number; paid_out_at: string | null }[]>([])
  const [walletRecharges, setWalletRecharges] = useState<WalletRecharge[]>([])
  const [documents, setDocuments] = useState<DocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('stato')
  const [isDR7Club, setIsDR7Club] = useState(false)

  useEffect(() => {
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  async function loadAll() {
    setLoading(true)
    try {
      // Customer data
      const { data: cust } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
      setCustomer(cust)

      // Bookings — UNION across all three linkage paths (user_id, email,
      // booking_details.customer.customerId) and name fallback. Previously
      // the code used sequential fallback which silently dropped bookings
      // linked via email when the customer had a user_id set. For customers
      // with activity across multiple channels (website + admin-created),
      // that meant the Totale Speso / Noleggi / tier all under-reported.
      const userId = cust?.user_id
      const email = cust?.email
      const name = cust?.denominazione || (cust?.nome && cust?.cognome ? `${cust.nome} ${cust.cognome}` : null)

      const bookingQueries: Promise<{ data: BookingRecord[] | null }>[] = []
      if (userId) {
        bookingQueries.push(
          supabase.from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false }) as unknown as Promise<{ data: BookingRecord[] | null }>
        )
        bookingQueries.push(
          supabase.from('bookings').select('*').eq('booking_details->customer->>customerId', userId).order('created_at', { ascending: false }) as unknown as Promise<{ data: BookingRecord[] | null }>
        )
      }
      if (email) {
        bookingQueries.push(
          supabase.from('bookings').select('*').ilike('customer_email', email).order('created_at', { ascending: false }) as unknown as Promise<{ data: BookingRecord[] | null }>
        )
      }
      // Only fall back to name match when we have no other identifier — name
      // matching is noisy and can pick up unrelated bookings with the same
      // customer_name string.
      if (!userId && !email && name) {
        bookingQueries.push(
          supabase.from('bookings').select('*').eq('customer_name', name).order('created_at', { ascending: false }) as unknown as Promise<{ data: BookingRecord[] | null }>
        )
      }

      const results = await Promise.all(bookingQueries)
      const seen = new Set<string>()
      const allBookings: BookingRecord[] = []
      for (const { data } of results) {
        for (const b of (data || [])) {
          if (!b.id || seen.has(b.id)) continue
          seen.add(b.id)
          allBookings.push(b)
        }
      }
      allBookings.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setBookings(allBookings)

      // Wallet — check by user_id first, fallback to email lookup
      let walletUserId = userId
      if (!walletUserId && email) {
        // Try to find auth user by email to get their wallet
        const { data: authUser } = await supabase.from('user_credit_balance').select('user_id, balance').limit(100)
        if (authUser) {
          // Check auth.users via customers_extended user_id
          const { data: custWithUser } = await supabase.from('customers_extended').select('user_id').eq('email', email).not('user_id', 'is', null).maybeSingle()
          if (custWithUser?.user_id) walletUserId = custWithUser.user_id
        }
      }
      if (walletUserId) {
        const { data: bal } = await supabase.from('user_credit_balance').select('balance').eq('user_id', walletUserId).single()
        setWalletBalance(bal?.balance || 0)
        const { data: txs } = await supabase.from('credit_transactions').select('*').eq('user_id', walletUserId).order('created_at', { ascending: false }).limit(50)
        setWalletTxs(txs || [])

        // DR7 Club daily interest accruals (last 90 days). The cron
        // accrue-club-wallet-interest writes a row per day with 0.1% of
        // the card-paid principal; payout-club-wallet-interest stamps
        // paid_out_at on the 1st of each month.
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString().split('T')[0]
        const { data: accruals } = await supabase
          .from('wallet_interest_accruals')
          .select('accrual_date, principal_eur, accrual_eur, paid_out_at')
          .eq('user_id', walletUserId)
          .gte('accrual_date', ninetyDaysAgo)
          .order('accrual_date', { ascending: false })
        setInterestAccruals(accruals || [])

        // Wallet recharges (card-paid wallet top-ups). These — NOT the
        // booking payments made FROM the wallet — are what counts toward
        // DR7 Club tier, otherwise reward-funded bookings would compound
        // the tier.
        // Column is recharge_amount (euros, numeric), NOT amount — that was
        // the bug making the admin tier display show €0 recharges.
        const { data: purchases } = await supabase
          .from('credit_wallet_purchases')
          .select('id, recharge_amount, payment_status, created_at')
          .eq('user_id', walletUserId)
          .order('created_at', { ascending: false })
          .limit(200)
        setWalletRecharges(purchases || [])
      }

      // DR7 CLUB PRIVILEGE membership check — try the function first, then
      // fall back to a direct dr7_club_subscriptions query so the gate
      // resolves even when the list function is unreachable / RLS-blocked.
      let resolvedIsClub = false
      try {
        const clubRes = await fetch('/.netlify/functions/list-club-members')
        if (clubRes.ok) {
          const clubData = await clubRes.json()
          const members = clubData.members || []
          resolvedIsClub = members.some((m: { user_id?: string; email?: string }) =>
            (walletUserId && m.user_id === walletUserId) ||
            (email && m.email?.toLowerCase() === email.toLowerCase())
          )
        }
      } catch { /* function unreachable — fall through to direct query */ }
      if (!resolvedIsClub && walletUserId) {
        const { data: directSub } = await supabase
          .from('dr7_club_subscriptions')
          .select('id, status')
          .eq('user_id', walletUserId)
          .eq('status', 'active')
          .maybeSingle()
        if (directSub?.id) resolvedIsClub = true
      }
      setIsDR7Club(resolvedIsClub)

      // Documents
      const { data: docs } = await supabase.from('customer_documents').select('*').eq('customer_id', customerId)
      setDocuments(docs || [])
    } catch (err) {
      console.error('ReportCliente load error:', err)
    } finally {
      setLoading(false)
    }
  }

  // KPIs
  const kpis = useMemo(() => {
    const noleggi = bookings.filter(b => b.service_type !== 'car_wash' && b.service_type !== 'mechanical_service' && b.service_type !== 'mechanical')
    const lavaggi = bookings.filter(b => b.service_type === 'car_wash')
    const meccanica = bookings.filter(b => b.service_type === 'mechanical_service' || b.service_type === 'mechanical')

    const totalSpent = bookings.filter(b => b.payment_status === 'paid' || b.payment_status === 'succeeded' || b.payment_status === 'completed').reduce((s, b) => s + (b.price_total || 0), 0) / 100
    const cancelled = bookings.filter(b => b.status === 'cancelled' || b.status === 'annullata').length

    // Danni & Penali from booking_details
    let totalDanni = 0, totalPenali = 0, danniCount = 0, penaliCount = 0
    bookings.forEach(b => {
      const d = b.booking_details?.danni || []
      const p = b.booking_details?.penalties || []
      d.forEach((item: { amount?: number; total?: number }) => { totalDanni += (item.amount || item.total || 0); danniCount++ })
      p.forEach((item: { amount?: number; total?: number }) => { totalPenali += (item.amount || item.total || 0); penaliCount++ })
    })

    // Unpaid
    const unpaid = bookings.filter(b => b.payment_status === 'pending' || b.payment_status === 'unpaid' || b.payment_status === 'partial')
    const unpaidTotal = unpaid.reduce((s, b) => s + (b.price_total || 0), 0) / 100

    // Last activity
    const lastBooking = bookings[0]
    const lastDate = lastBooking ? new Date(lastBooking.created_at) : null

    // Payment punctuality (% paid on time — simplified: paid bookings / total non-cancelled)
    const completedBookings = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'annullata')
    const paidBookings = completedBookings.filter(b => b.payment_status === 'paid' || b.payment_status === 'succeeded' || b.payment_status === 'completed')
    const punctuality = completedBookings.length > 0 ? Math.round((paidBookings.length / completedBookings.length) * 100) : 100

    return {
      noleggiCount: noleggi.length, lavaggiCount: lavaggi.length, meccanicaCount: meccanica.length,
      totalSpent, cancelled, totalDanni, totalPenali, danniCount, penaliCount,
      unpaidTotal, lastDate, punctuality
    }
  }, [bookings])

  // DR7 Club tier — same thresholds used by website (utils/dr7club.ts).
  // Counts real CARD money entering DR7 in the rolling last 12 months.
  // Bookings paid from the wallet must NOT be counted, otherwise the
  // recharge that funded them would compound the tier.
  const clubTier = useMemo(() => {
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    const validStatuses = new Set(['succeeded', 'paid', 'completed'])

    // Recharges (credit_wallet_purchases.recharge_amount = euros paid on card)
    const recentRecharges = walletRecharges.filter(r => {
      if (!validStatuses.has(r.payment_status)) return false
      const when = r.created_at
      return when ? new Date(when) >= cutoff : false
    })
    const rechargeEur = recentRecharges.reduce((s, r) => {
      // recharge_amount is NUMERIC — arrives as string or number
      const raw = (r as { recharge_amount?: number | string }).recharge_amount
        ?? (r as { amount?: number | string }).amount // legacy fallback
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? 0))
      return s + (Number.isFinite(n) ? n : 0)
    }, 0)
    const rechargeCount = recentRecharges.length

    // Card-paid bookings only (exclude wallet / cash / bonifico / gift).
    const isCardPayment = (pm?: string) => {
      const m = (pm || '').toLowerCase().trim()
      if (!m) return false
      // Exclude wallet / gift / credit variants. Note: DB uses "credit" (bare)
      // for Credit Wallet in some rows — must be excluded even though the
      // admin UI label is "Credit Wallet".
      if (m === 'credit' || m === 'credito') return false
      if (m.includes('wallet') || m.includes('credit_wallet')) return false
      if (m.includes('contanti') || m.includes('cash')) return false
      if (m.includes('bonifico') || m.includes('wire') || m.includes('bank')) return false
      if (m.includes('gift')) return false
      return m.includes('card') || m.includes('carta') || m.includes('nexi')
        || m.includes('stripe') || m.includes('pos') || m.includes('pay by link')
        || m.includes('bancomat') || m.includes('debit')
    }
    const cardBookingCents = bookings
      .filter(b => {
        if (!validStatuses.has(b.payment_status)) return false
        if (!isCardPayment(b.payment_method)) return false
        // Exclude cancelled bookings
        if (b.status === 'cancelled' || b.status === 'annullata') return false
        const when = b.booked_at || b.created_at
        return when ? new Date(when) >= cutoff : false
      })
      .reduce((s, b) => s + (b.price_total || 0), 0)

    const cardBookingSpend = cardBookingCents / 100
    const rechargeSpend = rechargeEur
    const computed = cardBookingSpend + rechargeSpend

    // Per-user grandfathered override — absolute value, replaces the
    // computed figure entirely. Customers in this map display a specific
    // locked spend regardless of real activity.
    //   Massimo Runchina — locked to €3155.20 (pre-fix €2155.20 + €1000 card recharge)
    const TIER_SPEND_OVERRIDES: Record<string, number> = {
      '3b896d05-3d65-4819-a46a-ea9894343935': 3155.20,
    }
    const authUserId = customer?.user_id
    const override = authUserId ? TIER_SPEND_OVERRIDES[authUserId] : undefined
    const annualSpend = (typeof override === 'number') ? override : computed

    if (annualSpend >= 10000) {
      return { tier: 'signature', label: 'Signature', reward: 4, annualSpend, cardBookingSpend, rechargeSpend, rechargeCount, nextThreshold: null, badge: 'bg-amber-500/20 text-amber-400 border-amber-500/50' }
    }
    if (annualSpend >= 3000) {
      return { tier: 'black', label: 'Black', reward: 3, annualSpend, cardBookingSpend, rechargeSpend, rechargeCount, nextThreshold: 10000, badge: 'bg-zinc-900 text-white border-zinc-900' }
    }
    return { tier: 'access', label: 'Access', reward: 2, annualSpend, cardBookingSpend, rechargeSpend, rechargeCount, nextThreshold: 3000, badge: 'bg-gray-500/20 text-gray-300 border-gray-500/50' }
  }, [bookings, walletRecharges, customer?.user_id])

  // Risk / reliability score (0-10)
  const riskScore = useMemo(() => {
    let score = 10
    if (kpis.danniCount > 0) score -= Math.min(kpis.danniCount * 1.5, 4)
    if (kpis.penaliCount > 0) score -= Math.min(kpis.penaliCount, 2)
    if (kpis.cancelled > 2) score -= 1
    if (kpis.unpaidTotal > 100) score -= 1
    if (kpis.punctuality < 80) score -= 1
    return Math.max(0, Math.round(score * 10) / 10)
  }, [kpis])

  // Insight
  const insight = useMemo(() => {
    const status = customer?.status_cliente
    if (status === 'blacklist') return { label: 'Cliente in Blacklist', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' }
    if (status === 'elite') return { label: 'Cliente Elite — alto valore, basso rischio', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' }
    if (status === 'member') return { label: 'Cliente Member — fidelizzato', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' }
    if (riskScore >= 8 && kpis.totalSpent > 1000) return { label: 'Cliente affidabile con alto valore', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' }
    if (riskScore < 5) return { label: 'Attenzione: rischio elevato', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' }
    return { label: 'Cliente standard', color: 'text-theme-text-muted', bg: 'bg-theme-bg-tertiary border-theme-border' }
  }, [customer, riskScore, kpis])

  // Monthly spend for chart (last 6 months)
  const monthlyData = useMemo(() => {
    const months: { label: string; total: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })
      const monthBookings = bookings.filter(b => {
        const bd = new Date(b.created_at)
        return `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}` === key &&
          (b.payment_status === 'paid' || b.payment_status === 'succeeded' || b.payment_status === 'completed')
      })
      const total = monthBookings.reduce((s, b) => s + (b.price_total || 0), 0) / 100
      months.push({ label, total })
    }
    return months
  }, [bookings])

  const chartMax = Math.max(...monthlyData.map(m => m.total), 1)

  // Client Score: 0-100 derivato da riskScore (0-10)
  const clientScore = useMemo(() => Math.round(riskScore * 10), [riskScore])
  const clientScoreLabel = useMemo(() => {
    if (clientScore >= 90) return { label: 'Eccellente', color: '#22C55E' }
    if (clientScore >= 75) return { label: 'Ottimo', color: '#3B82F6' }
    if (clientScore >= 50) return { label: 'Discreto', color: '#F59E0B' }
    return { label: 'Critico', color: '#EF4444' }
  }, [clientScore])

  // Veicoli utilizzati — deduplicati da bookings (per plate quando presente,
  // altrimenti per nome). Conta utilizzi e tiene l'ultima data.
  const uniqueVehicles = useMemo(() => {
    const map = new Map<string, { name: string; plate: string | null; uses: number; lastUsed: string }>()
    for (const b of bookings) {
      if (!b.vehicle_name) continue
      const key = (b.vehicle_plate || b.vehicle_name).toLowerCase().trim()
      const existing = map.get(key)
      if (existing) {
        existing.uses++
        if (b.created_at > existing.lastUsed) existing.lastUsed = b.created_at
      } else {
        map.set(key, { name: b.vehicle_name, plate: b.vehicle_plate || null, uses: 1, lastUsed: b.created_at })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.uses - a.uses)
  }, [bookings])

  // Distribuzione spesa per servizio (per donut). Solo bookings pagati.
  const serviceBreakdown = useMemo(() => {
    let noleggio = 0, lavaggio = 0, meccanica = 0
    for (const b of bookings) {
      if (b.payment_status !== 'paid' && b.payment_status !== 'succeeded' && b.payment_status !== 'completed') continue
      const amt = (b.price_total || 0) / 100
      if (b.service_type === 'car_wash') lavaggio += amt
      else if (b.service_type === 'mechanical_service' || b.service_type === 'mechanical') meccanica += amt
      else noleggio += amt
    }
    const total = noleggio + lavaggio + meccanica
    const pct = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0
    return {
      total,
      slices: [
        { label: 'Noleggio', value: noleggio, pct: pct(noleggio), color: '#3B82F6' },
        { label: 'Lavaggio', value: lavaggio, pct: pct(lavaggio), color: '#06B6D4' },
        { label: 'Meccanica', value: meccanica, pct: pct(meccanica), color: '#A855F7' },
      ].filter(s => s.value > 0),
    }
  }, [bookings])

  // Alert & Notifiche derivati dai dati: documenti mancanti/scaduti, debiti,
  // periodo di inattivita', tokenizzazione assente. Niente mock.
  const alerts = useMemo(() => {
    const out: { level: 'info' | 'warn' | 'crit'; title: string; detail?: string }[] = []
    const eur = (v: number) => `€${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (kpis.unpaidTotal > 0) {
      out.push({ level: 'warn', title: 'Pagamenti pendenti', detail: `Da incassare ${eur(kpis.unpaidTotal)}` })
    }
    const docVerified = documents.some(d => d.status === 'verified')
    if (!docVerified) {
      out.push({ level: 'crit', title: 'Documenti non verificati', detail: 'Nessun documento verificato in archivio' })
    }
    if (kpis.lastDate) {
      const days = Math.floor((Date.now() - kpis.lastDate.getTime()) / 86400000)
      if (days > 180) out.push({ level: 'info', title: 'Cliente inattivo', detail: `Ultima attività ${days} giorni fa` })
    }
    if (!customer?.metadata?.nexi_contract_id) {
      out.push({ level: 'info', title: 'Carta non tokenizzata', detail: 'Nessun addebito automatico disponibile' })
    }
    if (kpis.danniCount > 0) {
      out.push({ level: 'warn', title: `${kpis.danniCount} ${kpis.danniCount === 1 ? 'danno' : 'danni'} registrati`, detail: eur(kpis.totalDanni) })
    }
    return out
  }, [kpis, documents, customer])

  const customerName = customer ? (customer.denominazione || `${customer.nome || ''} ${customer.cognome || ''}`.trim() || customer.email || 'N/A') : ''

  const statusBadge = (s?: string) => {
    switch (s) {
      case 'elite': return <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/50">Elite</span>
      case 'member': return <span className="px-2 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/50">Member</span>
      case 'blacklist': return <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/50">Blacklist</span>
      default: return <span className="px-2 py-1 rounded-full text-xs font-bold bg-theme-bg-tertiary text-theme-text-muted border border-theme-border">Standard</span>
    }
  }

  const fmtEur = (v: number) => `€${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('it-IT')
  const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))

  const docStatus = (type: string, legacy?: string) => {
    const doc = documents.find(d => d.document_type === type || (legacy ? d.document_type === legacy : false))
    if (!doc) return { label: 'Mancante', color: 'text-red-400' }
    if (doc.status === 'verified') return { label: 'Verificato', color: 'text-green-400' }
    if (doc.status === 'pending_verification') return { label: 'In attesa', color: 'text-yellow-400' }
    return { label: 'Rifiutato', color: 'text-red-400' }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-theme-bg-primary rounded-2xl p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-dr7-gold border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-theme-text-muted">Caricamento Report Cliente...</p>
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-theme-bg-primary rounded-2xl p-8 text-center">
          <p className="text-red-400">Cliente non trovato</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-lg">Chiudi</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-theme-bg-primary border border-theme-border rounded-2xl w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Hero Header — avatar + identita + 4 KPI cards */}
        <div className="relative shrink-0 border-b border-theme-border">
          <div className="absolute -top-12 -right-12 w-56 h-56 bg-dr7-gold/10 rounded-full blur-3xl pointer-events-none"/>
          <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"/>
          <div className="relative p-6 flex flex-col xl:flex-row xl:items-center gap-5 xl:gap-6">
            {/* Identità cliente */}
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="relative shrink-0">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-dr7-gold/30 to-dr7-gold/5 border border-dr7-gold/40 flex items-center justify-center text-3xl font-bold text-dr7-gold">
                  {(customer.nome?.[0] || customer.denominazione?.[0] || '?').toUpperCase()}
                </div>
                {clubTier.tier === 'signature' && (
                  <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-amber-400 border-2 border-theme-bg-primary flex items-center justify-center text-theme-bg-primary text-sm" title="Signature">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold text-theme-text-primary truncate">{customerName}</h2>
                  {statusBadge(customer.status_cliente)}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${clubTier.badge}`}>
                    {clubTier.label} · {clubTier.reward}%
                  </span>
                  {isDR7Club && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-dr7-gold/15 text-dr7-gold border border-dr7-gold/40 uppercase tracking-wide">DR7 Club</span>}
                </div>
                {customer.tipo_cliente === 'azienda' && customer.denominazione && (
                  <div className="text-sm text-theme-text-muted mt-0.5">{customer.denominazione}</div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-2 text-xs text-theme-text-muted">
                  {customer.email && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                      <span className="truncate">{customer.email}</span>
                    </div>
                  )}
                  {customer.telefono && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                      <span>{customer.telefono}</span>
                    </div>
                  )}
                  {customer.data_nascita && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                      <span>Nato il {fmtDate(customer.data_nascita)}</span>
                    </div>
                  )}
                  {customer.codice_fiscale && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0"/></svg>
                      <span className="truncate font-mono">{customer.codice_fiscale}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 col-span-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <span>Iscritto dal {fmtDate(customer.created_at)} · {daysSince(new Date(customer.created_at))} giorni</span>
                  </div>
                </div>
              </div>
            </div>

            {/* KPI cards a destra */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 xl:w-[640px] xl:shrink-0">
              {/* Client Score con anello */}
              <div className="relative rounded-xl border border-theme-border bg-theme-bg-secondary p-3 overflow-hidden">
                <div className="text-[9px] uppercase tracking-wider text-theme-text-muted font-semibold">Client Score</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="relative w-12 h-12 shrink-0">
                    <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.91549" fill="none" stroke="currentColor" strokeWidth="3" className="text-theme-bg-tertiary"/>
                      <circle
                        cx="18" cy="18" r="15.91549" fill="none" strokeWidth="3" strokeLinecap="round"
                        stroke={clientScoreLabel.color}
                        strokeDasharray={`${clientScore}, 100`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums" style={{ color: clientScoreLabel.color }}>{clientScore}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold" style={{ color: clientScoreLabel.color }}>{clientScoreLabel.label}</div>
                    <div className="text-[10px] text-theme-text-muted leading-tight">{Math.round((kpis.punctuality))}% puntualità</div>
                  </div>
                </div>
              </div>

              {/* Spesa Totale */}
              <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent p-3">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300/80 font-semibold">Spesa totale</div>
                <div className="text-lg font-bold text-emerald-400 mt-1 tabular-nums">{fmtEur(kpis.totalSpent)}</div>
                <div className="text-[10px] text-theme-text-muted mt-0.5">storico completo</div>
              </div>

              {/* Prenotazioni */}
              <div className="rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-transparent p-3">
                <div className="text-[9px] uppercase tracking-wider text-blue-300/80 font-semibold">Prenotazioni</div>
                <div className="text-lg font-bold text-blue-400 mt-1 tabular-nums">{bookings.length}</div>
                <div className="text-[10px] text-theme-text-muted mt-0.5">N {kpis.noleggiCount} · L {kpis.lavaggiCount} · M {kpis.meccanicaCount}</div>
              </div>

              {/* Ultimo Servizio */}
              <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-transparent p-3">
                <div className="text-[9px] uppercase tracking-wider text-purple-300/80 font-semibold">Ultimo servizio</div>
                <div className="text-sm font-bold text-purple-300 mt-1">{kpis.lastDate ? fmtDate(kpis.lastDate.toISOString()) : '—'}</div>
                <div className="text-[10px] text-theme-text-muted mt-0.5">{kpis.lastDate ? `${daysSince(kpis.lastDate)} giorni fa` : 'mai'}</div>
              </div>
            </div>

            <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-theme-bg-tertiary hover:bg-theme-bg-hover flex items-center justify-center text-theme-text-muted">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* DR7 Club tier progress — same panel as the customer sees on website */}
        {(() => {
          const nextLabel = clubTier.nextThreshold === 10000 ? 'Signature' : 'Black'
          const nextThr = clubTier.nextThreshold
          const prevThr = clubTier.tier === 'access' ? 0 : clubTier.tier === 'black' ? 3000 : 10000
          const progress = nextThr
            ? Math.min(100, Math.max(0, Math.round(((clubTier.annualSpend - prevThr) / (nextThr - prevThr)) * 100)))
            : 100
          const progressColor =
            clubTier.tier === 'signature' ? 'bg-amber-400' :
            clubTier.tier === 'black' ? 'bg-zinc-900' : 'bg-dr7-gold'
          return (
            <div className="px-6 py-4 border-b border-theme-border shrink-0">
              <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${clubTier.badge}`}>
                      {clubTier.label}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-theme-text-primary">Livello {clubTier.label}</div>
                      <div className="text-xs text-theme-text-muted">Reward: {clubTier.reward}% su ogni noleggio</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-theme-text-muted">Pagato con carta · 12m</div>
                    <div className="text-lg font-bold text-theme-text-primary tabular-nums">{fmtEur(clubTier.annualSpend)}</div>
                    <div className="text-[11px] text-theme-text-muted tabular-nums">
                      Prenotazioni {fmtEur(clubTier.cardBookingSpend)} · Ricariche {fmtEur(clubTier.rechargeSpend)} ({clubTier.rechargeCount})
                    </div>
                  </div>
                </div>
                {nextThr ? (
                  <>
                    <div className="flex justify-between text-[11px] text-theme-text-muted mb-1">
                      <span>Livello {clubTier.label}</span>
                      <span>Livello {nextLabel} ({fmtEur(nextThr)})</span>
                    </div>
                    <div className="h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
                      <div className={`h-full ${progressColor} transition-all`} style={{ width: `${progress}%` }} />
                    </div>
                    <div className="text-xs text-theme-text-muted mt-2 text-center">
                      Mancano <span className="font-semibold text-theme-text-primary">{fmtEur(Math.max(0, nextThr - clubTier.annualSpend))}</span> per il livello successivo
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-amber-400 text-center font-medium">
                    🏆 Livello massimo raggiunto
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div className={`rounded-lg border px-2 py-1.5 text-center ${clubTier.tier === 'access' ? 'border-gray-400/60 bg-gray-500/10' : 'border-theme-border bg-theme-bg-tertiary/40'}`}>
                    <div className="text-[11px] font-semibold text-theme-text-primary">Access</div>
                    <div className="text-[10px] text-theme-text-muted">€0 – €2.999</div>
                    <div className="text-[10px] text-theme-text-muted">2% reward</div>
                  </div>
                  <div className={`rounded-lg border px-2 py-1.5 text-center ${clubTier.tier === 'black' ? 'border-zinc-900/70 bg-zinc-900/10' : 'border-theme-border bg-theme-bg-tertiary/40'}`}>
                    <div className="text-[11px] font-semibold text-theme-text-primary">Black</div>
                    <div className="text-[10px] text-theme-text-muted">€3.000 – €9.999</div>
                    <div className="text-[10px] text-theme-text-muted">3% reward</div>
                  </div>
                  <div className={`rounded-lg border px-2 py-1.5 text-center ${clubTier.tier === 'signature' ? 'border-amber-400/60 bg-amber-500/10' : 'border-theme-border bg-theme-bg-tertiary/40'}`}>
                    <div className="text-[11px] font-semibold text-theme-text-primary">Signature</div>
                    <div className="text-[10px] text-theme-text-muted">da €10.000</div>
                    <div className="text-[10px] text-theme-text-muted">4% reward</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Secondary stats — wallet, debiti, penali, danni, annullate */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-6 py-3 border-b border-theme-border shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-theme-text-muted">Wallet:</span>
            <span className="font-bold text-dr7-gold tabular-nums">{fmtEur(walletBalance)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-theme-text-muted">Debiti:</span>
            <span className={`font-bold tabular-nums ${kpis.unpaidTotal > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fmtEur(kpis.unpaidTotal)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-theme-text-muted">Penali:</span>
            <span className="font-bold text-yellow-400 tabular-nums">{fmtEur(kpis.totalPenali)} <span className="text-theme-text-muted font-normal">({kpis.penaliCount})</span></span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-theme-text-muted">Danni:</span>
            <span className="font-bold text-red-400 tabular-nums">{fmtEur(kpis.totalDanni)} <span className="text-theme-text-muted font-normal">({kpis.danniCount})</span></span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-theme-text-muted">Annullate:</span>
            <span className="font-bold text-theme-text-primary tabular-nums">{kpis.cancelled}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-border px-6 shrink-0">
          {([['stato', 'Stato Cliente'], ['anagrafica', 'Dati Anagrafici'], ['storico', 'Storico Attivita'], ['economica', 'Sezione Economica']] as [TabId, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === id ? 'border-dr7-gold text-dr7-gold' : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'}`}
            >{label}</button>
          ))}
        </div>

        {/* Tab Content + Right Sidebar */}
        <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-6 min-w-0">

          {/* STATO CLIENTE */}
          {activeTab === 'stato' && (
            <div className="space-y-6">
              {/* Distribuzione Spesa per Servizio + Veicoli Utilizzati */}
              {(serviceBreakdown.total > 0 || uniqueVehicles.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Donut: Distribuzione Spesa per Servizio */}
                  {serviceBreakdown.total > 0 && (
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Distribuzione spesa per servizio</h3>
                        <span className="text-[10px] text-theme-text-muted">solo pagati</span>
                      </div>
                      <div className="flex items-center gap-4">
                        {(() => {
                          const r = 15.91549
                          let offset = 0
                          return (
                            <div className="relative w-32 h-32 shrink-0">
                              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-theme-bg-tertiary"/>
                                {serviceBreakdown.slices.map((s, i) => {
                                  const dash = `${s.pct}, 100`
                                  const el = (
                                    <circle
                                      key={i}
                                      cx="18" cy="18" r={r}
                                      fill="none" strokeWidth="4"
                                      stroke={s.color}
                                      strokeDasharray={dash}
                                      strokeDashoffset={-offset}
                                    />
                                  )
                                  offset += s.pct
                                  return el
                                })}
                              </svg>
                              <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <div className="text-[10px] text-theme-text-muted">Totale</div>
                                <div className="text-base font-bold text-theme-text-primary tabular-nums">{fmtEur(serviceBreakdown.total)}</div>
                              </div>
                            </div>
                          )
                        })()}
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {serviceBreakdown.slices.map((s, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }}/>
                              <span className="text-theme-text-secondary flex-1 truncate">{s.label}</span>
                              <span className="text-theme-text-primary font-bold tabular-nums">{s.pct}%</span>
                              <span className="text-theme-text-muted tabular-nums w-16 text-right">{fmtEur(s.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Veicoli Utilizzati */}
                  {uniqueVehicles.length > 0 && (
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Veicoli utilizzati</h3>
                        <span className="text-[10px] text-theme-text-muted">{uniqueVehicles.length} {uniqueVehicles.length === 1 ? 'veicolo' : 'veicoli'}</span>
                      </div>
                      <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                        {uniqueVehicles.slice(0, 6).map((v, i) => (
                          <div key={i} className="flex items-center gap-3 rounded-xl border border-theme-border bg-theme-bg-primary/50 p-2">
                            <div className="w-12 h-10 rounded-lg bg-gradient-to-br from-dr7-gold/20 to-dr7-gold/5 border border-dr7-gold/20 grid place-items-center shrink-0">
                              <svg className="w-6 h-5 text-dr7-gold" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M3 17v-2.5C3 13.12 4.12 12 5.5 12h13c1.38 0 2.5 1.12 2.5 2.5V17h-2v2a1 1 0 01-1 1h-1a1 1 0 01-1-1v-2H8v2a1 1 0 01-1 1H6a1 1 0 01-1-1v-2H3zm2-3a.75.75 0 100 1.5.75.75 0 000-1.5zm14 0a.75.75 0 100 1.5.75.75 0 000-1.5zM6.5 5h11l1.5 5H5l1.5-5z"/>
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-theme-text-primary truncate">{v.name}</div>
                              <div className="text-[10px] text-theme-text-muted flex items-center gap-1.5">
                                {v.plate && <span className="font-mono uppercase">{v.plate}</span>}
                                {v.plate && <span>·</span>}
                                <span>{v.uses} {v.uses === 1 ? 'utilizzo' : 'utilizzi'}</span>
                              </div>
                            </div>
                            <div className="text-[10px] text-theme-text-muted whitespace-nowrap text-right">
                              ultimo<br/>{fmtDate(v.lastUsed)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: Activity table */}
              <div className="lg:col-span-2 space-y-4">
                {/* DR7 Club daily interest accrual — visible at the TOP for
                    every club member so admin sees it without digging into
                    the Storico tab. Shows a placeholder when the cron
                    hasn't fired yet so admin knows the gear is configured. */}
                {isDR7Club && (() => {
                  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
                  const todayRow = interestAccruals.find(a => a.accrual_date === today)
                  const month = today.slice(0, 7) // YYYY-MM
                  const monthAccruals = interestAccruals.filter(a => a.accrual_date.startsWith(month))
                  const monthUnpaid = monthAccruals.filter(a => !a.paid_out_at).reduce((s, a) => s + Number(a.accrual_eur || 0), 0)
                  const monthTotal = monthAccruals.reduce((s, a) => s + Number(a.accrual_eur || 0), 0)
                  return (
                    <div className="rounded-xl border border-dr7-gold/40 bg-dr7-gold/5 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-dr7-gold uppercase tracking-wider">
                          DR7 CLUB PRIVILEGE — Interesse Wallet (0,1%/giorno)
                        </h3>
                        <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                          Pagamento il 1° del mese
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <div>
                          <div className="text-[10px] text-theme-text-muted uppercase">Maturato OGGI</div>
                          <div className="text-xl font-bold text-dr7-gold">
                            {todayRow ? `+${fmtEur(Number(todayRow.accrual_eur))}` : '—'}
                          </div>
                          <div className="text-[10px] text-theme-text-muted">
                            {todayRow ? `su €${Number(todayRow.principal_eur).toFixed(2)}` : 'cron non ancora eseguito'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-theme-text-muted uppercase">Mese in corso (in attesa)</div>
                          <div className="text-xl font-bold text-amber-400">
                            +{fmtEur(Math.round(monthUnpaid * 100) / 100)}
                          </div>
                          <div className="text-[10px] text-theme-text-muted">{monthAccruals.length} giorni</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-theme-text-muted uppercase">Totale mese</div>
                          <div className="text-xl font-bold text-green-400">
                            +{fmtEur(Math.round(monthTotal * 100) / 100)}
                          </div>
                          <div className="text-[10px] text-theme-text-muted">incl. già pagati</div>
                        </div>
                      </div>
                      {interestAccruals.length === 0 ? (
                        <p className="text-xs text-theme-text-muted italic">
                          Nessuna riga di accrediti ancora. Il cron giornaliero scrive la prima riga la notte successiva all'iscrizione al club.
                        </p>
                      ) : (
                        <div className="bg-theme-bg-secondary/50 rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-theme-border/50">
                                <th className="px-3 py-1.5 text-left text-theme-text-muted font-medium">Data</th>
                                <th className="px-3 py-1.5 text-right text-theme-text-muted font-medium">Capitale</th>
                                <th className="px-3 py-1.5 text-right text-theme-text-muted font-medium">Interesse</th>
                                <th className="px-3 py-1.5 text-right text-theme-text-muted font-medium">Stato</th>
                              </tr>
                            </thead>
                            <tbody>
                              {interestAccruals.slice(0, 14).map(a => (
                                <tr key={a.accrual_date} className="border-b border-theme-border/30">
                                  <td className="px-3 py-1.5 text-theme-text-muted whitespace-nowrap">{a.accrual_date}</td>
                                  <td className="px-3 py-1.5 text-right text-theme-text-secondary">{fmtEur(Number(a.principal_eur))}</td>
                                  <td className="px-3 py-1.5 text-right font-bold text-dr7-gold">+{fmtEur(Number(a.accrual_eur))}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    {a.paid_out_at
                                      ? <span className="text-green-400">Pagato</span>
                                      : <span className="text-amber-400">In attesa</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {interestAccruals.length > 14 && (
                            <div className="px-3 py-1.5 text-[10px] text-theme-text-muted border-t border-theme-border/30">
                              +{interestAccruals.length - 14} altri giorni — vedi tab Storico per la lista completa
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
                <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Storico Prenotazioni</h3>
                <div className="bg-theme-bg-secondary rounded-xl border border-theme-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Data</th>
                        <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Attivita</th>
                        <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Importo</th>
                        <th className="px-3 py-2 text-center text-theme-text-muted font-medium">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.slice(0, 20).map(b => (
                        <tr key={b.id} className="border-b border-theme-border/50 hover:bg-theme-bg-tertiary/50">
                          <td className="px-3 py-2 text-theme-text-muted whitespace-nowrap">{fmtDate(b.appointment_date || b.pickup_date || b.created_at)}</td>
                          <td className="px-3 py-2 text-theme-text-primary">
                            <div>{b.vehicle_name || b.booking_details?.serviceName || '-'}</div>
                            {b.vehicle_plate && <div className="text-xs text-theme-text-muted">{b.vehicle_plate}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-theme-text-primary">{fmtEur((b.price_total || 0) / 100)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              b.payment_status === 'paid' || b.payment_status === 'succeeded' || b.payment_status === 'completed'
                                ? 'bg-green-500/20 text-green-400'
                                : b.status === 'cancelled' || b.status === 'annullata'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {b.payment_status === 'paid' || b.payment_status === 'succeeded' || b.payment_status === 'completed' ? 'Pagato'
                                : b.status === 'cancelled' || b.status === 'annullata' ? 'Annullato'
                                : 'In Attesa'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {bookings.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-theme-text-muted">Nessuna prenotazione</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right: Documents + Risk + Insight */}
              <div className="space-y-4">
                {/* Carta Tokenizzata Nexi — mirrors the "Carte Tokenizzate" block in Tab Nexi,
                    filtered to this single customer. Source: customers_extended.metadata. */}
                {(() => {
                  const m = customer.metadata || {}
                  const contractId: string = m.nexi_contract_id || ''
                  if (!contractId) {
                    return (
                      <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                        <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-2">Carta Tokenizzata</h4>
                        <p className="text-xs text-theme-text-muted">Nessuna carta tokenizzata su file</p>
                      </div>
                    )
                  }
                  const maskedPan: string = m.nexi_card_masked_pan || ''
                  const circuit: string = m.nexi_card_circuit || ''
                  const cardType: string = m.nexi_card_type || ''
                  const updated: string = m.nexi_contract_updated || ''
                  return (
                    <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                      <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Carta Tokenizzata</h4>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {maskedPan && (
                          <span className="font-mono text-sm text-theme-text-primary">{maskedPan}</span>
                        )}
                        {circuit && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-dr7-gold/10 text-dr7-gold border-dr7-gold/30 uppercase">
                            {circuit}
                          </span>
                        )}
                        {cardType && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${
                            cardType === 'credit' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' :
                            cardType === 'debit' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
                            cardType === 'prepaid' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                            'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                          }`}>
                            {cardType}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-theme-text-muted">
                        <span className="font-mono">ID: ...{contractId.slice(-8)}</span>
                        {updated && <span className="ml-2">{fmtDate(updated)}</span>}
                      </div>
                    </div>
                  )
                })()}

                {/* Documenti */}
                <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                  <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Documenti</h4>
                  <div className="space-y-2">
                    {[
                      { type: 'identity_document_front', label: 'Carta Identita Fronte', legacy: 'identity_document' },
                      { type: 'identity_document_back', label: 'Carta Identita Retro' },
                      { type: 'drivers_license_front', label: 'Patente Fronte', legacy: 'drivers_license' },
                      { type: 'drivers_license_back', label: 'Patente Retro' },
                      { type: 'codice_fiscale_front', label: 'Codice Fiscale Fronte' },
                      { type: 'codice_fiscale_back', label: 'Codice Fiscale Retro' },
                      { type: 'libretto_front', label: 'Libretto Fronte' },
                      { type: 'libretto_back', label: 'Libretto Retro' },
                    ].map(({ type, label, legacy }) => {
                      const s = docStatus(type, legacy)
                      return (
                        <div key={type} className="flex items-center justify-between text-sm">
                          <span className="text-theme-text-primary">{label}</span>
                          <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Affidabilita / Rischio */}
                <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                  <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Affidabilita / Rischio</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-theme-text-muted">Punteggio</span><span className={`font-bold ${riskScore >= 7 ? 'text-green-400' : riskScore >= 4 ? 'text-yellow-400' : 'text-red-400'}`}>{riskScore}/10</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Puntualita Pagamenti</span><span className="text-theme-text-primary font-medium">{kpis.punctuality}%</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Danni Generati</span><span className="text-theme-text-primary font-medium">{kpis.danniCount}</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Penali Pagate</span><span className="text-theme-text-primary font-medium">{kpis.penaliCount}</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Totale Annullate</span><span className="text-theme-text-primary font-medium">{kpis.cancelled}</span></div>
                  </div>
                </div>

                {/* Insight */}
                <div className={`rounded-xl border p-4 ${insight.bg}`}>
                  <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-2">Insight</h4>
                  <p className={`text-sm font-medium ${insight.color}`}>{insight.label}</p>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* DATI ANAGRAFICI */}
          {activeTab === 'anagrafica' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4 space-y-3">
                <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-2">Anagrafica</h4>
                {customer.tipo_cliente === 'persona_fisica' && (
                  <>
                    <Row label="Nome" value={`${customer.nome || ''} ${customer.cognome || ''}`} />
                    <Row label="Data di Nascita" value={customer.data_nascita ? fmtDate(customer.data_nascita) : '-'} />
                    <Row label="Sesso" value={customer.sesso || '-'} />
                    <Row label="Codice Fiscale" value={customer.codice_fiscale || '-'} />
                  </>
                )}
                {customer.tipo_cliente === 'azienda' && (
                  <>
                    <Row label="Denominazione" value={customer.denominazione || '-'} />
                    <Row label="Partita IVA" value={customer.partita_iva || '-'} />
                    <Row label="Codice Fiscale" value={customer.codice_fiscale || '-'} />
                  </>
                )}
                <Row label="Email" value={customer.email || '-'} />
                <Row label="Telefono" value={customer.telefono || '-'} />
                <Row label="Nazione" value={customer.nazione || '-'} />
              </div>
              <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4 space-y-3">
                <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-2">Indirizzo</h4>
                <Row label="Via" value={customer.indirizzo || '-'} />
                <Row label="N. Civico" value={customer.numero_civico || '-'} />
                <Row label="Citta" value={customer.citta_residenza || '-'} />
                <Row label="Provincia" value={customer.provincia_residenza || '-'} />
                <Row label="CAP" value={customer.codice_postale || '-'} />
                <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mt-4 mb-2">Registrazione</h4>
                <Row label="Data iscrizione" value={fmtDate(customer.created_at)} />
                <Row label="Origine" value={customer.source === 'admin' ? 'Admin' : 'Website'} />
                <Row label="Tipo" value={customer.tipo_cliente?.replace('_', ' ') || '-'} />
              </div>
            </div>
          )}

          {/* STORICO ATTIVITA */}
          {activeTab === 'storico' && (
            <div className="space-y-6">
              {/* DR7 Club — interest accruals (0.1%/giorno) */}
              {isDR7Club && interestAccruals.length > 0 && (() => {
                const totalUnpaid = interestAccruals.filter(a => !a.paid_out_at).reduce((s, a) => s + Number(a.accrual_eur || 0), 0)
                const totalPaid = interestAccruals.filter(a => a.paid_out_at).reduce((s, a) => s + Number(a.accrual_eur || 0), 0)
                return (
                  <div>
                    <h3 className="text-sm font-bold text-dr7-gold uppercase tracking-wider mb-3">
                      DR7 CLUB PRIVILEGE — Interesse Wallet (0,1%/giorno)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div className="rounded-lg border border-dr7-gold/40 bg-dr7-gold/5 p-3">
                        <div className="text-xs text-theme-text-muted">Maturato — non ancora pagato</div>
                        <div className="text-2xl font-bold text-dr7-gold">{fmtEur(Math.round(totalUnpaid * 100) / 100)}</div>
                        <div className="text-[10px] text-theme-text-muted mt-1">Pagamento il 1° del mese successivo</div>
                      </div>
                      <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
                        <div className="text-xs text-theme-text-muted">Totale pagato (ultimi 90gg)</div>
                        <div className="text-2xl font-bold text-green-400">{fmtEur(Math.round(totalPaid * 100) / 100)}</div>
                      </div>
                    </div>
                    <div className="bg-theme-bg-secondary rounded-xl border border-theme-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-theme-border">
                            <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Data</th>
                            <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Capitale (carta)</th>
                            <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Interesse</th>
                            <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Stato</th>
                          </tr>
                        </thead>
                        <tbody>
                          {interestAccruals.slice(0, 31).map(a => (
                            <tr key={a.accrual_date} className="border-b border-theme-border/50">
                              <td className="px-3 py-2 text-theme-text-muted whitespace-nowrap">{a.accrual_date}</td>
                              <td className="px-3 py-2 text-right text-theme-text-secondary">{fmtEur(Number(a.principal_eur))}</td>
                              <td className="px-3 py-2 text-right font-medium text-dr7-gold">+{fmtEur(Number(a.accrual_eur))}</td>
                              <td className="px-3 py-2 text-right text-xs">
                                {a.paid_out_at
                                  ? <span className="text-green-400">Pagato</span>
                                  : <span className="text-amber-400">In attesa</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Wallet transactions */}
              {walletTxs.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Movimenti Wallet</h3>
                  <div className="bg-theme-bg-secondary rounded-xl border border-theme-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-border">
                          <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Data</th>
                          <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Descrizione</th>
                          <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Importo</th>
                          <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walletTxs.map(tx => (
                          <tr key={tx.id} className="border-b border-theme-border/50">
                            <td className="px-3 py-2 text-theme-text-muted whitespace-nowrap">{fmtDate(tx.created_at)}</td>
                            <td className="px-3 py-2 text-theme-text-primary">{tx.description}</td>
                            <td className={`px-3 py-2 text-right font-medium ${(tx.type || tx.transaction_type) === 'credit' ? 'text-green-400' : 'text-red-400'}`}>
                              {(tx.type || tx.transaction_type) === 'credit' ? '+' : '-'}{fmtEur(Math.abs(tx.amount))}
                            </td>
                            <td className="px-3 py-2 text-right text-theme-text-muted">{tx.balance_after != null ? fmtEur(tx.balance_after) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* All bookings (full) */}
              <div>
                <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Tutte le Prenotazioni ({bookings.length})</h3>
                <div className="bg-theme-bg-secondary rounded-xl border border-theme-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Data</th>
                        <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Tipo</th>
                        <th className="px-3 py-2 text-left text-theme-text-muted font-medium">Veicolo/Servizio</th>
                        <th className="px-3 py-2 text-right text-theme-text-muted font-medium">Importo</th>
                        <th className="px-3 py-2 text-center text-theme-text-muted font-medium">Pagamento</th>
                        <th className="px-3 py-2 text-center text-theme-text-muted font-medium">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map(b => (
                        <tr key={b.id} className="border-b border-theme-border/50 hover:bg-theme-bg-tertiary/50">
                          <td className="px-3 py-2 text-theme-text-muted whitespace-nowrap">{fmtDate(b.appointment_date || b.pickup_date || b.created_at)}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              b.service_type === 'car_wash' ? 'bg-cyan-500/20 text-cyan-400'
                              : b.service_type === 'mechanical_service' || b.service_type === 'mechanical' ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-blue-500/20 text-blue-400'
                            }`}>{b.service_type === 'car_wash' ? 'Wash' : b.service_type === 'mechanical_service' || b.service_type === 'mechanical' ? 'Mecc' : 'Noleggio'}</span>
                          </td>
                          <td className="px-3 py-2 text-theme-text-primary">{b.vehicle_name || b.booking_details?.serviceName || '-'}</td>
                          <td className="px-3 py-2 text-right font-medium text-theme-text-primary">{fmtEur((b.price_total || 0) / 100)}</td>
                          <td className="px-3 py-2 text-center text-xs text-theme-text-muted">{b.payment_method || '-'}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              b.status === 'confirmed' || b.status === 'completed' || b.status === 'completata' ? 'bg-green-500/20 text-green-400'
                              : b.status === 'cancelled' || b.status === 'annullata' ? 'bg-red-500/20 text-red-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                            }`}>{b.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SEZIONE ECONOMICA */}
          {activeTab === 'economica' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart */}
              <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-4">Fatturato Ultimi 6 Mesi</h4>
                <div className="flex items-end gap-2 h-48">
                  {monthlyData.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                      <div className="text-xs text-theme-text-muted mb-1">{m.total > 0 ? fmtEur(m.total) : ''}</div>
                      <div className="w-full bg-dr7-gold/80 rounded-t transition-all" style={{ height: `${Math.max(2, (m.total / chartMax) * 100)}%` }} />
                      <div className="text-xs text-theme-text-muted mt-2">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="space-y-4">
                <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                  <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Riepilogo Economico</h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-theme-text-muted">Totale Fatturato</span><span className="font-bold text-green-400">{fmtEur(kpis.totalSpent)}</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Wallet Creditato</span><span className="font-bold text-dr7-gold">{fmtEur(walletBalance)}</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Debiti in Sospeso</span><span className={`font-bold ${kpis.unpaidTotal > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmtEur(kpis.unpaidTotal)}</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Penali Totali</span><span className="font-bold text-yellow-400">{fmtEur(kpis.totalPenali)}</span></div>
                    <div className="flex justify-between"><span className="text-theme-text-muted">Danni Totali</span><span className="font-bold text-red-400">{fmtEur(kpis.totalDanni)}</span></div>
                  </div>
                </div>

                {/* Wallet balance card */}
                <div className="bg-dr7-gold/10 rounded-xl border border-dr7-gold/30 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-theme-text-muted">Saldo Wallet Attuale</div>
                      <div className="text-2xl font-bold text-dr7-gold">{fmtEur(walletBalance)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-theme-text-muted">Transazioni</div>
                      <div className="text-lg font-bold text-theme-text-primary">{walletTxs.length}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

          {/* Right Sidebar — Azioni / Alert / Insight / Documenti */}
          <aside className="hidden xl:flex flex-col w-80 shrink-0 border-l border-theme-border overflow-y-auto bg-theme-bg-secondary/30">
            <div className="p-4 space-y-4">
              {/* Azioni Rapide */}
              <div className="rounded-xl border border-theme-border bg-theme-bg-primary p-3">
                <h3 className="text-[10px] font-bold text-theme-text-primary uppercase tracking-wider mb-2.5">Azioni Rapide</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {customer.telefono && (
                    <a
                      href={`https://wa.me/${customer.telefono.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors text-center"
                    >
                      <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      <span className="text-[10px] font-medium text-theme-text-primary">WhatsApp</span>
                    </a>
                  )}
                  {customer.email && (
                    <a
                      href={`mailto:${customer.email}`}
                      className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/15 transition-colors text-center"
                    >
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                      <span className="text-[10px] font-medium text-theme-text-primary">Email</span>
                    </a>
                  )}
                  {customer.telefono && (
                    <a
                      href={`tel:${customer.telefono}`}
                      className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/15 transition-colors text-center"
                    >
                      <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                      <span className="text-[10px] font-medium text-theme-text-primary">Chiama</span>
                    </a>
                  )}
                  <button
                    onClick={() => navigator.clipboard?.writeText(customer.email || customer.telefono || '')}
                    className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/15 transition-colors text-center"
                  >
                    <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                    <span className="text-[10px] font-medium text-theme-text-primary">Copia contatto</span>
                  </button>
                </div>
              </div>

              {/* Alert & Notifiche */}
              <div className="rounded-xl border border-theme-border bg-theme-bg-primary p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-[10px] font-bold text-theme-text-primary uppercase tracking-wider">Alert & Notifiche</h3>
                  {alerts.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold">{alerts.length}</span>
                  )}
                </div>
                {alerts.length === 0 ? (
                  <div className="text-xs text-theme-text-muted py-2">Nessuna notifica attiva</div>
                ) : (
                  <div className="space-y-1.5">
                    {alerts.map((a, i) => {
                      const colors = a.level === 'crit'
                        ? 'border-red-500/30 bg-red-500/5 text-red-400'
                        : a.level === 'warn'
                        ? 'border-amber-500/30 bg-amber-500/5 text-amber-400'
                        : 'border-blue-500/30 bg-blue-500/5 text-blue-400'
                      return (
                        <div key={i} className={`rounded-lg border p-2 ${colors}`}>
                          <div className="text-xs font-semibold leading-tight">{a.title}</div>
                          {a.detail && <div className="text-[10px] mt-0.5 text-theme-text-muted">{a.detail}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Insight */}
              <div className="rounded-xl border border-theme-border bg-theme-bg-primary p-3">
                <h3 className="text-[10px] font-bold text-theme-text-primary uppercase tracking-wider mb-2.5">Insight</h3>
                <div className={`rounded-lg border p-2.5 ${insight.bg}`}>
                  <div className={`text-xs font-semibold ${insight.color}`}>{insight.label}</div>
                  <div className="text-[10px] text-theme-text-muted mt-1">
                    Risk score {riskScore}/10 · Punctuality {kpis.punctuality}%
                  </div>
                </div>
              </div>

              {/* Documenti */}
              <div className="rounded-xl border border-theme-border bg-theme-bg-primary p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-[10px] font-bold text-theme-text-primary uppercase tracking-wider">Documenti</h3>
                  <span className="text-[10px] text-theme-text-muted">{documents.length} archiviati</span>
                </div>
                <div className="space-y-1.5">
                  {[
                    { type: 'patente', label: 'Patente' },
                    { type: 'carta_identita', label: 'Carta identità' },
                    { type: 'codice_fiscale', label: 'Codice fiscale' },
                    { type: 'passaporto', label: 'Passaporto' },
                  ].map(d => {
                    const status = docStatus(d.type)
                    return (
                      <div key={d.type} className="flex items-center justify-between text-xs">
                        <span className="text-theme-text-secondary">{d.label}</span>
                        <span className={`font-semibold ${status.color}`}>{status.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Carte tokenizzate (multi-carta) — ogni carta ha il bottone
                  Addebita (debito reale, non pre-autorizzazione). */}
              {(() => {
                const cards = listCardsFromMetadata(customer.metadata).filter(c => !deletedCardIds.has(c.contractId))
                if (cards.length === 0) return null
                return (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        {cards.length > 1 ? `Carte su file (${cards.length})` : 'Carta su file'}
                      </h3>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase">Tokenizzata</span>
                    </div>
                    {cards.map((card) => (
                      <div key={card.contractId} className="border-t border-emerald-500/15 pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-sm text-theme-text-primary truncate">
                              {card.maskedPan || '•••• •••• •••• ••••'}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-theme-text-muted">
                              {card.isDefault && <span className="px-1.5 py-0.5 rounded bg-dr7-gold/15 text-dr7-gold border border-dr7-gold/30 uppercase font-bold">Predefinita</span>}
                              {card.circuit && <span className="uppercase">{card.circuit}</span>}
                              {card.cardType && <span className="text-theme-text-muted/70">· {card.cardType}</span>}
                            </div>
                          </div>
                          <CardDeleteButton
                            contractId={card.contractId}
                            cardLabel={card.maskedPan || card.circuit || undefined}
                            onDeleted={(cid) => setDeletedCardIds(s => new Set(s).add(cid))}
                          />
                        </div>
                      </div>
                    ))}
                    <CustomerAddebitoButton
                      cards={cards}
                      customerEmail={customer.email}
                      customerName={customerName}
                    />
                  </div>
                )
              })()}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-theme-text-muted">{label}</span>
      <span className="text-theme-text-primary font-medium">{value}</span>
    </div>
  )
}
