import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../../../supabaseClient'
import Button from '../Button'
import LimitationOverrideModal from '../../../../components/LimitationOverrideModal'
import { hashFile, DOCUMENT_TIPO_LABELS } from './types'
import type { Fornitore, DocumentTipo } from './types'

interface Props {
    fornitore: Fornitore
    onClose: () => void
    /**
     * Called after at least one file uploaded successfully.
     * triggerCompare=true if the user clicked "Carica e confronta" — the
     * parent should then run the cross-check.
     */
    onSaved: (opts?: { triggerCompare?: boolean }) => void
    /**
     * Called when the user clicks "Inserimento manuale" — the parent should
     * close this modal and open the full edit form for a brand new document.
     */
    onManualEntry?: () => void
    /**
     * Optional. When set, every uploaded document is auto-linked to this
     * fattura via fattura_collegata_id, so the controllo incrociato can
     * match per-fattura instead of per-month.
     */
    fatturaId?: string
}

interface PendingItem {
    file: File
    status: 'pending' | 'uploading' | 'done' | 'error'
    error?: string
}

// Upload documenti fornitore — bolla / DDT / nota credito / ricevuta /
// fattura manuale. Tipo e nome custom selezionabili. Numero/data/importo
// auto-compilati con default ragionevoli; l'AI estrae i dati strutturati
// dopo l'upload, e l'operatore puo' modificare manualmente.
export default function FornitoreBollaUpload({ fornitore, onClose, onSaved, fatturaId }: Props) {
    const [tipo, setTipo] = useState<DocumentTipo>('bolla')
    const [customName, setCustomName] = useState('')
    const [items, setItems] = useState<PendingItem[]>([])
    const [uploading, setUploading] = useState(false)
    const [otpOpen, setOtpOpen] = useState(false)
    const [confirmingOtp, setConfirmingOtp] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !uploading) onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose, uploading])

    const ACCEPTED_EXT = /\.(pdf|jpe?g|png|webp)$/i
    const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']

    function handleFiles(fileList: FileList | null) {
        if (!fileList) return
        const incoming: PendingItem[] = []
        for (const f of Array.from(fileList)) {
            const okMime = ACCEPTED_MIME.includes(f.type)
            const okExt = ACCEPTED_EXT.test(f.name)
            if (!okMime && !okExt) {
                incoming.push({ file: f, status: 'error', error: 'Solo PDF o immagini (JPG, PNG, WEBP)' })
                continue
            }
            if (f.size > 50 * 1024 * 1024) {
                incoming.push({ file: f, status: 'error', error: 'File >50MB' })
                continue
            }
            incoming.push({ file: f, status: 'pending' })
        }
        setItems(prev => [...prev, ...incoming])
    }

    function removeItem(index: number) {
        setItems(prev => prev.filter((_, i) => i !== index))
    }

    async function uploadOne(item: PendingItem, index: number): Promise<void> {
        setItems(prev => prev.map((it, i) => i === index ? { ...it, status: 'uploading' } : it))
        try {
            const file = item.file
            const hash = await hashFile(file)
            const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase()
            const baseName = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 100)
            // Se l'utente ha scritto un nome custom usiamo quello; se ci sono
            // piu' file aggiungiamo un suffisso per non fare collidere il
            // numero_documento.
            const numero = (() => {
                const n = customName.trim()
                if (n) {
                    return items.length > 1 ? `${n}-${index + 1}` : n
                }
                return baseName || `${tipo.toUpperCase()}-${Date.now()}`
            })()
            const today = new Date().toISOString().slice(0, 10)
            const safeName = `${tipo}-${numero.replace(/[^\w-]/g, '_')}-${Date.now()}.${ext}`
            const yy = today.slice(0, 4)
            const mm = today.slice(5, 7)
            const path = `fornitori/${fornitore.id}/${yy}/${mm}/${safeName}`

            const { error: upErr } = await supabase.storage
                .from('fornitori-documents')
                .upload(path, file, { cacheControl: '31536000', upsert: false })
            if (upErr) throw upErr

            const { data: inserted, error: insErr } = await supabase
                .from('fornitore_documents')
                .insert({
                    fornitore_id: fornitore.id,
                    tipo,
                    numero_documento: numero,
                    data_documento: today,
                    importo_totale: 0,
                    file_url: path,
                    file_name: file.name,
                    file_hash: hash,
                    // Auto-link to the fattura when the modal was opened
                    // from a specific fattura row (per-row "+ Carica" button).
                    ...(fatturaId ? { fattura_collegata_id: fatturaId } : {}),
                })
                .select('id')
                .single()
            if (insErr) throw insErr

            setItems(prev => prev.map((it, i) => i === index ? { ...it, status: 'done' } : it))

            // Lancia in background l'estrazione AI dei dati strutturati (numero,
            // data, importi). Non blocchiamo l'upload — fa il refresh il caller.
            if (inserted?.id) {
                fetch('/.netlify/functions/extract-bolla-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentId: inserted.id }),
                }).catch(e => console.warn('[bolla-upload] AI extraction trigger failed:', e))
            }
        } catch (err: unknown) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e = err as any
            const msg = e?.message
                ? `${e.message}${e.code ? ` [${e.code}]` : ''}`
                : (err instanceof Error ? err.message : String(err))
            setItems(prev => prev.map((it, i) => i === index ? { ...it, status: 'error', error: msg } : it))
        }
    }

    async function handleUploadAll(triggerCompare: boolean) {
        const toUpload = items.map((it, i) => ({ it, i })).filter(({ it }) => it.status === 'pending')
        if (toUpload.length === 0) {
            // Nothing to upload — close + maybe trigger compare anyway
            onSaved({ triggerCompare })
            onClose()
            return
        }
        setUploading(true)
        for (const { it, i } of toUpload) {
            await uploadOne(it, i)
        }
        setUploading(false)
        // Sempre notifica il padre — alcuni file potrebbero essere falliti ma
        // gli altri sono stati caricati.
        onSaved({ triggerCompare })
        onClose()
    }

    const hasPending = items.some(i => i.status === 'pending')
    const hasDone = items.some(i => i.status === 'done')

    /**
     * OTP-authorized confirm WITHOUT a file. Used quando il fornitore ha
     * ammesso verbalmente il documento ma non c'e' carta — il direttore
     * (Valerio) autorizza via OTP e il documento finisce in DB con
     * stato='verificato' senza bisogno di upload.
     */
    async function confirmWithoutFile(overrideId: string) {
        setConfirmingOtp(true)
        try {
            const today = new Date().toISOString().slice(0, 10)
            const numero = customName.trim() || `${tipo.toUpperCase()}-OTP-${Date.now()}`
            const { error: insErr } = await supabase
                .from('fornitore_documents')
                .insert({
                    fornitore_id: fornitore.id,
                    tipo,
                    numero_documento: numero,
                    data_documento: today,
                    importo_totale: 0,
                    stato: 'verificato',
                    note: `Autorizzato con OTP — override ${overrideId.slice(0, 8)}`,
                    ...(fatturaId ? { fattura_collegata_id: fatturaId } : {}),
                })
            if (insErr) {
                alert('Errore inserimento: ' + insErr.message)
                return
            }
            onSaved({ triggerCompare: true })
            onClose()
        } finally {
            setConfirmingOtp(false)
        }
    }

    return (
        <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !uploading && !otpOpen && onClose()}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-lg w-full p-6"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">Carica documento</h3>
                    <button onClick={onClose} disabled={uploading}
                        className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary disabled:opacity-50">×</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <label className="block">
                        <span className="text-xs text-theme-text-secondary">Tipo</span>
                        <select
                            value={tipo}
                            onChange={e => setTipo(e.target.value as DocumentTipo)}
                            disabled={uploading}
                            className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
                        >
                            <option value="bolla">{DOCUMENT_TIPO_LABELS.bolla}</option>
                            <option value="proforma">{DOCUMENT_TIPO_LABELS.proforma}</option>
                            <option value="preventivo">{DOCUMENT_TIPO_LABELS.preventivo}</option>
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-xs text-theme-text-secondary">Nome / Numero (opzionale)</span>
                        <input
                            type="text"
                            value={customName}
                            onChange={e => setCustomName(e.target.value)}
                            disabled={uploading}
                            placeholder="Es: 2026/045 — lascia vuoto per usare il nome file"
                            className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary"
                        />
                    </label>
                </div>

                <p className="text-xs text-theme-text-muted mb-3">
                    Data e importi vengono compilati automaticamente dall'AI dopo l'upload — puoi modificarli dal pulsante <strong>Modifica</strong> sulla riga.
                </p>

                <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault() }}
                    onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
                    className="border-2 border-dashed border-theme-border rounded-lg p-8 text-center cursor-pointer hover:bg-theme-bg-tertiary transition"
                >
                    <p className="text-theme-text-secondary text-sm">
                        Clicca o trascina qui i file
                    </p>
                    <p className="text-xs text-theme-text-muted mt-1">PDF o immagini (JPG, PNG, WEBP) — max 50 MB</p>
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                    multiple
                    className="hidden"
                    onChange={e => handleFiles(e.target.files)}
                />

                {items.length > 0 && (
                    <div className="mt-4 max-h-60 overflow-y-auto space-y-1">
                        {items.map((it, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-theme-bg-tertiary text-sm">
                                <span className="truncate text-theme-text-primary flex-1" title={it.file.name}>{it.file.name}</span>
                                {it.status === 'pending' && (
                                    <button onClick={() => removeItem(i)} disabled={uploading}
                                        className="text-theme-text-muted hover:text-red-400 disabled:opacity-50">×</button>
                                )}
                                {it.status === 'uploading' && (
                                    <span className="text-xs text-blue-300">Caricamento…</span>
                                )}
                                {it.status === 'done' && (
                                    <span className="text-xs text-emerald-300">Caricato</span>
                                )}
                                {it.status === 'error' && (
                                    <span className="text-xs text-red-300" title={it.error}>Errore: {it.error}</span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 mt-5">
                    {!hasPending && !hasDone ? (
                        <button
                            type="button"
                            onClick={() => setOtpOpen(true)}
                            disabled={uploading || confirmingOtp}
                            title="Inserisce il documento senza file allegato — invia un OTP a Valerio per autorizzazione"
                            className="px-4 py-2 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs font-semibold hover:opacity-80 disabled:opacity-50"
                        >
                            {confirmingOtp ? 'Conferma in corso…' : 'Autorizza con OTP (senza file)'}
                        </button>
                    ) : <span />}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" onClick={onClose} disabled={uploading || confirmingOtp}>Chiudi</Button>
                        {hasPending && (
                            <>
                                <Button variant="secondary" onClick={() => handleUploadAll(false)} disabled={uploading}>
                                    {uploading ? 'Caricamento…' : 'Carica'}
                                </Button>
                                <Button onClick={() => handleUploadAll(true)} disabled={uploading}>
                                    {uploading ? 'Caricamento…' : 'Carica e confronta'}
                                </Button>
                            </>
                        )}
                        {!hasPending && hasDone && (
                            <Button onClick={() => { onSaved({ triggerCompare: true }); onClose() }}>
                                Fine e confronta
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* OTP modal renderizzato fuori dall'overlay di Carica documento per
            evitare che i click bubble all'onClick={onClose} del padre.
            Pattern visto in PreventiviTab. */}
        <LimitationOverrideModal
            isOpen={otpOpen}
            limitationCode="fornitore_doc_no_file"
            limitationMessage={`Autorizza inserimento ${DOCUMENT_TIPO_LABELS[tipo]} senza file allegato per ${fornitore.nome}.`}
            actionContext={`fornitore_doc_otp_${fornitore.id}_${tipo}`}
            draftSessionId={`fornitore-${fornitore.id}-otp-${Date.now()}`}
            flowType="fornitori"
            onCancel={() => setOtpOpen(false)}
            onOverrideApproved={(overrideId) => {
                setOtpOpen(false)
                confirmWithoutFile(overrideId)
            }}
        />
        </>
    )
}
