/**
 * EMTNEventReportModal — apre un evento UNDER_REVIEW + carica i
 * documenti uno per uno (1 file per chiamata Netlify per non saturare
 * il timeout). Convalida client-side: type allow-list, headline >= 5,
 * description >= 20, almeno 1 file allegato prima del submit.
 *
 * 28/09/2026: piu' categorie per segnalazione (un clic aggiunge, un
 * secondo toglie) e piu' voci del cliente (danni, penali, importi da
 * saldare) nella stessa segnalazione, aggiungibili e rimovibili.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'
import EuropeanDateInput from '../../../../components/EuropeanDateInput'
import { EMTN_CATEGORIE, CATEGORIA_DI_VOCE, type EMTNVoce } from './emtnCategorie'

const ALLOWED_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx']
const MAX_BYTES = 10 * 1024 * 1024

const NOME_VOCE: Record<EMTNVoce['kind'], string> = { danno: 'Danno', penale: 'Penale', insoluto: 'Da saldare' }

const euro = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dataIt = (d: string | null) => {
    const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : 'data n/d'
}
function rigaVoce(v: EMTNVoce): string {
    return `- ${NOME_VOCE[v.kind]}: ${v.label} · ${v.vehicle || 'veicolo n/d'} · ${dataIt(v.eventDate)} · importo ${euro(v.amount)}, residuo ${euro(v.remaining)} · booking ${v.bookingId}`
}

export interface ReportPrefill {
    types?: string[]
    voci?: EMTNVoce[]
    headline?: string
    description?: string
    occurredAt?: string
}

interface Props {
    open: boolean
    onClose: () => void
    onCreated: (eventId: string) => void
    clientId: string
    prefill?: ReportPrefill | null
    /** Tutte le voci del cliente che si possono allegare. */
    vociDisponibili?: EMTNVoce[]
}

export default function EMTNEventReportModal({ open, onClose, onCreated, clientId, prefill, vociDisponibili = [] }: Props) {
    const [types, setTypes] = useState<string[]>([])
    const [voci, setVoci] = useState<EMTNVoce[]>([])
    const [headline, setHeadline] = useState('')
    const [description, setDescription] = useState('')
    const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 10))
    const [files, setFiles] = useState<File[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (open) {
            // Applica eventuale prefill (da "Segnala EMTN" di un danno/penale).
            // Solo all'apertura — non vogliamo sovrascrivere quel che l'utente
            // sta editando mentre il modale e\' aperto.
            if (prefill) {
                if (prefill.types) setTypes(prefill.types)
                if (prefill.voci) setVoci(prefill.voci)
                if (prefill.headline) setHeadline(prefill.headline)
                if (prefill.description) setDescription(prefill.description)
                if (prefill.occurredAt) setOccurredAt(prefill.occurredAt)
            }
        } else {
            setHeadline(''); setDescription(''); setFiles([]); setError(null)
            setTypes([]); setVoci([])
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    if (!open) return null

    const vociDaAggiungere = vociDisponibili.filter(v => !voci.some(x => x.key === v.key))

    function toggleCategoria(id: string) {
        setTypes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
    }
    function aggiungiVoce(key: string) {
        const v = vociDisponibili.find(x => x.key === key)
        if (!v) return
        setVoci(prev => [...prev, v])
        const cat = CATEGORIA_DI_VOCE[v.kind]
        setTypes(prev => prev.includes(cat) ? prev : [...prev, cat])
    }
    function aggiungiTutte() {
        vociDaAggiungere.forEach(v => aggiungiVoce(v.key))
    }
    function togliVoce(key: string) {
        setVoci(prev => prev.filter(v => v.key !== key))
    }

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
        if (types.length === 0) { setError('Scegli almeno una categoria'); return }
        if (headline.trim().length < 5) { setError('Titolo troppo breve'); return }
        const testo = [
            description.trim(),
            voci.length > 0 ? `Voci segnalate (${voci.length}):\n${voci.map(rigaVoce).join('\n')}` : '',
        ].filter(Boolean).join('\n\n')
        if (testo.length < 20) { setError('Descrizione troppo breve (min 20 caratteri)'); return }
        if (files.length === 0) { setError('Almeno un documento e\' obbligatorio'); return }
        setSubmitting(true)
        setError(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-event-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId, types,
                    headline: headline.trim(), description: testo, occurredAt,
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
                            <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">
                                Categorie <span className="normal-case font-normal tracking-normal">(anche piu' di una, clicca di nuovo per togliere)</span>
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {EMTN_CATEGORIE.map(t => {
                                    const active = types.includes(t.id)
                                    return (
                                        <button key={t.id} type="button" onClick={() => toggleCategoria(t.id)} title={t.helper}
                                            aria-pressed={active}
                                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium border text-left ${
                                                active
                                                    ? 'border-dr7-gold bg-dr7-gold/10 text-theme-text-primary'
                                                    : 'border-theme-border bg-theme-bg-primary text-theme-text-secondary hover:border-theme-border-light'
                                            }`}>
                                            <span>{t.label}</span>
                                            {active && <span aria-hidden className="text-theme-text-muted">×</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">
                                Voci segnalate {voci.length > 0 && <span className="normal-case font-normal tracking-normal">({voci.length})</span>}
                            </label>
                            {voci.length > 0 ? (
                                <ul className="space-y-1 mb-2">
                                    {voci.map(v => (
                                        <li key={v.key} className="flex items-center justify-between gap-2 text-xs bg-theme-bg-primary rounded-lg px-3 py-2 border border-theme-border">
                                            <span className="min-w-0">
                                                <span className="font-semibold text-theme-text-primary">{NOME_VOCE[v.kind]}</span>
                                                <span className="text-theme-text-primary"> · {v.label}</span>
                                                <span className="block text-[11px] text-theme-text-muted truncate">
                                                    {v.vehicle || 'veicolo n/d'} · {dataIt(v.eventDate)} · residuo {euro(v.remaining)}
                                                </span>
                                            </span>
                                            <button type="button" onClick={() => togliVoce(v.key)} aria-label={`Togli ${v.label}`}
                                                className="shrink-0 px-2 py-1 rounded text-theme-text-muted hover:text-red-400">×</button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-[11px] text-theme-text-muted mb-2">
                                    {vociDisponibili.length > 0 ? 'Nessuna voce: aggiungi danni, penali o importi da saldare del cliente.' : 'Il cliente non ha danni, penali o importi da saldare registrati.'}
                                </p>
                            )}
                            {vociDaAggiungere.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    <select value="" onChange={(e) => aggiungiVoce(e.target.value)}
                                        className="flex-1 min-w-0 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/40">
                                        <option value="">+ Aggiungi voce ({vociDaAggiungere.length} disponibili)</option>
                                        {vociDaAggiungere.map(v => (
                                            <option key={v.key} value={v.key}>
                                                {NOME_VOCE[v.kind]} · {v.label} · {dataIt(v.eventDate)} · residuo {euro(v.remaining)}
                                            </option>
                                        ))}
                                    </select>
                                    {vociDaAggiungere.length > 1 && (
                                        <button type="button" onClick={aggiungiTutte}
                                            className="px-3 py-2 rounded-lg border border-theme-border text-xs font-medium text-theme-text-primary hover:bg-theme-bg-hover">
                                            Aggiungi tutte
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)}
                                placeholder="Titolo breve" maxLength={120}
                                className="sm:col-span-2 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40" />
                            <EuropeanDateInput
                              value={occurredAt}
                              onChange={(__v: string) => setOccurredAt(__v)}
                              className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                            />
                        </div>

                        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                            placeholder="Descrizione: cosa e' successo, comunicazioni col cliente. Le voci segnalate vengono aggiunte in fondo da sole."
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
