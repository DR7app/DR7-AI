import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../../../supabaseClient'
import Input from '../Input'
import Select from '../Select'
import Button from '../Button'
import { hashFile, DOCUMENT_TIPO_LABELS } from './types'
import type { Fornitore, FornitoreDocument, DocumentTipo } from './types'

interface Props {
    fornitore: Fornitore
    document?: FornitoreDocument | null  // for edit
    defaultTipo?: DocumentTipo  // pre-selected tipo when uploading from a tab
    onClose: () => void
    onSaved: (doc: FornitoreDocument) => void
}

const TIPO_OPTIONS: { value: DocumentTipo; label: string }[] = [
    { value: 'fattura', label: DOCUMENT_TIPO_LABELS.fattura },
    { value: 'ddt', label: DOCUMENT_TIPO_LABELS.ddt },
    { value: 'bolla', label: DOCUMENT_TIPO_LABELS.bolla },
    { value: 'nota_credito', label: DOCUMENT_TIPO_LABELS.nota_credito },
    { value: 'ricevuta_pagamento', label: DOCUMENT_TIPO_LABELS.ricevuta_pagamento },
]

export default function FornitoreDocumentUpload({ fornitore, document: existingDoc, defaultTipo, onClose, onSaved }: Props) {
    const isEdit = !!existingDoc
    const [tipo, setTipo] = useState<DocumentTipo>(existingDoc?.tipo || defaultTipo || 'fattura')
    const [numeroDoc, setNumeroDoc] = useState(existingDoc?.numero_documento || '')
    const [dataDoc, setDataDoc] = useState(existingDoc?.data_documento || new Date().toISOString().slice(0, 10))
    const [dataScadenza, setDataScadenza] = useState(existingDoc?.data_scadenza || '')
    const [importoImponibile, setImportoImponibile] = useState(existingDoc?.importo_imponibile?.toString() || '')
    const [importoIva, setImportoIva] = useState(existingDoc?.importo_iva?.toString() || '')
    const [importoTotale, setImportoTotale] = useState(existingDoc?.importo_totale?.toString() || '')
    const [note, setNote] = useState(existingDoc?.note || '')
    const [file, setFile] = useState<File | null>(null)
    const [keepExistingFile, setKeepExistingFile] = useState(isEdit && !!existingDoc?.file_url)
    const [saving, setSaving] = useState(false)
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    // Auto-compute scadenza when fattura + data cambia
    useEffect(() => {
        if (isEdit) return
        if (tipo !== 'fattura' || !dataDoc) return
        const giorni = fornitore.scadenza_default_giorni || 30
        const d = new Date(dataDoc)
        d.setDate(d.getDate() + giorni)
        setDataScadenza(d.toISOString().slice(0, 10))
    }, [tipo, dataDoc, fornitore.scadenza_default_giorni, isEdit])

    // Auto-compute totale = imponibile + iva
    useEffect(() => {
        const imp = parseFloat(importoImponibile)
        const iva = parseFloat(importoIva)
        if (!isNaN(imp) && !isNaN(iva)) {
            setImportoTotale((imp + iva).toFixed(2))
        }
    }, [importoImponibile, importoIva])

    // Duplicate detection on numero+data
    useEffect(() => {
        let cancelled = false
        async function check() {
            if (isEdit) return
            if (!numeroDoc.trim() || !dataDoc) {
                setDuplicateWarning(null)
                return
            }
            const { data } = await supabase
                .from('fornitore_documents')
                .select('id, numero_documento, data_documento')
                .eq('fornitore_id', fornitore.id)
                .eq('tipo', tipo)
                .eq('numero_documento', numeroDoc.trim())
                .eq('data_documento', dataDoc)
                .maybeSingle()
            if (cancelled) return
            if (data) {
                setDuplicateWarning(`Documento ${tipo.toUpperCase()} n.${numeroDoc} del ${dataDoc} già caricato per questo fornitore.`)
            } else {
                setDuplicateWarning(null)
            }
        }
        check()
        return () => { cancelled = true }
    }, [numeroDoc, dataDoc, tipo, fornitore.id, isEdit])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!numeroDoc.trim()) return alert('Numero documento obbligatorio')
        if (!dataDoc) return alert('Data documento obbligatoria')
        if (!importoTotale || isNaN(parseFloat(importoTotale))) return alert('Importo totale obbligatorio')
        if (!isEdit && !file) return alert('Allegato obbligatorio')
        if (duplicateWarning && !confirm(duplicateWarning + '\n\nVuoi continuare comunque?')) return

        setSaving(true)
        try {
            let fileUrl: string | null = existingDoc?.file_url ?? null
            let fileName: string | null = existingDoc?.file_name ?? null
            let fileHash: string | null = existingDoc?.file_hash ?? null

            // Upload file if provided
            if (file) {
                if (file.size > 20 * 1024 * 1024) throw new Error('File troppo grande (max 20 MB)')

                const hash = await hashFile(file)
                fileHash = hash

                // Soft duplicate check on hash (might be the same scan re-uploaded)
                const { data: dupHash } = await supabase
                    .from('fornitore_documents')
                    .select('id, numero_documento')
                    .eq('fornitore_id', fornitore.id)
                    .eq('file_hash', hash)
                    .maybeSingle()
                if (dupHash && (!isEdit || dupHash.id !== existingDoc?.id)) {
                    if (!confirm(`Lo stesso file è già stato caricato (doc n.${dupHash.numero_documento}). Continuare?`)) {
                        setSaving(false)
                        return
                    }
                }

                const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
                const safeName = `${tipo}-${numeroDoc.replace(/[^\w-]/g, '_')}-${Date.now()}.${ext}`
                const dataObj = new Date(dataDoc)
                const path = `fornitori/${fornitore.id}/${dataObj.getFullYear()}/${String(dataObj.getMonth() + 1).padStart(2, '0')}/${safeName}`

                const { error: upErr } = await supabase.storage
                    .from('fornitori-documents')
                    .upload(path, file, { cacheControl: '31536000', upsert: false })
                if (upErr) throw upErr

                fileUrl = path  // store the path; we sign on view
                fileName = file.name
            }

            const payload = {
                fornitore_id: fornitore.id,
                tipo,
                numero_documento: numeroDoc.trim(),
                data_documento: dataDoc,
                data_scadenza: dataScadenza || null,
                importo_imponibile: importoImponibile ? parseFloat(importoImponibile) : null,
                importo_iva: importoIva ? parseFloat(importoIva) : null,
                importo_totale: parseFloat(importoTotale),
                file_url: fileUrl,
                file_name: fileName,
                file_hash: fileHash,
                note: note.trim() || null,
            }

            if (isEdit && existingDoc) {
                const { data: row, error } = await supabase
                    .from('fornitore_documents')
                    .update(payload)
                    .eq('id', existingDoc.id)
                    .select()
                    .single()
                if (error) throw error
                onSaved(row as FornitoreDocument)
            } else {
                const { data: row, error } = await supabase
                    .from('fornitore_documents')
                    .insert(payload)
                    .select()
                    .single()
                if (error) throw error
                onSaved(row as FornitoreDocument)
            }
            onClose()
        } catch (err) {
            console.error('[FornitoreDocumentUpload] save error:', err)
            const e = err as { message?: string; details?: string; hint?: string; code?: string }
            const msg = e?.message
                ? `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` (hint: ${e.hint})` : ''}${e.code ? ` [${e.code}]` : ''}`
                : (err instanceof Error ? err.message : JSON.stringify(err))
            alert('Errore: ' + msg)
        } finally {
            setSaving(false)
        }
    }

    const isFattura = tipo === 'fattura'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-2xl w-full max-h-[90vh] overflow-auto p-6"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">
                        {isEdit ? 'Modifica documento' : 'Carica documento'} — {fornitore.nome}
                    </h3>
                    <button onClick={onClose} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Select label="Tipo documento *" required value={tipo}
                            onChange={e => setTipo(e.target.value as DocumentTipo)}
                            options={TIPO_OPTIONS} />
                        <Input label="Numero documento *" required value={numeroDoc}
                            onChange={e => setNumeroDoc(e.target.value)} placeholder="Es: 2026/045" />
                        <Input label="Data documento *" type="date" required value={dataDoc}
                            onChange={e => setDataDoc(e.target.value)} />
                        {isFattura && (
                            <Input label="Data scadenza" type="date" value={dataScadenza}
                                onChange={e => setDataScadenza(e.target.value)} />
                        )}
                    </div>

                    {duplicateWarning && (
                        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-200 px-4 py-2 rounded text-sm">
                            ⚠ {duplicateWarning}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 bg-theme-bg-tertiary/40 rounded">
                        <Input label="Imponibile (€)" type="number" step="0.01" value={importoImponibile}
                            onChange={e => setImportoImponibile(e.target.value)} placeholder="0,00" />
                        <Input label="IVA (€)" type="number" step="0.01" value={importoIva}
                            onChange={e => setImportoIva(e.target.value)} placeholder="0,00" />
                        <Input label="Totale (€) *" type="number" step="0.01" required value={importoTotale}
                            onChange={e => setImportoTotale(e.target.value)} placeholder="0,00" />
                    </div>

                    <div className="p-3 bg-theme-bg-tertiary/40 rounded">
                        <label className="block text-sm text-theme-text-secondary mb-1">
                            Allegato {isEdit ? '(lascia vuoto per mantenere quello attuale)' : '*'}
                        </label>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
                            onChange={e => {
                                const f = e.target.files?.[0] || null
                                setFile(f)
                                if (f) setKeepExistingFile(false)
                            }}
                            className="text-sm text-theme-text-primary"
                        />
                        {keepExistingFile && existingDoc?.file_name && (
                            <p className="text-xs text-theme-text-muted mt-1">Allegato attuale: {existingDoc.file_name}</p>
                        )}
                        <p className="text-xs text-theme-text-muted mt-1">PDF / JPG / PNG / WEBP. Max 20 MB.</p>
                    </div>

                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-1">Note</label>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={2}
                            className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-theme-border">
                        <Button type="button" variant="secondary" onClick={onClose}>Annulla</Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? 'Salvataggio…' : (isEdit ? 'Aggiorna' : 'Carica')}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
