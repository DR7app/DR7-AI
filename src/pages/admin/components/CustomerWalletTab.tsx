import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface CustomerResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  balance_cents: number | null
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
      const { data: wallets } = await supabase
        .from('customer_wallets')
        .select('customer_id, balance_cents')
        .gt('balance_cents', 0)
        .order('balance_cents', { ascending: false })

      if (wallets && wallets.length > 0) {
        const response = await fetch('/.netlify/functions/list-customers')
        const result = await response.json()
        const allCustomers = result.customers || []

        const mapped: CustomerResult[] = wallets.map(w => {
          const cust = allCustomers.find((c: any) => c.id === w.customer_id)
          return {
            id: w.customer_id,
            full_name: cust ? (`${cust.nome || ''} ${cust.cognome || ''}`.trim() || cust.ragione_sociale || cust.denominazione || 'N/A') : 'Cliente sconosciuto',
            email: cust?.email || null,
            phone: cust?.telefono || null,
            balance_cents: w.balance_cents
          }
        })
        setAllWalletCustomers(mapped)
      }
    } catch (err) {
      console.error('Error loading wallet customers:', err)
    } finally {
      setLoadingAll(false)
    }
  }

  // Website wallets
  useEffect(() => {
    async function loadWebsiteWallets() {
      try {
        const { data: creditBalances } = await supabase
          .from('user_credit_balance')
          .select('user_id, balance')
          .gt('balance', 0)

        if (creditBalances && creditBalances.length > 0) {
          for (const cb of creditBalances) {
            const existing = allWalletCustomers.find(c => c.id === cb.user_id)
            if (!existing) {
              const { data: cust } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono')
                .eq('user_id', cb.user_id)
                .maybeSingle()

              if (cust) {
                setAllWalletCustomers(prev => {
                  if (prev.find(c => c.id === cust.id)) return prev
                  return [...prev, {
                    id: cust.id,
                    full_name: `${cust.nome || ''} ${cust.cognome || ''}`.trim() || 'N/A',
                    email: cust.email,
                    phone: cust.telefono,
                    balance_cents: Math.round(cb.balance * 100)
                  }]
                })
              }
            }
          }
        }
      } catch (err) {
        console.error('Error loading website wallets:', err)
      }
    }
    if (!loadingAll) loadWebsiteWallets()
  }, [loadingAll])

  async function apiCall(body: Record<string, any>) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch('/.netlify/functions/customer-wallet-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    return res.json()
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
        setAllWalletCustomers(prev => prev.map(c =>
          c.id === modalCustomer.id ? { ...c, balance_cents: data.new_balance_cents } : c
        ))
        closeModal()
        loadAllWalletCustomers()
      } else {
        toast.error(data.error || 'Errore sconosciuto')
      }
    } catch (err: any) {
      toast.error('Errore di connessione: ' + (err.message || ''))
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

                {/* Ultime Transazioni placeholder */}
                <div className="text-xs text-theme-text-muted">
                  —
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
