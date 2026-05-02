import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

interface InviteState {
    valid: boolean | null
    expired?: boolean
    used?: boolean
    revoked?: boolean
    expiresAt?: string
    error?: string
}

interface FormState {
    tipo_cliente: 'privato' | 'azienda'
    nome: string
    cognome: string
    email: string
    telefono: string
    codice_fiscale: string
    data_nascita: string
    luogo_nascita: string
    provincia_nascita: string
    indirizzo: string
    citta: string
    cap: string
    provincia: string
    nazione: string
    ragione_sociale: string
    partita_iva: string
    pec: string
    codice_destinatario: string
}

const initialForm: FormState = {
    tipo_cliente: 'privato',
    nome: '', cognome: '', email: '', telefono: '',
    codice_fiscale: '', data_nascita: '', luogo_nascita: '', provincia_nascita: '',
    indirizzo: '', citta: '', cap: '', provincia: '', nazione: 'IT',
    ragione_sociale: '', partita_iva: '', pec: '', codice_destinatario: '',
}

type DocKind = 'identity_document' | 'drivers_license' | 'codice_fiscale'

interface DocItem {
    kind: DocKind
    file: File
    uploaded?: boolean
    uploading?: boolean
    error?: string
}

export default function RegistrazioneClientePage() {
    const { token } = useParams<{ token: string }>()
    const [invite, setInvite] = useState<InviteState>({ valid: null })
    const [step, setStep] = useState<'form' | 'documents' | 'done'>('form')
    const [form, setForm] = useState<FormState>(initialForm)
    const [submitting, setSubmitting] = useState(false)
    const [submitErr, setSubmitErr] = useState<string | null>(null)
    const [customerId, setCustomerId] = useState<string | null>(null)
    const [docs, setDocs] = useState<DocItem[]>([])

    useEffect(() => {
        if (!token) {
            setInvite({ valid: false, error: 'Link incompleto' })
            return
        }
        ;(async () => {
            try {
                const res = await fetch(`/.netlify/functions/validate-customer-invite?token=${encodeURIComponent(token)}`)
                const json = await res.json()
                setInvite(json)
            } catch (e) {
                setInvite({ valid: false, error: e instanceof Error ? e.message : 'Errore validazione' })
            }
        })()
    }, [token])

    function update<K extends keyof FormState>(k: K, v: FormState[K]) {
        setForm(prev => ({ ...prev, [k]: v }))
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSubmitErr(null)
        if (form.tipo_cliente === 'privato' && !form.nome.trim()) return setSubmitErr('Nome obbligatorio')
        if (form.tipo_cliente === 'azienda' && !form.ragione_sociale.trim()) return setSubmitErr('Ragione sociale obbligatoria')
        if (!form.telefono.trim() && !form.email.trim()) return setSubmitErr('Telefono o email obbligatori')

        setSubmitting(true)
        try {
            const res = await fetch('/.netlify/functions/submit-customer-invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, customer: form }),
            })
            const json = await res.json()
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            setCustomerId(json.customerId)
            setStep('documents')
        } catch (err) {
            setSubmitErr(err instanceof Error ? err.message : String(err))
        } finally {
            setSubmitting(false)
        }
    }

    function addDoc(kind: DocKind, file: File) {
        setDocs(prev => [...prev, { kind, file }])
    }

    function removeDoc(idx: number) {
        setDocs(prev => prev.filter((_, i) => i !== idx))
    }

    async function uploadDocs() {
        if (!customerId || !token) return
        for (let i = 0; i < docs.length; i++) {
            const item = docs[i]
            if (item.uploaded) continue
            setDocs(prev => prev.map((d, j) => j === i ? { ...d, uploading: true, error: undefined } : d))
            try {
                const fileBuf = await item.file.arrayBuffer()
                const b64 = btoa(String.fromCharCode(...new Uint8Array(fileBuf)))
                const res = await fetch('/.netlify/functions/upload-customer-invite-document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token,
                        customerId,
                        docKind: item.kind,
                        fileName: item.file.name,
                        contentType: item.file.type,
                        fileBase64: b64,
                    }),
                })
                const json = await res.json()
                if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
                setDocs(prev => prev.map((d, j) => j === i ? { ...d, uploading: false, uploaded: true } : d))
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                setDocs(prev => prev.map((d, j) => j === i ? { ...d, uploading: false, error: msg } : d))
            }
        }
    }

    // ─── Render gates ────────────────────────────────────────────────────
    if (invite.valid === null) return <Centered><p>Verifica link…</p></Centered>
    if (!invite.valid) {
        const reason = invite.expired ? 'Il link è scaduto.' :
            invite.used ? 'Questo link è già stato utilizzato.' :
            invite.revoked ? 'Il link è stato revocato.' :
            invite.error || 'Link non valido.'
        return <Centered>
            <h1 className="text-2xl font-bold text-red-600 mb-2">Link non utilizzabile</h1>
            <p className="text-gray-600">{reason}</p>
            <p className="text-sm text-gray-500 mt-4">Contatta DR7 Empire per un nuovo link di registrazione.</p>
        </Centered>
    }

    if (step === 'done') {
        return <Centered>
            <h1 className="text-3xl font-bold text-emerald-700 mb-2">Registrazione completata</h1>
            <p className="text-gray-600">Grazie. Il team DR7 Empire verificherà i documenti caricati al più presto.</p>
        </Centered>
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <Header />

                {step === 'form' && (
                    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-4">
                        <h2 className="text-xl font-semibold mb-2">I tuoi dati</h2>

                        <div className="flex gap-4">
                            {(['privato', 'azienda'] as const).map(t => (
                                <label key={t} className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" checked={form.tipo_cliente === t}
                                        onChange={() => update('tipo_cliente', t)} />
                                    <span className="capitalize">{t}</span>
                                </label>
                            ))}
                        </div>

                        {form.tipo_cliente === 'privato' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Field label="Nome *" value={form.nome} onChange={v => update('nome', v)} required />
                                <Field label="Cognome" value={form.cognome} onChange={v => update('cognome', v)} />
                                <Field label="Codice Fiscale" value={form.codice_fiscale} onChange={v => update('codice_fiscale', v.toUpperCase())} />
                                <Field label="Data di Nascita" type="date" value={form.data_nascita} onChange={v => update('data_nascita', v)} />
                                <Field label="Luogo di Nascita" value={form.luogo_nascita} onChange={v => update('luogo_nascita', v)} />
                                <Field label="Provincia di Nascita" value={form.provincia_nascita} onChange={v => update('provincia_nascita', v)} maxLength={2} />
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Field label="Ragione Sociale *" value={form.ragione_sociale} onChange={v => update('ragione_sociale', v)} required />
                                <Field label="P.IVA" value={form.partita_iva} onChange={v => update('partita_iva', v)} />
                                <Field label="PEC" type="email" value={form.pec} onChange={v => update('pec', v)} />
                                <Field label="Codice Destinatario SDI" value={form.codice_destinatario} onChange={v => update('codice_destinatario', v.toUpperCase())} maxLength={7} />
                                <Field label="Codice Fiscale (rappresentante)" value={form.codice_fiscale} onChange={v => update('codice_fiscale', v.toUpperCase())} />
                            </div>
                        )}

                        <h3 className="text-md font-semibold pt-4 border-t">Contatti</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="Telefono" type="tel" value={form.telefono} onChange={v => update('telefono', v)} />
                            <Field label="Email" type="email" value={form.email} onChange={v => update('email', v)} />
                        </div>

                        <h3 className="text-md font-semibold pt-4 border-t">Indirizzo</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="Indirizzo" value={form.indirizzo} onChange={v => update('indirizzo', v)} />
                            <Field label="Città" value={form.citta} onChange={v => update('citta', v)} />
                            <Field label="CAP" value={form.cap} onChange={v => update('cap', v)} maxLength={5} />
                            <Field label="Provincia" value={form.provincia} onChange={v => update('provincia', v)} maxLength={2} />
                            <Field label="Nazione" value={form.nazione} onChange={v => update('nazione', v)} />
                        </div>

                        {submitErr && <p className="text-red-600 text-sm">{submitErr}</p>}

                        <div className="pt-4 border-t flex justify-end">
                            <button type="submit" disabled={submitting}
                                className="px-6 py-2.5 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50">
                                {submitting ? 'Invio…' : 'Continua'}
                            </button>
                        </div>
                    </form>
                )}

                {step === 'documents' && customerId && (
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-4">
                        <h2 className="text-xl font-semibold">Documenti</h2>
                        <p className="text-sm text-gray-600">
                            Carica i tuoi documenti. Saranno verificati dal team DR7 prima di confermare la registrazione.
                            Formati: JPG, PNG, PDF (max 10 MB ciascuno).
                        </p>

                        <DocPicker label="Carta d'identità o Passaporto" kind="identity_document" onAdd={addDoc} />
                        <DocPicker label="Patente di guida" kind="drivers_license" onAdd={addDoc} />
                        <DocPicker label="Codice Fiscale / Tessera Sanitaria" kind="codice_fiscale" onAdd={addDoc} />

                        {docs.length > 0 && (
                            <ul className="border rounded divide-y">
                                {docs.map((d, i) => (
                                    <li key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100">{d.kind.replace('_', ' ')}</span>
                                        <span className="flex-1 truncate">{d.file.name}</span>
                                        {d.uploaded ? <span className="text-emerald-600">caricato</span>
                                            : d.uploading ? <span className="text-blue-600">caricamento…</span>
                                                : d.error ? <span className="text-red-600 text-xs">{d.error}</span>
                                                    : <button type="button" onClick={() => removeDoc(i)} className="text-red-600 text-xs">rimuovi</button>}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="flex justify-between items-center pt-4 border-t">
                            <button type="button" onClick={() => setStep('done')}
                                className="text-sm text-gray-600 underline">Salta i documenti per ora</button>
                            <div className="flex gap-2">
                                <button type="button" onClick={uploadDocs} disabled={docs.length === 0 || docs.every(d => d.uploaded)}
                                    className="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 disabled:opacity-50">
                                    Carica selezionati
                                </button>
                                <button type="button" onClick={() => setStep('done')}
                                    disabled={docs.some(d => !d.uploaded && !d.error)}
                                    className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                                    Concludi
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function Header() {
    return (
        <div className="text-center mb-6">
            <div className="text-3xl font-bold text-amber-700">DR7 Empire</div>
            <p className="text-sm text-gray-600 mt-1">Registrazione cliente</p>
        </div>
    )
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
            <div className="bg-white border border-gray-200 rounded-lg shadow p-8 max-w-md text-center">
                {children}
            </div>
        </div>
    )
}

function Field({ label, value, onChange, type = 'text', required, maxLength }: {
    label: string
    value: string
    onChange: (v: string) => void
    type?: string
    required?: boolean
    maxLength?: number
}) {
    return (
        <label className="block">
            <span className="text-xs font-medium text-gray-700">{label}</span>
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                required={required}
                maxLength={maxLength}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
        </label>
    )
}

function DocPicker({ label, kind, onAdd }: {
    label: string
    kind: DocKind
    onAdd: (kind: DocKind, f: File) => void
}) {
    return (
        <div className="border border-gray-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700 flex-1">{label}</span>
            <input
                type="file"
                accept="image/*,application/pdf"
                onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) onAdd(kind, f)
                    e.currentTarget.value = ''
                }}
                className="text-sm"
            />
        </div>
    )
}
