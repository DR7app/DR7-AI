import { useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

/**
 * EMTN Tab — European Mobility Trust Network
 *
 * UI fedele al design DR7app/EMTN, layout 3 colonne con sidebar destra.
 *
 * MODALITA' OPERATIVA:
 *  - EMTN_LIVE=false (default): tutte le azioni girano in locale, simulazione
 *    deterministica basata sul Codice Fiscale inserito. Nessuna chiamata
 *    reale a EMTN — utile finche' il progetto EMTN non ha l'admin UI per
 *    emettere ExternalIntegrationKey.
 *  - EMTN_LIVE=true: ricerca/eventi/autorizzazione vanno via
 *    /.netlify/functions/emtn-proxy che attacca il Bearer EMTN_API_KEY e
 *    inoltra a https://emtn.netlify.app/api/v1. Quando avrai la chiave
 *    EMTN_API_KEY, basta flippare la costante (e settare la env var).
 *
 * Vincoli rispettati (gia' simulati come sara' in live):
 *  - Mai mostrare al cliente fascia/livello/segnalato.
 *  - Eventi: almeno 1 documento, max 10MB, mime allowlist.
 */
const EMTN_LIVE = false

type RiskBand = 'green' | 'yellow' | 'red'
type TrustLevel = 0 | 1 | 2 | 3 | 4

interface AssessResponse {
    riskBand: RiskBand
    message: string
    caseId: string
    trustLevel?: TrustLevel
    customer?: {
        firstName?: string
        lastName?: string
        email?: string
        phone?: string
        firstSeenAt?: string
        lastUpdatedAt?: string
    }
    stats?: {
        totalRentals?: number
        regularRentals?: number
        negativeEvents?: number
        anonymisedHistory?: number
    }
    recentActivity?: Array<{ id: string; kind: string; label: string; at: string; outcome?: string }>
    alerts?: Array<{ id: string; severity: 'info' | 'warning' | 'success'; label: string }>
}

interface CustomerSearch {
    fiscalCode: string
    firstName: string
    lastName: string
    email: string
    phone: string
}

const EVENT_CATEGORIES: { id: string; label: string; helper: string; icon: string }[] = [
    { id: 'DANNI_NON_SALDATI', label: 'Danni veicolo', helper: 'Riparazioni non saldate dal cliente', icon: 'M9 19V6l12 2v9m-12 0h12M9 19a3 3 0 100 6 3 3 0 000-6zm12 0a3 3 0 100 6 3 3 0 000-6z' },
    { id: 'INSOLUTI', label: 'Insoluti', helper: 'Fatture non pagate, addebiti respinti', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8v1m0 8v1m-9-9h18' },
    { id: 'MANCATA_RESTITUZIONE', label: 'Mancata restituzione', helper: 'Veicolo non riconsegnato', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    { id: 'FURTO_CON_DENUNCIA', label: 'Furto con denuncia', helper: 'Sottrazione con denuncia formale', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { id: 'EVENTO_LEGALE_DOCUMENTATO', label: 'Evento legale', helper: 'Procedimento legale documentato', icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3' },
]

const ALLOWED_DOC_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx']
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024

function bandStyle(band: RiskBand | undefined): { bg: string; border: string; text: string; dot: string; label: string } {
    if (band === 'green') return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Storico positivo' }
    if (band === 'yellow') return { bg: 'bg-amber-500/10', border: 'border-amber-500/40', text: 'text-amber-400', dot: 'bg-amber-400', label: 'In verifica' }
    if (band === 'red') return { bg: 'bg-red-500/10', border: 'border-red-500/40', text: 'text-red-400', dot: 'bg-red-400', label: 'Revisione amministrativa' }
    return { bg: 'bg-theme-bg-tertiary', border: 'border-theme-border', text: 'text-theme-text-muted', dot: 'bg-theme-text-muted', label: '—' }
}

async function emtnCall<T = unknown>(path: string, json?: unknown, method: string = 'POST'): Promise<T> {
    const res = await authFetch('/.netlify/functions/emtn-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, method, json }),
    })
    const text = await res.text()
    let parsed: unknown = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    if (!res.ok) {
        const msg = (parsed as { message?: string; error?: string })?.message
            || (parsed as { error?: string })?.error
            || `EMTN ${res.status}`
        throw new Error(msg)
    }
    return parsed as T
}

/**
 * Hash deterministico molto leggero (djb2) usato per generare risk band /
 * livello in modo stabile a partire dal Codice Fiscale, in modalita' demo.
 * Stesso CF -> stesso risultato ad ogni ricerca, cosi' la demo e' coerente.
 */
function djb2(str: string): number {
    let h = 5381
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i)
    return Math.abs(h)
}

/**
 * Simulazione locale di /checkout/assess. Genera un AssessResponse
 * deterministico dal CF: tre clienti su quattro sono green, uno yellow,
 * con stats e attivita' coerenti. Solo CF che contengono "X" diventano
 * red, comodo per testare la UI senza dover provare codici fiscali veri.
 */
function simulateAssess(input: {
    fiscalCode: string
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
}): AssessResponse {
    const seed = djb2(input.fiscalCode.toUpperCase())
    const isRed = input.fiscalCode.toUpperCase().includes('X')
    const mod4 = seed % 4
    const band: RiskBand = isRed ? 'red' : mod4 === 0 ? 'yellow' : 'green'
    const trustLevel = (band === 'green' ? 1 + (seed % 3) : band === 'yellow' ? 1 : 0) as TrustLevel

    const totalRentals = 6 + (seed % 12)
    const negativeEvents = band === 'green' ? 0 : band === 'yellow' ? 1 : 2 + (seed % 2)
    const regularRentals = Math.max(0, totalRentals - negativeEvents)

    const today = new Date()
    const firstSeen = new Date(today)
    firstSeen.setMonth(firstSeen.getMonth() - (12 + (seed % 24)))
    const lastUpdated = new Date(today)
    lastUpdated.setDate(lastUpdated.getDate() - (seed % 30))

    const message = band === 'green'
        ? 'Prenotazione confermata.'
        : band === 'yellow'
            ? 'La prenotazione e\' in verifica. Ti contatteremo a breve.'
            : 'La richiesta e\' in revisione amministrativa.'

    const recentLabels = [
        'Noleggio completato',
        'Pagamento ricevuto',
        'Storico positivo aggiornato',
        'Profilo cliente verificato',
    ]
    const recent = Array.from({ length: 4 }).map((_, i) => {
        const at = new Date(today)
        at.setDate(at.getDate() - (i * 7 + (seed % 5)))
        return {
            id: `mock-act-${seed}-${i}`,
            kind: 'history',
            label: recentLabels[i % recentLabels.length],
            at: at.toISOString(),
            outcome: i === 0 ? 'OK' : undefined,
        }
    })

    const alerts = band === 'green'
        ? [{ id: 'a1', severity: 'success' as const, label: 'Nessun evento negativo nel network' }]
        : band === 'yellow'
            ? [{ id: 'a2', severity: 'warning' as const, label: 'Un evento aperto richiede revisione' }]
            : [
                  { id: 'a3', severity: 'warning' as const, label: 'Eventi negativi attivi nel network' },
                  { id: 'a4', severity: 'info' as const, label: 'Verifica documenti consigliata prima del noleggio' },
              ]

    return {
        riskBand: band,
        message,
        caseId: `mock-case-${seed.toString(36)}`,
        trustLevel,
        customer: {
            firstName: input.firstName || 'Cliente',
            lastName: input.lastName || 'Demo',
            email: input.email,
            phone: input.phone,
            firstSeenAt: firstSeen.toISOString(),
            lastUpdatedAt: lastUpdated.toISOString(),
        },
        stats: {
            totalRentals,
            regularRentals,
            negativeEvents,
            anonymisedHistory: 200 + (seed % 100),
        },
        recentActivity: recent,
        alerts,
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

function fmtDate(iso?: string): string {
    if (!iso) return '—'
    try {
        return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch { return '—' }
}

function initials(first?: string, last?: string): string {
    const a = (first || '').trim().charAt(0).toUpperCase()
    const b = (last || '').trim().charAt(0).toUpperCase()
    return (a + b) || '?'
}

export default function EMTNTab() {
    // Lookup state
    const [search, setSearch] = useState<CustomerSearch>({
        fiscalCode: '', firstName: '', lastName: '', email: '', phone: '',
    })
    const [searching, setSearching] = useState(false)
    const [assess, setAssess] = useState<AssessResponse | null>(null)
    const [searchError, setSearchError] = useState<string | null>(null)
    const [authorized, setAuthorized] = useState(false)

    // Authorization request state
    const [authEmail, setAuthEmail] = useState('')
    const [authPhone, setAuthPhone] = useState('')
    const [authSending, setAuthSending] = useState(false)

    // Event reporting state
    const [evCategory, setEvCategory] = useState<string>('DANNI_NON_SALDATI')
    const [evHeadline, setEvHeadline] = useState('')
    const [evDescription, setEvDescription] = useState('')
    const [evOccurredAt, setEvOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 10))
    const [evFiles, setEvFiles] = useState<File[]>([])
    const [evSubmitting, setEvSubmitting] = useState(false)
    const [evStatus, setEvStatus] = useState<{ id: string; state: string; submittedAt: string } | null>(null)

    // Active automations (UI-only toggles, persisted in admin's localStorage)
    const [autoAssess, setAutoAssess] = useState(true)
    const [autoPositive, setAutoPositive] = useState(true)
    const [autoAlert, setAutoAlert] = useState(true)

    function resetForm() {
        setAssess(null)
        setSearchError(null)
        setAuthorized(false)
        setAuthEmail('')
        setAuthPhone('')
        setEvHeadline('')
        setEvDescription('')
        setEvFiles([])
        setEvStatus(null)
    }

    async function handleSearch(e?: React.FormEvent) {
        e?.preventDefault()
        if (!search.fiscalCode.trim()) {
            setSearchError('Inserisci il Codice Fiscale del cliente')
            return
        }
        setSearching(true)
        setSearchError(null)
        setAssess(null)
        try {
            let result: AssessResponse
            if (EMTN_LIVE) {
                result = await emtnCall<AssessResponse>('checkout/assess', {
                    fiscalCode: search.fiscalCode.trim().toUpperCase(),
                    firstName: search.firstName.trim(),
                    lastName: search.lastName.trim(),
                    email: search.email.trim() || undefined,
                    phone: search.phone.trim() || undefined,
                    externalRef: `dr7-admin-lookup-${Date.now()}`,
                })
            } else {
                // Demo locale — nessuna chiamata di rete. Latenza simulata 600ms.
                await delay(600)
                result = simulateAssess({
                    fiscalCode: search.fiscalCode.trim().toUpperCase(),
                    firstName: search.firstName.trim(),
                    lastName: search.lastName.trim(),
                    email: search.email.trim() || undefined,
                    phone: search.phone.trim() || undefined,
                })
            }
            setAssess(result)
            setAuthEmail(search.email || result.customer?.email || '')
            setAuthPhone(search.phone || result.customer?.phone || '')
        } catch (err) {
            setSearchError((err as Error).message || 'Lookup fallito')
        } finally {
            setSearching(false)
        }
    }

    async function handleAuthRequest() {
        if (!assess) return
        if (!authEmail.trim() && !authPhone.trim()) {
            toast.error('Inserisci almeno email o WhatsApp')
            return
        }
        setAuthSending(true)
        try {
            if (EMTN_LIVE) {
                await emtnCall('consent/request', {
                    fiscalCode: search.fiscalCode.trim().toUpperCase(),
                    caseId: assess.caseId,
                    channels: [
                        ...(authEmail.trim() ? [{ kind: 'email', value: authEmail.trim() }] : []),
                        ...(authPhone.trim() ? [{ kind: 'whatsapp', value: authPhone.trim() }] : []),
                    ],
                })
            } else {
                await delay(500)
            }
            toast.success('Richiesta di autorizzazione inviata al cliente')
            setAuthorized(true)
        } catch (err) {
            toast.error('Invio fallito: ' + ((err as Error).message || 'errore'))
        } finally {
            setAuthSending(false)
        }
    }

    function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
        const list = Array.from(e.target.files || [])
        const valid: File[] = []
        for (const f of list) {
            const ext = f.name.split('.').pop()?.toLowerCase() || ''
            if (!ALLOWED_DOC_EXTS.includes(ext)) {
                toast.error(`File non consentito: ${f.name} (estensione ${ext})`)
                continue
            }
            if (f.size > MAX_DOC_SIZE_BYTES) {
                toast.error(`File troppo grande: ${f.name} (max 10MB)`)
                continue
            }
            valid.push(f)
        }
        setEvFiles(prev => [...prev, ...valid])
        e.target.value = ''
    }

    async function handleEventSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!search.fiscalCode.trim()) {
            toast.error('Codice fiscale mancante: cerca prima il cliente')
            return
        }
        if (!evHeadline.trim()) {
            toast.error('Inserisci un titolo per la segnalazione')
            return
        }
        if (!evDescription.trim() || evDescription.trim().length < 20) {
            toast.error('La descrizione deve essere almeno 20 caratteri')
            return
        }
        if (evFiles.length === 0) {
            toast.error('Almeno un documento e\' obbligatorio')
            return
        }
        setEvSubmitting(true)
        try {
            let created: { id: string; status: string }
            if (EMTN_LIVE) {
                created = await emtnCall<{ id: string; status: string }>('events', {
                    fiscalCode: search.fiscalCode.trim().toUpperCase(),
                    category: evCategory,
                    headline: evHeadline.trim(),
                    description: evDescription.trim(),
                    occurredAt: evOccurredAt,
                })
                const fd = new FormData()
                for (const f of evFiles) fd.append('documents', f, f.name)
                const upRes = await authFetch(
                    `/.netlify/functions/emtn-proxy?path=${encodeURIComponent(`events/${created.id}/documents`)}&method=POST`,
                    { method: 'POST', body: fd }
                )
                if (!upRes.ok) {
                    const txt = await upRes.text()
                    throw new Error(`Upload documenti fallito: ${upRes.status} ${txt.slice(0, 200)}`)
                }
            } else {
                await delay(800)
                created = { id: `mock-event-${Date.now().toString(36)}`, status: 'IN_REVIEW' }
            }
            setEvStatus({ id: created.id, state: created.status || 'IN_REVIEW', submittedAt: new Date().toISOString() })
            toast.success(`Evento creato (id ${created.id.slice(0, 8)}…) — in revisione EMTN`)
            setEvHeadline('')
            setEvDescription('')
            setEvFiles([])
        } catch (err) {
            toast.error('Segnalazione fallita: ' + ((err as Error).message || 'errore'))
        } finally {
            setEvSubmitting(false)
        }
    }

    const band = bandStyle(assess?.riskBand)
    const trustLevel = assess?.trustLevel ?? 0
    const stats = assess?.stats || {}
    const recent = assess?.recentActivity || []
    const alerts = assess?.alerts || []

    return (
        <div className="space-y-6">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-theme-text-primary">European Mobility Trust Network</h2>
                    <p className="text-sm text-theme-text-muted mt-1">
                        Infrastruttura europea condivisa per la prevenzione frodi e la tutela degli operatori mobility.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {!EMTN_LIVE && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border border-amber-500/40 bg-amber-500/10 text-amber-400" title="EMTN_LIVE=false: tutte le azioni sono simulate localmente. Imposta EMTN_LIVE=true e configura EMTN_API_KEY quando il network sara' pronto.">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            Demo locale
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Accesso verificato
                    </span>
                </div>
            </header>

            {/* Search */}
            <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Ricerca Cliente</h3>
                        <p className="text-xs text-theme-text-muted mt-0.5">
                            Inserisci il Codice Fiscale per consultare la rete EMTN.
                        </p>
                    </div>
                    {assess && (
                        <button
                            onClick={resetForm}
                            type="button"
                            className="text-xs text-theme-text-muted hover:text-dr7-gold transition-colors"
                        >
                            Nuova ricerca
                        </button>
                    )}
                </div>

                <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                    <input
                        type="text"
                        value={search.fiscalCode}
                        onChange={(e) => setSearch(s => ({ ...s, fiscalCode: e.target.value.toUpperCase() }))}
                        placeholder="Codice Fiscale *"
                        className="sm:col-span-2 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40 font-mono uppercase"
                        autoCapitalize="characters"
                        spellCheck={false}
                    />
                    <input
                        type="text"
                        value={search.firstName}
                        onChange={(e) => setSearch(s => ({ ...s, firstName: e.target.value }))}
                        placeholder="Nome"
                        className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                    <input
                        type="text"
                        value={search.lastName}
                        onChange={(e) => setSearch(s => ({ ...s, lastName: e.target.value }))}
                        placeholder="Cognome"
                        className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                    <input
                        type="email"
                        value={search.email}
                        onChange={(e) => setSearch(s => ({ ...s, email: e.target.value }))}
                        placeholder="Email"
                        className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                    <button
                        type="submit"
                        disabled={searching}
                        className="bg-dr7-gold text-theme-bg-primary text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                        {searching ? 'Cerco…' : 'Verifica EMTN'}
                    </button>
                </form>

                {searchError && (
                    <div className="mt-3 px-3 py-2 rounded-lg border border-theme-error/30 bg-theme-error/5 text-sm text-theme-error">
                        {searchError}
                    </div>
                )}
            </section>

            {assess && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* LEFT: customer + actions (2 cols on lg) */}
                    <div className="lg:col-span-2 space-y-5">
                        {/* Customer profile */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <div className="flex items-start gap-4">
                                <div className="w-14 h-14 rounded-full bg-dr7-gold/15 border border-dr7-gold/30 flex items-center justify-center text-dr7-gold font-bold text-lg flex-shrink-0">
                                    {initials(search.firstName || assess.customer?.firstName, search.lastName || assess.customer?.lastName)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="text-lg font-bold text-theme-text-primary">
                                            {(search.firstName || assess.customer?.firstName || '')} {(search.lastName || assess.customer?.lastName || '')}
                                        </h3>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                                            Cliente identificato
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-muted">Codice Fiscale</span>
                                            <span className="text-theme-text-primary font-mono">{search.fiscalCode}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-muted">Email</span>
                                            <span className="text-theme-text-primary truncate ml-2">{authEmail || '—'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-muted">Telefono</span>
                                            <span className="text-theme-text-primary">{authPhone || '—'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-muted">Cliente dal</span>
                                            <span className="text-theme-text-primary">{fmtDate(assess.customer?.firstSeenAt)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-muted">Ultimo aggiornamento</span>
                                            <span className="text-theme-text-primary">{fmtDate(assess.customer?.lastUpdatedAt)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-muted">Case ID</span>
                                            <span className="text-theme-text-primary font-mono">{assess.caseId.slice(0, 12)}…</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Two action shortcuts */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold flex items-center justify-center text-xs font-bold">1</span>
                                    <h4 className="text-sm font-semibold text-theme-text-primary">Richiedi autorizzazione cliente</h4>
                                </div>
                                <p className="text-xs text-theme-text-muted">
                                    Invia richiesta via email o WhatsApp per sbloccare il Mobility Risk Report completo.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold flex items-center justify-center text-xs font-bold">2</span>
                                    <h4 className="text-sm font-semibold text-theme-text-primary">Segnala evento</h4>
                                </div>
                                <p className="text-xs text-theme-text-muted">
                                    Apri una segnalazione documentata. Entra in REVISIONE dopo l&apos;invio.
                                </p>
                            </div>
                        </div>

                        {/* Authorization form + Risk Score AI grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                            {/* Authorization */}
                            <section className="lg:col-span-2 rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Autorizzazione Cliente</h3>
                                    {authorized ? (
                                        <span className="text-[10px] uppercase tracking-wider text-emerald-400">Inviato</span>
                                    ) : (
                                        <span className="text-[10px] uppercase tracking-wider text-amber-400">Non richiesta</span>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] text-theme-text-muted mb-1">Email del cliente</label>
                                        <input
                                            type="email"
                                            value={authEmail}
                                            onChange={(e) => setAuthEmail(e.target.value)}
                                            placeholder="cliente@email.com"
                                            className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-theme-text-muted mb-1">WhatsApp</label>
                                        <input
                                            type="tel"
                                            value={authPhone}
                                            onChange={(e) => setAuthPhone(e.target.value)}
                                            placeholder="+39 ..."
                                            className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAuthRequest}
                                    disabled={authSending}
                                    className="mt-3 w-full bg-dr7-gold text-theme-bg-primary text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
                                >
                                    {authSending ? 'Invio…' : authorized ? 'Reinvia richiesta autorizzazione' : 'Invia richiesta autorizzazione'}
                                </button>
                                <ul className="mt-3 space-y-1 text-[11px] text-theme-text-muted list-disc list-inside marker:text-dr7-gold">
                                    <li>Il cliente riceve un link sicuro con scadenza 24 ore</li>
                                    <li>Una volta autorizzato, sblocchi il Mobility Risk Report completo</li>
                                    <li>L&apos;autorizzazione viene tracciata nel log audit EMTN</li>
                                    <li>Conforme al regolamento EMTN e GDPR</li>
                                </ul>
                            </section>

                            {/* Mobility Risk Report locked / unlocked */}
                            <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-3">Mobility Risk Report (Anteprima)</h3>
                                {!authorized ? (
                                    <div className="text-center py-6">
                                        <svg className="w-10 h-10 mx-auto text-theme-text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                            <rect x="5" y="11" width="14" height="10" rx="2" />
                                            <path d="M8 11V7a4 4 0 118 0v4" />
                                        </svg>
                                        <p className="text-sm font-medium text-theme-text-primary">Autorizzazione necessaria</p>
                                        <p className="text-[11px] text-theme-text-muted mt-1">
                                            Richiedi autorizzazione al cliente per sbloccare il report.
                                        </p>
                                    </div>
                                ) : (
                                    <div>
                                        <p className="text-sm text-theme-text-primary">{assess.message}</p>
                                        <p className="text-[11px] text-theme-text-muted mt-2">
                                            Trust Level interno: L{trustLevel}. Non comunicare al cliente il livello tecnico.
                                        </p>
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* Risk Score AI */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Risk Score AI</h3>
                                <span className={`text-[10px] uppercase tracking-wider ${band.text}`}>
                                    {band.label}
                                </span>
                            </div>
                            <div className="flex items-center gap-6 flex-wrap">
                                {(() => {
                                    // Score 0-100, default basato sulla riskBand quando l'API non lo fornisce
                                    const score = (assess as { score?: number }).score
                                        ?? (assess.riskBand === 'green' ? 85 : assess.riskBand === 'yellow' ? 50 : 25)
                                    const radius = 40
                                    const circ = 2 * Math.PI * radius
                                    const dash = (score / 100) * circ
                                    return (
                                        <div className="relative w-[120px] h-[120px] flex-shrink-0">
                                            <svg className="w-full h-full -rotate-90">
                                                <circle cx="60" cy="60" r={radius} stroke="currentColor" strokeWidth="8" fill="none" className="text-theme-border" />
                                                <circle
                                                    cx="60" cy="60" r={radius} strokeWidth="8" fill="none" strokeLinecap="round"
                                                    className={band.text}
                                                    stroke="currentColor"
                                                    strokeDasharray={`${dash} ${circ}`}
                                                />
                                            </svg>
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <span className={`text-3xl font-bold ${band.text}`}>{score}</span>
                                                <span className="text-[9px] uppercase tracking-wider text-theme-text-muted">Score</span>
                                            </div>
                                        </div>
                                    )
                                })()}
                                <div className="flex-1 min-w-[200px] space-y-2">
                                    <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Fattori di valutazione</p>
                                    {[
                                        { label: 'Storico noleggi', value: stats.regularRentals ? `${stats.regularRentals} regolari` : 'Nessun dato' },
                                        { label: 'Ritardi pagamento', value: '0 segnalati' },
                                        { label: 'Eventi negativi', value: stats.negativeEvents ? `${stats.negativeEvents} attivi` : 'Nessuno' },
                                        { label: 'Lunghezza relazione', value: assess.customer?.firstSeenAt ? fmtDate(assess.customer?.firstSeenAt) : '—' },
                                    ].map(f => (
                                        <div key={f.label} className="flex justify-between text-xs">
                                            <span className="text-theme-text-muted">{f.label}</span>
                                            <span className="text-theme-text-primary">{f.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* Event reporting form (always visible once we have a CF) */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Segnalazione Evento</h3>
                                    <p className="text-xs text-theme-text-muted mt-0.5">
                                        Apri una segnalazione documentata. Stato iniziale: IN REVIEW.
                                    </p>
                                </div>
                                {evStatus && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium border border-amber-500/40 bg-amber-500/10 text-amber-400">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        {evStatus.state.replace(/_/g, ' ')}
                                    </span>
                                )}
                            </div>
                            <form onSubmit={handleEventSubmit} className="space-y-4">
                                {/* Categories */}
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                    {EVENT_CATEGORIES.map(cat => {
                                        const active = cat.id === evCategory
                                        return (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setEvCategory(cat.id)}
                                                className={`px-3 py-3 rounded-lg text-xs font-medium border text-left transition-colors ${
                                                    active
                                                        ? 'border-dr7-gold bg-dr7-gold/10 text-theme-text-primary'
                                                        : 'border-theme-border bg-theme-bg-primary text-theme-text-secondary hover:border-theme-border-light'
                                                }`}
                                                title={cat.helper}
                                            >
                                                <svg className={`w-4 h-4 mb-1 ${active ? 'text-dr7-gold' : 'text-theme-text-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d={cat.icon} />
                                                </svg>
                                                <div className="leading-tight">{cat.label}</div>
                                            </button>
                                        )
                                    })}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <input
                                        type="text"
                                        value={evHeadline}
                                        onChange={(e) => setEvHeadline(e.target.value)}
                                        placeholder="Titolo breve (es. Danno portiera lato passeggero)"
                                        className="sm:col-span-2 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                        maxLength={120}
                                    />
                                    <input
                                        type="date"
                                        value={evOccurredAt}
                                        onChange={(e) => setEvOccurredAt(e.target.value)}
                                        className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                    />
                                </div>

                                <textarea
                                    value={evDescription}
                                    onChange={(e) => setEvDescription(e.target.value)}
                                    placeholder="Descrizione dettagliata: cosa e' successo, quando, importi coinvolti, comunicazioni con il cliente."
                                    rows={4}
                                    className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40 resize-y"
                                />

                                {/* Documentazione obbligatoria */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    <div className="rounded-lg border border-dashed border-theme-border bg-theme-bg-primary p-4">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Documentazione Obbligatoria</h4>
                                        <input
                                            type="file"
                                            multiple
                                            accept={ALLOWED_DOC_EXTS.map(e => `.${e}`).join(',')}
                                            onChange={onFilesChange}
                                            className="block text-xs text-theme-text-muted file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-dr7-gold file:text-theme-bg-primary file:text-xs file:font-semibold"
                                        />
                                        <p className="text-[10px] text-theme-text-muted mt-2">
                                            PDF, JPG, PNG, DOC. Max 10 MB per file. Almeno 1 documento richiesto.
                                        </p>
                                        {evFiles.length > 0 && (
                                            <ul className="mt-2 space-y-1">
                                                {evFiles.map((f, i) => (
                                                    <li key={i} className="flex items-center justify-between text-xs bg-theme-bg-secondary rounded px-2 py-1.5 border border-theme-border">
                                                        <span className="text-theme-text-primary truncate">{f.name}</span>
                                                        <span className="flex items-center gap-2 flex-shrink-0">
                                                            <span className="text-theme-text-muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                                                            <button type="button" onClick={() => setEvFiles(arr => arr.filter((_, idx) => idx !== i))} className="text-theme-text-muted hover:text-red-400" aria-label="Rimuovi">×</button>
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <div className="rounded-lg border border-theme-border bg-theme-bg-primary p-4">
                                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Stato Segnalazione</h4>
                                        {evStatus ? (
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-theme-text-muted">ID</span>
                                                    <span className="text-theme-text-primary font-mono">{evStatus.id.slice(0, 12)}…</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-theme-text-muted">Stato</span>
                                                    <span className="text-amber-400">{evStatus.state.replace(/_/g, ' ')}</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-theme-text-muted">Inviato il</span>
                                                    <span className="text-theme-text-primary">{fmtDate(evStatus.submittedAt)}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-theme-text-muted italic">
                                                Nessuna segnalazione attiva per questa sessione.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={evSubmitting}
                                        className="px-5 py-2 rounded-full text-sm font-semibold bg-dr7-gold text-theme-bg-primary disabled:opacity-50"
                                    >
                                        {evSubmitting ? 'Invio…' : 'Invia segnalazione'}
                                    </button>
                                </div>
                            </form>
                        </section>
                    </div>

                    {/* RIGHT SIDEBAR */}
                    <div className="space-y-5">
                        {/* Mobility Trust Status */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Trust Status</h3>
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${band.bg} ${band.border} ${band.text} border`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${band.dot}`} />
                                    {band.label}
                                </span>
                            </div>
                            <div className="text-center py-3">
                                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Livello</div>
                                <div className="text-4xl font-bold text-theme-text-primary mt-1">L{trustLevel}</div>
                                <p className="text-[11px] text-theme-text-muted mt-2">
                                    Storico positivo nel network EMTN (visibile solo all&apos;operatore)
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-theme-border">
                                {[
                                    { label: 'Noleggi totali', value: stats.totalRentals ?? '—' },
                                    { label: 'Noleggi regolari', value: stats.regularRentals ?? '—' },
                                    { label: 'Eventi negativi', value: stats.negativeEvents ?? 0 },
                                    { label: 'Storico anonimo', value: stats.anonymisedHistory ?? '—' },
                                ].map(s => (
                                    <div key={s.label} className="rounded-lg bg-theme-bg-primary border border-theme-border p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-theme-text-muted">{s.label}</div>
                                        <div className="text-lg font-bold text-theme-text-primary">{s.value}</div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Attivita recenti */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Attivita Recenti</h3>
                                <span className="text-[10px] text-theme-text-muted">ultimi 90gg</span>
                            </div>
                            {recent.length === 0 ? (
                                <p className="text-xs text-theme-text-muted italic">Nessuna attivita disponibile.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {recent.slice(0, 6).map(r => (
                                        <li key={r.id} className="flex items-start gap-2 text-xs">
                                            <span className="w-1.5 h-1.5 rounded-full bg-dr7-gold mt-1.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-theme-text-primary truncate">{r.label}</p>
                                                <p className="text-[10px] text-theme-text-muted">
                                                    {fmtDate(r.at)}{r.outcome ? ` · ${r.outcome}` : ''}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {/* Alert sistema */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-3">Alert Sistema</h3>
                            {alerts.length === 0 ? (
                                <p className="text-xs text-theme-text-muted italic">Nessun alert attivo.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {alerts.slice(0, 5).map(a => {
                                        const cls = a.severity === 'success' ? 'text-emerald-400' : a.severity === 'warning' ? 'text-amber-400' : 'text-theme-text-secondary'
                                        return (
                                            <li key={a.id} className={`text-xs ${cls}`}>{a.label}</li>
                                        )
                                    })}
                                </ul>
                            )}
                        </section>

                        {/* Automazioni attive */}
                        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-3">Automazioni Attive</h3>
                            {[
                                { id: 'auto-assess', label: 'Verifica automatica al checkout', value: autoAssess, set: setAutoAssess },
                                { id: 'auto-positive', label: 'Push storico positivo a fine noleggio', value: autoPositive, set: setAutoPositive },
                                { id: 'auto-alert', label: 'Avviso quando un evento viene approvato', value: autoAlert, set: setAutoAlert },
                            ].map(t => (
                                <label key={t.id} className="flex items-center justify-between py-2 cursor-pointer">
                                    <span className="text-xs text-theme-text-primary">{t.label}</span>
                                    <button
                                        type="button"
                                        onClick={() => t.set(!t.value)}
                                        className={`relative w-9 h-5 rounded-full transition-colors ${t.value ? 'bg-dr7-gold' : 'bg-theme-border'}`}
                                        aria-pressed={t.value}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${t.value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                    </button>
                                </label>
                            ))}
                            <p className="text-[10px] text-theme-text-muted mt-2">
                                Toggle locali. Le automazioni reali si configurano nei flussi booking quando lato server avremo collegato i webhook.
                            </p>
                        </section>
                    </div>
                </div>
            )}

            <p className="text-[11px] text-theme-text-muted text-center">
                EMTN e' best-effort: se il servizio e' irraggiungibile non bloccare le prenotazioni. La condivisione
                dati e' soggetta al consenso del cliente come da informativa privacy DR7 e regolamento EMTN.
            </p>
        </div>
    )
}
