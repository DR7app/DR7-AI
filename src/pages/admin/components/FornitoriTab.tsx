import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Button from './Button'
import FornitoreSimpleView from './fornitori/FornitoreSimpleView'
import type { Fornitore } from './fornitori/types'

interface FornitoreRow extends Fornitore {
    bolleCount: number
    fattureCount: number
    daApprovareCount: number
    daPagareCount: number
}

/**
 * Lista fornitori — semplice. Ricerca + import automatico da Aruba.
 * Click su un fornitore apre il flusso a 4 step (FornitoreSimpleView).
 *
 * Niente più tab, info-card di marketing o pannello laterale: il flusso è
 * direttamente nelle azioni che l'utente esegue (carica bolla, controlla,
 * approva, paga).
 */
export default function FornitoriTab() {
    const [fornitori, setFornitori] = useState<FornitoreRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<Fornitore | null>(null)
    const [importing, setImporting] = useState(false)

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
                counts[r.id] = { ...r, bolleCount: 0, fattureCount: 0, daApprovareCount: 0, daPagareCount: 0 }
            }
            if (ids.length > 0) {
                const { data: docs } = await supabase
                    .from('fornitore_documents')
                    .select('fornitore_id, tipo, stato')
                    .in('fornitore_id', ids)
                for (const d of (docs || []) as { fornitore_id: string; tipo: string; stato: string }[]) {
                    const row = counts[d.fornitore_id]
                    if (!row) continue
                    if (d.tipo === 'ddt' || d.tipo === 'bolla') row.bolleCount++
                    else if (d.tipo === 'fattura') {
                        row.fattureCount++
                        if (d.stato === 'verificato') row.daApprovareCount++
                        else if (d.stato === 'approvato' || d.stato === 'pagabile') row.daPagareCount++
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

    useEffect(() => { load() }, [])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return fornitori
        return fornitori.filter(f =>
            f.nome.toLowerCase().includes(q) ||
            (f.piva || '').toLowerCase().includes(q) ||
            (f.categoria_merce || '').toLowerCase().includes(q)
        )
    }, [fornitori, search])

    async function importFromAruba() {
        setImporting(true)
        try {
            const res = await fetch('/.netlify/functions/import-fornitori-from-aruba', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ months: 3 }),
            })
            const text = await res.text()
            let json: { success?: boolean; inserted?: number; updated?: number; error?: string } = {}
            try { json = JSON.parse(text) } catch { /* ignore */ }
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            toast.success(`Sincronizzato: ${json.inserted ?? 0} nuovi · ${json.updated ?? 0} aggiornati`)
            load()
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Sincronizzazione fallita: ' + msg)
        } finally {
            setImporting(false)
        }
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
            <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-2xl font-semibold text-theme-text-primary">Fornitori</h2>
                <Button variant="secondary" onClick={importFromAruba} disabled={importing}>
                    {importing ? 'Sincronizzazione…' : 'Sincronizza da Aruba'}
                </Button>
            </div>

            <Input
                placeholder="Cerca per nome, P.IVA o categoria…"
                value={search}
                onChange={e => setSearch(e.target.value)}
            />

            <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-hidden">
                {loading && (
                    <div className="px-4 py-6 text-center text-theme-text-muted text-sm">Caricamento…</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="px-4 py-6 text-center text-theme-text-muted text-sm">
                        {search
                            ? 'Nessun fornitore corrisponde alla ricerca'
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
        </div>
    )
}
