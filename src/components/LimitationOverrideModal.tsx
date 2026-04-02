import { useState, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'

interface LimitationOverrideModalProps {
  isOpen: boolean
  limitationCode: string
  limitationMessage: string
  actionContext?: string
  onClose: () => void
  onOverrideApproved: (overrideId: string) => void
}

type Step = 'blocked' | 'otp-sent' | 'verified'

export default function LimitationOverrideModal({
  isOpen,
  limitationCode,
  limitationMessage,
  actionContext,
  onClose,
  onOverrideApproved,
}: LimitationOverrideModalProps) {
  const [step, setStep] = useState<Step>('blocked')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState<string | null>(null)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const reset = useCallback(() => {
    setStep('blocked')
    setSending(false)
    setVerifying(false)
    setOverrideId(null)
    setOtpDigits(['', '', '', '', '', ''])
    setError(null)
  }, [])

  const handleClose = () => {
    reset()
    onClose()
  }

  async function sendOtp() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          limitationCode,
          limitationMessage,
          actionContext: actionContext || `${limitationCode}_${Date.now()}`,
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
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch {
      setError('Invio OTP non riuscito, riprova')
    } finally {
      setSending(false)
    }
  }

  async function verifyCode() {
    const code = otpDigits.join('')
    if (code.length < 6) return

    setVerifying(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/limitation-override-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', overrideId, code })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Codice non valido')
        return
      }
      setStep('verified')
      toast.success('Autorizzazione approvata')
      onOverrideApproved(overrideId!)
    } catch {
      setError('Verifica non riuscita, riprova')
    } finally {
      setVerifying(false)
    }
  }

  async function resendOtp() {
    setOtpDigits(['', '', '', '', '', ''])
    setError(null)
    await sendOtp()
  }

  function handleOtpDigit(index: number, value: string) {
    if (value.length > 1) value = value.slice(-1)
    if (value && !/^\d$/.test(value)) return
    const newDigits = [...otpDigits]
    newDigits[index] = value
    setOtpDigits(newDigits)
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
    if (e.key === 'Enter') {
      verifyCode()
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      e.preventDefault()
      setOtpDigits(pasted.split(''))
      otpRefs.current[5]?.focus()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-theme-bg-primary w-full sm:max-w-md rounded-t-lg sm:rounded-lg shadow-xl flex flex-col max-h-full sm:max-h-[90vh]">
        {/* Header */}
        <div className="bg-theme-bg-primaryer p-4 border-b border-theme-border flex justify-between items-center rounded-t-lg flex-shrink-0">
          <h3 className="text-lg font-bold text-amber-400">
            {step === 'blocked' ? 'Operazione limitata' : 'Autorizzazione direzionale'}
          </h3>
          <button
            onClick={handleClose}
            className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
          {/* Limitation message (always visible) */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
            <p className="text-amber-300 text-sm font-medium">{limitationMessage}</p>
          </div>

          {step === 'blocked' && (
            <p className="text-theme-text-muted text-sm">
              Per procedere è necessaria l'autorizzazione della direzione.
            </p>
          )}

          {step === 'otp-sent' && (
            <>
              <p className="text-theme-text-muted text-sm mb-4">
                Inserisci il codice OTP inviato alla direzione per autorizzare questa specifica operazione.
              </p>

              {/* OTP Input */}
              <div className="flex justify-center gap-2 mb-4">
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
                    onPaste={i === 0 ? handleOtpPaste : undefined}
                    className="w-11 h-13 text-center text-xl font-bold rounded-lg border-2 border-theme-border bg-theme-bg-secondary text-theme-text-primary focus:border-dr7-gold focus:outline-none transition-colors"
                  />
                ))}
              </div>
            </>
          )}

          {step === 'verified' && (
            <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Autorizzazione approvata
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-theme-border flex flex-col-reverse sm:flex-row gap-3 sm:justify-end rounded-b-lg flex-shrink-0">
          {step !== 'verified' && (
            <button
              onClick={handleClose}
              className="px-4 py-3 sm:py-2 min-h-[44px] bg-theme-bg-hover hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors"
            >
              Annulla
            </button>
          )}

          {step === 'blocked' && (
            <button
              onClick={sendOtp}
              disabled={sending}
              className="px-4 py-3 sm:py-2 min-h-[44px] bg-dr7-gold hover:bg-[#247a6f] text-theme-text-primary rounded-full transition-colors disabled:opacity-50"
            >
              {sending ? 'Invio...' : 'Chiedi alla direzione'}
            </button>
          )}

          {step === 'otp-sent' && (
            <>
              <button
                onClick={resendOtp}
                disabled={sending}
                className="px-4 py-3 sm:py-2 min-h-[44px] bg-theme-bg-hover hover:bg-theme-bg-hover text-theme-text-muted rounded-full transition-colors text-sm disabled:opacity-50"
              >
                {sending ? 'Invio...' : 'Reinvia codice'}
              </button>
              <button
                onClick={verifyCode}
                disabled={otpDigits.join('').length < 6 || verifying}
                className="px-4 py-3 sm:py-2 min-h-[44px] bg-dr7-gold hover:bg-[#247a6f] text-theme-text-primary rounded-full transition-colors disabled:opacity-50"
              >
                {verifying ? 'Verifica...' : 'Verifica codice'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
