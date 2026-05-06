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
  /**
   * Dettagli aggiuntivi inclusi nell'email OTP a Valerio. Permettono al
   * destinatario di capire ESATTAMENTE cosa sta autorizzando senza dover
   * aprire il sistema. Esempi: { 'Cliente': 'Mario Rossi', 'Veicolo':
   * 'BMW X5 (BMW001)', 'Importo': '€450', 'Note': 'Modifica data ritiro' }.
   * Vengono renderizzati come tabella nella mail.
   */
  details?: Record<string, string | number | null | undefined> | Array<{ label: string; value: string }>
  /**
   * Quando true, mostra un campo "Note operatore" opzionale. Il testo
   * viene incluso nell'email alla direzione e salvato nel log attività
   * operatori. Lasciato vuoto, la richiesta passa comunque.
   */
  showNotes?: boolean
  onClose?: () => void
  onCancel?: () => void
  onOverrideApproved: (overrideId: string, notes?: string) => void
}

type Step = 'blocked' | 'otp-sent' | 'verified'

export default function LimitationOverrideModal({
  isOpen,
  limitationCode,
  limitationMessage,
  actionContext,
  draftSessionId,
  flowType,
  details,
  showNotes = false,
  onClose: _onClose,
  onCancel,
  onOverrideApproved,
}: LimitationOverrideModalProps) {
  const [step, setStep] = useState<Step>('blocked')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [notes, setNotes] = useState('')
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
      setNotes('')
      setError(null)
      setSending(false)
      setVerifying(false)
    }
  }, [isOpen, limitationCode])

  // Auto-verify when 6 digits are typed — saves the operator from having to
  // hunt for the "Verifica" button. Re-typing the code retriggers verify.
  useEffect(() => {
    if (step === 'otp-sent' && otpCode.length === 6 && !verifying) {
      verifyCode()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpCode, step])

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
          details,
          notes: notes.trim() || undefined,
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Invio OTP non riuscito')
        return
      }
      setOverrideId(data.overrideId)
      // Self-approval: requestor IS the OTP recipient → server already
      // marked the override as active. Skip the OTP entry step.
      if (data.autoApproved) {
        setStep('verified')
        toast.success('Approvato direttamente (direzione)')
        onOverrideApproved(data.overrideId, notes.trim() || undefined)
        return
      }
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
        onOverrideApproved(overrideId!, notes.trim() || undefined)
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-theme-bg-secondary w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh] border border-theme-border relative">

        {/* Close button (top-right) — usa onCancel cosi' lascia che il flow esterno
            decida cosa fare; se non c'e' onCancel non mostriamo la X. */}
        {onCancel && step !== 'verified' && (
          <button
            onClick={onCancel}
            aria-label="Chiudi"
            className="absolute top-3 right-3 p-2 rounded-full text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors z-10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Content */}
        <div className="px-6 sm:px-8 pt-8 pb-6">
          {/* Icon + Title (centered) */}
          <div className="flex flex-col items-center mb-5">
            <div className="w-14 h-14 rounded-full bg-dr7-gold/10 border border-dr7-gold/30 flex items-center justify-center mb-4">
              {step === 'verified' ? (
                <svg className="w-7 h-7 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-7 h-7 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z" />
                </svg>
              )}
            </div>
            <h3 className="text-xl font-bold text-theme-text-primary text-center">
              {step === 'blocked' && 'Richiedi autorizzazione OTP'}
              {step === 'otp-sent' && 'Inserisci il codice OTP'}
              {step === 'verified' && 'Autorizzazione concessa'}
            </h3>
            <p className="text-sm text-theme-text-muted text-center mt-2 leading-relaxed">
              {step === 'blocked' && 'Per procedere con l\'operazione è necessaria l\'autorizzazione tramite codice OTP.'}
              {step === 'otp-sent' && 'Il codice è stato inviato alla direzione. Inseriscilo qui sotto per autorizzare l\'operazione.'}
              {step === 'verified' && 'Autorizzazione concessa solo per questo evento.'}
            </p>
          </div>

          {/* Info banner — solo nello step blocked, in tono ciano coerente */}
          {step === 'blocked' && (
            <div className="bg-dr7-gold/5 border border-dr7-gold/20 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
              <svg className="w-4 h-4 text-dr7-gold mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4M12 16h.01" />
              </svg>
              <p className="text-xs text-theme-text-secondary leading-relaxed">
                Verrai reindirizzato alla pagina di verifica dopo l'invio della richiesta.
              </p>
            </div>
          )}

          {/* Limitation context — sempre visibile, ora in stile sobrio non amber */}
          <div className="bg-theme-bg-tertiary border border-theme-border rounded-xl px-4 py-3 mb-5">
            <p className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Operazione</p>
            <p className="text-sm text-theme-text-primary font-medium leading-snug">{limitationMessage}</p>
            <p className="text-[11px] text-theme-text-muted mt-1.5 font-mono">{limitationCode}</p>
          </div>

          {/* Notes textarea — opzionale. Quando compilato, il testo viene
              mostrato nell'email alla direzione e salvato nel log attività
              operatori. Lasciato vuoto, la richiesta procede comunque. */}
          {step === 'blocked' && showNotes && (
            <div className="mb-5">
              <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1.5">
                Note operatore <span className="text-theme-text-muted normal-case tracking-normal">(opzionale)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Spiega il motivo della modifica (es. cliente ha chiesto cambio data, errore nel veicolo, ecc.)"
                className="w-full px-3 py-2.5 rounded-xl border border-theme-border bg-theme-bg-primary text-theme-text-primary text-sm focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 focus:outline-none transition-all resize-none"
              />
              <p className="text-[11px] text-theme-text-muted mt-1.5 text-right">{notes.length}/500</p>
            </div>
          )}

          {step === 'otp-sent' && (
            <div className="mb-2">
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
                className="w-full h-14 text-center text-2xl font-bold tracking-[0.5em] rounded-xl border-2 border-theme-border bg-theme-bg-primary text-theme-text-primary focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 focus:outline-none transition-all"
              />
            </div>
          )}

          {error && (
            <div className="bg-theme-error/10 border border-theme-error/30 rounded-xl px-4 py-2.5 mt-2">
              <p className="text-sm text-theme-error">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {step !== 'verified' && (
          <div className="px-6 sm:px-8 pb-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-stretch flex-shrink-0">
            {step === 'blocked' && (
              <>
                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="flex-1 px-5 py-3 min-h-[44px] bg-transparent border border-theme-border hover:border-theme-text-muted text-theme-text-primary rounded-xl transition-colors text-sm font-medium"
                  >
                    Annulla
                  </button>
                )}
                <button
                  onClick={sendOtp}
                  disabled={sending}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] bg-dr7-gold text-white rounded-xl transition-all disabled:opacity-50 text-sm font-semibold shadow-lg shadow-dr7-gold/20"
                >
                  {!sending && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11l18-8-8 18-2-7-8-3z" />
                    </svg>
                  )}
                  {sending ? 'Invio...' : 'Invia richiesta OTP'}
                </button>
              </>
            )}

            {step === 'otp-sent' && (
              <>
                <button
                  onClick={resendOtp}
                  disabled={sending}
                  className="flex-1 px-5 py-3 min-h-[44px] bg-transparent border border-theme-border hover:border-theme-text-muted text-theme-text-primary rounded-xl transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {sending ? 'Invio...' : 'Reinvia codice'}
                </button>
                <button
                  onClick={verifyCode}
                  disabled={otpCode.length < 6 || verifying}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] bg-dr7-gold text-white rounded-xl transition-all disabled:opacity-50 text-sm font-semibold shadow-lg shadow-dr7-gold/20"
                >
                  {!verifying && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {verifying ? 'Verifica...' : 'Verifica'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
