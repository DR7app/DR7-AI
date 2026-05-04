import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../supabaseClient'
import {
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
    MESI_IT,
    fmtEUR,
    fmtDateIT,
} from './types'
import type { Fornitore } from './types'

interface FatturaRow {
    id: string
    fornitore_id: string
    numero_documento: string
    data_documento: string
    data_scadenza: string | null
    importo_totale: number
    stato: string
    fornitore_nome: string
}

interface BolleAggregate {
    count: number
    totale: number
}

interface Props {
    onOpenFornitore: (fornitore: Fornitore) => void
}

/**
 * Vista cross-fornitore: tutte le fatture ricevute in un mese, raggruppate
 * per fornitore. Per ogni fattura mostra anche quante bolle/DDT abbiamo
 * caricato per quel fornitore in quello stesso mese, e la differenza
 * fattura - bolle. Click su una riga apre il dettaglio del fornitore.
 *
 * Use case: a fine mese vuoi sapere "ok, ho ricevuto 23 fatture per maggio,
 * di queste 8 non hanno bolle associate, devo recuperarle prima di pagarle".
 */
export default function FornitoriRegistroMensile({ onOpenFornitore }: Props) {
    const today = new Date()
    const [anno, setAnno] = useState(today.getFullYear())
    const [mese, setMese] = useState(today.getMonth() + 1)
    const [fatture, setFatture] = useState<FatturaRow[]>([])
    // Map: `${fornitore_id}|${anno}|${mese}` → { count, totale }
    const [bolleByFornitoreMese, setBolleByFornitoreMese] = useState<Map<string, BolleAggregate>>(new Map())
    const [loading, setLoading] = useState(false)
    const [statoFilter, setStatoFilter] = useState<'tutte' | 'senza_bolle' | 'da_pagare' | 'pagate'>('tutte')

    async function load() {
        setLoading(true)
        try {
            // Fetch fatture for the selected month with fornitore name joined
            const { data: rawFatture, error } = await supabase
                .from('fornitore_documents')
                .select('id, fornitore_id, numero_documento, data_documento, data_scadenza, importo_totale, stato, fornitori:fornitori(nome)')
                .eq('tipo', 'fattura')
                .eq('periodo_anno', anno)
                .eq('periodo_mese', mese)
                .order('data_documento', { ascending: false })
            if (error) throw error
            const rows: FatturaRow[] = ((rawFatture || []) as unknown as Array<{
                id: string
                fornitore_id: string
                numero_documento: string
                data_documento: string
                data_scadenza: string | null
                importo_totale: number
                stato: string
                fornitori?: { nome: string } | null
            }>).map(r => ({
                id: r.id,
                fornitore_id: r.fornitore_id,
                numero_documento: r.numero_documento,
                data_documento: r.data_documento,
                data_scadenza: r.data_scadenza,
                importo_totale: Number(r.importo_totale || 0),
                stato: r.stato,
                fornitore_nome: r.fornitori?.nome || '— senza nome',
            }))
            setFatture(rows)

            // Fetch bolle/DDT for the same month, grouped by fornitore_id
            const fornitoreIds = Array.from(new Set(rows.map(r => r.fornitore_id)))
            if (fornitoreIds.length > 0) {
                const { data: bolle } = await supabase
                    .from('fornitore_documents')
                    .select('fornitore_id, importo_totale')
                    .in('fornitore_id', fornitoreIds)
                    .in('tipo', ['ddt', 'bolla'])
                    .eq('periodo_anno', anno)
                    .eq('periodo_mese', mese)
                const m = new Map<string, BolleAggregate>()
                for (const b of (bolle || []) as { fornitore_id: string; importo_totale: number }[]) {
                    const k = `${b.fornitore_id}|${anno}|${mese}`
                    const cur = m.get(k) || { count: 0, totale: 0 }
                    cur.count++
                    cur.totale += Number(b.importo_totale || 0)
                    m.set(k, cur)
                }
                setBolleByFornitoreMese(m)
            } else {
                setBolleByFornitoreMese(new Map())
            }
        } catch (err) {
            console.error('[registro-mensile] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anno, mese])

    function getBolleAgg(fornitoreId: string): BolleAggregate {
        return bolleByFornitoreMese.get(`${fornitoreId}|${anno}|${mese}`) || { count: 0, totale: 0 }
    }

    const filtered = useMemo(() => {
        return fatture.filter(f => {
            if (statoFilter === 'tutte') return true
            if (statoFilter === 'senza_bolle') {
                const agg = getBolleAgg(f.fornitore_id)
                return agg.count === 0
            }
            if (statoFilter === 'da_pagare') {
                return f.stato !== 'pagato' && f.stato !== 'archiviato' && f.stato !== 'bloccato'
            }
            if (statoFilter === 'pagate') {
                return f.stato === 'pagato' || f.stato === 'archiviato'
            }
            return true
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fatture, statoFilter, bolleByFornitoreMese, anno, mese])

    const totals = useMemo(() => {
        let totFatture = 0
        let totBolle = 0
        let nSenzaBolle = 0
        let nDaPagare = 0
        let nPagate = 0
        for (const f of filtered) {
            totFatture += f.importo_totale
            const agg = getBolleAgg(f.fornitore_id)
            totBolle += agg.totale / Math.max(1, filtered.filter(x => x.fornitore_id === f.fornitore_id).length)
            if (agg.count === 0) nSenzaBolle++
            if (f.stato === 'pagato' || f.stato === 'archiviato') nPagate++
            else if (f.stato !== 'bloccato') nDaPagare++
        }
        return { totFatture, totBolle, nSenzaBolle, nDaPagare, nPagate, count: filtered.length }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtered, bolleByFornitoreMese])

    const annoOptions: number[] = []
    for (let y = today.getFullYear(); y >= 2026; y--) annoOptions.push(y)

    async function openFornitore(id: string, nome: string) {
        // Fetch full fornitore record so detail view has all anagrafica info
        const { data } = await supabase.from('fornitori').select('*').eq('id', id).single()
        onOpenFornitore((data || { id, nome }) as Fornitore)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-semibold text-theme-text-primary">Registro mensile fatture</h2>
                    <p className="text-xs text-theme-text-muted">
                        Tutte le fatture ricevute nel mese, di tutti i fornitori — per pianificare bolle e pagamenti.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select value={mese} onChange={e => setMese(parseInt(e.target.value))}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                        {MESI_IT.map((label, idx) => (
                            <option key={idx} value={idx + 1}>{label}</option>
                        ))}
                    </select>
                    <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                        {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            {/* Stats badges */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <StatBox label="Fatture" value={String(totals.count)} sub="totale mese" />
                <StatBox label="Importo" value={fmtEUR(totals.totFatture)} sub="totale fatture" />
                <StatBox label="Senza bolle" value={String(totals.nSenzaBolle)} sub="da recuperare" tone={totals.nSenzaBolle > 0 ? 'warning' : 'ok'} />
                <StatBox label="Da pagare" value={String(totals.nDaPagare)} sub="non saldate" />
                <StatBox label="Pagate" value={String(totals.nPagate)} sub="saldate" tone="ok" />
            </div>

            {/* Filter buttons */}
            <div className="flex flex-wrap gap-2">
                {([
                    { v: 'tutte', label: `Tutte (${fatture.length})` },
                    { v: 'senza_bolle', label: `Senza bolle (${fatture.filter(f => getBolleAgg(f.fornitore_id).count === 0).length})` },
                    { v: 'da_pagare', label: 'Da pagare' },
                    { v: 'pagate', label: 'Pagate' },
                ] as const).map(opt => (
                    <button key={opt.v} onClick={() => setStatoFilter(opt.v)}
                        className={`text-xs px-3 py-1.5 rounded ${statoFilter === opt.v
                            ? 'bg-dr7-gold text-black font-semibold'
                            : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-tertiary/70'}`}>
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                        <tr>
                            <th className="text-left px-3 py-2">Fornitore</th>
                            <th className="text-left px-3 py-2">N° Fattura</th>
                            <th className="text-left px-3 py-2">Data</th>
                            <th className="text-left px-3 py-2">Scadenza</th>
                            <th className="text-right px-3 py-2">Importo</th>
                            <th className="text-center px-3 py-2">Bolle</th>
                            <th className="text-right px-3 py-2">Δ Fatt-Bolle</th>
                            <th className="text-left px-3 py-2">Stato</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border">
                        {loading && (
                            <tr><td colSpan={8} className="text-center py-6 text-theme-text-muted">Caricamento…</td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={8} className="text-center py-6 text-theme-text-muted">
                                Nessuna fattura per {MESI_IT[mese - 1]} {anno}.
                            </td></tr>
                        )}
                        {filtered.map(f => {
                            const agg = getBolleAgg(f.fornitore_id)
                            const diff = f.importo_totale - agg.totale
                            const noBolle = agg.count === 0
                            return (
                                <tr key={f.id}
                                    className="hover:bg-theme-bg-tertiary/40 cursor-pointer"
                                    onClick={() => openFornitore(f.fornitore_id, f.fornitore_nome)}>
                                    <td className="px-3 py-2 text-theme-text-primary font-semibold">{f.fornitore_nome}</td>
                                    <td className="px-3 py-2 text-theme-text-primary font-mono text-xs">{f.numero_documento}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary text-xs">{fmtDateIT(f.data_documento)}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary text-xs">{fmtDateIT(f.data_scadenza)}</td>
                                    <td className="px-3 py-2 text-right text-theme-text-primary font-semibold">{fmtEUR(f.importo_totale)}</td>
                                    <td className="px-3 py-2 text-center">
                                        {noBolle ? (
                                            <span className="px-2 py-0.5 rounded text-xs bg-orange-900/30 text-orange-300 border border-orange-800/40">
                                                0 — mancano
                                            </span>
                                        ) : (
                                            <span className="text-xs text-theme-text-secondary">
                                                {agg.count} ({fmtEUR(agg.totale)})
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs">
                                        {noBolle ? (
                                            <span className="text-theme-text-muted">—</span>
                                        ) : Math.abs(diff) < 0.01 ? (
                                            <span className="text-emerald-400">€0,00 ✓</span>
                                        ) : (
                                            <span className="text-orange-400 font-semibold">{fmtEUR(diff)}</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${DOCUMENT_STATO_COLORS[f.stato as keyof typeof DOCUMENT_STATO_COLORS]}`}>
                                            {DOCUMENT_STATO_LABELS[f.stato as keyof typeof DOCUMENT_STATO_LABELS]}
                                        </span>
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

function StatBox({ label, value, sub, tone }: {
    label: string
    value: string
    sub?: string
    tone?: 'ok' | 'warning'
}) {
    const toneCls = tone === 'warning' ? 'border-orange-700/50' : tone === 'ok' ? 'border-emerald-700/50' : 'border-theme-border'
    const valCls = tone === 'warning' ? 'text-orange-300' : tone === 'ok' ? 'text-emerald-300' : 'text-theme-text-primary'
    return (
        <div className={`p-3 bg-theme-bg-secondary rounded border ${toneCls}`}>
            <div className="text-xs text-theme-text-muted uppercase tracking-wide">{label}</div>
            <div className={`text-lg font-bold ${valCls}`}>{value}</div>
            {sub && <div className="text-xs text-theme-text-muted">{sub}</div>}
        </div>
    )
}
