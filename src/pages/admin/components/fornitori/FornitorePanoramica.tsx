import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import {
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
    fmtEUR,
    fmtDateIT,
} from './types'
import type { Fornitore, FornitoreDocument, CrosscheckRow } from './types'
import { runCrosscheck } from './FornitoreCrosscheck'

interface Props {
    fornitore: Fornitore
}

interface Discrepanza extends CrosscheckRow {
    mese: number
}

export default function FornitorePanoramica({ fornitore }: Props) {
    const today = new Date()
    const [anno, setAnno] = useState(today.getFullYear())
    const [docs, setDocs] = useState<FornitoreDocument[]>([])
    const [discrepanze, setDiscrepanze] = useState<Discrepanza[]>([])
    const [loading, setLoading] = useState(false)

    async function load() {
        setLoading(true)
        try {
            const { data } = await supabase
                .from('fornitore_documents')
                .select('*')
                .eq('fornitore_id', fornitore.id)
                .eq('periodo_anno', anno)
                .order('data_documento', { ascending: false })
            const rows = (data || []) as FornitoreDocument[]
            setDocs(rows)

            // Run cross-check for all 12 months and collect anomalies
            const allDisc: Discrepanza[] = []
            for (let m = 1; m <= 12; m++) {
                const cc = await runCrosscheck(fornitore.id, anno, m)
                for (const row of cc) {
                    if (row.stato_calcolato === 'anomalia') {
                        allDisc.push({ ...row, mese: m })
                    }
                }
            }
            setDiscrepanze(allDisc)
        } catch (err) {
            console.error('[panoramica] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore.id, anno])

    const stats = useMemo(() => {
        const bolle = docs.filter(d => d.tipo === 'ddt' || d.tipo === 'bolla')
        const fatture = docs.filter(d => d.tipo === 'fattura')
        const noteCredito = docs.filter(d => d.tipo === 'nota_credito')
        const aperte = fatture.filter(f => f.stato !== 'pagato' && f.stato !== 'archiviato' && f.stato !== 'bloccato')
        const sum = (xs: FornitoreDocument[]) => xs.reduce((s, x) => s + Number(x.importo_totale || 0), 0)
        const totBolle = sum(bolle)
        const totFatture = sum(fatture)
        const totNoteCredito = sum(noteCredito)
        const ultimaFattura = fatture[0]
        return {
            totBolle,
            totFatture,
            totNoteCredito,
            differenza: totFatture - totBolle - totNoteCredito,
            countBolle: bolle.length,
            countFatture: fatture.length,
            scadenzeAperteCount: aperte.length,
            scadenzeAperteTot: sum(aperte),
            ultimaFatturaData: ultimaFattura?.data_documento || null,
            ultimaFatturaImporto: ultimaFattura?.importo_totale || null,
        }
    }, [docs])

    const bolleRecenti = useMemo(
        () => docs.filter(d => d.tipo === 'ddt' || d.tipo === 'bolla').slice(0, 6),
        [docs]
    )
    const fattureRecenti = useMemo(
        () => docs.filter(d => d.tipo === 'fattura').slice(0, 6),
        [docs]
    )

    const annoOptions: number[] = []
    for (let y = today.getFullYear() + 1; y >= 2020; y--) annoOptions.push(y)

    const hasDiscrepanze = discrepanze.length > 0

    return (
        <div className="space-y-4">
            {/* Year selector */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-theme-text-muted">Anno</span>
                    <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                        {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
                {loading && <span className="text-xs text-theme-text-muted">Caricamento…</span>}
            </div>

            {/* 5 stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard
                    label="Totale Bolle"
                    value={fmtEUR(stats.totBolle)}
                    sub={`${stats.countBolle} documenti`}
                    color="emerald"
                />
                <StatCard
                    label="Totale Fatture"
                    value={fmtEUR(stats.totFatture)}
                    sub={`${stats.countFatture} fatture`}
                    color="blue"
                />
                <StatCard
                    label="Differenza"
                    value={fmtEUR(stats.differenza)}
                    sub={Math.abs(stats.differenza) < 0.01 ? 'Quadrato' : 'Da verificare'}
                    color={Math.abs(stats.differenza) < 0.01 ? 'emerald' : 'orange'}
                />
                <StatCard
                    label="Scadenze Aperte"
                    value={fmtEUR(stats.scadenzeAperteTot)}
                    sub={`${stats.scadenzeAperteCount} fatture`}
                    color="yellow"
                />
                <StatCard
                    label="Ultima Fattura"
                    value={stats.ultimaFatturaData ? fmtDateIT(stats.ultimaFatturaData) : '—'}
                    sub={stats.ultimaFatturaImporto !== null ? fmtEUR(stats.ultimaFatturaImporto) : ''}
                    color="purple"
                />
            </div>

            {/* Discrepancy alert */}
            {hasDiscrepanze && (
                <div className="border-l-4 border-orange-500 bg-orange-900/20 rounded px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-orange-300 text-lg">⚠</span>
                        <div className="flex-1">
                            <p className="text-orange-200 font-semibold">Attenzione: discrepanze rilevate</p>
                            <p className="text-xs text-orange-300/80">
                                Sono state trovate {discrepanze.length} fattur{discrepanze.length === 1 ? 'a' : 'e'} con
                                importi che non corrispondono alle bolle del medesimo mese. Verifica e risolvi prima del pagamento.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Two parallel tables: Bolle Recenti + Fatture Recenti */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RecentTable title={`Bolle recenti (${stats.countBolle})`} rows={bolleRecenti} kind="bolla" />
                <RecentTable title={`Fatture recenti (${stats.countFatture})`} rows={fattureRecenti} kind="fattura" />
            </div>

            {/* Discrepancy details */}
            {hasDiscrepanze && (
                <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                    <div className="px-4 py-3 border-b border-theme-border">
                        <p className="text-sm font-semibold text-theme-text-primary">Dettagli discrepanze {anno}</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                            <tr>
                                <th className="text-left px-3 py-2">Fattura</th>
                                <th className="text-left px-3 py-2">Data</th>
                                <th className="text-left px-3 py-2">Mese</th>
                                <th className="text-right px-3 py-2">Importo Fattura</th>
                                <th className="text-right px-3 py-2">Bolle Totale</th>
                                <th className="text-right px-3 py-2">Differenza</th>
                                <th className="text-left px-3 py-2">Stato</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {discrepanze.map(d => (
                                <tr key={d.fattura_id}>
                                    <td className="px-3 py-2 font-mono text-theme-text-primary">{d.fattura_numero}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">{fmtDateIT(d.fattura_data)}</td>
                                    <td className="px-3 py-2 text-theme-text-secondary">
                                        {['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][d.mese - 1]}
                                    </td>
                                    <td className="px-3 py-2 text-right text-theme-text-primary font-semibold">{fmtEUR(d.fattura_totale)}</td>
                                    <td className="px-3 py-2 text-right text-theme-text-primary">{fmtEUR(d.ddt_totale)}</td>
                                    <td className="px-3 py-2 text-right text-orange-300 font-semibold">{fmtEUR(d.differenza)}</td>
                                    <td className="px-3 py-2">
                                        <span className="px-2 py-0.5 rounded text-xs bg-orange-900 text-orange-200">
                                            {d.ddt_totale === 0 ? 'Bolle mancanti' : 'Importi non quadrano'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

function StatCard({ label, value, sub, color }: {
    label: string
    value: string
    sub?: string
    color: 'emerald' | 'blue' | 'orange' | 'yellow' | 'purple'
}) {
    const colorMap = {
        emerald: { border: 'border-emerald-700/50', text: 'text-emerald-300' },
        blue:    { border: 'border-blue-700/50',    text: 'text-blue-300' },
        orange:  { border: 'border-orange-700/50',  text: 'text-orange-300' },
        yellow:  { border: 'border-yellow-700/50',  text: 'text-yellow-300' },
        purple:  { border: 'border-purple-700/50',  text: 'text-purple-300' },
    }
    const c = colorMap[color]
    return (
        <div className={`p-4 bg-theme-bg-secondary rounded border ${c.border}`}>
            <div className="text-xs text-theme-text-muted uppercase tracking-wide mb-1">{label}</div>
            <div className={`text-xl font-bold ${c.text}`}>{value}</div>
            {sub && <div className="text-xs text-theme-text-muted mt-1">{sub}</div>}
        </div>
    )
}

function RecentTable({ title, rows, kind }: {
    title: string
    rows: FornitoreDocument[]
    kind: 'bolla' | 'fattura'
}) {
    return (
        <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-hidden">
            <div className="px-4 py-3 border-b border-theme-border">
                <p className="text-sm font-semibold text-theme-text-primary">{title}</p>
            </div>
            <table className="w-full text-sm">
                <thead className="bg-theme-bg-tertiary/50 text-theme-text-secondary">
                    <tr>
                        <th className="text-left px-3 py-2 text-xs">N°</th>
                        <th className="text-left px-3 py-2 text-xs">Data</th>
                        <th className="text-right px-3 py-2 text-xs">Importo</th>
                        {kind === 'fattura' && <th className="text-left px-3 py-2 text-xs">Scadenza</th>}
                        <th className="text-left px-3 py-2 text-xs">Stato</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-theme-border">
                    {rows.length === 0 && (
                        <tr><td colSpan={kind === 'fattura' ? 5 : 4} className="text-center py-4 text-theme-text-muted text-xs">
                            Nessun documento
                        </td></tr>
                    )}
                    {rows.map(r => (
                        <tr key={r.id}>
                            <td className="px-3 py-2 font-mono text-theme-text-primary text-xs">{r.numero_documento}</td>
                            <td className="px-3 py-2 text-theme-text-secondary text-xs">{fmtDateIT(r.data_documento)}</td>
                            <td className="px-3 py-2 text-right text-theme-text-primary text-xs font-semibold">{fmtEUR(r.importo_totale)}</td>
                            {kind === 'fattura' && (
                                <td className="px-3 py-2 text-theme-text-secondary text-xs">{fmtDateIT(r.data_scadenza)}</td>
                            )}
                            <td className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded text-xs ${DOCUMENT_STATO_COLORS[r.stato]}`}>
                                    {DOCUMENT_STATO_LABELS[r.stato]}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
