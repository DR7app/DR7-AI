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
    const [acceptedMarketing, setAcceptedMarketing] = useState<boolean | null>(null)
    const [existingMarketingConsent, setExistingMarketingConsent] = useState<boolean | null>(null)
    const [showMarketingInfo, setShowMarketingInfo] = useState(false)
    const [otpChannel, setOtpChannel] = useState<'whatsapp' | 'email' | null>(null)
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
            if (data.otpChannel) setOtpChannel(data.otpChannel)

            // If customer already consented to marketing, pre-fill and skip the question
            if (data.existingMarketingConsent === true) {
                setExistingMarketingConsent(true)
                setAcceptedMarketing(true)
            } else {
                setExistingMarketingConsent(data.existingMarketingConsent ?? null)
            }

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

            const data = await res.json()
            if (data.channel) setOtpChannel(data.channel)

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

        // Only require a marketing answer if the customer hasn't already answered
        if (acceptedMarketing === null && existingMarketingConsent === null) {
            setError('Seleziona Si o No per le offerte Trustera')
            return
        }

        setError('')
        try {
            const res = await fetch('/.netlify/functions/signature-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, marketingConsent: acceptedMarketing })
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
                            {contract.vehicleName ? `Contratto ${contract.contractNumber}` : contract.contractNumber || 'Documento'}
                        </h1>
                        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                            <div>
                                <span className="text-gray-500 block">Cliente</span>
                                <span className="font-semibold">{signerName}</span>
                            </div>
                            {contract.vehicleName && (
                                <div>
                                    <span className="text-gray-500 block">Veicolo</span>
                                    <span className="font-semibold">{contract.vehicleName}</span>
                                </div>
                            )}
                            {contract.rentalStartDate && (
                                <div>
                                    <span className="text-gray-500 block">Ritiro</span>
                                    <span className="font-semibold">
                                        {new Date(contract.rentalStartDate).toLocaleDateString('it-IT')}
                                    </span>
                                </div>
                            )}
                            {contract.rentalEndDate && (
                                <div>
                                    <span className="text-gray-500 block">Riconsegna</span>
                                    <span className="font-semibold">
                                        {new Date(contract.rentalEndDate).toLocaleDateString('it-IT')}
                                    </span>
                                </div>
                            )}
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
                            Per procedere con la firma, invieremo un codice di verifica via WhatsApp o email.
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
                            {otpChannel === 'whatsapp'
                                ? 'Abbiamo inviato un codice a 6 cifre via WhatsApp.'
                                : `Abbiamo inviato un codice a 6 cifre a ${signerEmail}`}
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
                                Io, <strong>{signerName}</strong>, dichiaro di aver preso visione del documento
                                {contract?.contractNumber ? ` n. ${contract.contractNumber}` : ''} e di approvarne
                                integralmente il contenuto.
                            </p>
                            <p>
                                Confermo che la firma viene apposta volontariamente tramite verifica OTP
                                all'indirizzo email {signerEmail}.
                            </p>
                        </div>

                        <label className="flex items-start gap-3 mb-4 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={acceptedTerms}
                                onChange={e => setAcceptedTerms(e.target.checked)}
                                className="mt-1 h-5 w-5 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                            />
                            <span className="text-sm text-gray-700">
                                Confermo che i dati inseriti sono corretti e accetto i termini e le condizioni del contratto.
                            </span>
                        </label>

                        {existingMarketingConsent !== true && (
                            <div className="mb-6">
                                <p className="text-sm text-gray-700 mb-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowMarketingInfo(true)}
                                        className="underline text-yellow-700 hover:text-yellow-800 transition-colors"
                                    >
                                        Accetto vantaggi, offerte e sconti dedicati da Trustera e partner.
                                    </button>
                                </p>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="marketing"
                                            checked={acceptedMarketing === true}
                                            onChange={() => setAcceptedMarketing(true)}
                                            className="h-5 w-5 text-yellow-600 focus:ring-yellow-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700">Si</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="marketing"
                                            checked={acceptedMarketing === false}
                                            onChange={() => setAcceptedMarketing(false)}
                                            className="h-5 w-5 text-yellow-600 focus:ring-yellow-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700">No</span>
                                    </label>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleSign}
                            disabled={!acceptedTerms || (existingMarketingConsent !== true && acceptedMarketing === null)}
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
                            Riceverai una copia del contratto firmato via WhatsApp.
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

            {/* Marketing Info Modal */}
            {showMarketingInfo && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowMarketingInfo(false)}>
                    <div className="bg-white rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800 mb-4">
                            INFORMATIVA SUL TRATTAMENTO DEI DATI PERSONALI PER FINALITA DI MARKETING
                        </h3>
                        <div className="text-sm text-gray-700 space-y-3">
                            <p>Ai sensi del Regolamento (UE) 2016/679 ("GDPR"), previo consenso dell'utente, Trustera potra trattare i dati personali forniti durante l'utilizzo della piattaforma (quali ad esempio dati identificativi e di contatto) per finalita di marketing e comunicazioni commerciali.</p>
                            <p>I dati potranno essere utilizzati per l'invio di vantaggi, offerte, promozioni e sconti dedicati relativi a prodotti o servizi che potrebbero essere di interesse per l'utente.</p>
                            <p>Le comunicazioni potranno essere effettuate tramite diversi canali di contatto, tra cui, a titolo esemplificativo: email, SMS, telefono, notifiche push, applicazioni di messaggistica (come ad esempio WhatsApp) e altri strumenti di comunicazione elettronica o digitale.</p>
                            <p>Previo consenso dell'utente, i dati potranno essere trattati da Trustera, partner selezionati, e resi disponibili anche attraverso DR7 Platform, una piattaforma digitale utilizzata per la gestione e la distribuzione di opportunita commerciali e offerte da parte di aziende e partner aderenti.</p>
                            <p>Attraverso DR7 Platform, i dati potranno essere utilizzati da partner commerciali selezionati presenti sulla piattaforma, al fine di proporre comunicazioni commerciali, offerte, promozioni, vantaggi e sconti dedicati.</p>
                            <p>Tali partner possono appartenere a diverse categorie merceologiche e settori economici, inclusi, a titolo esemplificativo ma non esaustivo, aziende operanti nei settori retail e beni di consumo, moda e abbigliamento, e-commerce, servizi digitali e tecnologici, telecomunicazioni, mobilita, turismo, energia, assicurazioni, servizi finanziari, servizi professionali, casa, benessere, tempo libero e altri prodotti o servizi potenzialmente di interesse per l'utente.</p>
                            <p>Il consenso al trattamento dei dati per finalita di marketing e facoltativo e non e necessario per l'utilizzo delle funzionalita principali della piattaforma.</p>
                            <p>L'utente puo revocare in qualsiasi momento il consenso prestato tramite i link di disiscrizione presenti nelle comunicazioni ricevute oppure attraverso i canali indicati nella privacy policy generale.</p>
                            <p>Trustera conserva evidenza del consenso prestato, inclusi data, ora e log tecnici associati alla manifestazione di volonta dell'utente, al fine di dimostrare la liceita del trattamento.</p>
                            <p>L'utente puo esercitare in qualsiasi momento i diritti previsti dagli articoli 15-22 del GDPR, tra cui accesso ai dati personali, rettifica, cancellazione, limitazione del trattamento, opposizione e portabilita dei dati.</p>
                        </div>
                        <button
                            onClick={() => setShowMarketingInfo(false)}
                            className="mt-6 w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 rounded-lg transition-colors"
                        >
                            Chiudi
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
