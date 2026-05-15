import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'

interface CustomerResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  balance_cents: number | null
  user_id?: string | null
  recent_transactions?: { amount_cents: number; created_at: string }[]
}

interface WalletInfo {
  id: string
  customer_id: string
  balance_cents: number
  total_earned_cents: number
  total_spent_cents: number
  created_at: string
  updated_at: string
}

interface WalletTransaction {
  id: string
  wallet_id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  admin_user_id: string | null
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  registration_bonus: 'Bonus Registrazione',
  referral_friend_topup: 'Bonus Amico Referral',
  milestone_10_friends: 'Milestone 10 Amici',
  topup: 'Ricarica',
  manual_credit: 'Credito Manuale',
  manual_debit: 'Addebito Manuale',
  booking_payment: 'Pagamento Prenotazione',
  refund: 'Rimborso',
}

const TEAL = '#1a3a3a'
const TEAL_LIGHT = '#2a5a5a'
const TEAL_BORDER = '#3a6a6a'

export default function CustomerWalletTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [allWalletCustomers, setAllWalletCustomers] = useState<CustomerResult[]>([])
  const [loadingAll, setLoadingAll] = useState(true)

  // Expanded customer details
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [expandedTransactions, setExpandedTransactions] = useState<any[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)

  // Modal state
  const [modalCustomer, setModalCustomer] = useState<CustomerResult | null>(null)
  const [modalAction, setModalAction] = useState<'credit' | 'debit'>('credit')
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [, setDetailLoading] = useState(false)

  // Form
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // Recurring
  const [recurringEnabled, setRecurringEnabled] = useState(false)
  const [recurringDay, setRecurringDay] = useState(1)
  const [recurringAmount, setRecurringAmount] = useState('')
  const [recurringSettings, setRecurringSettings] = useState<Map<string, { day: number; amount: number; active: boolean }>>(new Map())

  // OTP
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [sentOtp, setSentOtp] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  // Sort
  const [sortBy, setSortBy] = useState<'balance' | 'name'>('balance')

  useEffect(() => { loadAllWalletCustomers() }, [])

  async function loadAllWalletCustomers() {
    setLoadingAll(true)
    try {
      // Load ALL customers
      const response = await fetch('/.netlify/functions/list-customers')
      const result = await response.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allCustomers: any[] = result.customers || []

      // Load wallets via referral_participants → wallets chain
      // 1. Get all referral participants with their phone
      const { data: participants } = await supabase
        .from('referral_participants')
        .select('id, telefono')

      // 2. Get all wallets with balance
      const { data: wallets } = await supabase
        .from('wallets')
        .select('participant_id, balance_cents')

      // Build phone → balance map
      const phoneBalanceMap = new Map<string, number>()
      if (participants && wallets) {
        const participantMap = new Map<string, string>() // participant_id → telefono
        for (const p of participants) {
          if (p.telefono) participantMap.set(p.id, p.telefono)
        }
        for (const w of wallets) {
          const phone = participantMap.get(w.participant_id)
          if (phone && w.balance_cents > 0) {
            phoneBalanceMap.set(phone, (phoneBalanceMap.get(phone) || 0) + w.balance_cents)
          }
        }
      }

      // Also load from user_credit_balance (website wallet — stores in EUR, not cents)
      // Use service role via Netlify function to bypass RLS
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let creditBalances: any[] | null = null
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        const cbRes = await fetch('/.netlify/functions/customer-wallet-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'list_all_balances' })
        })
        const cbData = await cbRes.json()
        if (cbData.success) creditBalances = cbData.balances
      } catch (e) {
        logger.warn('Failed to load credit balances via function, trying direct:', e)
      }
      // Fallback: direct query
      if (!creditBalances) {
        const { data } = await supabase.from('user_credit_balance').select('user_id, balance')
        creditBalances = data
      }

      // Build user_id → balance map (convert EUR to cents)
      const userCreditMap = new Map<string, number>()
      if (creditBalances) {
        for (const cb of creditBalances) {
          if (cb.balance && cb.balance > 0) {
            userCreditMap.set(cb.user_id, Math.round(cb.balance * 100))
          }
        }
      }

      // Build user_id → customer_id map from customers_extended
      const userIdToCustId = new Map<string, string>()
      for (const cust of allCustomers) {
        if (cust.user_id) userIdToCustId.set(cust.user_id, cust.id)
      }

      // Map all customers with their wallet balance from BOTH systems
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: CustomerResult[] = allCustomers.map((cust: any) => {
        const phone = cust.telefono || null
        // Referral wallet (by phone)
        const referralBalance = phone ? (phoneBalanceMap.get(phone) || 0) : 0
        // Website credit wallet (by user_id)
        const creditBalance = cust.user_id ? (userCreditMap.get(cust.user_id) || 0) : 0
        // Use the higher of the two (they shouldn't both have balance for same customer)
        const totalBalance = referralBalance + creditBalance
        return {
          id: cust.id,
          full_name: (`${cust.nome || ''} ${cust.cognome || ''}`.trim() || cust.ragione_sociale || cust.denominazione || 'N/A'),
          email: cust.email || null,
          phone,
          balance_cents: totalBalance,
          user_id: cust.user_id || null
        }
      })

      // Sort: customers with balance first, then alphabetical
      mapped.sort((a, b) => {
        if ((b.balance_cents || 0) !== (a.balance_cents || 0)) return (b.balance_cents || 0) - (a.balance_cents || 0)
        return (a.full_name || '').localeCompare(b.full_name || '')
      })

      setAllWalletCustomers(mapped)

      // Load recurring settings from customers_extended metadata
      const { data: custExtended } = await supabase
        .from('customers_extended')
        .select('id, metadata')
        .not('metadata->wallet_recurring', 'is', 'null')
      if (custExtended) {
        const rMap = new Map<string, { day: number; amount: number; active: boolean }>()
        for (const c of custExtended) {
          const r = c.metadata?.wallet_recurring
          if (r && r.active) rMap.set(c.id, r)
        }
        setRecurringSettings(rMap)
      }
    } catch (err) {
      console.error('Error loading customers:', err)
    } finally {
      setLoadingAll(false)
    }
  }

  async function saveRecurring(customerId: string, settings: { day: number; amount: number; active: boolean } | null) {
    try {
      const { data: cust } = await supabase.from('customers_extended').select('metadata').eq('id', customerId).single()
      const meta = cust?.metadata || {}
      const { error } = await supabase.from('customers_extended').update({
        metadata: { ...meta, wallet_recurring: settings }
      }).eq('id', customerId)
      if (error) throw error
      if (settings?.active) {
        setRecurringSettings(prev => new Map(prev).set(customerId, settings))
      } else {
        setRecurringSettings(prev => { const m = new Map(prev); m.delete(customerId); return m })
      }
      toast.success(settings?.active ? 'Ricarica automatica attivata' : 'Ricarica automatica disattivata')
    } catch (err) {
      toast.error('Errore salvataggio: ' + (err instanceof Error ? err.message : 'Errore'))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function apiCall(body: Record<string, any>) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch('/.netlify/functions/customer-wallet-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok && !data.error) {
      data.error = `HTTP ${res.status}: ${JSON.stringify(data).substring(0, 200)}`
    }
    return data
  }

  async function toggleExpandCustomer(customer: CustomerResult) {
    if (expandedCustomerId === customer.id) {
      setExpandedCustomerId(null)
      return
    }
    setExpandedCustomerId(customer.id)
    setLoadingTransactions(true)
    setExpandedTransactions([])
    try {
      // Load from credit_transactions (website wallet) via service role
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/.netlify/functions/customer-wallet-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'credit_transactions', customer_id: customer.id, user_id: customer.user_id })
      })
      const data = await res.json()
      if (data.success) {
        setExpandedTransactions(data.transactions || [])
      }
    } catch (e) {
      console.error('Failed to load transactions:', e)
    } finally {
      setLoadingTransactions(false)
    }
  }

  async function openModal(customer: CustomerResult, action: 'credit' | 'debit') {
    setModalCustomer(customer)
    setModalAction(action)
    setAmount('')
    setDescription('')
    setOtpDigits(['', '', '', '', '', ''])
    setSentOtp('')
    setOtpSent(false)
    setOtpVerified(false)
    // Load existing recurring settings
    const existing = recurringSettings.get(customer.id)
    setRecurringEnabled(!!existing?.active)
    setRecurringDay(existing?.day || 1)
    setRecurringAmount(existing ? String(existing.amount) : '')
    setDetailLoading(true)
    setWallet(null)
    setTransactions([])

    try {
      const data = await apiCall({ action: 'transactions', customer_id: customer.id })
      if (data.success) {
        setWallet(data.wallet)
        setTransactions(data.transactions)
      }
    } catch {
      toast.error('Errore caricamento dettagli')
    }
    setDetailLoading(false)
  }

  function closeModal() {
    setModalCustomer(null)
    setOtpSent(false)
    setOtpVerified(false)
    setSentOtp('')
    setOtpDigits(['', '', '', '', '', ''])
  }

  async function sendOtp() {
    if (!modalCustomer) return

    // Fall back to the recurring amount when no immediate-charge importo is
    // entered — admin must be able to OTP-authorise a recurring schedule
    // without also creating an immediate charge.
    const parsedAmount = parseFloat(amount)
    const recurringAmountNum = parseFloat(recurringAmount || '')
    const isRecurringOnly = (!parsedAmount || parsedAmount <= 0)
      && modalAction === 'credit'
      && recurringEnabled
      && Number.isFinite(recurringAmountNum)
      && recurringAmountNum > 0
    const otpAmount = parsedAmount > 0 ? parsedAmount : (isRecurringOnly ? recurringAmountNum : 0)
    if (otpAmount <= 0) {
      toast.error('Inserisci un importo (singolo o ricorrente) prima di chiedere l\'OTP')
      return
    }

    setOtpSending(true)
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      setSentOtp(code)

      // authFetch injects the Supabase session bearer token. The server
      // function requires it (requireAuth) and returns 401 without it,
      // which is what produced the "Errore invio codice" toast.
      const res = await authFetch('/.netlify/functions/send-wallet-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          action: modalAction,
          customerName: modalCustomer.full_name,
          amount: otpAmount.toFixed(2),
          description: description || (isRecurringOnly ? `Programmazione ricarica mensile €${otpAmount.toFixed(2)} il ${recurringDay} di ogni mese` : '')
        })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json().catch(() => ({}))
      // Self-approval bypass: when the requester IS the OTP recipient,
      // the server returns autoApproved=true and skips the email.
      if (data.autoApproved) {
        setOtpSent(true)
        setOtpVerified(true)
        setOtpDigits(code.split(''))
        toast.success('Approvato direttamente (direzione)')
      } else {
        setOtpSent(true)
        setOtpVerified(false)
        setOtpDigits(['', '', '', '', '', ''])
        toast.success('Codice di verifica inviato via email')
        setTimeout(() => otpRefs.current[0]?.focus(), 100)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[wallet-otp] send failed:', err)
      toast.error('Errore invio codice OTP: ' + msg)
    } finally {
      setOtpSending(false)
    }
  }

  function verifyOtp() {
    const code = otpDigits.join('')
    if (code === sentOtp) {
      setOtpVerified(true)
      toast.success('Codice verificato!')
    } else {
      toast.error('Codice errato')
    }
  }

  async function handleConfirm() {
    if (!modalCustomer) return

    // Recurring-only save: admin enabled "Caricamento automatico mensile"
    // and didn't enter an immediate charge amount → persist the schedule
    // only. OTP is still required (authorises the customer to be charged
    // monthly), but no immediate credit is applied.
    const recurringAmountNum = parseFloat(recurringAmount || '')
    const wantsRecurringOnly =
      !amount
      && modalAction === 'credit'
      && recurringEnabled
      && Number.isFinite(recurringAmountNum)
      && recurringAmountNum > 0
    if (wantsRecurringOnly) {
      if (!otpVerified) {
        // First click → kick off OTP. Admin verifies, then clicks again
        // to actually save.
        sendOtp()
        return
      }
      setActionLoading(true)
      try {
        await saveRecurring(modalCustomer.id, { day: recurringDay, amount: recurringAmountNum, active: true })
        toast.success(`Ricarica automatica salvata: €${recurringAmountNum.toFixed(2)} il ${recurringDay} di ogni mese alle 09:00`)
        closeModal()
        loadAllWalletCustomers()
      } catch (err: unknown) {
        const _errMsg = err instanceof Error ? err.message : String(err)
        toast.error('Errore salvataggio programmazione: ' + (_errMsg || ''))
      } finally {
        setActionLoading(false)
      }
      return
    }

    if (!amount) return
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) return

    if (!otpVerified) {
      sendOtp()
      return
    }

    setActionLoading(true)
    try {
      const data = await apiCall({
        action: modalAction,
        customer_id: modalCustomer.id,
        amount: parsedAmount,
        description: description || undefined,
      })

      if (data.success) {
        toast.success(`${modalAction === 'credit' ? 'Credito' : 'Addebito'} di €${parsedAmount.toFixed(2)} applicato`)
        // Save recurring settings if changed
        if (modalAction === 'credit' && recurringEnabled && recurringAmount) {
          await saveRecurring(modalCustomer.id, { day: recurringDay, amount: parseFloat(recurringAmount), active: true })
        } else if (modalAction === 'credit' && !recurringEnabled && recurringSettings.has(modalCustomer.id)) {
          await saveRecurring(modalCustomer.id, null)
        }
        setAllWalletCustomers(prev => prev.map(c =>
          c.id === modalCustomer.id ? { ...c, balance_cents: data.new_balance_cents } : c
        ))
        closeModal()
        loadAllWalletCustomers()
      } else {
        console.error('[Wallet] API error:', data)
        toast.error(data.error || `Errore: ${JSON.stringify(data).substring(0, 150)}`)
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore di connessione: ' + (_errMsg || ''))
    }
    setActionLoading(false)
  }

  const formatEurDec = (cents: number) => `€${(cents / 100).toFixed(2)}`

  const totalBalance = allWalletCustomers.reduce((s, c) => s + (c.balance_cents || 0), 0)

  // ── KPIs e widget sidebar (dati gia' caricati, niente nuove query) ────────
  const activeCustomers = allWalletCustomers.filter(c => (c.balance_cents || 0) > 0)
  const activeCount = activeCustomers.length
  const totalCount = allWalletCustomers.length
  const inactiveCount = totalCount - activeCount
  const avgBalanceCents = activeCount > 0 ? Math.round(totalBalance / activeCount) : 0

  // Top 3 saldo alto per la sidebar
  const topBalances = [...activeCustomers]
    .sort((a, b) => (b.balance_cents || 0) - (a.balance_cents || 0))
    .slice(0, 3)

  // Ricariche automatiche attive — recurringSettings e' Map<customerId,
  // { day, amount, active }> con amount in EURO, day del mese 1-31.
  const recurringEntries: Array<{ id: string; name: string; amountEur: number; day: number }> = []
  for (const c of allWalletCustomers) {
    const r = recurringSettings.get(c.id)
    if (!r || !r.active) continue
    const amountEur = Number(r.amount || 0)
    const day = Number(r.day || 0)
    if (amountEur > 0) {
      recurringEntries.push({ id: c.id, name: c.full_name || c.email || c.phone || 'N/A', amountEur, day })
    }
  }
  const recurringActiveCount = recurringEntries.length
  const recurringMonthlyTotalEur = recurringEntries.reduce((s, e) => s + e.amountEur, 0)
  const recurringTop = [...recurringEntries].sort((a, b) => b.amountEur - a.amountEur).slice(0, 3)

  // Filter and sort
  const filtered = allWalletCustomers.filter(c => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (c.full_name?.toLowerCase().includes(q)) ||
           (c.email?.toLowerCase().includes(q)) ||
           (c.phone?.includes(q))
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'balance') return (b.balance_cents || 0) - (a.balance_cents || 0)
    return (a.full_name || '').localeCompare(b.full_name || '')
  })

  const initials = (name: string) => {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.substring(0, 2).toUpperCase()
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
        <div className="absolute -top-12 -right-12 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 grid place-items-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h18M7 15h2m4 0h6m-9 5h12a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">Credit Wallet Clienti</h2>
              <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Gestisci i wallet e il credito dei tuoi clienti</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-theme-text-muted">
            <span className="px-2.5 py-1 rounded-full bg-theme-bg-tertiary border border-theme-border">
              {totalCount} {totalCount === 1 ? 'cliente' : 'clienti'} · {activeCount} attivi
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {/* Totale Wallet Sistema */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-blue-300/80 uppercase tracking-wider font-semibold">Totale wallet sistema</div>
              <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h2m4 0h6M5 6h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-blue-400 mt-2.5 tabular-nums">
              €{(totalBalance / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">saldo cumulato in piattaforma</div>
          </div>
        </div>

        {/* Clienti Attivi */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider font-semibold">Clienti attivi</div>
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-emerald-400 mt-2.5 tabular-nums">
              {activeCount}
              <span className="text-sm font-medium text-emerald-400/60 ml-1">/ {totalCount}</span>
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">
              {totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0}% con saldo &gt; €0
              {inactiveCount > 0 && ` · ${inactiveCount} inattivi`}
            </div>
          </div>
        </div>

        {/* Saldo Medio */}
        <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-purple-300/80 uppercase tracking-wider font-semibold">Saldo medio</div>
              <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-purple-400 mt-2.5 tabular-nums">
              €{(avgBalanceCents / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-1">per cliente attivo</div>
          </div>
        </div>

        {/* Ricariche Automatiche */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-amber-300/80 uppercase tracking-wider font-semibold">Ricariche automatiche</div>
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 grid place-items-center">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </div>
            </div>
            <div className="text-2xl lg:text-3xl font-bold text-amber-400 mt-2.5 tabular-nums">{recurringActiveCount}</div>
            <div className="text-[11px] text-theme-text-muted mt-1">
              {recurringMonthlyTotalEur > 0
                ? `€${recurringMonthlyTotalEur.toLocaleString('it-IT')} / mese ricorrenti`
                : 'nessun piano attivo'}
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cerca cliente per nome, email o telefono..."
          className="w-full pl-10 pr-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all"
        />
        <button
          onClick={() => setSortBy(sortBy === 'balance' ? 'name' : 'balance')}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-theme-bg-tertiary border border-theme-border text-[11px] text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
        >
          Ordina: {sortBy === 'balance' ? 'Saldo' : 'Nome'} ↕
        </button>
      </div>

      {/* Table + Sidebar (desktop) */}
      <div className="lg:flex lg:gap-4 lg:items-start">
      <div className="lg:flex-1 lg:min-w-0">
      {loadingAll ? (
        <div className="text-center py-16 text-theme-text-muted">Caricamento wallet...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-theme-text-muted">Nessun cliente con wallet trovato</div>
      ) : (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="hidden lg:grid grid-cols-[2fr_1.5fr_2fr_1fr_1.5fr_auto] gap-4 px-5 py-3 border-b border-theme-border text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
            <span>Cliente</span>
            <span>Telefono</span>
            <span>Email</span>
            <span>Wallet</span>
            <span>Ultime Transazioni</span>
            <span>Azione</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-theme-border/50">
            {sorted.map((customer) => (
              <div
                key={customer.id}
                className="grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_2fr_1fr_1.5fr_auto] gap-2 lg:gap-4 px-5 py-3.5 items-center hover:bg-white/[0.02] transition-colors"
              >
                {/* Cliente */}
                {(() => {
                  const balance = customer.balance_cents || 0
                  const isActive = balance > 0
                  const palettes = [
                    'bg-rose-500/20 text-rose-300 border-rose-500/40',
                    'bg-amber-500/20 text-amber-300 border-amber-500/40',
                    'bg-blue-500/20 text-blue-300 border-blue-500/40',
                    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                    'bg-purple-500/20 text-purple-300 border-purple-500/40',
                    'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                    'bg-orange-500/20 text-orange-300 border-orange-500/40',
                    'bg-pink-500/20 text-pink-300 border-pink-500/40',
                  ]
                  let hash = 0
                  for (let i = 0; i < customer.id.length; i++) hash = (hash * 31 + customer.id.charCodeAt(i)) | 0
                  const avatarColor = palettes[Math.abs(hash) % palettes.length]
                  const hasRecurring = recurringSettings.has(customer.id)
                  return (
                    <>
                      {/* Cliente */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full grid place-items-center text-sm font-bold border flex-shrink-0 ${avatarColor}`}>
                          {initials(customer.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-theme-text-primary truncate">{customer.full_name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide border ${
                              isActive
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                            }`}>
                              {isActive ? 'Attivo' : 'Inattivo'}
                            </span>
                            {hasRecurring && (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/40">
                                Auto
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Telefono */}
                      <div className="text-sm text-theme-text-secondary truncate">
                        {customer.phone || '—'}
                      </div>

                      {/* Email */}
                      <div className="text-sm text-theme-text-secondary truncate">
                        {customer.email || '—'}
                      </div>

                      {/* Wallet */}
                      <div className={`text-sm font-bold tabular-nums ${
                        balance >= 50000 ? 'text-emerald-400'
                        : balance > 0 ? 'text-theme-text-primary'
                        : 'text-theme-text-muted'
                      }`}>
                        €{(balance / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </>
                  )
                })()}

                {/* Dettagli transazioni */}
                <div>
                  <button
                    onClick={() => toggleExpandCustomer(customer)}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {expandedCustomerId === customer.id ? 'Chiudi' : 'Dettagli'}
                  </button>
                </div>

                {/* Azione */}
                <div className="flex gap-2">
                  <button
                    onClick={() => openModal(customer, 'credit')}
                    className="px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors flex items-center gap-1.5"
                    style={{ backgroundColor: TEAL }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = TEAL_LIGHT}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = TEAL}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Carica
                  </button>
                </div>

                {/* Recurring badge — matching Rentora design */}
                {recurringSettings.has(customer.id) && (() => {
                  const r = recurringSettings.get(customer.id)!
                  return (
                    <div className="col-span-full mt-2 bg-[#f0f7f0] dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                            <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-green-700 dark:text-green-400">Ricarica automatica attiva</p>
                            <p className="text-sm text-gray-600 dark:text-theme-text-muted">&euro; {r.amount} ogni {r.day} del mese alle 09:00 (Europe/Rome)</p>
                          </div>
                        </div>
                        <span className="px-3 py-1 text-xs font-bold text-green-600 dark:text-green-400 border border-green-300 dark:border-green-700 rounded-full">ATTIVA</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openModal(customer, 'credit')}
                          className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-theme-border rounded-lg text-gray-700 dark:text-theme-text-primary hover:bg-gray-100 dark:hover:bg-theme-bg-tertiary transition-colors flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          Modifica
                        </button>
                        <button onClick={() => saveRecurring(customer.id, null)}
                          className="px-4 py-2 text-sm font-medium border border-red-300 dark:border-red-500/30 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                          Disattiva
                        </button>
                      </div>
                    </div>
                  )
                })()}

                {/* Expanded transactions */}
                {expandedCustomerId === customer.id && (
                  <div className="col-span-6 mt-2 bg-theme-bg-primary/50 rounded-lg border border-theme-border/50 p-3">
                    {loadingTransactions ? (
                      <p className="text-xs text-theme-text-muted text-center py-2">Caricamento...</p>
                    ) : expandedTransactions.length === 0 ? (
                      <p className="text-xs text-theme-text-muted text-center py-2">Nessuna transazione</p>
                    ) : (
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {expandedTransactions.map((txn: any, i: number) => (
                          <div key={txn.id || i} className="flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-theme-bg-tertiary/30">
                            <div className="flex-1 min-w-0">
                              <span className={`font-semibold ${txn.transaction_type === 'credit' ? 'text-green-400' : 'text-red-400'}`}>
                                {txn.transaction_type === 'credit' ? '+' : '-'}€{Math.abs(Number(txn.amount)).toFixed(2)}
                              </span>
                              <span className="text-theme-text-muted ml-2 truncate">{txn.description || '-'}</span>
                            </div>
                            <div className="text-theme-text-muted whitespace-nowrap ml-2">
                              {new Date(txn.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* Right Sidebar */}
      <aside className="hidden lg:block w-80 flex-shrink-0 space-y-4 lg:sticky lg:top-4">
        {/* Top 3 Saldo Alto */}
        <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Saldi più alti</h3>
            <span className="text-[10px] text-theme-text-muted">top 3</span>
          </div>
          {topBalances.length === 0 ? (
            <div className="text-xs text-theme-text-muted py-3 text-center">Nessun cliente con saldo</div>
          ) : (
            <div className="space-y-2">
              {topBalances.map((c, i) => {
                const init = initials(c.full_name || c.email || '?')
                const palettes = ['bg-amber-500/20 text-amber-300 border-amber-500/40', 'bg-blue-500/20 text-blue-300 border-blue-500/40', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40']
                const color = palettes[i] || palettes[0]
                return (
                  <button
                    key={c.id}
                    onClick={() => openModal(c, 'credit')}
                    className="w-full flex items-center gap-2.5 hover:bg-theme-bg-primary/40 rounded-lg p-1.5 -mx-1.5 transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border flex-shrink-0 ${color}`}>{init}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-theme-text-primary font-semibold truncate">{c.full_name || c.email}</div>
                      <div className="text-[10px] text-theme-text-muted truncate">{c.email || c.phone}</div>
                    </div>
                    <div className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">€{((c.balance_cents || 0) / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Ricariche Automatiche */}
        <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Ricariche automatiche</h3>
            {recurringActiveCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px] font-bold">{recurringActiveCount}</span>
            )}
          </div>
          {recurringTop.length === 0 ? (
            <div className="text-xs text-theme-text-muted py-3 text-center">Nessuna ricarica automatica attiva</div>
          ) : (
            <>
              <div className="space-y-2">
                {recurringTop.map(r => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 grid place-items-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-theme-text-primary font-semibold truncate">{r.name}</div>
                      <div className="text-[10px] text-theme-text-muted">il {r.day} di ogni mese alle 09:00</div>
                    </div>
                    <div className="text-xs font-bold text-amber-400 tabular-nums whitespace-nowrap">€{r.amountEur.toLocaleString('it-IT')}</div>
                  </div>
                ))}
              </div>
              {recurringActiveCount > recurringTop.length && (
                <div className="text-[10px] text-theme-text-muted mt-2 text-center">
                  + altre {recurringActiveCount - recurringTop.length} attive
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
                <span className="text-theme-text-muted">Totale mensile</span>
                <span className="text-theme-text-primary font-bold tabular-nums">€{recurringMonthlyTotalEur.toLocaleString('it-IT')}</span>
              </div>
            </>
          )}
        </div>

        {/* Riepilogo */}
        <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-tertiary p-4">
          <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider mb-3">Riepilogo</h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-theme-text-secondary">Saldo totale</span>
              <span className="text-emerald-400 font-bold tabular-nums">€{(totalBalance / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-theme-text-secondary">Clienti attivi</span>
              <span className="text-theme-text-primary font-bold tabular-nums">{activeCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-theme-text-secondary">Clienti inattivi</span>
              <span className="text-theme-text-muted font-bold tabular-nums">{inactiveCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-theme-text-secondary">Saldo medio</span>
              <span className="text-purple-400 font-bold tabular-nums">€{(avgBalanceCents / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>
      </aside>
      </div>

      {/* ===== MODAL ===== */}
      {modalCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <h3 className="text-xl font-bold text-gray-900">
                {modalAction === 'credit' ? 'Carica Wallet' : 'Addebita Wallet'}
              </h3>
              <button onClick={closeModal} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Customer Info */}
            <div className="px-6 py-3 flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ backgroundColor: TEAL }}
              >
                {initials(modalCustomer.full_name)}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{modalCustomer.full_name}</p>
                <p className="text-sm text-gray-500">
                  {modalCustomer.email || '—'}
                  {modalCustomer.phone && <span className="ml-2">{modalCustomer.phone}</span>}
                </p>
              </div>
              {wallet && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-gray-400">Saldo</p>
                  <p className="font-bold text-gray-900">{formatEurDec(wallet.balance_cents)}</p>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* Action toggle */}
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                <button
                  onClick={() => { setModalAction('credit'); setOtpSent(false); setOtpVerified(false); setOtpDigits(['','','','','','']) }}
                  className={`flex-1 py-2 text-sm font-semibold transition-colors ${modalAction === 'credit' ? 'text-white' : 'text-gray-600 bg-gray-50 hover:bg-gray-100'}`}
                  style={modalAction === 'credit' ? { backgroundColor: TEAL } : {}}
                >
                  + Credita
                </button>
                <button
                  onClick={() => { setModalAction('debit'); setOtpSent(false); setOtpVerified(false); setOtpDigits(['','','','','','']) }}
                  className={`flex-1 py-2 text-sm font-semibold transition-colors ${modalAction === 'debit' ? 'bg-red-500 text-white' : 'text-gray-600 bg-gray-50 hover:bg-gray-100'}`}
                >
                  - Addebita
                </button>
              </div>

              {/* Importo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Importo</label>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 text-lg font-semibold outline-none focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a] transition-all"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">&euro;</span>
                </div>
              </div>

              {/* Nota */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nota (facoltativa)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Pagamento anticipato noleggio"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a] transition-all"
                />
              </div>

              {/* Caricamento automatico mensile */}
              {modalAction === 'credit' && (
                <div className={`border rounded-xl p-4 transition-colors ${recurringEnabled ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Caricamento automatico mensile</p>
                      <p className="text-xs text-gray-500">Attiva per programmare un accredito ricorrente.</p>
                    </div>
                    <button
                      onClick={() => setRecurringEnabled(!recurringEnabled)}
                      className={`w-11 h-6 rounded-full relative transition-colors ${recurringEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow ${recurringEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {recurringEnabled && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Giorno del mese</label>
                        <select value={recurringDay} onChange={e => setRecurringDay(parseInt(e.target.value))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a]">
                          {Array.from({ length: 28 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>{i + 1}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Importo ricorrente</label>
                        <div className="relative">
                          <input type="number" value={recurringAmount} onChange={e => setRecurringAmount(e.target.value)}
                            placeholder="0" min="1" step="1"
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 outline-none focus:border-[#3a6a6a]" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&euro;</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* OTP Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Codice OTP</label>
                  <button
                    onClick={sendOtp}
                    disabled={otpSending || (!amount && !(recurringEnabled && parseFloat(recurringAmount || '') > 0))}
                    className="px-4 py-1.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: TEAL }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = TEAL_LIGHT }}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = TEAL}
                  >
                    {otpSending ? 'Invio...' : 'Invia OTP'}
                  </button>
                </div>

                {/* OTP Input — single rectangle */}
                <div className="mb-3">
                  <input
                    ref={el => { otpRefs.current[0] = el }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otpDigits.join('')}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6)
                      const next = ['', '', '', '', '', '']
                      for (let i = 0; i < cleaned.length; i++) next[i] = cleaned[i]
                      setOtpDigits(next)
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') verifyOtp() }}
                    placeholder="------"
                    className={`w-full h-14 text-center text-2xl font-bold tracking-[0.5em] border-2 rounded-xl outline-none transition-all ${
                      otpVerified
                        ? 'border-green-400 bg-green-50 text-green-700'
                        : otpDigits.some(d => d)
                          ? 'border-[#3a6a6a] bg-white text-gray-900'
                          : 'border-gray-200 bg-gray-50 text-gray-900'
                    } focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a]`}
                    disabled={otpVerified}
                  />
                </div>

                {otpVerified && (
                  <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Codice verificato
                  </p>
                )}

                {!otpVerified && (
                  <p className="text-xs text-gray-400">
                    {otpSent
                      ? 'Codice inviato via email. Inserisci il codice per confermare.'
                      : 'Caricamento Wallet richiede l\'autorizzazione. Un codice OTP verra inviato via email per confermare.'}
                  </p>
                )}
              </div>

              {/* Transactions preview */}
              {transactions.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ultime transazioni</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {transactions.slice(0, 5).map(txn => (
                      <div key={txn.id} className="flex justify-between text-xs">
                        <span className="text-gray-500">{TYPE_LABELS[txn.type] || txn.type}</span>
                        <span className={txn.amount_cents >= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                          {txn.amount_cents >= 0 ? '+' : ''}{formatEurDec(txn.amount_cents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={closeModal}
                  className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  Annulla
                </button>

                {otpSent && !otpVerified && (
                  <button
                    onClick={verifyOtp}
                    disabled={otpDigits.join('').length < 6}
                    className="px-5 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors disabled:opacity-40"
                    style={{ borderColor: TEAL_BORDER, color: TEAL }}
                  >
                    Verifica OTP
                  </button>
                )}

                <button
                  onClick={handleConfirm}
                  disabled={(() => {
                    if (actionLoading) return true
                    // Recurring-only save bypasses OTP and amount requirements
                    const recurOnly = !amount && modalAction === 'credit' && recurringEnabled
                      && parseFloat(recurringAmount || '') > 0
                    if (recurOnly) return false
                    return !amount || (otpSent && !otpVerified)
                  })()}
                  className="flex-1 px-5 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-40 transition-colors"
                  style={{ backgroundColor: modalAction === 'credit' ? TEAL : '#ef4444' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.9' }}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {(() => {
                    if (actionLoading) return 'Elaborazione...'
                    const recurOnly = !amount && modalAction === 'credit' && recurringEnabled
                      && parseFloat(recurringAmount || '') > 0
                    if (recurOnly) return 'Salva Programmazione'
                    if (otpVerified) return `Conferma ${modalAction === 'credit' ? 'Caricamento' : 'Addebito'}`
                    return `${modalAction === 'credit' ? 'Carica' : 'Addebita'} Wallet`
                  })()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
