import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Button from './Button'
import FornitoreForm from './fornitori/FornitoreForm'
import FornitoreDetail from './fornitori/FornitoreDetail'
import FornitoreScadenziario from './fornitori/FornitoreScadenziario'
import FornitoreAlertsPanel from './fornitori/FornitoreAlertsPanel'
import FornitoriPageHeader from './fornitori/FornitoriPageHeader'
import FornitoriRightRail from './fornitori/FornitoriRightRail'
import FornitoriProcessFlow from './fornitori/FornitoriProcessFlow'
import type { Fornitore } from './fornitori/types'

type View = 'list' | 'scadenziario' | 'alerts'

interface FornitoreRow extends Fornitore {
    docCount?: number
    openAlerts?: number
    arubaInvoiceCount?: number
}

export default function FornitoriTab() {
    const [view, setView] = useState<View>('list')
    const [fornitori, setFornitori] = useState<FornitoreRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [showForm, setShowForm] = useState(false)
    const [selected, setSelected] = useState<Fornitore | null>(null)
    const [globalOpenAlerts, setGlobalOpenAlerts] = useState(0)
    const [showInactive, setShowInactive] = useState(false)
    const [importingFromAruba, setImportingFromAruba] = useState(false)
    const [arubaCountsLoading, setArubaCountsLoading] = useState(false)
    const [arubaMonthsScanned, setArubaMonthsScanned] = useState(3)

    async function loadArubaInvoiceCounts(months = 3) {
        setArubaCountsLoading(true)
        try {
            const res = await fetch(`/.netlify/functions/get-fornitore-invoice-counts?months=${months}`)
            const text = await res.text()
            let json: any
            try { json = JSON.parse(text) } catch {
                throw new Error(`HTTP ${res.status}`)
            }
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            const byPiva: Record<string, { count: number }> = json.byPiva || {}
            const byName: Record<string, { count: number }> = json.byName || {}
            setFornitori(prev => prev.map(f => {
                const v = (f.piva || '').replace(/\D/g, '')
                let count = 0
                if (v && byPiva[v]) count = byPiva[v].count
                else if (f.nome && byName[f.nome.toLowerCase().trim()]) count = byName[f.nome.toLowerCase().trim()].count
                return { ...f, arubaInvoiceCount: count }
            }))
            setArubaMonthsScanned(json.months_scanned || months)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn('[Fornitori] Aruba counts fetch failed:', msg)
        } finally {
            setArubaCountsLoading(false)
        }
    }

    async function importFromAruba() {
        const monthsStr = window.prompt('Quanti mesi indietro scansionare in Aruba? (1-12)', '3')
        if (!monthsStr) return
        const months = parseInt(monthsStr)
        if (isNaN(months) || months < 1 || months > 12) {
            toast.error('Inserisci un numero tra 1 e 12')
            return
        }
        if (!window.confirm(`Scansionare le fatture ricevute degli ultimi ${months} mesi e aggiungere i fornitori non ancora in anagrafica?`)) return
        setImportingFromAruba(true)
        try {
            const res = await fetch('/.netlify/functions/import-fornitori-from-aruba', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ months }),
            })
            const text = await res.text()
            let json: any
            try { json = JSON.parse(text) } catch {
                throw new Error(`HTTP ${res.status} (probabile timeout): ${text.slice(0, 200)}`)
            }
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            toast.success(`Aggiunti ${json.added} fornitori (${json.skipped} gia' presenti, ${json.scanned} totali)`)
            loadFornitori()
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`Import fallito: ${msg}`)
        } finally {
            setImportingFromAruba(false)
        }
    }

    async function loadFornitori() {
        setLoading(true)
        try {
            let q = supabase
                .from('fornitori')
                .select('*')
                .order('nome', { ascending: true })
            if (!showInactive) q = q.eq('attivo', true)
            const { data, error } = await q
            if (error) throw error
            const rows = (data || []) as FornitoreRow[]

            // Counts (single round-trip aggregate via two grouped queries)
            const [docCounts, alertCounts] = await Promise.all([
                supabase.from('fornitore_documents')
                    .select('fornitore_id', { count: 'exact', head: false })
                    .in('fornitore_id', rows.map(r => r.id))
                    .then(r => r.data || []),
                supabase.from('fornitore_alerts')
                    .select('fornitore_id')
                    .eq('status', 'open')
                    .in('fornitore_id', rows.map(r => r.id))
                    .then(r => r.data || []),
            ])

            const docByForn = new Map<string, number>()
            for (const d of docCounts as { fornitore_id: string }[]) {
                docByForn.set(d.fornitore_id, (docByForn.get(d.fornitore_id) || 0) + 1)
            }
            const alertByForn = new Map<string, number>()
            for (const a of alertCounts as { fornitore_id: string }[]) {
                alertByForn.set(a.fornitore_id, (alertByForn.get(a.fornitore_id) || 0) + 1)
            }
            for (const r of rows) {
                r.docCount = docByForn.get(r.id) || 0
                r.openAlerts = alertByForn.get(r.id) || 0
            }
            setFornitori(rows)
        } catch (err) {
            console.error('[fornitori] load error', err)
        } finally {
            setLoading(false)
        }
    }

    async function loadGlobalAlertCount() {
        const { count } = await supabase
            .from('fornitore_alerts')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'open')
        setGlobalOpenAlerts(count || 0)
    }

    useEffect(() => {
        loadFornitori()
        loadGlobalAlertCount()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showInactive])

    useEffect(() => {
        if (fornitori.length > 0) loadArubaInvoiceCounts(3)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitori.length])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return fornitori
        return fornitori.filter(f =>
            f.nome.toLowerCase().includes(q) ||
            (f.piva || '').toLowerCase().includes(q) ||
            (f.referente || '').toLowerCase().includes(q) ||
            (f.categoria_merce || '').toLowerCase().includes(q)
        )
    }, [fornitori, search])

    if (selected) {
        return (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
                <div className="min-w-0 space-y-4">
                    <FornitoreDetail
                        fornitore={selected}
                        onBack={() => { setSelected(null); loadFornitori() }}
                        onUpdated={(f) => { setSelected(f); loadFornitori() }}
                    />
                    <FornitoriProcessFlow />
                </div>
                <div className="hidden xl:block">
                    <FornitoriRightRail />
                </div>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="min-w-0 space-y-4">
            <FornitoriPageHeader />

            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-baseline gap-3 flex-wrap">
                    <h2 className="text-2xl font-semibold text-theme-text-primary">Gestione Fornitori</h2>
                    <span className="text-sm text-theme-text-muted">
                        {fornitori.length} {fornitori.length === 1 ? 'fornitore' : 'fornitori'}
                        {' · '}
                        {fornitori.reduce((s, f) => s + (f.arubaInvoiceCount || 0), 0)} fatture ricevute
                        <span className="opacity-70"> ({arubaMonthsScanned} mesi)</span>
                        {arubaCountsLoading && <span className="ml-2 italic">aggiorno conteggi...</span>}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setView('list')}
                        className={`text-sm px-3 py-1.5 rounded ${view === 'list' ? 'bg-dr7-gold text-black font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-tertiary/70'}`}>
                        Anagrafica
                    </button>
                    <button onClick={() => setView('scadenziario')}
                        className={`text-sm px-3 py-1.5 rounded ${view === 'scadenziario' ? 'bg-dr7-gold text-black font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-tertiary/70'}`}>
                        Scadenziario globale
                    </button>
                    <button onClick={() => setView('alerts')}
                        className={`text-sm px-3 py-1.5 rounded relative ${view === 'alerts' ? 'bg-dr7-gold text-black font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-tertiary/70'}`}>
                        Alert {globalOpenAlerts > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-900 text-red-200 text-xs">{globalOpenAlerts}</span>
                        )}
                    </button>
                </div>
            </div>

            {view === 'list' && (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[240px]">
                            <Input
                                placeholder="Cerca per nome, P.IVA, referente, categoria…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                            Mostra disattivati
                        </label>
                        <button
                            type="button"
                            onClick={importFromAruba}
                            disabled={importingFromAruba}
                            className="text-sm px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Scansiona le fatture ricevute via Aruba e aggiungi i fornitori mancanti"
                        >
                            {importingFromAruba ? 'Importo da Aruba...' : 'Importa da Aruba'}
                        </button>
                        <Button onClick={() => setShowForm(true)}>+ Nuovo fornitore</Button>
                    </div>

                    <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                                <tr>
                                    <th className="text-left px-3 py-2">Nome</th>
                                    <th className="text-left px-3 py-2">P.IVA</th>
                                    <th className="text-left px-3 py-2">Categoria</th>
                                    <th className="text-left px-3 py-2">Condizioni</th>
                                    <th className="text-left px-3 py-2">Referente</th>
                                    <th className="text-right px-3 py-2" title="Fatture ricevute via Aruba">Fatture Aruba</th>
                                    <th className="text-right px-3 py-2">Documenti</th>
                                    <th className="text-right px-3 py-2">Alert</th>
                                    <th className="text-left px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-theme-border">
                                {loading && (
                                    <tr><td colSpan={9} className="text-center py-6 text-theme-text-muted">Caricamento…</td></tr>
                                )}
                                {!loading && filtered.length === 0 && (
                                    <tr><td colSpan={9} className="text-center py-6 text-theme-text-muted">
                                        {search ? 'Nessun fornitore corrisponde alla ricerca' : 'Nessun fornitore. Crea il primo →'}
                                    </td></tr>
                                )}
                                {filtered.map(f => (
                                    <tr key={f.id} className="hover:bg-theme-bg-tertiary/30 cursor-pointer"
                                        onClick={() => setSelected(f)}>
                                        <td className="px-3 py-2 text-theme-text-primary font-semibold">
                                            {f.nome} {!f.attivo && <span className="ml-1 text-xs text-red-400">(disattivato)</span>}
                                        </td>
                                        <td className="px-3 py-2 font-mono text-theme-text-secondary">{f.piva || '—'}</td>
                                        <td className="px-3 py-2 text-theme-text-secondary">{f.categoria_merce || '—'}</td>
                                        <td className="px-3 py-2 text-theme-text-secondary">{f.condizioni_pagamento || '—'}</td>
                                        <td className="px-3 py-2 text-theme-text-secondary">{f.referente || '—'}</td>
                                        <td className="px-3 py-2 text-right">
                                            {(f.arubaInvoiceCount || 0) > 0 ? (
                                                <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 text-xs font-semibold">{f.arubaInvoiceCount}</span>
                                            ) : (
                                                <span className="text-theme-text-muted">0</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right text-theme-text-secondary">{f.docCount || 0}</td>
                                        <td className="px-3 py-2 text-right">
                                            {(f.openAlerts || 0) > 0
                                                ? <span className="inline-block px-2 py-0.5 rounded-full bg-red-900 text-red-200 text-xs">{f.openAlerts}</span>
                                                : <span className="text-theme-text-muted">—</span>}
                                        </td>
                                        <td className="px-3 py-2">
                                            <button onClick={(e) => { e.stopPropagation(); setSelected(f) }}
                                                className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-tertiary/70">
                                                Apri →
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {view === 'scadenziario' && <FornitoreScadenziario />}
            {view === 'alerts' && <FornitoreAlertsPanel />}

            {showForm && (
                <FornitoreForm
                    onClose={() => setShowForm(false)}
                    onSaved={() => { setShowForm(false); loadFornitori() }}
                />
            )}

            <FornitoriProcessFlow />
        </div>

        <div className="hidden xl:block">
            <FornitoriRightRail />
        </div>
        </div>
    )
}
