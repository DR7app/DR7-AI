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
                {rows.map(a => {
                    // Pull every useful field from metadata so the admin sees
                    // the full reason at a glance — not just the headline.
                    const md = (a.metadata || {}) as Record<string, unknown>
                    const fNum = md.fattura_numero as string | undefined
                    const fDataRaw = md.fattura_data as string | undefined
                    const fData = fDataRaw ? new Date(fDataRaw).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
                    const fTotale = typeof md.fattura_totale === 'number' ? md.fattura_totale as number : null
                    const ddtTotale = typeof md.ddt_totale === 'number' ? md.ddt_totale as number : null
                    const diff = typeof md.differenza === 'number' ? md.differenza as number : null
                    const periodoAnno = md.periodo_anno as number | null | undefined
                    const periodoMese = md.periodo_mese as number | null | undefined
                    const periodoLabel = (periodoAnno && periodoMese)
                        ? `${String(periodoMese).padStart(2, '0')}/${periodoAnno}`
                        : ''
                    const dataScadenza = md.data_scadenza as string | undefined
                    const giorniMancanti = typeof md.giorni_mancanti === 'number' ? md.giorni_mancanti as number : null
                    const importoScaduto = typeof md.importo as number | undefined === 'number' ? md.importo as number : null

                    const chips: Array<{ label: string; value: string; tone?: 'warn' | 'err' | 'ok' }> = []
                    if (fNum) chips.push({ label: 'Fattura', value: `n.${fNum}` })
                    if (fData) chips.push({ label: 'Data', value: fData })
                    if (fTotale != null) chips.push({ label: 'Totale fattura', value: `€${fTotale.toFixed(2)}` })
                    if (ddtTotale != null) chips.push({ label: 'Totale DDT/bolle', value: `€${ddtTotale.toFixed(2)}` })
                    if (diff != null && diff !== 0) {
                        const sign = diff > 0 ? '+' : ''
                        chips.push({ label: 'Differenza', value: `${sign}€${diff.toFixed(2)}`, tone: 'err' })
                    }
                    if (periodoLabel) chips.push({ label: 'Periodo', value: periodoLabel })
                    if (dataScadenza) chips.push({ label: 'Scadenza', value: new Date(dataScadenza).toLocaleDateString('it-IT'), tone: giorniMancanti != null && giorniMancanti < 0 ? 'err' : 'warn' })
                    if (giorniMancanti != null) chips.push({ label: giorniMancanti < 0 ? 'Scaduta da' : 'Mancano', value: `${Math.abs(giorniMancanti)} gg`, tone: giorniMancanti < 0 ? 'err' : 'warn' })
                    if (importoScaduto != null) chips.push({ label: 'Importo', value: `€${importoScaduto.toFixed(2)}` })

                    return (
                        <div key={a.id} className={`p-3 rounded border border-theme-border bg-theme-bg-secondary ${a.status === 'open' ? '' : 'opacity-60'}`}>
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className={`text-xs px-2 py-0.5 rounded ${ALERT_SEVERITY_COLORS[a.severity]}`}>
                                    {a.severity.toUpperCase()}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-secondary">
                                    {ALERT_TIPO_LABELS[a.tipo]}
                                </span>
                                {!fornitore && a.fornitore?.nome && (
                                    <span className="text-sm text-theme-text-primary font-semibold">{a.fornitore.nome}</span>
                                )}
                                <span className="ml-auto text-xs text-theme-text-muted">{fmtDateIT(a.created_at)}</span>
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
                            <p className="text-sm text-theme-text-primary leading-snug">{a.messaggio}</p>
                            {chips.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {chips.map((c, i) => (
                                        <span key={i} className={`text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${c.tone === 'err' ? 'bg-red-950/60 text-red-300' : c.tone === 'warn' ? 'bg-amber-950/60 text-amber-300' : 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>
                                            <span className="opacity-70">{c.label}:</span>
                                            <span className="font-medium">{c.value}</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
