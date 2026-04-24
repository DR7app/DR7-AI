/**
 * Report Cliente — Full customer profile modal
 * Shows KPIs, booking history, wallet, documents, risk score, economic chart
 */
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'

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
interface BookingRecord { id: string; vehicle_name: string; vehicle_plate?: string; pickup_date: string; dropoff_date: string; status: string; payment_status: string; payment_method?: string; price_total: number; service_type?: string; booking_details?: any; created_at: string; appointment_date?: string }

interface WalletTx { id: string; amount: number; type?: string; transaction_type?: string; description: string; created_at: string; balance_after?: number }

interface DocRecord { id: string; document_type: string; status: string; uploaded_at: string }

type TabId = 'stato' | 'anagrafica' | 'storico' | 'economica'

export default function ReportClienteModal({ customerId, onClose }: ReportClienteProps) {
  const [customer, setCustomer] = useState<CustomerData | null>(null)
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([])
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

      // Bookings — match by user_id, email, or customer name
      const userId = cust?.user_id
      const email = cust?.email
      const name = cust?.denominazione || (cust?.nome && cust?.cognome ? `${cust.nome} ${cust.cognome}` : null)

      let allBookings: BookingRecord[] = []
      if (userId) {
        const { data } = await supabase.from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false })
        allBookings = data || []
      }
      if (allBookings.length === 0 && email) {
        const { data } = await supabase.from('bookings').select('*').eq('customer_email', email).order('created_at', { ascending: false })
        allBookings = data || []
      }
      if (allBookings.length === 0 && name) {
        const { data } = await supabase.from('bookings').select('*').eq('customer_name', name).order('created_at', { ascending: false })
        allBookings = data || []
      }
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
      }

      // DR7 Club membership check
      try {
        const clubRes = await fetch('/.netlify/functions/list-club-members')
        if (clubRes.ok) {
          const clubData = await clubRes.json()
          const members = clubData.members || []
          const isClub = members.some((m: { user_id?: string; email?: string }) =>
            (walletUserId && m.user_id === walletUserId) ||
            (email && m.email?.toLowerCase() === email.toLowerCase())
          )
          setIsDR7Club(isClub)
        }
      } catch { /* club check failed */ }

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
  // Computed from paid bookings in the last 12 months.
  const clubTier = useMemo(() => {
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const annualSpend = bookings
      .filter(b => {
        const ps = b.payment_status
        if (ps !== 'paid' && ps !== 'succeeded' && ps !== 'completed') return false
        const bookedAt = b.booked_at || b.created_at
        return bookedAt ? new Date(bookedAt) >= oneYearAgo : false
      })
      .reduce((s, b) => s + (b.price_total || 0), 0) / 100

    if (annualSpend >= 10000) {
      return { tier: 'signature', label: 'Signature', reward: 4, annualSpend, nextThreshold: null, badge: 'bg-amber-500/20 text-amber-400 border-amber-500/50' }
    }
    if (annualSpend >= 3000) {
      return { tier: 'black', label: 'Black', reward: 3, annualSpend, nextThreshold: 10000, badge: 'bg-purple-500/20 text-purple-400 border-purple-500/50' }
    }
    return { tier: 'access', label: 'Access', reward: 2, annualSpend, nextThreshold: 3000, badge: 'bg-gray-500/20 text-gray-300 border-gray-500/50' }
  }, [bookings])

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

  const docStatus = (type: string) => {
    const doc = documents.find(d => d.document_type === type)
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
      <div className="bg-theme-bg-primary border border-theme-border rounded-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-6 border-b border-theme-border flex items-start justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-dr7-gold/20 flex items-center justify-center text-2xl font-bold text-dr7-gold">
              {(customer.nome?.[0] || customer.denominazione?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-theme-text-primary">{customerName}</h2>
                {statusBadge(customer.status_cliente)}
                {isDR7Club && <span className="px-2 py-1 rounded-full text-xs font-bold bg-dr7-gold/20 text-dr7-gold border border-dr7-gold/50">DR7 Club</span>}
                <span
                  className={`px-2 py-1 rounded-full text-xs font-bold border ${clubTier.badge}`}
                  title={`Spesa ultimi 12 mesi: ${fmtEur(clubTier.annualSpend)}${clubTier.nextThreshold ? ` · ${fmtEur(clubTier.nextThreshold - clubTier.annualSpend)} al livello successivo` : ''}`}
                >
                  Livello {clubTier.label} · {clubTier.reward}%
                </span>
              </div>
              {customer.tipo_cliente === 'azienda' && customer.denominazione && (
                <div className="text-sm text-theme-text-muted">{customer.denominazione}</div>
              )}
              <div className="flex items-center gap-4 mt-1 text-sm text-theme-text-muted">
                {customer.telefono && <span>{customer.telefono}</span>}
                {customer.email && <span>{customer.email}</span>}
              </div>
              <div className="text-xs text-theme-text-muted mt-1">
                Iscritto dal {fmtDate(customer.created_at)} ({daysSince(new Date(customer.created_at))} giorni)
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-theme-bg-tertiary hover:bg-theme-bg-hover flex items-center justify-center text-theme-text-muted">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
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
            clubTier.tier === 'black' ? 'bg-purple-400' : 'bg-dr7-gold'
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
                    <div className="text-[11px] uppercase tracking-wider text-theme-text-muted">Spesa annuale</div>
                    <div className="text-lg font-bold text-theme-text-primary tabular-nums">{fmtEur(clubTier.annualSpend)}</div>
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
                  <div className={`rounded-lg border px-2 py-1.5 text-center ${clubTier.tier === 'black' ? 'border-purple-400/60 bg-purple-500/10' : 'border-theme-border bg-theme-bg-tertiary/40'}`}>
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

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 px-6 py-4 border-b border-theme-border shrink-0">
          <div className="bg-theme-bg-secondary rounded-xl p-3 border border-theme-border">
            <div className="text-xs text-theme-text-muted">Wallet</div>
            <div className="text-lg font-bold text-dr7-gold">{fmtEur(walletBalance)}</div>
          </div>
          <div className="bg-theme-bg-secondary rounded-xl p-3 border border-theme-border">
            <div className="text-xs text-theme-text-muted">Noleggi</div>
            <div className="text-lg font-bold text-theme-text-primary">{kpis.noleggiCount}</div>
          </div>
          <div className="bg-theme-bg-secondary rounded-xl p-3 border border-theme-border">
            <div className="text-xs text-theme-text-muted">Lavaggi</div>
            <div className="text-lg font-bold text-theme-text-primary">{kpis.lavaggiCount}</div>
          </div>
          <div className="bg-theme-bg-secondary rounded-xl p-3 border border-theme-border">
            <div className="text-xs text-theme-text-muted">Totale Speso</div>
            <div className="text-lg font-bold text-green-400">{fmtEur(kpis.totalSpent)}</div>
          </div>
          <div className="bg-theme-bg-secondary rounded-xl p-3 border border-theme-border">
            <div className="text-xs text-theme-text-muted">Penali</div>
            <div className="text-lg font-bold text-yellow-400">{fmtEur(kpis.totalPenali)} <span className="text-xs font-normal">({kpis.penaliCount})</span></div>
          </div>
          <div className="bg-theme-bg-secondary rounded-xl p-3 border border-theme-border">
            <div className="text-xs text-theme-text-muted">Danni</div>
            <div className="text-lg font-bold text-red-400">{fmtEur(kpis.totalDanni)} <span className="text-xs font-normal">({kpis.danniCount})</span></div>
          </div>
        </div>

        {/* Sub-KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-3 border-b border-theme-border shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-theme-text-muted">Debiti:</span>
            <span className={`font-bold ${kpis.unpaidTotal > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmtEur(kpis.unpaidTotal)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-theme-text-muted">Annullate:</span>
            <span className="font-bold text-theme-text-primary">{kpis.cancelled}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-theme-text-muted">Ultima attivita:</span>
            <span className="font-bold text-theme-text-primary">{kpis.lastDate ? `${daysSince(kpis.lastDate)} giorni fa` : '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-theme-text-muted">Meccanica:</span>
            <span className="font-bold text-theme-text-primary">{kpis.meccanicaCount}</span>
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

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* STATO CLIENTE */}
          {activeTab === 'stato' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: Activity table */}
              <div className="lg:col-span-2 space-y-4">
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
                {/* Documenti */}
                <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-4">
                  <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Documenti</h4>
                  <div className="space-y-2">
                    {['drivers_license', 'identity_document', 'libretto_front', 'libretto_back'].map(type => {
                      const s = docStatus(type)
                      const labels: Record<string, string> = { drivers_license: 'Patente', identity_document: 'Carta Identita', libretto_front: 'Libretto Fronte', libretto_back: 'Libretto Retro' }
                      return (
                        <div key={type} className="flex items-center justify-between text-sm">
                          <span className="text-theme-text-primary">{labels[type] || type}</span>
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
