import { useState, useEffect } from 'react'
import { supabase } from '../../../../supabaseClient'
import Button from '../Button'
import FornitoreForm from './FornitoreForm'
import FornitoreMonthlyView from './FornitoreMonthlyView'
import FornitoreScadenziario from './FornitoreScadenziario'
import FornitoreAlertsPanel from './FornitoreAlertsPanel'
import type { Fornitore } from './types'

interface Props {
    fornitore: Fornitore
    onBack: () => void
    onUpdated: (f: Fornitore) => void
}

type SubTab = 'documenti' | 'scadenziario' | 'alerts'

export default function FornitoreDetail({ fornitore, onBack, onUpdated }: Props) {
    const [tab, setTab] = useState<SubTab>('documenti')
    const [editing, setEditing] = useState(false)
    const [openAlertCount, setOpenAlertCount] = useState(0)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { count } = await supabase
                .from('fornitore_alerts')
                .select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id)
                .eq('status', 'open')
            if (!cancelled) setOpenAlertCount(count || 0)
        })()
        return () => { cancelled = true }
    }, [fornitore.id, tab])

    return (
        <div className="space-y-4">
            {/* Anagrafica header */}
            <div className="bg-theme-bg-secondary p-5 rounded-lg border border-theme-border">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <button onClick={onBack} className="text-xs text-theme-text-muted hover:text-theme-text-primary mb-1">
                            ← Tutti i fornitori
                        </button>
                        <h2 className="text-2xl font-semibold text-theme-text-primary">{fornitore.nome}</h2>
                        <div className="flex flex-wrap gap-3 mt-2 text-sm text-theme-text-secondary">
                            {fornitore.piva && <span>P.IVA <span className="font-mono">{fornitore.piva}</span></span>}
                            {fornitore.categoria_merce && <span>{fornitore.categoria_merce}</span>}
                            {fornitore.condizioni_pagamento && <span>{fornitore.condizioni_pagamento}</span>}
                            {fornitore.referente && <span>👤 {fornitore.referente}</span>}
                            {fornitore.telefono && <span>📞 {fornitore.telefono}</span>}
                            {fornitore.email && <span>✉ {fornitore.email}</span>}
                            {!fornitore.attivo && <span className="px-2 py-0.5 rounded bg-red-900 text-red-200 text-xs">Disattivato</span>}
                        </div>
                        {fornitore.iban && (
                            <p className="text-xs text-theme-text-muted mt-1 font-mono">IBAN: {fornitore.iban}</p>
                        )}
                        {fornitore.note && <p className="text-xs text-theme-text-muted mt-2 italic">{fornitore.note}</p>}
                    </div>
                    <Button variant="secondary" onClick={() => setEditing(true)}>Modifica anagrafica</Button>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 border-b border-theme-border overflow-x-auto">
                <button onClick={() => setTab('documenti')}
                    className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 ${tab === 'documenti' ? 'border-dr7-gold text-theme-text-primary' : 'border-transparent text-theme-text-muted hover:text-theme-text-secondary'}`}>
                    Registro mensile
                </button>
                <button onClick={() => setTab('scadenziario')}
                    className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 ${tab === 'scadenziario' ? 'border-dr7-gold text-theme-text-primary' : 'border-transparent text-theme-text-muted hover:text-theme-text-secondary'}`}>
                    Scadenziario
                </button>
                <button onClick={() => setTab('alerts')}
                    className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 ${tab === 'alerts' ? 'border-dr7-gold text-theme-text-primary' : 'border-transparent text-theme-text-muted hover:text-theme-text-secondary'}`}>
                    Alert {openAlertCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-900 text-red-200 text-xs">{openAlertCount}</span>}
                </button>
            </div>

            {tab === 'documenti' && <FornitoreMonthlyView fornitore={fornitore} />}
            {tab === 'scadenziario' && <FornitoreScadenziario fornitore={fornitore} />}
            {tab === 'alerts' && <FornitoreAlertsPanel fornitore={fornitore} />}

            {editing && (
                <FornitoreForm
                    fornitore={fornitore}
                    onClose={() => setEditing(false)}
                    onSaved={(f) => { onUpdated(f); setEditing(false) }}
                />
            )}
        </div>
    )
}
