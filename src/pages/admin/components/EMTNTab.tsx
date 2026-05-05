/**
 * EMTNTab — orchestrator del modulo EMTN dentro DR7 admin.
 *
 * Architettura:
 *   - <EMTNSearch> raccoglie CF + bookingId, chiama /emtn-search.
 *   - <EMTNClientCard> mostra l'header del cliente identificato + stats.
 *   - <EMTNAuthorizationModal> gestisce flusso OTP (request + verify).
 *   - <EMTNEventReportModal> apre evento + carica documenti.
 *   - <EMTNStatusBadge> e' la single source dei colori.
 *
 * Hard rules:
 *   - Nessuna lookup senza CF valido (gated dal componente Search).
 *   - Nessuna lookup senza bookingId (gated dal componente Search).
 *   - Report dettagliato visibile solo dopo OTP verified (gated server-side
 *     e client-side via reportUnlocked dal payload di /emtn-search).
 *   - Ogni azione viene loggata server-side; UI non ha export endpoint.
 */
import { useState } from 'react'
import { authFetch } from '../../../utils/authFetch'
import EMTNSearch, { type EMTNSearchPayload } from './emtn/EMTNSearch'
import EMTNClientCard, { type EMTNClient, type EMTNStats } from './emtn/EMTNClientCard'
import EMTNAuthorizationModal from './emtn/EMTNAuthorizationModal'
import EMTNEventReportModal from './emtn/EMTNEventReportModal'
import EMTNStatusBadge, { statusToVariant } from './emtn/EMTNStatusBadge'

interface DR7HistoryItem {
    bookingId: string
    vehicle?: string | null
    date?: string | null
    label: string
    amount: number
    quantity: number
    paid: boolean
    note?: string
}
interface DR7History {
    totalBookings: number
    regularBookings: number
    damages: DR7HistoryItem[]
    penalties: DR7HistoryItem[]
    unpaidDamageTotal: number
    unpaidPenaltyTotal: number
    lastBookingDate?: string | null
}

interface SearchResponse {
    client: EMTNClient
    stats: EMTNStats | null
    riskBand: 'green' | 'yellow' | 'red'
    message: string
    reportUnlocked: boolean
    recentEvents: Array<{ id: string; type: string; status: string; headline: string; occurred_at?: string; created_at: string }>
    dr7History?: DR7History
}

export default function EMTNTab() {
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<SearchResponse | null>(null)

    const [authOpen, setAuthOpen] = useState(false)
    const [reportOpen, setReportOpen] = useState(false)

    async function refresh() {
        if (!data) return
        await runSearch({
            codiceFiscale: data.client.codice_fiscale,
            nome: data.client.nome || undefined,
            cognome: data.client.cognome || undefined,
        })
    }

    async function runSearch(payload: EMTNSearchPayload) {
        setSearching(true)
        setError(null)
        setData(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error || 'Lookup fallita')
            setData(body as SearchResponse)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setSearching(false)
        }
    }

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-theme-text-primary">European Mobility Trust Network</h2>
                    <p className="text-sm text-theme-text-muted mt-1">
                        Verifica un cliente prima del noleggio o segnala un evento documentato. Tutte le azioni
                        sono loggate (regolamento EMTN art. 4 - tracciabilita\').
                    </p>
                </div>
                <EMTNStatusBadge variant="approved">Accesso verificato</EMTNStatusBadge>
            </header>

            <EMTNSearch onSearch={runSearch} searching={searching} error={error} />

            {data && (
                <>
                    <EMTNClientCard
                        client={data.client}
                        stats={data.stats}
                        riskBand={data.riskBand}
                    />

                    {/* Riga azioni rapide: 2 + Risk Report */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <button
                            type="button"
                            onClick={() => setAuthOpen(true)}
                            className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-left hover:border-dr7-gold transition-colors"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span className="w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold flex items-center justify-center text-xs font-bold">1</span>
                                <h4 className="text-sm font-semibold text-theme-text-primary">Richiedi autorizzazione cliente</h4>
                            </div>
                            <p className="text-xs text-theme-text-muted">
                                Email / WhatsApp con codice OTP. Sblocca il Risk Report dettagliato.
                            </p>
                            <div className="mt-2">
                                <EMTNStatusBadge variant={data.reportUnlocked ? 'approved' : 'review'}>
                                    {data.reportUnlocked ? 'Autorizzato' : 'Da richiedere'}
                                </EMTNStatusBadge>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => setReportOpen(true)}
                            className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-left hover:border-dr7-gold transition-colors"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span className="w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold flex items-center justify-center text-xs font-bold">2</span>
                                <h4 className="text-sm font-semibold text-theme-text-primary">Segnala evento</h4>
                            </div>
                            <p className="text-xs text-theme-text-muted">
                                Apri segnalazione documentata. Stato iniziale UNDER_REVIEW.
                            </p>
                        </button>

                        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Mobility Risk Report</h4>
                            {data.reportUnlocked ? (
                                <>
                                    <p className="text-xs text-theme-text-primary mb-2">{data.message}</p>
                                    <p className="text-[11px] text-theme-text-muted">
                                        Cronologia EMTN visibile sotto. Sblocco valido finche\' l\'OTP non scade.
                                    </p>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 text-theme-text-muted">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <rect x="5" y="11" width="14" height="10" rx="2" />
                                        <path d="M8 11V7a4 4 0 118 0v4" />
                                    </svg>
                                    <p className="text-xs">Autorizzazione necessaria per visualizzare i dettagli.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Cronologia DR7 — sempre visibile all'admin DR7
                        (e' la tua propria base dati su questo cliente). */}
                    {data.dr7History && (data.dr7History.totalBookings > 0 || data.dr7History.damages.length > 0 || data.dr7History.penalties.length > 0) && (
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <div>
                                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Cronologia DR7</h3>
                                    <p className="text-xs text-theme-text-muted mt-0.5">
                                        Record interno DR7: {data.dr7History.totalBookings} prenotazion{data.dr7History.totalBookings === 1 ? 'e' : 'i'}, {data.dr7History.damages.length} dann{data.dr7History.damages.length === 1 ? 'o' : 'i'}, {data.dr7History.penalties.length} penal{data.dr7History.penalties.length === 1 ? 'e' : 'i'}.
                                    </p>
                                </div>
                                {(data.dr7History.unpaidDamageTotal + data.dr7History.unpaidPenaltyTotal) > 0 && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border border-red-500/40 bg-red-500/10 text-red-400">
                                        Non pagato: €{(data.dr7History.unpaidDamageTotal + data.dr7History.unpaidPenaltyTotal).toFixed(2)}
                                    </span>
                                )}
                            </div>

                            {data.dr7History.damages.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="text-[11px] font-semibold text-theme-text-secondary mb-2">Danni ({data.dr7History.damages.length})</h4>
                                    <ul className="divide-y divide-theme-border">
                                        {data.dr7History.damages.slice(0, 20).map((d, i) => (
                                            <li key={`d-${i}`} className="py-2 flex items-center justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm text-theme-text-primary truncate">{d.label}</p>
                                                    <p className="text-[11px] text-theme-text-muted">
                                                        {d.vehicle || '—'} · {d.date ? new Date(d.date).toLocaleDateString('it-IT') : '—'} · booking {d.bookingId.slice(0, 8)}…
                                                    </p>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-sm font-semibold text-theme-text-primary tabular-nums">€{d.amount.toFixed(2)}</div>
                                                    <span className={`text-[10px] uppercase tracking-wider ${d.paid ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {d.paid ? 'Pagato' : 'Non pagato'}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {data.dr7History.penalties.length > 0 && (
                                <div>
                                    <h4 className="text-[11px] font-semibold text-theme-text-secondary mb-2">Penali ({data.dr7History.penalties.length})</h4>
                                    <ul className="divide-y divide-theme-border">
                                        {data.dr7History.penalties.slice(0, 20).map((p, i) => (
                                            <li key={`p-${i}`} className="py-2 flex items-center justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm text-theme-text-primary truncate">{p.label}</p>
                                                    <p className="text-[11px] text-theme-text-muted">
                                                        {p.vehicle || '—'} · {p.date ? new Date(p.date).toLocaleDateString('it-IT') : '—'} · booking {p.bookingId.slice(0, 8)}…
                                                    </p>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-sm font-semibold text-theme-text-primary tabular-nums">€{p.amount.toFixed(2)}</div>
                                                    <span className={`text-[10px] uppercase tracking-wider ${p.paid ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {p.paid ? 'Pagato' : 'Non pagato'}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <p className="text-[10px] text-theme-text-muted mt-3">
                                Suggerimento: per portare un danno non saldato dentro la rete EMTN, clicca &quot;Segnala evento&quot; e copia i dettagli rilevanti nella descrizione.
                            </p>
                        </section>
                    )}

                    {/* Cronologia eventi (visibile solo se sbloccato dal server) */}
                    {data.reportUnlocked && (
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-3">
                                Cronologia EMTN ({data.recentEvents.length})
                            </h3>
                            {data.recentEvents.length === 0 ? (
                                <p className="text-xs text-theme-text-muted italic">Nessun evento registrato per questo cliente.</p>
                            ) : (
                                <ul className="divide-y divide-theme-border">
                                    {data.recentEvents.map(e => (
                                        <li key={e.id} className="py-2.5 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm text-theme-text-primary truncate">{e.headline}</p>
                                                <p className="text-[11px] text-theme-text-muted">
                                                    {e.type.replace(/_/g, ' ')} · {new Date(e.created_at).toLocaleDateString('it-IT')}
                                                </p>
                                            </div>
                                            <EMTNStatusBadge variant={statusToVariant(e.status)}>
                                                {e.status.replace(/_/g, ' ')}
                                            </EMTNStatusBadge>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
                </>
            )}

            <p className="text-[11px] text-theme-text-muted text-center">
                Tutte le azioni in questa pagina sono tracciate in `emtn_access_logs` come da regolamento.
                EMTN e\' best-effort: se il servizio e\' irraggiungibile non bloccare le prenotazioni.
            </p>

            {data && (
                <>
                    <EMTNAuthorizationModal
                        open={authOpen}
                        onClose={() => setAuthOpen(false)}
                        onVerified={refresh}
                        clientId={data.client.id}
                    />
                    <EMTNEventReportModal
                        open={reportOpen}
                        onClose={() => setReportOpen(false)}
                        onCreated={refresh}
                        clientId={data.client.id}
                    />
                </>
            )}
        </div>
    )
}
