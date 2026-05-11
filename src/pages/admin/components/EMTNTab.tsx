/**
 * EMTNTab — modulo EMTN dentro DR7 admin (redesign v3, dark dashboard).
 *
 * Layout 1:1 al mockup ufficiale: header + tab strip + griglia main(8)/side(4)
 * con barra di ricerca sempre visibile, customer header card, action cards,
 * tre colonne Autorizzazione/Anteprima Report/Risk Score, tre colonne
 * Segnalazione/Documentazione/Stato. Sidebar con Trust Status, Attivita',
 * Alert e Automazioni. Footer con badge di conformita'.
 *
 * Hard rules invariate: nessuna lookup senza CF valido, Risk Report
 * sbloccato solo dopo OTP verified, le inline form delegano ai modali
 * esistenti (EMTNAuthorizationModal, EMTNEventReportModal) per
 * preservare il flusso server.
 */
import { useEffect, useState } from 'react'
import EMTNAuthorizationModal from './emtn/EMTNAuthorizationModal'
import EMTNEventReportModal from './emtn/EMTNEventReportModal'
import { authFetch } from '../../../utils/authFetch'

interface ClientWithDamages {
    codice_fiscale: string
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    damages_count: number
    penalties_count: number
    paid_damage_total: number
    unpaid_damage_total: number
    paid_penalty_total: number
    unpaid_penalty_total: number
    last_event_date: string | null
    last_vehicle: string | null
    bookings_with_events: number
}

const CF_REGEX = /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/

interface EMTNClient {
    id: string
    codice_fiscale: string
    nome: string | null
    cognome: string | null
    email?: string | null
    phone?: string | null
    created_at?: string
    last_seen_at?: string | null
    customer_since?: string | null
    source?: string
    date_of_birth?: string | null
    sex?: string | null
    nationality?: string | null
    address?: string | null
}
interface EMTNStats {
    total_rentals?: number
    recent_rentals?: number
    reported_events?: number
    [k: string]: unknown
}
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
interface RecentEvent {
    id: string
    type: string
    status: string
    headline: string
    occurred_at?: string
    created_at: string
}
interface SearchResponse {
    client: EMTNClient
    stats: EMTNStats | null
    riskBand: 'green' | 'yellow' | 'red'
    riskScore?: number
    riskLevel?: number
    message: string
    reportUnlocked: boolean
    recentEvents: RecentEvent[]
    dr7History?: DR7History
}

type EMTNView = 'ricerca' | 'risk-report' | 'segnalazione' | 'mie-segnalazioni' | 'audit' | 'regolamento'

const TABS: Array<{ key: EMTNView; label: string }> = [
    { key: 'ricerca', label: 'Ricerca Cliente' },
    { key: 'risk-report', label: 'Mobility Risk Report' },
    { key: 'segnalazione', label: 'Segnalazione' },
    { key: 'mie-segnalazioni', label: 'I miei eventi' },
    { key: 'audit', label: 'Audit & Log' },
    { key: 'regolamento', label: 'Regolamento EMTN' },
]

export default function EMTNTab() {
    const [activeView, setActiveView] = useState<EMTNView>('ricerca')

    const [cfInput, setCfInput] = useState('')
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<SearchResponse | null>(null)

    const [authOpen, setAuthOpen] = useState(false)
    const [reportOpen, setReportOpen] = useState(false)

    const [damagedClients, setDamagedClients] = useState<ClientWithDamages[]>([])
    const [damagedLoading, setDamagedLoading] = useState(false)
    const [damagedError, setDamagedError] = useState<string | null>(null)

    async function loadDamagedClients() {
        setDamagedLoading(true)
        setDamagedError(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-clients-with-damages', { method: 'GET' })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error || 'Caricamento clienti con danni fallito')
            setDamagedClients((body.clients as ClientWithDamages[]) || [])
        } catch (err) {
            setDamagedError((err as Error).message)
        } finally {
            setDamagedLoading(false)
        }
    }

    useEffect(() => {
        loadDamagedClients()
    }, [])

    const cfValid = CF_REGEX.test(cfInput.trim().toUpperCase())

    async function refresh() {
        if (!data) return
        await runSearch(data.client.codice_fiscale)
        await loadDamagedClients()
    }

    async function runSearch(cf: string) {
        setSearching(true)
        setError(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codiceFiscale: cf.trim().toUpperCase() }),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error || 'Lookup fallita')
            setData(body as SearchResponse)
            setCfInput(cf.trim().toUpperCase())
        } catch (err) {
            setError((err as Error).message)
            setData(null)
        } finally {
            setSearching(false)
        }
    }

    async function handleSearchSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!cfValid || searching) return
        await runSearch(cfInput)
    }

    return (
        <div className="space-y-3 text-theme-text-primary">
            <PageHeader />
            <TabStrip
                activeView={activeView}
                onChange={setActiveView}
                canExport={!!data?.reportUnlocked}
            />

            {activeView === 'ricerca' && (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                    <main className="xl:col-span-8 space-y-3">
                        <RicercaCard
                            cf={cfInput}
                            cfValid={cfValid}
                            onChange={setCfInput}
                            onSubmit={handleSearchSubmit}
                            searching={searching}
                            verified={!!data}
                            error={error}
                        />
                        {!data && (
                            <ClientiConDanniCard
                                clients={damagedClients}
                                loading={damagedLoading}
                                error={damagedError}
                                onSelect={(cf) => runSearch(cf)}
                            />
                        )}
                        {data && (
                            <>
                                <ClienteHeaderCard client={data.client} riskBand={data.riskBand} />
                                <ActionCards
                                    reportUnlocked={data.reportUnlocked}
                                    onOpenAuth={() => setAuthOpen(true)}
                                    onOpenReport={() => setReportOpen(true)}
                                />
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                    <AutorizzazioneClienteCard
                                        defaultEmail={data.client.email || ''}
                                        defaultPhone={data.client.phone || ''}
                                        onOpenModal={() => setAuthOpen(true)}
                                        authorized={data.reportUnlocked}
                                    />
                                    <RiskReportAnteprimaCard
                                        unlocked={data.reportUnlocked}
                                        onOpenAuth={() => setAuthOpen(true)}
                                    />
                                    <RiskScoreCard
                                        riskBand={data.riskBand}
                                        riskScore={data.riskScore}
                                        stats={data.stats}
                                        dr7History={data.dr7History}
                                        client={data.client}
                                    />
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                    <SegnalazioneEventoCard onOpenModal={() => setReportOpen(true)} />
                                    <DocumentazioneCard onOpenModal={() => setReportOpen(true)} />
                                    <StatoSegnalazioneCard events={data.recentEvents} />
                                </div>
                            </>
                        )}
                    </main>

                    <aside className="xl:col-span-4 space-y-3">
                        {data ? (
                            <>
                                <MobilityTrustStatus
                                    client={data.client}
                                    stats={data.stats}
                                    riskBand={data.riskBand}
                                    riskLevel={data.riskLevel}
                                />
                                <AttivitaRecenti events={data.recentEvents} dr7History={data.dr7History} />
                                <AlertSistema events={data.recentEvents} />
                                <AutomazioniAttive />
                            </>
                        ) : (
                            <SidebarPlaceholder />
                        )}
                    </aside>
                </div>
            )}

            {activeView !== 'ricerca' && (
                <PlaceholderView label={TABS.find(t => t.key === activeView)?.label || ''} />
            )}

            <ConformitaFooter />

            {data && (
                <>
                    <EMTNAuthorizationModal
                        open={authOpen}
                        onClose={() => setAuthOpen(false)}
                        onVerified={refresh}
                        clientId={data.client.id}
                        defaultEmail={data.client.email || undefined}
                        defaultPhone={data.client.phone || undefined}
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

/* ---------- Header + tabs ---------- */

function PageHeader() {
    return (
        <header className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
                <span className="w-9 h-9 grid place-items-center rounded-lg bg-blue-600 text-white shrink-0">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 7h7l-5.5 4.5L18 22l-6-4-6 4 1.5-8.5L2 9h7z"/>
                    </svg>
                </span>
                <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-bold text-theme-text-primary leading-tight">
                        European Mobility Trust Network <span className="text-theme-text-muted font-medium">(EMTN)</span>
                    </h2>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                        Infrastruttura europea integrata per la prevenzione frodi e la tutela degli operatori mobility.
                    </p>
                </div>
            </div>
        </header>
    )
}

function TabStrip({ activeView, onChange, canExport }: {
    activeView: EMTNView
    onChange: (v: EMTNView) => void
    canExport: boolean
}) {
    return (
        <div className="border-b border-theme-border flex items-center gap-1 overflow-x-auto">
            {TABS.map(t => {
                const active = t.key === activeView
                return (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => onChange(t.key)}
                        className={
                            'px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ' +
                            (active
                                ? 'border-emerald-500 text-theme-text-primary'
                                : 'border-transparent text-theme-text-muted hover:text-theme-text-primary')
                        }
                    >
                        {t.label}
                    </button>
                )
            })}
            <button
                type="button"
                disabled={!canExport}
                title={canExport ? 'Esporta report' : 'Disponibile dopo autorizzazione cliente'}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-theme-bg-hover"
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/>
                </svg>
                Esporta report
            </button>
        </div>
    )
}

function PlaceholderView({ label }: { label: string }) {
    return (
        <section className="rounded-2xl border border-dashed border-theme-border bg-theme-bg-secondary p-10 text-center">
            <p className="text-sm font-semibold text-theme-text-primary">{label}</p>
            <p className="text-xs text-theme-text-muted mt-1">
                Sezione in arrivo. Per ora usa la tab <span className="font-medium text-theme-text-primary">Ricerca Cliente</span>.
            </p>
        </section>
    )
}

function SidebarPlaceholder() {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-[11px] text-theme-text-muted">
            La sidebar mostra Mobility Trust Status, attivita\' recenti, alert e automazioni
            dopo aver eseguito una ricerca valida.
        </section>
    )
}

/* ---------- Ricerca card (sempre visibile) ---------- */

function RicercaCard({ cf, cfValid, onChange, onSubmit, searching, verified, error }: {
    cf: string
    cfValid: boolean
    onChange: (v: string) => void
    onSubmit: (e: React.FormEvent) => void
    searching: boolean
    verified: boolean
    error: string | null
}) {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
            <div className="border-l-4 border-emerald-500 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 grid place-items-center rounded text-emerald-500">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="11" cy="11" r="7"/>
                            <path strokeLinecap="round" d="M21 21l-4.35-4.35"/>
                        </svg>
                    </span>
                    <h3 className="text-sm font-semibold">Ricerca Cliente</h3>
                </div>
                <p className="text-[11px] text-theme-text-muted mb-3">
                    Inserisci il Codice Fiscale per consultare il Mobility Trust Network.
                </p>
                <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-9 relative">
                        <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Codice Fiscale *</label>
                        <input
                            type="text"
                            value={cf}
                            onChange={(e) => onChange(e.target.value.toUpperCase())}
                            placeholder="RSSMRA85D01H501Z"
                            className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 pr-10 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500/40 font-mono uppercase"
                            spellCheck={false}
                            maxLength={16}
                            aria-invalid={cf.length > 0 && !cfValid}
                        />
                        {verified && cfValid && (
                            <span className="absolute right-3 top-[calc(50%+6px)] -translate-y-1/2 text-emerald-500">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                                </svg>
                            </span>
                        )}
                    </div>
                    <div className="sm:col-span-3 flex items-end">
                        <button
                            type="submit"
                            disabled={!cfValid || searching}
                            className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 text-white text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-600"
                        >
                            {searching ? 'Ricerca…' : 'Ricerca Cliente'}
                            {!searching && (
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                                </svg>
                            )}
                        </button>
                    </div>
                </form>
                <p className="mt-2 text-[10px] text-theme-text-muted">
                    La ricerca è anonima e non permette l&apos;accesso a informazioni private del noleggio.
                </p>
                {error && (
                    <div className="mt-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-[11px] text-red-400">
                        {error}
                    </div>
                )}
            </div>
        </section>
    )
}

/* ---------- Customer header card ---------- */

function ClienteHeaderCard({ client, riskBand }: { client: EMTNClient; riskBand: 'green' | 'yellow' | 'red' }) {
    const initials = ((client.nome?.[0] || '') + (client.cognome?.[0] || '')).toUpperCase() || 'CL'
    const fullName = [client.nome, client.cognome].filter(Boolean).join(' ') || 'Cliente'
    const tone = riskBand === 'green'
        ? { text: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Affidabile' }
        : riskBand === 'yellow'
            ? { text: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Da monitorare' }
            : { text: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Allerta' }

    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-start gap-4 flex-wrap">
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className={`w-14 h-14 rounded-full ${tone.bg} ${tone.text} border ${tone.border} grid place-items-center text-base font-bold`}>
                        {initials}
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                        <h3 className="text-base font-bold text-theme-text-primary truncate">{fullName}</h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 text-[10px] font-semibold">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                            Cliente verificato
                        </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
                        <Field label="Codice Fiscale" value={client.codice_fiscale} mono />
                        <Field label="Email" value={client.email || '—'} />
                        <Field label="Cliente nel network da" value={formatDate(client.customer_since) || '—'} />
                        <Field label="Data di nascita" value={formatDate(client.date_of_birth) || '—'} />
                        <Field label="Telefono" value={client.phone || '—'} />
                        <Field label="Ultimo controllo" value={formatDate(client.last_seen_at) || formatDate(new Date().toISOString())} />
                        <Field label="Sesso" value={client.sex || '—'} />
                        <Field label="Indirizzo" value={client.address || '—'} />
                        <Field label="Eventi registrati" value={String((client as unknown as { events?: number }).events ?? 0)} />
                        <Field label="Nazionalità" value={client.nationality || '—'} />
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${tone.bg} ${tone.text} border ${tone.border} text-[10px] font-semibold uppercase tracking-wider`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${tone.text === 'text-emerald-500' ? 'bg-emerald-500' : tone.text === 'text-amber-500' ? 'bg-amber-500' : 'bg-red-500'}`}/>
                        {tone.label}
                    </span>
                    <span className="text-[10px] text-theme-text-muted tabular-nums">
                        {formatDate(new Date().toISOString())}
                    </span>
                </div>
            </div>
        </section>
    )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">{label}</p>
            <p className={`text-xs text-theme-text-primary truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
        </div>
    )
}

/* ---------- Action cards ---------- */

function ActionCards({ reportUnlocked, onOpenAuth, onOpenReport }: {
    reportUnlocked: boolean
    onOpenAuth: () => void
    onOpenReport: () => void
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
                type="button"
                onClick={onOpenAuth}
                className="group rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-left hover:border-blue-500/60 transition-colors"
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
                        <h4 className="text-sm font-semibold text-theme-text-primary">Richiedi autorizzazione cliente</h4>
                    </div>
                    <svg className="w-4 h-4 text-theme-text-muted group-hover:text-blue-400 shrink-0 mt-1 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
                <p className="text-xs text-theme-text-muted">
                    Invia una richiesta di autorizzazione per sbloccare il Mobility Risk Report completo.
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                    <span className={'w-1.5 h-1.5 rounded-full ' + (reportUnlocked ? 'bg-emerald-500' : 'bg-amber-500')}/>
                    <span className={reportUnlocked ? 'text-emerald-500' : 'text-amber-500'}>
                        {reportUnlocked ? 'Autorizzato' : 'Da richiedere'}
                    </span>
                </div>
            </button>
            <button
                type="button"
                onClick={onOpenReport}
                className="group rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-left hover:border-emerald-500/60 transition-colors"
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">2</span>
                        <h4 className="text-sm font-semibold text-theme-text-primary">Segnala evento</h4>
                    </div>
                    <svg className="w-4 h-4 text-theme-text-muted group-hover:text-emerald-400 shrink-0 mt-1 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
                <p className="text-xs text-theme-text-muted">
                    Segnala un evento avvenuto durante il noleggio. Il caso entra in stato &quot;In revisione&quot;.
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"/>
                    <span className="text-amber-500">Stato iniziale: in revisione</span>
                </div>
            </button>
        </div>
    )
}

/* ---------- Autorizzazione Cliente (col 1 di 3) ---------- */

function AutorizzazioneClienteCard({ defaultEmail, defaultPhone, onOpenModal, authorized }: {
    defaultEmail: string
    defaultPhone: string
    onOpenModal: () => void
    authorized: boolean
}) {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 flex flex-col">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Autorizzazione cliente</h3>
                <span className={'inline-flex items-center gap-1 text-[10px] font-semibold ' + (authorized ? 'text-emerald-500' : 'text-amber-500')}>
                    <span className={'w-1.5 h-1.5 rounded-full ' + (authorized ? 'bg-emerald-500' : 'bg-amber-500')}/>
                    {authorized ? 'Autorizzato' : 'Non autorizzato'}
                </span>
            </div>
            <p className="text-[11px] text-theme-text-muted mb-3">
                L&apos;autorizzazione del cliente è necessaria per sbloccare il Mobility Risk Report completo.
            </p>
            <div className="space-y-2">
                <div>
                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Email del cliente</label>
                    <input
                        type="email"
                        defaultValue={defaultEmail}
                        placeholder="cliente@email.com"
                        className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                </div>
                <div>
                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">WhatsApp (opzionale)</label>
                    <input
                        type="tel"
                        defaultValue={defaultPhone}
                        placeholder="+39 ..."
                        className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                </div>
            </div>
            <button
                type="button"
                onClick={onOpenModal}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-semibold rounded-lg px-3 py-2 hover:bg-blue-700"
            >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-6 9 6"/>
                </svg>
                Invia richiesta autorizzazione
            </button>
            <div className="mt-3 pt-3 border-t border-theme-border">
                <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-1.5">Come funziona</p>
                <ul className="space-y-1 text-[11px] text-theme-text-muted">
                    <li className="flex gap-2"><Step n={1}/> Email + WhatsApp con OTP a 6 cifre</li>
                    <li className="flex gap-2"><Step n={2}/> Il cliente comunica il codice all&apos;operatore</li>
                    <li className="flex gap-2"><Step n={3}/> Validità limitata al noleggio in corso</li>
                    <li className="flex gap-2"><Step n={4}/> Sblocca lo storico contratti e segnalazioni</li>
                    <li className="flex gap-2"><Step n={5}/> Ogni accesso viene loggato per GDPR</li>
                </ul>
            </div>
        </section>
    )
}

function Step({ n }: { n: number }) {
    return (
        <span className="w-4 h-4 grid place-items-center rounded-full bg-blue-500/15 text-blue-400 text-[9px] font-bold shrink-0 mt-0.5">{n}</span>
    )
}

/* ---------- Mobility Risk Report Anteprima (col 2 di 3) ---------- */

function RiskReportAnteprimaCard({ unlocked, onOpenAuth }: { unlocked: boolean; onOpenAuth: () => void }) {
    const items = [
        'Storico contratti completi',
        'Pagamenti e scadenze',
        'Eventi segnalati',
        'Segnalazioni in revisione',
        'Indici di affidabilità',
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 flex flex-col">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Risk Report (anteprima)</h3>
                <span className={'text-[10px] font-semibold ' + (unlocked ? 'text-emerald-500' : 'text-amber-500')}>
                    {unlocked ? 'Disponibile' : 'Autorizzazione necessaria'}
                </span>
            </div>
            <p className="text-[11px] text-theme-text-muted mb-3">
                {unlocked
                    ? 'Tutti i dati EMTN sono consultabili per la durata di questo OTP.'
                    : 'Richiedi l’autorizzazione al cliente per visualizzare il Mobility Risk Report completo.'}
            </p>
            <ul className="space-y-1.5 text-[11px] flex-1">
                {items.map(it => (
                    <li key={it} className="flex items-center gap-2 text-theme-text-primary">
                        <span className={
                            'w-4 h-4 grid place-items-center rounded-full shrink-0 ' +
                            (unlocked ? 'bg-emerald-500/15 text-emerald-500' : 'bg-theme-bg-tertiary text-theme-text-muted')
                        }>
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                        </span>
                        <span className={unlocked ? '' : 'text-theme-text-muted'}>{it}</span>
                    </li>
                ))}
            </ul>
            {!unlocked && (
                <button
                    type="button"
                    onClick={onOpenAuth}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 border border-theme-border bg-theme-bg-tertiary text-theme-text-primary text-xs font-semibold rounded-lg px-3 py-2 hover:bg-theme-bg-hover"
                >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="5" y="11" width="14" height="10" rx="2"/>
                        <path d="M8 11V7a4 4 0 118 0v4"/>
                    </svg>
                    Richiedi autorizzazione per sbloccare
                </button>
            )}
        </section>
    )
}

/* ---------- Risk Score AI (col 3 di 3) ---------- */

function RiskScoreCard({ riskBand, riskScore, stats, dr7History, client }: {
    riskBand: 'green' | 'yellow' | 'red'
    riskScore?: number
    stats: EMTNStats | null
    dr7History?: DR7History
    client: EMTNClient
}) {
    const score = typeof riskScore === 'number'
        ? riskScore
        : (riskBand === 'green' ? 85 : riskBand === 'yellow' ? 60 : 30)
    const tone = riskBand === 'green'
        ? { text: 'text-emerald-500', stroke: '#10b981', label: 'Affidabile' }
        : riskBand === 'yellow'
            ? { text: 'text-amber-500', stroke: '#f59e0b', label: 'Medio rischio' }
            : { text: 'text-red-500', stroke: '#ef4444', label: 'Alto rischio' }
    const total = (stats?.total_rentals as number) ?? dr7History?.totalBookings ?? 0
    const events = (stats?.reported_events as number) ?? 0
    const damages = dr7History?.damages.length ?? 0
    const since = client.customer_since || client.created_at
    const months = monthsSince(since)

    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 flex flex-col">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Risk Score AI</h3>
                <span className={'text-[10px] font-semibold ' + tone.text}>{tone.label}</span>
            </div>
            <div className="flex items-center justify-center my-2">
                <ScoreGauge score={score} stroke={tone.stroke} />
            </div>
            <div className="text-center mb-3">
                <p className={'text-[10px] uppercase tracking-wider font-semibold ' + tone.text}>Score {tone.label}</p>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-1.5">Fattori di valutazione</p>
            <ul className="space-y-1 text-[11px]">
                <li className="flex justify-between">
                    <span className="text-theme-text-muted">Storico contratti</span>
                    <span className="text-theme-text-primary tabular-nums">{total}</span>
                </li>
                <li className="flex justify-between">
                    <span className="text-theme-text-muted">Eventi segnalati</span>
                    <span className="text-theme-text-primary tabular-nums">{events}</span>
                </li>
                <li className="flex justify-between">
                    <span className="text-theme-text-muted">Danni / penali</span>
                    <span className="text-theme-text-primary tabular-nums">{damages}</span>
                </li>
                <li className="flex justify-between">
                    <span className="text-theme-text-muted">Anzianità nel network</span>
                    <span className="text-theme-text-primary tabular-nums">{months ? `${months} mesi` : '—'}</span>
                </li>
            </ul>
            <p className="mt-3 text-[10px] text-theme-text-muted">
                Aggiornato il {formatDate(new Date().toISOString())}
            </p>
        </section>
    )
}

function ScoreGauge({ score, stroke }: { score: number; stroke: string }) {
    const r = 42
    const c = 2 * Math.PI * r
    const pct = Math.max(0, Math.min(100, score))
    const dash = (pct / 100) * c
    return (
        <div className="relative w-28 h-28">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" className="text-theme-bg-tertiary" strokeWidth={8}/>
                <circle
                    cx="50" cy="50" r={r}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={8}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${c}`}
                />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                    <p className="text-2xl font-bold text-theme-text-primary tabular-nums leading-none">{Math.round(score)}</p>
                    <p className="text-[9px] uppercase tracking-wider text-theme-text-muted mt-0.5">/100</p>
                </div>
            </div>
        </div>
    )
}

/* ---------- Segnalazione Evento (col 1 di 3 bottom) ---------- */

const EVENT_CATEGORIES = [
    { key: 'danni', label: 'Danni non risarciti', icon: 'M12 9v3m0 4h.01' },
    { key: 'incidente', label: 'Incidente', icon: 'M12 8v4l3 3' },
    { key: 'mancata', label: 'Mancata restituzione', icon: 'M6 6l12 12M6 18L18 6' },
    { key: 'frode', label: 'Frode / falso', icon: 'M12 4v8m0 4h.01' },
    { key: 'furto', label: 'Furto del veicolo', icon: 'M5 13l4 4L19 7' },
    { key: 'ostile', label: 'Comportamento ostile', icon: 'M12 14a4 4 0 100-8 4 4 0 000 8z' },
]

function SegnalazioneEventoCard({ onOpenModal }: { onOpenModal: () => void }) {
    const [selected, setSelected] = useState<string | null>(null)
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary overflow-hidden flex flex-col">
            <div className="border-l-4 border-emerald-500 px-4 py-3 flex-1 flex flex-col">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Segnalazione evento</h3>
                <p className="text-[11px] text-theme-text-muted mb-3">
                    Segnala un evento avvenuto durante il noleggio. Tutte le segnalazioni sono soggette a revisione.
                </p>
                <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Tipologia evento</p>
                <div className="grid grid-cols-2 gap-2 mb-3 flex-1">
                    {EVENT_CATEGORIES.map(cat => {
                        const active = selected === cat.key
                        return (
                            <button
                                key={cat.key}
                                type="button"
                                onClick={() => setSelected(cat.key)}
                                className={
                                    'flex flex-col items-start gap-1 px-2.5 py-2 rounded-lg border text-[11px] transition-colors text-left ' +
                                    (active
                                        ? 'border-emerald-500 bg-emerald-500/10 text-theme-text-primary'
                                        : 'border-theme-border text-theme-text-primary hover:border-emerald-500/60')
                                }
                            >
                                <svg className="w-3.5 h-3.5 text-theme-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <circle cx="12" cy="12" r="9"/>
                                    <path strokeLinecap="round" strokeLinejoin="round" d={cat.icon}/>
                                </svg>
                                <span className="leading-tight">{cat.label}</span>
                            </button>
                        )
                    })}
                </div>
                <button
                    type="button"
                    onClick={onOpenModal}
                    disabled={!selected}
                    className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 text-white text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-600"
                >
                    Apri segnalazione
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </button>
            </div>
        </section>
    )
}

/* ---------- Documentazione obbligatoria (col 2) ---------- */

function DocumentazioneCard({ onOpenModal }: { onOpenModal: () => void }) {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 flex flex-col">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Documentazione obbligatoria</h3>
            <p className="text-[11px] text-theme-text-muted mb-3">
                Allega prove a supporto della segnalazione. Senza documenti il caso non viene processato.
            </p>
            <button
                type="button"
                onClick={onOpenModal}
                className="flex-1 rounded-xl border-2 border-dashed border-theme-border bg-theme-bg-primary px-4 py-6 text-center hover:border-emerald-500/60 transition-colors"
            >
                <svg className="w-6 h-6 mx-auto text-theme-text-muted mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16v-2a4 4 0 014-4h10a4 4 0 014 4v2M12 4v12m0 0l-4-4m4 4l4-4"/>
                </svg>
                <span className="block text-xs text-theme-text-primary font-medium">Carica documenti</span>
                <span className="block text-[11px] text-theme-text-muted">Trascina file qui o clicca per selezionare</span>
                <span className="block text-[10px] text-theme-text-muted mt-1">PDF, PNG, JPG · max 10 MB</span>
            </button>
            <ul className="mt-3 space-y-1 text-[10px] text-theme-text-muted">
                <li className="flex items-center gap-1.5"><Dot/> Verbale di polizia o incidente</li>
                <li className="flex items-center gap-1.5"><Dot/> Foto del veicolo / del danno</li>
                <li className="flex items-center gap-1.5"><Dot/> Ricevute, contratto, fattura</li>
            </ul>
        </section>
    )
}

function Dot() {
    return <span className="w-1 h-1 rounded-full bg-theme-text-muted shrink-0"/>
}

/* ---------- Stato segnalazione (col 3) ---------- */

function StatoSegnalazioneCard({ events }: { events: RecentEvent[] }) {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 flex flex-col">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Stato segnalazione</h3>
            {events.length === 0 ? (
                <div className="flex-1 grid place-items-center text-center py-6">
                    <div>
                        <span className="w-10 h-10 mx-auto grid place-items-center rounded-full bg-theme-bg-tertiary text-theme-text-muted mb-2">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z"/>
                            </svg>
                        </span>
                        <p className="text-xs text-theme-text-primary">In attesa</p>
                        <p className="text-[10px] text-theme-text-muted">Nessuna segnalazione attiva su questo cliente.</p>
                    </div>
                </div>
            ) : (
                <ul className="space-y-2 mt-2">
                    {events.slice(0, 4).map(e => {
                        const t = statusTone(e.status)
                        return (
                            <li key={e.id} className="flex items-start justify-between gap-2 text-[11px]">
                                <div className="min-w-0">
                                    <p className="text-theme-text-primary truncate">{e.headline}</p>
                                    <p className="text-[10px] text-theme-text-muted truncate">{e.type.replace(/_/g, ' ')} · {formatDate(e.created_at)}</p>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ${t}`}>
                                    {e.status.replace(/_/g, ' ')}
                                </span>
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}

function statusTone(status: string): string {
    const s = status.toUpperCase()
    if (s.includes('APPROV')) return 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
    if (s.includes('REJECT') || s.includes('FAIL')) return 'border-red-500/40 text-red-500 bg-red-500/10'
    if (s.includes('REVIEW') || s.includes('PEND')) return 'border-amber-500/40 text-amber-500 bg-amber-500/10'
    return 'border-theme-border text-theme-text-muted bg-theme-bg-tertiary'
}

/* ---------- Sidebar: Mobility Trust Status ---------- */

function MobilityTrustStatus({ client, stats, riskBand, riskLevel }: {
    client: EMTNClient
    stats: EMTNStats | null
    riskBand: 'green' | 'yellow' | 'red'
    riskLevel?: number
}) {
    const level = typeof riskLevel === 'number' ? riskLevel : (riskBand === 'green' ? 1 : riskBand === 'yellow' ? 2 : 3)
    const tone = riskBand === 'green'
        ? { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-500', label: 'Storico positivo' }
        : riskBand === 'yellow'
            ? { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500', label: 'Da monitorare' }
            : { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-500', label: 'Allerta attiva' }
    const totalRentals = (stats?.total_rentals as number) ?? 0
    const recent = (stats?.recent_rentals as number) ?? 0
    const events = (stats?.reported_events as number) ?? 0

    return (
        <section className={`rounded-2xl border ${tone.border} ${tone.bg} p-4`}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Trust Status</h3>
                <span className={`text-[10px] font-semibold ${tone.text}`}>{tone.label}</span>
            </div>
            <div className="flex items-center gap-3 mb-3">
                <span className={`w-12 h-12 grid place-items-center rounded-full ${tone.text} bg-theme-bg-secondary border ${tone.border}`}>
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z"/>
                    </svg>
                </span>
                <div>
                    <p className="text-xl font-bold text-theme-text-primary leading-none">Livello {level}</p>
                    <p className={`text-xs ${tone.text} mt-1`}>{tone.label}</p>
                </div>
            </div>
            <p className="text-[11px] text-theme-text-muted mb-3">
                Affidabilità calcolata sul comportamento storico, eventi segnalati e indicatori di rischio AI.
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{totalRentals}</p>
                    <p className="text-[10px] text-theme-text-muted">Noleggi registrati</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{recent}</p>
                    <p className="text-[10px] text-theme-text-muted">Recenti</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{events}</p>
                    <p className="text-[10px] text-theme-text-muted">Eventi negativi</p>
                </div>
            </div>
            <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
                <span className="text-theme-text-muted">Cliente fidelizzato da</span>
                <span className="text-theme-text-primary font-medium tabular-nums">
                    {formatDate(client.customer_since) || formatDate(client.created_at) || '—'}
                </span>
            </div>
        </section>
    )
}

/* ---------- Sidebar: Attivita\' recenti ---------- */

function AttivitaRecenti({ events, dr7History }: { events: RecentEvent[]; dr7History?: DR7History }) {
    const items: Array<{ id: string; title: string; subtitle: string; tone: 'ok' | 'warn' | 'info' }> = []
    if (dr7History?.lastBookingDate) {
        items.push({
            id: 'last-booking',
            title: 'Noleggio completato',
            subtitle: formatDate(dr7History.lastBookingDate) || '—',
            tone: 'ok',
        })
    }
    if (dr7History && dr7History.totalBookings > 0) {
        items.push({
            id: 'total-bookings',
            title: 'Noleggio registrato automaticamente',
            subtitle: `${dr7History.totalBookings} totali · ${dr7History.regularBookings} regolari`,
            tone: 'ok',
        })
    }
    if (dr7History && dr7History.unpaidDamageTotal + dr7History.unpaidPenaltyTotal > 0) {
        items.push({
            id: 'unpaid',
            title: 'Importo non saldato',
            subtitle: `€ ${(dr7History.unpaidDamageTotal + dr7History.unpaidPenaltyTotal).toFixed(2)}`,
            tone: 'warn',
        })
    }
    events.slice(0, 4 - items.length).forEach(e => items.push({
        id: e.id,
        title: e.headline,
        subtitle: `${e.type.replace(/_/g, ' ')} · ${formatDate(e.created_at) || ''}`,
        tone: 'info',
    }))

    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Attività recenti</h3>
                <button type="button" className="text-[10px] text-theme-text-muted hover:text-theme-text-primary">Vedi tutte</button>
            </div>
            {items.length === 0 ? (
                <p className="text-[11px] text-theme-text-muted italic">Nessuna attività registrata.</p>
            ) : (
                <ul className="space-y-2">
                    {items.map(it => (
                        <li key={it.id} className="flex items-start gap-2">
                            <span className={
                                'mt-1 w-1.5 h-1.5 rounded-full shrink-0 ' +
                                (it.tone === 'ok' ? 'bg-emerald-500' : it.tone === 'warn' ? 'bg-amber-500' : 'bg-blue-500')
                            }/>
                            <div className="min-w-0 flex-1">
                                <p className="text-xs text-theme-text-primary truncate">{it.title}</p>
                                <p className="text-[10px] text-theme-text-muted truncate">{it.subtitle}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

/* ---------- Sidebar: Alert sistema ---------- */

function AlertSistema({ events }: { events: RecentEvent[] }) {
    const reviewing = events.filter(e => /REVIEW|PEND/i.test(e.status)).length
    const rejected = events.filter(e => /REJECT|FAIL/i.test(e.status)).length
    const alerts = [
        {
            tone: reviewing > 0 ? 'warn' : 'ok' as 'warn' | 'ok',
            label: reviewing > 0 ? `${reviewing} segnalazioni in revisione` : 'Nessuna revisione attiva',
        },
        {
            tone: rejected > 0 ? 'err' : 'ok' as 'err' | 'ok',
            label: rejected > 0 ? `${rejected} eventi negativi recenti` : 'Nessun evento negativo recente',
        },
        { tone: 'ok' as const, label: 'Tutti i documenti verificati' },
        { tone: 'info' as const, label: 'Aggiornamento score in corso' },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Alert sistema</h3>
                <button type="button" className="text-[10px] text-theme-text-muted hover:text-theme-text-primary">Vedi tutti</button>
            </div>
            <ul className="space-y-2">
                {alerts.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-theme-text-primary">
                        <span className={
                            'w-4 h-4 grid place-items-center rounded-full shrink-0 ' +
                            (a.tone === 'ok' ? 'bg-emerald-500/15 text-emerald-500'
                                : a.tone === 'warn' ? 'bg-amber-500/15 text-amber-500'
                                : a.tone === 'err' ? 'bg-red-500/15 text-red-500'
                                : 'bg-blue-500/15 text-blue-400')
                        }>
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                {a.tone === 'err'
                                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                                    : <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                                }
                            </svg>
                        </span>
                        <span className="truncate">{a.label}</span>
                    </li>
                ))}
            </ul>
        </section>
    )
}

/* ---------- Sidebar: Automazioni attive ---------- */

const AUTOMATIONS = [
    { key: 'verify-doc', label: 'Verifica documenti automatica', defaultOn: true },
    { key: 'match', label: 'Match cliente automatico', defaultOn: true },
    { key: 'notify', label: 'Notifica eventi negativi', defaultOn: true },
    { key: 'log', label: 'Log audit GDPR', defaultOn: true },
    { key: 'score', label: 'Aggiornamento score giornaliero', defaultOn: true },
]

function AutomazioniAttive() {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Automazioni attive</h3>
                <span className="text-[10px] text-emerald-500 font-semibold">Tutte attive</span>
            </div>
            <ul className="space-y-2">
                {AUTOMATIONS.map(a => (
                    <li key={a.key} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-theme-text-primary">{a.label}</span>
                        <Switch defaultOn={a.defaultOn} />
                    </li>
                ))}
            </ul>
        </section>
    )
}

function Switch({ defaultOn }: { defaultOn?: boolean }) {
    const [on, setOn] = useState(!!defaultOn)
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => setOn(v => !v)}
            className={
                'relative inline-flex h-4 w-7 items-center rounded-full transition-colors ' +
                (on ? 'bg-emerald-500' : 'bg-theme-bg-tertiary')
            }
        >
            <span
                className={
                    'inline-block h-3 w-3 transform rounded-full bg-white transition-transform ' +
                    (on ? 'translate-x-3.5' : 'translate-x-0.5')
                }
            />
        </button>
    )
}

/* ---------- Footer conformità ---------- */

function ConformitaFooter() {
    const badges = [
        'Sicurezza',
        'Hosting UE',
        'Log monitorati',
        'GDPR Compliant',
        'Accesso Verificato',
    ]
    return (
        <footer className="mt-2 pt-3 border-t border-theme-border flex flex-wrap items-center gap-3 text-[10px]">
            <div className="flex items-center gap-2">
                <span className="w-5 h-5 grid place-items-center rounded bg-blue-600 text-white">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 7h7l-5.5 4.5L18 22l-6-4-6 4 1.5-8.5L2 9h7z"/>
                    </svg>
                </span>
                <span className="text-theme-text-muted">European Mobility Trust Network — accesso operatore verificato</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mx-auto">
                {badges.map(b => (
                    <span key={b} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-theme-border text-[10px] text-theme-text-muted bg-theme-bg-secondary">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
                        {b}
                    </span>
                ))}
            </div>
            <a href="#" className="text-[10px] text-theme-text-muted hover:text-theme-text-primary">Regolamento EMTN →</a>
        </footer>
    )
}

/* ---------- Clienti con danni (lista DR7 sotto la barra di ricerca) ---------- */

function ClientiConDanniCard({ clients, loading, error, onSelect }: {
    clients: ClientWithDamages[]
    loading: boolean
    error: string | null
    onSelect: (cf: string) => void
}) {
    const totalUnpaid = clients.reduce((s, c) => s + c.unpaid_damage_total + c.unpaid_penalty_total, 0)
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
            <div className="border-l-4 border-red-500 px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="w-5 h-5 grid place-items-center text-red-500">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                            </svg>
                        </span>
                        <h3 className="text-sm font-semibold">Clienti DR7 con danni o penali registrati</h3>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                        <span className="text-theme-text-muted">{clients.length} clienti</span>
                        {totalUnpaid > 0 && (
                            <span className="text-red-400 font-semibold">
                                Non pagato: €{totalUnpaid.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        )}
                    </div>
                </div>
                <p className="text-[11px] text-theme-text-muted mb-3">
                    Lista dei clienti che hanno almeno un danno o una penale nei record DR7. Clicca un cliente per aprirlo nella rete EMTN.
                </p>
                {loading && (
                    <p className="text-[11px] text-theme-text-muted italic py-2">Caricamento clienti…</p>
                )}
                {error && (
                    <div className="px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-[11px] text-red-400">{error}</div>
                )}
                {!loading && !error && clients.length === 0 && (
                    <p className="text-[11px] text-theme-text-muted italic py-2">
                        Nessun cliente con danni o penali nei record DR7.
                    </p>
                )}
                {!loading && !error && clients.length > 0 && (
                    <div className="overflow-x-auto -mx-4 px-4">
                        <table className="w-full text-left text-[11px]">
                            <thead>
                                <tr className="text-theme-text-muted uppercase tracking-wider text-[10px]">
                                    <th className="px-2 py-2 font-semibold">Cliente</th>
                                    <th className="px-2 py-2 font-semibold">Codice Fiscale</th>
                                    <th className="px-2 py-2 font-semibold text-right">Danni</th>
                                    <th className="px-2 py-2 font-semibold text-right">Penali</th>
                                    <th className="px-2 py-2 font-semibold text-right">Non pagato</th>
                                    <th className="px-2 py-2 font-semibold">Ultimo evento</th>
                                    <th className="px-2 py-2 font-semibold">Veicolo</th>
                                    <th className="px-2 py-2 font-semibold"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {clients.map(c => {
                                    const unpaid = c.unpaid_damage_total + c.unpaid_penalty_total
                                    return (
                                        <tr
                                            key={c.codice_fiscale}
                                            className="border-t border-theme-border hover:bg-theme-bg-tertiary cursor-pointer transition-colors"
                                            onClick={() => onSelect(c.codice_fiscale)}
                                        >
                                            <td className="px-2 py-2 text-theme-text-primary font-medium">{c.customer_name || '—'}</td>
                                            <td className="px-2 py-2 font-mono text-theme-text-muted">{c.codice_fiscale}</td>
                                            <td className="px-2 py-2 text-right text-theme-text-primary tabular-nums">{c.damages_count}</td>
                                            <td className="px-2 py-2 text-right text-theme-text-primary tabular-nums">{c.penalties_count}</td>
                                            <td className={'px-2 py-2 text-right font-semibold tabular-nums ' + (unpaid > 0 ? 'text-red-400' : 'text-emerald-500')}>
                                                {unpaid > 0
                                                    ? `€${unpaid.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                    : 'Saldato'}
                                            </td>
                                            <td className="px-2 py-2 text-theme-text-muted">{formatDate(c.last_event_date) || '—'}</td>
                                            <td className="px-2 py-2 text-theme-text-muted truncate max-w-[160px]">{c.last_vehicle || '—'}</td>
                                            <td className="px-2 py-2 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onSelect(c.codice_fiscale) }}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-theme-border text-[10px] font-semibold text-theme-text-primary hover:bg-theme-bg-hover"
                                                >
                                                    Apri
                                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    )
}

/* ---------- helpers ---------- */

function formatDate(value?: string | null): string {
    if (!value) return ''
    const d = new Date(value)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function monthsSince(value?: string | null): number {
    if (!value) return 0
    const d = new Date(value)
    if (isNaN(d.getTime())) return 0
    const ms = Date.now() - d.getTime()
    return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24 * 30)))
}
