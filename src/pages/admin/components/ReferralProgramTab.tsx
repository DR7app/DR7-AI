import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface Participant {
  id: string
  nome: string
  cognome: string
  telefono: string
  email: string | null
  referral_code: string
  referred_by: string | null
  phone_verified: boolean
  status: 'active' | 'suspended' | 'banned'
  registration_ip: string | null
  device_fingerprint: string | null
  created_at: string
  wallets?: Array<{
    balance_cents: number
    total_earned_cents: number
    total_topped_up_cents: number
  }>
}

interface ProgramStats {
  total_participants: number
  total_referred: number
  outstanding_balance_cents: number
  total_credits_distributed_cents: number
  total_topups_cents: number
  total_topup_count: number
  participants_with_topups: number
  total_buoni_generated: number
  total_buoni_used: number
  total_buoni_active: number
  total_buoni_value_cents: number
}

interface DiscountCode {
  id: string
  participant_id: string
  code: string
  amount_cents: number
  reason: string
  scope: string[]
  used: boolean
  used_at: string | null
  expires_at: string
  created_at: string
  referral_participants?: {
    nome: string
    cognome: string
    telefono: string
    referral_code: string
  }
}

interface WalletTransaction {
  id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string
  admin_user_id: string | null
  created_at: string
}

type ActiveSection = 'overview' | 'participants' | 'buoni' | 'fraud'

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

export default function ReferralProgramTab() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('overview')
  const [stats, setStats] = useState<ProgramStats | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Detail panel
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null)
  const [detailTransactions, setDetailTransactions] = useState<WalletTransaction[]>([])
  const [detailReferrals, setDetailReferrals] = useState<Participant[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Manual credit/debit
  const [creditDebitAmount, setCreditDebitAmount] = useState('')
  const [creditDebitNotes, setCreditDebitNotes] = useState('')
  const [creditDebitLoading, setCreditDebitLoading] = useState(false)

  // Discount codes
  const [detailDiscountCodes, setDetailDiscountCodes] = useState<DiscountCode[]>([])
  const [allDiscountCodes, setAllDiscountCodes] = useState<DiscountCode[]>([])
  const [buoniLoading, setBuoniLoading] = useState(false)

  // Fraud data
  const [fraudData, setFraudData] = useState<any>(null)
  const [fraudLoading, setFraudLoading] = useState(false)

  useEffect(() => {
    loadStats()
    loadParticipants()
  }, [])

  useEffect(() => {
    if (activeSection === 'fraud' && !fraudData) {
      loadFraudData()
    }
    if (activeSection === 'buoni' && allDiscountCodes.length === 0) {
      loadAllDiscountCodes()
    }
  }, [activeSection])

  async function loadStats() {
    const { data } = await supabase
      .from('referral_program_stats')
      .select('*')
      .single()
    if (data) setStats(data)
  }

  async function loadParticipants() {
    setLoading(true)
    const { data } = await supabase
      .from('referral_participants')
      .select('*, wallets(balance_cents, total_earned_cents, total_topped_up_cents)')
      .order('created_at', { ascending: false })
    if (data) setParticipants(data)
    setLoading(false)
  }

  async function loadParticipantDetail(participant: Participant) {
    setSelectedParticipant(participant)
    setDetailLoading(true)

    // Load wallet & transactions
    const { data: wallet } = await supabase
      .from('wallets')
      .select('id')
      .eq('participant_id', participant.id)
      .single()

    if (wallet) {
      const { data: txns } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false })
        .limit(50)
      setDetailTransactions(txns || [])
    }

    // Load referrals by this participant
    const { data: refs } = await supabase
      .from('referral_participants')
      .select('*')
      .eq('referred_by', participant.id)
      .order('created_at', { ascending: false })
    setDetailReferrals(refs || [])

    // Load discount codes for this participant
    const { data: codes } = await supabase
      .from('referral_discount_codes')
      .select('*')
      .eq('participant_id', participant.id)
      .order('created_at', { ascending: false })
    setDetailDiscountCodes(codes || [])

    setDetailLoading(false)
  }

  async function loadAllDiscountCodes() {
    setBuoniLoading(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/.netlify/functions/referral-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'discount_codes' }),
      })
      const data = await res.json()
      if (data.success) setAllDiscountCodes(data.discount_codes)
    } catch (err) {
      console.error('Error loading discount codes:', err)
    }
    setBuoniLoading(false)
  }

  async function loadFraudData() {
    setFraudLoading(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/.netlify/functions/referral-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'fraud_check' }),
      })
      const data = await res.json()
      if (data.success) setFraudData(data)
    } catch (err) {
      console.error('Error loading fraud data:', err)
    }
    setFraudLoading(false)
  }

  async function handleCreditDebit(action: 'credit' | 'debit') {
    if (!selectedParticipant || !creditDebitAmount) return
    const amount = parseFloat(creditDebitAmount)
    if (!amount || amount <= 0) {
      toast.error('Inserisci un importo valido')
      return
    }

    setCreditDebitLoading(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/.netlify/functions/referral-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          participant_id: selectedParticipant.id,
          amount,
          notes: creditDebitNotes || undefined,
        }),
      })
      const data = await res.json()

      if (data.success) {
        toast.success(`${action === 'credit' ? 'Credito' : 'Addebito'} applicato`)
        setCreditDebitAmount('')
        setCreditDebitNotes('')
        loadParticipants()
        loadStats()
        loadParticipantDetail(selectedParticipant)
      } else {
        toast.error(data.error || 'Errore')
      }
    } catch {
      toast.error('Errore di connessione')
    }
    setCreditDebitLoading(false)
  }

  async function handleStatusChange(participantId: string, action: 'suspend' | 'ban' | 'activate') {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/.netlify/functions/referral-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, participant_id: participantId }),
      })
      const data = await res.json()

      if (data.success) {
        toast.success(`Stato aggiornato: ${data.new_status}`)
        loadParticipants()
        if (selectedParticipant?.id === participantId) {
          setSelectedParticipant({ ...selectedParticipant, status: data.new_status })
        }
      }
    } catch {
      toast.error('Errore')
    }
  }

  const filteredParticipants = participants.filter((p) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      p.nome.toLowerCase().includes(q) ||
      p.cognome.toLowerCase().includes(q) ||
      p.telefono.includes(q) ||
      p.referral_code.toLowerCase().includes(q) ||
      (p.email && p.email.toLowerCase().includes(q))
    )
  })

  const formatEur = (cents: number) => `€${(cents / 100).toFixed(2)}`

  return (
    <div className="space-y-6">
      {/* Section Toggle */}
      <div className="flex gap-2 flex-wrap">
        {(['overview', 'participants', 'buoni', 'fraud'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeSection === section
                ? 'bg-dr7-gold text-black'
                : 'bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            {section === 'overview' ? 'Panoramica' : section === 'participants' ? 'Partecipanti' : section === 'buoni' ? 'Buoni Sconto' : 'Antifrode'}
          </button>
        ))}
      </div>

      {/* === OVERVIEW === */}
      {activeSection === 'overview' && (
        <div className="animate-fadeIn space-y-6">
          {stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Partecipanti" value={stats.total_participants} />
                <StatCard label="Referral Attivi" value={stats.total_referred} />
                <StatCard label="Saldo Totale in Circolo" value={formatEur(stats.outstanding_balance_cents)} />
                <StatCard label="Crediti Distribuiti" value={formatEur(stats.total_credits_distributed_cents)} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard label="Tot. Ricariche" value={formatEur(stats.total_topups_cents)} />
                <StatCard label="N. Ricariche" value={stats.total_topup_count} />
                <StatCard
                  label="Conversione Ricarica"
                  value={
                    stats.total_participants > 0
                      ? `${((stats.participants_with_topups / stats.total_participants) * 100).toFixed(1)}%`
                      : '0%'
                  }
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Buoni Generati" value={stats.total_buoni_generated} />
                <StatCard label="Buoni Utilizzati" value={stats.total_buoni_used} />
                <StatCard label="Buoni Attivi" value={stats.total_buoni_active} />
                <StatCard label="Valore Buoni Attivi" value={formatEur(stats.total_buoni_value_cents)} />
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-theme-text-muted">Caricamento statistiche...</div>
          )}
        </div>
      )}

      {/* === PARTICIPANTS === */}
      {activeSection === 'participants' && (
        <div className="animate-fadeIn space-y-4">
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca per nome, telefono, codice..."
            className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary placeholder-theme-text-muted focus:border-dr7-gold outline-none"
          />

          <div className="flex gap-4">
            {/* Participants Table */}
            <div className={`${selectedParticipant ? 'w-1/2' : 'w-full'} space-y-2 transition-all`}>
              {loading ? (
                <div className="text-center py-10 text-theme-text-muted">Caricamento...</div>
              ) : filteredParticipants.length === 0 ? (
                <div className="text-center py-10 text-theme-text-muted">Nessun partecipante trovato</div>
              ) : (
                <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                  {filteredParticipants.map((p) => {
                    const wallet = p.wallets?.[0]
                    return (
                      <div
                        key={p.id}
                        onClick={() => loadParticipantDetail(p)}
                        className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                          selectedParticipant?.id === p.id
                            ? 'bg-dr7-gold/10 border-dr7-gold/30'
                            : 'bg-theme-bg-secondary border-theme-border hover:border-dr7-gold/20'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-theme-text-primary font-semibold">
                              {p.nome} {p.cognome}
                            </p>
                            <p className="text-theme-text-muted text-sm">{p.telefono}</p>
                            <p className="text-theme-text-muted text-xs font-mono">{p.referral_code}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-dr7-gold font-bold">
                              {wallet ? formatEur(wallet.balance_cents) : '€0.00'}
                            </p>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              p.status === 'active' ? 'bg-green-500/20 text-green-400' :
                              p.status === 'suspended' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                              {p.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Detail Panel */}
            {selectedParticipant && (
              <div className="w-1/2 bg-theme-bg-secondary border border-theme-border rounded-xl p-5 space-y-4 max-h-[70vh] overflow-y-auto animate-fadeIn">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-theme-text-primary font-bold text-lg">
                      {selectedParticipant.nome} {selectedParticipant.cognome}
                    </h3>
                    <p className="text-theme-text-muted text-sm">{selectedParticipant.telefono}</p>
                    {selectedParticipant.email && (
                      <p className="text-theme-text-muted text-sm">{selectedParticipant.email}</p>
                    )}
                    <p className="text-theme-text-muted text-xs font-mono mt-1">{selectedParticipant.referral_code}</p>
                  </div>
                  <button
                    onClick={() => setSelectedParticipant(null)}
                    className="text-theme-text-muted hover:text-theme-text-primary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Status Actions */}
                <div className="flex gap-2 flex-wrap">
                  {selectedParticipant.status !== 'active' && (
                    <button
                      onClick={() => handleStatusChange(selectedParticipant.id, 'activate')}
                      className="px-3 py-1 text-xs bg-green-500/20 text-green-400 rounded-full hover:bg-green-500/30"
                    >
                      Attiva
                    </button>
                  )}
                  {selectedParticipant.status !== 'suspended' && (
                    <button
                      onClick={() => handleStatusChange(selectedParticipant.id, 'suspend')}
                      className="px-3 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded-full hover:bg-yellow-500/30"
                    >
                      Sospendi
                    </button>
                  )}
                  {selectedParticipant.status !== 'banned' && (
                    <button
                      onClick={() => handleStatusChange(selectedParticipant.id, 'ban')}
                      className="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded-full hover:bg-red-500/30"
                    >
                      Banna
                    </button>
                  )}
                </div>

                {/* Manual Credit/Debit */}
                <div className="border-t border-theme-border pt-4">
                  <h4 className="text-theme-text-primary font-semibold text-sm mb-2">Credito / Addebito Manuale</h4>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="number"
                      value={creditDebitAmount}
                      onChange={(e) => setCreditDebitAmount(e.target.value)}
                      placeholder="Importo €"
                      className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm"
                      min="0.01"
                      step="0.01"
                    />
                  </div>
                  <input
                    type="text"
                    value={creditDebitNotes}
                    onChange={(e) => setCreditDebitNotes(e.target.value)}
                    placeholder="Note (opzionale)"
                    className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCreditDebit('credit')}
                      disabled={creditDebitLoading || !creditDebitAmount}
                      className="flex-1 px-3 py-2 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-50"
                    >
                      + Credita
                    </button>
                    <button
                      onClick={() => handleCreditDebit('debit')}
                      disabled={creditDebitLoading || !creditDebitAmount}
                      className="flex-1 px-3 py-2 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50"
                    >
                      - Addebita
                    </button>
                  </div>
                </div>

                {/* Referrals */}
                {detailReferrals.length > 0 && (
                  <div className="border-t border-theme-border pt-4">
                    <h4 className="text-theme-text-primary font-semibold text-sm mb-2">
                      Amici Invitati ({detailReferrals.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {detailReferrals.map((r) => (
                        <div key={r.id} className="flex justify-between text-xs text-theme-text-muted">
                          <span>{r.nome} {r.cognome}</span>
                          <span>{new Date(r.created_at).toLocaleDateString('it-IT')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Discount Codes */}
                {detailDiscountCodes.length > 0 && (
                  <div className="border-t border-theme-border pt-4">
                    <h4 className="text-theme-text-primary font-semibold text-sm mb-2">
                      Buoni Sconto ({detailDiscountCodes.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {detailDiscountCodes.map((dc) => {
                        const isExpired = new Date(dc.expires_at) < new Date();
                        return (
                          <div key={dc.id} className="flex justify-between text-xs py-1">
                            <div>
                              <span className="text-theme-text-primary font-mono">{dc.code}</span>
                              <span className="text-theme-text-muted ml-2">
                                {dc.reason === 'registration' ? 'Registr.' : dc.reason === 'friend_topup' ? 'Amico' : 'Traguardo'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-theme-text-primary">{formatEur(dc.amount_cents)}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                dc.used ? 'bg-gray-500/20 text-gray-400' :
                                isExpired ? 'bg-red-500/20 text-red-400' :
                                'bg-green-500/20 text-green-400'
                              }`}>
                                {dc.used ? 'Usato' : isExpired ? 'Scaduto' : 'Attivo'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Transactions */}
                <div className="border-t border-theme-border pt-4">
                  <h4 className="text-theme-text-primary font-semibold text-sm mb-2">Transazioni Recenti</h4>
                  {detailLoading ? (
                    <p className="text-theme-text-muted text-xs">Caricamento...</p>
                  ) : detailTransactions.length === 0 ? (
                    <p className="text-theme-text-muted text-xs">Nessuna transazione</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {detailTransactions.map((txn) => (
                        <div key={txn.id} className="flex justify-between items-center text-xs py-1">
                          <div>
                            <span className="text-theme-text-primary">{TYPE_LABELS[txn.type] || txn.type}</span>
                            <span className="text-theme-text-muted ml-2">
                              {new Date(txn.created_at).toLocaleDateString('it-IT')}
                            </span>
                          </div>
                          <span className={txn.amount_cents >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {txn.amount_cents >= 0 ? '+' : ''}{formatEur(txn.amount_cents)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === BUONI SCONTO === */}
      {activeSection === 'buoni' && (
        <div className="animate-fadeIn space-y-4">
          {buoniLoading ? (
            <div className="text-center py-10 text-theme-text-muted">Caricamento buoni...</div>
          ) : allDiscountCodes.length === 0 ? (
            <div className="text-center py-10 text-theme-text-muted">Nessun buono sconto generato</div>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {allDiscountCodes.map((dc) => {
                const isExpired = new Date(dc.expires_at) < new Date();
                const participant = dc.referral_participants;
                return (
                  <div
                    key={dc.id}
                    className={`p-4 rounded-xl border ${
                      dc.used ? 'bg-theme-bg-secondary border-theme-border opacity-60' :
                      isExpired ? 'bg-red-500/5 border-red-500/20 opacity-60' :
                      'bg-green-500/5 border-green-500/20'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-theme-text-primary font-mono font-bold tracking-wider">{dc.code}</p>
                        <p className="text-theme-text-muted text-sm">
                          {participant ? `${participant.nome} ${participant.cognome} (${participant.telefono})` : dc.participant_id}
                        </p>
                        <p className="text-theme-text-muted text-xs mt-1">
                          {dc.reason === 'registration' ? 'Bonus Registrazione' :
                           dc.reason === 'friend_topup' ? 'Bonus Amico Ricarica' :
                           'Traguardo 10 Amici'}
                          {' · '}Creato {new Date(dc.created_at).toLocaleDateString('it-IT')}
                          {' · '}Scade {new Date(dc.expires_at).toLocaleDateString('it-IT')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-theme-text-primary">{formatEur(dc.amount_cents)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          dc.used ? 'bg-gray-500/20 text-gray-400' :
                          isExpired ? 'bg-red-500/20 text-red-400' :
                          'bg-green-500/20 text-green-400'
                        }`}>
                          {dc.used ? `Usato ${dc.used_at ? new Date(dc.used_at).toLocaleDateString('it-IT') : ''}` : isExpired ? 'Scaduto' : 'Attivo'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === FRAUD === */}
      {activeSection === 'fraud' && (
        <div className="animate-fadeIn space-y-6">
          {fraudLoading ? (
            <div className="text-center py-10 text-theme-text-muted">Analisi antifrode in corso...</div>
          ) : fraudData ? (
            <>
              {/* Suspicious IPs */}
              <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-5">
                <h3 className="text-theme-text-primary font-bold mb-3">
                  IP Sospetti ({fraudData.suspicious_ips?.length || 0})
                </h3>
                {(fraudData.suspicious_ips || []).length === 0 ? (
                  <p className="text-green-400 text-sm">Nessun cluster IP sospetto rilevato</p>
                ) : (
                  <div className="space-y-3">
                    {fraudData.suspicious_ips.map((item: any, i: number) => (
                      <div key={i} className="bg-theme-bg-primary rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-theme-text-primary font-mono text-sm">{item.ip}</span>
                          <span className="text-red-400 text-sm font-bold">{item.count} registrazioni</span>
                        </div>
                        <div className="space-y-1">
                          {item.entries.slice(0, 5).map((e: any, j: number) => (
                            <p key={j} className="text-theme-text-muted text-xs">
                              {e.nome} {e.cognome} - {e.telefono} ({new Date(e.created_at).toLocaleDateString('it-IT')})
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Suspicious Fingerprints */}
              <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-5">
                <h3 className="text-theme-text-primary font-bold mb-3">
                  Fingerprint Sospetti ({fraudData.suspicious_fingerprints?.length || 0})
                </h3>
                {(fraudData.suspicious_fingerprints || []).length === 0 ? (
                  <p className="text-green-400 text-sm">Nessun fingerprint duplicato rilevato</p>
                ) : (
                  <div className="space-y-3">
                    {fraudData.suspicious_fingerprints.map((item: any, i: number) => (
                      <div key={i} className="bg-theme-bg-primary rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-theme-text-primary font-mono text-xs">{item.fingerprint.slice(0, 16)}...</span>
                          <span className="text-red-400 text-sm font-bold">{item.count} registrazioni</span>
                        </div>
                        <div className="space-y-1">
                          {item.entries.slice(0, 5).map((e: any, j: number) => (
                            <p key={j} className="text-theme-text-muted text-xs">
                              {e.nome} {e.cognome} - {e.telefono}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Unverified Phones */}
              <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-5">
                <h3 className="text-theme-text-primary font-bold mb-3">
                  Telefoni Non Verificati ({fraudData.unverified_phones?.length || 0})
                </h3>
                {(fraudData.unverified_phones || []).length === 0 ? (
                  <p className="text-green-400 text-sm">Tutti i telefoni sono verificati</p>
                ) : (
                  <div className="space-y-1">
                    {fraudData.unverified_phones.map((p: any) => (
                      <p key={p.id} className="text-theme-text-muted text-xs">
                        {p.nome} {p.cognome} - {p.telefono} ({new Date(p.created_at).toLocaleDateString('it-IT')})
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-theme-text-muted">Errore nel caricamento dati antifrode</div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
      <p className="text-theme-text-muted text-xs mb-1">{label}</p>
      <p className="text-theme-text-primary text-xl font-bold">{value}</p>
    </div>
  )
}
