import { useEffect, useState } from 'react'
import { supabase } from '../../../../supabaseClient'
import {
    ALERT_TIPO_LABELS,
    ALERT_SEVERITY_COLORS,
    fmtDateIT,
} from './types'
import type { FornitoreAlert, Fornitore } from './types'

interface Props {
    /** When set, scopes alerts to one fornitore */
    fornitore?: Fornitore | null
}

interface AlertRow extends FornitoreAlert {
    fornitore?: { nome: string }
}

export default function FornitoreAlertsPanel({ fornitore }: Props) {
    const [rows, setRows] = useState<AlertRow[]>([])
    const [loading, setLoading] = useState(false)
    const [filter, setFilter] = useState<'open' | 'all'>('open')

    async function load() {
        setLoading(true)
        try {
            let query = supabase
                .from('fornitore_alerts')
                .select('*, fornitore:fornitori(nome)')
                .order('created_at', { ascending: false })
                .limit(200)
            if (fornitore) query = query.eq('fornitore_id', fornitore.id)
            if (filter === 'open') query = query.eq('status', 'open')
            const { data, error } = await query
            if (error) throw error
            setRows((data || []) as AlertRow[])
        } catch (err) {
            console.error('[alerts] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore?.id, filter])

    async function ack(a: AlertRow) {
        await supabase.from('fornitore_alerts')
            .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
            .eq('id', a.id)
        load()
    }

    async function resolve(a: AlertRow) {
        await supabase.from('fornitore_alerts')
            .update({ status: 'resolved', resolved_at: new Date().toISOString() })
            .eq('id', a.id)
        load()
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <button onClick={() => setFilter('open')}
                    className={`text-sm px-3 py-1.5 rounded ${filter === 'open' ? 'bg-dr7-gold text-black font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>
                    Aperti
                </button>
                <button onClick={() => setFilter('all')}
                    className={`text-sm px-3 py-1.5 rounded ${filter === 'all' ? 'bg-dr7-gold text-black font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>
                    Tutti
                </button>
                <span className="ml-auto text-sm text-theme-text-secondary">{rows.length} alert</span>
            </div>

            {loading && <p className="text-theme-text-muted text-sm">Caricamento…</p>}
            {!loading && rows.length === 0 && (
                <p className="text-theme-text-muted text-sm">Nessun alert.</p>
            )}

            <div className="space-y-2">
                {rows.map(a => (
                    <div key={a.id} className={`p-3 rounded border border-theme-border bg-theme-bg-secondary flex flex-wrap items-center gap-3 ${a.status === 'open' ? '' : 'opacity-60'}`}>
                        <span className={`text-xs px-2 py-0.5 rounded ${ALERT_SEVERITY_COLORS[a.severity]}`}>
                            {a.severity.toUpperCase()}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-secondary">
                            {ALERT_TIPO_LABELS[a.tipo]}
                        </span>
                        {!fornitore && a.fornitore?.nome && (
                            <span className="text-sm text-theme-text-primary font-semibold">{a.fornitore.nome}</span>
                        )}
                        <span className="text-sm text-theme-text-primary flex-1">{a.messaggio}</span>
                        <span className="text-xs text-theme-text-muted">{fmtDateIT(a.created_at)}</span>
                        {a.status === 'open' && (
                            <>
                                <button onClick={() => ack(a)}
                                    className="text-xs px-2 py-1 rounded bg-blue-900 text-blue-200 hover:bg-blue-800">
                                    Preso in carico
                                </button>
                                <button onClick={() => resolve(a)}
                                    className="text-xs px-2 py-1 rounded bg-green-900 text-green-200 hover:bg-green-800">
                                    Risolto
                                </button>
                            </>
                        )}
                        {a.status === 'acknowledged' && (
                            <button onClick={() => resolve(a)}
                                className="text-xs px-2 py-1 rounded bg-green-900 text-green-200 hover:bg-green-800">
                                Risolto
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
