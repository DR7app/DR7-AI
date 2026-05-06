/**
 * EMTNTab — modulo EMTN dentro DR7 admin (redesign v2).
 *
 * Layout a 3 colonne: header + tab strip + dashboard a griglia (8/4) +
 * footer con badge di conformita\'. Tutte le viste secondarie restano
 * placeholder: la vista "Ricerca Cliente" e\' la home.
 *
 * Hard rules invariate:
 *   - Ricerca solo con CF valido (gated da EMTNSearch).
 *   - Mobility Risk Report visibile solo dopo OTP verified.
 *   - Inline auth form e segnalazione delegano ai modali esistenti per
 *     mantenere il flusso server-side gia\' validato.
 */
import { useState } from 'react'
import EMTNSearch, { type EMTNSearchPayload } from './emtn/EMTNSearch'
import EMTNAuthorizationModal from './emtn/EMTNAuthorizationModal'
import EMTNEventReportModal from './emtn/EMTNEventReportModal'
import { authFetch } from '../../../utils/authFetch'

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
    { key: 'mie-segnalazioni', label: 'Le mie segnalazioni' },
    { key: 'audit', label: 'Audit & Log' },
    { key: 'regolamento', label: 'Regolamento EMTN' },
]

export default function EMTNTab() {
    const [activeView, setActiveView] = useState<EMTNView>('ricerca')

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
        <div className="space-y-4">
            <PageHeader />

            <TabStrip
                activeView={activeView}
                onChange={setActiveView}
                canExport={!!data?.reportUnlocked}
            />

            {activeView === 'ricerca' && (
                <RicercaView
                    data={data}
                    searching={searching}
                    error={error}
                    onSearch={runSearch}
                    onOpenAuth={() => setAuthOpen(true)}
                    onOpenReport={() => setReportOpen(true)}
                />
            )}

            {activeView !== 'ricerca' && <PlaceholderView label={TABS.find(t => t.key === activeView)?.label || ''} />}

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
                    <h2 className="text-lg sm:text-xl font-bold text-theme-text-primary leading-tight">
                        European Mobility Trust Network <span className="text-theme-text-muted font-medium">(EMTN)</span>
                    </h2>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                        Infrastruttura europea integrata per la prevenzione rischi e la tutela degli operatori mobility.
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
                    Accesso verificato
                </span>
                <span className="text-theme-text-muted">Operatore Area Lazio</span>
                <span className="w-7 h-7 grid place-items-center rounded-full bg-rose-500 text-white font-semibold text-[11px]">MR</span>
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
                                ? 'border-dr7-gold text-theme-text-primary'
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

/* ---------- Ricerca view (dashboard principale) ---------- */

function RicercaView({ data, searching, error, onSearch, onOpenAuth, onOpenReport }: {
    data: SearchResponse | null
    searching: boolean
    error: string | null
    onSearch: (p: EMTNSearchPayload) => Promise<void> | void
    onOpenAuth: () => void
    onOpenReport: () => void
}) {
    if (!data) {
        return (
            <section className="space-y-3">
                <EMTNSearch onSearch={onSearch} searching={searching} error={error} />
                <p className="text-[11px] text-theme-text-muted text-center">
                    Inserisci un Codice Fiscale per consultare la rete EMTN. Tutte le ricerche sono tracciate.
                </p>
            </section>
        )
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-4">
                <ClienteHeaderCard client={data.client} />
                <ActionCards
                    reportUnlocked={data.reportUnlocked}
                    onOpenAuth={onOpenAuth}
                    onOpenReport={onOpenReport}
                />
                <RiskReportSection unlocked={data.reportUnlocked} message={data.message} />
                <AutorizzazioneClienteCard
                    defaultEmail={data.client.email || ''}
                    defaultPhone={data.client.phone || ''}
                    onOpenModal={onOpenAuth}
                />
                <SegnalazioneEventoCard onOpenModal={onOpenReport} />
            </div>

            <aside className="lg:col-span-4 space-y-4">
                <MobilityTrustStatus
                    client={data.client}
                    stats={data.stats}
                    riskBand={data.riskBand}
                    riskScore={data.riskScore}
                    riskLevel={data.riskLevel}
                />
                <AttivitaRecenti events={data.recentEvents} dr7History={data.dr7History} />
                <AlertSistema />
                <StatoSegnalazioni events={data.recentEvents} />
                <InformazioniLegali />
            </aside>
        </div>
    )
}

/* ---------- Customer header card ---------- */

function ClienteHeaderCard({ client }: { client: EMTNClient }) {
    const initials = ((client.nome?.[0] || '') + (client.cognome?.[0] || '')).toUpperCase() || 'CL'
    const fullName = [client.nome, client.cognome].filter(Boolean).join(' ') || 'Cliente'
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-start gap-4 flex-wrap">
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-500 grid place-items-center text-base font-bold border border-emerald-500/30">
                        {initials}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-500 font-semibold">Cliente verificato</span>
                </div>
                <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
                    <div className="col-span-2">
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Cliente</p>
                        <p className="text-sm font-semibold text-theme-text-primary truncate">{fullName}</p>
                        <p className="text-[11px] font-mono text-theme-text-muted">{client.codice_fiscale}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Data di registrazione</p>
                        <p className="text-sm text-theme-text-primary">{formatDate(client.created_at)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Ultimo controllo</p>
                        <p className="text-sm text-theme-text-primary">{formatDate(client.last_seen_at) || formatDate(new Date().toISOString())}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Email</p>
                        <p className="text-xs text-theme-text-primary truncate">{client.email || '—'}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Telefono</p>
                        <p className="text-xs text-theme-text-primary">{client.phone || '—'}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Cliente nel network</p>
                        <p className="text-xs text-theme-text-primary">{formatDate(client.customer_since) || '—'}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Fonte registrazione</p>
                        <p className="text-xs text-theme-text-primary">{client.source || 'DR7'}</p>
                    </div>
                </div>
            </div>
        </section>
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
                className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-left hover:border-dr7-gold transition-colors"
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold flex items-center justify-center text-xs font-bold">1</span>
                        <h4 className="text-sm font-semibold text-theme-text-primary">Richiedi autorizzazione cliente</h4>
                    </div>
                    <svg className="w-4 h-4 text-theme-text-muted shrink-0 mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
                <p className="text-xs text-theme-text-muted">
                    Invia OTP via email o WhatsApp. Sblocca il Mobility Risk Report dettagliato.
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
                className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 text-left hover:border-dr7-gold transition-colors"
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold flex items-center justify-center text-xs font-bold">2</span>
                        <h4 className="text-sm font-semibold text-theme-text-primary">Segnala evento</h4>
                    </div>
                    <svg className="w-4 h-4 text-theme-text-muted shrink-0 mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
                <p className="text-xs text-theme-text-muted">
                    Apri segnalazione documentata, allega prove e invia il caso in revisione.
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"/>
                    <span className="text-amber-500">Stato iniziale: in revisione</span>
                </div>
            </button>
        </div>
    )
}

/* ---------- Mobility Risk Report ---------- */

function RiskReportSection({ unlocked, message }: { unlocked: boolean; message: string }) {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-theme-text-primary">Mobility Risk Report</h3>
                <span className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ' +
                    (unlocked
                        ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                        : 'border-amber-500/40 text-amber-500 bg-amber-500/10')
                }>
                    {unlocked ? 'Disponibile' : 'Bloccato'}
                </span>
            </div>
            {!unlocked ? (
                <>
                    <div className="flex items-center gap-3 py-3 border-y border-theme-border">
                        <span className="w-8 h-8 grid place-items-center rounded-full bg-theme-bg-tertiary text-theme-text-muted">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <rect x="5" y="11" width="14" height="10" rx="2"/>
                                <path d="M8 11V7a4 4 0 118 0v4"/>
                            </svg>
                        </span>
                        <div>
                            <p className="text-sm font-medium text-theme-text-primary">Report non disponibile</p>
                            <p className="text-[11px] text-theme-text-muted">
                                Per visualizzare il Mobility Risk Report devi prima richiedere l&apos;autorizzazione del cliente.
                            </p>
                        </div>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Cosa vedrai dopo l&apos;autorizzazione</p>
                        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-theme-text-muted">
                            <li className="flex items-center gap-1.5"><Dot/> Storico contratti completi</li>
                            <li className="flex items-center gap-1.5"><Dot/> Eventi segnalati</li>
                            <li className="flex items-center gap-1.5"><Dot/> Risk score in dettaglio</li>
                            <li className="flex items-center gap-1.5"><Dot/> Segnalazioni in revisione</li>
                            <li className="flex items-center gap-1.5"><Dot/> Cronologia attività interventi</li>
                        </ul>
                    </div>
                </>
            ) : (
                <p className="text-xs text-theme-text-primary">{message}</p>
            )}
        </section>
    )
}

function Dot() {
    return <span className="w-1 h-1 rounded-full bg-theme-text-muted shrink-0"/>
}

/* ---------- AUTORIZZAZIONE CLIENTE inline ---------- */

function AutorizzazioneClienteCard({ defaultEmail, defaultPhone, onOpenModal }: {
    defaultEmail: string
    defaultPhone: string
    onOpenModal: () => void
}) {
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Autorizzazione cliente</h3>
                <span className="text-[10px] text-theme-text-muted">Non autorizzato</span>
            </div>
            <p className="text-xs text-theme-text-muted mb-3">
                Inserisci email e/o numero WhatsApp del cliente. L&apos;OTP arriva entro pochi secondi.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Email del cliente</label>
                    <input
                        type="email"
                        defaultValue={defaultEmail}
                        placeholder="cliente@email.com"
                        className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                </div>
                <div>
                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">WhatsApp (opzionale)</label>
                    <input
                        type="tel"
                        defaultValue={defaultPhone}
                        placeholder="+39 ..."
                        className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                </div>
            </div>
            <button
                type="button"
                onClick={onOpenModal}
                className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-dr7-gold text-theme-bg-primary text-sm font-semibold rounded-lg px-4 py-2 hover:bg-dr7-gold/90"
            >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-6 9 6"/>
                </svg>
                Invia richiesta autorizzazione
            </button>
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-theme-text-muted">
                <li className="flex gap-2"><Dot/> Inviamo email + WhatsApp con un OTP a 6 cifre</li>
                <li className="flex gap-2"><Dot/> Il cliente comunica il codice all&apos;operatore</li>
                <li className="flex gap-2"><Dot/> Validità limitata al noleggio in corso</li>
                <li className="flex gap-2"><Dot/> Sblocca il Mobility Risk Report</li>
            </ul>
        </section>
    )
}

/* ---------- SEGNALAZIONE EVENTO inline ---------- */

const EVENT_CATEGORIES = [
    { key: 'multa', label: 'Multa stradale', icon: 'M12 8v4l3 3' },
    { key: 'incidente', label: 'Incidente', icon: 'M12 9v3m0 4h.01' },
    { key: 'ritardo', label: 'Ritardo restituzione', icon: 'M12 8v4l3 3' },
    { key: 'mancato', label: 'Mancata restituzione', icon: 'M6 6l12 12M6 18L18 6' },
    { key: 'danno', label: 'Danno legale', icon: 'M12 4v8m0 4h.01' },
    { key: 'difficoltoso', label: 'Cliente difficoltoso', icon: 'M12 14a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 0112 0v1' },
]

function SegnalazioneEventoCard({ onOpenModal }: { onOpenModal: () => void }) {
    const [selected, setSelected] = useState<string | null>(null)
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Segnalazione evento</h3>
            </div>
            <p className="text-xs text-theme-text-muted mb-3">
                Segnala un evento avvenuto durante il noleggio. La segnalazione resta in stato <span className="font-medium text-theme-text-primary">in revisione</span> fino alla validazione EMTN.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                {EVENT_CATEGORIES.map(cat => {
                    const active = selected === cat.key
                    return (
                        <button
                            key={cat.key}
                            type="button"
                            onClick={() => setSelected(cat.key)}
                            className={
                                'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors text-left ' +
                                (active
                                    ? 'border-dr7-gold bg-dr7-gold/10 text-theme-text-primary'
                                    : 'border-theme-border text-theme-text-primary hover:border-dr7-gold/60')
                            }
                        >
                            <svg className="w-4 h-4 text-theme-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <circle cx="12" cy="12" r="9"/>
                                <path strokeLinecap="round" strokeLinejoin="round" d={cat.icon}/>
                            </svg>
                            <span className="truncate">{cat.label}</span>
                        </button>
                    )
                })}
            </div>

            <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Documentazione</span>
                <span className="block rounded-xl border-2 border-dashed border-theme-border bg-theme-bg-primary px-4 py-6 text-center cursor-pointer hover:border-dr7-gold/60">
                    <svg className="w-6 h-6 mx-auto text-theme-text-muted mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16v-2a4 4 0 014-4h10a4 4 0 014 4v2M12 4v12m0 0l-4-4m4 4l4-4"/>
                    </svg>
                    <span className="block text-xs text-theme-text-primary font-medium">Carica documenti</span>
                    <span className="block text-[11px] text-theme-text-muted">Foto, verbali, ricevute (max 10 MB)</span>
                </span>
            </label>

            <button
                type="button"
                onClick={onOpenModal}
                disabled={!selected}
                className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-dr7-gold text-theme-bg-primary text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-dr7-gold/90"
            >
                Invia segnalazione evento
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
            </button>
        </section>
    )
}

/* ---------- Right column ---------- */

function MobilityTrustStatus({ client, stats, riskBand, riskScore, riskLevel }: {
    client: EMTNClient
    stats: EMTNStats | null
    riskBand: 'green' | 'yellow' | 'red'
    riskScore?: number
    riskLevel?: number
}) {
    const score = typeof riskScore === 'number' ? riskScore : (riskBand === 'green' ? 85 : riskBand === 'yellow' ? 60 : 30)
    const level = typeof riskLevel === 'number' ? riskLevel : (riskBand === 'green' ? 1 : riskBand === 'yellow' ? 2 : 3)
    const tone = riskBand === 'green'
        ? { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-500', label: 'Storico positivo', risk: 'Rischio basso' }
        : riskBand === 'yellow'
            ? { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500', label: 'Da monitorare', risk: 'Rischio medio' }
            : { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-500', label: 'Allerta attiva', risk: 'Rischio alto' }
    const totalRentals = (stats?.total_rentals as number) ?? 0
    const recent = (stats?.recent_rentals as number) ?? 0
    const events = (stats?.reported_events as number) ?? 0

    return (
        <section className={`rounded-2xl border ${tone.border} ${tone.bg} p-4`}>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Trust Status</h3>
                <span className={`text-[10px] font-semibold ${tone.text}`}>{tone.label}</span>
            </div>
            <div className="flex items-center gap-3">
                <span className={`w-12 h-12 grid place-items-center rounded-full ${tone.text} bg-theme-bg-secondary border ${tone.border}`}>
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z"/>
                    </svg>
                </span>
                <div>
                    <p className="text-lg font-bold text-theme-text-primary">Livello {level}</p>
                    <p className="text-[11px] text-theme-text-muted">Cliente {client.nome || ''} {client.cognome || ''}</p>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{totalRentals}</p>
                    <p className="text-[10px] text-theme-text-muted">Noleggi totali</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{recent}</p>
                    <p className="text-[10px] text-theme-text-muted">Recenti</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{events}</p>
                    <p className="text-[10px] text-theme-text-muted">Eventi</p>
                </div>
            </div>

            <div className="mt-4 pt-3 border-t border-theme-border">
                <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Mobility Risk Score AI</p>
                <div className="flex items-end justify-between mt-1">
                    <p className={`text-3xl font-bold ${tone.text} tabular-nums`}>{score}<span className="text-base text-theme-text-muted font-medium">/100</span></p>
                    <span className={`text-[11px] font-semibold ${tone.text}`}>{tone.risk}</span>
                </div>
                <ScoreBar score={score} band={riskBand} />
            </div>
        </section>
    )
}

function ScoreBar({ score, band }: { score: number; band: 'green' | 'yellow' | 'red' }) {
    const color = band === 'green' ? 'bg-emerald-500' : band === 'yellow' ? 'bg-amber-500' : 'bg-red-500'
    return (
        <div className="mt-2 h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }}/>
        </div>
    )
}

function AttivitaRecenti({ events, dr7History }: { events: RecentEvent[]; dr7History?: DR7History }) {
    const items: Array<{ id: string; title: string; subtitle: string; tone: 'ok' | 'warn' | 'info' }> = []
    if (dr7History?.lastBookingDate) {
        items.push({
            id: 'last-booking',
            title: 'Ultimo noleggio',
            subtitle: formatDate(dr7History.lastBookingDate) || '—',
            tone: 'ok',
        })
    }
    if (dr7History && dr7History.totalBookings > 0) {
        items.push({
            id: 'total-bookings',
            title: `${dr7History.totalBookings} noleggi totali`,
            subtitle: `${dr7History.regularBookings} regolari · ${dr7History.damages.length} danni · ${dr7History.penalties.length} penali`,
            tone: dr7History.damages.length + dr7History.penalties.length === 0 ? 'ok' : 'warn',
        })
    }
    events.slice(0, 3).forEach(e => items.push({
        id: e.id,
        title: e.headline,
        subtitle: `${e.type.replace(/_/g, ' ')} · ${formatDate(e.created_at) || ''}`,
        tone: 'info',
    }))

    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Attività recenti</h3>
                <span className="text-[10px] text-theme-text-muted">Vedi tutte</span>
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
                            <div className="min-w-0">
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

function AlertSistema() {
    const alerts = [
        { tone: 'ok' as const, label: 'Nessun alert attivo' },
        { tone: 'warn' as const, label: 'Verifica documenti in scadenza' },
        { tone: 'info' as const, label: 'Aggiornamento score in corso' },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Alert sistema</h3>
            <ul className="space-y-2">
                {alerts.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-theme-text-primary">
                        <span className={
                            'w-1.5 h-1.5 rounded-full shrink-0 ' +
                            (a.tone === 'ok' ? 'bg-emerald-500' : a.tone === 'warn' ? 'bg-amber-500' : 'bg-blue-500')
                        }/>
                        {a.label}
                    </li>
                ))}
            </ul>
        </section>
    )
}

function StatoSegnalazioni({ events }: { events: RecentEvent[] }) {
    const items = events.slice(0, 3)
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Stato delle tue segnalazioni</h3>
                <span className="text-[10px] text-theme-text-muted">Vedi tutte</span>
            </div>
            {items.length === 0 ? (
                <p className="text-[11px] text-theme-text-muted italic">Nessuna segnalazione recente.</p>
            ) : (
                <ul className="space-y-2">
                    {items.map(e => {
                        const t = statusTone(e.status)
                        return (
                            <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                    <p className="text-theme-text-primary truncate">{e.headline}</p>
                                    <p className="text-[10px] text-theme-text-muted">{e.type.replace(/_/g, ' ')}</p>
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

function InformazioniLegali() {
    const items = [
        { label: 'TOS v1.0', href: '#' },
        { label: 'Privacy', href: '#' },
        { label: 'GDPR Compliance', href: '#' },
        { label: 'Conservazione 12 mesi', href: '#' },
        { label: 'Regolamento EMTN', href: '#' },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Informazioni legali</h3>
            <ul className="grid grid-cols-2 gap-y-1 gap-x-3 text-[11px]">
                {items.map(i => (
                    <li key={i.label}>
                        <a href={i.href} className="text-theme-text-primary hover:text-dr7-gold">{i.label}</a>
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
        <footer className="mt-2 pt-3 border-t border-theme-border flex flex-wrap items-center justify-center gap-2">
            {badges.map(b => (
                <span key={b} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-theme-border text-[10px] text-theme-text-muted bg-theme-bg-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
                    {b}
                </span>
            ))}
            <span className="text-[10px] text-theme-text-muted ml-2">
                Tutte le azioni sono tracciate in <code className="font-mono">emtn_access_logs</code>.
            </span>
        </footer>
    )
}

/* ---------- helpers ---------- */

function formatDate(value?: string | null): string {
    if (!value) return ''
    const d = new Date(value)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
