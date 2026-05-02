import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../../../supabaseClient'
import Button from '../Button'
import { hashFile } from './types'
import type { Fornitore } from './types'

interface Props {
    fornitore: Fornitore
    onClose: () => void
    onSaved: () => void
}

interface PendingItem {
    file: File
    status: 'pending' | 'uploading' | 'done' | 'error'
    error?: string
}

// Minimal "drop a PDF, done" upload for bolle / DDT.
// No mandatory fields — numero, data, importo are auto-filled with safe defaults
// so the operator just picks files and clicks Carica. They can edit metadata
// later from the regular document edit modal if needed.
export default function FornitoreBollaUpload({ fornitore, onClose, onSaved }: Props) {
    const [items, setItems] = useState<PendingItem[]>([])
    const [uploading, setUploading] = useState(false)
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
            const numero = baseName || `BOLLA-${Date.now()}`
            const today = new Date().toISOString().slice(0, 10)
            const safeName = `bolla-${numero.replace(/[^\w-]/g, '_')}-${Date.now()}.${ext}`
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
                    tipo: 'bolla',
                    numero_documento: numero,
                    data_documento: today,
                    importo_totale: 0,
                    file_url: path,
                    file_name: file.name,
                    file_hash: hash,
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

    async function handleUploadAll() {
        const toUpload = items.map((it, i) => ({ it, i })).filter(({ it }) => it.status === 'pending')
        if (toUpload.length === 0) return
        setUploading(true)
        for (const { it, i } of toUpload) {
            await uploadOne(it, i)
        }
        setUploading(false)
        const allDoneOrSkipped = items.every(it => it.status === 'done' || it.status === 'error')
        if (allDoneOrSkipped) {
            onSaved()
        }
    }

    function handleDone() {
        onSaved()
        onClose()
    }

    const hasPending = items.some(i => i.status === 'pending')
    const hasDone = items.some(i => i.status === 'done')

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !uploading && onClose()}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-lg w-full p-6"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">Carica Bolle (PDF)</h3>
                    <button onClick={onClose} disabled={uploading}
                        className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary disabled:opacity-50">×</button>
                </div>

                <p className="text-sm text-theme-text-muted mb-4">
                    Trascina o seleziona uno o più PDF. Numero, data e importo sono assegnati automaticamente — puoi editarli dopo dal documento.
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

                <div className="flex items-center justify-end gap-2 mt-5">
                    <Button variant="secondary" onClick={onClose} disabled={uploading}>Chiudi</Button>
                    {hasPending && (
                        <Button onClick={handleUploadAll} disabled={uploading}>
                            {uploading ? 'Caricamento…' : `Carica ${items.filter(it => it.status === 'pending').length} PDF`}
                        </Button>
                    )}
                    {!hasPending && hasDone && (
                        <Button onClick={handleDone}>Fine</Button>
                    )}
                </div>
            </div>
        </div>
    )
}
