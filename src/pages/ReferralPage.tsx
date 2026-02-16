import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReferralRegistrationForm from './referral/ReferralRegistrationForm'
import ReferralDashboard from './referral/ReferralDashboard'
import ReferralRewardTiers from './referral/ReferralRewardTiers'

export default function ReferralPage() {
  const [searchParams] = useSearchParams()
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [initialBalance, setInitialBalance] = useState(0)

  const refCode = searchParams.get('ref') || ''

  // Check localStorage for returning users
  useEffect(() => {
    const savedId = localStorage.getItem('dr7_referral_participant_id')
    if (savedId) {
      setParticipantId(savedId)
    }
  }, [])

  function handleRegistered(data: { participant_id: string; referral_code: string; balance_cents: number }) {
    localStorage.setItem('dr7_referral_participant_id', data.participant_id)
    setParticipantId(data.participant_id)
    setInitialBalance(data.balance_cents)
    if (data.balance_cents > 0) {
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 5000)
    }
  }

  return (
    <div className="min-h-screen bg-[#0d0d1a]">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d0d1a] via-[#1a1a2e] to-[#16213e]" />
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }} />
      </div>

      {/* Header */}
      <header className="border-b border-white/10 bg-[#0d0d1a]/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/rentora-dark.jpeg" alt="DR7 Empire" className="h-14" />
          </div>
          {participantId && (
            <button
              onClick={() => {
                localStorage.removeItem('dr7_referral_participant_id')
                setParticipantId(null)
              }}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Esci
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Success Banner */}
        {showSuccess && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-2xl text-center animate-fadeIn">
            <p className="text-green-400 font-bold text-lg">
              Registrazione completata!
            </p>
            <p className="text-green-300 text-sm mt-1">
              Hai ricevuto {(initialBalance / 100).toFixed(2)} di credito nel tuo wallet!
            </p>
          </div>
        )}

        {!participantId ? (
          /* Registration View */
          <div className="space-y-8">
            {/* Hero */}
            <div className="text-center space-y-4">
              <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight">
                DR7 <span className="text-[#d4af37]">PAGA</span> I SUOI UTENTI
              </h1>
              <p className="text-gray-400 text-lg max-w-xl mx-auto">
                Registrati gratis, ricevi credito immediato e guadagna invitando i tuoi amici!
              </p>
            </div>

            {/* Reward Tiers */}
            <ReferralRewardTiers />

            {/* Registration Form */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8">
              <h2 className="text-xl font-bold text-white text-center mb-6">Registrati Ora</h2>
              <ReferralRegistrationForm
                onRegistered={handleRegistered}
                initialReferralCode={refCode}
              />
            </div>
          </div>
        ) : (
          /* Dashboard View */
          <ReferralDashboard participantId={participantId} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-16">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-gray-600 text-sm">
          DR7 Empire &copy; {new Date().getFullYear()} — Tutti i diritti riservati
        </div>
      </footer>
    </div>
  )
}
