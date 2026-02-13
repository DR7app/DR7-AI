import { useState } from 'react'
import OtpInput from './OtpInput'

interface ReferralRegistrationFormProps {
  onRegistered: (data: { participant_id: string; referral_code: string; balance_cents: number }) => void
  initialReferralCode?: string
}

const API_BASE = '/.netlify/functions'

export default function ReferralRegistrationForm({ onRegistered, initialReferralCode }: ReferralRegistrationFormProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Step 1 fields
  const [nome, setNome] = useState('')
  const [cognome, setCognome] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [referralCode, setReferralCode] = useState(initialReferralCode || '')

  // Step 2 fields
  const [otpCode, setOtpCode] = useState('')

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!nome.trim() || !cognome.trim() || !telefono.trim()) {
      setError('Nome, cognome e telefono sono obbligatori')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/referral-send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: telefono.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Errore nell\'invio OTP')
        return
      }

      setStep(2)
    } catch {
      setError('Errore di connessione')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyAndRegister() {
    setError('')

    if (otpCode.length !== 6) {
      setError('Inserisci il codice a 6 cifre')
      return
    }

    setLoading(true)
    try {
      // Verify OTP
      const verifyRes = await fetch(`${API_BASE}/referral-verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: telefono.trim(), code: otpCode }),
      })
      const verifyData = await verifyRes.json()

      if (!verifyRes.ok) {
        setError(verifyData.error || 'Codice non valido')
        return
      }

      // Register
      const registerRes = await fetch(`${API_BASE}/referral-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          cognome: cognome.trim(),
          telefono: telefono.trim(),
          email: email.trim() || undefined,
          referralCode: referralCode.trim() || undefined,
        }),
      })
      const registerData = await registerRes.json()

      if (!registerRes.ok) {
        // Already registered — go to dashboard
        if (registerRes.status === 409 && registerData.participant_id) {
          onRegistered({
            participant_id: registerData.participant_id,
            referral_code: registerData.referral_code,
            balance_cents: 0,
          })
          return
        }
        setError(registerData.error || 'Errore nella registrazione')
        return
      }

      onRegistered({
        participant_id: registerData.participant_id,
        referral_code: registerData.referral_code,
        balance_cents: registerData.balance_cents,
      })
    } catch {
      setError('Errore di connessione')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto">
      {step === 1 && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Nome *</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none"
              placeholder="Mario"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Cognome *</label>
            <input
              type="text"
              value={cognome}
              onChange={(e) => setCognome(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none"
              placeholder="Rossi"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Telefono WhatsApp *</label>
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none"
              placeholder="+39 345 123 4567"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Email (opzionale)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none"
              placeholder="mario@email.com"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Codice Referral (opzionale)</label>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none font-mono"
              placeholder="DR7-XXXXXX"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#d4af37] text-black font-bold rounded-xl hover:bg-[#c4a030] transition-colors disabled:opacity-50"
          >
            {loading ? 'Invio codice...' : 'Invia Codice WhatsApp'}
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-gray-400 mb-2">Abbiamo inviato un codice a 6 cifre via WhatsApp al numero</p>
            <p className="text-white font-semibold text-lg">{telefono}</p>
          </div>

          <OtpInput value={otpCode} onChange={setOtpCode} disabled={loading} />

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <button
            onClick={handleVerifyAndRegister}
            disabled={loading || otpCode.length !== 6}
            className="w-full py-3 bg-[#d4af37] text-black font-bold rounded-xl hover:bg-[#c4a030] transition-colors disabled:opacity-50"
          >
            {loading ? 'Verifica in corso...' : 'Verifica e Registrati'}
          </button>

          <button
            onClick={() => { setStep(1); setOtpCode(''); setError('') }}
            className="w-full py-2 text-gray-400 hover:text-white text-sm transition-colors"
          >
            Torna indietro
          </button>
        </div>
      )}
    </div>
  )
}
