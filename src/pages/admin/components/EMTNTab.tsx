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
import EMTNEventReportModal, { type ReportPrefill } from './emtn/EMTNEventReportModal'
import { authFetch } from '../../../utils/authFetch'

interface DamageEvent {
    kind: 'danno' | 'penale'
    bookingId: string
    label: string
    vehicle: string | null
    eventDate: string | null
    paidAt: string | null
    daysToPay: number | null
    amount: number
    amountPaid: number
    remaining: number
    paymentStatus: 'paid' | 'partial' | 'pending'
    fatturaNumero: string | null
    note: string | null
}

interface ClientWithDamages {
    codice_fiscale: string | null
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
    events: DamageEvent[]
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
    const [reportPrefill, setReportPrefill] = useState<ReportPrefill | null>(null)

    // Promuove un danno/penale DR7 a evento EMTN: assicura che il
    // cliente sia caricato (runSearch se manca o non corrisponde),
    // costruisce un prefill ragionato per il modale e lo apre.
    async function reportDamageAsEMTN(cf: string | null, ev: DamageEvent) {
        if (!cf) {
            alert('Questo cliente non ha un codice fiscale risolvibile: aggiungilo a customers_extended prima di segnalarlo su EMTN.')
            return
        }
        if (!data || data.client.codice_fiscale !== cf) {
            await runSearch(cf)
        }
        const fmt = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const isPenale = ev.kind === 'penale'
        // Map: il "kind" del booking_details non corrisponde 1:1 ai tipi
        // EMTN. Scelta di default sensata; l'operatore puo\' cambiarla nel modale.
        const type = isPenale ? 'INSOLVENCY' : 'UNPAID_DAMAGE'
        const headline = `${isPenale ? 'Penale' : 'Danno'} non saldato: ${ev.label}`.slice(0, 100)
        const lines = [
            `${isPenale ? 'Penale' : 'Danno'} registrato il ${formatDate(ev.eventDate) || 'data n/d'} sul veicolo ${ev.vehicle || 'n/d'}.`,
            `Importo: ${fmt(ev.amount)} · Pagato: ${fmt(ev.amountPaid)} · Residuo: ${fmt(ev.remaining)}.`,
            ev.note ? `Note interne: ${ev.note}` : null,
            `Booking di riferimento: ${ev.bookingId}.`,
        ].filter(Boolean)
        setReportPrefill({
            type,
            headline,
            description: lines.join('\n'),
            occurredAt: ev.eventDate || new Date().toISOString().slice(0, 10),
        })
        setReportOpen(true)
    }

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
                                onReportDamage={reportDamageAsEMTN}
                            />
                        )}
                        {data && (
                            <>
                                <div className="flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => { setData(null); setError(null); setCfInput('') }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border text-xs font-semibold text-theme-text-primary hover:bg-theme-bg-hover"
                                    >
                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                                        </svg>
                                        Torna alla lista
                                    </button>
                                    <span className="text-[11px] text-theme-text-muted font-mono">{data.client.codice_fiscale}</span>
                                </div>
                                <ClienteHeaderCard client={data.client} riskBand={data.riskBand} />
                                <ActionCards
                                    reportUnlocked={data.reportUnlocked}
                                    onOpenAuth={() => setAuthOpen(true)}
                                    onOpenReport={() => setReportOpen(true)}
                                />
                                <MobilityRiskReportLocked
                                    unlocked={data.reportUnlocked}
                                    onOpenAuth={() => setAuthOpen(true)}
                                />
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                    <AutorizzazioneClienteCard
                                        defaultEmail={data.client.email || ''}
                                        defaultPhone={data.client.phone || ''}
                                        onOpenModal={() => setAuthOpen(true)}
                                        authorized={data.reportUnlocked}
                                    />
                                    <SegnalazioneEventoCard onOpenModal={() => setReportOpen(true)} />
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
                                    riskScore={data.riskScore}
                                    riskLevel={data.riskLevel}
                                    dr7History={data.dr7History}
                                />
                                <AttivitaRecenti events={data.recentEvents} dr7History={data.dr7History} />
                                <AlertSistema events={data.recentEvents} />
                                <InformazioniLegali />
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
                        onClose={() => { setReportOpen(false); setReportPrefill(null) }}
                        onCreated={refresh}
                        clientId={data.client.id}
                        prefill={reportPrefill}
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

/* ---------- Mobility Risk Report (full-width locked panel) ---------- */

function MobilityRiskReportLocked({ unlocked, onOpenAuth }: { unlocked: boolean; onOpenAuth: () => void }) {
    const items = [
        { label: 'Storico contratti completi', icon: 'M3 7h18M3 12h18M3 17h18' },
        { label: 'Eventi segnalati (sospesi)', icon: 'M12 9v3m0 4h.01' },
        { label: 'Risk Score in dettaglio', icon: 'M3 18l6-6 4 4 8-8' },
        { label: 'Segnalazioni in revisione', icon: 'M12 8v4l3 3' },
        { label: 'Cronologia attività network', icon: 'M4 7h16M4 12h16M4 17h10' },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-theme-text-primary">Mobility Risk Report</h3>
                <span className={'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ' +
                    (unlocked
                        ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                        : 'border-amber-500/40 text-amber-500 bg-amber-500/10')
                }>
                    {unlocked ? 'Disponibile' : 'Bloccato'}
                </span>
            </div>
            {unlocked ? (
                <p className="text-xs text-theme-text-primary">Tutti i dati EMTN sono consultabili per la durata di questo OTP.</p>
            ) : (
                <>
                    <div className="flex flex-col items-center justify-center py-6">
                        <span className="w-12 h-12 grid place-items-center rounded-full bg-theme-bg-tertiary text-theme-text-muted mb-3">
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <rect x="5" y="11" width="14" height="10" rx="2"/>
                                <path d="M8 11V7a4 4 0 118 0v4"/>
                            </svg>
                        </span>
                        <p className="text-sm font-semibold text-theme-text-primary">Report non disponibile</p>
                        <p className="text-[11px] text-theme-text-muted text-center max-w-md mt-1">
                            Per visualizzare il Mobility Risk Report devi prima richiedere l&apos;autorizzazione del cliente.
                        </p>
                    </div>
                    <div className="pt-3 border-t border-theme-border">
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Cosa vedrai dopo l&apos;autorizzazione</p>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            {items.map(it => (
                                <div key={it.label} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-theme-border bg-theme-bg-primary">
                                    <svg className="w-3.5 h-3.5 text-theme-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d={it.icon}/>
                                    </svg>
                                    <span className="text-[11px] text-theme-text-primary truncate" title={it.label}>{it.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onOpenAuth}
                        className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 hover:underline"
                    >
                        Richiedi autorizzazione cliente
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                        </svg>
                    </button>
                </>
            )}
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
            <div className="border-l-4 border-amber-500 px-4 py-3 flex-1 flex flex-col">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Segnalazione evento</h3>
                <p className="text-[11px] text-theme-text-muted mb-3">
                    Segnala un evento avvenuto durante il noleggio. Tutte le segnalazioni sono soggette a revisione.
                </p>
                <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Tipologia evento</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
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
                                        ? 'border-amber-500 bg-amber-500/10 text-theme-text-primary'
                                        : 'border-theme-border text-theme-text-primary hover:border-amber-500/60')
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
                <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Documentazione obbligatoria</p>
                <button
                    type="button"
                    onClick={onOpenModal}
                    className="rounded-xl border-2 border-dashed border-theme-border bg-theme-bg-primary px-4 py-4 text-center hover:border-amber-500/60 transition-colors mb-3"
                >
                    <svg className="w-5 h-5 mx-auto text-theme-text-muted mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16v-2a4 4 0 014-4h10a4 4 0 014 4v2M12 4v12m0 0l-4-4m4 4l4-4"/>
                    </svg>
                    <span className="block text-xs text-theme-text-primary font-medium">Carica documenti</span>
                    <span className="block text-[10px] text-theme-text-muted">Trascina file qui o clicca per selezionare</span>
                </button>
                <button
                    type="button"
                    onClick={onOpenModal}
                    disabled={!selected}
                    className="w-full inline-flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-600"
                >
                    Invia segnalazione evento
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </button>
            </div>
        </section>
    )
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

function MobilityTrustStatus({ client, stats, riskBand, riskScore, riskLevel, dr7History }: {
    client: EMTNClient
    stats: EMTNStats | null
    riskBand: 'green' | 'yellow' | 'red'
    riskScore?: number
    riskLevel?: number
    dr7History?: DR7History
}) {
    const level = typeof riskLevel === 'number' ? riskLevel : (riskBand === 'green' ? 1 : riskBand === 'yellow' ? 2 : 3)
    const tone = riskBand === 'green'
        ? { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-500', stroke: '#10b981', label: 'Storico positivo', riskLabel: 'Rischio basso' }
        : riskBand === 'yellow'
            ? { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500', stroke: '#f59e0b', label: 'Da monitorare', riskLabel: 'Rischio medio' }
            : { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-500', stroke: '#ef4444', label: 'Allerta attiva', riskLabel: 'Rischio alto' }
    const totalRentals = (stats?.total_rentals as number) ?? dr7History?.totalBookings ?? 0
    const recent = (stats?.recent_rentals as number) ?? 0
    const negative = (stats?.negative_events as number) ?? 0
    const review = (stats?.events_under_review as number) ?? 0
    const score = typeof riskScore === 'number' ? riskScore : (riskBand === 'green' ? 85 : riskBand === 'yellow' ? 60 : 30)

    return (
        <section className={`rounded-2xl border ${tone.border} ${tone.bg} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Trust Status</h3>
                <span className={`text-[10px] font-semibold ${tone.text}`}>{tone.label}</span>
            </div>
            <div className="flex items-center gap-3">
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
            <p className="text-[11px] text-theme-text-muted">
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
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{negative}</p>
                    <p className="text-[10px] text-theme-text-muted">Eventi negativi</p>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{review}</p>
                    <p className="text-[10px] text-theme-text-muted">In revisione</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{Math.round(score * (totalRentals || 1) / 35)}</p>
                    <p className="text-[10px] text-theme-text-muted">Score noleggi</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-[10px] font-bold text-theme-text-primary tabular-nums">
                        {formatDate(dr7History?.lastBookingDate) || formatDate(client.last_seen_at) || '—'}
                    </p>
                    <p className="text-[10px] text-theme-text-muted">Ultima attività</p>
                </div>
            </div>
            <div className="pt-3 border-t border-theme-border space-y-2">
                <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Risk Score AI</h4>
                    <span className={`text-[10px] font-semibold ${tone.text}`}>{tone.riskLabel}</span>
                </div>
                <div className="flex items-center gap-3">
                    <ScoreGauge score={score} stroke={tone.stroke} />
                    <div className="flex-1">
                        <p className={`text-3xl font-bold tabular-nums leading-none ${tone.text}`}>
                            {Math.round(score)}<span className="text-base text-theme-text-muted font-medium">/100</span>
                        </p>
                        <p className="text-[11px] text-theme-text-muted mt-1">
                            Aggiornato il {formatDate(new Date().toISOString())}
                        </p>
                        <div className="mt-2 h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden">
                            <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: tone.stroke }}/>
                        </div>
                    </div>
                </div>
            </div>
            <div className="pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
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

/* ---------- Sidebar: Informazioni legali ---------- */

function InformazioniLegali() {
    const items = [
        { label: 'Privacy', href: '#', icon: 'M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4' },
        { label: 'Regolamento EMTN', href: '#', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
        { label: 'GDPR Compliance', href: '#', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
        { label: 'Hosting UE', href: '#', icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
        { label: 'Conservazione 12 mesi', href: '#', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Informazioni legali</h3>
            <ul className="space-y-1.5">
                {items.map(it => (
                    <li key={it.label}>
                        <a href={it.href} className="flex items-center gap-2 text-xs text-theme-text-primary hover:text-dr7-gold transition-colors">
                            <svg className="w-3.5 h-3.5 text-theme-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d={it.icon}/>
                            </svg>
                            <span>{it.label}</span>
                        </a>
                    </li>
                ))}
            </ul>
        </section>
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

function EventiCliente({ events, totals, onReport, canReport }: {
    events: DamageEvent[]
    totals: { paidDamage: number; unpaidDamage: number; paidPenalty: number; unpaidPenalty: number }
    onReport?: (ev: DamageEvent) => void
    canReport: boolean
}) {
    if (events.length === 0) {
        return <p className="text-[11px] text-theme-text-muted italic">Nessun dettaglio disponibile.</p>
    }
    const fmt = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider">
                <span className="text-theme-text-muted">Riepilogo</span>
                <span className="text-theme-text-primary">Danni pagati: <span className="text-emerald-500 font-semibold tabular-nums">{fmt(totals.paidDamage)}</span></span>
                <span className="text-theme-text-primary">Danni non pagati: <span className="text-red-400 font-semibold tabular-nums">{fmt(totals.unpaidDamage)}</span></span>
                <span className="text-theme-text-primary">Penali pagate: <span className="text-emerald-500 font-semibold tabular-nums">{fmt(totals.paidPenalty)}</span></span>
                <span className="text-theme-text-primary">Penali non pagate: <span className="text-red-400 font-semibold tabular-nums">{fmt(totals.unpaidPenalty)}</span></span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                    <thead>
                        <tr className="text-theme-text-muted uppercase tracking-wider text-[10px]">
                            <th className="px-2 py-1 font-semibold">Tipo</th>
                            <th className="px-2 py-1 font-semibold">Etichetta</th>
                            <th className="px-2 py-1 font-semibold">Veicolo</th>
                            <th className="px-2 py-1 font-semibold">Data evento</th>
                            <th className="px-2 py-1 font-semibold">Pagato il</th>
                            <th className="px-2 py-1 font-semibold text-right">Giorni</th>
                            <th className="px-2 py-1 font-semibold text-right">Importo</th>
                            <th className="px-2 py-1 font-semibold text-right">Pagato</th>
                            <th className="px-2 py-1 font-semibold text-right">Residuo</th>
                            <th className="px-2 py-1 font-semibold">Stato</th>
                            <th className="px-2 py-1 font-semibold">Fattura</th>
                            <th className="px-2 py-1 font-semibold">Booking</th>
                            <th className="px-2 py-1 font-semibold w-20"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.map((ev, i) => {
                            const tone =
                                ev.paymentStatus === 'paid' ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                                : ev.paymentStatus === 'partial' ? 'border-amber-500/40 text-amber-500 bg-amber-500/10'
                                : 'border-red-500/40 text-red-400 bg-red-500/10'
                            const statusLabel =
                                ev.paymentStatus === 'paid' ? 'Pagato'
                                : ev.paymentStatus === 'partial' ? 'Parziale'
                                : 'Da pagare'
                            const kindTone = ev.kind === 'danno'
                                ? 'border-red-500/40 text-red-400 bg-red-500/10'
                                : 'border-orange-500/40 text-orange-400 bg-orange-500/10'
                            const daysTone =
                                ev.daysToPay == null ? 'text-theme-text-muted'
                                : ev.daysToPay <= 7 ? 'text-emerald-500'
                                : ev.daysToPay <= 30 ? 'text-amber-500'
                                : 'text-red-400'
                            return (
                                <tr key={ev.bookingId + '-' + i} className="border-t border-theme-border">
                                    <td className="px-2 py-1">
                                        <span className={'px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ' + kindTone}>
                                            {ev.kind === 'danno' ? 'Danno' : 'Penale'}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1 text-theme-text-primary">
                                        <div className="truncate max-w-[260px]" title={ev.label}>{ev.label}</div>
                                        {ev.note && <div className="text-[10px] text-theme-text-muted truncate max-w-[260px]" title={ev.note}>{ev.note}</div>}
                                    </td>
                                    <td className="px-2 py-1 text-theme-text-muted truncate max-w-[140px]">{ev.vehicle || '—'}</td>
                                    <td className="px-2 py-1 text-theme-text-muted">{formatDate(ev.eventDate) || '—'}</td>
                                    <td className="px-2 py-1 text-theme-text-muted">
                                        {ev.paidAt
                                            ? formatDate(ev.paidAt)
                                            : (ev.paymentStatus === 'pending'
                                                ? <span className="italic text-red-400">Non pagato</span>
                                                : <span className="italic">—</span>)}
                                    </td>
                                    <td className={'px-2 py-1 text-right tabular-nums ' + daysTone}
                                        title={ev.daysToPay != null ? `Giorni intercorsi tra evento e saldo` : 'Data pagamento non disponibile'}>
                                        {ev.daysToPay != null ? `${ev.daysToPay}g` : '—'}
                                    </td>
                                    <td className="px-2 py-1 text-right text-theme-text-primary font-semibold tabular-nums">{fmt(ev.amount)}</td>
                                    <td className="px-2 py-1 text-right text-emerald-500 tabular-nums">{fmt(ev.amountPaid)}</td>
                                    <td className={'px-2 py-1 text-right font-semibold tabular-nums ' + (ev.remaining > 0 ? 'text-red-400' : 'text-emerald-500')}>{fmt(ev.remaining)}</td>
                                    <td className="px-2 py-1">
                                        <span className={'px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ' + tone}>{statusLabel}</span>
                                    </td>
                                    <td className="px-2 py-1 font-mono text-[10px] text-theme-text-muted">{ev.fatturaNumero || '—'}</td>
                                    <td className="px-2 py-1 font-mono text-[10px] text-theme-text-muted">{ev.bookingId.slice(0, 8)}…</td>
                                    <td className="px-2 py-1 text-right">
                                        {onReport && (
                                            <button
                                                type="button"
                                                disabled={!canReport}
                                                onClick={() => onReport(ev)}
                                                title={canReport
                                                    ? `Segnala questo ${ev.kind === 'danno' ? 'danno' : 'penale'} alla rete EMTN`
                                                    : 'CF mancante: aggiungilo a customers_extended prima di segnalare'}
                                                className={
                                                    'inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-semibold ' +
                                                    (canReport
                                                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                                        : 'border-theme-border text-theme-text-muted cursor-not-allowed')
                                                }
                                            >
                                                Segnala EMTN
                                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                                                </svg>
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function ClientiConDanniCard({ clients, loading, error, onSelect, onReportDamage }: {
    clients: ClientWithDamages[]
    loading: boolean
    error: string | null
    onSelect: (cf: string) => void
    onReportDamage: (cf: string | null, ev: DamageEvent) => void
}) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    function toggle(key: string) {
        setExpanded(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }
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
                                    <th className="px-2 py-2 font-semibold w-6"></th>
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
                                {clients.map((c, idx) => {
                                    const unpaid = c.unpaid_damage_total + c.unpaid_penalty_total
                                    const cf = c.codice_fiscale
                                    const rowKey = cf || c.customer_email || c.customer_name || `row-${idx}`
                                    const canOpen = !!cf
                                    const isOpen = expanded.has(rowKey)
                                    return (
                                        <>
                                            <tr
                                                key={rowKey}
                                                className={
                                                    'border-t border-theme-border transition-colors ' +
                                                    (isOpen ? 'bg-theme-bg-tertiary' : 'hover:bg-theme-bg-tertiary')
                                                }
                                            >
                                                <td className="px-2 py-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggle(rowKey)}
                                                        aria-label={isOpen ? 'Comprimi dettagli' : 'Espandi dettagli'}
                                                        className="w-5 h-5 grid place-items-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover"
                                                    >
                                                        <svg className={'w-3 h-3 transition-transform ' + (isOpen ? 'rotate-90' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                                                        </svg>
                                                    </button>
                                                </td>
                                                <td className="px-2 py-2 text-theme-text-primary font-medium cursor-pointer" onClick={() => toggle(rowKey)}>
                                                    {c.customer_name || c.customer_email || '—'}
                                                </td>
                                                <td className="px-2 py-2 font-mono text-theme-text-muted">
                                                    {cf || <span className="italic text-amber-500">CF mancante</span>}
                                                </td>
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
                                                        disabled={!canOpen}
                                                        onClick={(e) => { e.stopPropagation(); if (canOpen && cf) onSelect(cf) }}
                                                        title={canOpen ? 'Apri nella rete EMTN' : 'CF mancante: aggiungilo a customers_extended per aprire la lookup EMTN'}
                                                        className={
                                                            'inline-flex items-center gap-1 px-2 py-1 rounded border border-theme-border text-[10px] font-semibold ' +
                                                            (canOpen
                                                                ? 'text-theme-text-primary hover:bg-theme-bg-hover'
                                                                : 'text-theme-text-muted cursor-not-allowed')
                                                        }
                                                    >
                                                        Apri
                                                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                                                        </svg>
                                                    </button>
                                                </td>
                                            </tr>
                                            {isOpen && (
                                                <tr key={rowKey + '-events'} className="bg-theme-bg-tertiary/40">
                                                    <td colSpan={9} className="px-3 py-3">
                                                        <EventiCliente
                                                            events={c.events}
                                                            totals={{
                                                                paidDamage: c.paid_damage_total,
                                                                unpaidDamage: c.unpaid_damage_total,
                                                                paidPenalty: c.paid_penalty_total,
                                                                unpaidPenalty: c.unpaid_penalty_total,
                                                            }}
                                                            canReport={!!cf}
                                                            onReport={(ev) => onReportDamage(cf, ev)}
                                                        />
                                                    </td>
                                                </tr>
                                            )}
                                        </>
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

