import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import {
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
    fmtEUR,
    fmtDateIT,
} from './types'
import type { Fornitore, FornitoreDocument, CrosscheckRow } from './types'
import { runCrosscheck, applyCrosscheckToFatture } from './FornitoreCrosscheck'
import FornitoreBollaUpload from './FornitoreBollaUpload'

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
    const [showBollaUpload, setShowBollaUpload] = useState(false)
    const [crossCheckRunning, setCrossCheckRunning] = useState(false)
    const [crossCheckMsg, setCrossCheckMsg] = useState<string | null>(null)

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

    // Manual: re-run cross-check for every month and APPLY the results to fatture
    // (updates stato + creates/keeps anomaly alerts). The auto-load above only
    // reads — this button is what actually writes the verifica back.
    async function handleRunCrosscheck() {
        setCrossCheckRunning(true)
        setCrossCheckMsg(null)
        let totalAnomalies = 0
        let monthsRun = 0
        try {
            // Refresh docs to apply against the latest set
            const { data } = await supabase
                .from('fornitore_documents')
                .select('*')
                .eq('fornitore_id', fornitore.id)
                .eq('periodo_anno', anno)
            const allDocs = (data || []) as FornitoreDocument[]
            const fatture = allDocs.filter(d => d.tipo === 'fattura')

            for (let m = 1; m <= 12; m++) {
                const cc = await runCrosscheck(fornitore.id, anno, m)
                if (cc.length === 0) continue
                await applyCrosscheckToFatture(cc, fatture)
                monthsRun++
                totalAnomalies += cc.filter(r => r.stato_calcolato === 'anomalia').length
            }
            setCrossCheckMsg(
                `Controllo completato — ${monthsRun} mesi analizzati, ${totalAnomalies} anomali${totalAnomalies === 1 ? 'a' : 'e'} rilevat${totalAnomalies === 1 ? 'a' : 'e'}.`
            )
            await load()
        } catch (err) {
            console.error('[panoramica] crosscheck error', err)
            const msg = err instanceof Error ? err.message : String(err)
            setCrossCheckMsg(`Errore: ${msg}`)
        } finally {
            setCrossCheckRunning(false)
        }
    }

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
            {/* Year selector + Actions */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-theme-text-muted">Anno</span>
                    <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                        {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    {loading && <span className="text-xs text-theme-text-muted">Caricamento…</span>}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowBollaUpload(true)}
                        className="px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                        Carica Bolla
                    </button>
                    <button
                        onClick={handleRunCrosscheck}
                        disabled={crossCheckRunning}
                        className="px-3 py-1.5 rounded-full text-sm font-semibold bg-dr7-gold hover:bg-[#247a6f] text-white disabled:opacity-60"
                    >
                        {crossCheckRunning ? 'Controllo in corso…' : 'Controllo Incrociato'}
                    </button>
                </div>
            </div>

            {crossCheckMsg && (
                <div className="text-xs text-theme-text-secondary bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2">
                    {crossCheckMsg}
                </div>
            )}

            {showBollaUpload && (
                <FornitoreBollaUpload
                    fornitore={fornitore}
                    onClose={() => setShowBollaUpload(false)}
                    onSaved={() => { setShowBollaUpload(false); load() }}
                />
            )}

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
                <div className="border-l-4 border-amber-600 bg-amber-50 dark:bg-amber-950/40 rounded px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-amber-700 dark:text-amber-300 text-lg">⚠</span>
                        <div className="flex-1">
                            <p className="text-amber-900 dark:text-amber-100 font-semibold">Attenzione: discrepanze rilevate</p>
                            <p className="text-sm text-amber-800 dark:text-amber-200">
                                Sono state trovate {discrepanze.length} fattur{discrepanze.length === 1 ? 'a' : 'e'} con
                                importi che non corrispondono alle bolle del medesimo mese. Verifica e risolvi prima del pagamento.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Two parallel tables: Bolle Recenti + Fatture Recenti */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RecentTable title={`Bolle recenti (${stats.countBolle})`} rows={bolleRecenti} kind="bolla" onChanged={load} />
                <RecentTable title={`Fatture recenti (${stats.countFatture})`} rows={fattureRecenti} kind="fattura" onChanged={load} />
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

function RecentTable({ title, rows, kind, onChanged }: {
    title: string
    rows: FornitoreDocument[]
    kind: 'bolla' | 'fattura'
    onChanged?: () => void
}) {
    async function deleteDoc(d: FornitoreDocument) {
        if (!confirm(`Eliminare ${kind === 'bolla' ? 'la bolla' : 'la fattura'} n. ${d.numero_documento}?\nQuesta azione non puo' essere annullata.`)) return
        if (d.file_url) {
            await supabase.storage.from('fornitori-documents').remove([d.file_url])
        }
        const { error } = await supabase.from('fornitore_documents').delete().eq('id', d.id)
        if (error) {
            alert('Errore: ' + error.message)
            return
        }
        onChanged?.()
    }

    const colspan = kind === 'fattura' ? 6 : 5
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
                        <th className="text-right px-3 py-2 text-xs">Azioni</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-theme-border">
                    {rows.length === 0 && (
                        <tr><td colSpan={colspan} className="text-center py-4 text-theme-text-muted text-xs">
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
                            <td className="px-3 py-2 text-right">
                                <button
                                    onClick={() => deleteDoc(r)}
                                    className="text-xs px-2 py-1 rounded bg-red-900 hover:bg-red-800 text-red-200"
                                    title={`Elimina ${kind === 'bolla' ? 'bolla' : 'fattura'}`}
                                >
                                    ×
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
