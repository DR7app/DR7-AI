import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import {
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
    fmtEUR,
    fmtDateIT,
} from './types'
import type { FornitoreDocument, Fornitore } from './types'

interface Props {
    /** When provided, scopes the scadenziario to a single fornitore */
    fornitore?: Fornitore | null
}

interface ScadenziarioRow extends FornitoreDocument {
    fornitore?: { nome: string }
}

export default function FornitoreScadenziario({ fornitore }: Props) {
    const [rows, setRows] = useState<ScadenziarioRow[]>([])
    const [loading, setLoading] = useState(false)
    const [filterStato, setFilterStato] = useState<'tutte' | 'da_pagare' | 'pagate' | 'scadute'>('da_pagare')

    async function load() {
        setLoading(true)
        try {
            let query = supabase
                .from('fornitore_documents')
                .select('*, fornitore:fornitori(nome)')
                .eq('tipo', 'fattura')
                .not('data_scadenza', 'is', null)
                .order('data_scadenza', { ascending: true })

            if (fornitore) {
                query = query.eq('fornitore_id', fornitore.id)
            }

            const { data, error } = await query
            if (error) throw error
            setRows((data || []) as ScadenziarioRow[])
        } catch (err) {
            console.error('[scadenziario] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore?.id])

    const filtered = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10)
        return rows.filter(r => {
            if (filterStato === 'tutte') return true
            if (filterStato === 'pagate') return r.stato === 'pagato' || r.stato === 'archiviato'
            if (filterStato === 'da_pagare') return r.stato !== 'pagato' && r.stato !== 'archiviato' && r.stato !== 'bloccato'
            if (filterStato === 'scadute') {
                if (r.stato === 'pagato' || r.stato === 'archiviato') return false
                return r.data_scadenza && r.data_scadenza < today
            }
            return true
        })
    }, [rows, filterStato])

    const totals = useMemo(() => {
        return {
            count: filtered.length,
            totale: filtered.reduce((s, r) => s + Number(r.importo_totale || 0), 0),
        }
    }, [filtered])

    function urgenza(scad: string | null): { label: string; cls: string } {
        if (!scad) return { label: '', cls: '' }
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const s = new Date(scad)
        const days = Math.ceil((s.getTime() - today.getTime()) / 86400000)
        if (days < 0) return { label: `${-days}gg in ritardo`, cls: 'bg-red-900 text-red-200' }
        if (days === 0) return { label: 'Scade oggi', cls: 'bg-red-900 text-red-200' }
        if (days <= 3) return { label: `${days}gg`, cls: 'bg-orange-900 text-orange-200' }
        if (days <= 7) return { label: `${days}gg`, cls: 'bg-yellow-900 text-yellow-200' }
        return { label: `${days}gg`, cls: 'bg-theme-bg-tertiary text-theme-text-muted' }
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {([
                    { v: 'da_pagare', label: 'Da pagare' },
                    { v: 'scadute', label: 'Scadute' },
                    { v: 'pagate', label: 'Pagate' },
                    { v: 'tutte', label: 'Tutte' },
                ] as const).map(opt => (
                    <button key={opt.v} onClick={() => setFilterStato(opt.v)}
                        className={`text-sm px-3 py-1.5 rounded ${filterStato === opt.v
                            ? 'bg-dr7-gold text-black font-semibold'
                            : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-tertiary/70'}`}>
                        {opt.label}
                    </button>
                ))}
                <div className="ml-auto text-sm text-theme-text-secondary">
                    {totals.count} fatture · totale <strong className="text-theme-text-primary">{fmtEUR(totals.totale)}</strong>
                </div>
            </div>

            <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                        <tr>
                            {!fornitore && <th className="text-left px-3 py-2">Fornitore</th>}
                            <th className="text-left px-3 py-2">N. Fattura</th>
                            <th className="text-left px-3 py-2">Data</th>
                            <th className="text-left px-3 py-2">Scadenza</th>
                            <th className="text-left px-3 py-2">Urgenza</th>
                            <th className="text-right px-3 py-2">Totale</th>
                            <th className="text-left px-3 py-2">Stato</th>
                            <th className="text-left px-3 py-2">Pagamento</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border">
                        {loading && (
                            <tr><td colSpan={fornitore ? 7 : 8} className="text-center py-6 text-theme-text-muted">Caricamento…</td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={fornitore ? 7 : 8} className="text-center py-6 text-theme-text-muted">Nessuna scadenza</td></tr>
                        )}
                        {filtered.map(r => {
                            const u = urgenza(r.data_scadenza)
                            return (
                                <tr key={r.id}>
                                    {!fornitore && (
                                        <td className="px-3 py-2 text-theme-text-primary">{r.fornitore?.nome || '—'}</td>
                                    )}
                                    <td className="px-3 py-2 font-mono text-theme-text-primary">{r.numero_documento}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">{fmtDateIT(r.data_documento)}</td>
                                    <td className="px-3 py-2 text-theme-text-primary">{fmtDateIT(r.data_scadenza)}</td>
                                    <td className="px-3 py-2">
                                        {u.label && <span className={`text-xs px-2 py-0.5 rounded ${u.cls}`}>{u.label}</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right text-theme-text-primary font-semibold">{fmtEUR(r.importo_totale)}</td>
                                    <td className="px-3 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${DOCUMENT_STATO_COLORS[r.stato]}`}>
                                            {DOCUMENT_STATO_LABELS[r.stato]}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-theme-text-muted">
                                        {r.metodo_pagamento || '—'}
                                        {r.data_pagamento && <span className="ml-2">{fmtDateIT(r.data_pagamento)}</span>}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
