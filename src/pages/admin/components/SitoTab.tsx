/**
 * SitoTab — Admin "Sito" tab
 *
 * Lets the operator edit website-visible copy (FAQ, Cancellation,
 * Membership, Hero, etc.) without a developer or redeploy. Each
 * section persists to `centralina_pro_config.config.site_copy.*`
 * and the website reads it via `utils/siteCopy.ts` with a hardcoded
 * fallback for the legacy strings.
 *
 * Access control:
 *   - Whitelist (no OTP):  valerio@dr7.app, ilenia@dr7.app
 *   - Everyone else:       OTP gate via LimitationOverrideModal
 *                          codes: `gestione_sito_access` (open tab),
 *                                 `gestione_sito_write`  (save changes)
 *
 * Implemented sub-sections:
 *   - faq          (editable list of question/answer pairs)
 *   - cancellazione, membership, hero, chi-siamo, footer, legali
 *                   (placeholder shells — will be filled iteratively)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'

// ─── Whitelist ───────────────────────────────────────────────────────────────
// Strict: only direzione (Valerio + Ilenia) can open the tab without OTP.
const SITO_DIREZIONE_EMAILS = ['valerio@dr7.app', 'ilenia@dr7.app']

// ─── Sections ────────────────────────────────────────────────────────────────
type SectionId =
    | 'faq'
    | 'cancellazione'
    | 'membership'
    | 'hero'
    | 'chi-siamo'
    | 'footer'
    | 'legali'

const SECTIONS: { id: SectionId; title: string; ready: boolean }[] = [
    { id: 'faq', title: 'FAQ', ready: true },
    { id: 'cancellazione', title: 'Cancellazione', ready: true },
    { id: 'membership', title: 'Membership / DR7 Club', ready: true },
    { id: 'hero', title: 'Home / Hero', ready: false },
    { id: 'chi-siamo', title: 'Chi Siamo', ready: false },
    { id: 'footer', title: 'Footer', ready: false },
    { id: 'legali', title: 'Privacy & Termini', ready: false },
]

// ─── FAQ schema ──────────────────────────────────────────────────────────────
interface FaqEntry {
    id: string
    question: string
    answer: string
}

// ─── Cancellazione schema (mirror of website utils/siteCopy.ts) ─────────────
type CancellazioneBlock =
    | { type: 'p'; text_it: string; text_en: string }
    | { type: 'p-bold'; text_it: string; text_en: string }
    | { type: 'p-italic'; text_it: string; text_en: string }
    | { type: 'ul'; items_it: string[]; items_en: string[]; tone?: 'default' | 'green' }

interface CancellazioneSection {
    id: string
    variant: 'standard' | 'flex'
    title_it: string
    title_en: string
    blocks: CancellazioneBlock[]
}

interface CancellazioneCopy {
    page_title_it: string
    page_title_en: string
    sections: CancellazioneSection[]
    contact_label_it: string
    contact_label_en: string
    contact_email: string
    contact_address: string
    last_updated_it: string
    last_updated_en: string
}

// ─── Membership schema (mirror of website utils/siteCopy.ts) ───────────────
interface MembershipRewardItem {
    label_it: string
    label_en: string
    reward: string
    note_it: string | null
    note_en: string | null
}

interface MembershipCopy {
    hero_eyebrow_it: string; hero_eyebrow_en: string
    hero_title: string
    hero_subtitle_it: string; hero_subtitle_en: string
    hero_opener_it: string; hero_opener_en: string
    pricing_card_title: string
    pricing_billing_monthly_it: string; pricing_billing_monthly_en: string
    pricing_billing_annual_it: string; pricing_billing_annual_en: string
    pricing_billing_save_badge: string
    pricing_cycle_month_it: string; pricing_cycle_month_en: string
    pricing_cycle_year_it: string; pricing_cycle_year_en: string
    pricing_savings_it: string; pricing_savings_en: string
    pricing_cta_it: string; pricing_cta_en: string
    pricing_cta_footnote_it: string; pricing_cta_footnote_en: string
    elite_title: string
    elite_subtitle_it: string; elite_subtitle_en: string
    elite_intro_it: string; elite_intro_en: string
    elite_sections: CancellazioneSection[]
    elite_cta_title_it: string; elite_cta_title_en: string
    elite_cta_text_it: string; elite_cta_text_en: string
    elite_cta_logged_out_it: string; elite_cta_logged_out_en: string
    elite_cta_logged_in_it: string; elite_cta_logged_in_en: string
    reward_title_it: string; reward_title_en: string
    reward_intro_it: string; reward_intro_en: string
    reward_items: MembershipRewardItem[]
    reward_footnote_it: string; reward_footnote_en: string
}

const INITIAL_MEMBERSHIP: MembershipCopy = {
    hero_eyebrow_it: '', hero_eyebrow_en: '',
    hero_title: 'DR7 CLUB',
    hero_subtitle_it: '', hero_subtitle_en: '',
    hero_opener_it: '', hero_opener_en: '',
    pricing_card_title: 'DR7 CLUB',
    pricing_billing_monthly_it: '', pricing_billing_monthly_en: '',
    pricing_billing_annual_it: '', pricing_billing_annual_en: '',
    pricing_billing_save_badge: '',
    pricing_cycle_month_it: '', pricing_cycle_month_en: '',
    pricing_cycle_year_it: '', pricing_cycle_year_en: '',
    pricing_savings_it: '', pricing_savings_en: '',
    pricing_cta_it: '', pricing_cta_en: '',
    pricing_cta_footnote_it: '', pricing_cta_footnote_en: '',
    elite_title: '',
    elite_subtitle_it: '', elite_subtitle_en: '',
    elite_intro_it: '', elite_intro_en: '',
    elite_sections: [],
    elite_cta_title_it: '', elite_cta_title_en: '',
    elite_cta_text_it: '', elite_cta_text_en: '',
    elite_cta_logged_out_it: '', elite_cta_logged_out_en: '',
    elite_cta_logged_in_it: '', elite_cta_logged_in_en: '',
    reward_title_it: '', reward_title_en: '',
    reward_intro_it: '', reward_intro_en: '',
    reward_items: [],
    reward_footnote_it: '', reward_footnote_en: '',
}

const INITIAL_CANCELLAZIONE: CancellazioneCopy = {
    page_title_it: 'Policy di Cancellazione e Modifica Prenotazioni',
    page_title_en: 'Cancellation and Booking Modification Policy',
    contact_label_it: 'Per assistenza o informazioni:',
    contact_label_en: 'For assistance or information:',
    contact_email: 'info@dr7.app',
    contact_address: 'Dubai Rent 7.0 S.p.A. - Viale Marconi, 229, 09131 Cagliari CA',
    last_updated_it: 'Ultimo aggiornamento: 10 aprile 2026',
    last_updated_en: 'Last updated: April 10, 2026',
    sections: [],  // Hydrated from DB; full default lives on website side.
}

// Italian translations of the legacy English FAQ on /faq.
const INITIAL_FAQ: FaqEntry[] = [
    {
        id: 'requisiti-noleggio',
        question: 'Quali sono i requisiti per noleggiare un\'auto?',
        answer: 'Il conducente deve avere almeno 25 anni, essere in possesso di una patente di guida valida e fornire prova di copertura assicurativa completa. Per tutti i noleggi e\' richiesta una cauzione.',
    },
    {
        id: 'come-funziona-dr7-club',
        question: 'Come funziona la membership DR7 Club?',
        answer: 'La nostra membership esclusiva offre accesso a tariffe preferenziali, prenotazione prioritaria, servizio concierge 24/7 e inviti a eventi privati. Puoi scegliere fra fatturazione mensile o annuale su tre tier diversi.',
    },
    {
        id: 'politica-cancellazione',
        question: 'Qual e\' la politica di cancellazione?',
        answer: 'Le politiche di cancellazione variano in base al servizio prenotato. Per i dettagli specifici, consulta il Contratto di Noleggio fornito al momento della conferma o contatta il nostro supporto.',
    },
    {
        id: 'metodi-pagamento',
        question: 'Quali metodi di pagamento accettate?',
        answer: 'Accettiamo le principali carte di credito (Visa, MasterCard, American Express) e una selezione di criptovalute. Le opzioni di pagamento vengono presentate in fase di checkout.',
    },
]

// ─── Persistence helpers ─────────────────────────────────────────────────────
interface SiteCopySnapshot {
    faq?: FaqEntry[]
    cancellazione?: CancellazioneCopy
    membership?: MembershipCopy
    // Future: hero, chi_siamo, footer, legali
}

interface CurrentState {
    faq: FaqEntry[]
    cancellazione: CancellazioneCopy
    membership: MembershipCopy
}

async function loadPersisted(): Promise<SiteCopySnapshot | null> {
    const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const cfg = (data?.config ?? null) as Record<string, unknown> | null
    const sc = cfg?.site_copy as SiteCopySnapshot | undefined
    return sc ?? null
}

async function savePersisted(snap: SiteCopySnapshot): Promise<void> {
    // Read the full current config, merge site_copy, write back. JSONB merge
    // preserves all sibling keys (categories, fasce, automations, etc.).
    const { data: existing } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const baseConfig = (existing?.config ?? {}) as Record<string, unknown>
    const newConfig = { ...baseConfig, site_copy: { ...((baseConfig.site_copy as object | undefined) || {}), ...snap } }
    const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: newConfig })
    if (error) throw error
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SitoTab() {
    const { adminEmail, loading: roleLoading } = useAdminRole()
    const isDirezione = !!adminEmail && SITO_DIREZIONE_EMAILS.includes(adminEmail.toLowerCase())
    const override = useLimitationOverride()

    // ─── Access gate ─────────────────────────────────────────────────────────
    const [tabUnlocked, setTabUnlocked] = useState(false)
    useEffect(() => {
        if (roleLoading) return
        if (isDirezione) {
            setTabUnlocked(true)
            return
        }
        if (!override.hasOverride('gestione_sito_access')) {
            override.requestOverride('gestione_sito_access', 'Accesso alla sezione Sito richiede autorizzazione direzionale')
        }
    }, [roleLoading, isDirezione]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (override.hasOverride('gestione_sito_access')) {
            setTabUnlocked(true)
        }
    }, [override])

    // ─── Section navigation ──────────────────────────────────────────────────
    const [section, setSection] = useState<SectionId>('faq')

    // ─── State (current + saved snapshots per section) ───────────────────────
    const [faq, setFaq] = useState<FaqEntry[]>(INITIAL_FAQ)
    const [savedFaq, setSavedFaq] = useState<FaqEntry[]>(INITIAL_FAQ)
    const [cancellazione, setCancellazione] = useState<CancellazioneCopy>(INITIAL_CANCELLAZIONE)
    const [savedCancellazione, setSavedCancellazione] = useState<CancellazioneCopy>(INITIAL_CANCELLAZIONE)
    const [membership, setMembership] = useState<MembershipCopy>(INITIAL_MEMBERSHIP)
    const [savedMembership, setSavedMembership] = useState<MembershipCopy>(INITIAL_MEMBERSHIP)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        if (!tabUnlocked) return
        let cancelled = false
        ;(async () => {
            try {
                const remote = await loadPersisted()
                if (cancelled) return
                if (remote?.faq && Array.isArray(remote.faq)) {
                    setFaq(remote.faq)
                    setSavedFaq(remote.faq)
                }
                if (remote?.cancellazione && Array.isArray(remote.cancellazione.sections)) {
                    setCancellazione(remote.cancellazione)
                    setSavedCancellazione(remote.cancellazione)
                }
                if (remote?.membership && Array.isArray(remote.membership.elite_sections)) {
                    setMembership(remote.membership)
                    setSavedMembership(remote.membership)
                }
            } catch (e) {
                console.error('SitoTab hydration failed:', e)
            } finally {
                if (!cancelled) setHydrated(true)
            }
        })()
        return () => { cancelled = true }
    }, [tabUnlocked])

    // ─── Changes detection ───────────────────────────────────────────────────
    const changes = useMemo(
        () => computeChanges(
            { faq, cancellazione, membership },
            { faq: savedFaq, cancellazione: savedCancellazione, membership: savedMembership }
        ),
        [faq, savedFaq, cancellazione, savedCancellazione, membership, savedMembership]
    )
    const dirty = changes.length > 0

    // ─── Save / Discard (gated by OTP for non-direzione) ─────────────────────
    const [saving, setSaving] = useState(false)
    const pendingSaveRef = useRef<null | (() => Promise<void>)>(null)

    const doSave = async () => {
        setSaving(true)
        try {
            await savePersisted({ faq, cancellazione, membership })
            setSavedFaq(faq)
            setSavedCancellazione(cancellazione)
            setSavedMembership(membership)
            toast.success('Modifiche salvate')
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Errore sconosciuto'
            toast.error(`Errore salvataggio: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    const handleSave = () => {
        if (!dirty || saving) return
        if (isDirezione) {
            void doSave()
            return
        }
        // Non-direzione: gate the save behind OTP.
        pendingSaveRef.current = doSave
        override.requestOverride('gestione_sito_write', 'Modifica testi del sito richiede autorizzazione direzionale')
    }

    useEffect(() => {
        if (override.hasOverride('gestione_sito_write') && pendingSaveRef.current) {
            const run = pendingSaveRef.current
            pendingSaveRef.current = null
            ;(async () => {
                try { await run() } finally {
                    await override.consumeOverride('gestione_sito_write')
                }
            })()
        }
    }, [override])

    const handleDiscard = () => {
        if (!dirty) return
        setFaq(savedFaq)
        setCancellazione(savedCancellazione)
        setMembership(savedMembership)
    }

    // ─── Render ──────────────────────────────────────────────────────────────
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
                        L'accesso alla sezione <b>Sito</b> richiede autorizzazione direzionale. Verifica il codice ricevuto via email per continuare.
                    </p>
                    <button
                        onClick={() => override.requestOverride('gestione_sito_access', 'Accesso alla sezione Sito richiede autorizzazione direzionale')}
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
        <div className="bg-[#fafafa] min-h-screen pb-32">
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

            {/* Header */}
            <div className="px-6 pt-6 pb-4 bg-white border-b border-black/5">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Sito</h1>
                        <p className="text-[14px] text-[#6e6e73] mt-1">Modifica testi visibili sul sito senza intervento sviluppatore.</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Attivo
                    </span>
                </div>
            </div>

            {/* Body: side nav + content */}
            <div className="px-6 pt-6">
                <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
                    {/* Side nav */}
                    <aside>
                        <ul className="space-y-1 bg-white rounded-2xl p-2 border border-black/5 shadow-sm">
                            {SECTIONS.map((s, idx) => {
                                const active = section === s.id
                                return (
                                    <li key={s.id}>
                                        <button
                                            onClick={() => setSection(s.id)}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors flex items-center gap-2 ${
                                                active
                                                    ? 'bg-blue-500 text-white shadow-sm'
                                                    : 'text-[#1d1d1f] hover:bg-black/5'
                                            }`}
                                        >
                                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-semibold ${
                                                active ? 'bg-white/20 text-white' : 'bg-black/5 text-[#6e6e73]'
                                            }`}>{idx + 1}</span>
                                            <span className="flex-1">{s.title}</span>
                                            {!s.ready && (
                                                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                                    active ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-700'
                                                }`}>Soon</span>
                                            )}
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    </aside>

                    {/* Main content */}
                    <main className="bg-white rounded-2xl p-6 border border-black/5 shadow-sm min-h-[400px]">
                        {!hydrated && (
                            <p className="text-sm text-[#6e6e73]">Caricamento dati…</p>
                        )}
                        {hydrated && section === 'faq' && (
                            <FaqEditor entries={faq} setEntries={setFaq} />
                        )}
                        {hydrated && section === 'cancellazione' && (
                            <CancellazioneEditor copy={cancellazione} setCopy={setCancellazione} />
                        )}
                        {hydrated && section === 'membership' && (
                            <MembershipEditor copy={membership} setCopy={setMembership} />
                        )}
                        {hydrated && section !== 'faq' && section !== 'cancellazione' && section !== 'membership' && (
                            <PlaceholderSection
                                title={SECTIONS.find(s => s.id === section)?.title || section}
                            />
                        )}
                    </main>
                </div>
            </div>

            {/* SaveBar */}
            {dirty && (
                <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-black/10 shadow-lg z-40">
                    <div className="px-6 py-3 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-[#1d1d1f]">
                            <b>{changes.length}</b> modific{changes.length === 1 ? 'a' : 'he'} non salvat{changes.length === 1 ? 'a' : 'e'}.
                            {' '}<span className="text-[#6e6e73]">{changes[0]}{changes.length > 1 ? `, +${changes.length - 1} altre` : ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleDiscard}
                                disabled={saving}
                                className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#1d1d1f] bg-black/5 hover:bg-black/10 disabled:opacity-50"
                            >Annulla</button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50"
                            >{saving ? 'Salvataggio…' : 'Salva modifiche'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Changes detection ───────────────────────────────────────────────────────
function computeChanges(current: CurrentState, saved: CurrentState): string[] {
    const out: string[] = []
    // FAQ
    {
        const curIds = new Set(current.faq.map(e => e.id))
        const savIds = new Set(saved.faq.map(e => e.id))
        const added = current.faq.filter(e => !savIds.has(e.id))
        const removed = saved.faq.filter(e => !curIds.has(e.id))
        added.forEach(e => out.push(`FAQ: nuova "${e.question.slice(0, 40) || '(senza titolo)'}"`))
        removed.forEach(e => out.push(`FAQ: rimossa "${e.question.slice(0, 40) || e.id}"`))
        current.faq.forEach(c => {
            const s = saved.faq.find(x => x.id === c.id)
            if (!s) return
            if (c.question !== s.question || c.answer !== s.answer) {
                out.push(`FAQ: modificata "${(s.question || c.question).slice(0, 40)}"`)
            }
        })
        if (current.faq.length === saved.faq.length && added.length === 0 && removed.length === 0) {
            const reordered = current.faq.some((e, i) => saved.faq[i]?.id !== e.id)
            if (reordered) out.push('FAQ: ordine modificato')
        }
    }
    // Cancellazione (compare as JSON — covers titles, blocks, sections, footer)
    if (JSON.stringify(current.cancellazione) !== JSON.stringify(saved.cancellazione)) {
        out.push('Cancellazione: testi modificati')
    }
    // Membership (same approach)
    if (JSON.stringify(current.membership) !== JSON.stringify(saved.membership)) {
        out.push('Membership: testi modificati')
    }
    return out
}

// ─── FAQ editor ──────────────────────────────────────────────────────────────
function FaqEditor({
    entries,
    setEntries,
}: {
    entries: FaqEntry[]
    setEntries: (next: FaqEntry[]) => void
}) {
    const update = (id: string, patch: Partial<FaqEntry>) => {
        setEntries(entries.map(e => e.id === id ? { ...e, ...patch } : e))
    }
    const remove = (id: string) => {
        if (!confirm('Rimuovere questa voce dalla FAQ?')) return
        setEntries(entries.filter(e => e.id !== id))
    }
    const move = (id: string, dir: -1 | 1) => {
        const idx = entries.findIndex(e => e.id === id)
        const newIdx = idx + dir
        if (idx < 0 || newIdx < 0 || newIdx >= entries.length) return
        const next = [...entries]
        ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
        setEntries(next)
    }
    const add = () => {
        const id = `faq-${Date.now().toString(36)}`
        setEntries([...entries, { id, question: '', answer: '' }])
    }

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">FAQ</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Domande e risposte mostrate sulla pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/faq</code>. Modifica, riordina, aggiungi o rimuovi liberamente.
                </p>
            </div>

            <ul className="space-y-3">
                {entries.map((e, i) => (
                    <li key={e.id} className="border border-black/10 rounded-2xl p-4 bg-white shadow-sm">
                        <div className="flex items-start gap-3">
                            {/* Reorder controls */}
                            <div className="flex flex-col gap-1 pt-1">
                                <button
                                    onClick={() => move(e.id, -1)}
                                    disabled={i === 0}
                                    className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                                    title="Sposta su"
                                ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button
                                    onClick={() => move(e.id, 1)}
                                    disabled={i === entries.length - 1}
                                    className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                                    title="Sposta giù"
                                ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            </div>
                            {/* Content */}
                            <div className="flex-1 space-y-2">
                                <label className="block">
                                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Domanda</span>
                                    <input
                                        type="text"
                                        value={e.question}
                                        onChange={(ev) => update(e.id, { question: ev.target.value })}
                                        placeholder="Es. Quali sono i requisiti per noleggiare un'auto?"
                                        className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Risposta</span>
                                    <textarea
                                        value={e.answer}
                                        onChange={(ev) => update(e.id, { answer: ev.target.value })}
                                        placeholder="Es. Il conducente deve avere almeno 25 anni…"
                                        rows={3}
                                        className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                                    />
                                </label>
                            </div>
                            {/* Delete */}
                            <button
                                onClick={() => remove(e.id)}
                                className="w-8 h-8 rounded-lg text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center"
                                title="Elimina"
                            ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>
                        </div>
                    </li>
                ))}
            </ul>

            <button
                onClick={add}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-black/15 text-[13px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Aggiungi domanda
            </button>
        </div>
    )
}

// ─── Cancellazione editor ───────────────────────────────────────────────────
function CancellazioneEditor({
    copy,
    setCopy,
}: {
    copy: CancellazioneCopy
    setCopy: (next: CancellazioneCopy) => void
}) {
    const updateField = <K extends keyof CancellazioneCopy>(key: K, value: CancellazioneCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    const updateSection = (idx: number, patch: Partial<CancellazioneSection>) => {
        const next = [...copy.sections]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, sections: next })
    }
    const moveSection = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= copy.sections.length) return
        const next = [...copy.sections]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, sections: next })
    }
    const removeSection = (idx: number) => {
        if (!confirm('Rimuovere questa sezione dalla pagina Cancellazione?')) return
        setCopy({ ...copy, sections: copy.sections.filter((_, i) => i !== idx) })
    }
    const addSection = () => {
        const id = `sec-${Date.now().toString(36)}`
        setCopy({
            ...copy,
            sections: [...copy.sections, {
                id, variant: 'standard',
                title_it: 'Nuova sezione', title_en: 'New section',
                blocks: [{ type: 'p', text_it: '', text_en: '' }],
            }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Cancellazione</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/cancellation</code>. Modifica titoli e paragrafi in italiano e inglese. I numeri (giorni soglia, % rimborso/penale) vengono dalle regole in Centralina Pro &gt; Automazioni e si inseriscono coi placeholder <code>{'{thresholdDays}'}</code>, <code>{'{refundPercent}'}</code>, <code>{'{penaltyPercent}'}</code>, <code>{'{daysWord}'}</code>.
                </p>
            </div>

            {/* Page header + footer fields */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Header & Footer pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.page_title_it} onChange={v => updateField('page_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.page_title_en} onChange={v => updateField('page_title_en', v)} />
                    <FieldText label="Etichetta contatto (IT)" value={copy.contact_label_it} onChange={v => updateField('contact_label_it', v)} />
                    <FieldText label="Etichetta contatto (EN)" value={copy.contact_label_en} onChange={v => updateField('contact_label_en', v)} />
                    <FieldText label="Email contatto" value={copy.contact_email} onChange={v => updateField('contact_email', v)} />
                    <FieldText label="Indirizzo (footer)" value={copy.contact_address} onChange={v => updateField('contact_address', v)} />
                    <FieldText label="Ultimo aggiornamento (IT)" value={copy.last_updated_it} onChange={v => updateField('last_updated_it', v)} />
                    <FieldText label="Ultimo aggiornamento (EN)" value={copy.last_updated_en} onChange={v => updateField('last_updated_en', v)} />
                </div>
            </section>

            {/* Sections */}
            <div className="space-y-3">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sezioni ({copy.sections.length})</h3>
                {copy.sections.map((sec, i) => (
                    <SectionCard
                        key={sec.id}
                        section={sec}
                        first={i === 0}
                        last={i === copy.sections.length - 1}
                        onChange={(patch) => updateSection(i, patch)}
                        onMoveUp={() => moveSection(i, -1)}
                        onMoveDown={() => moveSection(i, 1)}
                        onRemove={() => removeSection(i)}
                    />
                ))}
                <button
                    onClick={addSection}
                    className="w-full py-3 rounded-2xl border-2 border-dashed border-black/15 text-[13px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi sezione
                </button>
            </div>
        </div>
    )
}

function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">{label}</span>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
        </label>
    )
}

function SectionCard({
    section, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    section: CancellazioneSection
    first: boolean
    last: boolean
    onChange: (patch: Partial<CancellazioneSection>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const [open, setOpen] = useState(false)

    const updateBlock = (idx: number, next: CancellazioneBlock) => {
        const blocks = [...section.blocks]
        blocks[idx] = next
        onChange({ blocks })
    }
    const moveBlock = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= section.blocks.length) return
        const blocks = [...section.blocks]
        ;[blocks[idx], blocks[j]] = [blocks[j], blocks[idx]]
        onChange({ blocks })
    }
    const removeBlock = (idx: number) => {
        if (!confirm('Rimuovere questo blocco?')) return
        onChange({ blocks: section.blocks.filter((_, i) => i !== idx) })
    }
    const addBlock = (type: CancellazioneBlock['type']) => {
        let block: CancellazioneBlock
        if (type === 'ul') block = { type: 'ul', items_it: [''], items_en: [''], tone: 'default' }
        else block = { type, text_it: '', text_en: '' }
        onChange({ blocks: [...section.blocks, block] })
    }

    const variantBadge = section.variant === 'flex'
        ? <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700">Flex</span>
        : <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/5 text-[#6e6e73]">Standard</span>

    return (
        <div className="border border-black/10 rounded-2xl bg-white shadow-sm">
            <header className="px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex-1 text-left flex items-center gap-3"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-[#6e6e73] transition-transform ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>
                    <span className="text-[13px] font-semibold text-[#1d1d1f] flex-1 truncate">{section.title_it || '(senza titolo)'}</span>
                    {variantBadge}
                </button>
                <div className="flex items-center gap-1">
                    <button onClick={onMoveUp} disabled={first} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                    <button onClick={onMoveDown} disabled={last} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                    <button onClick={onRemove} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina sezione"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                </div>
            </header>

            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-black/5 pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldText label="Titolo sezione (IT)" value={section.title_it} onChange={v => onChange({ title_it: v })} />
                        <FieldText label="Titolo sezione (EN)" value={section.title_en} onChange={v => onChange({ title_en: v })} />
                    </div>
                    <label className="block">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Variante stile</span>
                        <select
                            value={section.variant}
                            onChange={(e) => onChange({ variant: e.target.value as 'standard' | 'flex' })}
                            className="mt-1 w-full md:w-48 bg-white border border-black/10 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                            <option value="standard">Standard (border grigio)</option>
                            <option value="flex">Flex (border verde)</option>
                        </select>
                    </label>

                    {/* Blocks */}
                    <div className="space-y-2">
                        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Blocchi ({section.blocks.length})</h4>
                        {section.blocks.map((block, i) => (
                            <BlockCard
                                key={i}
                                block={block}
                                first={i === 0}
                                last={i === section.blocks.length - 1}
                                onChange={(b) => updateBlock(i, b)}
                                onMoveUp={() => moveBlock(i, -1)}
                                onMoveDown={() => moveBlock(i, 1)}
                                onRemove={() => removeBlock(i)}
                            />
                        ))}
                        <div className="flex flex-wrap gap-2 pt-1">
                            <AddBlockButton label="+ Paragrafo" onClick={() => addBlock('p')} />
                            <AddBlockButton label="+ Paragrafo grassetto" onClick={() => addBlock('p-bold')} />
                            <AddBlockButton label="+ Paragrafo corsivo" onClick={() => addBlock('p-italic')} />
                            <AddBlockButton label="+ Lista puntata" onClick={() => addBlock('ul')} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function AddBlockButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#1d1d1f] bg-black/5 hover:bg-black/10"
        >{label}</button>
    )
}

function BlockCard({
    block, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    block: CancellazioneBlock
    first: boolean
    last: boolean
    onChange: (next: CancellazioneBlock) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const typeLabel = {
        'p': 'Paragrafo',
        'p-bold': 'Grassetto',
        'p-italic': 'Corsivo',
        'ul': 'Lista',
    }[block.type]

    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa]">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1">{typeLabel}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>

            {block.type === 'ul' ? (
                <UlEditor
                    items_it={block.items_it}
                    items_en={block.items_en}
                    tone={block.tone || 'default'}
                    onChange={(patch) => onChange({ ...block, ...patch })}
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="block">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6]">Italiano</span>
                        <textarea
                            value={block.text_it}
                            onChange={(e) => onChange({ ...block, text_it: e.target.value })}
                            rows={3}
                            className="mt-0.5 w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6]">English</span>
                        <textarea
                            value={block.text_en}
                            onChange={(e) => onChange({ ...block, text_en: e.target.value })}
                            rows={3}
                            className="mt-0.5 w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                        />
                    </label>
                </div>
            )}
        </div>
    )
}

function UlEditor({
    items_it, items_en, tone, onChange,
}: {
    items_it: string[]
    items_en: string[]
    tone: 'default' | 'green'
    onChange: (patch: { items_it?: string[]; items_en?: string[]; tone?: 'default' | 'green' }) => void
}) {
    // Items are aligned by index. Track the LONGER of the two so the editor
    // doesn't drop trailing untranslated items.
    const len = Math.max(items_it.length, items_en.length)
    const updateIt = (i: number, v: string) => {
        const next = [...items_it]
        while (next.length <= i) next.push('')
        next[i] = v
        onChange({ items_it: next })
    }
    const updateEn = (i: number, v: string) => {
        const next = [...items_en]
        while (next.length <= i) next.push('')
        next[i] = v
        onChange({ items_en: next })
    }
    const removeRow = (i: number) => {
        onChange({
            items_it: items_it.filter((_, j) => j !== i),
            items_en: items_en.filter((_, j) => j !== i),
        })
    }
    const addRow = () => {
        onChange({ items_it: [...items_it, ''], items_en: [...items_en, ''] })
    }
    const moveRow = (i: number, dir: -1 | 1) => {
        const j = i + dir
        if (j < 0 || j >= len) return
        const it = [...items_it]; const en = [...items_en]
        ;[it[i], it[j]] = [it[j] || '', it[i] || '']
        ;[en[i], en[j]] = [en[j] || '', en[i] || '']
        onChange({ items_it: it, items_en: en })
    }

    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 text-[11px] text-[#6e6e73]">
                <span>Tono:</span>
                <select
                    value={tone}
                    onChange={(e) => onChange({ tone: e.target.value as 'default' | 'green' })}
                    className="bg-white border border-black/10 rounded-md px-2 py-0.5 text-[12px]"
                >
                    <option value="default">Default (grigio)</option>
                    <option value="green">Verde (Flex)</option>
                </select>
            </label>
            <ul className="space-y-1.5">
                {Array.from({ length: len }).map((_, i) => (
                    <li key={i} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-start">
                        <input
                            type="text"
                            value={items_it[i] || ''}
                            onChange={(e) => updateIt(i, e.target.value)}
                            placeholder="punto IT"
                            className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]"
                        />
                        <input
                            type="text"
                            value={items_en[i] || ''}
                            onChange={(e) => updateEn(i, e.target.value)}
                            placeholder="bullet EN"
                            className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]"
                        />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveRow(i, 1)} disabled={i === len - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeRow(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                    </li>
                ))}
            </ul>
            <button onClick={addRow} className="text-[12px] font-medium text-blue-500 hover:text-blue-600">+ Aggiungi voce</button>
        </div>
    )
}

// ─── Membership editor ──────────────────────────────────────────────────────
function MembershipEditor({
    copy,
    setCopy,
}: {
    copy: MembershipCopy
    setCopy: (next: MembershipCopy) => void
}) {
    const updateField = <K extends keyof MembershipCopy>(key: K, value: MembershipCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Elite sections (reuse Cancellazione SectionCard pattern)
    const updateEliteSection = (idx: number, patch: Partial<CancellazioneSection>) => {
        const next = [...copy.elite_sections]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, elite_sections: next })
    }
    const moveEliteSection = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.elite_sections.length) return
        const next = [...copy.elite_sections]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, elite_sections: next })
    }
    const removeEliteSection = (idx: number) => {
        if (!confirm('Rimuovere questa sotto-sezione?')) return
        setCopy({ ...copy, elite_sections: copy.elite_sections.filter((_, i) => i !== idx) })
    }
    const addEliteSection = () => {
        const id = `elite-${Date.now().toString(36)}`
        setCopy({
            ...copy,
            elite_sections: [...copy.elite_sections, {
                id, variant: 'standard',
                title_it: 'Nuova sotto-sezione', title_en: 'New sub-section',
                blocks: [{ type: 'p', text_it: '', text_en: '' }],
            }],
        })
    }

    // Reward grid items
    const updateRewardItem = (idx: number, patch: Partial<MembershipRewardItem>) => {
        const next = [...copy.reward_items]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, reward_items: next })
    }
    const moveRewardItem = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.reward_items.length) return
        const next = [...copy.reward_items]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, reward_items: next })
    }
    const removeRewardItem = (idx: number) => {
        if (!confirm('Rimuovere questa voce reward?')) return
        setCopy({ ...copy, reward_items: copy.reward_items.filter((_, i) => i !== idx) })
    }
    const addRewardItem = () => {
        setCopy({
            ...copy,
            reward_items: [...copy.reward_items, { label_it: 'Nuova voce', label_en: 'New item', reward: '0%', note_it: null, note_en: null }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Membership / DR7 Club</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/membership</code>. I prezzi €/mese €/anno restano calcolati dai tier reali (constants/MEMBERSHIP_TIERS) — qui modifichi solo i testi. Placeholder utilizzabili: <code>{'{monthlyPrice}'}</code>, <code>{'{annualPrice}'}</code>, <code>{'{annualMonthly}'}</code>, <code>{'{annualSavings}'}</code>.
                </p>
            </div>

            {/* HERO */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Eyebrow (IT) — es. "Exclusive"' value={copy.hero_eyebrow_it} onChange={v => updateField('hero_eyebrow_it', v)} />
                    <FieldText label="Eyebrow (EN)" value={copy.hero_eyebrow_en} onChange={v => updateField('hero_eyebrow_en', v)} />
                </div>
                <FieldText label='Titolo (es. "DR7 CLUB")' value={copy.hero_title} onChange={v => updateField('hero_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.hero_subtitle_it} onChange={v => updateField('hero_subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.hero_subtitle_en} onChange={v => updateField('hero_subtitle_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Riga apertura (IT)" value={copy.hero_opener_it} onChange={v => updateField('hero_opener_it', v)} placeholder="es. Attiva il tuo wallet... €{monthlyPrice}/mese" />
                    <FieldTextArea label="Riga apertura (EN)" value={copy.hero_opener_en} onChange={v => updateField('hero_opener_en', v)} />
                </div>
            </section>

            {/* PRICING */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Pricing card</h3>
                <FieldText label="Titolo card" value={copy.pricing_card_title} onChange={v => updateField('pricing_card_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Toggle Mensile (IT)" value={copy.pricing_billing_monthly_it} onChange={v => updateField('pricing_billing_monthly_it', v)} />
                    <FieldText label="Toggle Mensile (EN)" value={copy.pricing_billing_monthly_en} onChange={v => updateField('pricing_billing_monthly_en', v)} />
                    <FieldText label="Toggle Annuale (IT)" value={copy.pricing_billing_annual_it} onChange={v => updateField('pricing_billing_annual_it', v)} />
                    <FieldText label="Toggle Annuale (EN)" value={copy.pricing_billing_annual_en} onChange={v => updateField('pricing_billing_annual_en', v)} />
                </div>
                <FieldText label='Badge sconto annuo (es. "-33%")' value={copy.pricing_billing_save_badge} onChange={v => updateField('pricing_billing_save_badge', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Suffisso ciclo "/mese" (IT)' value={copy.pricing_cycle_month_it} onChange={v => updateField('pricing_cycle_month_it', v)} />
                    <FieldText label='Suffisso ciclo "/month" (EN)' value={copy.pricing_cycle_month_en} onChange={v => updateField('pricing_cycle_month_en', v)} />
                    <FieldText label='Suffisso ciclo "/anno" (IT)' value={copy.pricing_cycle_year_it} onChange={v => updateField('pricing_cycle_year_it', v)} />
                    <FieldText label='Suffisso ciclo "/year" (EN)' value={copy.pricing_cycle_year_en} onChange={v => updateField('pricing_cycle_year_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Risparmio annuo (IT)" value={copy.pricing_savings_it} onChange={v => updateField('pricing_savings_it', v)} placeholder="es. Solo €{annualMonthly}/mese — risparmi €{annualSavings}/anno" />
                    <FieldTextArea label="Risparmio annuo (EN)" value={copy.pricing_savings_en} onChange={v => updateField('pricing_savings_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="CTA bottone (IT)" value={copy.pricing_cta_it} onChange={v => updateField('pricing_cta_it', v)} />
                    <FieldText label="CTA bottone (EN)" value={copy.pricing_cta_en} onChange={v => updateField('pricing_cta_en', v)} />
                    <FieldText label="Footnote sotto CTA (IT)" value={copy.pricing_cta_footnote_it} onChange={v => updateField('pricing_cta_footnote_it', v)} />
                    <FieldText label="Footnote sotto CTA (EN)" value={copy.pricing_cta_footnote_en} onChange={v => updateField('pricing_cta_footnote_en', v)} />
                </div>
            </section>

            {/* DR7 ELITE REWARDS */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">DR7 Elite Rewards</h3>
                <FieldText label='Titolo (es. "DR7 Elite Rewards")' value={copy.elite_title} onChange={v => updateField('elite_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sottotitolo (IT)" value={copy.elite_subtitle_it} onChange={v => updateField('elite_subtitle_it', v)} />
                    <FieldText label="Sottotitolo (EN)" value={copy.elite_subtitle_en} onChange={v => updateField('elite_subtitle_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.elite_intro_it} onChange={v => updateField('elite_intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.elite_intro_en} onChange={v => updateField('elite_intro_en', v)} />
                </div>

                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Sotto-sezioni ({copy.elite_sections.length})</h4>
                    {copy.elite_sections.map((sec, i) => (
                        <SectionCard
                            key={sec.id}
                            section={sec}
                            first={i === 0}
                            last={i === copy.elite_sections.length - 1}
                            onChange={(patch) => updateEliteSection(i, patch)}
                            onMoveUp={() => moveEliteSection(i, -1)}
                            onMoveDown={() => moveEliteSection(i, 1)}
                            onRemove={() => removeEliteSection(i)}
                        />
                    ))}
                    <button
                        onClick={addEliteSection}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi sotto-sezione
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-black/5">
                    <FieldText label="CTA finale — Titolo (IT)" value={copy.elite_cta_title_it} onChange={v => updateField('elite_cta_title_it', v)} />
                    <FieldText label="CTA finale — Titolo (EN)" value={copy.elite_cta_title_en} onChange={v => updateField('elite_cta_title_en', v)} />
                    <FieldTextArea label="CTA finale — Testo (IT)" value={copy.elite_cta_text_it} onChange={v => updateField('elite_cta_text_it', v)} />
                    <FieldTextArea label="CTA finale — Testo (EN)" value={copy.elite_cta_text_en} onChange={v => updateField('elite_cta_text_en', v)} />
                    <FieldText label="Bottone se non loggato (IT)" value={copy.elite_cta_logged_out_it} onChange={v => updateField('elite_cta_logged_out_it', v)} />
                    <FieldText label="Bottone se non loggato (EN)" value={copy.elite_cta_logged_out_en} onChange={v => updateField('elite_cta_logged_out_en', v)} />
                    <FieldText label="Bottone se loggato (IT)" value={copy.elite_cta_logged_in_it} onChange={v => updateField('elite_cta_logged_in_it', v)} />
                    <FieldText label="Bottone se loggato (EN)" value={copy.elite_cta_logged_in_en} onChange={v => updateField('elite_cta_logged_in_en', v)} />
                </div>
            </section>

            {/* REWARD SYSTEM */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sezione "Come funziona il Reward"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.reward_title_it} onChange={v => updateField('reward_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.reward_title_en} onChange={v => updateField('reward_title_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.reward_intro_it} onChange={v => updateField('reward_intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.reward_intro_en} onChange={v => updateField('reward_intro_en', v)} />
                </div>

                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Voci reward ({copy.reward_items.length})</h4>
                    {copy.reward_items.map((item, i) => (
                        <RewardItemCard
                            key={i}
                            item={item}
                            first={i === 0}
                            last={i === copy.reward_items.length - 1}
                            onChange={(patch) => updateRewardItem(i, patch)}
                            onMoveUp={() => moveRewardItem(i, -1)}
                            onMoveDown={() => moveRewardItem(i, 1)}
                            onRemove={() => removeRewardItem(i)}
                        />
                    ))}
                    <button
                        onClick={addRewardItem}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi voce reward
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-black/5">
                    <FieldText label="Footnote (IT)" value={copy.reward_footnote_it} onChange={v => updateField('reward_footnote_it', v)} />
                    <FieldText label="Footnote (EN)" value={copy.reward_footnote_en} onChange={v => updateField('reward_footnote_en', v)} />
                </div>
            </section>
        </div>
    )
}

function FieldTextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">{label}</span>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={2}
                className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
            />
        </label>
    )
}

function RewardItemCard({
    item, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    item: MembershipRewardItem
    first: boolean
    last: boolean
    onChange: (patch: Partial<MembershipRewardItem>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{item.label_it || '(senza titolo)'}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700">{item.reward}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-2">
                <input type="text" value={item.label_it} onChange={e => onChange({ label_it: e.target.value })} placeholder="Etichetta IT" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={item.label_en} onChange={e => onChange({ label_en: e.target.value })} placeholder="Label EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={item.reward} onChange={e => onChange({ reward: e.target.value })} placeholder='Reward (es. "2%")' className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-center font-semibold" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input type="text" value={item.note_it ?? ''} onChange={e => onChange({ note_it: e.target.value || null })} placeholder="Nota IT (opzionale)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]" />
                <input type="text" value={item.note_en ?? ''} onChange={e => onChange({ note_en: e.target.value || null })} placeholder="Note EN (optional)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]" />
            </div>
        </div>
    )
}

// ─── Placeholder for upcoming sections ───────────────────────────────────────
function PlaceholderSection({ title }: { title: string }) {
    return (
        <div className="space-y-3 text-center py-12">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h2 className="text-[18px] font-semibold tracking-tight text-[#1d1d1f]">{title}</h2>
            <p className="text-[13px] text-[#6e6e73] max-w-md mx-auto">
                Editor in arrivo. Le modifiche a questa pagina del sito saranno gestibili da qui non appena la migrazione del testo sara' completata.
            </p>
        </div>
    )
}
