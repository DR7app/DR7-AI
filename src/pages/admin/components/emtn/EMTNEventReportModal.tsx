/**
 * EMTNEventReportModal — apre un evento UNDER_REVIEW + carica i
 * documenti uno per uno (1 file per chiamata Netlify per non saturare
 * il timeout). Convalida client-side: type allow-list, headline >= 5,
 * description >= 20, almeno 1 file allegato prima del submit.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'

const TYPES: { id: string; label: string; helper: string }[] = [
    { id: 'UNPAID_DAMAGE', label: 'Danno non saldato', helper: 'Riparazioni dovute non pagate' },
    { id: 'INSOLVENCY',    label: 'Insoluto',          helper: 'Fatture non pagate' },
    { id: 'NON_RETURN',    label: 'Mancata restituzione', helper: 'Veicolo non riconsegnato' },
    { id: 'THEFT_REPORTED', label: 'Furto con denuncia', helper: 'Sottrazione con denuncia formale' },
    { id: 'LEGAL_EVENT',   label: 'Evento legale',     helper: 'Procedimento legale documentato' },
]
const ALLOWED_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx']
const MAX_BYTES = 10 * 1024 * 1024

interface Props {
    open: boolean
    onClose: () => void
    onCreated: (eventId: string) => void
    clientId: string
    bookingId: string
}

export default function EMTNEventReportModal({ open, onClose, onCreated, clientId, bookingId }: Props) {
    const [type, setType] = useState<string>('UNPAID_DAMAGE')
    const [headline, setHeadline] = useState('')
    const [description, setDescription] = useState('')
    const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 10))
    const [files, setFiles] = useState<File[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) {
            setHeadline(''); setDescription(''); setFiles([]); setError(null)
        }
    }, [open])

    if (!open) return null

    function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
        const list = Array.from(e.target.files || [])
        const valid: File[] = []
        for (const f of list) {
            const ext = (f.name.split('.').pop() || '').toLowerCase()
            if (!ALLOWED_EXTS.includes(ext)) { toast.error(`Estensione non consentita: ${f.name}`); continue }
            if (f.size > MAX_BYTES) { toast.error(`Troppo grande: ${f.name}`); continue }
            valid.push(f)
        }
        setFiles(prev => [...prev, ...valid])
        e.target.value = ''
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        if (headline.trim().length < 5) { setError('Titolo troppo breve'); return }
        if (description.trim().length < 20) { setError('Descrizione troppo breve (min 20 caratteri)'); return }
        if (files.length === 0) { setError('Almeno un documento e\' obbligatorio'); return }
        setSubmitting(true)
        setError(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-event-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId, bookingId, type,
                    headline: headline.trim(), description: description.trim(), occurredAt,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Creazione evento fallita')
            const eventId = data.id

            // Upload files in parallel batches of 2 (Netlify timeout 10s)
            const batchSize = 2
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize)
                await Promise.all(batch.map(async (f) => {
                    const fd = new FormData()
                    fd.append('document', f, f.name)
                    const upRes = await authFetch(
                        `/.netlify/functions/emtn-event-document?eventId=${encodeURIComponent(eventId)}`,
                        { method: 'POST', body: fd },
                    )
                    if (!upRes.ok) {
                        const t = await upRes.text()
                        throw new Error(`Upload ${f.name} fallito: ${t.slice(0, 200)}`)
                    }
                }))
            }

            toast.success(`Evento aperto (${data.id.slice(0, 8)}…) — in revisione EMTN`)
            onCreated(eventId)
            onClose()
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-theme-bg-secondary w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh] border border-theme-border relative">
                <button onClick={onClose} aria-label="Chiudi"
                    className="absolute top-3 right-3 p-2 rounded-full text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover z-10">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="px-6 sm:px-8 pt-8 pb-4 overflow-y-auto">
                    <h3 className="text-xl font-bold text-theme-text-primary mb-1">Segnala Evento</h3>
                    <p className="text-sm text-theme-text-muted mb-5">
                        Stato iniziale UNDER_REVIEW. Richiede almeno 1 documento. Segnalazioni false comportano esclusione dal network.
                    </p>

                    <form onSubmit={submit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">Categoria</label>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                {TYPES.map(t => {
                                    const active = t.id === type
                                    return (
                                        <button key={t.id} type="button" onClick={() => setType(t.id)} title={t.helper}
                                            className={`px-3 py-2 rounded-lg text-xs font-medium border text-left ${
                                                active
                                                    ? 'border-dr7-gold bg-dr7-gold/10 text-theme-text-primary'
                                                    : 'border-theme-border bg-theme-bg-primary text-theme-text-secondary hover:border-theme-border-light'
                                            }`}>
                                            {t.label}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)}
                                placeholder="Titolo breve" maxLength={120}
                                className="sm:col-span-2 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40" />
                            <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)}
                                className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/40" />
                        </div>

                        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                            placeholder="Descrizione dettagliata (min 20 caratteri): cosa, quando, importi, comunicazioni col cliente."
                            rows={4}
                            className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40 resize-y" />
                        <div className="text-[11px] text-theme-text-muted text-right">{description.length} caratteri</div>

                        <div className="rounded-lg border border-dashed border-theme-border bg-theme-bg-primary p-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Documentazione obbligatoria</h4>
                            <input type="file" multiple
                                accept={ALLOWED_EXTS.map(e => `.${e}`).join(',')}
                                onChange={onFilesChange}
                                className="block text-xs text-theme-text-muted file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-dr7-gold file:text-theme-bg-primary file:text-xs file:font-semibold" />
                            <p className="text-[10px] text-theme-text-muted mt-2">PDF, JPG, PNG, DOC. Max 10 MB per file.</p>
                            {files.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {files.map((f, i) => (
                                        <li key={i} className="flex items-center justify-between text-xs bg-theme-bg-secondary rounded px-2 py-1.5 border border-theme-border">
                                            <span className="text-theme-text-primary truncate">{f.name}</span>
                                            <span className="flex items-center gap-2 flex-shrink-0">
                                                <span className="text-theme-text-muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                                                <button type="button" onClick={() => setFiles(arr => arr.filter((_, idx) => idx !== i))}
                                                    className="text-theme-text-muted hover:text-red-400">×</button>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {error && (
                            <div className="px-3 py-2 rounded-xl border border-theme-error/30 bg-theme-error/5 text-sm text-theme-error">
                                {error}
                            </div>
                        )}
                    </form>
                </div>

                <div className="px-6 sm:px-8 pb-6 pt-2 flex gap-3 border-t border-theme-border">
                    <button type="button" onClick={onClose}
                        className="flex-1 px-5 py-3 bg-transparent border border-theme-border hover:border-theme-text-muted text-theme-text-primary rounded-xl text-sm font-medium">
                        Annulla
                    </button>
                    <button type="button" onClick={submit} disabled={submitting}
                        className="flex-1 px-5 py-3 bg-dr7-gold text-theme-bg-primary rounded-xl text-sm font-semibold disabled:opacity-50">
                        {submitting ? 'Invio…' : 'Invia segnalazione'}
                    </button>
                </div>
            </div>
        </div>
    )
}
