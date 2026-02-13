import { useState, useEffect } from 'react'

interface DashboardProps {
  participantId: string
}

interface DashboardData {
  participant: {
    id: string
    nome: string
    cognome: string
    referral_code: string
    status: string
    created_at: string
  }
  wallet: {
    balance_cents: number
    total_earned_cents: number
    total_spent_cents: number
    total_topped_up_cents: number
  }
  referrals: {
    total: number
    qualifying: number
    progress_to_milestone: number
    next_milestone_at: number
    milestones_reached: number
  }
  friends: Array<{
    id: string
    nome: string
    cognome: string
    created_at: string
    has_topped_up: boolean
  }>
  transactions: Array<{
    id: string
    type: string
    amount_cents: number
    balance_after_cents: number
    description: string
    created_at: string
  }>
  discount_codes: Array<{
    id: string
    code: string
    amount_cents: number
    reason: string
    scope: string[]
    used: boolean
    used_at: string | null
    expires_at: string
    created_at: string
  }>
}

const API_BASE = '/.netlify/functions'

const TYPE_LABELS: Record<string, string> = {
  registration_bonus: 'Bonus Registrazione',
  referral_friend_topup: 'Bonus Amico Ricarica',
  milestone_10_friends: 'Traguardo 10 Amici',
  topup: 'Ricarica',
  booking_payment: 'Pagamento Prenotazione',
  manual_credit: 'Credito Manuale',
  manual_debit: 'Addebito Manuale',
  refund: 'Rimborso',
}

export default function ReferralDashboard({ participantId }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState('')
  const [topupLoading, setTopupLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'buoni' | 'friends' | 'transactions'>('overview')

  useEffect(() => {
    loadDashboard()
  }, [participantId])

  async function loadDashboard() {
    try {
      const res = await fetch(`${API_BASE}/referral-dashboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId }),
      })
      const json = await res.json()
      if (res.ok) setData(json)
    } catch (err) {
      console.error('Error loading dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleTopup() {
    const amount = parseFloat(topupAmount)
    if (!amount || amount < 10) return

    setTopupLoading(true)
    try {
      const res = await fetch(`${API_BASE}/referral-create-topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, amount }),
      })
      const json = await res.json()

      if (res.ok && json.paymentUrl) {
        window.location.href = json.paymentUrl
      }
    } catch (err) {
      console.error('Error creating topup:', err)
    } finally {
      setTopupLoading(false)
    }
  }

  function copyReferralLink() {
    if (!data) return
    const link = `${window.location.origin}/referral?ref=${data.participant.referral_code}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp() {
    if (!data) return
    const link = `${window.location.origin}/referral?ref=${data.participant.referral_code}`
    const text = `🔥 DR7 PAGA I SUOI UTENTI!\n\nRegistrati gratis e ricevi €15 di credito + Buono da €50 per noleggio supercar!\nUsa il mio codice: ${data.participant.referral_code}\n\n${link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return <div className="text-center text-red-400 py-10">Errore nel caricamento del dashboard</div>
  }

  const balance = (data.wallet.balance_cents / 100).toFixed(2)
  const totalEarned = (data.wallet.total_earned_cents / 100).toFixed(2)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Balance Card */}
      <div className="bg-gradient-to-br from-[#d4af37]/20 to-[#d4af37]/5 border border-[#d4af37]/30 rounded-2xl p-6 text-center">
        <p className="text-gray-400 text-sm mb-1">Il tuo saldo Wallet</p>
        <p className="text-5xl font-bold text-[#d4af37]">{balance}</p>
        <p className="text-gray-400 text-sm mt-2">Totale guadagnato: {totalEarned}</p>
      </div>

      {/* Referral Code & Share */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-2">Il tuo codice referral</p>
          <p className="text-3xl font-bold text-white font-mono tracking-widest">{data.participant.referral_code}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={copyReferralLink}
            className="flex-1 py-3 bg-white/10 border border-white/20 rounded-xl text-white font-semibold hover:bg-white/20 transition-colors text-sm"
          >
            {copied ? 'Copiato!' : 'Copia Link'}
          </button>
          <button
            onClick={shareWhatsApp}
            className="flex-1 py-3 bg-green-600 rounded-xl text-white font-semibold hover:bg-green-700 transition-colors text-sm"
          >
            Condividi WhatsApp
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{data.referrals.total}</p>
          <p className="text-gray-400 text-xs mt-1">Amici Invitati</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[#d4af37]">{data.referrals.qualifying}</p>
          <p className="text-gray-400 text-xs mt-1">Qualificati</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{data.referrals.milestones_reached}</p>
          <p className="text-gray-400 text-xs mt-1">Traguardi</p>
        </div>
      </div>

      {/* Milestone Progress */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400 text-sm">Prossimo traguardo</span>
          <span className="text-white text-sm font-semibold">
            {data.referrals.progress_to_milestone}/10 amici qualificati
          </span>
        </div>
        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#d4af37] to-yellow-500 rounded-full transition-all duration-500"
            style={{ width: `${(data.referrals.progress_to_milestone / 10) * 100}%` }}
          />
        </div>
        <p className="text-gray-500 text-xs mt-2">
          Raggiungi 10 amici qualificati per sbloccare €50 wallet + buono €500
        </p>
      </div>

      {/* Buoni Sconto Summary */}
      {data.discount_codes.length > 0 && (() => {
        const activeBuoni = data.discount_codes.filter(c => !c.used && new Date(c.expires_at) > new Date());
        return activeBuoni.length > 0 ? (
          <div className="bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20 rounded-2xl p-4 text-center">
            <p className="text-gray-400 text-sm">Buoni Sconto Attivi</p>
            <p className="text-2xl font-bold text-green-400">
              {activeBuoni.length} buon{activeBuoni.length === 1 ? 'o' : 'i'}
            </p>
            <p className="text-gray-500 text-xs mt-1">
              Valore totale: €{(activeBuoni.reduce((s, c) => s + c.amount_cents, 0) / 100).toFixed(2)} — Solo noleggio supercar
            </p>
          </div>
        ) : null;
      })()}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['overview', 'buoni', 'friends', 'transactions'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-[#d4af37] text-black'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab === 'overview' ? 'Ricarica' : tab === 'buoni' ? 'Buoni Sconto' : tab === 'friends' ? 'Amici' : 'Transazioni'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h3 className="text-white font-semibold text-lg">Ricarica Wallet</h3>
          <div className="flex gap-3">
            {[50, 100, 200, 500].map((amt) => (
              <button
                key={amt}
                onClick={() => setTopupAmount(String(amt))}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  topupAmount === String(amt)
                    ? 'bg-[#d4af37] text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {amt}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></span>
              <input
                type="number"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                className="w-full pl-8 pr-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white focus:border-[#d4af37] outline-none"
                placeholder="Importo"
                min="10"
              />
            </div>
            <button
              onClick={handleTopup}
              disabled={topupLoading || !topupAmount || parseFloat(topupAmount) < 10}
              className="px-6 py-3 bg-[#d4af37] text-black font-bold rounded-xl hover:bg-[#c4a030] transition-colors disabled:opacity-50"
            >
              {topupLoading ? '...' : 'Ricarica'}
            </button>
          </div>
          <p className="text-gray-500 text-xs">Importo minimo: €10. Pagamento sicuro via Nexi.</p>
        </div>
      )}

      {activeTab === 'buoni' && (
        <div className="space-y-2">
          {data.discount_codes.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-4xl mb-3">🎫</p>
              <p>Nessun buono sconto generato.</p>
              <p className="text-sm mt-1">Registrati o invita amici per ricevere buoni!</p>
            </div>
          ) : (
            data.discount_codes.map((dc) => {
              const isExpired = new Date(dc.expires_at) < new Date();
              const isActive = !dc.used && !isExpired;
              return (
                <div
                  key={dc.id}
                  className={`border rounded-xl p-4 ${
                    isActive
                      ? 'bg-green-500/5 border-green-500/20'
                      : 'bg-white/5 border-white/10 opacity-60'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-mono font-bold tracking-wider">{dc.code}</span>
                        {isActive && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(dc.code);
                              setCopiedCode(dc.code);
                              setTimeout(() => setCopiedCode(null), 2000);
                            }}
                            className="text-xs px-2 py-0.5 bg-white/10 text-gray-300 rounded hover:bg-white/20 transition-colors"
                          >
                            {copiedCode === dc.code ? 'Copiato!' : 'Copia'}
                          </button>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs">
                        {dc.reason === 'registration' ? 'Bonus registrazione' :
                         dc.reason === 'friend_topup' ? 'Bonus amico ricarica' :
                         'Traguardo 10 amici'}
                        {' · '}Scade {new Date(dc.expires_at).toLocaleDateString('it-IT')}
                      </p>
                      <p className="text-gray-600 text-xs mt-0.5">Solo noleggio supercar</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-bold ${isActive ? 'text-green-400' : 'text-gray-500'}`}>
                        €{(dc.amount_cents / 100).toFixed(0)}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        dc.used ? 'bg-gray-500/20 text-gray-400' :
                        isExpired ? 'bg-red-500/20 text-red-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>
                        {dc.used ? 'Utilizzato' : isExpired ? 'Scaduto' : 'Attivo'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="space-y-2">
          {data.friends.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-4xl mb-3">👥</p>
              <p>Non hai ancora invitato nessuno.</p>
              <p className="text-sm mt-1">Condividi il tuo codice per iniziare!</p>
            </div>
          ) : (
            data.friends.map((friend) => (
              <div key={friend.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <p className="text-white font-medium">{friend.nome} {friend.cognome}</p>
                  <p className="text-gray-500 text-xs">
                    {new Date(friend.created_at).toLocaleDateString('it-IT')}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  friend.has_topped_up
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {friend.has_topped_up ? 'Qualificato' : 'In attesa'}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="space-y-2">
          {data.transactions.length === 0 ? (
            <div className="text-center py-10 text-gray-400">Nessuna transazione</div>
          ) : (
            data.transactions.map((txn) => (
              <div key={txn.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <p className="text-white text-sm font-medium">{TYPE_LABELS[txn.type] || txn.type}</p>
                  <p className="text-gray-500 text-xs">
                    {new Date(txn.created_at).toLocaleDateString('it-IT', {
                      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                <span className={`font-bold ${txn.amount_cents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {txn.amount_cents >= 0 ? '+' : ''}{(txn.amount_cents / 100).toFixed(2)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
