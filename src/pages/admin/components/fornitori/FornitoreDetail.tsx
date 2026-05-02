import { useState, useEffect } from 'react'
import { supabase } from '../../../../supabaseClient'
import Button from '../Button'
import FornitoreForm from './FornitoreForm'
import FornitorePanoramica from './FornitorePanoramica'
import FornitoreMonthlyView from './FornitoreMonthlyView'
import FornitoreDocsList from './FornitoreDocsList'
import FornitoreScadenziario from './FornitoreScadenziario'
import FornitoreAlertsPanel from './FornitoreAlertsPanel'
import FornitoreCrossCheckPanel from './FornitoreCrossCheckPanel'
import type { Fornitore } from './types'

interface Props {
    fornitore: Fornitore
    onBack: () => void
    onUpdated: (f: Fornitore) => void
}

type SubTab = 'panoramica' | 'bolle' | 'fatture' | 'controllo' | 'scadenze' | 'pagamenti' | 'documenti' | 'alert'

interface Counts {
    bolle: number
    fatture: number
    scadenze: number
    pagamenti: number
    documenti: number
    alert: number
}

export default function FornitoreDetail({ fornitore, onBack, onUpdated }: Props) {
    const [tab, setTab] = useState<SubTab>('panoramica')
    const [editing, setEditing] = useState(false)
    const [counts, setCounts] = useState<Counts>({
        bolle: 0, fatture: 0, scadenze: 0, pagamenti: 0, documenti: 0, alert: 0,
    })

    async function loadCounts() {
        const today = new Date().toISOString().slice(0, 10)
        const [bolle, fatture, scadenze, pagamenti, documenti, alert] = await Promise.all([
            supabase.from('fornitore_documents').select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id).in('tipo', ['ddt', 'bolla']),
            supabase.from('fornitore_documents').select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id).eq('tipo', 'fattura'),
            supabase.from('fornitore_documents').select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id).eq('tipo', 'fattura')
                .not('data_scadenza', 'is', null)
                .not('stato', 'in', '(pagato,archiviato,bloccato)')
                .gte('data_scadenza', today),
            supabase.from('fornitore_documents').select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id).in('stato', ['pagato', 'archiviato']),
            supabase.from('fornitore_documents').select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id),
            supabase.from('fornitore_alerts').select('id', { count: 'exact', head: true })
                .eq('fornitore_id', fornitore.id).eq('status', 'open'),
        ])
        setCounts({
            bolle: bolle.count || 0,
            fatture: fatture.count || 0,
            scadenze: scadenze.count || 0,
            pagamenti: pagamenti.count || 0,
            documenti: documenti.count || 0,
            alert: alert.count || 0,
        })
    }

    useEffect(() => {
        loadCounts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                            {fornitore.referente && <span>{fornitore.referente}</span>}
                            {fornitore.telefono && <span>{fornitore.telefono}</span>}
                            {fornitore.email && <span>{fornitore.email}</span>}
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

            {/* Sub-tabs with counters */}
            <div className="flex gap-1 border-b border-theme-border overflow-x-auto">
                <TabBtn active={tab === 'panoramica'} onClick={() => setTab('panoramica')} label="Panoramica" />
                <TabBtn active={tab === 'bolle'} onClick={() => setTab('bolle')} label="Bolle" count={counts.bolle} />
                <TabBtn active={tab === 'fatture'} onClick={() => setTab('fatture')} label="Fatture" count={counts.fatture} />
                <TabBtn active={tab === 'controllo'} onClick={() => setTab('controllo')} label="Controllo Incrociato" />
                <TabBtn active={tab === 'scadenze'} onClick={() => setTab('scadenze')} label="Scadenze" count={counts.scadenze} />
                <TabBtn active={tab === 'pagamenti'} onClick={() => setTab('pagamenti')} label="Pagamenti" count={counts.pagamenti} />
                <TabBtn active={tab === 'documenti'} onClick={() => setTab('documenti')} label="Documenti" count={counts.documenti} />
                <TabBtn active={tab === 'alert'} onClick={() => setTab('alert')} label="Alert" count={counts.alert} alert={counts.alert > 0} />
            </div>

            {tab === 'panoramica' && <FornitorePanoramica fornitore={fornitore} />}
            {tab === 'bolle' && (
                <FornitoreDocsList fornitore={fornitore} tipiFilter={['ddt', 'bolla']} defaultUploadTipo="bolla" title="Bolle e DDT" />
            )}
            {tab === 'fatture' && (
                <FornitoreDocsList fornitore={fornitore} tipiFilter={['fattura']} defaultUploadTipo="fattura" title="Fatture" />
            )}
            {tab === 'controllo' && <FornitoreCrossCheckPanel fornitore={fornitore} />}
            {tab === 'scadenze' && <FornitoreScadenziario fornitore={fornitore} />}
            {tab === 'pagamenti' && (
                <FornitoreDocsList fornitore={fornitore} statiFilter={['pagato', 'archiviato']} title="Documenti pagati" />
            )}
            {tab === 'documenti' && <FornitoreMonthlyView fornitore={fornitore} />}
            {tab === 'alert' && <FornitoreAlertsPanel fornitore={fornitore} />}

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

function TabBtn({ active, onClick, label, count, alert }: {
    active: boolean
    onClick: () => void
    label: string
    count?: number
    alert?: boolean
}) {
    return (
        <button onClick={onClick}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 flex items-center gap-1.5 ${active
                ? 'border-dr7-gold text-theme-text-primary'
                : 'border-transparent text-theme-text-muted hover:text-theme-text-secondary'}`}>
            {label}
            {typeof count === 'number' && count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${alert
                    ? 'bg-red-900 text-red-200'
                    : 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>{count}</span>
            )}
        </button>
    )
}
