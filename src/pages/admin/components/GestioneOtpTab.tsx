/**
 * GestioneOtpTab
 *
 * Top-level admin tab listing every OTP-protected limitation override.
 * Admin can toggle is_required per row → useLimitationOverride hook
 * auto-bypasses disabled codes on next request. Realtime sub keeps
 * every open browser session in sync.
 *
 * Redesign (May 2026): KPI strip + card grid + decorative reminders panel,
 * inspired by the Centrale OTP screenshot. Same data model + same actions
 * as the original list view — only the visual layout changed.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { reloadOtpConfig } from '../../../utils/otpConfigCache'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'

interface OtpRow {
    id: string
    label: string
    reason: string
    used_in: string
    is_required: boolean
    sort_order: number
    updated_at?: string | null
}

// Chi può bypassare l'OTP per la tab Gestione OTP: direzione (failsafe valerio/ilenia)
// oppure developer (failsafe ophe). Gestito via `role:direzione` / `role:developer`
// in admins.permissions.

// Decorative-only data: the reminders panel is a visual shell so the
// page matches the design mock; wire to a real source when the
// reminders feature ships.
const STATIC_PROMEMORIA: { title: string; detail: string; when: string; tone: 'gold' | 'blue' | 'rose' }[] = [
    { title: 'Verifica scadenza OTP attivi', detail: 'Controllo settimanale delle regole OTP', when: 'Ogni lunedì · 09:00', tone: 'gold' },
    { title: 'Audit accessi direzione', detail: 'Riepilogo accessi gated agli OTP della direzione', when: 'Ogni 1° del mese', tone: 'blue' },
    { title: 'Backup configurazione OTP', detail: 'Snapshot delle regole salvato su storage interno', when: 'Settimanale', tone: 'rose' },
]

const TONE_CLASSES: Record<'gold' | 'blue' | 'rose', { dot: string; pill: string }> = {
    gold: { dot: 'bg-dr7-gold', pill: 'bg-dr7-gold/10 text-dr7-gold border-dr7-gold/30' },
    blue: { dot: 'bg-blue-400', pill: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
    rose: { dot: 'bg-rose-400', pill: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
}

function formatRelative(iso?: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    const diff = Date.now() - d.getTime()
    const min = Math.round(diff / 60000)
    if (min < 1) return 'adesso'
    if (min < 60) return `${min} min fa`
    const hr = Math.round(min / 60)
    if (hr < 24) return `${hr}h fa`
    const day = Math.round(hr / 24)
    if (day < 30) return `${day}g fa`
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

export default function GestioneOtpTab() {
    const { adminEmail, loading: roleLoading, hasRole } = useAdminRole()
    const isSuperadmin = hasRole('direzione') || hasRole('developer')
    const override = useLimitationOverride()

    const [tabUnlocked, setTabUnlocked] = useState(false)

    useEffect(() => {
        if (roleLoading) return
        if (isSuperadmin) {
            setTabUnlocked(true)
            return
        }
        if (!override.hasOverride('gestione_otp_access')) {
            override.requestOverride('gestione_otp_access', 'Accesso alla Gestione OTP richiede autorizzazione direzionale')
        }
    }, [roleLoading, isSuperadmin]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (override.hasOverride('gestione_otp_access')) {
            setTabUnlocked(true)
        }
    }, [override])

    const pendingAction = useRef<null | { code: string; run: () => Promise<void> | void }>(null)

    function gated(code: string, message: string, run: () => Promise<void> | void) {
        pendingAction.current = { code, run }
        override.requestOverride(code, message)
    }

    useEffect(() => {
        const p = pendingAction.current
        if (p && override.hasOverride(p.code)) {
            pendingAction.current = null
            ;(async () => {
                try { await p.run() } finally {
                    await override.consumeOverride(p.code)
                }
            })()
        }
    }, [override])

    const [rows, setRows] = useState<OtpRow[]>([])
    const [loading, setLoading] = useState(true)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [editing, setEditing] = useState<Record<string, Partial<OtpRow>>>({})
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
    const [newRow, setNewRow] = useState<{ id: string; label: string; used_in: string; reason: string }>({
        id: '', label: '', used_in: '', reason: '',
    })

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data, error } = await supabase
                .from('system_otp_overrides')
                .select('*')
                .order('sort_order', { ascending: true })
            if (cancelled) return
            if (error) {
                toast.error('Errore caricamento OTP: ' + error.message)
            } else {
                setRows((data || []) as OtpRow[])
            }
            setLoading(false)
        })()
        const channel = supabase
            .channel('gestione-otp-overrides')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'system_otp_overrides' }, async () => {
                const { data } = await supabase
                    .from('system_otp_overrides')
                    .select('*')
                    .order('sort_order', { ascending: true })
                if (!cancelled) setRows((data || []) as OtpRow[])
            })
            .subscribe()
        return () => { cancelled = true; supabase.removeChannel(channel) }
    }, [])

    const setField = (id: string, key: keyof OtpRow, value: OtpRow[keyof OtpRow]) => {
        setEditing(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
    }

    const valueOf = <K extends keyof OtpRow>(row: OtpRow, key: K): OtpRow[K] => {
        const e = editing[row.id]?.[key]
        return (e !== undefined ? e : row[key]) as OtpRow[K]
    }

    const isDirty = (row: OtpRow): boolean => {
        const e = editing[row.id]
        if (!e) return false
        return Object.keys(e).some(k => e[k as keyof OtpRow] !== row[k as keyof OtpRow])
    }

    const doSave = async (row: OtpRow) => {
        const e = editing[row.id]
        if (!e) return
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_otp_overrides')
            .update({ ...e, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Salvataggio fallito: ' + error.message)
            return
        }
        toast.success('Salvato')
        setRows(prev => prev.map(r => (r.id === row.id ? ({ ...r, ...e } as OtpRow) : r)))
        setEditing(prev => { const n = { ...prev }; delete n[row.id]; return n })
        await reloadOtpConfig()
    }
    const save = (row: OtpRow) => {
        gated('gestione_otp_write', `Modifica OTP "${row.label}" richiede autorizzazione direzionale`, () => doSave(row))
    }

    const doToggleRequired = async (row: OtpRow) => {
        const next = !row.is_required
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_otp_overrides')
            .update({ is_required: next, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Toggle fallito: ' + error.message)
            return
        }
        setRows(prev => prev.map(r => (r.id === row.id ? { ...r, is_required: next } : r)))
        await reloadOtpConfig()
    }
    const toggleRequired = (row: OtpRow) => {
        const verb = row.is_required ? 'Disattivare' : 'Attivare'
        gated('gestione_otp_toggle', `${verb} l'OTP "${row.label}" richiede autorizzazione direzionale`, () => doToggleRequired(row))
    }

    const slugifyId = (raw: string) =>
        raw.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)

    const doCreateNew = async () => {
        const id = slugifyId(newRow.id || newRow.label)
        if (!id) { toast.error('Inserisci un ID o una label'); return }
        if (!newRow.label.trim()) { toast.error('Inserisci una label'); return }
        if (rows.some(r => r.id === id)) { toast.error(`OTP con id "${id}" esiste già`); return }
        setCreating(true)
        const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0)
        const { error } = await supabase
            .from('system_otp_overrides')
            .insert({
                id,
                label: newRow.label.trim(),
                used_in: newRow.used_in.trim() || '—',
                reason: newRow.reason.trim() || '—',
                is_required: true,
                sort_order: maxOrder + 10,
            })
        setCreating(false)
        if (error) {
            toast.error('Creazione fallita: ' + error.message)
            return
        }
        toast.success(`OTP "${id}" creato`)
        setNewRow({ id: '', label: '', used_in: '', reason: '' })
        setShowCreate(false)
        await reloadOtpConfig()
    }
    const createNew = () => {
        gated('gestione_otp_create', `Creazione di un nuovo OTP "${newRow.label || newRow.id}" richiede autorizzazione direzionale`, doCreateNew)
    }

    const doRemoveRow = async (row: OtpRow) => {
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_otp_overrides')
            .delete()
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Eliminazione fallita: ' + error.message)
            return
        }
        toast.success('Eliminato')
        setRows(prev => prev.filter(r => r.id !== row.id))
        await reloadOtpConfig()
    }
    const removeRow = (row: OtpRow) => {
        if (!confirm(`Eliminare l'OTP "${row.label}" (${row.id})?\n\nLa limitazione corrispondente non verrà più protetta da OTP nel codice che la richiede.`)) return
        gated('gestione_otp_delete', `Eliminazione dell'OTP "${row.label}" richiede autorizzazione direzionale`, () => doRemoveRow(row))
    }

    // Derived data
    const requiredCount = rows.filter(r => r.is_required).length
    const disabledCount = rows.length - requiredCount
    const lastUpdated = useMemo(() => {
        const stamps = rows.map(r => r.updated_at).filter(Boolean) as string[]
        if (!stamps.length) return null
        return stamps.sort().slice(-1)[0]
    }, [rows])

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase()
        return rows.filter(r => {
            if (filter === 'active' && !r.is_required) return false
            if (filter === 'inactive' && r.is_required) return false
            if (!q) return true
            return (
                r.label.toLowerCase().includes(q) ||
                r.id.toLowerCase().includes(q) ||
                (r.used_in || '').toLowerCase().includes(q) ||
                (r.reason || '').toLowerCase().includes(q)
            )
        })
    }, [rows, search, filter])

    if (roleLoading) {
        return <p className="text-sm text-theme-text-muted p-6">Caricamento…</p>
    }

    if (!tabUnlocked) {
        return (
            <>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-12 text-center shadow-sm">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <h2 className="text-xl font-semibold text-theme-text-primary mb-1">Sezione protetta</h2>
                    <p className="text-sm text-theme-text-muted max-w-md mx-auto">
                        L'accesso alla Gestione OTP richiede autorizzazione direzionale. Verifica il codice ricevuto via email per continuare.
                    </p>
                    <button
                        onClick={() => override.requestOverride('gestione_otp_access', 'Accesso alla Gestione OTP richiede autorizzazione direzionale')}
                        className="mt-4 px-4 py-2 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold shadow-sm"
                    >
                        Richiedi accesso
                    </button>
                </div>
                <LimitationOverrideModal
                    isOpen={override.limitationState.isOpen}
                    limitationCode={override.limitationState.limitationCode}
                    limitationMessage={override.limitationState.limitationMessage}
                    actionContext={override.limitationState.actionContext}
                    draftSessionId={override.draftSessionId}
                    flowType={override.flowType}
                    onCancel={override.cancelLimitation}
                    onOverrideApproved={override.handleOverrideApproved}
                />
            </>
        )
    }

    return (
        <div className="space-y-6">
            <LimitationOverrideModal
                isOpen={override.limitationState.isOpen}
                limitationCode={override.limitationState.limitationCode}
                limitationMessage={override.limitationState.limitationMessage}
                actionContext={override.limitationState.actionContext}
                draftSessionId={override.draftSessionId}
                flowType={override.flowType}
                onCancel={override.cancelLimitation}
                onOverrideApproved={override.handleOverrideApproved}
            />

            {/* Hero header */}
            <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-primary p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-dr7-gold/15 text-dr7-gold flex items-center justify-center shrink-0">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-xl sm:text-2xl font-semibold text-theme-text-primary">Centrale OTP</h2>
                            <p className="text-sm text-theme-text-muted mt-1 max-w-2xl">
                                Configura quali blocchi di sistema richiedono autorizzazione OTP del direttore.
                                Disattivare un OTP fa sì che la limitazione corrispondente venga bypassata silenziosamente.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowCreate(v => !v)}
                        className="px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:opacity-90 shadow-sm shrink-0"
                    >
                        {showCreate ? 'Annulla' : '+ Nuova regola OTP'}
                    </button>
                </div>
            </div>

            {/* Email di ricezione OTP (centralina_pro_config.config.notifications.otp_recipient) */}
            <OtpRecipientField />

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard
                    label="OTP attivi"
                    value={requiredCount}
                    accent="green"
                    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}
                />
                <KpiCard
                    label="Disattivati"
                    value={disabledCount}
                    accent="amber"
                    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>}
                />
                <KpiCard
                    label="Totale configurati"
                    value={rows.length}
                    accent="blue"
                    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg>}
                />
                <KpiCard
                    label="Ultima modifica"
                    valueText={formatRelative(lastUpdated)}
                    accent="rose"
                    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
                />
            </div>

            {/* New rule form (slide down) — simplified, only 3 fields. ID is
                auto-derived from the title (slugified). Advanced controls hidden
                behind a toggle. */}
            {showCreate && (
                <div className="rounded-2xl border border-dr7-gold/40 bg-dr7-gold/5 p-5 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-theme-text-primary">Nuova regola OTP</h3>
                        <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">system_otp_overrides</span>
                    </div>

                    <div className="space-y-3">
                        <label className="block text-xs text-theme-text-muted">
                            Titolo della regola
                            <input
                                type="text"
                                value={newRow.label}
                                onChange={e => setNewRow(r => ({ ...r, label: e.target.value }))}
                                placeholder="es. Modifica dopo pagamento"
                                className="mt-1 w-full px-2.5 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                            />
                            <span className="block mt-1 text-[10px] text-theme-text-muted">
                                Lo vedrai sul popup OTP che chiede l&apos;autorizzazione.
                            </span>
                        </label>

                        <label className="block text-xs text-theme-text-muted">
                            Dove si attiva
                            <input
                                type="text"
                                value={newRow.used_in}
                                onChange={e => setNewRow(r => ({ ...r, used_in: e.target.value }))}
                                placeholder="es. Tab Prenotazioni > tasto Modifica"
                                className="mt-1 w-full px-2.5 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                            />
                            <span className="block mt-1 text-[10px] text-theme-text-muted">
                                Solo un promemoria — dove dovrebbe scattare questa regola.
                            </span>
                        </label>

                        <label className="block text-xs text-theme-text-muted">
                            Perché serve l&apos;OTP
                            <textarea
                                rows={2}
                                value={newRow.reason}
                                onChange={e => setNewRow(r => ({ ...r, reason: e.target.value }))}
                                placeholder="es. Modificare un noleggio dopo l'incasso richiede approvazione direzionale."
                                className="mt-1 w-full px-2.5 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-secondary text-sm focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                            />
                            <span className="block mt-1 text-[10px] text-theme-text-muted">
                                Spiegazione mostrata all&apos;operatore quando deve chiedere l&apos;OTP.
                            </span>
                        </label>

                        {/* Advanced: custom ID (otherwise auto-slugified from Titolo). */}
                        <details className="text-xs text-theme-text-muted">
                            <summary className="cursor-pointer select-none hover:text-theme-text-primary">Avanzato — ID tecnico (di solito non serve)</summary>
                            <input
                                type="text"
                                value={newRow.id}
                                onChange={e => setNewRow(r => ({ ...r, id: e.target.value }))}
                                placeholder={newRow.label ? `auto: ${slugifyId(newRow.label)}` : 'auto-generato dal titolo'}
                                className="mt-2 w-full px-2.5 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                            />
                            <span className="block mt-1 text-[10px] text-theme-text-muted">
                                Lasciare vuoto: il sistema lo crea dal titolo. Compilarlo solo se uno sviluppatore te lo chiede.
                            </span>
                        </details>

                        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-300">
                            <strong>Nota:</strong> creare la regola la registra nel sistema, ma serve uno sviluppatore per
                            collegarla al pulsante o all&apos;azione corrispondente nell&apos;admin. Senza quel passaggio
                            l&apos;OTP non scatterà.
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={() => { setShowCreate(false); setNewRow({ id: '', label: '', used_in: '', reason: '' }) }}
                            disabled={creating}
                            className="px-4 py-2 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={createNew}
                            disabled={creating || !newRow.label.trim()}
                            className="px-4 py-2 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {creating ? 'Creazione…' : 'Crea regola'}
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300 flex items-start gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p>
                    Disattivare un OTP riduce la sicurezza: la limitazione corrispondente verrà bypassata silenziosamente.
                    L'azione resta tracciata nel log audit (flag <code className="bg-theme-bg-tertiary px-1 rounded">limitation_override_bypassed</code>).
                </p>
            </div>

            {/* Main 2-col grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Rules grid (2/3 width) */}
                <div className="xl:col-span-2 space-y-4">
                    {/* Toolbar: search + filter */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Cerca regola, ID, modulo o motivo…"
                                className="w-full pl-9 pr-3 py-2 rounded-xl bg-theme-bg-secondary border border-theme-border text-theme-text-primary text-sm placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                            />
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted">
                                <circle cx="11" cy="11" r="8"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                        </div>
                        <div className="inline-flex rounded-xl bg-theme-bg-secondary border border-theme-border p-0.5 text-xs">
                            {(['all', 'active', 'inactive'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                                        filter === f
                                            ? 'bg-dr7-gold text-white shadow-sm'
                                            : 'text-theme-text-muted hover:text-theme-text-primary'
                                    }`}
                                >
                                    {f === 'all' ? 'Tutti' : f === 'active' ? 'Attivi' : 'Disattivati'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-8 text-center text-sm text-theme-text-muted">
                            Caricamento regole OTP…
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-300">
                            Nessuna riga in <code>system_otp_overrides</code>. Esegui la migration{' '}
                            <code className="bg-theme-bg-tertiary px-1 rounded">20260428_system_otp_overrides.sql</code> in Supabase.
                        </div>
                    ) : filteredRows.length === 0 ? (
                        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-8 text-center text-sm text-theme-text-muted">
                            Nessuna regola trovata con i filtri attuali.
                        </div>
                    ) : (
                        <ul className="space-y-3">
                            {filteredRows.map(row => {
                                const dirty = isDirty(row)
                                const saving = savingId === row.id
                                const required = valueOf(row, 'is_required')
                                return (
                                    <li
                                        key={row.id}
                                        className={`rounded-2xl border bg-theme-bg-secondary p-4 sm:p-5 transition-all hover:shadow-md ${
                                            required
                                                ? 'border-theme-border'
                                                : 'border-theme-border/60 opacity-90'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                                        required
                                                            ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                                            : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                                                    }`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${required ? 'bg-green-400' : 'bg-theme-text-muted'}`} />
                                                        {required ? 'Attivo' : 'Disattivato'}
                                                    </span>
                                                    {row.updated_at && (
                                                        <span className="text-[10px] text-theme-text-muted">aggiornato {formatRelative(row.updated_at)}</span>
                                                    )}
                                                </div>
                                                <input
                                                    type="text"
                                                    value={String(valueOf(row, 'label'))}
                                                    onChange={e => setField(row.id, 'label', e.target.value)}
                                                    className="w-full bg-transparent text-base font-semibold text-theme-text-primary border-b border-transparent focus:border-dr7-gold focus:outline-none px-0 py-0.5"
                                                />
                                                <span className="text-[10px] uppercase tracking-wider text-theme-text-muted font-mono">{row.id}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleRequired(row)}
                                                disabled={saving}
                                                aria-label={required ? 'Disattiva OTP' : 'Attiva OTP'}
                                                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 ${
                                                    required ? 'bg-dr7-gold' : 'bg-theme-bg-tertiary border border-theme-border'
                                                } ${saving ? 'opacity-50 cursor-wait' : ''}`}
                                            >
                                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${required ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-y-2 gap-x-3 text-xs items-start">
                                            <span className="text-theme-text-muted pt-1.5">Dove suona</span>
                                            <input
                                                type="text"
                                                value={String(valueOf(row, 'used_in'))}
                                                onChange={e => setField(row.id, 'used_in', e.target.value)}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                                            />

                                            <span className="text-theme-text-muted pt-1.5">Motivo OTP</span>
                                            <textarea
                                                value={String(valueOf(row, 'reason'))}
                                                onChange={e => setField(row.id, 'reason', e.target.value)}
                                                rows={2}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-secondary focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20"
                                            />
                                        </div>

                                        <div className="mt-4 flex items-center justify-between gap-2">
                                            <button
                                                onClick={() => removeRow(row)}
                                                disabled={saving}
                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50"
                                            >
                                                Elimina
                                            </button>
                                            {dirty && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setEditing(prev => { const n = { ...prev }; delete n[row.id]; return n })}
                                                        disabled={saving}
                                                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary"
                                                    >
                                                        Annulla
                                                    </button>
                                                    <button
                                                        onClick={() => save(row)}
                                                        disabled={saving}
                                                        className="px-4 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50 shadow-sm"
                                                    >
                                                        {saving ? 'Salvataggio…' : 'Salva'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>

                {/* Right rail: decorative reminders + status */}
                <aside className="space-y-4">
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-dr7-gold">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                                </svg>
                                Promemoria automatici
                            </h3>
                            <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">decorativo</span>
                        </div>
                        <ul className="space-y-3">
                            {STATIC_PROMEMORIA.map((p, i) => {
                                const c = TONE_CLASSES[p.tone]
                                return (
                                    <li key={i} className="rounded-xl border border-theme-border bg-theme-bg-primary p-3 hover:border-dr7-gold/40 transition-colors">
                                        <div className="flex items-start gap-3">
                                            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-theme-text-primary truncate">{p.title}</p>
                                                <p className="text-xs text-theme-text-muted mt-0.5">{p.detail}</p>
                                                <span className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border ${c.pill}`}>
                                                    {p.when}
                                                </span>
                                            </div>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>

                    {/* Coverage card */}
                    <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-dr7-gold/10 to-transparent p-5">
                        <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Stato sicurezza</h3>
                        <div className="space-y-2.5 text-xs">
                            <div className="flex items-center justify-between">
                                <span className="text-theme-text-muted">Copertura attiva</span>
                                <span className="text-theme-text-primary font-semibold">
                                    {rows.length === 0 ? '—' : `${Math.round((requiredCount / rows.length) * 100)}%`}
                                </span>
                            </div>
                            <div className="h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-dr7-gold to-amber-400 transition-all"
                                    style={{ width: rows.length === 0 ? '0%' : `${(requiredCount / rows.length) * 100}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between pt-1">
                                <span className="text-theme-text-muted">Direzione</span>
                                <span className="text-theme-text-primary font-mono text-[11px] truncate max-w-[160px]">{adminEmail || '—'}</span>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    )
}

function KpiCard(props: {
    label: string
    value?: number
    valueText?: string
    accent: 'green' | 'amber' | 'blue' | 'rose'
    icon: React.ReactNode
}) {
    const accentMap: Record<typeof props.accent, { bg: string; text: string }> = {
        green: { bg: 'bg-green-500/10', text: 'text-green-400' },
        amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
        blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
        rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
    }
    const a = accentMap[props.accent]
    return (
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-theme-text-muted">{props.label}</span>
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${a.bg} ${a.text}`}>
                    {props.icon}
                </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-theme-text-primary">
                {props.value !== undefined ? props.value : props.valueText}
            </p>
        </div>
    )
}

// ─── OTP Recipient Field ─────────────────────────────────────────────────
// Manages two `centralina_pro_config.config.notifications` keys:
//   - otp_recipient        → email per i codici OTP direzione (server-side
//                            in limitation-override-otp + send-wallet-otp)
//   - boss_whatsapp_phone  → numero WhatsApp per gli alert "preventivo
//                            creato in attesa" (PreventiviTab fallback)
// Entrambi: 3-level fallback (DB → env var/hardcoded). Lasciare vuoto
// per usare il default.
function OtpRecipientField() {
    const [email, setEmail] = useState('')
    const [savedEmail, setSavedEmail] = useState('')
    const [adminPhone, setAdminPhone] = useState('')
    const [savedAdminPhone, setSavedAdminPhone] = useState('')
    const [bossPhone, setBossPhone] = useState('')
    const [savedBossPhone, setSavedBossPhone] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (cancelled) return
            const cfg = (data?.config || {}) as Record<string, unknown>
            const notif = (cfg.notifications || {}) as Record<string, unknown>
            const e  = typeof notif.otp_recipient === 'string' ? notif.otp_recipient : ''
            const ap = typeof notif.admin_whatsapp_phone === 'string' ? notif.admin_whatsapp_phone : ''
            const bp = typeof notif.boss_whatsapp_phone === 'string' ? notif.boss_whatsapp_phone : ''
            setEmail(e); setSavedEmail(e)
            setAdminPhone(ap); setSavedAdminPhone(ap)
            setBossPhone(bp); setSavedBossPhone(bp)
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [])

    const cleanPhone = (s: string) => s.trim().replace(/[\s+-]/g, '')
    const dirtyEmail = email.trim() !== savedEmail
    const dirtyAdminPhone = cleanPhone(adminPhone) !== savedAdminPhone
    const dirtyBossPhone = cleanPhone(bossPhone) !== savedBossPhone
    const dirty = dirtyEmail || dirtyAdminPhone || dirtyBossPhone
    const isValidEmail = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    const isValidPhone = (p: string) => !p || /^\d{9,15}$/.test(cleanPhone(p))
    const validAdminPhone = isValidPhone(adminPhone)
    const validBossPhone = isValidPhone(bossPhone)
    const canSave = dirty && isValidEmail && validAdminPhone && validBossPhone

    const handleSave = async () => {
        if (!canSave || saving) return
        setSaving(true)
        try {
            const { data: existing } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            const cfg = (existing?.config || {}) as Record<string, unknown>
            const notif = (cfg.notifications || {}) as Record<string, unknown>
            const nextNotif = {
                ...notif,
                otp_recipient: email.trim(),
                admin_whatsapp_phone: cleanPhone(adminPhone),
                boss_whatsapp_phone: cleanPhone(bossPhone),
            }
            const nextCfg = { ...cfg, notifications: nextNotif }
            const { error } = await supabase
                .from('centralina_pro_config')
                .upsert({ id: 'main', config: nextCfg }, { onConflict: 'id' })
            if (error) throw error
            setSavedEmail(email.trim())
            setSavedAdminPhone(cleanPhone(adminPhone))
            setSavedBossPhone(cleanPhone(bossPhone))
            toast.success('Canali di notifica salvati')
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Errore sconosciuto'
            toast.error(`Errore salvataggio: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-500 flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <path d="m22 7-10 5L2 7"/>
                    </svg>
                </div>
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-theme-text-primary">Canali di notifica direzione</h3>
                    <p className="text-[12px] text-theme-text-muted">Dove arrivano OTP e alert. Lasciare vuoto = usa il default.</p>
                </div>
            </div>

            <div>
                <label className="block text-[12px] font-medium text-theme-text-secondary mb-1">Email di ricezione OTP</label>
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={loading ? 'Caricamento…' : 'es. direzione@dr7.app'}
                    disabled={loading}
                    className={`w-full bg-theme-bg-primary border rounded-md px-3 py-2 text-[13px] ${!isValidEmail && email ? 'border-red-500' : 'border-theme-border'}`}
                />
                {!isValidEmail && email && (
                    <p className="text-[11px] text-red-500 mt-1">Formato email non valido.</p>
                )}
                <p className="text-[11px] text-theme-text-muted mt-1">
                    Codici OTP per autorizzazioni direzionali e prelievi wallet.
                </p>
            </div>

            <div>
                <label className="block text-[12px] font-medium text-theme-text-secondary mb-1">WhatsApp admin (notifiche operative)</label>
                <input
                    type="tel"
                    value={adminPhone}
                    onChange={e => setAdminPhone(e.target.value)}
                    placeholder={loading ? 'Caricamento…' : 'es. 393457905205'}
                    disabled={loading}
                    className={`w-full bg-theme-bg-primary border rounded-md px-3 py-2 text-[13px] font-mono ${!validAdminPhone && adminPhone ? 'border-red-500' : 'border-theme-border'}`}
                />
                {!validAdminPhone && adminPhone && (
                    <p className="text-[11px] text-red-500 mt-1">Solo cifre (9-15), formato internazionale senza +.</p>
                )}
                <p className="text-[11px] text-theme-text-muted mt-1">
                    Riceve gli alert automatici (Nexi callback, prepaid card, fornitori in scadenza, scadenze cron).
                    Vuoto → usa <code>NOTIFICATION_PHONE</code> env o il default storico.
                </p>
            </div>

            <div>
                <label className="block text-[12px] font-medium text-theme-text-secondary mb-1">WhatsApp direzione (alert preventivi)</label>
                <input
                    type="tel"
                    value={bossPhone}
                    onChange={e => setBossPhone(e.target.value)}
                    placeholder={loading ? 'Caricamento…' : 'es. 393472817258'}
                    disabled={loading}
                    className={`w-full bg-theme-bg-primary border rounded-md px-3 py-2 text-[13px] font-mono ${!validBossPhone && bossPhone ? 'border-red-500' : 'border-theme-border'}`}
                />
                {!validBossPhone && bossPhone && (
                    <p className="text-[11px] text-red-500 mt-1">Solo cifre (9-15), formato internazionale senza +.</p>
                )}
                <p className="text-[11px] text-theme-text-muted mt-1">
                    Riceve la richiesta "preventivo senza cauzione in attesa". Diverso dal numero admin.
                </p>
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canSave || saving || loading}
                    className="px-4 py-2 rounded-md bg-dr7-gold text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {saving ? 'Salvataggio…' : 'Salva canali'}
                </button>
            </div>
        </div>
    )
}
