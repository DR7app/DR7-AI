import { useState } from 'react'
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

  // Selected customer detail
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Credit/Debit form
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

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
        // Refresh detail
        loadCustomerDetail(selectedCustomer)
        // Update balance in search results
        setSearchResults(prev => prev.map(c =>
          c.id === selectedCustomer.id
            ? { ...c, balance_cents: data.new_balance_cents }
            : c
        ))
      } else {
        toast.error(data.error || 'Errore')
      }
    } catch {
      toast.error('Errore di connessione')
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
          {searching ? (
            <div className="text-center py-10 text-theme-text-muted">Ricerca in corso...</div>
          ) : hasSearched && searchResults.length === 0 ? (
            <div className="text-center py-10 text-theme-text-muted">Nessun cliente trovato</div>
          ) : searchResults.length > 0 ? (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {searchResults.map((customer) => (
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
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCreditDebit('credit')}
                      disabled={actionLoading || !amount}
                      className="flex-1 px-3 py-2 text-sm bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-50 font-medium"
                    >
                      + Credita
                    </button>
                    <button
                      onClick={() => handleCreditDebit('debit')}
                      disabled={actionLoading || !amount}
                      className="flex-1 px-3 py-2 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 font-medium"
                    >
                      - Addebita
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
