import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import FornitoreSimpleView from './fornitori/FornitoreSimpleView'
import FornitoriRegistroMensile from './fornitori/FornitoriRegistroMensile'
import FornitoreForm from './fornitori/FornitoreForm'
import type { Fornitore } from './fornitori/types'

type View = 'lista' | 'registro'

interface FornitoreRow extends Fornitore {
    bolleCount: number
    fattureCount: number
    daApprovareCount: number
    daPagareCount: number
    lastDocAt: string | null
}

/**
 * Lista fornitori — semplice. Ricerca + import automatico da Aruba.
 * Click su un fornitore apre il flusso a 4 step (FornitoreSimpleView).
 *
 * Niente più tab, info-card di marketing o pannello laterale: il flusso è
 * direttamente nelle azioni che l'utente esegue (carica bolla, controlla,
 * approva, paga).
 */
const LAST_SYNC_KEY = 'dr7_fornitori_last_aruba_sync'
const AUTO_SYNC_THROTTLE_MS = 30 * 60 * 1000  // 30 min — no point re-scanning Aruba more often

export default function FornitoriTab() {
    const [fornitori, setFornitori] = useState<FornitoreRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string>('')
    const [categoryOptions, setCategoryOptions] = useState<{ slug: string; label: string }[]>([])
    const [selected, setSelected] = useState<Fornitore | null>(null)
    // Default 'lista' — l'utente apre Fornitori tipicamente per cercare/aggiungere
    // un fornitore prima ancora che per pianificare il pagamento mensile.
    const [view, setView] = useState<View>('lista')
    const [importing, setImporting] = useState(false)
    const [creating, setCreating] = useState(false)
    const [lastSync, setLastSync] = useState<number | null>(() => {
        const v = localStorage.getItem(LAST_SYNC_KEY)
        return v ? parseInt(v) : null
    })

    async function load() {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('fornitori')
                .select('*')
                .eq('attivo', true)
                .order('nome', { ascending: true })
            if (error) throw error
            const rows = (data || []) as Fornitore[]

            const ids = rows.map(r => r.id)
            const counts: Record<string, FornitoreRow> = {}
            for (const r of rows) {
                counts[r.id] = { ...r, bolleCount: 0, fattureCount: 0, daApprovareCount: 0, daPagareCount: 0, lastDocAt: null }
            }
            if (ids.length > 0) {
                // Conto solo i documenti dal 2026 in avanti — i clienti DR7
                // partono 01/26. La sync da Aruba scansiona 12 mesi indietro
                // quindi puo' trascinarsi roba di fine 2025 che non vogliamo
                // contare ne' mostrare nella tab fornitori.
                const { data: docs } = await supabase
                    .from('fornitore_documents')
                    .select('fornitore_id, tipo, stato, data_documento')
                    .in('fornitore_id', ids)
                    .gte('periodo_anno', 2026)
                for (const d of (docs || []) as { fornitore_id: string; tipo: string; stato: string; data_documento: string | null }[]) {
                    const row = counts[d.fornitore_id]
                    if (!row) continue
                    if (d.tipo === 'ddt' || d.tipo === 'bolla') row.bolleCount++
                    else if (d.tipo === 'fattura') {
                        row.fattureCount++
                        if (d.stato === 'verificato') row.daApprovareCount++
                        else if (d.stato === 'approvato' || d.stato === 'pagabile') row.daPagareCount++
                    }
                    if (d.data_documento && (!row.lastDocAt || d.data_documento > row.lastDocAt)) {
                        row.lastDocAt = d.data_documento
                    }
                }
            }
            setFornitori(Object.values(counts))
        } catch (err) {
            console.error('[fornitori] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // Auto-sync da Aruba al mount, throttled a 30 min per non rifare lo
        // scan a ogni navigazione. La prima volta gira sempre.
        const lastIso = localStorage.getItem(LAST_SYNC_KEY)
        const lastMs = lastIso ? parseInt(lastIso) : 0
        if (Date.now() - lastMs > AUTO_SYNC_THROTTLE_MS) {
            // Fire-and-forget; UI shows un piccolo spinner durante l'import
            importFromAruba({ silent: true }).catch(() => { /* swallow */ })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Carica le categorie dal master (stessa sorgente di FornitoreForm) per
    // popolare il filtro. Tiene solo le attive ma include anche eventuali slug
    // legacy presenti nei fornitori correnti, così non si perde nessuna riga.
    useEffect(() => {
        ;(async () => {
            const { data } = await supabase
                .from('fornitore_categorie')
                .select('slug, label, attiva')
                .order('sort_order', { ascending: true })
            const opts: { slug: string; label: string }[] = []
            const seen = new Set<string>()
            for (const c of (data || []) as { slug: string; label: string; attiva: boolean }[]) {
                if (!c.attiva) continue
                opts.push({ slug: c.slug, label: c.label })
                seen.add(c.slug)
            }
            // Include slug legacy presenti nei fornitori ma non nel master
            for (const f of fornitori) {
                if (f.categoria_merce && !seen.has(f.categoria_merce)) {
                    opts.push({ slug: f.categoria_merce, label: `${f.categoria_merce} (legacy)` })
                    seen.add(f.categoria_merce)
                }
            }
            setCategoryOptions(opts)
        })()
    }, [fornitori])

    type SortKey = 'nome' | 'fatture' | 'bolle' | 'pendenti' | 'recente'
    const [sortKey, setSortKey] = useState<SortKey>('nome')

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        let base = q
            ? fornitori.filter(f =>
                f.nome.toLowerCase().includes(q) ||
                (f.piva || '').toLowerCase().includes(q) ||
                (f.categoria_merce || '').toLowerCase().includes(q)
            )
            : fornitori
        if (categoryFilter === '__none__') {
            base = base.filter(f => !f.categoria_merce)
        } else if (categoryFilter) {
            base = base.filter(f => f.categoria_merce === categoryFilter)
        }

        const sorted = [...base]
        switch (sortKey) {
            case 'nome':
                sorted.sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }))
                break
            case 'fatture':
                sorted.sort((a, b) => b.fattureCount - a.fattureCount || a.nome.localeCompare(b.nome))
                break
            case 'bolle':
                sorted.sort((a, b) => b.bolleCount - a.bolleCount || a.nome.localeCompare(b.nome))
                break
            case 'pendenti':
                sorted.sort((a, b) =>
                    (b.daApprovareCount + b.daPagareCount) - (a.daApprovareCount + a.daPagareCount)
                    || a.nome.localeCompare(b.nome)
                )
                break
            case 'recente':
                // Ordinamento per data dell'ultimo documento (fattura/bolla) reale.
                // I fornitori senza documenti vanno in fondo.
                sorted.sort((a, b) => {
                    if (!a.lastDocAt && !b.lastDocAt) return a.nome.localeCompare(b.nome)
                    if (!a.lastDocAt) return 1
                    if (!b.lastDocAt) return -1
                    return b.lastDocAt.localeCompare(a.lastDocAt)
                })
                break
        }
        return sorted
    }, [fornitori, search, categoryFilter, sortKey])

    async function importFromAruba(opts: { silent?: boolean } = {}) {
        setImporting(true)
        try {
            const res = await fetch('/.netlify/functions/import-fornitori-from-aruba', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ months: 3 }),
            })
            const text = await res.text()
            let json: { success?: boolean; added?: number; skipped?: number; scanned?: number; error?: string } = {}
            try { json = JSON.parse(text) } catch { /* ignore */ }
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            const ts = Date.now()
            localStorage.setItem(LAST_SYNC_KEY, String(ts))
            setLastSync(ts)
            if (!opts.silent) {
                toast.success(`Sincronizzato: ${json.added ?? 0} nuovi fornitori · ${json.skipped ?? 0} già presenti`)
            } else if ((json.added ?? 0) > 0) {
                toast.success(`${json.added} nuovi fornitori importati da Aruba`)
            }
            load()
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (!opts.silent) toast.error('Sincronizzazione fallita: ' + msg)
            else console.warn('[fornitori] auto-sync failed:', msg)
        } finally {
            setImporting(false)
        }
    }

    function fmtRelative(ms: number | null): string {
        if (!ms) return 'mai'
        const diff = Math.floor((Date.now() - ms) / 1000)
        if (diff < 60) return 'pochi secondi fa'
        if (diff < 3600) return `${Math.floor(diff / 60)} min fa`
        if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`
        return `${Math.floor(diff / 86400)}gg fa`
    }

    if (selected) {
        return (
            <FornitoreSimpleView
                fornitore={selected}
                onBack={() => { setSelected(null); load() }}
            />
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-semibold text-theme-text-primary">Fornitori</h2>
                    <p className="text-xs text-theme-text-muted">
                        {importing
                            ? 'Sincronizzazione automatica da Aruba in corso…'
                            : `Sincronizzato automaticamente da Aruba ${fmtRelative(lastSync)}`}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => setCreating(true)}
                        className="text-sm px-3 py-1.5 rounded bg-dr7-gold hover:opacity-90 text-white font-semibold"
                        title="Aggiungi un fornitore manualmente"
                    >
                        + Aggiungi fornitore
                    </button>
                    <button
                        onClick={async () => {
                            if (importing) return
                            setImporting(true)
                            try {
                                // Background function: 15-min timeout, risponde
                                // 202 Accepted subito; il lavoro continua dietro.
                                const res = await fetch('/.netlify/functions/fornitori-fatture-sync-background', { method: 'POST' })
                                if (res.status !== 202 && !res.ok) {
                                    const txt = await res.text().catch(() => '')
                                    throw new Error(`HTTP ${res.status}${txt ? ' — ' + txt.slice(0, 120) : ''}`)
                                }
                                alert(
                                    'Sincronizzazione avviata in background.\n\n' +
                                    'Aruba ha molti fornitori e fatture: il lavoro impiega 1-3 minuti.\n' +
                                    'Tra qualche minuto ricarica la pagina per vedere i nuovi documenti.'
                                )
                                setLastSync(Date.now())
                                // Auto-refresh dopo 90s per pescare le nuove fatture
                                setTimeout(() => load(), 90_000)
                            } catch (err) {
                                const msg = err instanceof Error ? err.message : String(err)
                                alert('Avvio sync fallito: ' + msg)
                            } finally {
                                setImporting(false)
                            }
                        }}
                        disabled={importing}
                        className="text-sm px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                        title="Scarica le fatture Aruba degli ultimi 12 mesi e crea automaticamente i fornitori sconosciuti"
                    >
                        {importing ? 'Sincronizzo…' : 'Scopri & Sincronizza tutto'}
                    </button>
                    <div className="flex gap-1 bg-theme-bg-tertiary rounded p-1">
                        <button onClick={() => setView('lista')}
                            className={`text-sm px-3 py-1.5 rounded ${view === 'lista' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                            Lista fornitori
                        </button>
                        <button onClick={() => setView('registro')}
                            className={`text-sm px-3 py-1.5 rounded ${view === 'registro' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                            Registro mensile
                        </button>
                    </div>
                </div>
            </div>

            {view === 'registro' && (
                <FornitoriRegistroMensile onOpenFornitore={setSelected} />
            )}

            {view === 'lista' && (<>

            <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[240px]">
                    <Input
                        placeholder="Cerca per nome, P.IVA o categoria…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
                    title="Filtra per categoria"
                >
                    <option value="">Tutte le categorie</option>
                    {categoryOptions.map(c => (
                        <option key={c.slug} value={c.slug}>{c.label}</option>
                    ))}
                    <option value="__none__">— Senza categoria —</option>
                </select>
                <select
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as SortKey)}
                    className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
                    title="Ordina per"
                >
                    <option value="nome">Ordina: A → Z</option>
                    <option value="fatture">Ordina: più fatture</option>
                    <option value="bolle">Ordina: più bolle</option>
                    <option value="pendenti">Ordina: da gestire</option>
                    <option value="recente">Ordina: più recente</option>
                </select>
            </div>

            <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-hidden">
                {loading && (
                    <div className="px-4 py-6 text-center text-theme-text-muted text-sm">Caricamento…</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="px-4 py-6 text-center text-theme-text-muted text-sm">
                        {search || categoryFilter
                            ? 'Nessun fornitore corrisponde a ricerca/filtro'
                            : 'Nessun fornitore. Clicca "Sincronizza da Aruba" per importarli automaticamente.'}
                    </div>
                )}
                {!loading && filtered.length > 0 && (
                    <ul className="divide-y divide-theme-border">
                        {filtered.map(f => {
                            const todoCount = f.daApprovareCount + f.daPagareCount
                            return (
                                <li key={f.id}>
                                    <button
                                        onClick={() => setSelected(f)}
                                        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-theme-bg-tertiary/30 transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-theme-text-primary font-semibold truncate">{f.nome}</p>
                                            <p className="text-xs text-theme-text-muted truncate">
                                                {f.piva ? `P.IVA ${f.piva}` : '— P.IVA non impostata'}
                                                {f.categoria_merce && <span className="ml-2">{f.categoria_merce}</span>}
                                            </p>
                                        </div>
                                        <div className="text-xs text-theme-text-secondary text-right space-y-0.5 hidden sm:block">
                                            <div>{f.bolleCount} bolle · {f.fattureCount} fatture</div>
                                            {todoCount > 0 && (
                                                <div className="text-amber-400 font-semibold">
                                                    {f.daApprovareCount > 0 && <>{f.daApprovareCount} da approvare</>}
                                                    {f.daApprovareCount > 0 && f.daPagareCount > 0 && ' · '}
                                                    {f.daPagareCount > 0 && <>{f.daPagareCount} da pagare</>}
                                                </div>
                                            )}
                                        </div>
                                        {todoCount > 0 && (
                                            <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-600 text-white text-xs font-bold">
                                                {todoCount}
                                            </span>
                                        )}
                                        <span className="text-theme-text-muted">→</span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>

            </>)}

            {creating && (
                <FornitoreForm
                    onClose={() => setCreating(false)}
                    onSaved={(f) => {
                        setCreating(false)
                        load()
                        setSelected(f)
                    }}
                />
            )}
        </div>
    )
}
