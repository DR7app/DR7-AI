/**
 * EMTNClientCard — header del cliente identificato + stats riassuntive.
 * Niente livello tecnico in chiaro al cliente: mostriamo solo dati
 * neutri all'admin (storico anonimo, totali). Il `message` e il
 * Trust Level vengono comunicati all'operatore in pannelli separati.
 */
import EMTNStatusBadge from './EMTNStatusBadge'

export interface EMTNClient {
    id: string
    codice_fiscale: string
    nome?: string | null
    cognome?: string | null
    data_nascita?: string | null
    created_at: string
}
export interface EMTNStats {
    total_rentals?: number
    regular_rentals?: number
    negative_events?: number
    events_under_review?: number
    last_activity_date?: string
}

interface Props {
    client: EMTNClient
    stats: EMTNStats | null
    riskBand: 'green' | 'yellow' | 'red'
}

function fmt(d?: string | null): string {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
    catch { return '—' }
}
function initials(n?: string | null, c?: string | null): string {
    return ((n || '').trim().charAt(0) + (c || '').trim().charAt(0)).toUpperCase() || '?'
}

export default function EMTNClientCard({ client, stats, riskBand }: Props) {
    const fullName = [client.nome, client.cognome].filter(Boolean).join(' ') || 'Cliente identificato'
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="w-14 h-14 rounded-full bg-dr7-gold/15 border border-dr7-gold/30 flex items-center justify-center text-dr7-gold font-bold text-lg flex-shrink-0">
                        {initials(client.nome, client.cognome)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-bold text-theme-text-primary">{fullName}</h3>
                            <EMTNStatusBadge variant="approved">Cliente identificato</EMTNStatusBadge>
                            <EMTNStatusBadge variant={riskBand}>{riskBand.toUpperCase()}</EMTNStatusBadge>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs">
                            <div className="flex justify-between">
                                <span className="text-theme-text-muted">Codice Fiscale</span>
                                <span className="text-theme-text-primary font-mono">{client.codice_fiscale}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-theme-text-muted">Cliente dal</span>
                                <span className="text-theme-text-primary">{fmt(client.created_at)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-theme-text-muted">Ultima attivita</span>
                                <span className="text-theme-text-primary">{fmt(stats?.last_activity_date)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 pt-4 border-t border-theme-border">
                {[
                    { label: 'Noleggi totali',      value: stats?.total_rentals ?? 0 },
                    { label: 'Noleggi regolari',    value: stats?.regular_rentals ?? 0 },
                    { label: 'Eventi attivi',       value: stats?.negative_events ?? 0 },
                    { label: 'In revisione',        value: stats?.events_under_review ?? 0 },
                ].map(s => (
                    <div key={s.label} className="rounded-lg bg-theme-bg-primary border border-theme-border p-2">
                        <div className="text-[9px] uppercase tracking-wider text-theme-text-muted">{s.label}</div>
                        <div className="text-lg font-bold text-theme-text-primary">{s.value}</div>
                    </div>
                ))}
            </div>
        </section>
    )
}
