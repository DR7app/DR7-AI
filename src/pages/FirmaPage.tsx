import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

type SigningStatus = 'loading' | 'viewing' | 'otp_sending' | 'otp_sent' | 'otp_verifying' | 'signing' | 'signed' | 'expired' | 'error'

interface ContractInfo {
    contractNumber: string
    pdfUrl: string
    customerName: string
    vehicleName: string
    rentalStartDate: string
    rentalEndDate: string
}

export default function FirmaPage() {
    const { token } = useParams<{ token: string }>()
    const [status, setStatus] = useState<SigningStatus>('loading')
    const [signerName, setSignerName] = useState('')
    const [signerEmail, setSignerEmail] = useState('')
    const [contract, setContract] = useState<ContractInfo | null>(null)
    const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null)
    const [signedAt, setSignedAt] = useState<string | null>(null)
    const [otp, setOtp] = useState(['', '', '', '', '', ''])
    const [error, setError] = useState('')
    const [remainingAttempts, setRemainingAttempts] = useState(5)
    const [acceptedTerms, setAcceptedTerms] = useState(false)
    const otpRefs = useRef<(HTMLInputElement | null)[]>([])

    useEffect(() => {
        if (token) loadSigningData()
    }, [token])

    async function loadSigningData() {
        try {
            const res = await fetch('/.netlify/functions/signature-get', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })

            if (res.status === 410) {
                setStatus('expired')
                return
            }

            if (!res.ok) {
                const err = await res.json()
                setError(err.error || 'Errore nel caricamento')
                setStatus('error')
                return
            }

            const data = await res.json()
            setSignerName(data.signerName)
            setSignerEmail(data.signerEmail)
            setContract(data.contract)

            if (data.status === 'signed') {
                setSignedPdfUrl(data.signedPdfUrl)
                setSignedAt(data.signedAt)
                setStatus('signed')
            } else {
                setStatus('viewing')
            }
        } catch {
            setError('Impossibile caricare i dati del contratto')
            setStatus('error')
        }
    }

    async function handleRequestOtp() {
        setStatus('otp_sending')
        setError('')
        try {
            const res = await fetch('/.netlify/functions/signature-send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })

            if (!res.ok) {
                const err = await res.json()
                setError(err.error)
                setStatus('viewing')
                return
            }

            setStatus('otp_sent')
            setOtp(['', '', '', '', '', ''])
            setTimeout(() => otpRefs.current[0]?.focus(), 100)
        } catch {
            setError('Errore nell\'invio del codice OTP')
            setStatus('viewing')
        }
    }

    async function handleVerifyOtp() {
        const otpCode = otp.join('')
        if (otpCode.length !== 6) {
            setError('Inserisci il codice completo a 6 cifre')
            return
        }

        setStatus('otp_verifying')
        setError('')
        try {
            const res = await fetch('/.netlify/functions/signature-verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, otp: otpCode })
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error)
                if (data.remainingAttempts !== undefined) {
                    setRemainingAttempts(data.remainingAttempts)
                }
                setStatus('otp_sent')
                return
            }

            setStatus('signing')
        } catch {
            setError('Errore nella verifica del codice')
            setStatus('otp_sent')
        }
    }

    async function handleSign() {
        if (!acceptedTerms) {
            setError('Devi accettare i termini per procedere')
            return
        }

        setError('')
        try {
            const res = await fetch('/.netlify/functions/signature-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })

            if (!res.ok) {
                const err = await res.json()
                setError(err.error)
                return
            }

            const data = await res.json()
            setSignedPdfUrl(data.signedPdfUrl)
            setSignedAt(data.signedAt)
            setStatus('signed')
        } catch {
            setError('Errore durante la firma del documento')
        }
    }

    function handleOtpChange(index: number, value: string) {
        if (!/^\d*$/.test(value)) return
        const newOtp = [...otp]
        newOtp[index] = value.slice(-1)
        setOtp(newOtp)
        if (value && index < 5) {
            otpRefs.current[index + 1]?.focus()
        }
    }

    function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            otpRefs.current[index - 1]?.focus()
        }
    }

    function handleOtpPaste(e: React.ClipboardEvent) {
        e.preventDefault()
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        const newOtp = [...otp]
        for (let i = 0; i < pasted.length; i++) {
            newOtp[i] = pasted[i]
        }
        setOtp(newOtp)
        const nextEmpty = newOtp.findIndex(d => !d)
        otpRefs.current[nextEmpty === -1 ? 5 : nextEmpty]?.focus()
    }

    if (status === 'loading') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Caricamento contratto...</p>
                </div>
            </div>
        )
    }

    if (status === 'expired') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
                    <div className="text-5xl mb-4">&#8987;</div>
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">Link Scaduto</h1>
                    <p className="text-gray-600">Il link di firma e scaduto. Contatta DR7 Empire per ricevere un nuovo link.</p>
                </div>
            </div>
        )
    }

    if (status === 'error') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
                    <div className="text-5xl mb-4">&#9888;&#65039;</div>
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">Errore</h1>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-black text-white py-4 px-6 flex items-center justify-between">
                <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" className="h-10" />
                <span className="text-sm text-gray-400">Firma Elettronica</span>
            </div>

            <div className="max-w-2xl mx-auto p-4 sm:p-6">
                {/* Contract Info Card */}
                {contract && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                        <h1 className="text-xl font-bold text-gray-800 mb-1">
                            Contratto {contract.contractNumber}
                        </h1>
                        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                            <div>
                                <span className="text-gray-500 block">Cliente</span>
                                <span className="font-semibold">{signerName}</span>
                            </div>
                            <div>
                                <span className="text-gray-500 block">Veicolo</span>
                                <span className="font-semibold">{contract.vehicleName}</span>
                            </div>
                            <div>
                                <span className="text-gray-500 block">Ritiro</span>
                                <span className="font-semibold">
                                    {contract.rentalStartDate ? new Date(contract.rentalStartDate).toLocaleDateString('it-IT') : 'N/A'}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-500 block">Riconsegna</span>
                                <span className="font-semibold">
                                    {contract.rentalEndDate ? new Date(contract.rentalEndDate).toLocaleDateString('it-IT') : 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* PDF Viewer */}
                {contract?.pdfUrl && status !== 'signed' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                        <div className="bg-gray-100 px-4 py-2 text-sm text-gray-600 font-medium border-b">
                            Documento da firmare
                        </div>
                        <iframe
                            src={contract.pdfUrl}
                            className="w-full border-0"
                            style={{ height: '500px' }}
                            title="Contratto PDF"
                        />
                    </div>
                )}

                {/* Error message */}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
                        {error}
                    </div>
                )}

                {/* Step 1: Request OTP */}
                {status === 'viewing' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                        <h2 className="text-lg font-bold text-gray-800 mb-2">Firma il Contratto</h2>
                        <p className="text-gray-600 text-sm mb-6">
                            Per procedere con la firma, invieremo un codice di verifica a <strong>{signerEmail}</strong>
                        </p>
                        <button
                            onClick={handleRequestOtp}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-8 rounded-lg transition-colors text-lg"
                        >
                            Invia Codice di Verifica
                        </button>
                    </div>
                )}

                {status === 'otp_sending' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Invio codice di verifica...</p>
                    </div>
                )}

                {/* Step 2: Enter OTP */}
                {(status === 'otp_sent' || status === 'otp_verifying') && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">Inserisci Codice OTP</h2>
                        <p className="text-gray-600 text-sm mb-6 text-center">
                            Abbiamo inviato un codice a 6 cifre a <strong>{signerEmail}</strong>
                        </p>

                        <div className="flex justify-center gap-2 mb-6" onPaste={handleOtpPaste}>
                            {otp.map((digit, i) => (
                                <input
                                    key={i}
                                    ref={el => { otpRefs.current[i] = el }}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={digit}
                                    onChange={e => handleOtpChange(i, e.target.value)}
                                    onKeyDown={e => handleOtpKeyDown(i, e)}
                                    className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:border-yellow-500 focus:outline-none transition-colors"
                                    disabled={status === 'otp_verifying'}
                                />
                            ))}
                        </div>

                        {remainingAttempts < 5 && (
                            <p className="text-center text-sm text-orange-600 mb-4">
                                Tentativi rimanenti: {remainingAttempts}
                            </p>
                        )}

                        <div className="flex flex-col gap-3 items-center">
                            <button
                                onClick={handleVerifyOtp}
                                disabled={otp.join('').length !== 6 || status === 'otp_verifying'}
                                className="bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-300 text-white font-bold py-3 px-8 rounded-lg transition-colors w-full max-w-xs"
                            >
                                {status === 'otp_verifying' ? 'Verifica in corso...' : 'Verifica Codice'}
                            </button>
                            <button
                                onClick={handleRequestOtp}
                                disabled={status === 'otp_verifying'}
                                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                            >
                                Non hai ricevuto il codice? Invia di nuovo
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Confirm and Sign */}
                {status === 'signing' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">Conferma Firma</h2>

                        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-6 text-sm text-green-700 text-center">
                            Identita verificata con successo
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm text-gray-700">
                            <p className="mb-2">
                                Io, <strong>{signerName}</strong>, dichiaro di aver preso visione del contratto
                                {contract?.contractNumber ? ` n. ${contract.contractNumber}` : ''} e di approvarne
                                integralmente il contenuto.
                            </p>
                            <p>
                                Confermo che la firma viene apposta volontariamente tramite verifica OTP
                                all'indirizzo email {signerEmail}.
                            </p>
                        </div>

                        <label className="flex items-start gap-3 mb-6 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={acceptedTerms}
                                onChange={e => setAcceptedTerms(e.target.checked)}
                                className="mt-1 h-5 w-5 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                            />
                            <span className="text-sm text-gray-700">
                                Accetto i termini e le condizioni del contratto e confermo la mia volonta di firmare
                                elettronicamente questo documento.
                            </span>
                        </label>

                        <button
                            onClick={handleSign}
                            disabled={!acceptedTerms}
                            className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-300 text-white font-bold py-4 rounded-lg transition-colors text-lg"
                        >
                            Firma il Documento
                        </button>
                    </div>
                )}

                {/* Step 4: Signed */}
                {status === 'signed' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                        <div className="text-5xl mb-4">&#9989;</div>
                        <h2 className="text-2xl font-bold text-green-700 mb-2">Documento Firmato</h2>
                        <p className="text-gray-600 mb-2">
                            Il contratto e stato firmato con successo
                            {signedAt ? ` il ${new Date(signedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` : ''}.
                        </p>
                        <p className="text-gray-500 text-sm mb-6">
                            Riceverai una copia del contratto firmato via email.
                        </p>
                        {signedPdfUrl && (
                            <a
                                href={signedPdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-8 rounded-lg transition-colors"
                            >
                                Scarica Contratto Firmato
                            </a>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="text-center py-6 text-xs text-gray-400">
                Dubai rent 7.0 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927
            </div>
        </div>
    )
}
