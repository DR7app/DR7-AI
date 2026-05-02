import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import Button from '../Button'
import FornitoreDocumentUpload from './FornitoreDocumentUpload'
import { useAdminRole } from '../../../../hooks/useAdminRole'
import {
    DOCUMENT_TIPO_LABELS,
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
    MESI_IT,
    fmtEUR,
    fmtDateIT,
    nextStates,
} from './types'
import type { Fornitore, FornitoreDocument, DocumentTipo, DocumentStato } from './types'

// Approvazione + pagamento riservati agli amministratori (role === 'superadmin').
const RESTRICTED_STATES: DocumentStato[] = ['approvato', 'pagabile', 'pagato']

interface Props {
    fornitore: Fornitore
    /** Filter shown documents */
    tipiFilter?: DocumentTipo[]
    /** Only show docs in these stati */
    statiFilter?: DocumentStato[]
    /** Force a default tipo when uploading from this view */
    defaultUploadTipo?: DocumentTipo
    /** Show "Sincronizza da Aruba" button — only meaningful on the Fatture tab */
    enableArubaSync?: boolean
    title?: string
}

export default function FornitoreDocsList({ fornitore, tipiFilter, statiFilter, title, defaultUploadTipo, enableArubaSync }: Props) {
    const today = new Date()
    const [anno, setAnno] = useState<number | 'tutti'>(today.getFullYear())
    const [docs, setDocs] = useState<FornitoreDocument[]>([])
    const [loading, setLoading] = useState(false)
    const [showUpload, setShowUpload] = useState(false)
    const [editingDoc, setEditingDoc] = useState<FornitoreDocument | null>(null)
    const [syncingAruba, setSyncingAruba] = useState(false)
    const { role: adminRole } = useAdminRole()
    const canApproveOrPay = adminRole === 'superadmin'

    async function syncFromAruba() {
        const monthsStr = window.prompt('Quanti mesi indietro sincronizzare da Aruba? (1-12)', '6')
        if (!monthsStr) return
        const months = parseInt(monthsStr)
        if (isNaN(months) || months < 1 || months > 12) {
            alert('Inserisci un numero tra 1 e 12')
            return
        }
        setSyncingAruba(true)
        try {
            const res = await fetch('/.netlify/functions/sync-fornitore-invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fornitore_id: fornitore.id, months }),
            })
            const text = await res.text()
            let json: any
            try { json = JSON.parse(text) } catch {
                throw new Error(`HTTP ${res.status} (probabile timeout): ${text.slice(0, 200)}`)
            }
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            alert(`Sincronizzazione completata:\n- Match Aruba: ${json.matched}\n- Inserite: ${json.inserted}\n- Gia' presenti: ${json.skipped}\n- Falliti: ${json.failed}`)
            load()
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            alert(`Sincronizzazione fallita: ${msg}`)
        } finally {
            setSyncingAruba(false)
        }
    }

    async function load() {
        setLoading(true)
        try {
            let q = supabase
                .from('fornitore_documents')
                .select('*')
                .eq('fornitore_id', fornitore.id)
                .order('data_documento', { ascending: false })
            if (anno !== 'tutti') q = q.eq('periodo_anno', anno)
            if (tipiFilter && tipiFilter.length) q = q.in('tipo', tipiFilter)
            if (statiFilter && statiFilter.length) q = q.in('stato', statiFilter)
            const { data, error } = await q
            if (error) throw error
            setDocs((data || []) as FornitoreDocument[])
        } catch (err) {
            console.error('[docslist] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore.id, anno, JSON.stringify(tipiFilter), JSON.stringify(statiFilter)])

    const totale = useMemo(() => docs.reduce((s, d) => s + Number(d.importo_totale || 0), 0), [docs])

    async function transitionDoc(doc: FornitoreDocument, newStato: DocumentStato) {
        // Approvazione + pagamento riservati agli amministratori
        if (RESTRICTED_STATES.includes(newStato) && !canApproveOrPay) {
            alert('Solo un amministratore può approvare o pagare.')
            return
        }
        const updates: Record<string, unknown> = { stato: newStato }
        if (newStato === 'pagato') {
            const dataPag = prompt('Data pagamento (YYYY-MM-DD)', new Date().toISOString().slice(0, 10))
            if (!dataPag) return
            const metodo = prompt('Metodo pagamento (bonifico, contanti, RID, ecc.)', 'bonifico')
            if (!metodo) return
            updates.data_pagamento = dataPag
            updates.metodo_pagamento = metodo
        }
        const { error } = await supabase.from('fornitore_documents').update(updates).eq('id', doc.id)
        if (error) { alert('Errore: ' + error.message); return }
        load()
    }

    async function deleteDoc(doc: FornitoreDocument) {
        if (!confirm(`Eliminare ${DOCUMENT_TIPO_LABELS[doc.tipo]} n.${doc.numero_documento}?`)) return
        if (doc.file_url) await supabase.storage.from('fornitori-documents').remove([doc.file_url])
        await supabase.from('fornitore_documents').delete().eq('id', doc.id)
        load()
    }

    async function viewFile(doc: FornitoreDocument) {
        if (!doc.file_url) return
        const { data, error } = await supabase.storage
            .from('fornitori-documents')
            .createSignedUrl(doc.file_url, 60 * 5)
        if (error || !data?.signedUrl) { alert('File non disponibile'); return }
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    }

    async function downloadAruba(doc: FornitoreDocument, kind: 'pdf' | 'xml') {
        if (!doc.aruba_filename) return
        try {
            const res = await fetch(`/.netlify/functions/get-incoming-invoices?action=download&filename=${encodeURIComponent(doc.aruba_filename)}`)
            const json = await res.json()
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            const data = json.invoice || {}
            const base64 = kind === 'pdf' ? (data.pdf || data.pdfFile) : (data.file || data.xml)
            const mime = kind === 'pdf' ? 'application/pdf' : 'application/xml'
            if (!base64) {
                alert(`${kind.toUpperCase()} non disponibile per questa fattura`)
                return
            }
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
            const blob = new Blob([bytes], { type: mime })
            const url = URL.createObjectURL(blob)
            window.open(url, '_blank', 'noopener,noreferrer')
            // Revoke after a short delay so the new tab can load
            setTimeout(() => URL.revokeObjectURL(url), 60000)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            alert(`Download fallito: ${msg}`)
        }
    }

    const annoOptions: number[] = []
    for (let y = today.getFullYear(); y >= 2026; y--) annoOptions.push(y)

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {title && <h3 className="text-lg font-semibold text-theme-text-primary mr-2">{title}</h3>}
                <select value={anno} onChange={e => setAnno(e.target.value === 'tutti' ? 'tutti' : parseInt(e.target.value))}
                    className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                    <option value="tutti">Tutti gli anni</option>
                    {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <span className="text-sm text-theme-text-secondary">
                    {docs.length} doc · totale <strong className="text-theme-text-primary">{fmtEUR(totale)}</strong>
                </span>
                <div className="ml-auto flex gap-2">
                    {enableArubaSync && (
                        <button
                            type="button"
                            onClick={syncFromAruba}
                            disabled={syncingAruba}
                            className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                            title="Importa nel database le fatture trovate su Aruba SDI per questo fornitore"
                        >
                            {syncingAruba ? 'Sincronizzo...' : 'Sincronizza da Aruba'}
                        </button>
                    )}
                    <Button onClick={() => { setEditingDoc(null); setShowUpload(true) }}>+ Carica documento</Button>
                </div>
            </div>

            <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                        <tr>
                            <th className="text-left px-3 py-2">Tipo</th>
                            <th className="text-left px-3 py-2">N°</th>
                            <th className="text-left px-3 py-2">Data</th>
                            <th className="text-left px-3 py-2">Mese</th>
                            <th className="text-left px-3 py-2">Scadenza</th>
                            <th className="text-right px-3 py-2">Totale</th>
                            <th className="text-left px-3 py-2">Stato</th>
                            <th className="text-left px-3 py-2">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border">
                        {loading && (
                            <tr><td colSpan={8} className="text-center py-6 text-theme-text-muted">Caricamento…</td></tr>
                        )}
                        {!loading && docs.length === 0 && (
                            <tr><td colSpan={8} className="text-center py-6 text-theme-text-muted">Nessun documento</td></tr>
                        )}
                        {docs.map(doc => {
                            const transitions = nextStates(doc.stato, doc.tipo)
                            return (
                                <tr key={doc.id}>
                                    <td className="px-3 py-2 text-theme-text-primary uppercase text-xs">{DOCUMENT_TIPO_LABELS[doc.tipo]}</td>
                                    <td className="px-3 py-2 text-theme-text-primary font-mono">{doc.numero_documento}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">{fmtDateIT(doc.data_documento)}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary text-xs">{MESI_IT[doc.periodo_mese - 1]} {doc.periodo_anno}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">{fmtDateIT(doc.data_scadenza)}</td>
                                    <td className="px-3 py-2 text-right text-theme-text-primary font-semibold">{fmtEUR(doc.importo_totale)}</td>
                                    <td className="px-3 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${DOCUMENT_STATO_COLORS[doc.stato]}`}>
                                            {DOCUMENT_STATO_LABELS[doc.stato]}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex flex-wrap gap-1">
                                            {doc.file_url && (
                                                <button onClick={() => viewFile(doc)}
                                                    className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                                                    Vedi
                                                </button>
                                            )}
                                            {doc.aruba_filename && (
                                                <>
                                                    <button onClick={() => downloadAruba(doc, 'pdf')}
                                                        className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white"
                                                        title="Scarica il PDF dalla fattura Aruba">
                                                        PDF
                                                    </button>
                                                    <button onClick={() => downloadAruba(doc, 'xml')}
                                                        className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary"
                                                        title="Scarica il XML dalla fattura Aruba">
                                                        XML
                                                    </button>
                                                </>
                                            )}
                                            <button onClick={() => { setEditingDoc(doc); setShowUpload(true) }}
                                                className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                                                Modifica
                                            </button>
                                            {transitions.map(s => {
                                                const restricted = RESTRICTED_STATES.includes(s)
                                                const blocked = restricted && !canApproveOrPay
                                                return (
                                                    <button key={s}
                                                        onClick={() => transitionDoc(doc, s)}
                                                        disabled={blocked}
                                                        className={`text-xs px-2 py-1 rounded ${DOCUMENT_STATO_COLORS[s]} ${blocked ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80'}`}
                                                        title={blocked
                                                            ? `Solo un amministratore può ${s === 'pagato' ? 'pagare' : 'approvare'}`
                                                            : `Sposta in: ${DOCUMENT_STATO_LABELS[s]}`}>
                                                        → {DOCUMENT_STATO_LABELS[s]}
                                                    </button>
                                                )
                                            })}
                                            <button onClick={() => deleteDoc(doc)}
                                                className="text-xs px-2 py-1 rounded bg-red-900 hover:bg-red-800 text-red-200">
                                                ×
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {showUpload && (
                <FornitoreDocumentUpload
                    fornitore={fornitore}
                    document={editingDoc}
                    defaultTipo={!editingDoc ? defaultUploadTipo : undefined}
                    onClose={() => { setShowUpload(false); setEditingDoc(null) }}
                    onSaved={() => { setShowUpload(false); setEditingDoc(null); load() }}
                />
            )}
        </div>
    )
}
