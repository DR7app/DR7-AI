import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface CustomerResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  balance_cents: number | null
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

export default function CustomerWalletTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // All customers with wallets (auto-loaded)
  const [allWalletCustomers, setAllWalletCustomers] = useState<CustomerResult[]>([])
  const [loadingAll, setLoadingAll] = useState(true)

  useEffect(() => {
    loadAllWalletCustomers()
  }, [])

  async function loadAllWalletCustomers() {
    setLoadingAll(true)
    try {
      // Fetch all wallets with balance > 0
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

  // Also check user_credit_balance for website wallets
  useEffect(() => {
    async function loadWebsiteWallets() {
      try {
        const { data: creditBalances } = await supabase
          .from('user_credit_balance')
          .select('user_id, balance')
          .gt('balance', 0)

        if (creditBalances && creditBalances.length > 0) {
          // Find matching customers
          for (const cb of creditBalances) {
            const existing = allWalletCustomers.find(c => c.id === cb.user_id)
            if (!existing) {
              // Try to find customer by user_id
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

  // Selected customer detail
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Credit/Debit form
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // OTP verification
  const [otpCode, setOtpCode] = useState('')
  const [sentOtp, setSentOtp] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [pendingAction, setPendingAction] = useState<'credit' | 'debit' | null>(null)

  async function sendOtp(action: 'credit' | 'debit') {
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('Inserisci un importo valido')
      return
    }
    if (!selectedCustomer) return

    setOtpSending(true)
    setPendingAction(action)
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      setSentOtp(code)

      const actionLabel = action === 'credit' ? 'CREDITO' : 'ADDEBITO'
      const message = `🔐 *CODICE VERIFICA WALLET*\n\n*Operazione:* ${actionLabel}\n*Cliente:* ${selectedCustomer.full_name}\n*Importo:* €${parsedAmount.toFixed(2)}\n${description ? `*Descrizione:* ${description}\n` : ''}\n*Codice:* ${code}\n\nComunica questo codice all'operatore per autorizzare l'operazione.`

      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customPhone: '393472817258',
          customMessage: message
        })
      })

      setOtpSent(true)
      setOtpVerified(false)
      setOtpCode('')
      toast.success('Codice di verifica inviato via WhatsApp')
    } catch (err) {
      toast.error('Errore invio codice')
    } finally {
      setOtpSending(false)
    }
  }

  function verifyOtp() {
    if (otpCode === sentOtp) {
      setOtpVerified(true)
      toast.success('Codice verificato!')
    } else {
      toast.error('Codice errato')
    }
  }

  async function apiCall(body: Record<string, any>) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch('/.netlify/functions/customer-wallet-admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async function handleSearch() {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      toast.error('Inserisci almeno 2 caratteri')
      return
    }

    setSearching(true)
    setHasSearched(true)
    try {
      const data = await apiCall({ action: 'search', query: searchQuery.trim() })
      if (data.success) {
        setSearchResults(data.customers)
      } else {
        toast.error(data.error || 'Errore ricerca')
      }
    } catch {
      toast.error('Errore di connessione')
    }
    setSearching(false)
  }

  async function loadCustomerDetail(customer: CustomerResult) {
    setSelectedCustomer(customer)
    setDetailLoading(true)
    setAmount('')
    setDescription('')

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

  async function handleCreditDebit(action: 'credit' | 'debit') {
    if (!selectedCustomer || !amount) return
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('Inserisci un importo valido')
      return
    }

    // Require OTP verification
    if (!otpVerified || pendingAction !== action) {
      sendOtp(action)
      return
    }

    setActionLoading(true)
    try {
      const data = await apiCall({
        action,
        customer_id: selectedCustomer.id,
        amount: parsedAmount,
        description: description || undefined,
      })

      if (data.success) {
        toast.success(`${action === 'credit' ? 'Credito' : 'Addebito'} di €${parsedAmount.toFixed(2)} applicato`)
        setAmount('')
        setDescription('')
        // Reset OTP
        setOtpCode('')
        setSentOtp('')
        setOtpSent(false)
        setOtpVerified(false)
        setPendingAction(null)
        // Refresh detail
        loadCustomerDetail(selectedCustomer)
        // Update balance in search results
        setSearchResults(prev => prev.map(c =>
          c.id === selectedCustomer.id
            ? { ...c, balance_cents: data.new_balance_cents }
            : c
        ))
      } else {
        console.error('Wallet error:', data)
        toast.error(data.error || 'Errore sconosciuto')
      }
    } catch (err: any) {
      console.error('Wallet connection error:', err)
      toast.error('Errore di connessione: ' + (err.message || ''))
    }
    setActionLoading(false)
  }

  const formatEur = (cents: number) => `€${(cents / 100).toFixed(2)}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
        <h2 className="text-xl font-bold text-theme-text-primary">Credit Wallet Clienti</h2>
        <p className="text-theme-text-muted text-sm">Cerca un cliente per gestire il suo credito wallet</p>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="flex-1 bg-theme-bg-tertiary p-3 rounded-xl border border-theme-border">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Cerca per nome, email o telefono..."
            className="w-full bg-transparent text-theme-text-primary outline-none"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching}
          className="px-6 py-3 bg-dr7-gold text-black font-semibold rounded-xl hover:bg-yellow-500 transition-colors disabled:opacity-50"
        >
          {searching ? 'Cercando...' : 'Cerca'}
        </button>
      </div>

      {/* Search Results + Detail */}
      <div className="flex gap-4">
        {/* Results List */}
        <div className={`${selectedCustomer ? 'w-1/2' : 'w-full'} transition-all`}>
          {/* Summary */}
          {allWalletCustomers.length > 0 && !hasSearched && (
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                <p className="text-xs text-theme-text-muted">Clienti con Wallet</p>
                <p className="text-2xl font-bold text-theme-text-primary">{allWalletCustomers.length}</p>
              </div>
              <div className="bg-dr7-gold/10 rounded-xl border border-dr7-gold/30 p-4">
                <p className="text-xs text-theme-text-muted">Credito Totale</p>
                <p className="text-2xl font-bold text-dr7-gold">{formatEur(allWalletCustomers.reduce((s, c) => s + (c.balance_cents || 0), 0))}</p>
              </div>
            </div>
          )}

          {searching || loadingAll ? (
            <div className="text-center py-10 text-theme-text-muted">{searching ? 'Ricerca in corso...' : 'Caricamento wallet...'}</div>
          ) : hasSearched && searchResults.length === 0 ? (
            <div className="text-center py-10 text-theme-text-muted">Nessun cliente trovato</div>
          ) : (hasSearched ? searchResults : allWalletCustomers).length > 0 ? (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {(hasSearched ? searchResults : allWalletCustomers).map((customer) => (
                <div
                  key={customer.id}
                  onClick={() => loadCustomerDetail(customer)}
                  className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                    selectedCustomer?.id === customer.id
                      ? 'bg-dr7-gold/10 border-dr7-gold/30'
                      : 'bg-theme-bg-secondary border-theme-border hover:border-dr7-gold/20'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-theme-text-primary font-semibold">{customer.full_name}</p>
                      <p className="text-theme-text-muted text-sm">{customer.email || '-'}</p>
                      {customer.phone && (
                        <p className="text-theme-text-muted text-xs">{customer.phone}</p>
                      )}
                    </div>
                    <div className="text-right">
                      {customer.balance_cents !== null ? (
                        <p className="text-dr7-gold font-bold">{formatEur(customer.balance_cents)}</p>
                      ) : (
                        <p className="text-theme-text-muted text-sm">Nessun wallet</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !hasSearched ? (
            <div className="text-center py-16 text-theme-text-muted">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p>Usa la barra di ricerca per trovare un cliente</p>
            </div>
          ) : null}
        </div>

        {/* Detail Panel */}
        {selectedCustomer && (
          <div className="w-1/2 bg-theme-bg-secondary border border-theme-border rounded-xl p-5 space-y-4 max-h-[70vh] overflow-y-auto animate-fadeIn">
            {/* Customer Info */}
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-theme-text-primary font-bold text-lg">{selectedCustomer.full_name}</h3>
                <p className="text-theme-text-muted text-sm">{selectedCustomer.email || '-'}</p>
                {selectedCustomer.phone && (
                  <p className="text-theme-text-muted text-xs">{selectedCustomer.phone}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {detailLoading ? (
              <div className="text-center py-6 text-theme-text-muted">Caricamento...</div>
            ) : (
              <>
                {/* Balance Card */}
                <div className="bg-theme-bg-primary rounded-xl p-4 border border-theme-border">
                  <p className="text-theme-text-muted text-xs mb-1">Saldo Attuale</p>
                  <p className="text-3xl font-bold text-dr7-gold">
                    {wallet ? formatEur(wallet.balance_cents) : '€0.00'}
                  </p>
                  {wallet && (
                    <div className="flex gap-4 mt-2 text-xs text-theme-text-muted">
                      <span>Totale guadagnato: {formatEur(wallet.total_earned_cents)}</span>
                      <span>Totale speso: {formatEur(wallet.total_spent_cents)}</span>
                    </div>
                  )}
                </div>

                {/* Credit/Debit Form */}
                <div className="border-t border-theme-border pt-4">
                  <h4 className="text-theme-text-primary font-semibold text-sm mb-2">Credito / Addebito</h4>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Importo €"
                      className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm"
                      min="0.01"
                      step="0.01"
                    />
                  </div>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrizione (opzionale)"
                    className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm mb-2"
                  />
                  {/* OTP Verification */}
                  {otpSent && !otpVerified && (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-2">
                      <p className="text-blue-400 text-xs mb-2">Codice inviato via WhatsApp. Inserisci il codice per confermare:</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
                          placeholder="Codice a 6 cifre"
                          maxLength={6}
                          className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm text-center tracking-widest font-mono"
                        />
                        <button
                          onClick={verifyOtp}
                          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                        >
                          Verifica
                        </button>
                      </div>
                    </div>
                  )}

                  {otpVerified && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2 mb-2 text-center">
                      <p className="text-green-400 text-xs font-semibold">Codice verificato — clicca per confermare l'operazione</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCreditDebit('credit')}
                      disabled={actionLoading || otpSending || !amount}
                      className="flex-1 px-3 py-2 text-sm bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-50 font-medium"
                    >
                      {otpSending && pendingAction === 'credit' ? 'Invio codice...' : otpVerified && pendingAction === 'credit' ? 'Conferma Credito' : '+ Credita'}
                    </button>
                    <button
                      onClick={() => handleCreditDebit('debit')}
                      disabled={actionLoading || otpSending || !amount}
                      className="flex-1 px-3 py-2 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 font-medium"
                    >
                      {otpSending && pendingAction === 'debit' ? 'Invio codice...' : otpVerified && pendingAction === 'debit' ? 'Conferma Addebito' : '- Addebita'}
                    </button>
                  </div>
                </div>

                {/* Transactions */}
                <div className="border-t border-theme-border pt-4">
                  <h4 className="text-theme-text-primary font-semibold text-sm mb-2">
                    Transazioni Recenti ({transactions.length})
                  </h4>
                  {transactions.length === 0 ? (
                    <p className="text-theme-text-muted text-xs">Nessuna transazione</p>
                  ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {transactions.map((txn) => (
                        <div key={txn.id} className="flex justify-between items-center text-xs py-2 border-b border-theme-border/30 last:border-0">
                          <div>
                            <span className="text-theme-text-primary font-medium">
                              {TYPE_LABELS[txn.type] || txn.type}
                            </span>
                            {txn.description && (
                              <p className="text-theme-text-muted text-xs truncate max-w-[200px]">{txn.description}</p>
                            )}
                            <span className="text-theme-text-muted ml-0 block">
                              {new Date(txn.created_at).toLocaleString('it-IT', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className={`font-bold ${txn.amount_cents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {txn.amount_cents >= 0 ? '+' : ''}{formatEur(txn.amount_cents)}
                            </span>
                            <p className="text-theme-text-muted text-xs">
                              Saldo: {formatEur(txn.balance_after_cents)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
