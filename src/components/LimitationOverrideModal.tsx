import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../utils/authFetch'

interface LimitationOverrideModalProps {
  isOpen: boolean
  limitationCode: string
  limitationMessage: string
  actionContext?: string
  draftSessionId: string
  flowType: string
  onClose?: () => void
  onCancel?: () => void
  onOverrideApproved: (overrideId: string) => void
}

type Step = 'blocked' | 'otp-sent' | 'verified'

export default function LimitationOverrideModal({
  isOpen,
  limitationCode,
  limitationMessage,
  actionContext,
  draftSessionId,
  flowType,
  onClose: _onClose,
  onCancel,
  onOverrideApproved,
}: LimitationOverrideModalProps) {
  const [step, setStep] = useState<Step>('blocked')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const otpInputRef = useRef<HTMLInputElement | null>(null)

  // Keep _onClose to satisfy prop interface but modal is not dismissible
  void _onClose

  // Reset internal state whenever the modal is closed externally (isOpen→false)
  // or whenever the limitationCode changes (re-open for a different rule).
  useEffect(() => {
    if (!isOpen) {
      setStep('blocked')
      setOverrideId(null)
      setOtpCode('')
      setError(null)
      setSending(false)
      setVerifying(false)
    }
  }, [isOpen, limitationCode])

  async function sendOtp() {
    setSending(true)
    setError(null)
    try {
      const res = await authFetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          limitationCode,
          limitationMessage,
          actionContext: actionContext || `${limitationCode}_${Date.now()}`,
          draftSessionId,
          flowType,
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Invio OTP non riuscito')
        return
      }
      setOverrideId(data.overrideId)
      setStep('otp-sent')
      toast.success('Codice inviato alla direzione')
      setTimeout(() => otpInputRef.current?.focus(), 100)
    } catch {
      setError('Invio OTP non riuscito, riprova')
    } finally {
      setSending(false)
    }
  }

  async function verifyCode() {
    if (otpCode.length < 6) return

    setVerifying(true)
    setError(null)
    try {
      const res = await authFetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', overrideId, code: otpCode })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Codice non valido')
        return
      }
      setStep('verified')
      toast.success('Autorizzazione concessa solo per questo evento.')
      // Auto-close after 1.5s so the user sees the confirmation
      setTimeout(() => {
        onOverrideApproved(overrideId!)
      }, 1500)
    } catch {
      setError('Verifica non riuscita, riprova')
    } finally {
      setVerifying(false)
    }
  }

  async function resendOtp() {
    setOtpCode('')
    setError(null)
    await sendOtp()
  }

  function handleOtpChange(value: string) {
    // Numeric only, max 6 digits
    const cleaned = value.replace(/\D/g, '').slice(0, 6)
    setOtpCode(cleaned)
  }

  function handleOtpKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      verifyCode()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-theme-bg-primary w-full sm:max-w-md rounded-t-lg sm:rounded-lg shadow-xl flex flex-col max-h-full sm:max-h-[90vh] border border-theme-border">
        {/* Header */}
        <div className="p-4 border-b border-theme-border flex justify-between items-center rounded-t-lg flex-shrink-0">
          <h3 className="text-lg font-bold text-amber-400">
            {step === 'blocked' ? 'Limitazione rilevata' : step === 'otp-sent' ? 'Inserisci codice di autorizzazione' : 'Autorizzazione direzionale'}
          </h3>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
          {/* Limitation message (always visible) */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
            <p className="text-amber-300 text-sm font-medium">{limitationMessage}</p>
            <p className="text-amber-300/60 text-xs mt-1 font-mono">{limitationCode}</p>
          </div>

          {step === 'blocked' && (
            <p className="text-theme-text-muted text-sm">
              Questa operazione è bloccata. Per procedere è obbligatorio richiedere e verificare un codice di autorizzazione direzionale via OTP.
            </p>
          )}

          {step === 'otp-sent' && (
            <>
              <p className="text-theme-text-muted text-sm mb-4">
                Il codice è stato inviato al numero autorizzativo configurato per le ricariche wallet. Inserisci il codice per autorizzare questa specifica operazione.
              </p>

              {/* OTP Input — single rectangle */}
              <div className="mb-4">
                <input
                  ref={otpInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => handleOtpChange(e.target.value)}
                  onKeyDown={handleOtpKeyDown}
                  placeholder="------"
                  className="w-full h-14 text-center text-2xl font-bold tracking-[0.5em] rounded-lg border-2 border-theme-border bg-theme-bg-secondary text-theme-text-primary focus:border-dr7-gold focus:outline-none transition-colors"
                />
              </div>
            </>
          )}

          {step === 'verified' && (
            <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Autorizzazione concessa solo per questo evento.
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-theme-border flex flex-col-reverse sm:flex-row gap-3 sm:justify-end rounded-b-lg flex-shrink-0">
          {step === 'blocked' && (
            <>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-4 py-3 sm:py-2 min-h-[44px] bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-muted rounded-full transition-colors text-sm w-full sm:w-auto"
                >
                  Annulla
                </button>
              )}
              <button
                onClick={sendOtp}
                disabled={sending}
                className="px-4 py-3 sm:py-2 min-h-[44px] bg-dr7-gold hover:bg-[#247a6f] text-white rounded-full transition-colors disabled:opacity-50 text-sm font-medium w-full sm:w-auto"
              >
                {sending ? 'Invio...' : 'Richiedi autorizzazione'}
              </button>
            </>
          )}

          {step === 'otp-sent' && (
            <>
              <button
                onClick={resendOtp}
                disabled={sending}
                className="px-4 py-3 sm:py-2 min-h-[44px] bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-muted rounded-full transition-colors text-sm disabled:opacity-50"
              >
                {sending ? 'Invio...' : 'Reinvia codice'}
              </button>
              <button
                onClick={verifyCode}
                disabled={otpCode.length < 6 || verifying}
                className="px-4 py-3 sm:py-2 min-h-[44px] bg-dr7-gold hover:bg-[#247a6f] text-white rounded-full transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {verifying ? 'Verifica...' : 'Verifica'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
