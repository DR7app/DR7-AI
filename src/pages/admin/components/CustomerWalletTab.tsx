import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { logger } from '../../../utils/logger'

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

  // OTP digit input handling
  function handleOtpDigit(index: number, value: string) {
    if (value.length > 1) value = value.slice(-1)
    if (value && !/^\d$/.test(value)) return

    const newDigits = [...otpDigits]
    newDigits[index] = value
    setOtpDigits(newDigits)

    // Auto-focus next
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
    if (e.key === 'Enter') {
      verifyOtp()
    }
  }

  async function sendOtp() {
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('Inserisci un importo valido')
      return
    }
    if (!modalCustomer) return

    setOtpSending(true)
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      setSentOtp(code)

      const res = await fetch('/.netlify/functions/send-wallet-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          action: modalAction,
          customerName: modalCustomer.full_name,
          amount: parsedAmount.toFixed(2),
          description: description || ''
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Errore invio email')
      }

      setOtpSent(true)
      setOtpVerified(false)
      setOtpDigits(['', '', '', '', '', ''])
      toast.success('Codice di verifica inviato via email')
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch {
      toast.error('Errore invio codice')
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
    if (!modalCustomer || !amount) return
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

  const formatEur = (cents: number) => `€ ${(cents / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  const formatEurDec = (cents: number) => `€${(cents / 100).toFixed(2)}`

  const totalBalance = allWalletCustomers.reduce((s, c) => s + (c.balance_cents || 0), 0)

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Wallet Clienti</h2>
          <p className="text-sm text-theme-text-muted mt-0.5">Visualizza e gestisci il wallet dei tuoi clienti</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-theme-text-primary">{formatEur(totalBalance)}</p>
          <button
            onClick={() => setSortBy(sortBy === 'balance' ? 'name' : 'balance')}
            className="text-xs text-theme-text-muted hover:text-theme-text-primary mt-1 transition-colors"
          >
            Saldo per {sortBy === 'balance' ? 'Piu Alto' : 'Nome'} ↕
          </button>
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
          placeholder="Cerca cliente..."
          className="w-full pl-10 pr-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary outline-none focus:border-[#3a6a6a] transition-colors"
        />
      </div>

      {/* Table */}
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
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: TEAL }}
                  >
                    {initials(customer.full_name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-theme-text-primary truncate">{customer.full_name}</p>
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
                <div className="text-sm font-bold text-theme-text-primary">
                  {formatEur(customer.balance_cents || 0)}
                </div>

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
                            <p className="text-sm text-gray-600 dark:text-theme-text-muted">&euro; {r.amount} ogni {r.day} del mese</p>
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
                    disabled={otpSending || !amount}
                    className="px-4 py-1.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: TEAL }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = TEAL_LIGHT }}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = TEAL}
                  >
                    {otpSending ? 'Invio...' : 'Invia OTP'}
                  </button>
                </div>

                {/* OTP Digit Boxes */}
                <div className="flex gap-2 mb-3">
                  {otpDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => { otpRefs.current[i] = el }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpDigit(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
                        if (text.length > 0) {
                          e.preventDefault()
                          const newDigits = [...otpDigits]
                          for (let j = 0; j < 6; j++) newDigits[j] = text[j] || ''
                          setOtpDigits(newDigits)
                          const focusIdx = Math.min(text.length, 5)
                          otpRefs.current[focusIdx]?.focus()
                        }
                      }}
                      className={`w-full aspect-square max-w-[52px] text-center text-xl font-bold border-2 rounded-xl outline-none transition-all ${
                        otpVerified
                          ? 'border-green-400 bg-green-50 text-green-700'
                          : digit
                            ? 'border-[#3a6a6a] bg-white text-gray-900'
                            : 'border-gray-200 bg-gray-50 text-gray-900'
                      } focus:border-[#3a6a6a] focus:ring-1 focus:ring-[#3a6a6a]`}
                      disabled={otpVerified}
                    />
                  ))}
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
                  disabled={actionLoading || !amount || (otpSent && !otpVerified)}
                  className="flex-1 px-5 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-40 transition-colors"
                  style={{ backgroundColor: modalAction === 'credit' ? TEAL : '#ef4444' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.9' }}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {actionLoading
                    ? 'Elaborazione...'
                    : otpVerified
                      ? `Conferma ${modalAction === 'credit' ? 'Caricamento' : 'Addebito'}`
                      : `${modalAction === 'credit' ? 'Carica' : 'Addebita'} Wallet`
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
