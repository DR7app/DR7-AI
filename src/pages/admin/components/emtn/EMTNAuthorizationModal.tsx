/**
 * EMTNAuthorizationModal — flusso a 2 step:
 *   Step 1: scelta canali (email / WhatsApp) -> emtn-otp-request
 *   Step 2: cliente comunica codice -> emtn-otp-verify
 *
 * Hard rule: senza verify positiva il report dettagliato resta locked.
 */
import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'

interface Props {
    open: boolean
    onClose: () => void
    onVerified: () => void
    clientId: string
    defaultEmail?: string
    defaultPhone?: string
}

type Step = 'channels' | 'code' | 'done'

export default function EMTNAuthorizationModal({
    open, onClose, onVerified, clientId, defaultEmail, defaultPhone,
}: Props) {
    const [step, setStep] = useState<Step>('channels')
    const [email, setEmail] = useState(defaultEmail || '')
    const [phone, setPhone] = useState(defaultPhone || '')
    const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
    const [code, setCode] = useState('')
    const [sending, setSending] = useState(false)
    const [verifying, setVerifying] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const codeInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!open) {
            setStep('channels')
            setOtpRequestId(null)
            setCode('')
            setError(null)
        }
    }, [open])

    useEffect(() => {
        if (step === 'code' && codeInputRef.current) codeInputRef.current.focus()
    }, [step])

    if (!open) return null

    async function sendOtp() {
        if (!email && !phone) {
            setError('Inserisci almeno email o WhatsApp')
            return
        }
        setSending(true)
        setError(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-otp-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, email: email || null, phone: phone || null }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Invio OTP fallito')
            setOtpRequestId(data.id)
            setStep('code')
            toast.success(`OTP inviato (${(data.sentVia || []).join(', ')})`)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setSending(false)
        }
    }

    async function verifyOtp() {
        if (!otpRequestId) return
        if (!/^\d{6}$/.test(code.trim())) {
            setError('Inserisci un codice di 6 cifre')
            return
        }
        setVerifying(true)
        setError(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-otp-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otpRequestId, code: code.trim() }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Verifica fallita')
            setStep('done')
            toast.success('Autorizzazione concessa')
            setTimeout(() => { onVerified(); onClose() }, 1200)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setVerifying(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-theme-bg-secondary w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh] border border-theme-border relative">
                <button onClick={onClose} aria-label="Chiudi"
                    className="absolute top-3 right-3 p-2 rounded-full text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="px-6 sm:px-8 pt-8 pb-6">
                    <div className="flex flex-col items-center mb-5">
                        <div className="w-14 h-14 rounded-full bg-dr7-gold/10 border border-dr7-gold/30 flex items-center justify-center mb-4">
                            <svg className="w-7 h-7 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-theme-text-primary">
                            {step === 'channels' && 'Richiedi autorizzazione cliente'}
                            {step === 'code' && 'Inserisci codice OTP'}
                            {step === 'done' && 'Autorizzazione concessa'}
                        </h3>
                        <p className="text-sm text-theme-text-muted text-center mt-2">
                            {step === 'channels' && 'Il cliente riceve un codice di 6 cifre che deve comunicarti per sbloccare il Mobility Risk Report.'}
                            {step === 'code' && 'Chiedi al cliente il codice ricevuto e inseriscilo qui sotto.'}
                            {step === 'done' && 'Il report e\' ora consultabile per la durata di questo OTP.'}
                        </p>
                    </div>

                    {step === 'channels' && (
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[11px] text-theme-text-muted mb-1">Email del cliente</label>
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                                    placeholder="cliente@email.com"
                                    className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40" />
                            </div>
                            <div>
                                <label className="block text-[11px] text-theme-text-muted mb-1">WhatsApp</label>
                                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                                    placeholder="+39 ..."
                                    className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40" />
                            </div>
                        </div>
                    )}

                    {step === 'code' && (
                        <input
                            ref={codeInputRef}
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="------"
                            className="w-full h-14 text-center text-2xl font-bold tracking-[0.5em] rounded-xl border-2 border-theme-border bg-theme-bg-primary text-theme-text-primary focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 focus:outline-none transition-all"
                        />
                    )}

                    {error && (
                        <div className="mt-3 px-3 py-2 rounded-xl border border-theme-error/30 bg-theme-error/5 text-sm text-theme-error">
                            {error}
                        </div>
                    )}
                </div>

                {step !== 'done' && (
                    <div className="px-6 sm:px-8 pb-6 flex gap-3">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-5 py-3 bg-transparent border border-theme-border hover:border-theme-text-muted text-theme-text-primary rounded-xl text-sm font-medium">
                            Annulla
                        </button>
                        {step === 'channels' && (
                            <button type="button" onClick={sendOtp} disabled={sending}
                                className="flex-1 px-5 py-3 bg-dr7-gold text-theme-bg-primary rounded-xl text-sm font-semibold disabled:opacity-50">
                                {sending ? 'Invio…' : 'Invia OTP'}
                            </button>
                        )}
                        {step === 'code' && (
                            <button type="button" onClick={verifyOtp} disabled={verifying || code.length < 6}
                                className="flex-1 px-5 py-3 bg-dr7-gold text-theme-bg-primary rounded-xl text-sm font-semibold disabled:opacity-50">
                                {verifying ? 'Verifica…' : 'Verifica'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
