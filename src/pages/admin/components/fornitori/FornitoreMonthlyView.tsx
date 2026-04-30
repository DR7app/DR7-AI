import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import Button from '../Button'
import FornitoreDocumentUpload from './FornitoreDocumentUpload'
import { runCrosscheck, applyCrosscheckToFatture } from './FornitoreCrosscheck'
import {
    DOCUMENT_TIPO_LABELS,
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
    MESI_IT,
    fmtEUR,
    fmtDateIT,
    nextStates,
} from './types'
import type { Fornitore, FornitoreDocument, CrosscheckRow, DocumentStato } from './types'

interface Props {
    fornitore: Fornitore
}

export default function FornitoreMonthlyView({ fornitore }: Props) {
    const today = new Date()
    const [anno, setAnno] = useState(today.getFullYear())
    const [mese, setMese] = useState(today.getMonth() + 1)
    const [docs, setDocs] = useState<FornitoreDocument[]>([])
    const [crosscheck, setCrosscheck] = useState<CrosscheckRow[]>([])
    const [loading, setLoading] = useState(false)
    const [showUpload, setShowUpload] = useState(false)
    const [editingDoc, setEditingDoc] = useState<FornitoreDocument | null>(null)

    async function loadMonth() {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('fornitore_documents')
                .select('*')
                .eq('fornitore_id', fornitore.id)
                .eq('periodo_anno', anno)
                .eq('periodo_mese', mese)
                .order('data_documento', { ascending: true })
            if (error) throw error
            const rows = (data || []) as FornitoreDocument[]
            setDocs(rows)
            // Run cross-check
            const cc = await runCrosscheck(fornitore.id, anno, mese)
            setCrosscheck(cc)
            await applyCrosscheckToFatture(cc, rows)
            // Reload to get updated stati
            const { data: data2 } = await supabase
                .from('fornitore_documents')
                .select('*')
                .eq('fornitore_id', fornitore.id)
                .eq('periodo_anno', anno)
                .eq('periodo_mese', mese)
                .order('data_documento', { ascending: true })
            setDocs((data2 || []) as FornitoreDocument[])
        } catch (err) {
            console.error('[monthly] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadMonth()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore.id, anno, mese])

    const totals = useMemo(() => {
        const fatture = docs.filter(d => d.tipo === 'fattura')
        const noteCredito = docs.filter(d => d.tipo === 'nota_credito')
        const ddt = docs.filter(d => d.tipo === 'ddt' || d.tipo === 'bolla')
        const ricevute = docs.filter(d => d.tipo === 'ricevuta_pagamento')
        const sum = (xs: FornitoreDocument[]) => xs.reduce((s, x) => s + Number(x.importo_totale || 0), 0)
        return {
            fatture: sum(fatture),
            noteCredito: sum(noteCredito),
            ddt: sum(ddt),
            ricevute: sum(ricevute),
            netDovuto: sum(fatture) - sum(noteCredito) - sum(ricevute),
            countFatture: fatture.length,
            countDdt: ddt.length,
        }
    }, [docs])

    async function transitionDoc(doc: FornitoreDocument, newStato: DocumentStato) {
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
        if (error) {
            alert('Errore: ' + error.message)
            return
        }
        loadMonth()
    }

    async function deleteDoc(doc: FornitoreDocument) {
        if (!confirm(`Eliminare ${DOCUMENT_TIPO_LABELS[doc.tipo]} n.${doc.numero_documento}?`)) return
        // delete file from storage if path stored
        if (doc.file_url) {
            await supabase.storage.from('fornitori-documents').remove([doc.file_url])
        }
        await supabase.from('fornitore_documents').delete().eq('id', doc.id)
        loadMonth()
    }

    async function viewFile(doc: FornitoreDocument) {
        if (!doc.file_url) return
        const { data, error } = await supabase.storage
            .from('fornitori-documents')
            .createSignedUrl(doc.file_url, 60 * 5) // 5 min
        if (error || !data?.signedUrl) {
            alert('File non disponibile')
            return
        }
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    }

    const annoOptions: number[] = []
    for (let y = today.getFullYear() + 1; y >= 2020; y--) annoOptions.push(y)

    return (
        <div className="space-y-4">
            {/* Header / period selector */}
            <div className="flex flex-wrap items-center gap-2">
                <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                    className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary">
                    {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={mese} onChange={e => setMese(parseInt(e.target.value))}
                    className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary">
                    {MESI_IT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <Button onClick={() => loadMonth()} variant="secondary">Aggiorna</Button>
                <div className="ml-auto">
                    <Button onClick={() => { setEditingDoc(null); setShowUpload(true) }}>+ Carica documento</Button>
                </div>
            </div>

            {/* Totals card */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="p-3 bg-theme-bg-tertiary/50 rounded border border-theme-border">
                    <div className="text-xs text-theme-text-muted">DDT/Bolle</div>
                    <div className="text-lg font-bold text-theme-text-primary">{fmtEUR(totals.ddt)}</div>
                    <div className="text-xs text-theme-text-muted">{totals.countDdt} doc</div>
                </div>
                <div className="p-3 bg-theme-bg-tertiary/50 rounded border border-theme-border">
                    <div className="text-xs text-theme-text-muted">Fatture</div>
                    <div className="text-lg font-bold text-theme-text-primary">{fmtEUR(totals.fatture)}</div>
                    <div className="text-xs text-theme-text-muted">{totals.countFatture} doc</div>
                </div>
                <div className="p-3 bg-theme-bg-tertiary/50 rounded border border-theme-border">
                    <div className="text-xs text-theme-text-muted">Note Credito</div>
                    <div className="text-lg font-bold text-theme-text-primary">{fmtEUR(totals.noteCredito)}</div>
                </div>
                <div className="p-3 bg-theme-bg-tertiary/50 rounded border border-theme-border">
                    <div className="text-xs text-theme-text-muted">Ricevute Pag.</div>
                    <div className="text-lg font-bold text-theme-text-primary">{fmtEUR(totals.ricevute)}</div>
                </div>
                <div className="p-3 bg-dr7-gold/20 rounded border border-dr7-gold">
                    <div className="text-xs text-theme-text-muted">Netto dovuto</div>
                    <div className="text-lg font-bold text-dr7-gold">{fmtEUR(totals.netDovuto)}</div>
                </div>
            </div>

            {/* Cross-check summary */}
            {crosscheck.length > 0 && (
                <div className="p-3 bg-theme-bg-tertiary/30 rounded border border-theme-border">
                    <p className="text-sm text-theme-text-secondary font-semibold mb-2">Controllo incrociato fatture vs DDT</p>
                    <div className="space-y-1">
                        {crosscheck.map(row => {
                            const ok = row.stato_calcolato === 'verificato'
                            return (
                                <div key={row.fattura_id} className={`text-xs px-2 py-1.5 rounded flex flex-wrap items-center gap-2 ${ok ? 'bg-emerald-900/30' : 'bg-orange-900/30'}`}>
                                    <span className="font-mono">{row.fattura_numero}</span>
                                    <span className="text-theme-text-muted">del {fmtDateIT(row.fattura_data)}</span>
                                    <span className="ml-auto">Fatt: <strong>{fmtEUR(row.fattura_totale)}</strong></span>
                                    <span>DDT: <strong>{fmtEUR(row.ddt_totale)}</strong></span>
                                    <span className={Math.abs(row.differenza) < 0.01 ? 'text-emerald-300' : 'text-orange-300'}>
                                        Δ {fmtEUR(row.differenza)}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-xs ${ok ? 'bg-emerald-900 text-emerald-200' : 'bg-orange-900 text-orange-200'}`}>
                                        {ok ? 'OK' : 'Anomalia'}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Documents table */}
            <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                        <tr>
                            <th className="text-left px-3 py-2">Tipo</th>
                            <th className="text-left px-3 py-2">Numero</th>
                            <th className="text-left px-3 py-2">Data</th>
                            <th className="text-left px-3 py-2">Scadenza</th>
                            <th className="text-right px-3 py-2">Imponibile</th>
                            <th className="text-right px-3 py-2">IVA</th>
                            <th className="text-right px-3 py-2">Totale</th>
                            <th className="text-left px-3 py-2">Stato</th>
                            <th className="text-left px-3 py-2">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border">
                        {loading && (
                            <tr><td colSpan={9} className="text-center py-6 text-theme-text-muted">Caricamento…</td></tr>
                        )}
                        {!loading && docs.length === 0 && (
                            <tr><td colSpan={9} className="text-center py-6 text-theme-text-muted">
                                Nessun documento per {MESI_IT[mese - 1]} {anno}.
                            </td></tr>
                        )}
                        {docs.map(doc => {
                            const transitions = nextStates(doc.stato, doc.tipo)
                            return (
                                <tr key={doc.id}>
                                    <td className="px-3 py-2 text-theme-text-primary uppercase text-xs">{DOCUMENT_TIPO_LABELS[doc.tipo]}</td>
                                    <td className="px-3 py-2 text-theme-text-primary font-mono">{doc.numero_documento}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">{fmtDateIT(doc.data_documento)}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">{fmtDateIT(doc.data_scadenza)}</td>
                                    <td className="px-3 py-2 text-right text-theme-text-secondary">{fmtEUR(doc.importo_imponibile)}</td>
                                    <td className="px-3 py-2 text-right text-theme-text-secondary">{fmtEUR(doc.importo_iva)}</td>
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
                                            <button onClick={() => { setEditingDoc(doc); setShowUpload(true) }}
                                                className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                                                Modifica
                                            </button>
                                            {transitions.map(s => (
                                                <button key={s} onClick={() => transitionDoc(doc, s)}
                                                    className={`text-xs px-2 py-1 rounded ${DOCUMENT_STATO_COLORS[s]} hover:opacity-80`}
                                                    title={`Sposta in: ${DOCUMENT_STATO_LABELS[s]}`}>
                                                    → {DOCUMENT_STATO_LABELS[s]}
                                                </button>
                                            ))}
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
                    onClose={() => { setShowUpload(false); setEditingDoc(null) }}
                    onSaved={() => { setShowUpload(false); setEditingDoc(null); loadMonth() }}
                />
            )}
        </div>
    )
}
