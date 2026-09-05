/**
 * SitoTab — l'onglet "Sito" del gestionale.
 *
 * Permette di modificare i testi visibili su dr7.app senza sviluppatore
 * ne' redeploy: ogni sezione scrive in
 * `centralina_pro_config.config.site_copy.*` e il sito li rilegge tramite
 * `utils/siteCopy.ts`, con il testo di default come fallback.
 *
 * Struttura (rifatta il 26/08/2026):
 *   - `sito/sitoSiteMap.ts`     l'alberatura REALE di dr7.app. Una voce
 *                               della nav = una pagina del sito, alla sua
 *                               URL vera. Le pagine senza editor restano
 *                               elencate e marcate "Nel codice".
 *   - `sito/siteCopyDefaults.ts` GENERATO da Sito/utils/siteCopy.ts. Prima
 *                               i default erano ricopiati a mano qui e
 *                               avevano derivato: 1063 campi su 1272 non
 *                               corrispondevano piu' al sito, per lo piu'
 *                               caselle vuote dove dr7.app mostra testo.
 *                               Non ridichiarare quei valori in questo
 *                               file: rigenerare con `npm run sito:gen`.
 *
 * Controlli:  `npm run sito:check` verifica che i default siano allineati
 * al sito e che ogni editor sia raggiungibile dalla nav (un editor non
 * montato salva in DB senza che nessuno possa aprirlo).
 *
 * Accesso:
 *   - `role:sito-direzione` in admins.permissions -> nessun OTP
 *   - tutti gli altri -> OTP `gestione_sito_access` (apertura tab) e
 *     `gestione_sito_write` (salvataggio)
 */import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ScheletroPagina, ScheletroTesto } from '../../../components/Scheletro'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'
import MoneyInput from '../../../components/MoneyInput'
// Alberatura reale di dr7.app: una voce dell'onglet = una pagina del sito.
import {
    SITO_AREAS,
    SITO_SCREENS,
    SCREENS_BY_AREA,
    MANAGED_COUNT,
    TOTAL_COUNT,
    publicUrl,
    type SitoScreen,
} from './sito/sitoSiteMap'
// Schema + testi di default del sito: GENERATI da Sito/utils/siteCopy.ts
// (node scripts/genSiteCopyDefaults.mjs). Non ridichiarare qui: ogni copia
// manuale ricrea il disallineamento fra il gestionale e dr7.app.
import type {
    AboutCopy,
    AboutFounder,
    AirportItem,
    AspettoCopy,
    LogoAlignment,
    AviationMarineCopy,
    AviationMarineItem,
    AviationMarineSpec,
    AviationMarineSpecKey,
    AviationQuoteCopy,
    BilingualLocationItem,
    BilingualParagraph,
    BookingCopy,
    BookingSearchBoxCopy,
    CancellazioneBlock,
    CancellazioneCopy,
    CancellazioneSection,
    CarWashCopy,
    CareersCopy,
    CareersJob,
    CheckEmailCopy,
    ConfirmationSuccessCopy,
    ContactCopy,
    CreditPackage,
    CreditWalletCopy,
    Dr7ClubPlanCopy,
    FaqCopy,
    FaqEntry,
    FirmaCopy,
    FlottaCopy,
    FooterCopy,
    FooterLink,
    FooterSocialIcon,
    FooterSocialLink,
    FranchisingBenefit,
    FranchisingBenefitIcon,
    FranchisingCopy,
    FranchisingExpansionIcon,
    FranchisingExpansionLocation,
    HeaderCopy,
    HomeCategoryOverride,
    HomeCopy,
    HomeExperience,
    HomeMetric,
    HomeSlide,
    InvestitoriCopy,
    InvestitoriInfoItem,
    InvestitoriStrength,
    JetSearchResultsCopy,
    LegalCopy,
    LegalPageCopy,
    LegalPageId,
    LegalSection,
    LocationsCopy,
    MechanicalCopy,
    MechanicalHowStep,
    MembershipCopy,
    MembershipRewardItem,
    PaymentCancelCopy,
    PaymentCopy,
    PaymentSuccessCopy,
    PressArticle,
    PressCopy,
    RegistrazioneClienteCopy,
    SignUpCopy,
    SimpleLocationItem,
    SiteCopySnapshot,
    TokenCopy,
} from './sito/siteCopyDefaults'
import {
    INITIAL_ABOUT,
    INITIAL_AVIATION_MARINE,
    INITIAL_AVIATION_QUOTE,
    INITIAL_BOOKING,
    INITIAL_BOOKING_SEARCH_BOX,
    INITIAL_CANCELLAZIONE,
    INITIAL_CAREERS,
    INITIAL_CARWASH,
    INITIAL_CHECK_EMAIL,
    INITIAL_CONFIRMATION_SUCCESS,
    INITIAL_CONTACT,
    INITIAL_CREDIT_WALLET,
    INITIAL_DR7_CLUB_PLAN,
    INITIAL_FAQ,
    INITIAL_FIRMA,
    INITIAL_FOOTER,
    INITIAL_FRANCHISING,
    INITIAL_ASPETTO,
    INITIAL_HEADER,
    INITIAL_HOME,
    INITIAL_INVESTITORI,
    INITIAL_JET_SEARCH,
    INITIAL_LEGAL,
    INITIAL_LOCATIONS,
    INITIAL_MECHANICAL,
    INITIAL_MEMBERSHIP,
    INITIAL_PAYMENT,
    INITIAL_PAYMENT_CANCEL,
    INITIAL_PAYMENT_SUCCESS,
    INITIAL_PRESS,
    INITIAL_REGISTRAZIONE_CLIENTE,
    INITIAL_SIGNUP,
    INITIAL_TOKEN,
} from './sito/siteCopyDefaults'


// ─── Whitelist ───────────────────────────────────────────────────────────────
// Strict: only direzione (Valerio + Ilenia) + developer (Ophe) can open the
// tab without OTP. Everyone else requires gestione_sito_access OTP.
// Whitelist Sito CMS write bypass: chi ha `role:sito-direzione` in admins.permissions
// (failsafe valerio/ilenia/ophe). Per editare i testi senza OTP.

// ─── Schermate del sito ──────────────────────────────────────────────────────
// L'elenco non vive piu' qui: e' `sito/sitoSiteMap.ts`, ricavato dalle route
// reali di dr7.app. Una sezione dell'onglet = una schermata del sito, alla
// sua URL vera. `screen.editor` dice quale editor la gestisce (null = testi
// ancora nel codice, e l'onglet lo dichiara invece di far finta di niente).


const LEGAL_PAGE_DEFAULTS: Record<LegalPageId, { title_it: string; title_en: string }> = {
    privacy:          { title_it: 'Informativa sulla Privacy',     title_en: 'Privacy Policy' },
    cookie:           { title_it: 'Cookie Policy',                 title_en: 'Cookie Policy' },
    rental_agreement: { title_it: 'Contratto di Noleggio (Riassunto)', title_en: 'Rental Agreement (Overview)' },
    terms:            { title_it: 'Termini di Servizio',           title_en: 'Terms of Service' },
}

function emptyLegalPage(id: LegalPageId): LegalPageCopy {
    return {
        id,
        enabled: false,
        title_it: LEGAL_PAGE_DEFAULTS[id].title_it,
        title_en: LEGAL_PAGE_DEFAULTS[id].title_en,
        last_updated_dynamic: id === 'privacy' || id === 'cookie',
        last_updated_label_it: id === 'privacy' ? 'Ultimo aggiornamento' : id === 'cookie' ? 'Ultimo Aggiornamento' : '',
        last_updated_label_en: id === 'privacy' || id === 'cookie' ? 'Last updated' : '',
        intro_blocks: [],
        sections: [],
        outro_blocks: [],
    }
}

const SPEC_KEY_LABEL: Record<AviationMarineSpecKey, string> = {
    passengers: 'Passeggeri',
    year: 'Anno',
    type: 'Tipo',
    range: 'Autonomia',
    speed: 'Velocità',
    guests: 'Ospiti',
    length: 'Lunghezza',
    cabins: 'Cabine',
}

// ─── Stato locale del tab ────────────────────────────────────────────────
// Seed della sezione Flotta. Resta qui perche' e' l'unica sezione senza
// equivalente nel sito: il sito legge la lista, non ha un proprio default
// da generare.
//
// `mode` NON viene inizializzato di proposito. Il tab Sito riscrive l'intero
// snapshot a ogni salvataggio, anche di sotto-tab diverse: se il seed
// portasse un mode, salvare (per dire) la Home imporrebbe una scelta sulla
// Flotta che l'operatore non ha mai fatto. Senza mode il sito legge la riga
// come "mai configurata" e mostra tutte le categorie, esattamente come prima.
// Il mode compare solo quando l'operatore tocca davvero questa sezione.
const INITIAL_FLOTTA: FlottaCopy = { visible_category_ids: [] }

interface CurrentState {
    flotta: FlottaCopy
    faq: FaqCopy
    cancellazione: CancellazioneCopy
    membership: MembershipCopy
    home: HomeCopy
    about: AboutCopy
    footer: FooterCopy
    legal: LegalCopy
    careers: CareersCopy
    press: PressCopy
    contact: ContactCopy
    mechanical: MechanicalCopy
    carwash: CarWashCopy
    investitori: InvestitoriCopy
    franchising: FranchisingCopy
    aviationQuote: AviationQuoteCopy
    checkEmail: CheckEmailCopy
    jetSearchResults: JetSearchResultsCopy
    confirmationSuccess: ConfirmationSuccessCopy
    header: HeaderCopy
    signUp: SignUpCopy
    payment: PaymentCopy
    paymentSuccess: PaymentSuccessCopy
    booking: BookingCopy
    creditWallet: CreditWalletCopy
    token: TokenCopy
    firma: FirmaCopy
    registrazioneCliente: RegistrazioneClienteCopy
    bookingSearchBox: BookingSearchBoxCopy
    paymentCancel: PaymentCancelCopy
    locations: LocationsCopy
    aviationMarine: AviationMarineCopy
    dr7ClubPlan: Dr7ClubPlanCopy
    aspetto: Required<AspettoCopy>
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

// ─── WhatsApp template cross-link banner ────────────────────────────────
// Shown at the top of any Sito sub-tab whose page also sends a WhatsApp
// message. The message bodies live in `system_messages` (Messaggi di
// Sistema Pro tab), NOT in `site_copy` — this banner makes the split
// navigable instead of confusing.
function WhatsAppTemplateNotice({ keys }: { keys: { key: string; label: string }[] }) {
    return (
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/15 text-green-600 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.592 2.654-.698c1.09.587 2.107.89 3.037.89h.007c3.181 0 5.768-2.587 5.768-5.776 0-3.183-2.585-5.769-5.769-5.769z" />
                </svg>
            </div>
            <div className="flex-1 text-[13px] text-theme-text-secondary">
                <p>
                    Questa pagina invia anche messaggi WhatsApp ai clienti. I <strong className="text-theme-text-primary">testi dei messaggi</strong> vivono in{' '}
                    <strong className="text-theme-text-primary">Messaggi di Sistema Pro</strong> (un tab dedicato), non qui — qui modifichi solo la pagina del sito.
                </p>
                <ul className="mt-2 space-y-1">
                    {keys.map(k => (
                        <li key={k.key} className="flex items-center gap-2">
                            <code className="text-[11px] bg-theme-bg-tertiary px-1.5 py-0.5 rounded font-mono">{k.key}</code>
                            <span className="text-theme-text-muted">→</span>
                            <span>{k.label}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

// ─── Navigazione: l'alberatura di dr7.app ────────────────────────────────
// Le voci sono le schermate reali del sito, raggruppate come nel menu
// ESPLORA e mostrate con la loro URL. Le schermate senza editor restano
// visibili, marcate "Nel codice": l'elenco deve essere la fotografia del
// sito, non solo la lista di cio' che sappiamo gia' modificare.
function SitoSidebar({ screenId, onSelect }: { screenId: string; onSelect: (id: string) => void }) {
    const [query, setQuery] = useState('')
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
    const activeArea = SITO_SCREENS.find(s => s.id === screenId)?.area
    const q = query.trim().toLowerCase()
    const groups = SCREENS_BY_AREA
        .map(({ area, screens }) => ({
            area,
            screens: screens.filter(s =>
                q === '' ||
                s.label.toLowerCase().includes(q) ||
                s.path.toLowerCase().includes(q)),
        }))
        .filter(g => g.screens.length > 0)

    return (
        <div className="bg-theme-bg-primary rounded-2xl p-3 border border-theme-border shadow-sm space-y-3">
            <div className="relative">
                <input
                    type="search"
                    placeholder="Cerca una pagina o una URL…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl text-[13px] bg-theme-bg-secondary border border-transparent focus:bg-theme-bg-primary focus:border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-secondary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="11" cy="11" r="7" />
                    <path strokeLinecap="round" d="m20 20-3-3" />
                </svg>
            </div>

            <p className="px-3 text-[11px] text-theme-text-secondary">
                <strong className="text-theme-text-primary">{MANAGED_COUNT}</strong> schermate su {TOTAL_COUNT} modificabili da qui.
            </p>

            {groups.length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-theme-text-secondary">Nessuna pagina corrisponde.</p>
            )}

            {groups.map(({ area, screens }) => {
                const isOpen = q !== '' || !collapsed[area.id] || area.id === activeArea
                return (
                    <div key={area.id}>
                        <button
                            type="button"
                            onClick={() => q === '' && setCollapsed(s => ({ ...s, [area.id]: !s[area.id] }))}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-theme-text-secondary hover:text-theme-text-primary"
                            title={area.description}
                        >
                            <span>{area.label}</span>
                            <span className="flex items-center gap-1.5">
                                <span className="text-[10px] font-semibold bg-theme-bg-secondary rounded-full px-1.5 py-0.5">{screens.length}</span>
                                {q === '' && (
                                    <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="currentColor"><path d="M6 8 1 3h10z" /></svg>
                                )}
                            </span>
                        </button>
                        {isOpen && (
                            <ul className="space-y-0.5 mt-1">
                                {screens.map(s => {
                                    const active = screenId === s.id
                                    return (
                                        <li key={s.id}>
                                            <button
                                                onClick={() => onSelect(s.id)}
                                                className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${
                                                    active
                                                        ? 'bg-blue-500 text-white shadow-sm'
                                                        : 'text-theme-text-primary hover:bg-theme-bg-secondary'
                                                }`}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className="flex-1 text-[13px] font-medium">{s.label}</span>
                                                    {!s.editor && (
                                                        <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                                            active ? 'bg-white/20 text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary'
                                                        }`}>Nel codice</span>
                                                    )}
                                                </span>
                                                <span className={`block text-[10px] font-mono mt-0.5 truncate ${active ? 'text-white/70' : 'text-theme-text-muted'}`}>
                                                    {s.path}
                                                </span>
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

// ─── Intestazione della schermata aperta ─────────────────────────────────
// Dice all'operatore QUALE pagina di dr7.app sta modificando, con il link
// per aprirla e confrontare prima di salvare.
function ScreenHeader({ screen }: { screen: SitoScreen }) {
    const area = SITO_AREAS.find(a => a.id === screen.area)
    const url = publicUrl(screen)
    return (
        <div className="mb-6 pb-4 border-b border-theme-border">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-bold text-theme-text-secondary">{area?.label}</p>
                    <h2 className="text-[20px] font-semibold text-theme-text-primary mt-0.5">{screen.label}</h2>
                    <p className="text-[12px] font-mono text-theme-text-muted mt-1">
                        {url ? `dr7.app${screen.path}` : screen.path}
                    </p>
                    {screen.note && (
                        <p className="text-[12px] text-theme-text-secondary mt-2 max-w-2xl">{screen.note}</p>
                    )}
                </div>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-theme-bg-secondary hover:bg-theme-bg-tertiary text-theme-text-primary border border-theme-border"
                    >
                        Apri la pagina
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>
                    </a>
                )}
            </div>
        </div>
    )
}

// ─── Schermata non ancora gestita dal CMS ────────────────────────────────
// Meglio dirlo che lasciare un pannello vuoto: l'operatore sa subito che
// serve uno sviluppatore, e lo sviluppatore sa quale file aprire.
function ScreenNotManaged({ screen }: { screen: SitoScreen }) {
    return (
        <div className="rounded-2xl border border-dashed border-theme-border p-8 text-center">
            <div className="w-11 h-11 mx-auto mb-3 rounded-2xl bg-theme-bg-secondary text-theme-text-secondary flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></svg>
            </div>
            <p className="text-[15px] font-semibold text-theme-text-primary">Testi ancora nel codice</p>
            <p className="text-[13px] text-theme-text-secondary mt-1.5 max-w-md mx-auto">
                Questa pagina esiste su dr7.app ma i suoi testi non sono ancora modificabili da qui.
                Per cambiarli serve una modifica al sito.
            </p>
            <p className="mt-4 text-[12px] text-theme-text-muted">
                File nel repo del sito:{' '}
                <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded font-mono text-theme-text-secondary">{screen.file}</code>
            </p>
        </div>
    )
}


// ─── Component ───────────────────────────────────────────────────────────────
export default function SitoTab() {
    const { loading: roleLoading, hasRole } = useAdminRole()
    const isDirezione = hasRole('sito-direzione')
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
    // Si parte dalla Home, come il visitatore su dr7.app.
    const [screenId, setScreenId] = useState<string>('hero')
    const screen = SITO_SCREENS.find(s => s.id === screenId) ?? SITO_SCREENS[0]
    // Piu' schermate possono condividere un editor (es. Yacht e Jet).
    const section = screen.editor

    // ─── State (current + saved snapshots per section) ───────────────────────
    const [flotta, setFlotta] = useState<FlottaCopy>(INITIAL_FLOTTA)
    const [savedFlotta, setSavedFlotta] = useState<FlottaCopy>(INITIAL_FLOTTA)
    const [faq, setFaq] = useState<FaqCopy>(INITIAL_FAQ)
    const [savedFaq, setSavedFaq] = useState<FaqCopy>(INITIAL_FAQ)
    const [cancellazione, setCancellazione] = useState<CancellazioneCopy>(INITIAL_CANCELLAZIONE)
    const [savedCancellazione, setSavedCancellazione] = useState<CancellazioneCopy>(INITIAL_CANCELLAZIONE)
    const [membership, setMembership] = useState<MembershipCopy>(INITIAL_MEMBERSHIP)
    const [savedMembership, setSavedMembership] = useState<MembershipCopy>(INITIAL_MEMBERSHIP)
    const [home, setHome] = useState<HomeCopy>(INITIAL_HOME)
    const [savedHome, setSavedHome] = useState<HomeCopy>(INITIAL_HOME)
    const [about, setAbout] = useState<AboutCopy>(INITIAL_ABOUT)
    const [savedAbout, setSavedAbout] = useState<AboutCopy>(INITIAL_ABOUT)
    const [footer, setFooter] = useState<FooterCopy>(INITIAL_FOOTER)
    const [savedFooter, setSavedFooter] = useState<FooterCopy>(INITIAL_FOOTER)
    const [legal, setLegal] = useState<LegalCopy>(INITIAL_LEGAL)
    const [savedLegal, setSavedLegal] = useState<LegalCopy>(INITIAL_LEGAL)
    const [careers, setCareers] = useState<CareersCopy>(INITIAL_CAREERS)
    const [savedCareers, setSavedCareers] = useState<CareersCopy>(INITIAL_CAREERS)
    const [press, setPress] = useState<PressCopy>(INITIAL_PRESS)
    const [savedPress, setSavedPress] = useState<PressCopy>(INITIAL_PRESS)
    const [contact, setContact] = useState<ContactCopy>(INITIAL_CONTACT)
    const [savedContact, setSavedContact] = useState<ContactCopy>(INITIAL_CONTACT)
    const [mechanical, setMechanical] = useState<MechanicalCopy>(INITIAL_MECHANICAL)
    const [savedMechanical, setSavedMechanical] = useState<MechanicalCopy>(INITIAL_MECHANICAL)
    const [carwash, setCarwash] = useState<CarWashCopy>(INITIAL_CARWASH)
    const [savedCarwash, setSavedCarwash] = useState<CarWashCopy>(INITIAL_CARWASH)
    const [investitori, setInvestitori] = useState<InvestitoriCopy>(INITIAL_INVESTITORI)
    const [savedInvestitori, setSavedInvestitori] = useState<InvestitoriCopy>(INITIAL_INVESTITORI)
    const [franchising, setFranchising] = useState<FranchisingCopy>(INITIAL_FRANCHISING)
    const [savedFranchising, setSavedFranchising] = useState<FranchisingCopy>(INITIAL_FRANCHISING)
    const [aviationQuote, setAviationQuote] = useState<AviationQuoteCopy>(INITIAL_AVIATION_QUOTE)
    const [savedAviationQuote, setSavedAviationQuote] = useState<AviationQuoteCopy>(INITIAL_AVIATION_QUOTE)
    const [checkEmail, setCheckEmail] = useState<CheckEmailCopy>(INITIAL_CHECK_EMAIL)
    const [savedCheckEmail, setSavedCheckEmail] = useState<CheckEmailCopy>(INITIAL_CHECK_EMAIL)
    const [jetSearchResults, setJetSearchResults] = useState<JetSearchResultsCopy>(INITIAL_JET_SEARCH)
    const [savedJetSearchResults, setSavedJetSearchResults] = useState<JetSearchResultsCopy>(INITIAL_JET_SEARCH)
    const [confirmationSuccess, setConfirmationSuccess] = useState<ConfirmationSuccessCopy>(INITIAL_CONFIRMATION_SUCCESS)
    const [savedConfirmationSuccess, setSavedConfirmationSuccess] = useState<ConfirmationSuccessCopy>(INITIAL_CONFIRMATION_SUCCESS)
    const [header, setHeader] = useState<HeaderCopy>(INITIAL_HEADER)
    const [savedHeader, setSavedHeader] = useState<HeaderCopy>(INITIAL_HEADER)
    const [signUp, setSignUp] = useState<SignUpCopy>(INITIAL_SIGNUP)
    const [savedSignUp, setSavedSignUp] = useState<SignUpCopy>(INITIAL_SIGNUP)
    const [payment, setPayment] = useState<PaymentCopy>(INITIAL_PAYMENT)
    const [savedPayment, setSavedPayment] = useState<PaymentCopy>(INITIAL_PAYMENT)
    const [paymentSuccess, setPaymentSuccess] = useState<PaymentSuccessCopy>(INITIAL_PAYMENT_SUCCESS)
    const [savedPaymentSuccess, setSavedPaymentSuccess] = useState<PaymentSuccessCopy>(INITIAL_PAYMENT_SUCCESS)
    const [booking, setBooking] = useState<BookingCopy>(INITIAL_BOOKING)
    const [savedBooking, setSavedBooking] = useState<BookingCopy>(INITIAL_BOOKING)
    const [creditWallet, setCreditWallet] = useState<CreditWalletCopy>(INITIAL_CREDIT_WALLET)
    const [savedCreditWallet, setSavedCreditWallet] = useState<CreditWalletCopy>(INITIAL_CREDIT_WALLET)
    const [token, setToken] = useState<TokenCopy>(INITIAL_TOKEN)
    const [savedToken, setSavedToken] = useState<TokenCopy>(INITIAL_TOKEN)
    const [firma, setFirma] = useState<FirmaCopy>(INITIAL_FIRMA)
    const [savedFirma, setSavedFirma] = useState<FirmaCopy>(INITIAL_FIRMA)
    const [registrazioneCliente, setRegistrazioneCliente] = useState<RegistrazioneClienteCopy>(INITIAL_REGISTRAZIONE_CLIENTE)
    const [savedRegistrazioneCliente, setSavedRegistrazioneCliente] = useState<RegistrazioneClienteCopy>(INITIAL_REGISTRAZIONE_CLIENTE)
    const [bookingSearchBox, setBookingSearchBox] = useState<BookingSearchBoxCopy>(INITIAL_BOOKING_SEARCH_BOX)
    const [savedBookingSearchBox, setSavedBookingSearchBox] = useState<BookingSearchBoxCopy>(INITIAL_BOOKING_SEARCH_BOX)
    const [paymentCancel, setPaymentCancel] = useState<PaymentCancelCopy>(INITIAL_PAYMENT_CANCEL)
    const [savedPaymentCancel, setSavedPaymentCancel] = useState<PaymentCancelCopy>(INITIAL_PAYMENT_CANCEL)
    const [locations, setLocations] = useState<LocationsCopy>(INITIAL_LOCATIONS)
    const [savedLocations, setSavedLocations] = useState<LocationsCopy>(INITIAL_LOCATIONS)
    const [aviationMarine, setAviationMarine] = useState<AviationMarineCopy>(INITIAL_AVIATION_MARINE)
    const [savedAviationMarine, setSavedAviationMarine] = useState<AviationMarineCopy>(INITIAL_AVIATION_MARINE)
    const [dr7ClubPlan, setDr7ClubPlan] = useState<Dr7ClubPlanCopy>(INITIAL_DR7_CLUB_PLAN)
    const [savedDr7ClubPlan, setSavedDr7ClubPlan] = useState<Dr7ClubPlanCopy>(INITIAL_DR7_CLUB_PLAN)
    const [aspetto, setAspetto] = useState<Required<AspettoCopy>>(INITIAL_ASPETTO)
    const [savedAspetto, setSavedAspetto] = useState<Required<AspettoCopy>>(INITIAL_ASPETTO)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        if (!tabUnlocked) return
        let cancelled = false
        ;(async () => {
            try {
                const remote = await loadPersisted()
                if (cancelled) return
                if (remote?.faq) {
                    // Accept legacy raw-array shape as well as the new FaqCopy object.
                    const next: FaqCopy = Array.isArray(remote.faq)
                        ? { ...INITIAL_FAQ, entries: remote.faq }
                        : {
                            eyebrow_it: remote.faq.eyebrow_it || INITIAL_FAQ.eyebrow_it,
                            eyebrow_en: remote.faq.eyebrow_en || INITIAL_FAQ.eyebrow_en,
                            page_title_it: remote.faq.page_title_it || INITIAL_FAQ.page_title_it,
                            page_title_en: remote.faq.page_title_en || INITIAL_FAQ.page_title_en,
                            subtitle_it: remote.faq.subtitle_it || INITIAL_FAQ.subtitle_it,
                            subtitle_en: remote.faq.subtitle_en || INITIAL_FAQ.subtitle_en,
                            entries: Array.isArray(remote.faq.entries) ? remote.faq.entries : INITIAL_FAQ.entries,
                        }
                    setFaq(next)
                    setSavedFaq(next)
                }
                if (remote?.cancellazione && Array.isArray(remote.cancellazione.sections)) {
                    setCancellazione(remote.cancellazione)
                    setSavedCancellazione(remote.cancellazione)
                }
                if (remote?.membership && Array.isArray(remote.membership.elite_sections)) {
                    setMembership(remote.membership)
                    setSavedMembership(remote.membership)
                }
                if (remote?.home && Array.isArray(remote.home.hero_slides)) {
                    setHome(remote.home)
                    setSavedHome(remote.home)
                }
                if (remote?.about && Array.isArray(remote.about.founders)) {
                    setAbout(remote.about)
                    setSavedAbout(remote.about)
                }
                if (remote?.footer && Array.isArray(remote.footer.social_links)) {
                    setFooter(remote.footer)
                    setSavedFooter(remote.footer)
                }
                if (remote?.legal && Array.isArray(remote.legal.pages)) {
                    // Ensure all 4 page slots exist (in case the seed missed one).
                    const byId = new Map(remote.legal.pages.map(p => [p.id, p]))
                    const merged: LegalCopy = {
                        pages: (['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[])
                            .map(id => byId.get(id) || emptyLegalPage(id)),
                    }
                    setLegal(merged)
                    setSavedLegal(merged)
                }
                if (remote?.careers && Array.isArray(remote.careers.jobs)) {
                    setCareers(remote.careers)
                    setSavedCareers(remote.careers)
                }
                if (remote?.press && Array.isArray(remote.press.articles)) {
                    setPress(remote.press)
                    setSavedPress(remote.press)
                }
                if (remote?.contact && remote.contact.email_address) {
                    setContact(remote.contact)
                    setSavedContact(remote.contact)
                }
                if (remote?.flotta && Array.isArray(remote.flotta.visible_category_ids)) {
                    setFlotta(remote.flotta)
                    setSavedFlotta(remote.flotta)
                }
                if (remote?.mechanical && remote.mechanical.hero_title) {
                    setMechanical(remote.mechanical)
                    setSavedMechanical(remote.mechanical)
                }
                if (remote?.carwash && remote.carwash.cart_title_it) {
                    setCarwash(remote.carwash)
                    setSavedCarwash(remote.carwash)
                }
                if (remote?.investitori && remote.investitori.hero_title) {
                    setInvestitori(remote.investitori)
                    setSavedInvestitori(remote.investitori)
                }
                if (remote?.franchising && remote.franchising.hero_h2) {
                    setFranchising(remote.franchising)
                    setSavedFranchising(remote.franchising)
                }
                if (remote?.aviationQuote && remote.aviationQuote.header_title_template_it) {
                    setAviationQuote(remote.aviationQuote)
                    setSavedAviationQuote(remote.aviationQuote)
                }
                if (remote?.checkEmail && remote.checkEmail.title_it) {
                    setCheckEmail(remote.checkEmail)
                    setSavedCheckEmail(remote.checkEmail)
                }
                if (remote?.jetSearchResults && remote.jetSearchResults.title_it) {
                    setJetSearchResults(remote.jetSearchResults)
                    setSavedJetSearchResults(remote.jetSearchResults)
                }
                if (remote?.confirmationSuccess && remote.confirmationSuccess.booking_title_it) {
                    setConfirmationSuccess(remote.confirmationSuccess)
                    setSavedConfirmationSuccess(remote.confirmationSuccess)
                }
                if (remote?.header && remote.header.explore_label_it) {
                    setHeader(remote.header)
                    setSavedHeader(remote.header)
                }
                if (remote?.signUp && remote.signUp.client_type_label_it) {
                    setSignUp(remote.signUp)
                    setSavedSignUp(remote.signUp)
                }
                if (remote?.payment && remote.payment.ready_title_it) {
                    setPayment(remote.payment)
                    setSavedPayment(remote.payment)
                }
                if (remote?.paymentSuccess && remote.paymentSuccess.success_title_it) {
                    setPaymentSuccess(remote.paymentSuccess)
                    setSavedPaymentSuccess(remote.paymentSuccess)
                }
                if (remote?.booking && remote.booking.auth_required_title_it) {
                    setBooking(remote.booking)
                    setSavedBooking(remote.booking)
                }
                if (remote?.creditWallet && remote.creditWallet.hero_intro_it) {
                    // `packages` e' arrivato dopo: le righe salvate prima non ce
                    // l'hanno e l'editor mostrerebbe zero pacchetti dove il sito
                    // ne mostra nove. Si riparte dal seed finche' non se ne salva
                    // una lista propria.
                    const cw: CreditWalletCopy = {
                        ...remote.creditWallet,
                        packages: Array.isArray(remote.creditWallet.packages)
                            ? remote.creditWallet.packages
                            : INITIAL_CREDIT_WALLET.packages,
                    }
                    setCreditWallet(cw)
                    setSavedCreditWallet(cw)
                }
                if (remote?.firma && remote.firma.otp_step1_title_it) {
                    setFirma(remote.firma)
                    setSavedFirma(remote.firma)
                }
                if (remote?.registrazioneCliente && remote.registrazioneCliente.intro_title_it) {
                    setRegistrazioneCliente(remote.registrazioneCliente)
                    setSavedRegistrazioneCliente(remote.registrazioneCliente)
                }
                if (remote?.bookingSearchBox && remote.bookingSearchBox.title_it) {
                    setBookingSearchBox(remote.bookingSearchBox)
                    setSavedBookingSearchBox(remote.bookingSearchBox)
                }
                if (remote?.paymentCancel && remote.paymentCancel.title_it) {
                    setPaymentCancel(remote.paymentCancel)
                    setSavedPaymentCancel(remote.paymentCancel)
                }
                if (remote?.locations && Array.isArray(remote.locations.airports)) {
                    setLocations(remote.locations)
                    setSavedLocations(remote.locations)
                }
                if (remote?.aviationMarine && (Array.isArray(remote.aviationMarine.yachts) || Array.isArray(remote.aviationMarine.jets) || Array.isArray(remote.aviationMarine.helis))) {
                    setAviationMarine(remote.aviationMarine)
                    setSavedAviationMarine(remote.aviationMarine)
                }
                if (remote?.dr7ClubPlan && remote.dr7ClubPlan.id) {
                    setDr7ClubPlan(remote.dr7ClubPlan)
                    setSavedDr7ClubPlan(remote.dr7ClubPlan)
                }
                // Aspetto: fusione sopra il seed, non sostituzione. Le altre
                // sezioni riconoscono una riga salvata da un campo di testo
                // pieno; qui i campi sono booleani e numeri, e `false` e' una
                // scelta legittima. Un campo aggiunto dopo deve ereditare il
                // valore di fabbrica, non arrivare `undefined` nel form.
                if (remote?.aspetto && typeof remote.aspetto === 'object') {
                    const merged: Required<AspettoCopy> = { ...INITIAL_ASPETTO }
                    for (const [k, v] of Object.entries(remote.aspetto)) {
                        if (v === undefined || v === null || v === '') continue
                        if (typeof v === 'number' && (!isFinite(v) || v <= 0)) continue
                        ;(merged as Record<string, unknown>)[k] = v
                    }
                    setAspetto(merged)
                    setSavedAspetto(merged)
                }
                if (remote?.token && remote.token.hero_title_it) {
                    setToken(remote.token)
                    setSavedToken(remote.token)
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
            { flotta, faq, cancellazione, membership, home, about, footer, legal, careers, press, contact, mechanical, carwash, investitori, franchising, aviationQuote, checkEmail, jetSearchResults, confirmationSuccess, header, signUp, payment, paymentSuccess, booking, creditWallet, token, firma, registrazioneCliente, bookingSearchBox, paymentCancel, locations, aviationMarine, dr7ClubPlan, aspetto },
            { flotta: savedFlotta, faq: savedFaq, cancellazione: savedCancellazione, membership: savedMembership, home: savedHome, about: savedAbout, footer: savedFooter, legal: savedLegal, careers: savedCareers, press: savedPress, contact: savedContact, mechanical: savedMechanical, carwash: savedCarwash, investitori: savedInvestitori, franchising: savedFranchising, aviationQuote: savedAviationQuote, checkEmail: savedCheckEmail, jetSearchResults: savedJetSearchResults, confirmationSuccess: savedConfirmationSuccess, header: savedHeader, signUp: savedSignUp, payment: savedPayment, paymentSuccess: savedPaymentSuccess, booking: savedBooking, creditWallet: savedCreditWallet, token: savedToken, firma: savedFirma, registrazioneCliente: savedRegistrazioneCliente, bookingSearchBox: savedBookingSearchBox, paymentCancel: savedPaymentCancel, locations: savedLocations, aviationMarine: savedAviationMarine, dr7ClubPlan: savedDr7ClubPlan, aspetto: savedAspetto }
        ),
        [flotta, savedFlotta, faq, savedFaq, cancellazione, savedCancellazione, membership, savedMembership, home, savedHome, about, savedAbout, footer, savedFooter, legal, savedLegal, careers, savedCareers, press, savedPress, contact, savedContact, mechanical, savedMechanical, carwash, savedCarwash, investitori, savedInvestitori, franchising, savedFranchising, aviationQuote, savedAviationQuote, checkEmail, savedCheckEmail, jetSearchResults, savedJetSearchResults, confirmationSuccess, savedConfirmationSuccess, header, savedHeader, signUp, savedSignUp, payment, savedPayment, paymentSuccess, savedPaymentSuccess, booking, savedBooking, creditWallet, savedCreditWallet, token, savedToken, firma, savedFirma, registrazioneCliente, savedRegistrazioneCliente, bookingSearchBox, savedBookingSearchBox, paymentCancel, savedPaymentCancel, locations, savedLocations, aviationMarine, savedAviationMarine, dr7ClubPlan, savedDr7ClubPlan, aspetto, savedAspetto]
    )
    const dirty = changes.length > 0

    // ─── Save / Discard (gated by OTP for non-direzione) ─────────────────────
    const [saving, setSaving] = useState(false)
    const pendingSaveRef = useRef<null | (() => Promise<void>)>(null)

    const doSave = async () => {
        setSaving(true)
        try {
            // Un pacchetto senza id il sito non lo mostra: l'id si completa qui.
            const creditWalletToSave = normalizeCreditPackagesForSave(creditWallet)
            if (JSON.stringify(creditWalletToSave) !== JSON.stringify(creditWallet)) setCreditWallet(creditWalletToSave)
            await savePersisted({ flotta, faq, cancellazione, membership, home, about, footer, legal, careers, press, contact, mechanical, carwash, investitori, franchising, aviationQuote, checkEmail, jetSearchResults, confirmationSuccess, header, signUp, payment, paymentSuccess, booking, creditWallet: creditWalletToSave, token, firma, registrazioneCliente, bookingSearchBox, paymentCancel, locations, aviationMarine, dr7ClubPlan, aspetto })
            setSavedFlotta(flotta)
            setSavedFaq(faq)
            setSavedCancellazione(cancellazione)
            setSavedMembership(membership)
            setSavedHome(home)
            setSavedAbout(about)
            setSavedFooter(footer)
            setSavedLegal(legal)
            setSavedCareers(careers)
            setSavedPress(press)
            setSavedContact(contact)
            setSavedMechanical(mechanical)
            setSavedCarwash(carwash)
            setSavedInvestitori(investitori)
            setSavedFranchising(franchising)
            setSavedAviationQuote(aviationQuote)
            setSavedCheckEmail(checkEmail)
            setSavedJetSearchResults(jetSearchResults)
            setSavedConfirmationSuccess(confirmationSuccess)
            setSavedHeader(header)
            setSavedSignUp(signUp)
            setSavedPayment(payment)
            setSavedPaymentSuccess(paymentSuccess)
            setSavedBooking(booking)
            setSavedCreditWallet(creditWalletToSave)
            setSavedToken(token)
            setSavedFirma(firma)
            setSavedRegistrazioneCliente(registrazioneCliente)
            setSavedBookingSearchBox(bookingSearchBox)
            setSavedPaymentCancel(paymentCancel)
            setSavedLocations(locations)
            setSavedAviationMarine(aviationMarine)
            setSavedDr7ClubPlan(dr7ClubPlan)
            setSavedAspetto(aspetto)
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
        // 2026-05-15: OTP gate rimosso per Sito write. Chi ha accesso alla
        // tab (gia' gated da gestione_sito_access) puo' salvare direttamente.
        void doSave()
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
        setFlotta(savedFlotta)
        setFaq(savedFaq)
        setCancellazione(savedCancellazione)
        setMembership(savedMembership)
        setHome(savedHome)
        setAbout(savedAbout)
        setFooter(savedFooter)
        setLegal(savedLegal)
        setCareers(savedCareers)
        setPress(savedPress)
        setContact(savedContact)
        setMechanical(savedMechanical)
        setCarwash(savedCarwash)
        setInvestitori(savedInvestitori)
        setFranchising(savedFranchising)
        setAviationQuote(savedAviationQuote)
        setCheckEmail(savedCheckEmail)
        setJetSearchResults(savedJetSearchResults)
        setConfirmationSuccess(savedConfirmationSuccess)
        setHeader(savedHeader)
        setSignUp(savedSignUp)
        setPayment(savedPayment)
        setPaymentSuccess(savedPaymentSuccess)
        setBooking(savedBooking)
        setCreditWallet(savedCreditWallet)
        setToken(savedToken)
        setFirma(savedFirma)
        setRegistrazioneCliente(savedRegistrazioneCliente)
        setBookingSearchBox(savedBookingSearchBox)
        setPaymentCancel(savedPaymentCancel)
        setLocations(savedLocations)
        setAviationMarine(savedAviationMarine)
        setDr7ClubPlan(savedDr7ClubPlan)
        setAspetto(savedAspetto)
    }

    // ─── Render ──────────────────────────────────────────────────────────────
    if (roleLoading) {
        return <div className="p-6"><ScheletroPagina righe={6} colonne={4} /></div>
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
        <div className="bg-theme-bg-secondary min-h-screen pb-32">
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
            <div className="px-6 pt-6 pb-4 bg-theme-bg-primary border-b border-theme-border">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-[28px] font-semibold tracking-tight text-theme-text-primary">Sito</h1>
                        <p className="text-[14px] text-theme-text-secondary mt-1">
                            Le pagine di dr7.app, nell'ordine in cui le trova un visitatore. {MANAGED_COUNT} su {TOTAL_COUNT} si modificano da qui.
                        </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Attivo
                    </span>
                </div>
            </div>

            {/* Body: side nav + content */}
            <div className="px-6 pt-6">
                <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6">
                    {/* Nav: l'alberatura di dr7.app, ricercabile */}
                    <aside>
                        <SitoSidebar
                            screenId={screenId}
                            onSelect={setScreenId}
                        />
                    </aside>

                    {/* Contenuto: intestazione della pagina + il suo editor */}
                    <main className="bg-theme-bg-primary rounded-2xl p-6 border border-theme-border shadow-sm min-h-[400px]">
                        <ScreenHeader screen={screen} />
                        {!hydrated && (
                            <ScheletroTesto righe={6} />
                        )}
                        {hydrated && !section && (
                            <ScreenNotManaged screen={screen} />
                        )}
                        {hydrated && section === 'pagamento' && (
                            <PaymentEditor copy={payment} setCopy={setPayment} />
                        )}
                        {hydrated && section === 'faq' && (
                            <FaqEditor copy={faq} setCopy={setFaq} />
                        )}
                        {hydrated && section === 'cancellazione' && (
                            <CancellazioneEditor copy={cancellazione} setCopy={setCancellazione} />
                        )}
                        {hydrated && section === 'membership' && (
                            <MembershipEditor copy={membership} setCopy={setMembership} />
                        )}
                        {hydrated && section === 'hero' && (
                            <HomeEditor copy={home} setCopy={setHome} />
                        )}
                        {hydrated && section === 'chi-siamo' && (
                            <AboutEditor copy={about} setCopy={setAbout} />
                        )}
                        {hydrated && section === 'footer' && (
                            <FooterEditor copy={footer} setCopy={setFooter} />
                        )}
                        {hydrated && section === 'legali' && (
                            <LegalEditor copy={legal} setCopy={setLegal} />
                        )}
                        {hydrated && section === 'careers' && (
                            <CareersEditor copy={careers} setCopy={setCareers} />
                        )}
                        {hydrated && section === 'press' && (
                            <PressEditor copy={press} setCopy={setPress} />
                        )}
                        {hydrated && section === 'contatti' && (
                            <ContactEditor copy={contact} setCopy={setContact} />
                        )}
                        {hydrated && section === 'flotta' && (
                            <FlottaEditor copy={flotta} setCopy={setFlotta} />
                        )}
                        {hydrated && section === 'meccanica' && (
                            <MechanicalEditor copy={mechanical} setCopy={setMechanical} />
                        )}
                        {hydrated && section === 'lavaggio' && (
                            <CarWashEditor copy={carwash} setCopy={setCarwash} />
                        )}
                        {hydrated && section === 'investitori' && (
                            <InvestitoriEditor copy={investitori} setCopy={setInvestitori} />
                        )}
                        {hydrated && section === 'franchising' && (
                            <FranchisingEditor copy={franchising} setCopy={setFranchising} />
                        )}
                        {hydrated && section === 'aviation' && (
                            <AviationQuoteEditor copy={aviationQuote} setCopy={setAviationQuote} />
                        )}
                        {hydrated && section === 'check-email' && (
                            <CheckEmailEditor copy={checkEmail} setCopy={setCheckEmail} />
                        )}
                        {hydrated && section === 'jet-search' && (
                            <JetSearchResultsEditor copy={jetSearchResults} setCopy={setJetSearchResults} />
                        )}
                        {hydrated && section === 'confirmation' && (
                            <ConfirmationSuccessEditor copy={confirmationSuccess} setCopy={setConfirmationSuccess} />
                        )}
                        {hydrated && section === 'header' && (
                            <HeaderEditor copy={header} setCopy={setHeader} />
                        )}
                        {hydrated && section === 'signup' && (
                            <SignUpEditor copy={signUp} setCopy={setSignUp} />
                        )}
                        {hydrated && section === 'payment-success' && (
                            <PaymentSuccessEditor copy={paymentSuccess} setCopy={setPaymentSuccess} />
                        )}
                        {hydrated && section === 'booking' && (
                            <BookingEditor copy={booking} setCopy={setBooking} />
                        )}
                        {hydrated && section === 'credit-wallet' && (
                            <CreditWalletEditor copy={creditWallet} setCopy={setCreditWallet} />
                        )}
                        {hydrated && section === 'token' && (
                            <TokenEditor copy={token} setCopy={setToken} />
                        )}
                        {hydrated && section === 'firma' && (
                            <FirmaEditor copy={firma} setCopy={setFirma} />
                        )}
                        {hydrated && section === 'registrazione-cliente' && (
                            <RegistrazioneClienteEditor copy={registrazioneCliente} setCopy={setRegistrazioneCliente} />
                        )}
                        {hydrated && section === 'booking-search-box' && (
                            <BookingSearchBoxEditor copy={bookingSearchBox} setCopy={setBookingSearchBox} />
                        )}
                        {hydrated && section === 'payment-cancel' && (
                            <PaymentCancelEditor copy={paymentCancel} setCopy={setPaymentCancel} />
                        )}
                        {hydrated && section === 'locations' && (
                            <LocationsEditor copy={locations} setCopy={setLocations} />
                        )}
                        {hydrated && section === 'yacht-jet-heli' && (
                            <AviationMarineEditor copy={aviationMarine} setCopy={setAviationMarine} />
                        )}
                        {hydrated && section === 'dr7-club-plan' && (
                            <Dr7ClubPlanEditor copy={dr7ClubPlan} setCopy={setDr7ClubPlan} />
                        )}
                        {hydrated && section === 'aspetto' && (
                            <AspettoEditor copy={aspetto} setCopy={setAspetto} />
                        )}
                    </main>
                </div>
            </div>

            {/* SaveBar */}
            {dirty && (
                <div className="fixed bottom-0 left-0 right-0 bg-theme-bg-primary border-t border-theme-border shadow-lg z-40">
                    <div className="px-6 py-3 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-theme-text-primary">
                            <b>{changes.length}</b> modific{changes.length === 1 ? 'a' : 'he'} non salvat{changes.length === 1 ? 'a' : 'e'}.
                            {' '}<span className="text-theme-text-secondary">{changes[0]}{changes.length > 1 ? `, +${changes.length - 1} altre` : ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleDiscard}
                                disabled={saving}
                                className="px-4 py-2 rounded-xl text-[13px] font-medium text-theme-text-primary bg-theme-bg-secondary hover:bg-theme-bg-tertiary disabled:opacity-50"
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
    // Flotta — diff sulle categorie visibili. Senza questo, le checkbox
    // dell'editor "Flotta (categorie visibili)" non rendevano il form dirty
    // e il bottone Salva restava disabilitato (bug "non riesco a salvare").
    {
        const cur = current.flotta?.visible_category_ids || []
        const sav = saved.flotta?.visible_category_ids || []
        const curSorted = [...cur].sort().join(',')
        const savSorted = [...sav].sort().join(',')
        if (curSorted !== savSorted) {
            out.push('Flotta: categorie visibili modificate')
        }
        // Anche il solo passaggio "tutte" <-> "scelgo io" e' una modifica:
        // senza questo, scegliere "Tutte le categorie" su una riga vecchia
        // non rende il form dirty e il bottone Salva resta spento.
        if ((current.flotta?.mode ?? null) !== (saved.flotta?.mode ?? null)) {
            out.push('Flotta: modalita\' di visibilita\' modificata')
        }
    }
    // FAQ — chrome (title/eyebrow/subtitle) + entries
    {
        const ce = current.faq.entries
        const se = saved.faq.entries
        const curIds = new Set(ce.map(e => e.id))
        const savIds = new Set(se.map(e => e.id))
        const added = ce.filter(e => !savIds.has(e.id))
        const removed = se.filter(e => !curIds.has(e.id))
        added.forEach(e => out.push(`FAQ: nuova "${e.question.slice(0, 40) || '(senza titolo)'}"`))
        removed.forEach(e => out.push(`FAQ: rimossa "${e.question.slice(0, 40) || e.id}"`))
        ce.forEach(c => {
            const s = se.find(x => x.id === c.id)
            if (!s) return
            if (c.question !== s.question || c.answer !== s.answer) {
                out.push(`FAQ: modificata "${(s.question || c.question).slice(0, 40)}"`)
            }
        })
        if (ce.length === se.length && added.length === 0 && removed.length === 0) {
            const reordered = ce.some((e, i) => se[i]?.id !== e.id)
            if (reordered) out.push('FAQ: ordine modificato')
        }
        // Chrome diff (title/eyebrow/subtitle)
        const chromeKeys: (keyof FaqCopy)[] = ['eyebrow_it', 'eyebrow_en', 'page_title_it', 'page_title_en', 'subtitle_it', 'subtitle_en']
        if (chromeKeys.some(k => current.faq[k] !== saved.faq[k])) {
            out.push('FAQ: titolo/eyebrow/sottotitolo modificati')
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
    // Home (same approach)
    if (JSON.stringify(current.home) !== JSON.stringify(saved.home)) {
        out.push('Home: contenuti modificati')
    }
    // About (same approach)
    if (JSON.stringify(current.about) !== JSON.stringify(saved.about)) {
        out.push('Chi Siamo: contenuti modificati')
    }
    // Footer (same approach)
    if (JSON.stringify(current.footer) !== JSON.stringify(saved.footer)) {
        out.push('Footer: contenuti modificati')
    }
    // Legal pages (per-page diff)
    const curById = new Map(current.legal.pages.map(p => [p.id, p]))
    const savById = new Map(saved.legal.pages.map(p => [p.id, p]))
    for (const id of ['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[]) {
        if (JSON.stringify(curById.get(id)) !== JSON.stringify(savById.get(id))) {
            out.push(`Legali / ${id}: contenuti modificati`)
        }
    }
    if (JSON.stringify(current.careers) !== JSON.stringify(saved.careers)) {
        out.push('Careers: contenuti modificati')
    }
    if (JSON.stringify(current.press) !== JSON.stringify(saved.press)) {
        out.push('Press: contenuti modificati')
    }
    if (JSON.stringify(current.contact) !== JSON.stringify(saved.contact)) {
        out.push('Contatti: contenuti modificati')
    }
    if (JSON.stringify(current.mechanical) !== JSON.stringify(saved.mechanical)) {
        out.push('Meccanica: contenuti modificati')
    }
    if (JSON.stringify(current.carwash) !== JSON.stringify(saved.carwash)) {
        out.push('Lavaggio: contenuti modificati')
    }
    if (JSON.stringify(current.investitori) !== JSON.stringify(saved.investitori)) {
        out.push('Investitori: contenuti modificati')
    }
    if (JSON.stringify(current.franchising) !== JSON.stringify(saved.franchising)) {
        out.push('Franchising: contenuti modificati')
    }
    if (JSON.stringify(current.aviationQuote) !== JSON.stringify(saved.aviationQuote)) {
        out.push('Aviation Quote: contenuti modificati')
    }
    if (JSON.stringify(current.checkEmail) !== JSON.stringify(saved.checkEmail)) {
        out.push('Check Email: contenuti modificati')
    }
    if (JSON.stringify(current.jetSearchResults) !== JSON.stringify(saved.jetSearchResults)) {
        out.push('Jet Search Results: contenuti modificati')
    }
    if (JSON.stringify(current.confirmationSuccess) !== JSON.stringify(saved.confirmationSuccess)) {
        out.push('Conferma Prenotazione: contenuti modificati')
    }
    if (JSON.stringify(current.header) !== JSON.stringify(saved.header)) {
        out.push('Header: contenuti modificati')
    }
    if (JSON.stringify(current.signUp) !== JSON.stringify(saved.signUp)) {
        out.push('Registrazione Cliente: contenuti modificati')
    }
    if (JSON.stringify(current.payment) !== JSON.stringify(saved.payment)) {
        out.push('Pagina Pagamento: contenuti modificati')
    }
    if (JSON.stringify(current.paymentSuccess) !== JSON.stringify(saved.paymentSuccess)) {
        out.push('Pagamento Riuscito: contenuti modificati')
    }
    if (JSON.stringify(current.booking) !== JSON.stringify(saved.booking)) {
        out.push('Prenotazione: contenuti modificati')
    }
    if (JSON.stringify(current.creditWallet) !== JSON.stringify(saved.creditWallet)) {
        out.push('Credit Wallet: contenuti modificati')
    }
    if (JSON.stringify(current.token) !== JSON.stringify(saved.token)) {
        out.push('DR7 Token: contenuti modificati')
    }
    if (JSON.stringify(current.firma) !== JSON.stringify(saved.firma)) {
        out.push('Firma Contratto: contenuti modificati')
    }
    if (JSON.stringify(current.registrazioneCliente) !== JSON.stringify(saved.registrazioneCliente)) {
        out.push('Registrazione Cliente: contenuti modificati')
    }
    if (JSON.stringify(current.bookingSearchBox) !== JSON.stringify(saved.bookingSearchBox)) {
        out.push('Booking Search Box: contenuti modificati')
    }
    if (JSON.stringify(current.paymentCancel) !== JSON.stringify(saved.paymentCancel)) {
        out.push('Pagamento Annullato: contenuti modificati')
    }
    if (JSON.stringify(current.locations) !== JSON.stringify(saved.locations)) {
        out.push('Aeroporti & Luoghi: catalogo modificato')
    }
    if (JSON.stringify(current.aviationMarine) !== JSON.stringify(saved.aviationMarine)) {
        out.push('Yacht / Jet / Heli: catalogo modificato')
    }
    if (JSON.stringify(current.dr7ClubPlan) !== JSON.stringify(saved.dr7ClubPlan)) {
        out.push('DR7 Club — Piano & Benefit: modificato')
    }
    if (JSON.stringify(current.aspetto) !== JSON.stringify(saved.aspetto)) {
        out.push('Aspetto & Funzionalita: logo o widget modificati')
    }
    return out
}

// ─── FAQ editor ──────────────────────────────────────────────────────────────
function FaqEditor({
    copy,
    setCopy,
}: {
    copy: FaqCopy
    setCopy: (next: FaqCopy) => void
}) {
    const entries = copy.entries
    const updateField = <K extends keyof FaqCopy>(key: K, value: FaqCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    const setEntries = (next: FaqEntry[]) => setCopy({ ...copy, entries: next })
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
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">FAQ</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/faq</code>. Modifica titolo pagina, eyebrow, sottotitolo e voci.
                </p>
            </div>

            {/* Page chrome (title + eyebrow + subtitle) */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Eyebrow (IT) — es. "DR7 · Supporto"' value={copy.eyebrow_it} onChange={v => updateField('eyebrow_it', v)} />
                    <FieldText label="Eyebrow (EN)" value={copy.eyebrow_en} onChange={v => updateField('eyebrow_en', v)} />
                    <FieldText label='Titolo pagina (IT) — es. "Domande Frequenti"' value={copy.page_title_it} onChange={v => updateField('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => updateField('page_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => updateField('subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.subtitle_en} onChange={v => updateField('subtitle_en', v)} />
                </div>
            </section>

            <ul className="space-y-3">
                {entries.map((e, i) => (
                    <li key={e.id} className="border border-theme-border rounded-2xl p-4 bg-theme-bg-primary shadow-sm">
                        <div className="flex items-start gap-3">
                            {/* Reorder controls */}
                            <div className="flex flex-col gap-1 pt-1">
                                <button
                                    onClick={() => move(e.id, -1)}
                                    disabled={i === 0}
                                    className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                                    title="Sposta su"
                                ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button
                                    onClick={() => move(e.id, 1)}
                                    disabled={i === entries.length - 1}
                                    className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
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
                                        className="mt-1 w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-[14px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Risposta</span>
                                    <textarea
                                        value={e.answer}
                                        onChange={(ev) => update(e.id, { answer: ev.target.value })}
                                        placeholder="Es. Il conducente deve avere almeno 25 anni…"
                                        rows={3}
                                        className="mt-1 w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-[14px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
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
                className="w-full py-3 rounded-2xl border-2 border-dashed border-theme-border text-[13px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
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
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Cancellazione</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/cancellation</code>. Modifica titoli e paragrafi in italiano e inglese. I numeri (giorni soglia, % rimborso/penale) vengono dalle regole in Centralina Pro &gt; Automazioni e si inseriscono coi placeholder <code>{'{thresholdDays}'}</code>, <code>{'{refundPercent}'}</code>, <code>{'{penaltyPercent}'}</code>, <code>{'{daysWord}'}</code>.
                </p>
            </div>

            {/* Page header + footer fields */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Header & Footer pagina</h3>
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
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Sezioni ({copy.sections.length})</h3>
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
                    className="w-full py-3 rounded-2xl border-2 border-dashed border-theme-border text-[13px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
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
                className="mt-1 w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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
        : <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-theme-bg-secondary text-theme-text-secondary">Standard</span>

    return (
        <div className="border border-theme-border rounded-2xl bg-theme-bg-primary shadow-sm">
            <header className="px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex-1 text-left flex items-center gap-3"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-theme-text-secondary transition-transform ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>
                    <span className="text-[13px] font-semibold text-theme-text-primary flex-1 truncate">{section.title_it || '(senza titolo)'}</span>
                    {variantBadge}
                </button>
                <div className="flex items-center gap-1">
                    <button onClick={onMoveUp} disabled={first} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                    <button onClick={onMoveDown} disabled={last} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                    <button onClick={onRemove} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina sezione"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                </div>
            </header>

            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-theme-border pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldText label="Titolo sezione (IT)" value={section.title_it} onChange={v => onChange({ title_it: v })} />
                        <FieldText label="Titolo sezione (EN)" value={section.title_en} onChange={v => onChange({ title_en: v })} />
                    </div>
                    <label className="block">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Variante stile</span>
                        <select
                            value={section.variant}
                            onChange={(e) => onChange({ variant: e.target.value as 'standard' | 'flex' })}
                            className="mt-1 w-full md:w-48 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-theme-text-primary bg-theme-bg-secondary hover:bg-theme-bg-tertiary"
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
        <div className="border border-theme-border rounded-xl p-3 bg-[#fafafa]">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1">{typeLabel}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
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
                            className="mt-0.5 w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6]">English</span>
                        <textarea
                            value={block.text_en}
                            onChange={(e) => onChange({ ...block, text_en: e.target.value })}
                            rows={3}
                            className="mt-0.5 w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
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
            <label className="flex items-center gap-2 text-[11px] text-theme-text-secondary">
                <span>Tono:</span>
                <select
                    value={tone}
                    onChange={(e) => onChange({ tone: e.target.value as 'default' | 'green' })}
                    className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-0.5 text-[12px]"
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
                            className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]"
                        />
                        <input
                            type="text"
                            value={items_en[i] || ''}
                            onChange={(e) => updateEn(i, e.target.value)}
                            placeholder="bullet EN"
                            className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]"
                        />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveRow(i, 1)} disabled={i === len - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
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
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Membership / DR7 Club</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/membership</code>. I prezzi €/mese €/anno restano calcolati dai tier reali (constants/MEMBERSHIP_TIERS) — qui modifichi solo i testi. Placeholder utilizzabili: <code>{'{monthlyPrice}'}</code>, <code>{'{annualPrice}'}</code>, <code>{'{annualMonthly}'}</code>, <code>{'{annualSavings}'}</code>.
                </p>
            </div>

            {/* HERO */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
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
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Pricing card</h3>
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
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">DR7 Elite Rewards</h3>
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
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi sotto-sezione
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-theme-border">
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
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Sezione "Come funziona il Reward"</h3>
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
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi voce reward
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-theme-border">
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
                className="mt-1 w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
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
        <div className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{item.label_it || '(senza titolo)'}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700">{item.reward}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-2">
                <input type="text" value={item.label_it} onChange={e => onChange({ label_it: e.target.value })} placeholder="Etichetta IT" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={item.label_en} onChange={e => onChange({ label_en: e.target.value })} placeholder="Label EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={item.reward} onChange={e => onChange({ reward: e.target.value })} placeholder='Reward (es. "2%")' className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-center font-semibold" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input type="text" value={item.note_it ?? ''} onChange={e => onChange({ note_it: e.target.value || null })} placeholder="Nota IT (opzionale)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[12px]" />
                <input type="text" value={item.note_en ?? ''} onChange={e => onChange({ note_en: e.target.value || null })} placeholder="Note EN (optional)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[12px]" />
            </div>
        </div>
    )
}

// ─── Home / Hero editor ─────────────────────────────────────────────────────
const KNOWN_CATEGORY_IDS = [
    'cars', 'urban-cars', 'corporate-fleet', 'yachts', 'jets',
    'car-wash-services', 'mechanical-services', 'membership', 'credit-wallet',
]

function HomeEditor({
    copy,
    setCopy,
}: {
    copy: HomeCopy
    setCopy: (next: HomeCopy) => void
}) {
    const updateField = <K extends keyof HomeCopy>(key: K, value: HomeCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Slides
    const updateSlide = (idx: number, patch: Partial<HomeSlide>) => {
        const next = [...copy.hero_slides]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, hero_slides: next })
    }
    const moveSlide = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.hero_slides.length) return
        const next = [...copy.hero_slides]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, hero_slides: next })
    }
    const removeSlide = (idx: number) => {
        if (!confirm('Rimuovere questo video dal carosello hero?')) return
        setCopy({ ...copy, hero_slides: copy.hero_slides.filter((_, i) => i !== idx) })
    }
    const addSlide = () => {
        setCopy({
            ...copy,
            hero_slides: [...copy.hero_slides, { id: `slide-${Date.now().toString(36)}`, video_src: '/' }],
        })
    }
    // Righe di testo dello statement e del blocco marca: una riga per riga
    // dell'area di testo. E' il modo piu' diretto per far decidere
    // all'operatore DOVE va a capo una frase che sullo schermo e' enorme.
    const setLines = (key: 'statement_lines_it' | 'statement_lines_en' | 'brand_lines_it' | 'brand_lines_en', text: string) => {
        setCopy({ ...copy, [key]: text.split('\n').map(r => r.trim()).filter(Boolean) })
    }
    // Esperienze
    const updateExp = (idx: number, patch: Partial<HomeExperience>) => {
        const next = [...copy.experiences]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, experiences: next })
    }
    const moveExp = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.experiences.length) return
        const next = [...copy.experiences]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, experiences: next })
    }
    const removeExp = (idx: number) => {
        if (!confirm('Rimuovere questa esperienza dalla homepage? Il servizio resta online, sparisce solo la card.')) return
        setCopy({ ...copy, experiences: copy.experiences.filter((_, i) => i !== idx) })
    }
    const addExp = () => {
        setCopy({
            ...copy,
            experiences: [...copy.experiences, {
                id: `exp-${Date.now().toString(36)}`, to: '/', image_src: '/',
                title_it: '', title_en: '', copy_it: '', copy_en: '', cta_it: 'Scopri', cta_en: 'Discover',
            }],
        })
    }
    // Metriche: restano vuote finche' non ci sono numeri verificati.
    const updateMetric = (idx: number, patch: Partial<HomeMetric>) => {
        const next = [...copy.metrics]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, metrics: next })
    }
    const removeMetric = (idx: number) => setCopy({ ...copy, metrics: copy.metrics.filter((_, i) => i !== idx) })
    const addMetric = () => setCopy({ ...copy, metrics: [...copy.metrics, { id: `m-${Date.now().toString(36)}`, value: '', label_it: '', label_en: '' }] })
    // Paragrafi del blocco marca
    const updatePar = (idx: number, patch: Partial<{ text_it: string; text_en: string }>) => {
        const next = [...copy.brand_paragraphs]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, brand_paragraphs: next })
    }
    const removePar = (idx: number) => setCopy({ ...copy, brand_paragraphs: copy.brand_paragraphs.filter((_, i) => i !== idx) })
    const addPar = () => setCopy({ ...copy, brand_paragraphs: [...copy.brand_paragraphs, { text_it: '', text_en: '' }] })
    // Categories
    const updateCategory = (idx: number, patch: Partial<HomeCategoryOverride>) => {
        const next = [...copy.categories]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, categories: next })
    }
    const moveCategory = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.categories.length) return
        const next = [...copy.categories]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, categories: next })
    }
    const removeCategory = (idx: number) => {
        if (!confirm('Rimuovere questo override? La card mostrera\' i valori di default hardcoded.')) return
        setCopy({ ...copy, categories: copy.categories.filter((_, i) => i !== idx) })
    }
    const addCategory = () => {
        setCopy({
            ...copy,
            categories: [...copy.categories, { id: '', display_title_it: '', display_title_en: '', image_src: '/' }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Home / Hero</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/</code>. Modifica il titolo SEO, i video del carosello hero (path sotto <code>/public</code>) e le card categorie (titolo IT/EN + immagine). Le voci categoria sono override: se non c'e' override per un id, la card mostra il default hardcoded.
                </p>
            </div>

            {/* SEO */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">SEO</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    Titolo H1 nascosto nella pagina, indicizzato dai motori di ricerca. Non visibile nella UI.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="H1 SEO (IT)" value={copy.seo_h1_it} onChange={v => updateField('seo_h1_it', v)} />
                    <FieldText label="H1 SEO (EN)" value={copy.seo_h1_en} onChange={v => updateField('seo_h1_en', v)} />
                </div>
            </section>

            {/* Atto 01 — Arrivo */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Schermo d'apertura</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    Il primo schermo: un occhiello, un titolo, una riga, una CTA. Nel titolo
                    l'<strong>a capo</strong> si scrive andando a capo davvero: ogni riga diventa una riga
                    grande sullo schermo.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Occhiello (IT) — es. "Cagliari · Sardegna"' value={copy.hero_kicker_it} onChange={v => updateField('hero_kicker_it', v)} />
                    <FieldText label="Occhiello (EN)" value={copy.hero_kicker_en} onChange={v => updateField('hero_kicker_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Titolo (IT) — una riga per riga" value={copy.hero_headline_it} onChange={v => updateField('hero_headline_it', v)} />
                    <FieldTextArea label="Titolo (EN)" value={copy.hero_headline_en} onChange={v => updateField('hero_headline_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Riga sotto il titolo (IT)" value={copy.hero_microcopy_it} onChange={v => updateField('hero_microcopy_it', v)} />
                    <FieldText label="Riga sotto il titolo (EN)" value={copy.hero_microcopy_en} onChange={v => updateField('hero_microcopy_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FieldText label="CTA principale (IT)" value={copy.hero_cta_label_it} onChange={v => updateField('hero_cta_label_it', v)} />
                    <FieldText label="CTA principale (EN)" value={copy.hero_cta_label_en} onChange={v => updateField('hero_cta_label_en', v)} />
                    <FieldText label="Destinazione — es. /flotta" value={copy.hero_cta_to} onChange={v => updateField('hero_cta_to', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FieldText label="CTA secondaria (IT)" value={copy.hero_cta2_label_it} onChange={v => updateField('hero_cta2_label_it', v)} />
                    <FieldText label="CTA secondaria (EN)" value={copy.hero_cta2_label_en} onChange={v => updateField('hero_cta2_label_en', v)} />
                    <FieldText label="Destinazione — es. #esperienze" value={copy.hero_cta2_to} onChange={v => updateField('hero_cta2_to', v)} />
                </div>
            </section>

            {/* Hero slides */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-[14px] font-semibold text-theme-text-primary">Carosello Hero (video)</h3>
                        <p className="text-[12px] text-theme-text-secondary mt-1">Lista dei video che ruotano in homepage. Ogni path e' relativo alla cartella <code>/public</code> (es. <code>/main.mp4</code>).</p>
                    </div>
                    <label className="block shrink-0">
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6] text-right">Autoplay</span>
                        <div className="relative">
                            <input
                                type="number"
                                min={2}
                                max={120}
                                value={copy.hero_autoplay_seconds}
                                onChange={(e) => updateField('hero_autoplay_seconds', Number(e.target.value) || 8)}
                                className="mt-0.5 w-24 bg-theme-bg-primary border border-theme-border rounded-lg pl-3 pr-10 py-1.5 text-[13px] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-[3px] text-[11px] text-[#a1a1a6] pointer-events-none">sec</span>
                        </div>
                    </label>
                </div>

                <ul className="space-y-2">
                    {copy.hero_slides.map((s, i) => (
                        <li key={s.id} className="grid grid-cols-1 md:grid-cols-[24px_1fr_auto] gap-2 items-center bg-[#fafafa] border border-theme-border rounded-xl p-3">
                            <span className="text-[11px] font-mono text-theme-text-secondary text-center">{i + 1}</span>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <input
                                    type="text"
                                    value={s.video_src}
                                    onChange={(e) => updateSlide(i, { video_src: e.target.value })}
                                    placeholder="/film/cars1.mp4"
                                    className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono"
                                />
                                <input
                                    type="text"
                                    value={s.mobile_src || ''}
                                    onChange={(e) => updateSlide(i, { mobile_src: e.target.value })}
                                    placeholder="telefono (opzionale)"
                                    className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono"
                                />
                                <input
                                    type="text"
                                    value={s.poster_src || ''}
                                    onChange={(e) => updateSlide(i, { poster_src: e.target.value })}
                                    placeholder="poster (opzionale)"
                                    className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono"
                                />
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => moveSlide(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button onClick={() => moveSlide(i, 1)} disabled={i === copy.hero_slides.length - 1} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                <button onClick={() => removeSlide(i)} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </li>
                    ))}
                </ul>
                <button
                    onClick={addSlide}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi video
                </button>
            </section>

            {/* Atto 02 — Silenzio */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Frase grande (silenzio)</h3>
                <p className="text-[12px] text-theme-text-secondary">La frase enorme dopo il primo schermo. Una riga per riga: sono le righe che si vedono.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Frase (IT)" value={copy.statement_lines_it.join('\n')} onChange={v => setLines('statement_lines_it', v)} />
                    <FieldTextArea label="Frase (EN)" value={copy.statement_lines_en.join('\n')} onChange={v => setLines('statement_lines_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Nota sotto la frase (IT)" value={copy.statement_note_it} onChange={v => updateField('statement_note_it', v)} />
                    <FieldText label="Nota sotto la frase (EN)" value={copy.statement_note_en} onChange={v => updateField('statement_note_en', v)} />
                </div>
            </section>

            {/* Atto 03 — Collezione */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">La Collezione</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    I veicoli in evidenza arrivano dal gestionale. Lasciando vuoto l'elenco degli id si prendono
                    i primi delle categorie visibili in Flotta; scrivendo degli id si mostrano quelli, in
                    quell'ordine. Nessun veicolo viene inventato: se il gestionale non ne restituisce, la
                    sezione non compare.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Occhiello (IT)" value={copy.collection_eyebrow_it} onChange={v => updateField('collection_eyebrow_it', v)} />
                    <FieldText label="Occhiello (EN)" value={copy.collection_eyebrow_en} onChange={v => updateField('collection_eyebrow_en', v)} />
                    <FieldText label="Titolo (IT)" value={copy.collection_title_it} onChange={v => updateField('collection_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.collection_title_en} onChange={v => updateField('collection_title_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Introduzione (IT)" value={copy.collection_intro_it} onChange={v => updateField('collection_intro_it', v)} />
                    <FieldTextArea label="Introduzione (EN)" value={copy.collection_intro_en} onChange={v => updateField('collection_intro_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FieldText label="Quanti veicoli in evidenza" value={String(copy.collection_featured_count)} onChange={v => updateField('collection_featured_count', Math.max(1, Math.min(8, Number(v) || 3)))} />
                    <FieldText label="CTA sotto ogni veicolo (IT)" value={copy.collection_item_cta_it} onChange={v => updateField('collection_item_cta_it', v)} />
                    <FieldText label="CTA sotto ogni veicolo (EN)" value={copy.collection_item_cta_en} onChange={v => updateField('collection_item_cta_en', v)} />
                </div>
                <FieldTextArea
                    label="Id dei veicoli in evidenza — uno per riga, vuoto = automatico"
                    value={copy.collection_featured_ids.join('\n')}
                    onChange={v => updateField('collection_featured_ids', v.split('\n').map(r => r.trim()).filter(Boolean))}
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FieldText label="CTA finale (IT)" value={copy.collection_cta_label_it} onChange={v => updateField('collection_cta_label_it', v)} />
                    <FieldText label="CTA finale (EN)" value={copy.collection_cta_label_en} onChange={v => updateField('collection_cta_label_en', v)} />
                    <FieldText label="Destinazione" value={copy.collection_cta_to} onChange={v => updateField('collection_cta_to', v)} />
                </div>
            </section>

            {/* Atto 04 — Esperienze */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Esperienze ({copy.experiences.length})</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    Le card dei servizi. Mettere qui solo servizi che esistono davvero: la destinazione deve
                    essere una pagina viva del sito.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Occhiello (IT)" value={copy.experiences_eyebrow_it} onChange={v => updateField('experiences_eyebrow_it', v)} />
                    <FieldText label="Occhiello (EN)" value={copy.experiences_eyebrow_en} onChange={v => updateField('experiences_eyebrow_en', v)} />
                    <FieldText label="Titolo (IT)" value={copy.experiences_title_it} onChange={v => updateField('experiences_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.experiences_title_en} onChange={v => updateField('experiences_title_en', v)} />
                </div>
                <ul className="space-y-3">
                    {copy.experiences.map((e, i) => (
                        <li key={e.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono text-theme-text-secondary">{i + 1}</span>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => moveExp(i, -1)} disabled={i === 0} className="text-[11px] text-theme-text-secondary disabled:opacity-30">su</button>
                                    <button onClick={() => moveExp(i, 1)} disabled={i === copy.experiences.length - 1} className="text-[11px] text-theme-text-secondary disabled:opacity-30">giu'</button>
                                    <button onClick={() => removeExp(i)} className="text-[11px] text-[#ff3b30] hover:underline">elimina</button>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FieldText label="Titolo (IT)" value={e.title_it} onChange={v => updateExp(i, { title_it: v })} />
                                <FieldText label="Titolo (EN)" value={e.title_en} onChange={v => updateExp(i, { title_en: v })} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FieldText label="Riga sotto (IT)" value={e.copy_it} onChange={v => updateExp(i, { copy_it: v })} />
                                <FieldText label="Riga sotto (EN)" value={e.copy_en} onChange={v => updateExp(i, { copy_en: v })} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FieldText label="Immagine — es. /menu-mare.jpeg" value={e.image_src} onChange={v => updateExp(i, { image_src: v })} />
                                <FieldText label="Video (opzionale)" value={e.video_src || ''} onChange={v => updateExp(i, { video_src: v })} />
                                <FieldText label="Destinazione — es. /noleggio-mare" value={e.to} onChange={v => updateExp(i, { to: v })} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FieldText label="CTA (IT)" value={e.cta_it} onChange={v => updateExp(i, { cta_it: v })} />
                                <FieldText label="CTA (EN)" value={e.cta_en} onChange={v => updateExp(i, { cta_en: v })} />
                            </div>
                        </li>
                    ))}
                </ul>
                <button onClick={addExp} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">Aggiungi esperienza</button>
            </section>

            {/* Atto 05 — Marca */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Momento di marca</h3>
                <p className="text-[12px] text-theme-text-secondary">La frase grande su fondo chiaro, piu' due o tre blocchi di testo.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Frase (IT) — una riga per riga" value={copy.brand_lines_it.join('\n')} onChange={v => setLines('brand_lines_it', v)} />
                    <FieldTextArea label="Frase (EN)" value={copy.brand_lines_en.join('\n')} onChange={v => setLines('brand_lines_en', v)} />
                </div>
                <ul className="space-y-3">
                    {copy.brand_paragraphs.map((par, i) => (
                        <li key={i} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono text-theme-text-secondary">Blocco {i + 1}</span>
                                <button onClick={() => removePar(i)} className="text-[11px] text-[#ff3b30] hover:underline">elimina</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FieldTextArea label="Testo (IT)" value={par.text_it} onChange={v => updatePar(i, { text_it: v })} />
                                <FieldTextArea label="Testo (EN)" value={par.text_en} onChange={v => updatePar(i, { text_en: v })} />
                            </div>
                        </li>
                    ))}
                </ul>
                <button onClick={addPar} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">Aggiungi blocco</button>

                <div className="pt-2">
                    <h4 className="text-[13px] font-semibold text-theme-text-primary">Numeri ({copy.metrics.length})</h4>
                    <p className="text-[12px] text-theme-text-secondary">
                        Finche' la lista e' vuota la sezione non compare. Scrivere qui solo numeri verificati:
                        un dato inventato in homepage e' peggio di nessun dato.
                    </p>
                </div>
                <ul className="space-y-3">
                    {copy.metrics.map((m, i) => (
                        <li key={m.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono text-theme-text-secondary">{i + 1}</span>
                                <button onClick={() => removeMetric(i)} className="text-[11px] text-[#ff3b30] hover:underline">elimina</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FieldText label='Numero — es. "2.000+"' value={m.value} onChange={v => updateMetric(i, { value: v })} />
                                <FieldText label="Etichetta (IT)" value={m.label_it} onChange={v => updateMetric(i, { label_it: v })} />
                                <FieldText label="Etichetta (EN)" value={m.label_en} onChange={v => updateMetric(i, { label_en: v })} />
                            </div>
                        </li>
                    ))}
                </ul>
                <button onClick={addMetric} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">Aggiungi numero</button>
            </section>

            {/* Atto 06 — Accesso */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Chiusura</h3>
                <p className="text-[12px] text-theme-text-secondary">L'ultimo schermo: una frase, una CTA, e il filmato o l'immagine di sfondo.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.access_title_it} onChange={v => updateField('access_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.access_title_en} onChange={v => updateField('access_title_en', v)} />
                    <FieldText label="Riga sotto (IT)" value={copy.access_copy_it} onChange={v => updateField('access_copy_it', v)} />
                    <FieldText label="Riga sotto (EN)" value={copy.access_copy_en} onChange={v => updateField('access_copy_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FieldText label="CTA (IT)" value={copy.access_cta_label_it} onChange={v => updateField('access_cta_label_it', v)} />
                    <FieldText label="CTA (EN)" value={copy.access_cta_label_en} onChange={v => updateField('access_cta_label_en', v)} />
                    <FieldText label="Destinazione" value={copy.access_cta_to} onChange={v => updateField('access_cta_to', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Video di sfondo" value={copy.access_video_src} onChange={v => updateField('access_video_src', v)} />
                    <FieldText label="Immagine di ripiego (poster)" value={copy.access_media_src} onChange={v => updateField('access_media_src', v)} />
                </div>
            </section>

            {/* Categories */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card categorie ({copy.categories.length})</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    Override per le card della sezione "Categorie" della home. ID validi: <code className="text-[11px]">{KNOWN_CATEGORY_IDS.join(', ')}</code>. Se l'override per un id manca, la card mostra titolo + immagine di default hardcoded.
                </p>
                {copy.categories.map((c, i) => (
                    <CategoryCard
                        key={`${c.id}-${i}`}
                        cat={c}
                        first={i === 0}
                        last={i === copy.categories.length - 1}
                        onChange={(patch) => updateCategory(i, patch)}
                        onMoveUp={() => moveCategory(i, -1)}
                        onMoveDown={() => moveCategory(i, 1)}
                        onRemove={() => removeCategory(i)}
                    />
                ))}
                <button
                    onClick={addCategory}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi override categoria
                </button>
            </section>
        </div>
    )
}

function CategoryCard({
    cat, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    cat: HomeCategoryOverride
    first: boolean
    last: boolean
    onChange: (patch: Partial<HomeCategoryOverride>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const knownId = KNOWN_CATEGORY_IDS.includes(cat.id)
    return (
        <div className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">
                    {cat.id || '(id mancante)'}
                </span>
                {!knownId && cat.id && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700" title="Id non corrisponde a una categoria nota">id sconosciuto</span>
                )}
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input type="text" value={cat.id} onChange={e => onChange({ id: e.target.value.trim() })} placeholder="cars" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                <input type="text" value={cat.display_title_it} onChange={e => onChange({ display_title_it: e.target.value })} placeholder="Titolo IT" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={cat.display_title_en} onChange={e => onChange({ display_title_en: e.target.value })} placeholder="Title EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
            </div>
            <div className="flex items-center gap-3">
                <input type="text" value={cat.image_src} onChange={e => onChange({ image_src: e.target.value })} placeholder="/car.jpeg" className="flex-1 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                {cat.image_src && (
                    <img src={cat.image_src} alt="" className="w-12 h-8 object-cover rounded border border-theme-border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
            </div>
        </div>
    )
}

// ─── Chi Siamo (About) editor ───────────────────────────────────────────────
function AboutEditor({
    copy,
    setCopy,
}: {
    copy: AboutCopy
    setCopy: (next: AboutCopy) => void
}) {
    const updateField = <K extends keyof AboutCopy>(key: K, value: AboutCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Founders
    const updateFounder = (idx: number, patch: Partial<AboutFounder>) => {
        const next = [...copy.founders]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, founders: next })
    }
    const moveFounder = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.founders.length) return
        const next = [...copy.founders]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, founders: next })
    }
    const removeFounder = (idx: number) => {
        if (!confirm('Rimuovere questo fondatore?')) return
        setCopy({ ...copy, founders: copy.founders.filter((_, i) => i !== idx) })
    }
    const addFounder = () => {
        setCopy({
            ...copy,
            founders: [...copy.founders, {
                id: `founder-${Date.now().toString(36)}`,
                name: '', role_it: 'Co-fondatore', role_en: 'Co-founder',
                photo_src: '/', alt_it: '', alt_en: '',
            }],
        })
    }

    // Paragraphs
    const updateParagraph = (idx: number, patch: Partial<BilingualParagraph>) => {
        const next = [...copy.story_paragraphs]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, story_paragraphs: next })
    }
    const moveParagraph = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.story_paragraphs.length) return
        const next = [...copy.story_paragraphs]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, story_paragraphs: next })
    }
    const removeParagraph = (idx: number) => {
        if (!confirm('Rimuovere questo paragrafo?')) return
        setCopy({ ...copy, story_paragraphs: copy.story_paragraphs.filter((_, i) => i !== idx) })
    }
    const addParagraph = () => {
        setCopy({ ...copy, story_paragraphs: [...copy.story_paragraphs, { text_it: '', text_en: '' }] })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Chi Siamo</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/about</code>. Modifica i fondatori, la story e l'outro firmato. Il blocco "Careers" in fondo (Join_Our_Team) usa ancora le traduzioni globali, non e' editabile da qui.
                </p>
            </div>

            {/* Founders */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Fondatori ({copy.founders.length})</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    Massimo 4 ritratti per riga su desktop. Foto in <code>/public</code> (es. <code>/Valerio.jpg</code>). Add/remove/reorder liberamente.
                </p>
                {copy.founders.map((f, i) => (
                    <FounderCard
                        key={f.id}
                        founder={f}
                        first={i === 0}
                        last={i === copy.founders.length - 1}
                        onChange={(patch) => updateFounder(i, patch)}
                        onMoveUp={() => moveFounder(i, -1)}
                        onMoveDown={() => moveFounder(i, 1)}
                        onRemove={() => removeFounder(i)}
                    />
                ))}
                <button
                    onClick={addFounder}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi fondatore
                </button>
            </section>

            {/* Story */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Story</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.story_title_it} onChange={v => updateField('story_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.story_title_en} onChange={v => updateField('story_title_en', v)} />
                </div>

                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Paragrafi ({copy.story_paragraphs.length})</h4>
                    {copy.story_paragraphs.map((p, i) => (
                        <ParagraphCard
                            key={i}
                            paragraph={p}
                            index={i}
                            first={i === 0}
                            last={i === copy.story_paragraphs.length - 1}
                            onChange={(patch) => updateParagraph(i, patch)}
                            onMoveUp={() => moveParagraph(i, -1)}
                            onMoveDown={() => moveParagraph(i, 1)}
                            onRemove={() => removeParagraph(i)}
                        />
                    ))}
                    <button
                        onClick={addParagraph}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi paragrafo
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-theme-border">
                    <FieldText label='Outro principale (IT) — es. "Benvenuti in DR7"' value={copy.story_outro_main_it} onChange={v => updateField('story_outro_main_it', v)} />
                    <FieldText label="Outro principale (EN)" value={copy.story_outro_main_en} onChange={v => updateField('story_outro_main_en', v)} />
                    <FieldTextArea label="Outro sub (IT)" value={copy.story_outro_sub_it} onChange={v => updateField('story_outro_sub_it', v)} />
                    <FieldTextArea label="Outro sub (EN)" value={copy.story_outro_sub_en} onChange={v => updateField('story_outro_sub_en', v)} />
                </div>

                <FieldText label='Firma (es. "— Valerio & Ilenia")' value={copy.story_signature} onChange={v => updateField('story_signature', v)} />
            </section>
        </div>
    )
}

function FounderCard({
    founder, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    founder: AboutFounder
    first: boolean
    last: boolean
    onChange: (patch: Partial<AboutFounder>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    return (
        <div className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{founder.name || '(senza nome)'}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input type="text" value={founder.name} onChange={e => onChange({ name: e.target.value })} placeholder="Nome" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={founder.role_it} onChange={e => onChange({ role_it: e.target.value })} placeholder="Ruolo IT (es. Co-fondatore)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={founder.role_en} onChange={e => onChange({ role_en: e.target.value })} placeholder="Role EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
            </div>
            <div className="flex items-center gap-3">
                <input type="text" value={founder.photo_src} onChange={e => onChange({ photo_src: e.target.value })} placeholder="/Valerio.jpg" className="flex-1 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                {founder.photo_src && (
                    <img src={founder.photo_src} alt="" className="w-12 h-12 object-cover rounded border border-theme-border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input type="text" value={founder.alt_it} onChange={e => onChange({ alt_it: e.target.value })} placeholder='Alt foto IT (es. "Valerio - Co-fondatore...")' className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[12px]" />
                <input type="text" value={founder.alt_en} onChange={e => onChange({ alt_en: e.target.value })} placeholder="Alt photo EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[12px]" />
            </div>
        </div>
    )
}

function ParagraphCard({
    paragraph, index, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    paragraph: BilingualParagraph
    index: number
    first: boolean
    last: boolean
    onChange: (patch: Partial<BilingualParagraph>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    return (
        <div className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-theme-text-secondary">P{index + 1}</span>
                <span className="text-[11px] text-theme-text-secondary flex-1 truncate">{paragraph.text_it.slice(0, 60) || '(vuoto)'}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <textarea value={paragraph.text_it} onChange={e => onChange({ text_it: e.target.value })} placeholder="Testo IT" rows={4} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                <textarea value={paragraph.text_en} onChange={e => onChange({ text_en: e.target.value })} placeholder="Text EN" rows={4} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
            </div>
        </div>
    )
}

// ─── Footer editor ──────────────────────────────────────────────────────────
const SOCIAL_ICON_OPTIONS: FooterSocialIcon[] = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'x']

function FooterEditor({
    copy,
    setCopy,
}: {
    copy: FooterCopy
    setCopy: (next: FooterCopy) => void
}) {
    const updateField = <K extends keyof FooterCopy>(key: K, value: FooterCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Social links
    const updateSocial = (idx: number, patch: Partial<FooterSocialLink>) => {
        const next = [...copy.social_links]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, social_links: next })
    }
    const moveSocial = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.social_links.length) return
        const next = [...copy.social_links]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, social_links: next })
    }
    const removeSocial = (idx: number) => {
        if (!confirm('Rimuovere questo social link?')) return
        setCopy({ ...copy, social_links: copy.social_links.filter((_, i) => i !== idx) })
    }
    const addSocial = () => {
        setCopy({
            ...copy,
            social_links: [...copy.social_links, { id: `s-${Date.now().toString(36)}`, label: 'Social', href: 'https://', icon: 'instagram' }],
        })
    }
    // Generic link list helpers
    type LinkField = 'division_links' | 'corporate_links' | 'legal_links'
    const updateLink = (field: LinkField, idx: number, patch: Partial<FooterLink>) => {
        const list = copy[field]
        const next = [...list]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, [field]: next })
    }
    const moveLink = (field: LinkField, idx: number, dir: -1 | 1) => {
        const list = copy[field]
        const j = idx + dir
        if (j < 0 || j >= list.length) return
        const next = [...list]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, [field]: next })
    }
    const removeLink = (field: LinkField, idx: number) => {
        if (!confirm('Rimuovere questo link?')) return
        setCopy({ ...copy, [field]: copy[field].filter((_, i) => i !== idx) })
    }
    const addLink = (field: LinkField) => {
        const list = copy[field]
        setCopy({
            ...copy,
            [field]: [...list, { id: `l-${Date.now().toString(36)}`, label_it: '', label_en: '', to: '/' }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Footer</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Footer del sito (visibile su ogni pagina). I social link qui sono indipendenti dalla tab <b>Marketing &gt; Social Links</b> (quella alimenta i template messaggi).
                </p>
            </div>

            {/* Network band */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Network (banda social)</h3>
                <FieldText label="Titolo (IT)" value={copy.network_title_it ?? ''} onChange={v => updateField('network_title_it', v)} />
                <FieldText label="Title (EN)" value={copy.network_title_en ?? ''} onChange={v => updateField('network_title_en', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Testo (IT)" value={copy.network_text_it} onChange={v => updateField('network_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.network_text_en} onChange={v => updateField('network_text_en', v)} />
                </div>
                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Social ({copy.social_links.length})</h4>
                    {copy.social_links.map((s, i) => (
                        <div key={s.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] grid grid-cols-1 md:grid-cols-[120px_1fr_minmax(0,1fr)_auto] gap-2 items-center">
                            <select
                                value={s.icon}
                                onChange={(e) => updateSocial(i, { icon: e.target.value as FooterSocialIcon })}
                                className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary"
                            >
                                {SOCIAL_ICON_OPTIONS.map(o => <option key={o} value={o} className="text-theme-text-primary">{o}</option>)}
                            </select>
                            <input type="text" value={s.label} onChange={e => updateSocial(i, { label: e.target.value })} placeholder="aria-label (es. Instagram)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary" />
                            <input type="text" value={s.href} onChange={e => updateSocial(i, { href: e.target.value })} placeholder="https://www.instagram.com/..." className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary font-mono" />
                            <div className="flex items-center gap-1">
                                <button onClick={() => moveSocial(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button onClick={() => moveSocial(i, 1)} disabled={i === copy.social_links.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                <button onClick={() => removeSocial(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </div>
                    ))}
                    <button onClick={addSocial} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi social
                    </button>
                </div>
            </section>

            {/* Reviews band */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Recensioni (banda)</h3>
                <FieldText label="Titolo (IT)" value={copy.reviews_title_it ?? ''} onChange={v => updateField('reviews_title_it', v)} />
                <FieldText label="Title (EN)" value={copy.reviews_title_en ?? ''} onChange={v => updateField('reviews_title_en', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Testo (IT)" value={copy.reviews_text_it} onChange={v => updateField('reviews_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.reviews_text_en} onChange={v => updateField('reviews_text_en', v)} />
                </div>
                <p className="text-[11px] text-theme-text-secondary">La lista recensioni sotto e' renderizzata da ReviewsSection (dinamico, non editabile da qui).</p>
            </section>

            {/* Contact band */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Contatti & Legale</h3>
                <FieldText label="Titolo (es. Contact)" value={copy.contact_title} onChange={v => updateField('contact_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Numero WhatsApp visualizzato" value={copy.contact_whatsapp_number} onChange={v => updateField('contact_whatsapp_number', v)} />
                    <FieldText label="URL WhatsApp (wa.me)" value={copy.contact_whatsapp_url} onChange={v => updateField('contact_whatsapp_url', v)} />
                </div>
                <FieldText label="Ragione sociale" value={copy.contact_company_name} onChange={v => updateField('contact_company_name', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sede legale (IT)" value={copy.contact_legal_address_it} onChange={v => updateField('contact_legal_address_it', v)} />
                    <FieldText label="Registered office (EN)" value={copy.contact_legal_address_en} onChange={v => updateField('contact_legal_address_en', v)} />
                    <FieldText label="Sede operativa (IT)" value={copy.contact_operative_address_it} onChange={v => updateField('contact_operative_address_it', v)} />
                    <FieldText label="Operating office (EN)" value={copy.contact_operative_address_en} onChange={v => updateField('contact_operative_address_en', v)} />
                    <FieldText label="Capitale sociale (IT)" value={copy.contact_capitale_sociale_it} onChange={v => updateField('contact_capitale_sociale_it', v)} />
                    <FieldText label="Share capital (EN)" value={copy.contact_capitale_sociale_en} onChange={v => updateField('contact_capitale_sociale_en', v)} />
                </div>
                <FieldText label="P.IVA / C.F." value={copy.contact_piva} onChange={v => updateField('contact_piva', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label='Disclaimer (IT) — usa newline per a-capo' value={copy.contact_disclaimer_it} onChange={v => updateField('contact_disclaimer_it', v)} />
                    <FieldTextArea label="Disclaimer (EN)" value={copy.contact_disclaimer_en} onChange={v => updateField('contact_disclaimer_en', v)} />
                </div>
            </section>

            {/* Link rows */}
            <FooterLinkSection
                title="Division links (riga 1, bold)"
                hint="Es. Supercar & Luxury Division, Lavaggio & Meccanica, Contattaci"
                links={copy.division_links}
                onChange={(idx, patch) => updateLink('division_links', idx, patch)}
                onMoveUp={(idx) => moveLink('division_links', idx, -1)}
                onMoveDown={(idx) => moveLink('division_links', idx, 1)}
                onRemove={(idx) => removeLink('division_links', idx)}
                onAdd={() => addLink('division_links')}
            />
            <FooterLinkSection
                title="Corporate links (riga 2)"
                hint="Es. Corporate Overview, Press & Media, Careers"
                links={copy.corporate_links}
                onChange={(idx, patch) => updateLink('corporate_links', idx, patch)}
                onMoveUp={(idx) => moveLink('corporate_links', idx, -1)}
                onMoveDown={(idx) => moveLink('corporate_links', idx, 1)}
                onRemove={(idx) => removeLink('corporate_links', idx)}
                onAdd={() => addLink('corporate_links')}
            />
            <FooterLinkSection
                title="Legal links (riga 3)"
                hint="Es. Terms of Service, Cookie, Privacy, Cancellation"
                links={copy.legal_links}
                onChange={(idx, patch) => updateLink('legal_links', idx, patch)}
                onMoveUp={(idx) => moveLink('legal_links', idx, -1)}
                onMoveDown={(idx) => moveLink('legal_links', idx, 1)}
                onRemove={(idx) => removeLink('legal_links', idx)}
                onAdd={() => addLink('legal_links')}
            />

            {/* Bottom band */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Banda inferiore</h3>
                <FieldText label="Riga brand (IT)" value={copy.bottom_brand_line_it ?? ''} onChange={v => updateField('bottom_brand_line_it', v)} />
                <FieldText label="Brand line (EN)" value={copy.bottom_brand_line_en ?? ''} onChange={v => updateField('bottom_brand_line_en', v)} />
                <FieldText label="Copyright (IT)" value={copy.bottom_copyright_it ?? ''} onChange={v => updateField('bottom_copyright_it', v)} />
                <FieldText label="Copyright (EN)" value={copy.bottom_copyright_en ?? ''} onChange={v => updateField('bottom_copyright_en', v)} />
            </section>
        </div>
    )
}

function FooterLinkSection({
    title, hint, links, onChange, onMoveUp, onMoveDown, onRemove, onAdd,
}: {
    title: string
    hint: string
    links: FooterLink[]
    onChange: (idx: number, patch: Partial<FooterLink>) => void
    onMoveUp: (idx: number) => void
    onMoveDown: (idx: number) => void
    onRemove: (idx: number) => void
    onAdd: () => void
}) {
    return (
        <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
            <div>
                <h3 className="text-[14px] font-semibold text-theme-text-primary">{title} ({links.length})</h3>
                <p className="text-[12px] text-theme-text-secondary mt-1">{hint}</p>
            </div>
            {links.map((l, i) => (
                <div key={l.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{l.label_it || '(senza titolo)'}</span>
                        {l.external && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700">esterno</span>}
                        <button onClick={() => onMoveUp(i)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                        <button onClick={() => onMoveDown(i)} disabled={i === links.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                        <button onClick={() => onRemove(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input type="text" value={l.label_it} onChange={e => onChange(i, { label_it: e.target.value })} placeholder="Etichetta IT" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={l.label_en} onChange={e => onChange(i, { label_en: e.target.value })} placeholder="Label EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                        <input type="text" value={l.to} onChange={e => onChange(i, { to: e.target.value })} placeholder="/about oppure https://..." className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                        <label className="flex items-center gap-2 text-[12px] text-theme-text-secondary whitespace-nowrap">
                            <input type="checkbox" checked={!!l.external} onChange={e => onChange(i, { external: e.target.checked || undefined })} />
                            forza link esterno
                        </label>
                    </div>
                </div>
            ))}
            <button onClick={onAdd} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Aggiungi link
            </button>
        </section>
    )
}

// ─── Privacy & Termini (Legal) editor ───────────────────────────────────────
const LEGAL_PAGE_LABELS: Record<LegalPageId, string> = {
    privacy: 'Privacy Policy',
    cookie: 'Cookie Policy',
    rental_agreement: 'Rental Agreement',
    terms: 'Terms of Service',
}

function LegalEditor({
    copy,
    setCopy,
}: {
    copy: LegalCopy
    setCopy: (next: LegalCopy) => void
}) {
    const [activeId, setActiveId] = useState<LegalPageId>('privacy')
    const active = copy.pages.find(p => p.id === activeId) || emptyLegalPage(activeId)

    const updatePage = (patch: Partial<LegalPageCopy>) => {
        setCopy({
            ...copy,
            pages: copy.pages.map(p => p.id === activeId ? { ...p, ...patch } : p),
        })
    }
    // Sections
    const updateSection = (idx: number, patch: Partial<LegalSection>) => {
        const next = [...active.sections]
        next[idx] = { ...next[idx], ...patch }
        updatePage({ sections: next })
    }
    const moveSection = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= active.sections.length) return
        const next = [...active.sections]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        updatePage({ sections: next })
    }
    const removeSection = (idx: number) => {
        if (!confirm('Rimuovere questa sezione?')) return
        updatePage({ sections: active.sections.filter((_, i) => i !== idx) })
    }
    const addSection = () => {
        const id = `sec-${Date.now().toString(36)}`
        updatePage({
            sections: [...active.sections, {
                id,
                heading_it: 'Nuova sezione', heading_en: 'New section',
                blocks: [{ type: 'p', text_it: '', text_en: '' }],
            }],
        })
    }

    // Intro/Outro blocks (raw block lists)
    const updateBandBlock = (band: 'intro_blocks' | 'outro_blocks', idx: number, next: CancellazioneBlock) => {
        const list = [...active[band]]
        list[idx] = next
        updatePage({ [band]: list } as Partial<LegalPageCopy>)
    }
    const moveBandBlock = (band: 'intro_blocks' | 'outro_blocks', idx: number, dir: -1 | 1) => {
        const list = [...active[band]]
        const j = idx + dir
        if (j < 0 || j >= list.length) return
        ;[list[idx], list[j]] = [list[j], list[idx]]
        updatePage({ [band]: list } as Partial<LegalPageCopy>)
    }
    const removeBandBlock = (band: 'intro_blocks' | 'outro_blocks', idx: number) => {
        if (!confirm('Rimuovere questo blocco?')) return
        updatePage({ [band]: active[band].filter((_, i) => i !== idx) } as Partial<LegalPageCopy>)
    }
    const addBandBlock = (band: 'intro_blocks' | 'outro_blocks', type: CancellazioneBlock['type']) => {
        const block: CancellazioneBlock = type === 'ul'
            ? { type: 'ul', items_it: [''], items_en: [''], tone: 'default' }
            : { type, text_it: '', text_en: '' }
        updatePage({ [band]: [...active[band], block] } as Partial<LegalPageCopy>)
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Privacy & Termini</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Modifica le pagine legali. Inline supportato: <code>**grassetto**</code> e <code>[testo](https://link)</code> (anche <code>mailto:</code>). Newline nei testi diventano a-capo a video.
                </p>
            </div>

            {/* Page picker */}
            <div className="flex flex-wrap gap-2">
                {(['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[]).map(id => {
                    const page = copy.pages.find(p => p.id === id)
                    const isActive = activeId === id
                    return (
                        <button
                            key={id}
                            onClick={() => setActiveId(id)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border ${
                                isActive
                                    ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                                    : 'bg-theme-bg-primary border-theme-border text-theme-text-primary hover:bg-theme-bg-secondary'
                            }`}
                        >
                            {LEGAL_PAGE_LABELS[id]}
                            {!page?.enabled && (
                                <span className={`ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${isActive ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-700'}`}>off</span>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Page meta */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">Impostazioni pagina</h3>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                        <span className="text-[12px] text-theme-text-secondary">Pagina attiva</span>
                        <input
                            type="checkbox"
                            checked={active.enabled}
                            onChange={(e) => updatePage({ enabled: e.target.checked })}
                            className="sr-only peer"
                        />
                        <span className="relative inline-block w-9 h-5 rounded-full bg-[#e5e5ea] peer-checked:bg-[#34c759] transition-colors">
                            <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                        </span>
                    </label>
                </div>
                <p className="text-[11px] text-theme-text-secondary -mt-2">Disattivata = il sito mostra il testo legacy hardcoded della pagina.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={active.title_it} onChange={v => updatePage({ title_it: v })} />
                    <FieldText label="Titolo pagina (EN)" value={active.title_en} onChange={v => updatePage({ title_en: v })} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-4 items-end">
                    <label className="inline-flex items-center gap-2 cursor-pointer pb-2">
                        <input
                            type="checkbox"
                            checked={active.last_updated_dynamic}
                            onChange={(e) => updatePage({ last_updated_dynamic: e.target.checked })}
                        />
                        <span className="text-[12px] text-theme-text-primary">Mostra "ultimo aggiornamento" con data odierna</span>
                    </label>
                    <FieldText label='Etichetta (IT)' value={active.last_updated_label_it} onChange={v => updatePage({ last_updated_label_it: v })} />
                    <FieldText label='Etichetta (EN)' value={active.last_updated_label_en} onChange={v => updatePage({ last_updated_label_en: v })} />
                </div>
            </section>

            {/* Intro band */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Intro (sopra le sezioni) — {active.intro_blocks.length} blocchi</h3>
                {active.intro_blocks.map((block, i) => (
                    <BlockCard
                        key={`intro-${i}`}
                        block={block}
                        first={i === 0}
                        last={i === active.intro_blocks.length - 1}
                        onChange={(b) => updateBandBlock('intro_blocks', i, b)}
                        onMoveUp={() => moveBandBlock('intro_blocks', i, -1)}
                        onMoveDown={() => moveBandBlock('intro_blocks', i, 1)}
                        onRemove={() => removeBandBlock('intro_blocks', i)}
                    />
                ))}
                <div className="flex flex-wrap gap-2">
                    <AddBlockButton label="+ Paragrafo" onClick={() => addBandBlock('intro_blocks', 'p')} />
                    <AddBlockButton label="+ Grassetto" onClick={() => addBandBlock('intro_blocks', 'p-bold')} />
                    <AddBlockButton label="+ Corsivo" onClick={() => addBandBlock('intro_blocks', 'p-italic')} />
                    <AddBlockButton label="+ Lista puntata" onClick={() => addBandBlock('intro_blocks', 'ul')} />
                </div>
            </section>

            {/* Sections */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Sezioni numerate ({active.sections.length})</h3>
                {active.sections.map((sec, i) => (
                    <LegalSectionCard
                        key={sec.id}
                        section={sec}
                        first={i === 0}
                        last={i === active.sections.length - 1}
                        onChange={(patch) => updateSection(i, patch)}
                        onMoveUp={() => moveSection(i, -1)}
                        onMoveDown={() => moveSection(i, 1)}
                        onRemove={() => removeSection(i)}
                    />
                ))}
                <button
                    onClick={addSection}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi sezione
                </button>
            </section>

            {/* Outro band */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Outro (sotto le sezioni) — {active.outro_blocks.length} blocchi</h3>
                {active.outro_blocks.map((block, i) => (
                    <BlockCard
                        key={`outro-${i}`}
                        block={block}
                        first={i === 0}
                        last={i === active.outro_blocks.length - 1}
                        onChange={(b) => updateBandBlock('outro_blocks', i, b)}
                        onMoveUp={() => moveBandBlock('outro_blocks', i, -1)}
                        onMoveDown={() => moveBandBlock('outro_blocks', i, 1)}
                        onRemove={() => removeBandBlock('outro_blocks', i)}
                    />
                ))}
                <div className="flex flex-wrap gap-2">
                    <AddBlockButton label="+ Paragrafo" onClick={() => addBandBlock('outro_blocks', 'p')} />
                    <AddBlockButton label="+ Grassetto" onClick={() => addBandBlock('outro_blocks', 'p-bold')} />
                    <AddBlockButton label="+ Corsivo" onClick={() => addBandBlock('outro_blocks', 'p-italic')} />
                    <AddBlockButton label="+ Lista puntata" onClick={() => addBandBlock('outro_blocks', 'ul')} />
                </div>
            </section>
        </div>
    )
}

function LegalSectionCard({
    section, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    section: LegalSection
    first: boolean
    last: boolean
    onChange: (patch: Partial<LegalSection>) => void
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
        const block: CancellazioneBlock = type === 'ul'
            ? { type: 'ul', items_it: [''], items_en: [''], tone: 'default' }
            : { type, text_it: '', text_en: '' }
        onChange({ blocks: [...section.blocks, block] })
    }

    return (
        <div className="border border-theme-border rounded-2xl bg-theme-bg-primary shadow-sm">
            <header className="px-4 py-3 flex items-center gap-3">
                <button onClick={() => setOpen(o => !o)} className="flex-1 text-left flex items-center gap-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-theme-text-secondary transition-transform ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>
                    <span className="text-[13px] font-semibold text-theme-text-primary flex-1 truncate">{section.heading_it || '(senza titolo)'}</span>
                </button>
                <div className="flex items-center gap-1">
                    <button onClick={onMoveUp} disabled={first} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                    <button onClick={onMoveDown} disabled={last} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                    <button onClick={onRemove} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                </div>
            </header>
            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-theme-border pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldText label="Heading (IT)" value={section.heading_it} onChange={v => onChange({ heading_it: v })} />
                        <FieldText label="Heading (EN)" value={section.heading_en} onChange={v => onChange({ heading_en: v })} />
                    </div>
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
                            <AddBlockButton label="+ Grassetto" onClick={() => addBlock('p-bold')} />
                            <AddBlockButton label="+ Corsivo" onClick={() => addBlock('p-italic')} />
                            <AddBlockButton label="+ Lista puntata" onClick={() => addBlock('ul')} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// All current sections are migrated, so PlaceholderSection isn't rendered.
// Keeping the spot reserved for the next sub-tab — define + remove together
// when the next migration lands.

// ─── Careers editor ─────────────────────────────────────────────────────────
function CareersEditor({ copy, setCopy }: { copy: CareersCopy; setCopy: (next: CareersCopy) => void }) {
    const update = <K extends keyof CareersCopy>(key: K, value: CareersCopy[K]) => setCopy({ ...copy, [key]: value })
    const updateJob = (idx: number, patch: Partial<CareersJob>) => {
        const next = [...copy.jobs]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, jobs: next })
    }
    const moveJob = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.jobs.length) return
        const next = [...copy.jobs]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, jobs: next })
    }
    const removeJob = (idx: number) => {
        if (!confirm('Rimuovere questa posizione?')) return
        setCopy({ ...copy, jobs: copy.jobs.filter((_, i) => i !== idx) })
    }
    const addJob = () => {
        setCopy({
            ...copy,
            jobs: [...copy.jobs, {
                id: `job-${Date.now().toString(36)}`,
                title_it: '', title_en: '',
                location_it: '', location_en: '',
                type_it: 'Tempo pieno', type_en: 'Full-time',
                description_it: '', description_en: '',
            }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Careers</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/careers</code>. Inline supportato nel testo "Come Candidarsi": <code>**grassetto**</code> e <code>[testo](mailto:...)</code>.
                </p>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={copy.page_title_it} onChange={v => update('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => update('page_title_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.intro_it} onChange={v => update('intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.intro_en} onChange={v => update('intro_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Posizioni Aperte ({copy.jobs.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading sezione (IT)" value={copy.jobs_heading_it} onChange={v => update('jobs_heading_it', v)} />
                    <FieldText label="Heading sezione (EN)" value={copy.jobs_heading_en} onChange={v => update('jobs_heading_en', v)} />
                </div>
                {copy.jobs.map((job, i) => (
                    <div key={job.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{job.title_it || '(senza titolo)'}</span>
                            <button onClick={() => moveJob(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveJob(i, 1)} disabled={i === copy.jobs.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeJob(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input type="text" value={job.title_it} onChange={e => updateJob(i, { title_it: e.target.value })} placeholder="Titolo IT" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.title_en} onChange={e => updateJob(i, { title_en: e.target.value })} placeholder="Title EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.location_it} onChange={e => updateJob(i, { location_it: e.target.value })} placeholder="Sede IT (es. Sede: Cagliari, Italia)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.location_en} onChange={e => updateJob(i, { location_en: e.target.value })} placeholder="Location EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.type_it} onChange={e => updateJob(i, { type_it: e.target.value })} placeholder="Tempo (IT) — es. Tempo pieno" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.type_en} onChange={e => updateJob(i, { type_en: e.target.value })} placeholder="Type EN — e.g. Full-time" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <textarea value={job.description_it} onChange={e => updateJob(i, { description_it: e.target.value })} placeholder="Descrizione IT" rows={3} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                            <textarea value={job.description_en} onChange={e => updateJob(i, { description_en: e.target.value })} placeholder="Description EN" rows={3} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                        </div>
                    </div>
                ))}
                <button onClick={addJob} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi posizione
                </button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Come Candidarsi</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.apply_heading_it} onChange={v => update('apply_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.apply_heading_en} onChange={v => update('apply_heading_en', v)} />
                    <FieldTextArea label="Testo (IT) — supporta inline markdown" value={copy.apply_text_it} onChange={v => update('apply_text_it', v)} />
                    <FieldTextArea label="Text (EN)" value={copy.apply_text_en} onChange={v => update('apply_text_en', v)} />
                </div>
                <FieldText label="Email candidature" value={copy.apply_email} onChange={v => update('apply_email', v)} />
            </section>
        </div>
    )
}

// ─── Press editor ───────────────────────────────────────────────────────────
function PressEditor({ copy, setCopy }: { copy: PressCopy; setCopy: (next: PressCopy) => void }) {
    const update = <K extends keyof PressCopy>(key: K, value: PressCopy[K]) => setCopy({ ...copy, [key]: value })
    const updateArt = (idx: number, patch: Partial<PressArticle>) => {
        const next = [...copy.articles]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, articles: next })
    }
    const moveArt = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.articles.length) return
        const next = [...copy.articles]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, articles: next })
    }
    const removeArt = (idx: number) => {
        if (!confirm('Rimuovere questo articolo?')) return
        setCopy({ ...copy, articles: copy.articles.filter((_, i) => i !== idx) })
    }
    const addArt = () => {
        setCopy({
            ...copy,
            articles: [...copy.articles, {
                id: `art-${Date.now().toString(36)}`,
                title: '', publication: '', date: '',
                summary_it: '', summary_en: '',
                link: 'https://',
            }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Press</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/press</code>. Hero, sezione "Richieste Stampa", lista articoli, sezione "Comunicati Stampa".
                </p>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={copy.page_title_it} onChange={v => update('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => update('page_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => update('subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.subtitle_en} onChange={v => update('subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Richieste Stampa (banda)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.inquiries_heading_it} onChange={v => update('inquiries_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.inquiries_heading_en} onChange={v => update('inquiries_heading_en', v)} />
                    <FieldTextArea label="Testo (IT)" value={copy.inquiries_text_it} onChange={v => update('inquiries_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.inquiries_text_en} onChange={v => update('inquiries_text_en', v)} />
                    <FieldText label="Etichetta email (IT)" value={copy.inquiries_email_label_it} onChange={v => update('inquiries_email_label_it', v)} />
                    <FieldText label="Etichetta email (EN)" value={copy.inquiries_email_label_en} onChange={v => update('inquiries_email_label_en', v)} />
                </div>
                <FieldText label="Email contatto" value={copy.inquiries_email} onChange={v => update('inquiries_email', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Sui Media — Articoli ({copy.articles.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Heading sezione (IT) — es. "Sui Media"' value={copy.news_heading_it} onChange={v => update('news_heading_it', v)} />
                    <FieldText label="Heading sezione (EN)" value={copy.news_heading_en} onChange={v => update('news_heading_en', v)} />
                    <FieldText label='Etichetta "Leggi articolo" (IT)' value={copy.read_more_label_it} onChange={v => update('read_more_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.read_more_label_en} onChange={v => update('read_more_label_en', v)} />
                </div>
                {copy.articles.map((a, i) => (
                    <div key={a.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{a.title || '(senza titolo)'}</span>
                            <button onClick={() => moveArt(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveArt(i, 1)} disabled={i === copy.articles.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeArt(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <input type="text" value={a.title} onChange={e => updateArt(i, { title: e.target.value })} placeholder="Titolo articolo (lingua originale)" className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input type="text" value={a.publication} onChange={e => updateArt(i, { publication: e.target.value })} placeholder="Testata (es. Casteddu Online)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={a.date} onChange={e => updateArt(i, { date: e.target.value })} placeholder="Data (es. 28 Maggio 2025)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        </div>
                        <input type="text" value={a.link} onChange={e => updateArt(i, { link: e.target.value })} placeholder="https://..." className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <textarea value={a.summary_it} onChange={e => updateArt(i, { summary_it: e.target.value })} placeholder="Sommario IT" rows={3} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                            <textarea value={a.summary_en} onChange={e => updateArt(i, { summary_en: e.target.value })} placeholder="Summary EN" rows={3} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                        </div>
                    </div>
                ))}
                <button onClick={addArt} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi articolo
                </button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Comunicati Stampa (banda)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.releases_heading_it} onChange={v => update('releases_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.releases_heading_en} onChange={v => update('releases_heading_en', v)} />
                    <FieldTextArea label="Testo (IT)" value={copy.releases_text_it} onChange={v => update('releases_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.releases_text_en} onChange={v => update('releases_text_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Contact editor ─────────────────────────────────────────────────────────
function ContactEditor({ copy, setCopy }: { copy: ContactCopy; setCopy: (next: ContactCopy) => void }) {
    const update = <K extends keyof ContactCopy>(key: K, value: ContactCopy[K]) => setCopy({ ...copy, [key]: value })
    const setHoursIt = (lines: string[]) => setCopy({ ...copy, hours_lines_it: lines })
    const setHoursEn = (lines: string[]) => setCopy({ ...copy, hours_lines_en: lines })

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Contatti</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/contact</code>. Hero, 4 card (Telefono / WhatsApp / Email / Orari), info azienda, mappa.
                </p>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={copy.page_title_it} onChange={v => update('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => update('page_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => update('subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.subtitle_en} onChange={v => update('subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card: Telefono</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta (IT)" value={copy.phone_label_it} onChange={v => update('phone_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.phone_label_en} onChange={v => update('phone_label_en', v)} />
                    <FieldText label="Numero visualizzato" value={copy.phone_display} onChange={v => update('phone_display', v)} />
                    <FieldText label='URL "tel:" (es. tel:+393457905205)' value={copy.phone_tel_url} onChange={v => update('phone_tel_url', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card: WhatsApp</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta card (IT)" value={copy.whatsapp_label_it} onChange={v => update('whatsapp_label_it', v)} />
                    <FieldText label="Etichetta card (EN)" value={copy.whatsapp_label_en} onChange={v => update('whatsapp_label_en', v)} />
                    <FieldText label="Bottone (IT)" value={copy.whatsapp_button_it} onChange={v => update('whatsapp_button_it', v)} />
                    <FieldText label="Bottone (EN)" value={copy.whatsapp_button_en} onChange={v => update('whatsapp_button_en', v)} />
                </div>
                <FieldText label="URL WhatsApp" value={copy.whatsapp_url} onChange={v => update('whatsapp_url', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card: Email</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta (IT)" value={copy.email_label_it} onChange={v => update('email_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.email_label_en} onChange={v => update('email_label_en', v)} />
                </div>
                <FieldText label="Indirizzo email" value={copy.email_address} onChange={v => update('email_address', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card: Orari</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta (IT)" value={copy.hours_label_it} onChange={v => update('hours_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.hours_label_en} onChange={v => update('hours_label_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Righe IT (una per linea)" value={copy.hours_lines_it.join('\n')} onChange={v => setHoursIt(v.split('\n').filter(s => s.length > 0))} />
                    <FieldTextArea label="Lines EN (one per line)" value={copy.hours_lines_en.join('\n')} onChange={v => setHoursEn(v.split('\n').filter(s => s.length > 0))} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Sede Operativa</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.office_heading_it} onChange={v => update('office_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.office_heading_en} onChange={v => update('office_heading_en', v)} />
                </div>
                <FieldText label="Ragione sociale" value={copy.office_company_name} onChange={v => update('office_company_name', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Indirizzo (IT)" value={copy.office_address_it} onChange={v => update('office_address_it', v)} />
                    <FieldText label="Address (EN)" value={copy.office_address_en} onChange={v => update('office_address_en', v)} />
                </div>
                <FieldText label="P.IVA / C.F." value={copy.office_piva} onChange={v => update('office_piva', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Mappa</h3>
                <FieldText label="Title accessibilità (IT)" value={copy.map_title_it ?? ''} onChange={v => update('map_title_it', v)} />
                <FieldText label="Title accessibility (EN)" value={copy.map_title_en ?? ''} onChange={v => update('map_title_en', v)} />
                <FieldText label="URL iframe (OpenStreetMap embed)" value={copy.map_iframe_url} onChange={v => update('map_iframe_url', v)} />
                {copy.map_iframe_url && (
                    <div className="rounded-xl overflow-hidden border border-theme-border">
                        <iframe title={copy.map_title || 'preview'} src={copy.map_iframe_url} width="100%" height="200" style={{ border: 0 }} loading="lazy" />
                    </div>
                )}
            </section>
        </div>
    )
}

// ─── Flotta page editor (visible categories only — catalog lives in Veicoli) ─
// Carica le categorie da centralina_pro_config.config.categories e lascia
// scegliere quali esporre sul sito pubblico (pagina "La Nostra Flotta",
// menu e filtri della RentalPage).
//
// Due modalita', salvate in site_copy.flotta.mode:
//   'all'     mostra tutte le categorie, comprese quelle aggiunte in futuro
//   'custom'  mostra esattamente quelle spuntate — nessuna spunta = nessuna
//             categoria sul sito
// Una riga salvata prima che `mode` esistesse non ce l'ha: il sito la legge
// come "mai configurata" e mostra tutto. Basta salvare una volta da qui per
// renderla esplicita. La regola vive nel sito in utils/flottaConfig.ts.
function FlottaEditor({ copy, setCopy }: { copy: FlottaCopy; setCopy: (next: FlottaCopy) => void }) {
    const [categories, setCategories] = useState<{ id: string; label: string }[]>([])
    const [loadingCats, setLoadingCats] = useState(true)
    const [catsError, setCatsError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data, error } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (cancelled) return
            if (error) {
                setCatsError(error.message)
                setLoadingCats(false)
                return
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cats = ((data?.config || {}) as any).categories
            if (Array.isArray(cats)) {
                setCategories(cats.filter((c: { id?: unknown; label?: unknown }) => typeof c?.id === 'string' && typeof c?.label === 'string') as { id: string; label: string }[])
            }
            setLoadingCats(false)
        })()
        return () => { cancelled = true }
    }, [])

    const isCustom = copy.mode === 'custom'
    const selected = new Set(copy.visible_category_ids)

    // Id salvati che non corrispondono piu' a nessuna categoria: succede
    // quando una categoria viene rinominata o cancellata in Centralina Pro.
    // Il sito li ignora; qui vanno detti, altrimenti l'operatore vede "3
    // selezionate" e sul sito ne compaiono 2.
    const knownIds = new Set(categories.map(c => c.id))
    const orphanIds = loadingCats ? [] : copy.visible_category_ids.filter(id => !knownIds.has(id))
    // Duplicati nella lista salvata: contati una volta sola dal sito.
    const duplicateIds = [...new Set(copy.visible_category_ids.filter((id, i) => copy.visible_category_ids.indexOf(id) !== i))]

    const setMode = (mode: 'all' | 'custom') => {
        if (mode === 'all') { setCopy({ mode: 'all', visible_category_ids: [] }); return }
        // Passando a "scelgo io" partiamo da quello che il sito sta gia'
        // mostrando (tutte), cosi' il primo salvataggio non svuota la pagina.
        setCopy({ mode: 'custom', visible_category_ids: categories.map(c => c.id) })
    }

    const toggle = (id: string) => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id); else next.add(id)
        setCopy({ mode: 'custom', visible_category_ids: Array.from(next) })
    }

    const effectSummary = !isCustom && copy.mode !== 'all'
        ? 'Sezione mai configurata: il sito mostra tutte le categorie.'
        : copy.mode === 'all'
            ? 'Il sito mostra tutte le categorie, comprese quelle che aggiungerai in futuro.'
            : selected.size === 0
                ? 'Il sito non mostra NESSUNA categoria.'
                : `Il sito mostra ${selected.size} ${selected.size === 1 ? 'categoria' : 'categorie'} su ${categories.length}.`

    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Scegli quali categorie veicoli del Centralina Pro mostrare nella pagina pubblica
                <strong> "La Nostra Flotta"</strong>, nel menu e nei filtri delle pagine noleggio.
                Il catalogo dei veicoli resta nella tab <strong>Veicoli</strong>: qui si decide
                solo cosa e' visibile.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="space-y-2">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">Cosa mostrare sul sito</h3>
                    <label className="flex items-start gap-3 text-[13px] text-theme-text-primary cursor-pointer">
                        <input
                            type="radio"
                            name="flotta-mode"
                            checked={copy.mode === 'all'}
                            onChange={() => setMode('all')}
                            className="mt-1 w-4 h-4"
                        />
                        <span>
                            <span className="font-medium">Tutte le categorie</span>
                            <span className="block text-[11px] text-theme-text-muted">
                                Anche quelle che verranno aggiunte in futuro in Centralina Pro.
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-3 text-[13px] text-theme-text-primary cursor-pointer">
                        <input
                            type="radio"
                            name="flotta-mode"
                            checked={isCustom}
                            onChange={() => setMode('custom')}
                            className="mt-1 w-4 h-4"
                        />
                        <span>
                            <span className="font-medium">Scelgo io quali</span>
                            <span className="block text-[11px] text-theme-text-muted">
                                Vengono mostrate solo le categorie spuntate qui sotto. Nessuna spunta = nessuna categoria sul sito.
                            </span>
                        </span>
                    </label>
                </div>

                <div className="text-[12px] text-theme-text-secondary border-t border-theme-border pt-3">
                    {effectSummary}
                </div>

                {catsError && (
                    <div className="text-[12px] text-red-500">
                        Categorie non caricate ({catsError}). Ricarica la pagina prima di salvare:
                        salvando adesso rischi di sovrascrivere la selezione esistente.
                    </div>
                )}

                {orphanIds.length > 0 && (
                    <div className="text-[12px] text-amber-600">
                        Categorie salvate che non esistono piu' in Centralina Pro e che il sito ignora:{' '}
                        <span className="font-mono">{orphanIds.join(', ')}</span>.
                        <button
                            type="button"
                            onClick={() => setCopy({ mode: 'custom', visible_category_ids: copy.visible_category_ids.filter(id => knownIds.has(id)) })}
                            className="ml-2 underline"
                        >
                            Rimuovile
                        </button>
                    </div>
                )}

                {duplicateIds.length > 0 && (
                    <div className="text-[12px] text-amber-600">
                        Id ripetuti nella selezione (contati una volta sola):{' '}
                        <span className="font-mono">{duplicateIds.join(', ')}</span>.
                    </div>
                )}
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">Categorie</h3>
                    <span className="text-[11px] text-theme-text-muted">
                        {isCustom ? `${selected.size} di ${categories.length} selezionate` : 'Tutte'}
                    </span>
                </div>
                {loadingCats ? (
                    <div className="text-sm text-theme-text-muted">Carico categorie da Centralina Pro...</div>
                ) : categories.length === 0 ? (
                    <div className="text-sm text-theme-text-muted">
                        Nessuna categoria trovata in Centralina Pro. Aggiungile dalla tab Centralina Pro &gt; Categorie.
                    </div>
                ) : (
                    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 ${isCustom ? '' : 'opacity-50 pointer-events-none'}`}>
                        {categories.map(cat => {
                            const on = isCustom ? selected.has(cat.id) : true
                            return (
                                <label
                                    key={cat.id}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                        on
                                            ? 'border-theme-text-primary bg-theme-bg-tertiary'
                                            : 'border-theme-border bg-theme-bg-secondary hover:bg-theme-bg-tertiary'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!isCustom}
                                        onChange={() => toggle(cat.id)}
                                        className="w-4 h-4 rounded border-theme-border"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-theme-text-primary truncate">{cat.label}</div>
                                        <div className="text-[10px] text-theme-text-muted font-mono">{cat.id}</div>
                                    </div>
                                </label>
                            )
                        })}
                    </div>
                )}
                {isCustom && categories.length > 0 && (
                    <div className="flex gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setCopy({ mode: 'custom', visible_category_ids: categories.map(c => c.id) })}
                            className="text-[11px] px-3 py-1.5 rounded-full border border-theme-border bg-theme-bg-secondary text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
                        >
                            Spunta tutte
                        </button>
                        <button
                            type="button"
                            onClick={() => setCopy({ mode: 'custom', visible_category_ids: [] })}
                            className="text-[11px] px-3 py-1.5 rounded-full border border-theme-border bg-theme-bg-secondary text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
                        >
                            Togli tutte
                        </button>
                    </div>
                )}
            </section>
        </div>
    )
}

// ─── Mechanical Services editor (chrome only — catalog lives elsewhere) ───
function MechanicalEditor({ copy, setCopy }: { copy: MechanicalCopy; setCopy: (next: MechanicalCopy) => void }) {
    const update = <K extends keyof MechanicalCopy>(key: K, value: MechanicalCopy[K]) => setCopy({ ...copy, [key]: value })

    // How steps
    const updateStep = (idx: number, patch: Partial<MechanicalHowStep>) => {
        const next = [...copy.how_steps]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, how_steps: next })
    }
    const moveStep = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.how_steps.length) return
        const next = [...copy.how_steps]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, how_steps: next })
    }
    const removeStep = (idx: number) => {
        if (!confirm('Rimuovere questo step?')) return
        setCopy({ ...copy, how_steps: copy.how_steps.filter((_, i) => i !== idx) })
    }
    const addStep = () => {
        setCopy({
            ...copy,
            how_steps: [...copy.how_steps, { title_it: '', title_en: '', text_it: '', text_en: '' }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Servizi Meccanica</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/mechanical-services</code> — chrome editabile (hero, "Come Funziona", orari, label bottoni).
                </p>
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Il <b>catalogo servizi</b> (prezzi, nomi, categorie) si gestisce dal tab <b>Catalogo Lavaggio &amp; Meccanica</b> con il filtro <b>MECCANICA</b>.
                </div>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
                <FieldText label='Titolo (es. "DR7 RAPID SERVICE")' value={copy.hero_title} onChange={v => update('hero_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sottotitolo (IT)" value={copy.hero_subtitle_it} onChange={v => update('hero_subtitle_it', v)} />
                    <FieldText label="Sottotitolo (EN)" value={copy.hero_subtitle_en} onChange={v => update('hero_subtitle_en', v)} />
                    <FieldTextArea label="Riga intro (IT)" value={copy.hero_intro_it} onChange={v => update('hero_intro_it', v)} />
                    <FieldTextArea label="Riga intro (EN)" value={copy.hero_intro_en} onChange={v => update('hero_intro_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Etichette card servizi</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone (IT) — es. "PRENOTA ORA"' value={copy.book_now_label_it} onChange={v => update('book_now_label_it', v)} />
                    <FieldText label="Bottone (EN)" value={copy.book_now_label_en} onChange={v => update('book_now_label_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">"Come Funziona" ({copy.how_steps.length} step)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.how_heading_it} onChange={v => update('how_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.how_heading_en} onChange={v => update('how_heading_en', v)} />
                </div>
                {copy.how_steps.map((step, i) => (
                    <div key={i} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-theme-text-secondary">Step {i + 1}</span>
                            <span className="text-[11px] text-theme-text-secondary flex-1 truncate">{step.title_it || '(senza titolo)'}</span>
                            <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveStep(i, 1)} disabled={i === copy.how_steps.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeStep(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input type="text" value={step.title_it} onChange={e => updateStep(i, { title_it: e.target.value })} placeholder='Titolo IT (es. "1. Prenota Online")' className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={step.title_en} onChange={e => updateStep(i, { title_en: e.target.value })} placeholder="Title EN" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <textarea value={step.text_it} onChange={e => updateStep(i, { text_it: e.target.value })} placeholder="Testo IT" rows={2} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                            <textarea value={step.text_en} onChange={e => updateStep(i, { text_en: e.target.value })} placeholder="Text EN" rows={2} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                        </div>
                    </div>
                ))}
                <button onClick={addStep} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi step
                </button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Orari di Apertura</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.hours_heading_it} onChange={v => update('hours_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.hours_heading_en} onChange={v => update('hours_heading_en', v)} />
                    <FieldText label="Riga principale (IT)" value={copy.hours_main_it} onChange={v => update('hours_main_it', v)} />
                    <FieldText label="Riga principale (EN)" value={copy.hours_main_en} onChange={v => update('hours_main_en', v)} />
                    <FieldText label="Sotto-riga (IT)" value={copy.hours_sub_it} onChange={v => update('hours_sub_it', v)} />
                    <FieldText label="Sotto-riga (EN)" value={copy.hours_sub_en} onChange={v => update('hours_sub_en', v)} />
                </div>
            </section>
        </div>
    )
}

// MechanicalServiceCard removed: catalogo meccanica vive in tab "Catalogo
// Prime Wash" (filtro MECCANICA), non in Sito CMS.

// ─── Car Wash editor (chrome only — catalog lives in Catalogo Prime Wash) ──
function CarWashEditor({ copy, setCopy }: { copy: CarWashCopy; setCopy: (next: CarWashCopy) => void }) {
    const update = <K extends keyof CarWashCopy>(key: K, value: CarWashCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Servizi Lavaggio</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/car-wash-services</code> — etichette UI editabili.
                </p>
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Il <b>catalogo lavaggi</b> (servizi, prezzi, immagini) si gestisce dal tab <b>Catalogo Lavaggio &amp; Meccanica</b> con il filtro <b>LAVAGGIO</b>.
                </div>
            </div>

            {/* Plate entry */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Inserimento targa (sezione iniziale)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta input (IT)" value={copy.plate_label_it} onChange={v => update('plate_label_it', v)} />
                    <FieldText label="Etichetta input (EN)" value={copy.plate_label_en} onChange={v => update('plate_label_en', v)} />
                    <FieldTextArea label="Testo helper (IT)" value={copy.plate_helper_it} onChange={v => update('plate_helper_it', v)} />
                    <FieldTextArea label="Testo helper (EN)" value={copy.plate_helper_en} onChange={v => update('plate_helper_en', v)} />
                    <FieldText label="Placeholder (IT)" value={copy.plate_placeholder_it} onChange={v => update('plate_placeholder_it', v)} />
                    <FieldText label="Placeholder (EN)" value={copy.plate_placeholder_en} onChange={v => update('plate_placeholder_en', v)} />
                    <FieldText label='Bottone Cerca (IT)' value={copy.plate_search_it} onChange={v => update('plate_search_it', v)} />
                    <FieldText label="Search button (EN)" value={copy.plate_search_en} onChange={v => update('plate_search_en', v)} />
                    <FieldText label='Stato "Cercando..." (IT)' value={copy.plate_searching_it} onChange={v => update('plate_searching_it', v)} />
                    <FieldText label='State "Searching..." (EN)' value={copy.plate_searching_en} onChange={v => update('plate_searching_en', v)} />
                    <FieldTextArea label="Prompt categoria manuale (IT)" value={copy.plate_manual_prompt_it} onChange={v => update('plate_manual_prompt_it', v)} />
                    <FieldTextArea label="Manual category prompt (EN)" value={copy.plate_manual_prompt_en} onChange={v => update('plate_manual_prompt_en', v)} />
                    <FieldText label='"Cambia veicolo" (IT)' value={copy.plate_change_it} onChange={v => update('plate_change_it', v)} />
                    <FieldText label='"Change vehicle" (EN)' value={copy.plate_change_en} onChange={v => update('plate_change_en', v)} />
                </div>
            </section>

            {/* Card servizio */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card servizio</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone "AGGIUNGI AL CARRELLO" (IT)' value={copy.add_to_cart_it} onChange={v => update('add_to_cart_it', v)} />
                    <FieldText label='Button "ADD TO CART" (EN)' value={copy.add_to_cart_en} onChange={v => update('add_to_cart_en', v)} />
                </div>
            </section>

            {/* Cart drawer */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Drawer carrello</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo carrello (IT)" value={copy.cart_title_it} onChange={v => update('cart_title_it', v)} />
                    <FieldText label="Cart title (EN)" value={copy.cart_title_en} onChange={v => update('cart_title_en', v)} />
                    <FieldText label='Stato vuoto (IT)' value={copy.cart_empty_it} onChange={v => update('cart_empty_it', v)} />
                    <FieldText label='Empty state (EN)' value={copy.cart_empty_en} onChange={v => update('cart_empty_en', v)} />
                    <FieldText label='"Rimuovi" link (IT)' value={copy.cart_remove_it} onChange={v => update('cart_remove_it', v)} />
                    <FieldText label='"Remove" link (EN)' value={copy.cart_remove_en} onChange={v => update('cart_remove_en', v)} />
                    <FieldText label='Etichetta "Totale" (IT)' value={copy.cart_total_it} onChange={v => update('cart_total_it', v)} />
                    <FieldText label='Label "Total" (EN)' value={copy.cart_total_en} onChange={v => update('cart_total_en', v)} />
                    <FieldText label='Bottone "PROCEDI" (IT)' value={copy.cart_checkout_it} onChange={v => update('cart_checkout_it', v)} />
                    <FieldText label='Button "CHECKOUT" (EN)' value={copy.cart_checkout_en} onChange={v => update('cart_checkout_en', v)} />
                </div>
            </section>

            {/* Upsell overlay */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Overlay Extra Care (upsell)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone "Rivedi carrello" (IT)' value={copy.upsell_review_cart_it} onChange={v => update('upsell_review_cart_it', v)} />
                    <FieldText label='Button "Review Cart" (EN)' value={copy.upsell_review_cart_en} onChange={v => update('upsell_review_cart_en', v)} />
                    <FieldText label="Step 1 — Titolo (IT)" value={copy.upsell_step1_title_it} onChange={v => update('upsell_step1_title_it', v)} />
                    <FieldText label="Step 1 — Title (EN)" value={copy.upsell_step1_title_en} onChange={v => update('upsell_step1_title_en', v)} />
                    <FieldTextArea label="Step 1 — Testo (IT)" value={copy.upsell_step1_text_it} onChange={v => update('upsell_step1_text_it', v)} />
                    <FieldTextArea label="Step 1 — Text (EN)" value={copy.upsell_step1_text_en} onChange={v => update('upsell_step1_text_en', v)} />
                    <FieldText label="Step 2 — Titolo (IT)" value={copy.upsell_step2_title_it} onChange={v => update('upsell_step2_title_it', v)} />
                    <FieldText label="Step 2 — Title (EN)" value={copy.upsell_step2_title_en} onChange={v => update('upsell_step2_title_en', v)} />
                    <FieldTextArea label="Step 2 — Testo (IT)" value={copy.upsell_step2_text_it} onChange={v => update('upsell_step2_text_it', v)} />
                    <FieldTextArea label="Step 2 — Text (EN)" value={copy.upsell_step2_text_en} onChange={v => update('upsell_step2_text_en', v)} />
                    <FieldText label='Stato "Aggiunto ✓" (IT)' value={copy.upsell_added_it} onChange={v => update('upsell_added_it', v)} />
                    <FieldText label='State "Added ✓" (EN)' value={copy.upsell_added_en} onChange={v => update('upsell_added_en', v)} />
                    <FieldText label='Bottone "Aggiungi" (IT)' value={copy.upsell_add_it} onChange={v => update('upsell_add_it', v)} />
                    <FieldText label='Button "Add" (EN)' value={copy.upsell_add_en} onChange={v => update('upsell_add_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Investitori editor (IT-only sales page) ───────────────────────────────
function InvestitoriEditor({ copy, setCopy }: { copy: InvestitoriCopy; setCopy: (next: InvestitoriCopy) => void }) {
    const update = <K extends keyof InvestitoriCopy>(key: K, value: InvestitoriCopy[K]) => setCopy({ ...copy, [key]: value })
    type ParagraphList = 'intro_paragraphs' | 'opportunity_paragraphs' | 'cta_paragraphs' | 'legal_paragraphs'
    // Il sito legge queste liste con bilingualList(), che preferisce
    // `_it`/`_en`: scrivere il vecchio array unilingue non cambiava nulla.
    const paragraphs = (key: ParagraphList, lang: 'it' | 'en'): string[] =>
        (copy[`${key}_${lang}`] as string[] | undefined) ?? []
    const updateParagraphList = (key: ParagraphList, lang: 'it' | 'en', value: string) => {
        setCopy({ ...copy, [`${key}_${lang}`]: value.split('\n\n').filter(s => s.trim().length > 0) })
    }
    // strength_points
    const updateStrength = (idx: number, patch: Partial<InvestitoriStrength>) => {
        const next = [...copy.strength_points]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, strength_points: next })
    }
    const moveStrength = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.strength_points.length) return
        const next = [...copy.strength_points]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, strength_points: next })
    }
    const removeStrength = (idx: number) => {
        if (!confirm('Rimuovere questo punto di forza?')) return
        setCopy({ ...copy, strength_points: copy.strength_points.filter((_, i) => i !== idx) })
    }
    const addStrength = () => {
        setCopy({ ...copy, strength_points: [...copy.strength_points, { id: `s-${Date.now().toString(36)}`, title: '', description: '' }] })
    }
    // info_items
    const updateInfo = (idx: number, patch: Partial<InvestitoriInfoItem>) => {
        const next = [...copy.info_items]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, info_items: next })
    }
    const moveInfo = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.info_items.length) return
        const next = [...copy.info_items]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, info_items: next })
    }
    const removeInfo = (idx: number) => {
        if (!confirm('Rimuovere questa riga informativa?')) return
        setCopy({ ...copy, info_items: copy.info_items.filter((_, i) => i !== idx) })
    }
    const addInfo = () => {
        setCopy({ ...copy, info_items: [...copy.info_items, { label: '', value: '' }] })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Investitori</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/investitori</code> — pagina IT-only (no traduzioni EN). I paragrafi multipli si separano con <b>riga vuota</b> (doppio invio).
                </p>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
                <FieldText label="Titolo (IT)" value={copy.hero_title_it ?? ''} onChange={v => update('hero_title_it', v)} />
                <FieldText label="Titolo (EN)" value={copy.hero_title_en ?? ''} onChange={v => update('hero_title_en', v)} />
                <FieldText label="Sottotitolo (IT)" value={copy.hero_subtitle_it ?? ''} onChange={v => update('hero_subtitle_it', v)} />
                <FieldText label="Sottotitolo (EN)" value={copy.hero_subtitle_en ?? ''} onChange={v => update('hero_subtitle_en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Introduzione</h3>
                <FieldTextArea label="Paragrafi IT (separati da riga vuota)" value={paragraphs('intro_paragraphs', 'it').join('\n\n')} onChange={v => updateParagraphList('intro_paragraphs', 'it', v)} />
                <FieldTextArea label="Paragraphs EN (blank line between)" value={paragraphs('intro_paragraphs', 'en').join('\n\n')} onChange={v => updateParagraphList('intro_paragraphs', 'en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Opportunità di partecipazione</h3>
                <FieldText label="Heading (IT)" value={copy.opportunity_heading_it ?? ''} onChange={v => update('opportunity_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.opportunity_heading_en ?? ''} onChange={v => update('opportunity_heading_en', v)} />
                <FieldTextArea label="Paragrafi IT (separati da riga vuota)" value={paragraphs('opportunity_paragraphs', 'it').join('\n\n')} onChange={v => updateParagraphList('opportunity_paragraphs', 'it', v)} />
                <FieldTextArea label="Paragraphs EN (blank line between)" value={paragraphs('opportunity_paragraphs', 'en').join('\n\n')} onChange={v => updateParagraphList('opportunity_paragraphs', 'en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Punti di forza ({copy.strength_points.length})</h3>
                <FieldText label="Heading (IT)" value={copy.strength_heading_it ?? ''} onChange={v => update('strength_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.strength_heading_en ?? ''} onChange={v => update('strength_heading_en', v)} />
                {copy.strength_points.map((s, i) => (
                    <div key={s.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{s.title || '(senza titolo)'}</span>
                            <button onClick={() => moveStrength(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveStrength(i, 1)} disabled={i === copy.strength_points.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeStrength(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <input type="text" value={s.title} onChange={e => updateStrength(i, { title: e.target.value })} placeholder="Titolo punto di forza" className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-semibold" />
                        <textarea value={s.description} onChange={e => updateStrength(i, { description: e.target.value })} placeholder="Descrizione" rows={2} className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                    </div>
                ))}
                <button onClick={addStrength} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi punto di forza
                </button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">CTA — Modalità di adesione</h3>
                <FieldText label="Heading (IT)" value={copy.cta_heading_it ?? ''} onChange={v => update('cta_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.cta_heading_en ?? ''} onChange={v => update('cta_heading_en', v)} />
                <FieldTextArea label="Paragrafi IT (separati da riga vuota)" value={paragraphs('cta_paragraphs', 'it').join('\n\n')} onChange={v => updateParagraphList('cta_paragraphs', 'it', v)} />
                <FieldTextArea label="Paragraphs EN (blank line between)" value={paragraphs('cta_paragraphs', 'en').join('\n\n')} onChange={v => updateParagraphList('cta_paragraphs', 'en', v)} />
                <FieldText label="Etichetta bottone primario (IT)" value={copy.cta_button_label_it ?? ''} onChange={v => update('cta_button_label_it', v)} />
                <FieldText label="Etichetta bottone primario (EN)" value={copy.cta_button_label_en ?? ''} onChange={v => update('cta_button_label_en', v)} />
                <FieldText label="URL WhatsApp (con testo precompilato)" value={copy.cta_whatsapp_url} onChange={v => update('cta_whatsapp_url', v)} />
                <FieldText label="Email investitori (bottone secondario)" value={copy.cta_email} onChange={v => update('cta_email', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Informazioni sintetiche ({copy.info_items.length})</h3>
                <FieldText label="Heading (IT)" value={copy.info_heading_it ?? ''} onChange={v => update('info_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.info_heading_en ?? ''} onChange={v => update('info_heading_en', v)} />
                {copy.info_items.map((it, i) => (
                    <div key={i} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2 items-center">
                        <input type="text" value={it.label} onChange={e => updateInfo(i, { label: e.target.value })} placeholder="Etichetta (es. Denominazione)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={it.value} onChange={e => updateInfo(i, { value: e.target.value })} placeholder="Valore" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveInfo(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveInfo(i, 1)} disabled={i === copy.info_items.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeInfo(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                    </div>
                ))}
                <button onClick={addInfo} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi riga
                </button>
                <FieldTextArea label="Footnote sotto la tabella (corsivo) (IT)" value={copy.info_footnote_it ?? ''} onChange={v => update('info_footnote_it', v)} />
                <FieldTextArea label="Footnote sotto la tabella (corsivo) (EN)" value={copy.info_footnote_en ?? ''} onChange={v => update('info_footnote_en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Avvertenza legale (banda rossa)</h3>
                <FieldText label="Heading (IT)" value={copy.legal_heading_it ?? ''} onChange={v => update('legal_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.legal_heading_en ?? ''} onChange={v => update('legal_heading_en', v)} />
                <FieldTextArea label="Paragrafi IT (separati da riga vuota)" value={paragraphs('legal_paragraphs', 'it').join('\n\n')} onChange={v => updateParagraphList('legal_paragraphs', 'it', v)} />
                <FieldTextArea label="Paragraphs EN (blank line between)" value={paragraphs('legal_paragraphs', 'en').join('\n\n')} onChange={v => updateParagraphList('legal_paragraphs', 'en', v)} />
            </section>
        </div>
    )
}

// ─── Franchising editor (IT-only sales page) ───────────────────────────────
const FRANCHISING_EXPANSION_ICONS: FranchisingExpansionIcon[] = ['square', 'diamond', 'lines']
const FRANCHISING_BENEFIT_ICONS: FranchisingBenefitIcon[] = ['check', 'shield', 'star']

function FranchisingEditor({ copy, setCopy }: { copy: FranchisingCopy; setCopy: (next: FranchisingCopy) => void }) {
    const update = <K extends keyof FranchisingCopy>(key: K, value: FranchisingCopy[K]) => setCopy({ ...copy, [key]: value })
    // List helpers
    type StringList = 'stats_lines' | 'about_paragraphs'
    // Stessa regola: il sito legge in bilingue, quindi si scrive `_it`/`_en`.
    const stringList = (key: StringList, lang: 'it' | 'en'): string[] =>
        (copy[`${key}_${lang}`] as string[] | undefined) ?? []
    const setStringList = (key: StringList, lang: 'it' | 'en', v: string) => {
        const lines = key === 'stats_lines' ? v.split('\n').filter(s => s.length > 0) : v.split('\n\n').filter(s => s.trim().length > 0)
        setCopy({ ...copy, [`${key}_${lang}`]: lines })
    }
    // Expansion locations
    const updateLoc = (idx: number, patch: Partial<FranchisingExpansionLocation>) => {
        const next = [...copy.expansion_locations]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, expansion_locations: next })
    }
    const moveLoc = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.expansion_locations.length) return
        const next = [...copy.expansion_locations]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, expansion_locations: next })
    }
    const removeLoc = (idx: number) => {
        if (!confirm('Rimuovere questa sede?')) return
        setCopy({ ...copy, expansion_locations: copy.expansion_locations.filter((_, i) => i !== idx) })
    }
    const addLoc = () => {
        setCopy({ ...copy, expansion_locations: [...copy.expansion_locations, { id: `loc-${Date.now().toString(36)}`, icon: 'square', name: '', description: '' }] })
    }
    // Benefits
    const updateBenefit = (idx: number, patch: Partial<FranchisingBenefit>) => {
        const next = [...copy.benefits]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, benefits: next })
    }
    const moveBenefit = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.benefits.length) return
        const next = [...copy.benefits]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, benefits: next })
    }
    const removeBenefit = (idx: number) => {
        if (!confirm('Rimuovere questo benefit?')) return
        setCopy({ ...copy, benefits: copy.benefits.filter((_, i) => i !== idx) })
    }
    const addBenefit = () => {
        setCopy({ ...copy, benefits: [...copy.benefits, { id: `b-${Date.now().toString(36)}`, icon: 'check', title: '', description: '' }] })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Franchising</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/franchising</code> — pagina IT-only. Placeholder <code>{'{reviewCount}'}</code> nelle stats viene risolto a runtime con il conteggio Google Reviews live.
                </p>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
                <FieldText label="Titolo (h2) (IT)" value={copy.hero_h2_it ?? ''} onChange={v => update('hero_h2_it', v)} />
                <FieldText label="Titolo (h2) (EN)" value={copy.hero_h2_en ?? ''} onChange={v => update('hero_h2_en', v)} />
                <FieldText label="Sottotitolo principale (IT)" value={copy.hero_p1_it ?? ''} onChange={v => update('hero_p1_it', v)} />
                <FieldText label="Sottotitolo principale (EN)" value={copy.hero_p1_en ?? ''} onChange={v => update('hero_p1_en', v)} />
                <FieldTextArea label="Sottotitolo secondario (newline = a-capo) (IT)" value={copy.hero_p2_it ?? ''} onChange={v => update('hero_p2_it', v)} />
                <FieldTextArea label="Sottotitolo secondario (newline = a-capo) (EN)" value={copy.hero_p2_en ?? ''} onChange={v => update('hero_p2_en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stats — In soli X mesi</h3>
                <FieldText label="Heading (IT)" value={copy.stats_heading_it ?? ''} onChange={v => update('stats_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.stats_heading_en ?? ''} onChange={v => update('stats_heading_en', v)} />
                <FieldTextArea label='Righe stats IT (una per linea — usa "* xxx" per il pallino. Placeholder {reviewCount})' value={stringList('stats_lines', 'it').join('\n')} onChange={v => setStringList('stats_lines', 'it', v)} />
                <FieldTextArea label='Stats lines EN (one per line — "* xxx" for the bullet. Placeholder {reviewCount})' value={stringList('stats_lines', 'en').join('\n')} onChange={v => setStringList('stats_lines', 'en', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Footer principale (IT)" value={copy.stats_footer_main_it ?? ''} onChange={v => update('stats_footer_main_it', v)} />
                    <FieldText label="Footer principale (EN)" value={copy.stats_footer_main_en ?? ''} onChange={v => update('stats_footer_main_en', v)} />
                    <FieldText label="Footer sotto-riga (IT)" value={copy.stats_footer_sub_it ?? ''} onChange={v => update('stats_footer_sub_it', v)} />
                    <FieldText label="Footer sotto-riga (EN)" value={copy.stats_footer_sub_en ?? ''} onChange={v => update('stats_footer_sub_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Piano di Espansione ({copy.expansion_locations.length})</h3>
                <FieldText label="Heading (IT)" value={copy.expansion_heading_it ?? ''} onChange={v => update('expansion_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.expansion_heading_en ?? ''} onChange={v => update('expansion_heading_en', v)} />
                {copy.expansion_locations.map((loc, i) => (
                    <div key={loc.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-2 items-center">
                        <select value={loc.icon} onChange={e => updateLoc(i, { icon: e.target.value as FranchisingExpansionIcon })} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]">
                            {FRANCHISING_EXPANSION_ICONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input type="text" value={loc.name} onChange={e => updateLoc(i, { name: e.target.value })} placeholder="Nome (es. Cagliari)" className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={loc.description} onChange={e => updateLoc(i, { description: e.target.value })} placeholder='Descrizione (es. "Sede Principale")' className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveLoc(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveLoc(i, 1)} disabled={i === copy.expansion_locations.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeLoc(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                    </div>
                ))}
                <button onClick={addLoc} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi sede
                </button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">L'Impero DR7 (about)</h3>
                <FieldText label="Heading (IT)" value={copy.about_heading_it ?? ''} onChange={v => update('about_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.about_heading_en ?? ''} onChange={v => update('about_heading_en', v)} />
                <FieldTextArea label="Paragrafi IT (separati da riga vuota)" value={stringList('about_paragraphs', 'it').join('\n\n')} onChange={v => setStringList('about_paragraphs', 'it', v)} />
                <FieldTextArea label="Paragraphs EN (blank line between)" value={stringList('about_paragraphs', 'en').join('\n\n')} onChange={v => setStringList('about_paragraphs', 'en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Benefits ({copy.benefits.length})</h3>
                {copy.benefits.map((b, i) => (
                    <div key={b.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <select value={b.icon} onChange={e => updateBenefit(i, { icon: e.target.value as FranchisingBenefitIcon })} className="bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[12px]">
                                {FRANCHISING_BENEFIT_ICONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{b.title || '(senza titolo)'}</span>
                            <button onClick={() => moveBenefit(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveBenefit(i, 1)} disabled={i === copy.benefits.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeBenefit(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <input type="text" value={b.title} onChange={e => updateBenefit(i, { title: e.target.value })} placeholder="Titolo benefit" className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-semibold" />
                        <textarea value={b.description} onChange={e => updateBenefit(i, { description: e.target.value })} placeholder="Descrizione" rows={2} className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] resize-y" />
                    </div>
                ))}
                <button onClick={addBenefit} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi benefit
                </button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Call to Action</h3>
                <FieldText label="Heading (IT)" value={copy.cta_heading_it ?? ''} onChange={v => update('cta_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.cta_heading_en ?? ''} onChange={v => update('cta_heading_en', v)} />
                <FieldText label="Intro (IT)" value={copy.cta_intro_it ?? ''} onChange={v => update('cta_intro_it', v)} />
                <FieldText label="Intro (EN)" value={copy.cta_intro_en ?? ''} onChange={v => update('cta_intro_en', v)} />
                <FieldText label="Box riga principale (IT)" value={copy.cta_box_main_it ?? ''} onChange={v => update('cta_box_main_it', v)} />
                <FieldText label="Box riga principale (EN)" value={copy.cta_box_main_en ?? ''} onChange={v => update('cta_box_main_en', v)} />
                <FieldText label="Box riga secondaria (IT)" value={copy.cta_box_sub_it ?? ''} onChange={v => update('cta_box_sub_it', v)} />
                <FieldText label="Box riga secondaria (EN)" value={copy.cta_box_sub_en ?? ''} onChange={v => update('cta_box_sub_en', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Contatti</h3>
                <FieldText label="Heading (IT)" value={copy.contact_heading_it ?? ''} onChange={v => update('contact_heading_it', v)} />
                <FieldText label="Heading (EN)" value={copy.contact_heading_en ?? ''} onChange={v => update('contact_heading_en', v)} />
                <FieldText label="Intro (IT)" value={copy.contact_intro_it ?? ''} onChange={v => update('contact_intro_it', v)} />
                <FieldText label="Intro (EN)" value={copy.contact_intro_en ?? ''} onChange={v => update('contact_intro_en', v)} />
                <FieldText label="Email candidature" value={copy.contact_email} onChange={v => update('contact_email', v)} />
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Footer statement</h3>
                <FieldTextArea label="Statement (newline = a-capo) (IT)" value={copy.footer_statement_it ?? ''} onChange={v => update('footer_statement_it', v)} />
                <FieldTextArea label="Statement (newline = a-capo) (EN)" value={copy.footer_statement_en ?? ''} onChange={v => update('footer_statement_en', v)} />
            </section>
        </div>
    )
}

// ─── Aviation Quote editor (bilingual) ─────────────────────────────────────
function AviationQuoteEditor({ copy, setCopy }: { copy: AviationQuoteCopy; setCopy: (next: AviationQuoteCopy) => void }) {
    const update = <K extends keyof AviationQuoteCopy>(key: K, value: AviationQuoteCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Aviation Quote</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagine <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/aviation-quote-request</code> + <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/helicopter-quote-request</code>. Token <code>{'{service}'}</code> nel titolo si risolve a "Jet Privato" o "Elicottero" in base alla pagina.
                </p>
            </div>

            <WhatsAppTemplateNotice keys={[
                { key: 'pro_aviation_quote_request', label: 'Richiesta Preventivo Aviation (Jet + Elicottero)' },
            ]} />

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Etichette servizio (per token {'{service}'})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Label Jet Privato" value={copy.service_label_jet} onChange={v => update('service_label_jet', v)} />
                    <FieldText label="Label Elicottero" value={copy.service_label_helicopter} onChange={v => update('service_label_helicopter', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Loading + Auth gate</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Loading (IT)" value={copy.loading_it} onChange={v => update('loading_it', v)} />
                    <FieldText label="Loading (EN)" value={copy.loading_en} onChange={v => update('loading_en', v)} />
                    <FieldText label="Auth title (IT)" value={copy.auth_title_it} onChange={v => update('auth_title_it', v)} />
                    <FieldText label="Auth title (EN)" value={copy.auth_title_en} onChange={v => update('auth_title_en', v)} />
                    <FieldTextArea label="Auth body (IT)" value={copy.auth_body_it} onChange={v => update('auth_body_it', v)} />
                    <FieldTextArea label="Auth body (EN)" value={copy.auth_body_en} onChange={v => update('auth_body_en', v)} />
                    <FieldText label="Login button (IT)" value={copy.auth_login_cta_it} onChange={v => update('auth_login_cta_it', v)} />
                    <FieldText label="Login button (EN)" value={copy.auth_login_cta_en} onChange={v => update('auth_login_cta_en', v)} />
                    <FieldText label="Sign Up button (IT)" value={copy.auth_signup_cta_it} onChange={v => update('auth_signup_cta_it', v)} />
                    <FieldText label="Sign Up button (EN)" value={copy.auth_signup_cta_en} onChange={v => update('auth_signup_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Header pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo template (IT) — usa {service}" value={copy.header_title_template_it} onChange={v => update('header_title_template_it', v)} />
                    <FieldText label="Title template (EN) — uses {service}" value={copy.header_title_template_en} onChange={v => update('header_title_template_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.header_subtitle_it} onChange={v => update('header_subtitle_it', v)} />
                    <FieldTextArea label="Subtitle (EN)" value={copy.header_subtitle_en} onChange={v => update('header_subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Sezioni form</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading Customer (IT)" value={copy.section_customer_it} onChange={v => update('section_customer_it', v)} />
                    <FieldText label="Heading Customer (EN)" value={copy.section_customer_en} onChange={v => update('section_customer_en', v)} />
                    <FieldText label="Heading Flight (IT)" value={copy.section_flight_it} onChange={v => update('section_flight_it', v)} />
                    <FieldText label="Heading Flight (EN)" value={copy.section_flight_en} onChange={v => update('section_flight_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi form (label + placeholder)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Nome label (IT)" value={copy.field_name_label_it} onChange={v => update('field_name_label_it', v)} />
                    <FieldText label="Name label (EN)" value={copy.field_name_label_en} onChange={v => update('field_name_label_en', v)} />
                    <FieldText label="Nome placeholder (IT)" value={copy.field_name_placeholder_it} onChange={v => update('field_name_placeholder_it', v)} />
                    <FieldText label="Name placeholder (EN)" value={copy.field_name_placeholder_en} onChange={v => update('field_name_placeholder_en', v)} />
                    <FieldText label="Email label (IT)" value={copy.field_email_label_it} onChange={v => update('field_email_label_it', v)} />
                    <FieldText label="Email label (EN)" value={copy.field_email_label_en} onChange={v => update('field_email_label_en', v)} />
                    <FieldText label="Email placeholder (IT)" value={copy.field_email_placeholder_it} onChange={v => update('field_email_placeholder_it', v)} />
                    <FieldText label="Email placeholder (EN)" value={copy.field_email_placeholder_en} onChange={v => update('field_email_placeholder_en', v)} />
                    <FieldText label="Telefono label (IT)" value={copy.field_phone_label_it} onChange={v => update('field_phone_label_it', v)} />
                    <FieldText label="Phone label (EN)" value={copy.field_phone_label_en} onChange={v => update('field_phone_label_en', v)} />
                    <FieldText label="Telefono placeholder (IT)" value={copy.field_phone_placeholder_it} onChange={v => update('field_phone_placeholder_it', v)} />
                    <FieldText label="Phone placeholder (EN)" value={copy.field_phone_placeholder_en} onChange={v => update('field_phone_placeholder_en', v)} />
                    <FieldText label="Partenza label (IT)" value={copy.field_departure_label_it} onChange={v => update('field_departure_label_it', v)} />
                    <FieldText label="Departure label (EN)" value={copy.field_departure_label_en} onChange={v => update('field_departure_label_en', v)} />
                    <FieldText label="Partenza placeholder (IT)" value={copy.field_departure_placeholder_it} onChange={v => update('field_departure_placeholder_it', v)} />
                    <FieldText label="Departure placeholder (EN)" value={copy.field_departure_placeholder_en} onChange={v => update('field_departure_placeholder_en', v)} />
                    <FieldText label="Arrivo label (IT)" value={copy.field_arrival_label_it} onChange={v => update('field_arrival_label_it', v)} />
                    <FieldText label="Arrival label (EN)" value={copy.field_arrival_label_en} onChange={v => update('field_arrival_label_en', v)} />
                    <FieldText label="Arrivo placeholder (IT)" value={copy.field_arrival_placeholder_it} onChange={v => update('field_arrival_placeholder_it', v)} />
                    <FieldText label="Arrival placeholder (EN)" value={copy.field_arrival_placeholder_en} onChange={v => update('field_arrival_placeholder_en', v)} />
                    <FieldText label="Data Partenza label (IT)" value={copy.field_departure_date_label_it} onChange={v => update('field_departure_date_label_it', v)} />
                    <FieldText label="Departure date (EN)" value={copy.field_departure_date_label_en} onChange={v => update('field_departure_date_label_en', v)} />
                    <FieldText label="Data Ritorno label (IT)" value={copy.field_return_date_label_it} onChange={v => update('field_return_date_label_it', v)} />
                    <FieldText label="Return date (EN)" value={copy.field_return_date_label_en} onChange={v => update('field_return_date_label_en', v)} />
                    <FieldText label="Passeggeri label (IT)" value={copy.field_passengers_label_it} onChange={v => update('field_passengers_label_it', v)} />
                    <FieldText label="Passengers label (EN)" value={copy.field_passengers_label_en} onChange={v => update('field_passengers_label_en', v)} />
                    <FieldText label="Note label (IT)" value={copy.field_notes_label_it} onChange={v => update('field_notes_label_it', v)} />
                    <FieldText label="Notes label (EN)" value={copy.field_notes_label_en} onChange={v => update('field_notes_label_en', v)} />
                    <FieldText label="Note placeholder (IT)" value={copy.field_notes_placeholder_it} onChange={v => update('field_notes_placeholder_it', v)} />
                    <FieldText label="Notes placeholder (EN)" value={copy.field_notes_placeholder_en} onChange={v => update('field_notes_placeholder_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Submit + alerts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Bottone submit (IT)" value={copy.submit_idle_it} onChange={v => update('submit_idle_it', v)} />
                    <FieldText label="Submit button (EN)" value={copy.submit_idle_en} onChange={v => update('submit_idle_en', v)} />
                    <FieldText label='Stato "Invio in corso..." (IT)' value={copy.submit_submitting_it} onChange={v => update('submit_submitting_it', v)} />
                    <FieldText label='State "Submitting..." (EN)' value={copy.submit_submitting_en} onChange={v => update('submit_submitting_en', v)} />
                    <FieldTextArea label="Disclaimer sotto bottone (IT)" value={copy.disclaimer_it} onChange={v => update('disclaimer_it', v)} />
                    <FieldTextArea label="Disclaimer (EN)" value={copy.disclaimer_en} onChange={v => update('disclaimer_en', v)} />
                    <FieldText label="Alert successo (IT)" value={copy.alert_success_it} onChange={v => update('alert_success_it', v)} />
                    <FieldText label="Success alert (EN)" value={copy.alert_success_en} onChange={v => update('alert_success_en', v)} />
                    <FieldText label="Alert errore (IT)" value={copy.alert_error_it} onChange={v => update('alert_error_it', v)} />
                    <FieldText label="Error alert (EN)" value={copy.alert_error_en} onChange={v => update('alert_error_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Numero WhatsApp destinazione</h3>
                <FieldText label='Numero WhatsApp (formato wa.me — es. "393457905205")' value={copy.whatsapp_phone} onChange={v => update('whatsapp_phone', v)} />
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Il <b>template del messaggio WhatsApp</b> si modifica in <b>Messaggi di Sistema Pro</b> → "Richiesta Preventivo Aviation" (key <code>pro_aviation_quote_request</code>). Placeholder disponibili: <code>{'{service}'}</code>, <code>{'{nome}'}</code>, <code>{'{email}'}</code>, <code>{'{telefono}'}</code>, <code>{'{partenza}'}</code>, <code>{'{arrivo}'}</code>, <code>{'{data_partenza}'}</code>, <code>{'{data_ritorno}'}</code>, <code>{'{passeggeri}'}</code>, <code>{'{note}'}</code>, <code>{'{return_line}'}</code> (riga ritorno se compilata), <code>{'{notes_line}'}</code> (riga note se compilate).
                </div>
            </section>
        </div>
    )
}

// ─── Check Email editor ────────────────────────────────────────────────────
function CheckEmailEditor({ copy, setCopy }: { copy: CheckEmailCopy; setCopy: (next: CheckEmailCopy) => void }) {
    const update = <K extends keyof CheckEmailCopy>(key: K, value: CheckEmailCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Check Email</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/check-email</code> mostrata dopo signup. Solo 3 stringhe IT/EN.
                </p>
            </div>
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.title_it} onChange={v => update('title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.title_en} onChange={v => update('title_en', v)} />
                    <FieldTextArea label="Corpo (IT)" value={copy.body_it} onChange={v => update('body_it', v)} />
                    <FieldTextArea label="Body (EN)" value={copy.body_en} onChange={v => update('body_en', v)} />
                    <FieldText label='Link "Torna al Login" (IT)' value={copy.back_link_it} onChange={v => update('back_link_it', v)} />
                    <FieldText label='Link "Back to Sign In" (EN)' value={copy.back_link_en} onChange={v => update('back_link_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Jet Search Results editor (chrome only) ───────────────────────────────
function JetSearchResultsEditor({ copy, setCopy }: { copy: JetSearchResultsCopy; setCopy: (next: JetSearchResultsCopy) => void }) {
    const update = <K extends keyof JetSearchResultsCopy>(key: K, value: JetSearchResultsCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Jet Search Results</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/jet-search-results</code> — chrome editabile (titolo, connettori, empty state). Il catalogo jet vive in RENTAL_CATEGORIES (constants).
                </p>
            </div>
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Header risultati</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.title_it} onChange={v => update('title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.title_en} onChange={v => update('title_en', v)} />
                    <FieldText label='Connettore "a" / "to" (IT)' value={copy.subtitle_connector_it} onChange={v => update('subtitle_connector_it', v)} />
                    <FieldText label='Connector "to" (EN)' value={copy.subtitle_connector_en} onChange={v => update('subtitle_connector_en', v)} />
                    <FieldText label='Suffisso "Passeggeri" (IT)' value={copy.passengers_suffix_it} onChange={v => update('passengers_suffix_it', v)} />
                    <FieldText label='Suffix "Passengers" (EN)' value={copy.passengers_suffix_en} onChange={v => update('passengers_suffix_en', v)} />
                    <FieldText label='Bottone "Modifica Ricerca" (IT)' value={copy.modify_search_cta_it} onChange={v => update('modify_search_cta_it', v)} />
                    <FieldText label='Button "Modify Search" (EN)' value={copy.modify_search_cta_en} onChange={v => update('modify_search_cta_en', v)} />
                </div>
                <FieldText label='Fallback aeroporto sconosciuto (es. "N/A")' value={copy.airport_fallback} onChange={v => update('airport_fallback', v)} />
            </section>
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato vuoto (nessun jet trovato)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.empty_title_it} onChange={v => update('empty_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.empty_title_en} onChange={v => update('empty_title_en', v)} />
                    <FieldTextArea label="Corpo (IT)" value={copy.empty_body_it} onChange={v => update('empty_body_it', v)} />
                    <FieldTextArea label="Body (EN)" value={copy.empty_body_en} onChange={v => update('empty_body_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Confirmation Success editor ──────────────────────────────────────────
function ConfirmationSuccessEditor({ copy, setCopy }: { copy: ConfirmationSuccessCopy; setCopy: (next: ConfirmationSuccessCopy) => void }) {
    const update = <K extends keyof ConfirmationSuccessCopy>(key: K, value: ConfirmationSuccessCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Conferma Prenotazione</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/confirmation-success</code>. Mostrata dopo prenotazione completata o conferma email. Placeholder <code>{'{total}'}</code> nel footnote rental viene sostituito con il prezzo formattato.
                </p>
            </div>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Branch "Booking confermato"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.booking_title_it} onChange={v => update('booking_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.booking_title_en} onChange={v => update('booking_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.booking_subtitle_it} onChange={v => update('booking_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.booking_subtitle_en} onChange={v => update('booking_subtitle_en', v)} />
                    <FieldText label='Heading "Riepilogo Prenotazione" (IT)' value={copy.booking_summary_heading_it} onChange={v => update('booking_summary_heading_it', v)} />
                    <FieldText label='Heading "Booking Summary" (EN)' value={copy.booking_summary_heading_en} onChange={v => update('booking_summary_heading_en', v)} />
                    <FieldText label='Bottone CTA account (IT)' value={copy.booking_cta_account_it} onChange={v => update('booking_cta_account_it', v)} />
                    <FieldText label="Account CTA (EN)" value={copy.booking_cta_account_en} onChange={v => update('booking_cta_account_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Variante Lavaggio (riepilogo)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"Servizio:" (IT)' value={copy.carwash_row_servizio_it} onChange={v => update('carwash_row_servizio_it', v)} />
                    <FieldText label='"Service:" (EN)' value={copy.carwash_row_servizio_en} onChange={v => update('carwash_row_servizio_en', v)} />
                    <FieldText label='"Data:" (IT)' value={copy.carwash_row_data_it} onChange={v => update('carwash_row_data_it', v)} />
                    <FieldText label='"Date:" (EN)' value={copy.carwash_row_data_en} onChange={v => update('carwash_row_data_en', v)} />
                    <FieldText label='"Orario:" (IT)' value={copy.carwash_row_orario_it} onChange={v => update('carwash_row_orario_it', v)} />
                    <FieldText label='"Time:" (EN)' value={copy.carwash_row_orario_en} onChange={v => update('carwash_row_orario_en', v)} />
                    <FieldText label='"Cliente:" (IT)' value={copy.carwash_row_cliente_it} onChange={v => update('carwash_row_cliente_it', v)} />
                    <FieldText label='"Customer:" (EN)' value={copy.carwash_row_cliente_en} onChange={v => update('carwash_row_cliente_en', v)} />
                    <FieldText label='"Pagamento:" (IT)' value={copy.carwash_row_pagamento_it} onChange={v => update('carwash_row_pagamento_it', v)} />
                    <FieldText label='"Payment:" (EN)' value={copy.carwash_row_pagamento_en} onChange={v => update('carwash_row_pagamento_en', v)} />
                    <FieldText label='Valore "Online" (IT)' value={copy.carwash_payment_online_it} onChange={v => update('carwash_payment_online_it', v)} />
                    <FieldText label='Value "Online" (EN)' value={copy.carwash_payment_online_en} onChange={v => update('carwash_payment_online_en', v)} />
                    <FieldText label='Default cliente (IT)' value={copy.carwash_default_customer_it} onChange={v => update('carwash_default_customer_it', v)} />
                    <FieldText label='Default customer (EN)' value={copy.carwash_default_customer_en} onChange={v => update('carwash_default_customer_en', v)} />
                    <FieldText label='Etichetta "TOTALE PAGATO:" (IT)' value={copy.carwash_totale_pagato_it} onChange={v => update('carwash_totale_pagato_it', v)} />
                    <FieldText label='Label "TOTAL PAID:" (EN)' value={copy.carwash_totale_pagato_en} onChange={v => update('carwash_totale_pagato_en', v)} />
                    <FieldTextArea label='Nota WhatsApp (IT)' value={copy.carwash_whatsapp_note_it} onChange={v => update('carwash_whatsapp_note_it', v)} />
                    <FieldTextArea label='WhatsApp note (EN)' value={copy.carwash_whatsapp_note_en} onChange={v => update('carwash_whatsapp_note_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Variante Noleggio (riepilogo)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"Veicolo:" (IT)' value={copy.rental_row_veicolo_it} onChange={v => update('rental_row_veicolo_it', v)} />
                    <FieldText label='"Vehicle:" (EN)' value={copy.rental_row_veicolo_en} onChange={v => update('rental_row_veicolo_en', v)} />
                    <FieldText label='"Ritiro:" (IT)' value={copy.rental_row_ritiro_it} onChange={v => update('rental_row_ritiro_it', v)} />
                    <FieldText label='"Pickup:" (EN)' value={copy.rental_row_ritiro_en} onChange={v => update('rental_row_ritiro_en', v)} />
                    <FieldText label='"Riconsegna:" (IT)' value={copy.rental_row_riconsegna_it} onChange={v => update('rental_row_riconsegna_it', v)} />
                    <FieldText label='"Return:" (EN)' value={copy.rental_row_riconsegna_en} onChange={v => update('rental_row_riconsegna_en', v)} />
                    <FieldText label='"Luogo:" (IT)' value={copy.rental_row_luogo_it} onChange={v => update('rental_row_luogo_it', v)} />
                    <FieldText label='"Location:" (EN)' value={copy.rental_row_luogo_en} onChange={v => update('rental_row_luogo_en', v)} />
                    <FieldText label='"Pagamento:" (IT)' value={copy.rental_row_pagamento_it} onChange={v => update('rental_row_pagamento_it', v)} />
                    <FieldText label='"Payment:" (EN)' value={copy.rental_row_pagamento_en} onChange={v => update('rental_row_pagamento_en', v)} />
                    <FieldText label='Connettore data/ora "alle" (IT)' value={copy.rental_time_connector_it} onChange={v => update('rental_time_connector_it', v)} />
                    <FieldText label='Time connector "at" (EN)' value={copy.rental_time_connector_en} onChange={v => update('rental_time_connector_en', v)} />
                    <FieldText label='Pagamento "In Sede" (IT)' value={copy.rental_payment_in_sede_it} onChange={v => update('rental_payment_in_sede_it', v)} />
                    <FieldText label='Payment "In Office" (EN)' value={copy.rental_payment_in_sede_en} onChange={v => update('rental_payment_in_sede_en', v)} />
                    <FieldText label='Pagamento "Online" (IT)' value={copy.rental_payment_online_it} onChange={v => update('rental_payment_online_it', v)} />
                    <FieldText label='Payment "Online" (EN)' value={copy.rental_payment_online_en} onChange={v => update('rental_payment_online_en', v)} />
                    <FieldText label='Etichetta "TOTALE PAGATO:" (IT)' value={copy.rental_totale_pagato_it} onChange={v => update('rental_totale_pagato_it', v)} />
                    <FieldText label='Label "TOTAL PAID:" (EN)' value={copy.rental_totale_pagato_en} onChange={v => update('rental_totale_pagato_en', v)} />
                    <FieldText label='Etichetta "TOTALE DA PAGARE:" (IT)' value={copy.rental_totale_da_pagare_it} onChange={v => update('rental_totale_da_pagare_it', v)} />
                    <FieldText label='Label "TOTAL TO PAY:" (EN)' value={copy.rental_totale_da_pagare_en} onChange={v => update('rental_totale_da_pagare_en', v)} />
                    <FieldTextArea label='Footnote pagamento agenzia (IT) — usa {total}' value={copy.rental_agency_footnote_it} onChange={v => update('rental_agency_footnote_it', v)} />
                    <FieldTextArea label='Agency payment footnote (EN) — uses {total}' value={copy.rental_agency_footnote_en} onChange={v => update('rental_agency_footnote_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Branch "Email confermata" (fallback)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.email_title_it} onChange={v => update('email_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.email_title_en} onChange={v => update('email_title_en', v)} />
                    <FieldTextArea label="Body se loggato (IT)" value={copy.email_body_logged_in_it} onChange={v => update('email_body_logged_in_it', v)} />
                    <FieldTextArea label="Body if signed in (EN)" value={copy.email_body_logged_in_en} onChange={v => update('email_body_logged_in_en', v)} />
                    <FieldTextArea label="Body se non loggato (IT)" value={copy.email_body_logged_out_it} onChange={v => update('email_body_logged_out_it', v)} />
                    <FieldTextArea label="Body if signed out (EN)" value={copy.email_body_logged_out_en} onChange={v => update('email_body_logged_out_en', v)} />
                    <FieldText label="CTA se loggato (IT)" value={copy.email_cta_logged_in_it} onChange={v => update('email_cta_logged_in_it', v)} />
                    <FieldText label="CTA if signed in (EN)" value={copy.email_cta_logged_in_en} onChange={v => update('email_cta_logged_in_en', v)} />
                    <FieldText label="CTA se non loggato (IT)" value={copy.email_cta_logged_out_it} onChange={v => update('email_cta_logged_out_it', v)} />
                    <FieldText label="CTA if signed out (EN)" value={copy.email_cta_logged_out_en} onChange={v => update('email_cta_logged_out_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Header / Navigation editor ────────────────────────────────────────────
// Brand vocabulary like "DR7 Club", "Aviation Division", "Prime Wash" stays
// hardcoded in the website. Only localized chrome (CTAs, section headings,
// popup labels, aria) is editable here.
function HeaderEditor({ copy, setCopy }: { copy: HeaderCopy; setCopy: (next: HeaderCopy) => void }) {
    const update = <K extends keyof HeaderCopy>(key: K, value: HeaderCopy[K]) => setCopy({ ...copy, [key]: value })
    // Lettura/scrittura per le chiavi dinamiche del menu (menu_<id>_*).
    const menuVal = (k: string): string => (copy as unknown as Record<string, string | undefined>)[k] ?? ''
    const setMenu = (k: string, v: string) => setCopy({ ...copy, [k]: v } as HeaderCopy)
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Testi di Header e menu di navigazione (barra in alto + drawer EXPLORE). Il vocabolario di brand
                (DR7 Club, Aviation Division, Prime Wash, ecc.) resta fisso nel sito e non è modificabile qui.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Logo & aria-label</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Logo alt (testo alternativo)" value={copy.logo_alt} onChange={v => update('logo_alt', v)} />
                    <div />
                    <FieldText label='Aria "Apri menu" (IT)' value={copy.open_menu_aria_it} onChange={v => update('open_menu_aria_it', v)} />
                    <FieldText label='Aria "Open menu" (EN)' value={copy.open_menu_aria_en} onChange={v => update('open_menu_aria_en', v)} />
                    <FieldText label='Aria "Chiudi menu" (IT)' value={copy.close_menu_aria_it} onChange={v => update('close_menu_aria_it', v)} />
                    <FieldText label='Aria "Close menu" (EN)' value={copy.close_menu_aria_en} onChange={v => update('close_menu_aria_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Barra superiore</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone "EXPLORE" (IT)' value={copy.explore_label_it} onChange={v => update('explore_label_it', v)} />
                    <FieldText label='Button "EXPLORE" (EN)' value={copy.explore_label_en} onChange={v => update('explore_label_en', v)} />
                    <FieldText label='Pill "Credit Wallet" (IT)' value={copy.credit_wallet_label_it} onChange={v => update('credit_wallet_label_it', v)} />
                    <FieldText label='Pill "Credit Wallet" (EN)' value={copy.credit_wallet_label_en} onChange={v => update('credit_wallet_label_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Drawer (menu laterale)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='CTA "Prenota Ora" (IT)' value={copy.drawer_book_cta_it} onChange={v => update('drawer_book_cta_it', v)} />
                    <FieldText label='CTA "Book Now" (EN)' value={copy.drawer_book_cta_en} onChange={v => update('drawer_book_cta_en', v)} />
                    <FieldText label='Etichetta "La Nostra Flotta" (IT)' value={copy.flotta_label_it} onChange={v => update('flotta_label_it', v)} />
                    <FieldText label='Label "Our Fleet" (EN)' value={copy.flotta_label_en} onChange={v => update('flotta_label_en', v)} />
                    <FieldText label='Titolo sezione "Servizi" (IT)' value={copy.servizi_heading_it} onChange={v => update('servizi_heading_it', v)} />
                    <FieldText label='Section heading "Services" (EN)' value={copy.servizi_heading_en} onChange={v => update('servizi_heading_en', v)} />
                    <FieldText label='Titolo sezione "Esperienze" (IT)' value={copy.esperienze_heading_it} onChange={v => update('esperienze_heading_it', v)} />
                    <FieldText label='Section heading "Experiences" (EN)' value={copy.esperienze_heading_en} onChange={v => update('esperienze_heading_en', v)} />
                    <FieldText label='Titolo sezione "Prime Wash" (IT)' value={copy.prime_wash_heading_it} onChange={v => update('prime_wash_heading_it', v)} />
                    <FieldText label='Section heading "Prime Wash" (EN)' value={copy.prime_wash_heading_en} onChange={v => update('prime_wash_heading_en', v)} />
                    <FieldText label='Titolo sezione "Business" (IT)' value={copy.business_heading_it} onChange={v => update('business_heading_it', v)} />
                    <FieldText label='Section heading "Business" (EN)' value={copy.business_heading_en} onChange={v => update('business_heading_en', v)} />
                    <FieldText label='Titolo sezione "Digital" (IT)' value={copy.digital_heading_it} onChange={v => update('digital_heading_it', v)} />
                    <FieldText label='Section heading "Digital" (EN)' value={copy.digital_heading_en} onChange={v => update('digital_heading_en', v)} />
                    <FieldText label='CTA "Contattaci" (IT)' value={copy.contact_cta_it} onChange={v => update('contact_cta_it', v)} />
                    <FieldText label='CTA "Contact us" (EN)' value={copy.contact_cta_en} onChange={v => update('contact_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Menu principale — voci (nuovo design)</h3>
                <p className="text-[12px] text-theme-text-secondary">
                    Le 10 voci del menu del sito. Nel menu a schermo intero l'immagine e' il visual che
                    compare accanto alla voce sotto il puntatore: non e' decorazione, si cambia da qui.
                    <strong> Lascia vuoto per usare il valore predefinito</strong> indicato tra parentesi.
                    Le destinazioni delle voci restano fisse nel sito, perche' sono rotte reali.
                </p>
                <div className="space-y-5">
                    {MENU_ITEM_FIELDS.map(f => (
                        <div key={f.key} className="border border-theme-border rounded-xl p-4 bg-theme-bg-secondary space-y-3">
                            <h4 className="text-[12px] font-semibold uppercase tracking-wide text-theme-text-primary">{f.name}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FieldText label={`Titolo IT (def: ${f.titleIt})`} value={menuVal(`menu_${f.key}_title_it`)} onChange={v => setMenu(`menu_${f.key}_title_it`, v)} />
                                <FieldText label={`Titolo EN (def: ${f.titleEn})`} value={menuVal(`menu_${f.key}_title_en`)} onChange={v => setMenu(`menu_${f.key}_title_en`, v)} />
                                <FieldText label={`Sottotitolo IT (def: ${f.subIt})`} value={menuVal(`menu_${f.key}_sub_it`)} onChange={v => setMenu(`menu_${f.key}_sub_it`, v)} />
                                <FieldText label={`Sottotitolo EN (def: ${f.subEn})`} value={menuVal(`menu_${f.key}_sub_en`)} onChange={v => setMenu(`menu_${f.key}_sub_en`, v)} />
                                <FieldText label={`Immagine (def: ${f.img})`} value={menuVal(`menu_${f.key}_img`)} onChange={v => setMenu(`menu_${f.key}_img`, v)} />
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Popup prenotazione (apre dal drawer)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo popup (IT)" value={copy.popup_title_it} onChange={v => update('popup_title_it', v)} />
                    <FieldText label="Popup title (EN)" value={copy.popup_title_en} onChange={v => update('popup_title_en', v)} />
                    <FieldText label="Sottotitolo popup (IT)" value={copy.popup_subtitle_it} onChange={v => update('popup_subtitle_it', v)} />
                    <FieldText label="Popup subtitle (EN)" value={copy.popup_subtitle_en} onChange={v => update('popup_subtitle_en', v)} />
                </div>
            </section>
        </div>
    )
}

// Voci del menu principale del sito (nuovo design) editabili da Header.
// I default mostrati qui combaciano con i fallback hardcoded nel sito
// (components/layout/Header.tsx). key -> prefisso chiavi menu_<key>_*.
const MENU_ITEM_FIELDS: { key: string; name: string; titleIt: string; titleEn: string; subIt: string; subEn: string; img: string }[] = [
    { key: 'mobilita', name: 'Mobilità', titleIt: 'Mobilità', titleEn: 'Mobility', subIt: 'Auto esclusive per ogni esperienza su strada', subEn: 'Exclusive cars for every experience on the road', img: '/menu-mobilita.jpeg' },
    { key: 'mare', name: 'Mare', titleIt: 'Mare', titleEn: 'Sea', subIt: 'Yacht, barche e esperienze esclusive in mare', subEn: 'Yachts, boats and exclusive experiences at sea', img: '/menu-mare.jpeg' },
    { key: 'aria', name: 'Aria', titleIt: 'Aria', titleEn: 'Air', subIt: 'Voli privati ed elicotteri per viaggiare senza confini', subEn: 'Private jets and helicopters to travel without limits', img: '/menu-aria.jpeg' },
    { key: 'property', name: 'Soggiorni & Ospitalità', titleIt: 'Soggiorni & Ospitalità', titleEn: 'Stays & Hospitality', subIt: 'Ville, appartamenti e residenze selezionate in tutto il mondo', subEn: 'Villas, apartments and residences selected worldwide', img: '/menu-property.jpeg' },
    { key: 'servizi', name: 'Lavaggio & Meccanica', titleIt: 'Lavaggio & Meccanica', titleEn: 'Car Wash & Mechanics', subIt: 'Lavaggio auto premium e officina meccanica', subEn: 'Premium car wash and mechanical workshop', img: '/servizi-lavaggio.jpeg' },
    { key: 'wallet', name: 'Credit Wallet', titleIt: 'Credit Wallet', titleEn: 'Credit Wallet', subIt: 'Il tuo credito DR7 Wallet per prenotare e ricaricare', subEn: 'Your DR7 Wallet credit to book and top up', img: '/menu-club.jpeg' },
    { key: 'club', name: 'DR7 Club', titleIt: 'DR7 Club', titleEn: 'DR7 Club', subIt: 'Accesso esclusivo, eventi riservati e vantaggi unici', subEn: 'Exclusive access, private events and unique benefits', img: '/menu-club.jpeg' },
    { key: 'business', name: 'Business', titleIt: 'Business', titleEn: 'Business', subIt: 'Soluzioni corporate e noleggi a lungo termine', subEn: 'Corporate solutions and long-term rentals', img: '/menu-business.jpeg' },
    { key: 'digital', name: 'Innovazione Digitale', titleIt: 'Innovazione Digitale', titleEn: 'Digital Innovation', subIt: 'Creazione di asset digitali e token', subEn: 'Digital Asset & Token Creation', img: '/menu-digital.jpeg' },
    { key: 'contatti', name: 'Contattaci', titleIt: 'Contattaci', titleEn: 'Contact Us', subIt: 'Siamo a tua disposizione', subEn: 'We are at your service', img: '/menu-contatti.jpeg' },
]

// ─── SignUp editor (registrazione cliente — Azienda / Persona Fisica / PA) ─
function SignUpEditor({ copy, setCopy }: { copy: SignUpCopy; setCopy: (next: SignUpCopy) => void }) {
    const update = <K extends keyof SignUpCopy>(key: K, value: SignUpCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Testi della pagina di registrazione cliente: tre rami (Azienda, Persona Fisica, Pubblica
                Amministrazione) + sezione credenziali + consenso marketing. I messaggi di errore di
                validazione sono modificabili e mostrati inline accanto al campo invalido.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Chrome pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => update('subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.subtitle_en} onChange={v => update('subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Selettore tipo cliente</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta selettore (IT)" value={copy.client_type_label_it} onChange={v => update('client_type_label_it', v)} />
                    <FieldText label="Selector label (EN)" value={copy.client_type_label_en} onChange={v => update('client_type_label_en', v)} />
                    <FieldText label='Opzione "Azienda" (IT)' value={copy.client_type_azienda_it} onChange={v => update('client_type_azienda_it', v)} />
                    <FieldText label='Option "Company" (EN)' value={copy.client_type_azienda_en} onChange={v => update('client_type_azienda_en', v)} />
                    <FieldText label='Opzione "Persona Fisica" (IT)' value={copy.client_type_persona_it} onChange={v => update('client_type_persona_it', v)} />
                    <FieldText label='Option "Individual" (EN)' value={copy.client_type_persona_en} onChange={v => update('client_type_persona_en', v)} />
                    <FieldText label='Opzione "Pubblica Amministrazione" (IT)' value={copy.client_type_pa_it} onChange={v => update('client_type_pa_it', v)} />
                    <FieldText label='Option "Public Administration" (EN)' value={copy.client_type_pa_en} onChange={v => update('client_type_pa_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Titoli sezione (Azienda + Persona Fisica)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Titolo "Rappresentante Legale" (IT)' value={copy.section_legal_rep_it} onChange={v => update('section_legal_rep_it', v)} />
                    <FieldText label='Heading "Legal Representative" (EN)' value={copy.section_legal_rep_en} onChange={v => update('section_legal_rep_en', v)} />
                    <FieldText label='Titolo "Documento di Identità" (IT)' value={copy.section_id_doc_it} onChange={v => update('section_id_doc_it', v)} />
                    <FieldText label='Heading "ID Document" (EN)' value={copy.section_id_doc_en} onChange={v => update('section_id_doc_en', v)} />
                    <FieldText label='Titolo "Crea le tue credenziali" (IT)' value={copy.section_credentials_it} onChange={v => update('section_credentials_it', v)} />
                    <FieldText label='Heading "Create your credentials" (EN)' value={copy.section_credentials_en} onChange={v => update('section_credentials_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi comuni</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Nazione (IT)" value={copy.field_country_it} onChange={v => update('field_country_it', v)} />
                    <FieldText label="Country (EN)" value={copy.field_country_en} onChange={v => update('field_country_en', v)} />
                    <FieldText label="Email (IT)" value={copy.field_email_it} onChange={v => update('field_email_it', v)} />
                    <FieldText label="Email (EN)" value={copy.field_email_en} onChange={v => update('field_email_en', v)} />
                    <FieldText label="Telefono (IT)" value={copy.field_phone_it} onChange={v => update('field_phone_it', v)} />
                    <FieldText label="Phone (EN)" value={copy.field_phone_en} onChange={v => update('field_phone_en', v)} />
                    <FieldText label="Codice Fiscale (IT)" value={copy.field_codice_fiscale_it} onChange={v => update('field_codice_fiscale_it', v)} />
                    <FieldText label="Tax Code (EN)" value={copy.field_codice_fiscale_en} onChange={v => update('field_codice_fiscale_en', v)} />
                    <FieldText label="Nome (IT)" value={copy.field_nome_it} onChange={v => update('field_nome_it', v)} />
                    <FieldText label="First Name (EN)" value={copy.field_nome_en} onChange={v => update('field_nome_en', v)} />
                    <FieldText label="Cognome (IT)" value={copy.field_cognome_it} onChange={v => update('field_cognome_it', v)} />
                    <FieldText label="Last Name (EN)" value={copy.field_cognome_en} onChange={v => update('field_cognome_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Azienda</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Denominazione (IT)" value={copy.field_denominazione_it} onChange={v => update('field_denominazione_it', v)} />
                    <FieldText label="Company Name (EN)" value={copy.field_denominazione_en} onChange={v => update('field_denominazione_en', v)} />
                    <FieldText label="Placeholder denominazione (IT)" value={copy.field_denominazione_placeholder_it} onChange={v => update('field_denominazione_placeholder_it', v)} />
                    <FieldText label="Placeholder company name (EN)" value={copy.field_denominazione_placeholder_en} onChange={v => update('field_denominazione_placeholder_en', v)} />
                    <FieldText label="Partita IVA (IT)" value={copy.field_piva_it} onChange={v => update('field_piva_it', v)} />
                    <FieldText label="VAT Number (EN)" value={copy.field_piva_en} onChange={v => update('field_piva_en', v)} />
                    <FieldText label="Placeholder Partita IVA" value={copy.field_piva_placeholder} onChange={v => update('field_piva_placeholder', v)} />
                    <FieldText label="Placeholder Codice Fiscale" value={copy.field_cf_placeholder} onChange={v => update('field_cf_placeholder', v)} />
                    <FieldText label="Sede Legale (IT)" value={copy.field_sede_legale_it} onChange={v => update('field_sede_legale_it', v)} />
                    <FieldText label="Registered Office (EN)" value={copy.field_sede_legale_en} onChange={v => update('field_sede_legale_en', v)} />
                    <FieldText label="Placeholder Sede Legale (IT)" value={copy.field_sede_legale_placeholder_it} onChange={v => update('field_sede_legale_placeholder_it', v)} />
                    <FieldText label="Placeholder Registered Office (EN)" value={copy.field_sede_legale_placeholder_en} onChange={v => update('field_sede_legale_placeholder_en', v)} />
                    <FieldText label="Sede Operativa (IT)" value={copy.field_sede_operativa_it} onChange={v => update('field_sede_operativa_it', v)} />
                    <FieldText label="Operating Office (EN)" value={copy.field_sede_operativa_en} onChange={v => update('field_sede_operativa_en', v)} />
                    <FieldText label="Placeholder Sede Operativa (IT)" value={copy.field_sede_operativa_placeholder_it} onChange={v => update('field_sede_operativa_placeholder_it', v)} />
                    <FieldText label="Placeholder Operating Office (EN)" value={copy.field_sede_operativa_placeholder_en} onChange={v => update('field_sede_operativa_placeholder_en', v)} />
                    <FieldText label="Codice SDI (IT)" value={copy.field_sdi_it} onChange={v => update('field_sdi_it', v)} />
                    <FieldText label="SDI Code (EN)" value={copy.field_sdi_en} onChange={v => update('field_sdi_en', v)} />
                    <FieldText label="Placeholder SDI" value={copy.field_sdi_placeholder} onChange={v => update('field_sdi_placeholder', v)} />
                    <FieldText label="Email Aziendale (IT)" value={copy.field_email_aziendale_it} onChange={v => update('field_email_aziendale_it', v)} />
                    <FieldText label="Business Email (EN)" value={copy.field_email_aziendale_en} onChange={v => update('field_email_aziendale_en', v)} />
                    <FieldText label="Placeholder Email Aziendale" value={copy.field_email_aziendale_placeholder} onChange={v => update('field_email_aziendale_placeholder', v)} />
                    <FieldText label="Telefono Aziendale (IT)" value={copy.field_phone_aziendale_it} onChange={v => update('field_phone_aziendale_it', v)} />
                    <FieldText label="Business Phone (EN)" value={copy.field_phone_aziendale_en} onChange={v => update('field_phone_aziendale_en', v)} />
                    <FieldText label="Ruolo (IT)" value={copy.field_ruolo_it} onChange={v => update('field_ruolo_it', v)} />
                    <FieldText label="Role (EN)" value={copy.field_ruolo_en} onChange={v => update('field_ruolo_en', v)} />
                    <FieldText label="Placeholder Ruolo (IT)" value={copy.field_ruolo_placeholder_it} onChange={v => update('field_ruolo_placeholder_it', v)} />
                    <FieldText label="Placeholder Role (EN)" value={copy.field_ruolo_placeholder_en} onChange={v => update('field_ruolo_placeholder_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Documento d'identità (Azienda)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Tipo documento (IT)" value={copy.field_doc_type_it} onChange={v => update('field_doc_type_it', v)} />
                    <FieldText label="Document type (EN)" value={copy.field_doc_type_en} onChange={v => update('field_doc_type_en', v)} />
                    <FieldText label="Carta d'Identità (IT)" value={copy.field_doc_type_carta_it} onChange={v => update('field_doc_type_carta_it', v)} />
                    <FieldText label="ID Card (EN)" value={copy.field_doc_type_carta_en} onChange={v => update('field_doc_type_carta_en', v)} />
                    <FieldText label="Passaporto (IT)" value={copy.field_doc_type_passaporto_it} onChange={v => update('field_doc_type_passaporto_it', v)} />
                    <FieldText label="Passport (EN)" value={copy.field_doc_type_passaporto_en} onChange={v => update('field_doc_type_passaporto_en', v)} />
                    <FieldText label="Patente (IT)" value={copy.field_doc_type_patente_it} onChange={v => update('field_doc_type_patente_it', v)} />
                    <FieldText label="Driving Licence (EN)" value={copy.field_doc_type_patente_en} onChange={v => update('field_doc_type_patente_en', v)} />
                    <FieldText label="Numero documento (IT)" value={copy.field_doc_numero_it} onChange={v => update('field_doc_numero_it', v)} />
                    <FieldText label="Document number (EN)" value={copy.field_doc_numero_en} onChange={v => update('field_doc_numero_en', v)} />
                    <FieldText label="Data rilascio (IT)" value={copy.field_doc_data_it} onChange={v => update('field_doc_data_it', v)} />
                    <FieldText label="Issue date (EN)" value={copy.field_doc_data_en} onChange={v => update('field_doc_data_en', v)} />
                    <FieldText label="Luogo rilascio (IT)" value={copy.field_doc_luogo_it} onChange={v => update('field_doc_luogo_it', v)} />
                    <FieldText label="Issue place (EN)" value={copy.field_doc_luogo_en} onChange={v => update('field_doc_luogo_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Persona Fisica</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Placeholder Nome (IT)" value={copy.field_nome_placeholder_it} onChange={v => update('field_nome_placeholder_it', v)} />
                    <FieldText label="Placeholder First Name (EN)" value={copy.field_nome_placeholder_en} onChange={v => update('field_nome_placeholder_en', v)} />
                    <FieldText label="Placeholder Cognome (IT)" value={copy.field_cognome_placeholder_it} onChange={v => update('field_cognome_placeholder_it', v)} />
                    <FieldText label="Placeholder Last Name (EN)" value={copy.field_cognome_placeholder_en} onChange={v => update('field_cognome_placeholder_en', v)} />
                    <FieldText label="Placeholder Codice Fiscale Persona Fisica" value={copy.field_cf_pf_placeholder} onChange={v => update('field_cf_pf_placeholder', v)} />
                    <FieldText label="Sesso (IT)" value={copy.field_sesso_it} onChange={v => update('field_sesso_it', v)} />
                    <FieldText label="Gender (EN)" value={copy.field_sesso_en} onChange={v => update('field_sesso_en', v)} />
                    <FieldText label="Maschio (IT)" value={copy.field_sesso_m_it} onChange={v => update('field_sesso_m_it', v)} />
                    <FieldText label="Male (EN)" value={copy.field_sesso_m_en} onChange={v => update('field_sesso_m_en', v)} />
                    <FieldText label="Femmina (IT)" value={copy.field_sesso_f_it} onChange={v => update('field_sesso_f_it', v)} />
                    <FieldText label="Female (EN)" value={copy.field_sesso_f_en} onChange={v => update('field_sesso_f_en', v)} />
                    <FieldText label="Data di Nascita (IT)" value={copy.field_birth_date_it} onChange={v => update('field_birth_date_it', v)} />
                    <FieldText label="Date of Birth (EN)" value={copy.field_birth_date_en} onChange={v => update('field_birth_date_en', v)} />
                    <FieldText label="Città di Nascita (IT)" value={copy.field_birth_city_it} onChange={v => update('field_birth_city_it', v)} />
                    <FieldText label="Place of Birth (EN)" value={copy.field_birth_city_en} onChange={v => update('field_birth_city_en', v)} />
                    <FieldText label="Provincia di Nascita (IT)" value={copy.field_birth_province_it} onChange={v => update('field_birth_province_it', v)} />
                    <FieldText label="Province of Birth (EN)" value={copy.field_birth_province_en} onChange={v => update('field_birth_province_en', v)} />
                    <FieldText label="Indirizzo Residenza (IT)" value={copy.field_address_it} onChange={v => update('field_address_it', v)} />
                    <FieldText label="Address Residence (EN)" value={copy.field_address_en} onChange={v => update('field_address_en', v)} />
                    <FieldText label="Placeholder Indirizzo (IT)" value={copy.field_address_placeholder_it} onChange={v => update('field_address_placeholder_it', v)} />
                    <FieldText label="Placeholder Address (EN)" value={copy.field_address_placeholder_en} onChange={v => update('field_address_placeholder_en', v)} />
                    <FieldText label="Numero Civico (IT)" value={copy.field_civico_it} onChange={v => update('field_civico_it', v)} />
                    <FieldText label="Street Number (EN)" value={copy.field_civico_en} onChange={v => update('field_civico_en', v)} />
                    <FieldText label="Placeholder Civico" value={copy.field_civico_placeholder} onChange={v => update('field_civico_placeholder', v)} />
                    <FieldText label="Città di Residenza (IT)" value={copy.field_city_it} onChange={v => update('field_city_it', v)} />
                    <FieldText label="City of Residence (EN)" value={copy.field_city_en} onChange={v => update('field_city_en', v)} />
                    <FieldText label="Placeholder Città (IT)" value={copy.field_city_placeholder_it} onChange={v => update('field_city_placeholder_it', v)} />
                    <FieldText label="Placeholder City (EN)" value={copy.field_city_placeholder_en} onChange={v => update('field_city_placeholder_en', v)} />
                    <FieldText label="CAP (IT)" value={copy.field_cap_it} onChange={v => update('field_cap_it', v)} />
                    <FieldText label="ZIP (EN)" value={copy.field_cap_en} onChange={v => update('field_cap_en', v)} />
                    <FieldText label="Placeholder CAP" value={copy.field_cap_placeholder} onChange={v => update('field_cap_placeholder', v)} />
                    <FieldText label="Provincia (IT)" value={copy.field_province_it} onChange={v => update('field_province_it', v)} />
                    <FieldText label="Province (EN)" value={copy.field_province_en} onChange={v => update('field_province_en', v)} />
                    <FieldText label="Placeholder Provincia" value={copy.field_province_placeholder} onChange={v => update('field_province_placeholder', v)} />
                    <FieldText label="Placeholder Email" value={copy.field_email_placeholder} onChange={v => update('field_email_placeholder', v)} />
                    <FieldText label="PEC (IT)" value={copy.field_pec_it} onChange={v => update('field_pec_it', v)} />
                    <FieldText label="Certified Email PEC (EN)" value={copy.field_pec_en} onChange={v => update('field_pec_en', v)} />
                    <FieldText label="Placeholder PEC" value={copy.field_pec_placeholder} onChange={v => update('field_pec_placeholder', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Pubblica Amministrazione</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Codice Univoco (IT)" value={copy.field_codice_univoco_it} onChange={v => update('field_codice_univoco_it', v)} />
                    <FieldText label="Unique Code (EN)" value={copy.field_codice_univoco_en} onChange={v => update('field_codice_univoco_en', v)} />
                    <FieldText label="Placeholder Codice Univoco" value={copy.field_codice_univoco_placeholder} onChange={v => update('field_codice_univoco_placeholder', v)} />
                    <FieldText label="Ente o Ufficio (IT)" value={copy.field_ente_it} onChange={v => update('field_ente_it', v)} />
                    <FieldText label="Agency or Office (EN)" value={copy.field_ente_en} onChange={v => update('field_ente_en', v)} />
                    <FieldText label="Placeholder Ente (IT)" value={copy.field_ente_placeholder_it} onChange={v => update('field_ente_placeholder_it', v)} />
                    <FieldText label="Placeholder Agency (EN)" value={copy.field_ente_placeholder_en} onChange={v => update('field_ente_placeholder_en', v)} />
                    <FieldText label="Placeholder Città PA (IT)" value={copy.field_pa_city_placeholder_it} onChange={v => update('field_pa_city_placeholder_it', v)} />
                    <FieldText label="Placeholder PA City (EN)" value={copy.field_pa_city_placeholder_en} onChange={v => update('field_pa_city_placeholder_en', v)} />
                    <FieldText label="Placeholder Email PA" value={copy.field_pa_email_placeholder} onChange={v => update('field_pa_email_placeholder', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Credenziali + consenso</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Password (IT)" value={copy.field_password_it} onChange={v => update('field_password_it', v)} />
                    <FieldText label="Password (EN)" value={copy.field_password_en} onChange={v => update('field_password_en', v)} />
                    <FieldText label="Conferma Password (IT)" value={copy.field_confirm_password_it} onChange={v => update('field_confirm_password_it', v)} />
                    <FieldText label="Confirm Password (EN)" value={copy.field_confirm_password_en} onChange={v => update('field_confirm_password_en', v)} />
                    <FieldTextArea label="Testo consenso marketing (IT)" value={copy.marketing_consent_it} onChange={v => update('marketing_consent_it', v)} />
                    <FieldTextArea label="Marketing consent text (EN)" value={copy.marketing_consent_en} onChange={v => update('marketing_consent_en', v)} />
                    <FieldText label='Etichetta link "Privacy Policy" (IT)' value={copy.privacy_policy_link_it} onChange={v => update('privacy_policy_link_it', v)} />
                    <FieldText label='Privacy Policy link label (EN)' value={copy.privacy_policy_link_en} onChange={v => update('privacy_policy_link_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Messaggi di validazione</h3>
                <p className="text-[12px] text-theme-text-secondary -mt-2">Mostrati inline accanto al campo invalido al momento del submit.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Voce vuota tendina tipo cliente (IT)' value={copy.client_type_default_it} onChange={v => update('client_type_default_it', v)} />
                    <FieldText label='Client type placeholder (EN)' value={copy.client_type_default_en} onChange={v => update('client_type_default_en', v)} />
                    <FieldText label='Voce vuota tendina tipo documento (IT)' value={copy.field_doc_type_default_it} onChange={v => update('field_doc_type_default_it', v)} />
                    <FieldText label='Document type placeholder (EN)' value={copy.field_doc_type_default_en} onChange={v => update('field_doc_type_default_en', v)} />
                    <FieldText label="Tipo cliente obbligatorio (IT)" value={copy.err_select_client_type_it} onChange={v => update('err_select_client_type_it', v)} />
                    <FieldText label="Client type required (EN)" value={copy.err_select_client_type_en} onChange={v => update('err_select_client_type_en', v)} />
                    <FieldText label="Nazione obbligatorio (IT)" value={copy.err_country_required_it} onChange={v => update('err_country_required_it', v)} />
                    <FieldText label="Country required (EN)" value={copy.err_country_required_en} onChange={v => update('err_country_required_en', v)} />
                    <FieldText label="Email obbligatorio (IT)" value={copy.err_email_required_it} onChange={v => update('err_email_required_it', v)} />
                    <FieldText label="Email required (EN)" value={copy.err_email_required_en} onChange={v => update('err_email_required_en', v)} />
                    <FieldText label="Denominazione obbligatorio (IT)" value={copy.err_denominazione_required_it} onChange={v => update('err_denominazione_required_it', v)} />
                    <FieldText label="Company name required (EN)" value={copy.err_denominazione_required_en} onChange={v => update('err_denominazione_required_en', v)} />
                    <FieldText label="P.IVA obbligatorio (IT)" value={copy.err_piva_required_it} onChange={v => update('err_piva_required_it', v)} />
                    <FieldText label="VAT required (EN)" value={copy.err_piva_required_en} onChange={v => update('err_piva_required_en', v)} />
                    <FieldText label="P.IVA non valida (IT)" value={copy.err_piva_invalid_it} onChange={v => update('err_piva_invalid_it', v)} />
                    <FieldText label="VAT invalid (EN)" value={copy.err_piva_invalid_en} onChange={v => update('err_piva_invalid_en', v)} />
                    <FieldText label="Indirizzo obbligatorio Azienda (IT)" value={copy.err_address_required_it} onChange={v => update('err_address_required_it', v)} />
                    <FieldText label="Company address required (EN)" value={copy.err_address_required_en} onChange={v => update('err_address_required_en', v)} />
                    <FieldText label="Telefono obbligatorio (IT)" value={copy.err_phone_required_it} onChange={v => update('err_phone_required_it', v)} />
                    <FieldText label="Phone required (EN)" value={copy.err_phone_required_en} onChange={v => update('err_phone_required_en', v)} />
                    <FieldText label="Telefono formato non valido (IT)" value={copy.err_phone_invalid_it} onChange={v => update('err_phone_invalid_it', v)} />
                    <FieldText label="Phone format invalid (EN)" value={copy.err_phone_invalid_en} onChange={v => update('err_phone_invalid_en', v)} />
                    <FieldText label="Nome rappresentante (IT)" value={copy.err_rep_nome_it} onChange={v => update('err_rep_nome_it', v)} />
                    <FieldText label="Rep first name (EN)" value={copy.err_rep_nome_en} onChange={v => update('err_rep_nome_en', v)} />
                    <FieldText label="Cognome rappresentante (IT)" value={copy.err_rep_cognome_it} onChange={v => update('err_rep_cognome_it', v)} />
                    <FieldText label="Rep last name (EN)" value={copy.err_rep_cognome_en} onChange={v => update('err_rep_cognome_en', v)} />
                    <FieldText label="CF rappresentante (IT)" value={copy.err_rep_cf_it} onChange={v => update('err_rep_cf_it', v)} />
                    <FieldText label="Rep tax code (EN)" value={copy.err_rep_cf_en} onChange={v => update('err_rep_cf_en', v)} />
                    <FieldText label="Ruolo rappresentante (IT)" value={copy.err_rep_ruolo_it} onChange={v => update('err_rep_ruolo_it', v)} />
                    <FieldText label="Rep role (EN)" value={copy.err_rep_ruolo_en} onChange={v => update('err_rep_ruolo_en', v)} />
                    <FieldText label="Tipo documento (IT)" value={copy.err_doc_type_it} onChange={v => update('err_doc_type_it', v)} />
                    <FieldText label="Document type (EN)" value={copy.err_doc_type_en} onChange={v => update('err_doc_type_en', v)} />
                    <FieldText label="Numero documento (IT)" value={copy.err_doc_numero_it} onChange={v => update('err_doc_numero_it', v)} />
                    <FieldText label="Document number (EN)" value={copy.err_doc_numero_en} onChange={v => update('err_doc_numero_en', v)} />
                    <FieldText label="Data rilascio documento (IT)" value={copy.err_doc_data_it} onChange={v => update('err_doc_data_it', v)} />
                    <FieldText label="Document issue date (EN)" value={copy.err_doc_data_en} onChange={v => update('err_doc_data_en', v)} />
                    <FieldText label="Luogo rilascio documento (IT)" value={copy.err_doc_luogo_it} onChange={v => update('err_doc_luogo_it', v)} />
                    <FieldText label="Document issue place (EN)" value={copy.err_doc_luogo_en} onChange={v => update('err_doc_luogo_en', v)} />
                    <FieldText label="Nome obbligatorio (IT)" value={copy.err_nome_required_it} onChange={v => update('err_nome_required_it', v)} />
                    <FieldText label="First name required (EN)" value={copy.err_nome_required_en} onChange={v => update('err_nome_required_en', v)} />
                    <FieldText label="Cognome obbligatorio (IT)" value={copy.err_cognome_required_it} onChange={v => update('err_cognome_required_it', v)} />
                    <FieldText label="Last name required (EN)" value={copy.err_cognome_required_en} onChange={v => update('err_cognome_required_en', v)} />
                    <FieldText label="CF non valido (IT)" value={copy.err_cf_invalid_it} onChange={v => update('err_cf_invalid_it', v)} />
                    <FieldText label="Tax code invalid (EN)" value={copy.err_cf_invalid_en} onChange={v => update('err_cf_invalid_en', v)} />
                    <FieldText label="CF obbligatorio (IT)" value={copy.err_cf_required_it} onChange={v => update('err_cf_required_it', v)} />
                    <FieldText label="Tax code required (EN)" value={copy.err_cf_required_en} onChange={v => update('err_cf_required_en', v)} />
                    <FieldText label="Sesso obbligatorio (IT)" value={copy.err_sesso_required_it} onChange={v => update('err_sesso_required_it', v)} />
                    <FieldText label="Gender required (EN)" value={copy.err_sesso_required_en} onChange={v => update('err_sesso_required_en', v)} />
                    <FieldText label="Città di nascita obbligatoria (IT)" value={copy.err_birth_city_required_it} onChange={v => update('err_birth_city_required_it', v)} />
                    <FieldText label="Place of birth required (EN)" value={copy.err_birth_city_required_en} onChange={v => update('err_birth_city_required_en', v)} />
                    <FieldText label="Provincia di nascita obbligatoria (IT)" value={copy.err_birth_province_required_it} onChange={v => update('err_birth_province_required_it', v)} />
                    <FieldText label="Province of birth required (EN)" value={copy.err_birth_province_required_en} onChange={v => update('err_birth_province_required_en', v)} />
                    <FieldText label="Numero civico obbligatorio (IT)" value={copy.err_civico_required_it} onChange={v => update('err_civico_required_it', v)} />
                    <FieldText label="Street number required (EN)" value={copy.err_civico_required_en} onChange={v => update('err_civico_required_en', v)} />
                    <FieldText label="CAP obbligatorio (IT)" value={copy.err_cap_required_it} onChange={v => update('err_cap_required_it', v)} />
                    <FieldText label="Postal code required (EN)" value={copy.err_cap_required_en} onChange={v => update('err_cap_required_en', v)} />
                    <FieldText label="Provincia obbligatoria (IT)" value={copy.err_province_required_it} onChange={v => update('err_province_required_it', v)} />
                    <FieldText label="Province required (EN)" value={copy.err_province_required_en} onChange={v => update('err_province_required_en', v)} />
                    <FieldText label="Residenza obbligatoria (IT)" value={copy.err_residenza_required_it} onChange={v => update('err_residenza_required_it', v)} />
                    <FieldText label="Residence required (EN)" value={copy.err_residenza_required_en} onChange={v => update('err_residenza_required_en', v)} />
                    <FieldText label="Codice Univoco obbligatorio (IT)" value={copy.err_codice_univoco_required_it} onChange={v => update('err_codice_univoco_required_it', v)} />
                    <FieldText label="Unique code required (EN)" value={copy.err_codice_univoco_required_en} onChange={v => update('err_codice_univoco_required_en', v)} />
                    <FieldText label="Ente obbligatorio (IT)" value={copy.err_ente_required_it} onChange={v => update('err_ente_required_it', v)} />
                    <FieldText label="Agency required (EN)" value={copy.err_ente_required_en} onChange={v => update('err_ente_required_en', v)} />
                    <FieldText label="Città obbligatoria (IT)" value={copy.err_city_required_it} onChange={v => update('err_city_required_it', v)} />
                    <FieldText label="City required (EN)" value={copy.err_city_required_en} onChange={v => update('err_city_required_en', v)} />
                    <FieldText label="Indirizzo obbligatorio PA (IT)" value={copy.err_pa_address_required_it} onChange={v => update('err_pa_address_required_it', v)} />
                    <FieldText label="PA address required (EN)" value={copy.err_pa_address_required_en} onChange={v => update('err_pa_address_required_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Editor pagina di pagamento (/pay, wrapper Nexi XPay) ────────────────
// Era `export` con un eslint-disable per non farlo segnalare come inutile:
// nessuna voce di menu lo montava, quindi i 48 campi finivano in DB senza
// che nessuno potesse aprirli. Ora e' montato sulla schermata `pagamento`
// e `npm run sito:check` impedisce che il caso si ripeta.
function PaymentEditor({ copy, setCopy }: { copy: PaymentCopy; setCopy: (next: PaymentCopy) => void }) {
    const update = <K extends keyof PaymentCopy>(key: K, value: PaymentCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Testi del wrapper Nexi XPay. L'iframe Nexi stesso resta in italiano (vincolo SDK), solo il
                contorno DR7 è bilingue e modificabile qui.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Chrome pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sottotitolo logo (IT)" value={copy.subtitle_it} onChange={v => update('subtitle_it', v)} />
                    <FieldText label="Logo subtitle (EN)" value={copy.subtitle_en} onChange={v => update('subtitle_en', v)} />
                    <FieldText label="Caricamento (IT)" value={copy.loading_it} onChange={v => update('loading_it', v)} />
                    <FieldText label="Loading (EN)" value={copy.loading_en} onChange={v => update('loading_en', v)} />
                    <FieldText label="Footer pagamento sicuro (IT)" value={copy.footer_secure_note_it} onChange={v => update('footer_secure_note_it', v)} />
                    <FieldText label="Footer secure note (EN)" value={copy.footer_secure_note_en} onChange={v => update('footer_secure_note_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato pronto al pagamento</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.ready_title_it} onChange={v => update('ready_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.ready_title_en} onChange={v => update('ready_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.ready_subtitle_it} onChange={v => update('ready_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.ready_subtitle_en} onChange={v => update('ready_subtitle_en', v)} />
                    <FieldText label="Avviso prepagate (IT)" value={copy.ready_prepaid_warning_it} onChange={v => update('ready_prepaid_warning_it', v)} />
                    <FieldText label="Prepaid warning (EN)" value={copy.ready_prepaid_warning_en} onChange={v => update('ready_prepaid_warning_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato verifica in corso</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.checking_title_it} onChange={v => update('checking_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.checking_title_en} onChange={v => update('checking_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.checking_subtitle_it} onChange={v => update('checking_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.checking_subtitle_en} onChange={v => update('checking_subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato bloccato (carta prepagata)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.blocked_title_it} onChange={v => update('blocked_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.blocked_title_en} onChange={v => update('blocked_title_en', v)} />
                    <FieldText label="Messaggio default (IT)" value={copy.blocked_default_message_it} onChange={v => update('blocked_default_message_it', v)} />
                    <FieldText label="Default message (EN)" value={copy.blocked_default_message_en} onChange={v => update('blocked_default_message_en', v)} />
                    <FieldText label="Aiuto (IT)" value={copy.blocked_help_it} onChange={v => update('blocked_help_it', v)} />
                    <FieldText label="Help (EN)" value={copy.blocked_help_en} onChange={v => update('blocked_help_en', v)} />
                    <FieldText label="CTA riprova (IT)" value={copy.blocked_retry_cta_it} onChange={v => update('blocked_retry_cta_it', v)} />
                    <FieldText label="Retry CTA (EN)" value={copy.blocked_retry_cta_en} onChange={v => update('blocked_retry_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato successo</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.success_title_it} onChange={v => update('success_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.success_title_en} onChange={v => update('success_title_en', v)} />
                    <FieldText label="Reindirizzamento (IT)" value={copy.success_redirect_it} onChange={v => update('success_redirect_it', v)} />
                    <FieldText label="Redirect (EN)" value={copy.success_redirect_en} onChange={v => update('success_redirect_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato annullato</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.cancelled_title_it} onChange={v => update('cancelled_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.cancelled_title_en} onChange={v => update('cancelled_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.cancelled_subtitle_it} onChange={v => update('cancelled_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.cancelled_subtitle_en} onChange={v => update('cancelled_subtitle_en', v)} />
                    <FieldText label="CTA riprova (IT)" value={copy.cancelled_retry_cta_it} onChange={v => update('cancelled_retry_cta_it', v)} />
                    <FieldText label="Retry CTA (EN)" value={copy.cancelled_retry_cta_en} onChange={v => update('cancelled_retry_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato errore + messaggi diagnostici</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo generico errore (IT)" value={copy.error_title_it} onChange={v => update('error_title_it', v)} />
                    <FieldText label="Generic error title (EN)" value={copy.error_title_en} onChange={v => update('error_title_en', v)} />
                    <FieldText label="Link non valido (IT)" value={copy.error_invalid_link_it} onChange={v => update('error_invalid_link_it', v)} />
                    <FieldText label="Invalid link (EN)" value={copy.error_invalid_link_en} onChange={v => update('error_invalid_link_en', v)} />
                    <FieldText label="SDK caricamento fallito (IT)" value={copy.error_sdk_load_it} onChange={v => update('error_sdk_load_it', v)} />
                    <FieldText label="SDK load failed (EN)" value={copy.error_sdk_load_en} onChange={v => update('error_sdk_load_en', v)} />
                    <FieldText label="SDK non disponibile (IT)" value={copy.error_sdk_unavailable_it} onChange={v => update('error_sdk_unavailable_it', v)} />
                    <FieldText label="SDK unavailable (EN)" value={copy.error_sdk_unavailable_en} onChange={v => update('error_sdk_unavailable_en', v)} />
                    <FieldText label="SDK init error (IT)" value={copy.error_sdk_init_it} onChange={v => update('error_sdk_init_it', v)} />
                    <FieldText label="SDK init error (EN)" value={copy.error_sdk_init_en} onChange={v => update('error_sdk_init_en', v)} />
                    <FieldText label="Verifica carta (IT)" value={copy.error_check_card_it} onChange={v => update('error_check_card_it', v)} />
                    <FieldText label="Check card error (EN)" value={copy.error_check_card_en} onChange={v => update('error_check_card_en', v)} />
                    <FieldText label="Pagamento fallito (IT)" value={copy.error_payment_failed_it} onChange={v => update('error_payment_failed_it', v)} />
                    <FieldText label="Payment failed (EN)" value={copy.error_payment_failed_en} onChange={v => update('error_payment_failed_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Payment Success editor (post-payment landing) ─────────────────────────
// Body templates accept tokens: {tierName} {cycle} (membership), {packageName}
// {amount} (wallet). Keep the placeholders verbatim — they're replaced at
// render time on the website.
function PaymentSuccessEditor({ copy, setCopy }: { copy: PaymentSuccessCopy; setCopy: (next: PaymentSuccessCopy) => void }) {
    const update = <K extends keyof PaymentSuccessCopy>(key: K, value: PaymentSuccessCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Pagina di conferma post-pagamento. Quattro varianti del messaggio (booking generica, DR7 Club,
                Membership con {`{tierName}`} {`{cycle}`}, Wallet con {`{packageName}`} {`{amount}`}). Lascia i
                segnaposto fra parentesi graffe — vengono sostituiti dal sito.
            </p>

            <WhatsAppTemplateNotice keys={[
                { key: 'pro_payment_success_rental', label: 'Conferma noleggio (auto / yacht / jet / heli)' },
                { key: 'pro_payment_success_appointment', label: 'Conferma appuntamento (lavaggio + meccanica)' },
            ]} />

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato caricamento</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.loading_title_it} onChange={v => update('loading_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.loading_title_en} onChange={v => update('loading_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.loading_subtitle_it} onChange={v => update('loading_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.loading_subtitle_en} onChange={v => update('loading_subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stato successo + corpo messaggio</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo successo (IT)" value={copy.success_title_it} onChange={v => update('success_title_it', v)} />
                    <FieldText label="Success title (EN)" value={copy.success_title_en} onChange={v => update('success_title_en', v)} />
                    <FieldTextArea label="Corpo generico (IT)" value={copy.body_generic_it} onChange={v => update('body_generic_it', v)} />
                    <FieldTextArea label="Generic body (EN)" value={copy.body_generic_en} onChange={v => update('body_generic_en', v)} />
                    <FieldTextArea label="Corpo DR7 Club (IT)" value={copy.body_dr7_club_it} onChange={v => update('body_dr7_club_it', v)} />
                    <FieldTextArea label="DR7 Club body (EN)" value={copy.body_dr7_club_en} onChange={v => update('body_dr7_club_en', v)} />
                    <FieldTextArea label="Corpo Membership (IT) — usa {tierName} {cycle}" value={copy.body_membership_template_it} onChange={v => update('body_membership_template_it', v)} />
                    <FieldTextArea label="Membership body (EN) — uses {tierName} {cycle}" value={copy.body_membership_template_en} onChange={v => update('body_membership_template_en', v)} />
                    <FieldText label="Titolo cauzione pre-autorizzata (IT)" value={copy.success_title_cauzione_it} onChange={v => update('success_title_cauzione_it', v)} />
                    <FieldText label="Deposit pre-authorized title (EN)" value={copy.success_title_cauzione_en} onChange={v => update('success_title_cauzione_en', v)} />
                    <FieldTextArea label="Corpo cauzione (IT) — importo bloccato, non addebitato" value={copy.body_cauzione_it} onChange={v => update('body_cauzione_it', v)} />
                    <FieldTextArea label="Deposit body (EN)" value={copy.body_cauzione_en} onChange={v => update('body_cauzione_en', v)} />
                    <FieldTextArea label="Corpo Wallet (IT) — usa {packageName} {amount}" value={copy.body_wallet_template_it} onChange={v => update('body_wallet_template_it', v)} />
                    <FieldTextArea label="Wallet body (EN) — uses {packageName} {amount}" value={copy.body_wallet_template_en} onChange={v => update('body_wallet_template_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Ciclo fatturazione (Membership)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Mensile (IT)' value={copy.billing_cycle_monthly_it} onChange={v => update('billing_cycle_monthly_it', v)} />
                    <FieldText label='Monthly (EN)' value={copy.billing_cycle_monthly_en} onChange={v => update('billing_cycle_monthly_en', v)} />
                    <FieldText label='Annuale (IT)' value={copy.billing_cycle_annual_it} onChange={v => update('billing_cycle_annual_it', v)} />
                    <FieldText label='Annual (EN)' value={copy.billing_cycle_annual_en} onChange={v => update('billing_cycle_annual_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Dettagli transazione</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo sezione (IT)" value={copy.transaction_heading_it} onChange={v => update('transaction_heading_it', v)} />
                    <FieldText label="Section heading (EN)" value={copy.transaction_heading_en} onChange={v => update('transaction_heading_en', v)} />
                    <FieldText label="ID Ordine (IT)" value={copy.transaction_order_id_label_it} onChange={v => update('transaction_order_id_label_it', v)} />
                    <FieldText label="Order ID label (EN)" value={copy.transaction_order_id_label_en} onChange={v => update('transaction_order_id_label_en', v)} />
                    <FieldText label="Importo (IT)" value={copy.transaction_amount_label_it} onChange={v => update('transaction_amount_label_it', v)} />
                    <FieldText label="Amount label (EN)" value={copy.transaction_amount_label_en} onChange={v => update('transaction_amount_label_en', v)} />
                    <FieldText label="Codice Autorizzazione (IT)" value={copy.transaction_auth_code_label_it} onChange={v => update('transaction_auth_code_label_it', v)} />
                    <FieldText label="Auth Code label (EN)" value={copy.transaction_auth_code_label_en} onChange={v => update('transaction_auth_code_label_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Pulsanti azione</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Home CTA (IT)" value={copy.cta_home_it} onChange={v => update('cta_home_it', v)} />
                    <FieldText label="Home CTA (EN)" value={copy.cta_home_en} onChange={v => update('cta_home_en', v)} />
                    <FieldText label="WhatsApp CTA (IT)" value={copy.cta_whatsapp_it} onChange={v => update('cta_whatsapp_it', v)} />
                    <FieldText label="WhatsApp CTA (EN)" value={copy.cta_whatsapp_en} onChange={v => update('cta_whatsapp_en', v)} />
                    <FieldText label="Membership CTA (IT)" value={copy.cta_membership_it} onChange={v => update('cta_membership_it', v)} />
                    <FieldText label="Membership CTA (EN)" value={copy.cta_membership_en} onChange={v => update('cta_membership_en', v)} />
                    <FieldText label="Wallet CTA (IT)" value={copy.cta_wallet_it} onChange={v => update('cta_wallet_it', v)} />
                    <FieldText label="Wallet CTA (EN)" value={copy.cta_wallet_en} onChange={v => update('cta_wallet_en', v)} />
                    <FieldText label="Prenotazioni CTA (IT)" value={copy.cta_bookings_it} onChange={v => update('cta_bookings_it', v)} />
                    <FieldText label="Bookings CTA (EN)" value={copy.cta_bookings_en} onChange={v => update('cta_bookings_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Messaggi di errore</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Creazione prenotazione (IT)" value={copy.err_booking_create_it} onChange={v => update('err_booking_create_it', v)} />
                    <FieldText label="Booking create error (EN)" value={copy.err_booking_create_en} onChange={v => update('err_booking_create_en', v)} />
                    <FieldText label="Autenticazione (IT)" value={copy.err_auth_it} onChange={v => update('err_auth_it', v)} />
                    <FieldText label="Auth error (EN)" value={copy.err_auth_en} onChange={v => update('err_auth_en', v)} />
                    <FieldText label="Aggiornamento acquisto (IT)" value={copy.err_purchase_update_it} onChange={v => update('err_purchase_update_it', v)} />
                    <FieldText label="Purchase update error (EN)" value={copy.err_purchase_update_en} onChange={v => update('err_purchase_update_en', v)} />
                    <FieldText label="Aggiunta crediti wallet (IT)" value={copy.err_credit_add_it} onChange={v => update('err_credit_add_it', v)} />
                    <FieldText label="Wallet credit add error (EN)" value={copy.err_credit_add_en} onChange={v => update('err_credit_add_en', v)} />
                    <FieldText label="Ordine non trovato (IT)" value={copy.err_order_not_found_it} onChange={v => update('err_order_not_found_it', v)} />
                    <FieldText label="Order not found (EN)" value={copy.err_order_not_found_en} onChange={v => update('err_order_not_found_en', v)} />
                    <FieldTextArea label="Pagamento non ancora confermato (IT)" value={copy.err_payment_not_confirmed_it} onChange={v => update('err_payment_not_confirmed_it', v)} />
                    <FieldTextArea label="Payment not confirmed yet (EN)" value={copy.err_payment_not_confirmed_en} onChange={v => update('err_payment_not_confirmed_en', v)} />
                    <FieldText label="Errore generico (IT)" value={copy.err_generic_it} onChange={v => update('err_generic_it', v)} />
                    <FieldText label="Generic error (EN)" value={copy.err_generic_en} onChange={v => update('err_generic_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Booking editor (yacht / jet / heli — chrome + auth gate + errors) ────
// Most form labels live in the website's i18n dictionary (t() lookups). This
// editor covers only the auth-required gate, completion screens, quote
// review block, payment error literals, and the generic "Select" option.
function BookingEditor({ copy, setCopy }: { copy: BookingCopy; setCopy: (next: BookingCopy) => void }) {
    const update = <K extends keyof BookingCopy>(key: K, value: BookingCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Pagina prenotazione (yacht / jet / elicottero). Le etichette dei campi del modulo restano nel
                dizionario i18n; qui modifichi solo gate di login, schermate di conferma, blocco riepilogo
                preventivo, messaggi di errore Stripe/salvataggio e label default del select.
            </p>

            <WhatsAppTemplateNotice keys={[
                { key: 'pro_booking_helicopter_inquiry', label: 'Richiesta preventivo elicottero' },
                { key: 'pro_booking_jet_inquiry', label: 'Richiesta preventivo jet privato' },
                { key: 'pro_booking_yacht_confirm', label: 'Conferma prenotazione yacht' },
            ]} />

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Stati comuni</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Caricamento (IT)" value={copy.loading_it} onChange={v => update('loading_it', v)} />
                    <FieldText label="Loading (EN)" value={copy.loading_en} onChange={v => update('loading_en', v)} />
                    <FieldText label="Articolo non trovato (IT)" value={copy.item_not_found_it} onChange={v => update('item_not_found_it', v)} />
                    <FieldText label="Item not found (EN)" value={copy.item_not_found_en} onChange={v => update('item_not_found_en', v)} />
                    <FieldText label='Default "Seleziona" (IT)' value={copy.select_option_default_it} onChange={v => update('select_option_default_it', v)} />
                    <FieldText label='Default "Select" (EN)' value={copy.select_option_default_en} onChange={v => update('select_option_default_en', v)} />
                    <FieldText label='Pagamento in inizializzazione (IT)' value={copy.payment_initializing_it} onChange={v => update('payment_initializing_it', v)} />
                    <FieldText label='Payment initializing (EN)' value={copy.payment_initializing_en} onChange={v => update('payment_initializing_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Gate "Accesso Richiesto"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Titolo (IT)' value={copy.auth_required_title_it} onChange={v => update('auth_required_title_it', v)} />
                    <FieldText label='Title (EN)' value={copy.auth_required_title_en} onChange={v => update('auth_required_title_en', v)} />
                    <FieldTextArea label='Body (IT)' value={copy.auth_required_body_it} onChange={v => update('auth_required_body_it', v)} />
                    <FieldTextArea label='Body (EN)' value={copy.auth_required_body_en} onChange={v => update('auth_required_body_en', v)} />
                    <FieldText label='CTA Accedi (IT)' value={copy.auth_required_login_cta_it} onChange={v => update('auth_required_login_cta_it', v)} />
                    <FieldText label='Login CTA (EN)' value={copy.auth_required_login_cta_en} onChange={v => update('auth_required_login_cta_en', v)} />
                    <FieldText label='CTA Registrati (IT)' value={copy.auth_required_signup_cta_it} onChange={v => update('auth_required_signup_cta_it', v)} />
                    <FieldText label='Sign Up CTA (EN)' value={copy.auth_required_signup_cta_en} onChange={v => update('auth_required_signup_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Schermata "Prenotazione Confermata"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Titolo (IT)' value={copy.booking_confirmed_title_it} onChange={v => update('booking_confirmed_title_it', v)} />
                    <FieldText label='Title (EN)' value={copy.booking_confirmed_title_en} onChange={v => update('booking_confirmed_title_en', v)} />
                    <FieldText label='Body (IT)' value={copy.booking_confirmed_body_it} onChange={v => update('booking_confirmed_body_it', v)} />
                    <FieldText label='Body (EN)' value={copy.booking_confirmed_body_en} onChange={v => update('booking_confirmed_body_en', v)} />
                    <FieldText label='CTA Prenotazioni (IT)' value={copy.booking_confirmed_cta_bookings_it} onChange={v => update('booking_confirmed_cta_bookings_it', v)} />
                    <FieldText label='Bookings CTA (EN)' value={copy.booking_confirmed_cta_bookings_en} onChange={v => update('booking_confirmed_cta_bookings_en', v)} />
                    <FieldText label='CTA Home (richiesta preventivo) (IT)' value={copy.inquiry_sent_cta_home_it} onChange={v => update('inquiry_sent_cta_home_it', v)} />
                    <FieldText label='Home CTA (after inquiry sent) (EN)' value={copy.inquiry_sent_cta_home_en} onChange={v => update('inquiry_sent_cta_home_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Riepilogo richiesta preventivo</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Titolo (IT)' value={copy.quote_review_title_it} onChange={v => update('quote_review_title_it', v)} />
                    <FieldText label='Title (EN)' value={copy.quote_review_title_en} onChange={v => update('quote_review_title_en', v)} />
                    <FieldTextArea label='Body (IT)' value={copy.quote_review_body_it} onChange={v => update('quote_review_body_it', v)} />
                    <FieldTextArea label='Body (EN)' value={copy.quote_review_body_en} onChange={v => update('quote_review_body_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Messaggi di errore</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Pagamento non configurato (IT)" value={copy.err_payment_not_configured_it} onChange={v => update('err_payment_not_configured_it', v)} />
                    <FieldText label="Payment not configured (EN)" value={copy.err_payment_not_configured_en} onChange={v => update('err_payment_not_configured_en', v)} />
                    <FieldText label="Server pagamento giù (IT)" value={copy.err_payment_server_down_it} onChange={v => update('err_payment_server_down_it', v)} />
                    <FieldText label="Payment server down (EN)" value={copy.err_payment_server_down_en} onChange={v => update('err_payment_server_down_en', v)} />
                    <FieldText label="Pagamento non pronto (IT)" value={copy.err_payment_not_ready_it} onChange={v => update('err_payment_not_ready_it', v)} />
                    <FieldText label="Payment not ready (EN)" value={copy.err_payment_not_ready_en} onChange={v => update('err_payment_not_ready_en', v)} />
                    <FieldText label="Categoria non supportata (IT)" value={copy.err_category_unsupported_it} onChange={v => update('err_category_unsupported_it', v)} />
                    <FieldText label="Category unsupported (EN)" value={copy.err_category_unsupported_en} onChange={v => update('err_category_unsupported_en', v)} />
                    <FieldText label="Salvataggio fallito (IT)" value={copy.err_save_failed_it} onChange={v => update('err_save_failed_it', v)} />
                    <FieldText label="Save failed (EN)" value={copy.err_save_failed_en} onChange={v => update('err_save_failed_en', v)} />
                    <FieldText label="Errore imprevisto (IT)" value={copy.err_unexpected_it} onChange={v => update('err_unexpected_it', v)} />
                    <FieldText label="Unexpected error (EN)" value={copy.err_unexpected_en} onChange={v => update('err_unexpected_en', v)} />
                </div>
            </section>
        </div>
    )
}

/**
 * Ripulisce i pacchetti prima di scriverli: id mancanti e serie in maiuscolo.
 *
 * Il sito scarta i pacchetti senza `id` (normalizeCreditPackages in
 * Sito/utils/siteCopy.ts): un pacchetto aggiunto e salvato senza nome restava
 * invisibile sulla pagina pubblica, senza che nulla lo dicesse dopo il
 * salvataggio. Qui l'id mancante viene ricavato al momento del salvataggio —
 * dal nome, altrimenti da serie + importo — e reso univoco.
 */
function slugifyPackageId(v: string): string {
    return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function normalizeCreditPackagesForSave(cw: CreditWalletCopy): CreditWalletCopy {
    if (!Array.isArray(cw.packages) || cw.packages.length === 0) return cw
    const used = new Set<string>()
    const packages = cw.packages.map(p => {
        // La serie e' un'etichetta stampata sulla card e sul filtro del sito:
        // il campo in gestionale la mostra in maiuscolo, quindi va SALVATA in
        // maiuscolo. Prima il maiuscolo era solo un effetto CSS e sul sito
        // usciva "dr7 maxi" invece di "DR7 MAXI".
        const series = (p.series || '').toUpperCase()
        let id = (p.id || '').trim()
        if (!id) {
            id = slugifyPackageId(p.name || '')
                || slugifyPackageId(`${p.series || 'pacchetto'} ${p.rechargeAmount || 0}`)
        }
        if (!id) id = 'pacchetto'
        let unique = id
        for (let n = 2; used.has(unique); n++) unique = `${id}-${n}`
        used.add(unique)
        return { ...p, id: unique, series }
    })
    return { ...cw, packages }
}

// ─── Credit Wallet editor (marketing + checkout modal + pacchetti) ─────────
// Qui si modificano i testi marketing, il chrome del modale di checkout e i
// pacchetti di ricarica (importi e bonus). Il template `{amount}` resta come
// segnaposto.
function CreditWalletEditor({ copy, setCopy }: { copy: CreditWalletCopy; setCopy: (next: CreditWalletCopy) => void }) {
    const update = <K extends keyof CreditWalletCopy>(key: K, value: CreditWalletCopy[K]) => setCopy({ ...copy, [key]: value })

    // ─── Pacchetti di ricarica ──────────────────────────────────────────
    // L'admin scrive solo ricarica e bonus %: bonus in € e totale ricevuto
    // sono ricalcolati qui, cosi' la card del sito non puo' mostrare tre
    // numeri che non tornano fra loro.
    const packages: CreditPackage[] = copy.packages ?? []
    const round2 = (n: number) => Math.round(n * 100) / 100
    const slugify = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const setPackages = (next: CreditPackage[]) => setCopy({ ...copy, packages: next })
    const derive = (p: CreditPackage, patch: Partial<CreditPackage>): CreditPackage => {
        const merged = { ...p, ...patch }
        const bonus = round2((merged.rechargeAmount || 0) * (merged.bonusPercentage || 0) / 100)
        return { ...merged, bonus, receivedAmount: round2((merged.rechargeAmount || 0) + bonus) }
    }
    const updatePkg = (i: number, patch: Partial<CreditPackage>) =>
        setPackages(packages.map((p, idx) => idx === i ? derive(p, patch) : p))
    const addPkg = () => setPackages([...packages, derive({
        id: '', series: packages[packages.length - 1]?.series ?? '', name: '',
        rechargeAmount: 0, receivedAmount: 0, bonus: 0, bonusPercentage: 0,
    }, {})])
    const removePkg = (i: number) => setPackages(packages.filter((_, idx) => idx !== i))
    const movePkg = (i: number, dir: -1 | 1) => {
        const next = [...packages]; const j = i + dir
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        setPackages(next)
    }
    // Il badge "PIÙ SCELTO" e' uno solo: sceglierne un altro spegne il precedente.
    const togglePopular = (i: number) =>
        setPackages(packages.map((p, idx) => ({ ...p, popular: idx === i ? !p.popular : false })))
    const seriesOptions = packages.reduce<string[]>((acc, p) => p.series && !acc.includes(p.series) ? [...acc, p.series] : acc, [])
    const euro = (n: number) => (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    const idIssue = (p: CreditPackage, i: number): string | null => {
        if (!p.id.trim()) return 'id obbligatorio'
        if (packages.some((o, idx) => idx !== i && o.id.trim() === p.id.trim())) return 'id duplicato'
        return null
    }

    const inputCls = 'w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]'

    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Testi marketing, pacchetti di ricarica e chrome del modale di acquisto crediti. Il segnaposto {`{amount}`}
                nel bottone "Paga" del modale viene sostituito a runtime con l'importo selezionato.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo hero (IT)" value={copy.hero_title_eyebrow_it} onChange={v => update('hero_title_eyebrow_it', v)} />
                    <FieldText label="Hero title (EN)" value={copy.hero_title_eyebrow_en} onChange={v => update('hero_title_eyebrow_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.hero_subtitle_it} onChange={v => update('hero_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.hero_subtitle_en} onChange={v => update('hero_subtitle_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.hero_intro_it} onChange={v => update('hero_intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.hero_intro_en} onChange={v => update('hero_intro_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Tre vantaggi sopra i pacchetti</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label={`"Fino all'80% Extra" titolo (IT)`} value={copy.benefit_extra_title_it} onChange={v => update('benefit_extra_title_it', v)} />
                    <FieldText label='"Up to 80% Extra" title (EN)' value={copy.benefit_extra_title_en} onChange={v => update('benefit_extra_title_en', v)} />
                    <FieldText label='Body (IT)' value={copy.benefit_extra_body_it} onChange={v => update('benefit_extra_body_it', v)} />
                    <FieldText label='Body (EN)' value={copy.benefit_extra_body_en} onChange={v => update('benefit_extra_body_en', v)} />
                    <FieldText label='"Nessuna Scadenza" titolo (IT)' value={copy.benefit_no_expiry_title_it} onChange={v => update('benefit_no_expiry_title_it', v)} />
                    <FieldText label='"No Expiration" title (EN)' value={copy.benefit_no_expiry_title_en} onChange={v => update('benefit_no_expiry_title_en', v)} />
                    <FieldText label='Body (IT)' value={copy.benefit_no_expiry_body_it} onChange={v => update('benefit_no_expiry_body_it', v)} />
                    <FieldText label='Body (EN)' value={copy.benefit_no_expiry_body_en} onChange={v => update('benefit_no_expiry_body_en', v)} />
                    <FieldText label='"100% Sicuro" titolo (IT)' value={copy.benefit_secure_title_it} onChange={v => update('benefit_secure_title_it', v)} />
                    <FieldText label='"100% Secure" title (EN)' value={copy.benefit_secure_title_en} onChange={v => update('benefit_secure_title_en', v)} />
                    <FieldText label='Body (IT)' value={copy.benefit_secure_body_it} onChange={v => update('benefit_secure_body_it', v)} />
                    <FieldText label='Body (EN)' value={copy.benefit_secure_body_en} onChange={v => update('benefit_secure_body_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Blocco "Come si usa"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.services_heading_it} onChange={v => update('services_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.services_heading_en} onChange={v => update('services_heading_en', v)} />
                    <FieldTextArea label="Descrizione (IT)" value={copy.services_body_it} onChange={v => update('services_body_it', v)} />
                    <FieldTextArea label="Description (EN)" value={copy.services_body_en} onChange={v => update('services_body_en', v)} />
                    <FieldText label='"Credito non scade" (IT)' value={copy.services_no_expiry_it} onChange={v => update('services_no_expiry_it', v)} />
                    <FieldText label='"Credit never expires" (EN)' value={copy.services_no_expiry_en} onChange={v => update('services_no_expiry_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Selettore pacchetti</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"SCEGLI IL TUO PACCHETTO:" (IT)' value={copy.packages_section_label_it} onChange={v => update('packages_section_label_it', v)} />
                    <FieldText label='"CHOOSE YOUR PACKAGE:" (EN)' value={copy.packages_section_label_en} onChange={v => update('packages_section_label_en', v)} />
                    <FieldText label='Filtro "Tutti i Pacchetti" (IT)' value={copy.packages_filter_all_it} onChange={v => update('packages_filter_all_it', v)} />
                    <FieldText label='Filter "All Packages" (EN)' value={copy.packages_filter_all_en} onChange={v => update('packages_filter_all_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">Pacchetti di ricarica ({packages.length})</h3>
                </div>
                <p className="text-[12px] text-theme-text-secondary">
                    Scrivi ricarica e bonus %: bonus in € e totale ricevuto sono calcolati e mostrati qui sotto,
                    identici a quelli della card sul sito. Le serie sono libere — il filtro in cima alla pagina
                    elenca quelle usate dai pacchetti. Gli <code className="text-[11px] bg-theme-bg-tertiary px-1 rounded">id</code> finiscono
                    negli acquisti (<code className="text-[11px] bg-theme-bg-tertiary px-1 rounded">credit_wallet_purchases.package_id</code>):
                    rinominarne uno rompe lo storico, meglio aggiungere un pacchetto nuovo.
                </p>
                <p className="text-[12px] text-theme-text-secondary">
                    Negli importi la virgola (o il punto) separa i <strong>centesimi</strong>, non le migliaia:
                    mille euro si scrive <code className="text-[11px] bg-theme-bg-tertiary px-1 rounded">1000</code>,
                    non <code className="text-[11px] bg-theme-bg-tertiary px-1 rounded">1.000</code>. L'anteprima sotto
                    ogni riga mostra la card esattamente come la vede il cliente: se i numeri sono strani, e' li' che si vede.
                </p>
                {packages.length === 0 && (
                    <p className="text-[12px] text-orange-500">
                        Nessun pacchetto: salvando cosi', la pagina Credit Wallet del sito resta senza nulla da acquistare.
                    </p>
                )}
                <datalist id="cw-series-options">
                    {seriesOptions.map(sv => <option key={sv} value={sv} />)}
                </datalist>
                {packages.map((p, i) => {
                    const issue = idIssue(p, i)
                    return (
                        <div key={i} className="border border-theme-border rounded-xl p-3 space-y-2 bg-theme-bg-secondary/40">
                            <div className="grid grid-cols-12 gap-2 items-center">
                                <input type="text" list="cw-series-options" value={p.series} onChange={e => updatePkg(i, { series: e.target.value.toUpperCase() })} placeholder="SERIE" className={`col-span-4 ${inputCls} uppercase`} />
                                <input type="text" value={p.name} onChange={e => updatePkg(i, { name: e.target.value, ...(p.id.trim() ? {} : { id: slugify(e.target.value) }) })} placeholder="Nome pacchetto" className={`col-span-4 ${inputCls}`} />
                                <input type="text" value={p.id} onChange={e => updatePkg(i, { id: e.target.value })} placeholder="id" className={`col-span-3 ${inputCls} font-mono ${issue ? 'border-red-500' : ''}`} />
                                <div className="col-span-1 flex justify-end">
                                    <div className="flex items-center gap-1">
                                        <button type="button" onClick={() => movePkg(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                                        </button>
                                        <button type="button" onClick={() => movePkg(i, 1)} disabled={i === packages.length - 1} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                        </button>
                                        <button type="button" onClick={() => removePkg(i)} className="w-7 h-7 rounded-md text-red-500 hover:bg-red-500/10 flex items-center justify-center" title="Rimuovi">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-12 gap-2 items-center">
                                <label className="col-span-3 flex items-center gap-2">
                                    <span className="text-[11px] text-theme-text-secondary whitespace-nowrap">Ricarica €</span>
                                    <MoneyInput value={p.rechargeAmount} onChange={v => updatePkg(i, { rechargeAmount: Number(v) || 0 })} className={inputCls} />
                                </label>
                                <label className="col-span-3 flex items-center gap-2">
                                    <span className="text-[11px] text-theme-text-secondary whitespace-nowrap">Bonus %</span>
                                    <MoneyInput value={p.bonusPercentage} onChange={v => updatePkg(i, { bonusPercentage: Number(v) || 0 })} min={0} max={100} className={inputCls} />
                                </label>
                                <div className="col-span-3 text-[12px] text-theme-text-secondary">
                                    Bonus <span className="font-semibold text-theme-text-primary">€ {euro(p.bonus)}</span>
                                </div>
                                <div className="col-span-3 flex items-center justify-between gap-2">
                                    <div className="text-[12px] text-theme-text-secondary">
                                        Riceve <span className="font-semibold text-theme-text-primary">€ {euro(p.receivedAmount)}</span>
                                    </div>
                                    <button type="button" onClick={() => togglePopular(i)} title='Badge "PIÙ SCELTO"' className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${p.popular ? 'bg-theme-text-primary text-theme-bg-primary border-theme-text-primary' : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-secondary'}`}>
                                        PIÙ SCELTO
                                    </button>
                                </div>
                            </div>
                            <p className="text-[11px] text-theme-text-secondary">
                                Card sul sito: <span className="font-semibold text-theme-text-primary">{p.series || '(serie)'} · {p.name || '(senza nome)'}</span>
                                {' '}— Ricarichi <span className="font-semibold text-theme-text-primary">{euro(p.rechargeAmount)}</span>
                                {' '}→ Ricevi <span className="font-semibold text-theme-text-primary">{euro(p.receivedAmount)}</span>
                                {' '}(+{euro(p.bonusPercentage)}% Bonus {euro(p.bonus)})
                            </p>
                            {p.rechargeAmount > 0 && p.rechargeAmount < 10 && (
                                <p className="text-[11px] text-orange-500">
                                    Ricarica di soli € {euro(p.rechargeAmount)}: il punto e la virgola separano i centesimi,
                                    non le migliaia. Per mille euro scrivi 1000.
                                </p>
                            )}
                            {issue && <p className="text-[11px] text-red-500">{issue} — il sito ignora i pacchetti senza id.</p>}
                        </div>
                    )
                })}
                <button type="button" onClick={addPkg} className="w-full py-2 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">+ Aggiungi pacchetto</button>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Card pacchetto (etichette ripetute su ogni card)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Badge "PIÙ SCELTO" (IT)' value={copy.card_popular_badge_it} onChange={v => update('card_popular_badge_it', v)} />
                    <FieldText label='"MOST POPULAR" badge (EN)' value={copy.card_popular_badge_en} onChange={v => update('card_popular_badge_en', v)} />
                    <FieldText label='Etichetta "Ricarichi" (IT)' value={copy.card_recharge_label_it} onChange={v => update('card_recharge_label_it', v)} />
                    <FieldText label='"You recharge" label (EN)' value={copy.card_recharge_label_en} onChange={v => update('card_recharge_label_en', v)} />
                    <FieldText label='Etichetta "Ricevi" (IT)' value={copy.card_receive_label_it} onChange={v => update('card_receive_label_it', v)} />
                    <FieldText label='"You receive" label (EN)' value={copy.card_receive_label_en} onChange={v => update('card_receive_label_en', v)} />
                    <FieldText label='Suffisso "Bonus" (IT)' value={copy.card_bonus_suffix_it} onChange={v => update('card_bonus_suffix_it', v)} />
                    <FieldText label='"Bonus" suffix (EN)' value={copy.card_bonus_suffix_en} onChange={v => update('card_bonus_suffix_en', v)} />
                    <FieldText label='CTA "Ricarica Ora" (IT)' value={copy.card_cta_it} onChange={v => update('card_cta_it', v)} />
                    <FieldText label='CTA "Top up now" (EN)' value={copy.card_cta_en} onChange={v => update('card_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Slogan promo sotto i pacchetti</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Riga 1 (IT)" value={copy.promo_line1_it} onChange={v => update('promo_line1_it', v)} />
                    <FieldText label="Line 1 (EN)" value={copy.promo_line1_en} onChange={v => update('promo_line1_en', v)} />
                    <FieldText label="Riga 2 (IT)" value={copy.promo_line2_it} onChange={v => update('promo_line2_it', v)} />
                    <FieldText label="Line 2 (EN)" value={copy.promo_line2_en} onChange={v => update('promo_line2_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Vantaggi (4 card)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo sezione (IT)" value={copy.advantages_heading_it} onChange={v => update('advantages_heading_it', v)} />
                    <FieldText label="Section heading (EN)" value={copy.advantages_heading_en} onChange={v => update('advantages_heading_en', v)} />
                    <FieldText label="Card 1 titolo (IT)" value={copy.advantage_1_title_it} onChange={v => update('advantage_1_title_it', v)} />
                    <FieldText label="Card 1 title (EN)" value={copy.advantage_1_title_en} onChange={v => update('advantage_1_title_en', v)} />
                    <FieldText label="Card 1 body (IT)" value={copy.advantage_1_body_it} onChange={v => update('advantage_1_body_it', v)} />
                    <FieldText label="Card 1 body (EN)" value={copy.advantage_1_body_en} onChange={v => update('advantage_1_body_en', v)} />
                    <FieldText label="Card 2 titolo (IT)" value={copy.advantage_2_title_it} onChange={v => update('advantage_2_title_it', v)} />
                    <FieldText label="Card 2 title (EN)" value={copy.advantage_2_title_en} onChange={v => update('advantage_2_title_en', v)} />
                    <FieldText label="Card 2 body (IT)" value={copy.advantage_2_body_it} onChange={v => update('advantage_2_body_it', v)} />
                    <FieldText label="Card 2 body (EN)" value={copy.advantage_2_body_en} onChange={v => update('advantage_2_body_en', v)} />
                    <FieldText label="Card 3 titolo (IT)" value={copy.advantage_3_title_it} onChange={v => update('advantage_3_title_it', v)} />
                    <FieldText label="Card 3 title (EN)" value={copy.advantage_3_title_en} onChange={v => update('advantage_3_title_en', v)} />
                    <FieldText label="Card 3 body (IT)" value={copy.advantage_3_body_it} onChange={v => update('advantage_3_body_it', v)} />
                    <FieldText label="Card 3 body (EN)" value={copy.advantage_3_body_en} onChange={v => update('advantage_3_body_en', v)} />
                    <FieldText label="Card 4 titolo (IT)" value={copy.advantage_4_title_it} onChange={v => update('advantage_4_title_it', v)} />
                    <FieldText label="Card 4 title (EN)" value={copy.advantage_4_title_en} onChange={v => update('advantage_4_title_en', v)} />
                    <FieldText label="Card 4 body (IT)" value={copy.advantage_4_body_it} onChange={v => update('advantage_4_body_it', v)} />
                    <FieldText label="Card 4 body (EN)" value={copy.advantage_4_body_en} onChange={v => update('advantage_4_body_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Trasparenza & sicurezza</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.transparency_heading_it} onChange={v => update('transparency_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.transparency_heading_en} onChange={v => update('transparency_heading_en', v)} />
                    <FieldText label="Bullet 1 (IT)" value={copy.transparency_bullet_1_it} onChange={v => update('transparency_bullet_1_it', v)} />
                    <FieldText label="Bullet 1 (EN)" value={copy.transparency_bullet_1_en} onChange={v => update('transparency_bullet_1_en', v)} />
                    <FieldText label="Bullet 2 (IT)" value={copy.transparency_bullet_2_it} onChange={v => update('transparency_bullet_2_it', v)} />
                    <FieldText label="Bullet 2 (EN)" value={copy.transparency_bullet_2_en} onChange={v => update('transparency_bullet_2_en', v)} />
                    <FieldText label="Bullet 3 (IT)" value={copy.transparency_bullet_3_it} onChange={v => update('transparency_bullet_3_it', v)} />
                    <FieldText label="Bullet 3 (EN)" value={copy.transparency_bullet_3_en} onChange={v => update('transparency_bullet_3_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">CTA finale</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.cta_title_it} onChange={v => update('cta_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.cta_title_en} onChange={v => update('cta_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.cta_subtitle_it} onChange={v => update('cta_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.cta_subtitle_en} onChange={v => update('cta_subtitle_en', v)} />
                    <FieldText label="Bottone (IT)" value={copy.cta_button_it} onChange={v => update('cta_button_it', v)} />
                    <FieldText label="Button (EN)" value={copy.cta_button_en} onChange={v => update('cta_button_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Modale di checkout</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo modale (IT)" value={copy.modal_title_it} onChange={v => update('modal_title_it', v)} />
                    <FieldText label="Modal title (EN)" value={copy.modal_title_en} onChange={v => update('modal_title_en', v)} />
                    <FieldText label='Etichetta "Ricarichi" (IT)' value={copy.modal_recharge_label_it} onChange={v => update('modal_recharge_label_it', v)} />
                    <FieldText label='"You recharge" label (EN)' value={copy.modal_recharge_label_en} onChange={v => update('modal_recharge_label_en', v)} />
                    <FieldText label='Etichetta "Bonus" (IT)' value={copy.modal_bonus_label_it} onChange={v => update('modal_bonus_label_it', v)} />
                    <FieldText label='"Bonus" label (EN)' value={copy.modal_bonus_label_en} onChange={v => update('modal_bonus_label_en', v)} />
                    <FieldText label='Etichetta "Ricevi" (IT)' value={copy.modal_receive_label_it} onChange={v => update('modal_receive_label_it', v)} />
                    <FieldText label='"You receive" label (EN)' value={copy.modal_receive_label_en} onChange={v => update('modal_receive_label_en', v)} />
                    <FieldText label='Heading "Informazioni di Pagamento" (IT)' value={copy.modal_payment_heading_it} onChange={v => update('modal_payment_heading_it', v)} />
                    <FieldText label='"Payment Information" heading (EN)' value={copy.modal_payment_heading_en} onChange={v => update('modal_payment_heading_en', v)} />
                    <FieldText label='Info reindirizzamento Nexi (IT)' value={copy.modal_payment_info_it} onChange={v => update('modal_payment_info_it', v)} />
                    <FieldText label='Nexi redirect info (EN)' value={copy.modal_payment_info_en} onChange={v => update('modal_payment_info_en', v)} />
                    <FieldText label='"Pagamento protetto..." (IT)' value={copy.modal_payment_secure_it} onChange={v => update('modal_payment_secure_it', v)} />
                    <FieldText label='"Secure payment..." (EN)' value={copy.modal_payment_secure_en} onChange={v => update('modal_payment_secure_en', v)} />
                    <FieldText label='Bottone "Annulla" (IT)' value={copy.modal_cancel_it} onChange={v => update('modal_cancel_it', v)} />
                    <FieldText label='"Cancel" button (EN)' value={copy.modal_cancel_en} onChange={v => update('modal_cancel_en', v)} />
                    <FieldText label='Bottone pagamento (IT) — usa {amount}' value={copy.modal_pay_template_it} onChange={v => update('modal_pay_template_it', v)} />
                    <FieldText label='Pay button (EN) — uses {amount}' value={copy.modal_pay_template_en} onChange={v => update('modal_pay_template_en', v)} />
                    <FieldText label='"Elaborazione..." (IT)' value={copy.modal_processing_it} onChange={v => update('modal_processing_it', v)} />
                    <FieldText label='"Processing..." (EN)' value={copy.modal_processing_en} onChange={v => update('modal_processing_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Errori modale</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Nome obbligatorio (IT)" value={copy.err_name_required_it} onChange={v => update('err_name_required_it', v)} />
                    <FieldText label="Name required (EN)" value={copy.err_name_required_en} onChange={v => update('err_name_required_en', v)} />
                    <FieldText label="Email obbligatoria (IT)" value={copy.err_email_required_it} onChange={v => update('err_email_required_it', v)} />
                    <FieldText label="Email required (EN)" value={copy.err_email_required_en} onChange={v => update('err_email_required_en', v)} />
                    <FieldText label="Telefono non valido (IT)" value={copy.err_phone_invalid_it} onChange={v => update('err_phone_invalid_it', v)} />
                    <FieldText label="Phone invalid (EN)" value={copy.err_phone_invalid_en} onChange={v => update('err_phone_invalid_en', v)} />
                    <FieldText label="Codice Fiscale non valido (IT)" value={copy.err_cf_invalid_it} onChange={v => update('err_cf_invalid_it', v)} />
                    <FieldText label="Tax code invalid (EN)" value={copy.err_cf_invalid_en} onChange={v => update('err_cf_invalid_en', v)} />
                    <FieldText label="Pagamento non pronto (IT)" value={copy.err_payment_not_ready_it} onChange={v => update('err_payment_not_ready_it', v)} />
                    <FieldText label="Payment not ready (EN)" value={copy.err_payment_not_ready_en} onChange={v => update('err_payment_not_ready_en', v)} />
                    <FieldText label="Pagamento fallito (IT)" value={copy.err_payment_failed_it} onChange={v => update('err_payment_failed_it', v)} />
                    <FieldText label="Payment failed (EN)" value={copy.err_payment_failed_en} onChange={v => update('err_payment_failed_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Token editor (DR7 Coin / Up / APP manifesto chrome) ──────────────────
// Solo chrome (titoli, lead, CTA finale). I corpi dei card della pagina
function TokenEditor({ copy, setCopy }: { copy: TokenCopy; setCopy: (next: TokenCopy) => void }) {
    const update = <K extends keyof TokenCopy>(key: K, value: TokenCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Pagina <code className="px-1 mx-1 bg-theme-bg-tertiary rounded">/token</code>: landing "Coming Soon" mostrata
                finchè il prodotto DR7 Token non è pronto. Quando i prodotti saranno definiti, riapri questa scheda per
                espandere lo schema con sezioni dettagliate (Coin / Up / APP).
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Coming Soon landing</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo principale (IT)" value={copy.hero_title_it} onChange={v => update('hero_title_it', v)} />
                    <FieldText label="Main title (EN)" value={copy.hero_title_en} onChange={v => update('hero_title_en', v)} />
                    <FieldText label='Eyebrow "Coming Soon" (IT)' value={copy.hero_eyebrow_it} onChange={v => update('hero_eyebrow_it', v)} />
                    <FieldText label='"Coming Soon" eyebrow (EN)' value={copy.hero_eyebrow_en} onChange={v => update('hero_eyebrow_en', v)} />
                    <FieldTextArea label="Messaggio (IT)" value={copy.body_message_it} onChange={v => update('body_message_it', v)} />
                    <FieldTextArea label="Message (EN)" value={copy.body_message_en} onChange={v => update('body_message_en', v)} />
                    <FieldText label='Pulsante "Torna alla Home" (IT)' value={copy.cta_button_it} onChange={v => update('cta_button_it', v)} />
                    <FieldText label='"Back to Home" button (EN)' value={copy.cta_button_en} onChange={v => update('cta_button_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Firma editor (contract OTP e-signature flow chrome + errors) ──────────
// Token segnaposto supportati nei template: {email} {name} {num} {attempts}
// {date} {i} {n}. Sostituiti a runtime — lasciali nei testi.
function FirmaEditor({ copy, setCopy }: { copy: FirmaCopy; setCopy: (next: FirmaCopy) => void }) {
    const update = <K extends keyof FirmaCopy>(key: K, value: FirmaCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Pagina di firma elettronica del contratto (backend DR7 Trust). Token segnaposto supportati
                nei testi: <code className="px-1 bg-theme-bg-tertiary rounded">{`{email}`}</code> <code className="px-1 bg-theme-bg-tertiary rounded">{`{name}`}</code> <code className="px-1 bg-theme-bg-tertiary rounded">{`{num}`}</code> <code className="px-1 bg-theme-bg-tertiary rounded">{`{attempts}`}</code> <code className="px-1 bg-theme-bg-tertiary rounded">{`{date}`}</code> <code className="px-1 bg-theme-bg-tertiary rounded">{`{i}`}</code> <code className="px-1 bg-theme-bg-tertiary rounded">{`{n}`}</code>.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Header + stati globali</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Pill header (IT)" value={copy.header_pill_it} onChange={v => update('header_pill_it', v)} />
                    <FieldText label="Header pill (EN)" value={copy.header_pill_en} onChange={v => update('header_pill_en', v)} />
                    <FieldText label="Caricamento contratto (IT)" value={copy.contract_loading_it} onChange={v => update('contract_loading_it', v)} />
                    <FieldText label="Loading contract (EN)" value={copy.contract_loading_en} onChange={v => update('contract_loading_en', v)} />
                    <FieldText label="Titolo Link Scaduto (IT)" value={copy.expired_title_it} onChange={v => update('expired_title_it', v)} />
                    <FieldText label="Link Expired title (EN)" value={copy.expired_title_en} onChange={v => update('expired_title_en', v)} />
                    <FieldTextArea label="Body Link Scaduto (IT)" value={copy.expired_body_it} onChange={v => update('expired_body_it', v)} />
                    <FieldTextArea label="Link Expired body (EN)" value={copy.expired_body_en} onChange={v => update('expired_body_en', v)} />
                    <FieldText label="Titolo Errore (IT)" value={copy.error_title_it} onChange={v => update('error_title_it', v)} />
                    <FieldText label="Error title (EN)" value={copy.error_title_en} onChange={v => update('error_title_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Riepilogo contratto</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Prefisso "Contratto" (IT)' value={copy.contract_number_prefix_it} onChange={v => update('contract_number_prefix_it', v)} />
                    <FieldText label='"Contract" prefix (EN)' value={copy.contract_number_prefix_en} onChange={v => update('contract_number_prefix_en', v)} />
                    <FieldText label="Etichetta Cliente (IT)" value={copy.label_cliente_it} onChange={v => update('label_cliente_it', v)} />
                    <FieldText label="Customer label (EN)" value={copy.label_cliente_en} onChange={v => update('label_cliente_en', v)} />
                    <FieldText label="Etichetta Veicolo (IT)" value={copy.label_veicolo_it} onChange={v => update('label_veicolo_it', v)} />
                    <FieldText label="Vehicle label (EN)" value={copy.label_veicolo_en} onChange={v => update('label_veicolo_en', v)} />
                    <FieldText label="Etichetta Ritiro (IT)" value={copy.label_ritiro_it} onChange={v => update('label_ritiro_it', v)} />
                    <FieldText label="Pickup label (EN)" value={copy.label_ritiro_en} onChange={v => update('label_ritiro_en', v)} />
                    <FieldText label="Etichetta Riconsegna (IT)" value={copy.label_riconsegna_it} onChange={v => update('label_riconsegna_it', v)} />
                    <FieldText label="Return label (EN)" value={copy.label_riconsegna_en} onChange={v => update('label_riconsegna_en', v)} />
                    <FieldText label="Fallback N/A (IT)" value={copy.na_fallback_it} onChange={v => update('na_fallback_it', v)} />
                    <FieldText label="N/A fallback (EN)" value={copy.na_fallback_en} onChange={v => update('na_fallback_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Viewer PDF</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo sezione (IT)" value={copy.pdf_section_title_it} onChange={v => update('pdf_section_title_it', v)} />
                    <FieldText label="Section title (EN)" value={copy.pdf_section_title_en} onChange={v => update('pdf_section_title_en', v)} />
                    <FieldText label="Suffisso pagine (IT)" value={copy.pdf_pages_suffix_it} onChange={v => update('pdf_pages_suffix_it', v)} />
                    <FieldText label="Pages suffix (EN)" value={copy.pdf_pages_suffix_en} onChange={v => update('pdf_pages_suffix_en', v)} />
                    <FieldText label="Overlay numero pagina (IT)" value={copy.pdf_page_overlay_template_it} onChange={v => update('pdf_page_overlay_template_it', v)} />
                    <FieldText label="Page overlay template (EN)" value={copy.pdf_page_overlay_template_en} onChange={v => update('pdf_page_overlay_template_en', v)} />
                    <FieldText label="Alt text pagina (IT)" value={copy.pdf_page_alt_template_it} onChange={v => update('pdf_page_alt_template_it', v)} />
                    <FieldText label="Page alt text (EN)" value={copy.pdf_page_alt_template_en} onChange={v => update('pdf_page_alt_template_en', v)} />
                    <FieldText label="Titolo iframe PDF (IT)" value={copy.pdf_iframe_title_it} onChange={v => update('pdf_iframe_title_it', v)} />
                    <FieldText label="PDF iframe title (EN)" value={copy.pdf_iframe_title_en} onChange={v => update('pdf_iframe_title_en', v)} />
                    <FieldText label="Caricamento documento (IT)" value={copy.pdf_loading_it} onChange={v => update('pdf_loading_it', v)} />
                    <FieldText label="Loading document (EN)" value={copy.pdf_loading_en} onChange={v => update('pdf_loading_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Step 1 — invia codice OTP</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo step (IT)" value={copy.otp_step1_title_it} onChange={v => update('otp_step1_title_it', v)} />
                    <FieldText label="Step title (EN)" value={copy.otp_step1_title_en} onChange={v => update('otp_step1_title_en', v)} />
                    <FieldTextArea label="Body con {email} (IT)" value={copy.otp_step1_body_template_it} onChange={v => update('otp_step1_body_template_it', v)} />
                    <FieldTextArea label="Body with {email} (EN)" value={copy.otp_step1_body_template_en} onChange={v => update('otp_step1_body_template_en', v)} />
                    <FieldText label="CTA invio codice (IT)" value={copy.otp_step1_cta_it} onChange={v => update('otp_step1_cta_it', v)} />
                    <FieldText label="Send code CTA (EN)" value={copy.otp_step1_cta_en} onChange={v => update('otp_step1_cta_en', v)} />
                    <FieldText label="Stato 'Invio in corso...' (IT)" value={copy.otp_sending_it} onChange={v => update('otp_sending_it', v)} />
                    <FieldText label="'Sending...' state (EN)" value={copy.otp_sending_en} onChange={v => update('otp_sending_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Step 2 — inserisci OTP</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo step (IT)" value={copy.otp_step2_title_it} onChange={v => update('otp_step2_title_it', v)} />
                    <FieldText label="Step title (EN)" value={copy.otp_step2_title_en} onChange={v => update('otp_step2_title_en', v)} />
                    <FieldTextArea label="Body con {email} (IT)" value={copy.otp_step2_body_template_it} onChange={v => update('otp_step2_body_template_it', v)} />
                    <FieldTextArea label="Body with {email} (EN)" value={copy.otp_step2_body_template_en} onChange={v => update('otp_step2_body_template_en', v)} />
                    <FieldText label="Tentativi rimanenti con {attempts} (IT)" value={copy.otp_attempts_template_it} onChange={v => update('otp_attempts_template_it', v)} />
                    <FieldText label="Attempts with {attempts} (EN)" value={copy.otp_attempts_template_en} onChange={v => update('otp_attempts_template_en', v)} />
                    <FieldText label="CTA verifica (IT)" value={copy.otp_verify_cta_it} onChange={v => update('otp_verify_cta_it', v)} />
                    <FieldText label="Verify CTA (EN)" value={copy.otp_verify_cta_en} onChange={v => update('otp_verify_cta_en', v)} />
                    <FieldText label="Stato 'Verifica...' (IT)" value={copy.otp_verifying_it} onChange={v => update('otp_verifying_it', v)} />
                    <FieldText label="'Verifying...' (EN)" value={copy.otp_verifying_en} onChange={v => update('otp_verifying_en', v)} />
                    <FieldText label="Link reinvio (IT)" value={copy.otp_resend_it} onChange={v => update('otp_resend_it', v)} />
                    <FieldText label="Resend link (EN)" value={copy.otp_resend_en} onChange={v => update('otp_resend_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Step 3 — conferma firma</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo step (IT)" value={copy.signing_step_title_it} onChange={v => update('signing_step_title_it', v)} />
                    <FieldText label="Step title (EN)" value={copy.signing_step_title_en} onChange={v => update('signing_step_title_en', v)} />
                    <FieldText label="Banner identita verificata (IT)" value={copy.signing_identity_verified_it} onChange={v => update('signing_identity_verified_it', v)} />
                    <FieldText label="Identity verified banner (EN)" value={copy.signing_identity_verified_en} onChange={v => update('signing_identity_verified_en', v)} />
                    <FieldTextArea label="Dichiarazione 1 con {name} {num} (IT)" value={copy.signing_ack_template_1_it} onChange={v => update('signing_ack_template_1_it', v)} />
                    <FieldTextArea label="Acknowledgment 1 with {name} {num} (EN)" value={copy.signing_ack_template_1_en} onChange={v => update('signing_ack_template_1_en', v)} />
                    <FieldTextArea label="Dichiarazione 2 con {email} (IT)" value={copy.signing_ack_template_2_it} onChange={v => update('signing_ack_template_2_it', v)} />
                    <FieldTextArea label="Acknowledgment 2 with {email} (EN)" value={copy.signing_ack_template_2_en} onChange={v => update('signing_ack_template_2_en', v)} />
                    <FieldTextArea label="Testo checkbox termini (IT)" value={copy.signing_terms_checkbox_it} onChange={v => update('signing_terms_checkbox_it', v)} />
                    <FieldTextArea label="Terms checkbox text (EN)" value={copy.signing_terms_checkbox_en} onChange={v => update('signing_terms_checkbox_en', v)} />
                    <FieldText label="CTA firma (IT)" value={copy.signing_submit_cta_it} onChange={v => update('signing_submit_cta_it', v)} />
                    <FieldText label="Sign CTA (EN)" value={copy.signing_submit_cta_en} onChange={v => update('signing_submit_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Documento firmato (successo)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.signed_title_it} onChange={v => update('signed_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.signed_title_en} onChange={v => update('signed_title_en', v)} />
                    <FieldTextArea label="Body con {date} (IT)" value={copy.signed_body_template_it} onChange={v => update('signed_body_template_it', v)} />
                    <FieldTextArea label="Body with {date} (EN)" value={copy.signed_body_template_en} onChange={v => update('signed_body_template_en', v)} />
                    <FieldText label="Nota email (IT)" value={copy.signed_email_note_it} onChange={v => update('signed_email_note_it', v)} />
                    <FieldText label="Email note (EN)" value={copy.signed_email_note_en} onChange={v => update('signed_email_note_en', v)} />
                    <FieldText label="CTA download (IT)" value={copy.signed_download_cta_it} onChange={v => update('signed_download_cta_it', v)} />
                    <FieldText label="Download CTA (EN)" value={copy.signed_download_cta_en} onChange={v => update('signed_download_cta_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Messaggi di errore</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Caricamento fallback (IT)" value={copy.err_load_fallback_it} onChange={v => update('err_load_fallback_it', v)} />
                    <FieldText label="Load fallback (EN)" value={copy.err_load_fallback_en} onChange={v => update('err_load_fallback_en', v)} />
                    <FieldText label="Caricamento contratto (IT)" value={copy.err_load_contract_it} onChange={v => update('err_load_contract_it', v)} />
                    <FieldText label="Load contract (EN)" value={copy.err_load_contract_en} onChange={v => update('err_load_contract_en', v)} />
                    <FieldText label="Invio OTP (IT)" value={copy.err_send_otp_it} onChange={v => update('err_send_otp_it', v)} />
                    <FieldText label="Send OTP (EN)" value={copy.err_send_otp_en} onChange={v => update('err_send_otp_en', v)} />
                    <FieldText label="Codice incompleto (IT)" value={copy.err_incomplete_code_it} onChange={v => update('err_incomplete_code_it', v)} />
                    <FieldText label="Incomplete code (EN)" value={copy.err_incomplete_code_en} onChange={v => update('err_incomplete_code_en', v)} />
                    <FieldText label="Verifica OTP (IT)" value={copy.err_verify_otp_it} onChange={v => update('err_verify_otp_it', v)} />
                    <FieldText label="Verify OTP (EN)" value={copy.err_verify_otp_en} onChange={v => update('err_verify_otp_en', v)} />
                    <FieldText label="Termini obbligatori (IT)" value={copy.err_terms_required_it} onChange={v => update('err_terms_required_it', v)} />
                    <FieldText label="Terms required (EN)" value={copy.err_terms_required_en} onChange={v => update('err_terms_required_en', v)} />
                    <FieldText label="Firma (IT)" value={copy.err_signing_it} onChange={v => update('err_signing_it', v)} />
                    <FieldText label="Signing (EN)" value={copy.err_signing_en} onChange={v => update('err_signing_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Registrazione Cliente editor (token-gated invite form chrome) ────────
function RegistrazioneClienteEditor({ copy, setCopy }: { copy: RegistrazioneClienteCopy; setCopy: (next: RegistrazioneClienteCopy) => void }) {
    const update = <K extends keyof RegistrazioneClienteCopy>(key: K, value: RegistrazioneClienteCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Pagina link-token che il cliente apre dall'invito operatore per completare i dati anagrafici e
                caricare i documenti. Le etichette dei singoli campi del form restano hardcoded (verranno
                migrate in un secondo passaggio); qui modifichi chrome, titoli sezione, gates (link
                scaduto/usato/revocato), step documenti, pulsanti e messaggi di validazione.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Intro pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.intro_title_it} onChange={v => update('intro_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.intro_title_en} onChange={v => update('intro_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.intro_subtitle_it} onChange={v => update('intro_subtitle_it', v)} />
                    <FieldTextArea label="Subtitle (EN)" value={copy.intro_subtitle_en} onChange={v => update('intro_subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Bottoni tipo cliente</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"Persona Fisica" (IT)' value={copy.tipo_persona_fisica_it} onChange={v => update('tipo_persona_fisica_it', v)} />
                    <FieldText label='"Individual" (EN)' value={copy.tipo_persona_fisica_en} onChange={v => update('tipo_persona_fisica_en', v)} />
                    <FieldText label='"Azienda" (IT)' value={copy.tipo_azienda_it} onChange={v => update('tipo_azienda_it', v)} />
                    <FieldText label='"Company" (EN)' value={copy.tipo_azienda_en} onChange={v => update('tipo_azienda_en', v)} />
                    <FieldText label='"Pubblica Amm." (IT)' value={copy.tipo_pa_it} onChange={v => update('tipo_pa_it', v)} />
                    <FieldText label='"Public Admin." (EN)' value={copy.tipo_pa_en} onChange={v => update('tipo_pa_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Titoli sezione (numerati)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='1. Tipo Cliente (IT)' value={copy.section_1_tipo_it} onChange={v => update('section_1_tipo_it', v)} />
                    <FieldText label='1. Client Type (EN)' value={copy.section_1_tipo_en} onChange={v => update('section_1_tipo_en', v)} />
                    <FieldText label='2. Dati Anagrafici (IT)' value={copy.section_2_anagrafica_it} onChange={v => update('section_2_anagrafica_it', v)} />
                    <FieldText label='2. Personal Data (EN)' value={copy.section_2_anagrafica_en} onChange={v => update('section_2_anagrafica_en', v)} />
                    <FieldText label='2. Dati Azienda (IT)' value={copy.section_2_azienda_it} onChange={v => update('section_2_azienda_it', v)} />
                    <FieldText label='2. Company Data (EN)' value={copy.section_2_azienda_en} onChange={v => update('section_2_azienda_en', v)} />
                    <FieldText label='2. Pubblica Amministrazione (IT)' value={copy.section_2_pa_it} onChange={v => update('section_2_pa_it', v)} />
                    <FieldText label='2. Public Administration (EN)' value={copy.section_2_pa_en} onChange={v => update('section_2_pa_en', v)} />
                    <FieldText label='3. Residenza (IT)' value={copy.section_3_residenza_it} onChange={v => update('section_3_residenza_it', v)} />
                    <FieldText label='3. Residence (EN)' value={copy.section_3_residenza_en} onChange={v => update('section_3_residenza_en', v)} />
                    <FieldText label='3. Sede (IT)' value={copy.section_3_sede_it} onChange={v => update('section_3_sede_it', v)} />
                    <FieldText label='3. Address (EN)' value={copy.section_3_sede_en} onChange={v => update('section_3_sede_en', v)} />
                    <FieldText label='4. Contatti (IT)' value={copy.section_4_contatti_it} onChange={v => update('section_4_contatti_it', v)} />
                    <FieldText label='4. Contacts (EN)' value={copy.section_4_contatti_en} onChange={v => update('section_4_contatti_en', v)} />
                    <FieldText label='✓ Documenti (IT)' value={copy.section_docs_it} onChange={v => update('section_docs_it', v)} />
                    <FieldText label='✓ Documents (EN)' value={copy.section_docs_en} onChange={v => update('section_docs_en', v)} />
                    <FieldText label="Suggerimento campi obbligatori (IT)" value={copy.required_hint_it} onChange={v => update('required_hint_it', v)} />
                    <FieldText label="Required-fields hint (EN)" value={copy.required_hint_en} onChange={v => update('required_hint_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Gate link (verifica + invalidi + done)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Verifica link... (IT)" value={copy.verifica_link_it} onChange={v => update('verifica_link_it', v)} />
                    <FieldText label="Verifying link... (EN)" value={copy.verifica_link_en} onChange={v => update('verifica_link_en', v)} />
                    <FieldText label="Titolo Link non utilizzabile (IT)" value={copy.invalid_title_it} onChange={v => update('invalid_title_it', v)} />
                    <FieldText label="Link not usable title (EN)" value={copy.invalid_title_en} onChange={v => update('invalid_title_en', v)} />
                    <FieldText label="Motivo: scaduto (IT)" value={copy.invalid_reason_expired_it} onChange={v => update('invalid_reason_expired_it', v)} />
                    <FieldText label="Reason: expired (EN)" value={copy.invalid_reason_expired_en} onChange={v => update('invalid_reason_expired_en', v)} />
                    <FieldText label="Motivo: già usato (IT)" value={copy.invalid_reason_used_it} onChange={v => update('invalid_reason_used_it', v)} />
                    <FieldText label="Reason: already used (EN)" value={copy.invalid_reason_used_en} onChange={v => update('invalid_reason_used_en', v)} />
                    <FieldText label="Motivo: revocato (IT)" value={copy.invalid_reason_revoked_it} onChange={v => update('invalid_reason_revoked_it', v)} />
                    <FieldText label="Reason: revoked (EN)" value={copy.invalid_reason_revoked_en} onChange={v => update('invalid_reason_revoked_en', v)} />
                    <FieldText label="Motivo: fallback (IT)" value={copy.invalid_reason_fallback_it} onChange={v => update('invalid_reason_fallback_it', v)} />
                    <FieldText label="Reason: fallback (EN)" value={copy.invalid_reason_fallback_en} onChange={v => update('invalid_reason_fallback_en', v)} />
                    <FieldText label="Motivo: incompleto (IT)" value={copy.invalid_reason_incomplete_it} onChange={v => update('invalid_reason_incomplete_it', v)} />
                    <FieldText label="Reason: incomplete (EN)" value={copy.invalid_reason_incomplete_en} onChange={v => update('invalid_reason_incomplete_en', v)} />
                    <FieldText label="Motivo: validation error (IT)" value={copy.invalid_reason_validation_it} onChange={v => update('invalid_reason_validation_it', v)} />
                    <FieldText label="Reason: validation error (EN)" value={copy.invalid_reason_validation_en} onChange={v => update('invalid_reason_validation_en', v)} />
                    <FieldTextArea label="Aiuto contatto (IT)" value={copy.invalid_help_it} onChange={v => update('invalid_help_it', v)} />
                    <FieldTextArea label="Contact help (EN)" value={copy.invalid_help_en} onChange={v => update('invalid_help_en', v)} />
                    <FieldText label="Titolo Registrazione completata (IT)" value={copy.done_title_it} onChange={v => update('done_title_it', v)} />
                    <FieldText label="Registration complete title (EN)" value={copy.done_title_en} onChange={v => update('done_title_en', v)} />
                    <FieldTextArea label="Body completato (IT)" value={copy.done_body_it} onChange={v => update('done_body_it', v)} />
                    <FieldTextArea label="Done body (EN)" value={copy.done_body_en} onChange={v => update('done_body_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Step Documenti</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Intro documenti (IT)" value={copy.docs_intro_it} onChange={v => update('docs_intro_it', v)} />
                    <FieldTextArea label="Docs intro (EN)" value={copy.docs_intro_en} onChange={v => update('docs_intro_en', v)} />
                    <FieldText label={`"Carta d'identita o Passaporto" (IT)`} value={copy.docs_label_identity_it} onChange={v => update('docs_label_identity_it', v)} />
                    <FieldText label='"ID Card or Passport" (EN)' value={copy.docs_label_identity_en} onChange={v => update('docs_label_identity_en', v)} />
                    <FieldText label='"Patente di guida" (IT)' value={copy.docs_label_license_it} onChange={v => update('docs_label_license_it', v)} />
                    <FieldText label='"Driving licence" (EN)' value={copy.docs_label_license_en} onChange={v => update('docs_label_license_en', v)} />
                    <FieldText label='"Codice Fiscale / Tessera Sanitaria" (IT)' value={copy.docs_label_codice_fiscale_it} onChange={v => update('docs_label_codice_fiscale_it', v)} />
                    <FieldText label='"Tax Code / Health Card" (EN)' value={copy.docs_label_codice_fiscale_en} onChange={v => update('docs_label_codice_fiscale_en', v)} />
                    <FieldText label="Chip caricato (IT)" value={copy.docs_chip_uploaded_it} onChange={v => update('docs_chip_uploaded_it', v)} />
                    <FieldText label="Uploaded chip (EN)" value={copy.docs_chip_uploaded_en} onChange={v => update('docs_chip_uploaded_en', v)} />
                    <FieldText label="Chip invio documento (IT)" value={copy.docs_chip_uploading_it} onChange={v => update('docs_chip_uploading_it', v)} />
                    <FieldText label="Uploading chip (EN)" value={copy.docs_chip_uploading_en} onChange={v => update('docs_chip_uploading_en', v)} />
                    <FieldText label="Link rimuovi (IT)" value={copy.docs_chip_remove_it} onChange={v => update('docs_chip_remove_it', v)} />
                    <FieldText label="Remove link (EN)" value={copy.docs_chip_remove_en} onChange={v => update('docs_chip_remove_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Bottoni</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"Continua →" (IT)' value={copy.cta_submit_it} onChange={v => update('cta_submit_it', v)} />
                    <FieldText label='"Continue →" (EN)' value={copy.cta_submit_en} onChange={v => update('cta_submit_en', v)} />
                    <FieldText label='Stato "Invio..." (IT)' value={copy.cta_submitting_it} onChange={v => update('cta_submitting_it', v)} />
                    <FieldText label='"Submitting..." state (EN)' value={copy.cta_submitting_en} onChange={v => update('cta_submitting_en', v)} />
                    <FieldText label='"Salta i documenti per ora" (IT)' value={copy.cta_skip_docs_it} onChange={v => update('cta_skip_docs_it', v)} />
                    <FieldText label='"Skip documents for now" (EN)' value={copy.cta_skip_docs_en} onChange={v => update('cta_skip_docs_en', v)} />
                    <FieldText label='"Carica selezionati" (IT)' value={copy.cta_upload_selected_it} onChange={v => update('cta_upload_selected_it', v)} />
                    <FieldText label='"Upload selected" (EN)' value={copy.cta_upload_selected_en} onChange={v => update('cta_upload_selected_en', v)} />
                    <FieldText label='"Concludi" (IT)' value={copy.cta_finish_it} onChange={v => update('cta_finish_it', v)} />
                    <FieldText label='"Finish" (EN)' value={copy.cta_finish_en} onChange={v => update('cta_finish_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Messaggi di validazione</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Prefisso campi mancanti con {list} (IT)" value={copy.err_missing_prefix_it} onChange={v => update('err_missing_prefix_it', v)} />
                    <FieldText label="Missing fields prefix with {list} (EN)" value={copy.err_missing_prefix_en} onChange={v => update('err_missing_prefix_en', v)} />
                    <FieldText label="Telefono non valido (IT)" value={copy.err_phone_invalid_it} onChange={v => update('err_phone_invalid_it', v)} />
                    <FieldText label="Phone invalid (EN)" value={copy.err_phone_invalid_en} onChange={v => update('err_phone_invalid_en', v)} />
                    <FieldText label="Email non valida (IT)" value={copy.err_email_invalid_it} onChange={v => update('err_email_invalid_it', v)} />
                    <FieldText label="Email invalid (EN)" value={copy.err_email_invalid_en} onChange={v => update('err_email_invalid_en', v)} />
                    <FieldText label="CF lunghezza (IT)" value={copy.err_cf_length_it} onChange={v => update('err_cf_length_it', v)} />
                    <FieldText label="Tax code length (EN)" value={copy.err_cf_length_en} onChange={v => update('err_cf_length_en', v)} />
                    <FieldText label="P.IVA lunghezza (IT)" value={copy.err_piva_length_it} onChange={v => update('err_piva_length_it', v)} />
                    <FieldText label="VAT length (EN)" value={copy.err_piva_length_en} onChange={v => update('err_piva_length_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Persona Fisica</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Nome (IT)" value={copy.field_nome_it} onChange={v => update('field_nome_it', v)} />
                    <FieldText label="First Name (EN)" value={copy.field_nome_en} onChange={v => update('field_nome_en', v)} />
                    <FieldText label="Cognome (IT)" value={copy.field_cognome_it} onChange={v => update('field_cognome_it', v)} />
                    <FieldText label="Last Name (EN)" value={copy.field_cognome_en} onChange={v => update('field_cognome_en', v)} />
                    <FieldText label="Etichetta CF (IT)" value={copy.field_cf_label_it} onChange={v => update('field_cf_label_it', v)} />
                    <FieldText label="Tax Code label (EN)" value={copy.field_cf_label_en} onChange={v => update('field_cf_label_en', v)} />
                    <FieldText label="Placeholder CF" value={copy.field_cf_placeholder} onChange={v => update('field_cf_placeholder', v)} />
                    <FieldText label="Sesso (IT)" value={copy.field_sesso_label_it} onChange={v => update('field_sesso_label_it', v)} />
                    <FieldText label="Gender (EN)" value={copy.field_sesso_label_en} onChange={v => update('field_sesso_label_en', v)} />
                    <FieldText label='"Seleziona…" default (IT)' value={copy.field_sesso_default_it} onChange={v => update('field_sesso_default_it', v)} />
                    <FieldText label='"Select…" default (EN)' value={copy.field_sesso_default_en} onChange={v => update('field_sesso_default_en', v)} />
                    <FieldText label="Maschio (IT)" value={copy.field_sesso_m_it} onChange={v => update('field_sesso_m_it', v)} />
                    <FieldText label="Male (EN)" value={copy.field_sesso_m_en} onChange={v => update('field_sesso_m_en', v)} />
                    <FieldText label="Femmina (IT)" value={copy.field_sesso_f_it} onChange={v => update('field_sesso_f_it', v)} />
                    <FieldText label="Female (EN)" value={copy.field_sesso_f_en} onChange={v => update('field_sesso_f_en', v)} />
                    <FieldText label="Data di Nascita (IT)" value={copy.field_birth_date_it} onChange={v => update('field_birth_date_it', v)} />
                    <FieldText label="Date of Birth (EN)" value={copy.field_birth_date_en} onChange={v => update('field_birth_date_en', v)} />
                    <FieldText label="Luogo di Nascita (IT)" value={copy.field_birth_city_it} onChange={v => update('field_birth_city_it', v)} />
                    <FieldText label="Place of Birth (EN)" value={copy.field_birth_city_en} onChange={v => update('field_birth_city_en', v)} />
                    <FieldText label="Placeholder Luogo (IT)" value={copy.field_birth_city_placeholder_it} onChange={v => update('field_birth_city_placeholder_it', v)} />
                    <FieldText label="Place placeholder (EN)" value={copy.field_birth_city_placeholder_en} onChange={v => update('field_birth_city_placeholder_en', v)} />
                    <FieldText label="Provincia di Nascita (IT)" value={copy.field_birth_province_it} onChange={v => update('field_birth_province_it', v)} />
                    <FieldText label="Province of Birth (EN)" value={copy.field_birth_province_en} onChange={v => update('field_birth_province_en', v)} />
                    <FieldText label="Placeholder Provincia (IT)" value={copy.field_birth_province_placeholder_it} onChange={v => update('field_birth_province_placeholder_it', v)} />
                    <FieldText label="Province placeholder (EN)" value={copy.field_birth_province_placeholder_en} onChange={v => update('field_birth_province_placeholder_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Azienda</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Ragione Sociale (IT)" value={copy.field_ragione_sociale_it} onChange={v => update('field_ragione_sociale_it', v)} />
                    <FieldText label="Company Name (EN)" value={copy.field_ragione_sociale_en} onChange={v => update('field_ragione_sociale_en', v)} />
                    <FieldText label="P.IVA (IT)" value={copy.field_piva_it} onChange={v => update('field_piva_it', v)} />
                    <FieldText label="VAT Number (EN)" value={copy.field_piva_en} onChange={v => update('field_piva_en', v)} />
                    <FieldText label="Placeholder P.IVA (IT)" value={copy.field_piva_placeholder_it} onChange={v => update('field_piva_placeholder_it', v)} />
                    <FieldText label="VAT placeholder (EN)" value={copy.field_piva_placeholder_en} onChange={v => update('field_piva_placeholder_en', v)} />
                    <FieldText label='"PEC (se nessun SDI)" (IT)' value={copy.field_pec_no_sdi_it} onChange={v => update('field_pec_no_sdi_it', v)} />
                    <FieldText label='"PEC (if no SDI)" (EN)' value={copy.field_pec_no_sdi_en} onChange={v => update('field_pec_no_sdi_en', v)} />
                    <FieldText label="Placeholder PEC" value={copy.field_pec_placeholder} onChange={v => update('field_pec_placeholder', v)} />
                    <FieldText label='"Codice SDI (se nessuna PEC)" (IT)' value={copy.field_sdi_no_pec_it} onChange={v => update('field_sdi_no_pec_it', v)} />
                    <FieldText label='"SDI Code (if no PEC)" (EN)' value={copy.field_sdi_no_pec_en} onChange={v => update('field_sdi_no_pec_en', v)} />
                    <FieldText label="Placeholder SDI (IT)" value={copy.field_sdi_placeholder_it} onChange={v => update('field_sdi_placeholder_it', v)} />
                    <FieldText label="SDI placeholder (EN)" value={copy.field_sdi_placeholder_en} onChange={v => update('field_sdi_placeholder_en', v)} />
                    <FieldText label="CF Rappresentante (IT)" value={copy.field_cf_rappresentante_it} onChange={v => update('field_cf_rappresentante_it', v)} />
                    <FieldText label="Representative Tax Code (EN)" value={copy.field_cf_rappresentante_en} onChange={v => update('field_cf_rappresentante_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Pubblica Amministrazione</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Ente / Ufficio (IT)" value={copy.field_ente_ufficio_it} onChange={v => update('field_ente_ufficio_it', v)} />
                    <FieldText label="Agency / Office (EN)" value={copy.field_ente_ufficio_en} onChange={v => update('field_ente_ufficio_en', v)} />
                    <FieldText label="Codice Univoco IPA (IT)" value={copy.field_codice_univoco_it} onChange={v => update('field_codice_univoco_it', v)} />
                    <FieldText label="IPA Unique Code (EN)" value={copy.field_codice_univoco_en} onChange={v => update('field_codice_univoco_en', v)} />
                    <FieldText label="Placeholder Codice Univoco (IT)" value={copy.field_codice_univoco_placeholder_it} onChange={v => update('field_codice_univoco_placeholder_it', v)} />
                    <FieldText label="Unique Code placeholder (EN)" value={copy.field_codice_univoco_placeholder_en} onChange={v => update('field_codice_univoco_placeholder_en', v)} />
                    <FieldText label="Codice Fiscale Ente (IT)" value={copy.field_cf_ente_it} onChange={v => update('field_cf_ente_it', v)} />
                    <FieldText label="Agency Tax Code (EN)" value={copy.field_cf_ente_en} onChange={v => update('field_cf_ente_en', v)} />
                    <FieldText label='"PEC" semplice (IT)' value={copy.field_pec_simple_it} onChange={v => update('field_pec_simple_it', v)} />
                    <FieldText label='"PEC" simple (EN)' value={copy.field_pec_simple_en} onChange={v => update('field_pec_simple_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Residenza / Sede</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Indirizzo (IT)" value={copy.field_indirizzo_it} onChange={v => update('field_indirizzo_it', v)} />
                    <FieldText label="Address (EN)" value={copy.field_indirizzo_en} onChange={v => update('field_indirizzo_en', v)} />
                    <FieldText label="Placeholder Indirizzo (IT)" value={copy.field_indirizzo_placeholder_it} onChange={v => update('field_indirizzo_placeholder_it', v)} />
                    <FieldText label="Address placeholder (EN)" value={copy.field_indirizzo_placeholder_en} onChange={v => update('field_indirizzo_placeholder_en', v)} />
                    <FieldText label="Civico (IT)" value={copy.field_civico_it} onChange={v => update('field_civico_it', v)} />
                    <FieldText label="Street Number (EN)" value={copy.field_civico_en} onChange={v => update('field_civico_en', v)} />
                    <FieldText label="Placeholder Civico (IT)" value={copy.field_civico_placeholder_it} onChange={v => update('field_civico_placeholder_it', v)} />
                    <FieldText label="Street Number placeholder (EN)" value={copy.field_civico_placeholder_en} onChange={v => update('field_civico_placeholder_en', v)} />
                    <FieldText label="Città (IT)" value={copy.field_citta_it} onChange={v => update('field_citta_it', v)} />
                    <FieldText label="City (EN)" value={copy.field_citta_en} onChange={v => update('field_citta_en', v)} />
                    <FieldText label="Placeholder Città (IT)" value={copy.field_citta_placeholder_it} onChange={v => update('field_citta_placeholder_it', v)} />
                    <FieldText label="City placeholder (EN)" value={copy.field_citta_placeholder_en} onChange={v => update('field_citta_placeholder_en', v)} />
                    <FieldText label="Provincia (IT)" value={copy.field_provincia_it} onChange={v => update('field_provincia_it', v)} />
                    <FieldText label="Province (EN)" value={copy.field_provincia_en} onChange={v => update('field_provincia_en', v)} />
                    <FieldText label="Placeholder Provincia (IT)" value={copy.field_provincia_placeholder_it} onChange={v => update('field_provincia_placeholder_it', v)} />
                    <FieldText label="Province placeholder (EN)" value={copy.field_provincia_placeholder_en} onChange={v => update('field_provincia_placeholder_en', v)} />
                    <FieldText label="CAP (IT)" value={copy.field_cap_it} onChange={v => update('field_cap_it', v)} />
                    <FieldText label="ZIP (EN)" value={copy.field_cap_en} onChange={v => update('field_cap_en', v)} />
                    <FieldText label="Placeholder CAP (IT)" value={copy.field_cap_placeholder_it} onChange={v => update('field_cap_placeholder_it', v)} />
                    <FieldText label="ZIP placeholder (EN)" value={copy.field_cap_placeholder_en} onChange={v => update('field_cap_placeholder_en', v)} />
                    <FieldText label="Nazione (IT)" value={copy.field_nazione_it} onChange={v => update('field_nazione_it', v)} />
                    <FieldText label="Country (EN)" value={copy.field_nazione_en} onChange={v => update('field_nazione_en', v)} />
                    <FieldText label="Placeholder Nazione" value={copy.field_nazione_placeholder} onChange={v => update('field_nazione_placeholder', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Campi Contatti</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Telefono (IT)" value={copy.field_telefono_it} onChange={v => update('field_telefono_it', v)} />
                    <FieldText label="Phone (EN)" value={copy.field_telefono_en} onChange={v => update('field_telefono_en', v)} />
                    <FieldText label="Placeholder Telefono" value={copy.field_telefono_placeholder} onChange={v => update('field_telefono_placeholder', v)} />
                    <FieldText label="Email (IT)" value={copy.field_email_it} onChange={v => update('field_email_it', v)} />
                    <FieldText label="Email (EN)" value={copy.field_email_en} onChange={v => update('field_email_en', v)} />
                    <FieldText label="Placeholder Email" value={copy.field_email_placeholder} onChange={v => update('field_email_placeholder', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── BookingSearchBox editor (Header drawer popup + Hero variant) ──────────
function BookingSearchBoxEditor({ copy, setCopy }: { copy: BookingSearchBoxCopy; setCopy: (next: BookingSearchBoxCopy) => void }) {
    const update = <K extends keyof BookingSearchBoxCopy>(key: K, value: BookingSearchBoxCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Form di ricerca veicolo che appare nel popup del menu Header e nella variante hero. Tutti i
                testi sono bilingue e modificabili qui.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Header + posizioni</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.title_it} onChange={v => update('title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.title_en} onChange={v => update('title_en', v)} />
                    <FieldText label="Etichetta luogo ritiro (IT)" value={copy.pickup_location_label_it} onChange={v => update('pickup_location_label_it', v)} />
                    <FieldText label="Pickup location label (EN)" value={copy.pickup_location_label_en} onChange={v => update('pickup_location_label_en', v)} />
                    <FieldText label="Placeholder ritiro (IT)" value={copy.pickup_location_placeholder_it} onChange={v => update('pickup_location_placeholder_it', v)} />
                    <FieldText label="Pickup placeholder (EN)" value={copy.pickup_location_placeholder_en} onChange={v => update('pickup_location_placeholder_en', v)} />
                    <FieldTextArea label="Nota stesso indirizzo (IT)" value={copy.same_return_note_it} onChange={v => update('same_return_note_it', v)} />
                    <FieldTextArea label="Same-address note (EN)" value={copy.same_return_note_en} onChange={v => update('same_return_note_en', v)} />
                    <FieldText label="Etichetta luogo riconsegna (IT)" value={copy.return_location_label_it} onChange={v => update('return_location_label_it', v)} />
                    <FieldText label="Return location label (EN)" value={copy.return_location_label_en} onChange={v => update('return_location_label_en', v)} />
                    <FieldText label="Placeholder riconsegna (IT)" value={copy.return_location_placeholder_it} onChange={v => update('return_location_placeholder_it', v)} />
                    <FieldText label="Return placeholder (EN)" value={copy.return_location_placeholder_en} onChange={v => update('return_location_placeholder_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Date e orari</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Eyebrow "Ritiro" (IT)' value={copy.pickup_section_label_it} onChange={v => update('pickup_section_label_it', v)} />
                    <FieldText label='Eyebrow "Pickup" (EN)' value={copy.pickup_section_label_en} onChange={v => update('pickup_section_label_en', v)} />
                    <FieldText label='Eyebrow "Restituzione" (IT)' value={copy.return_section_label_it} onChange={v => update('return_section_label_it', v)} />
                    <FieldText label='Eyebrow "Return" (EN)' value={copy.return_section_label_en} onChange={v => update('return_section_label_en', v)} />
                    <FieldText label='Placeholder "Seleziona data" (IT)' value={copy.date_placeholder_it} onChange={v => update('date_placeholder_it', v)} />
                    <FieldText label='"Select date" placeholder (EN)' value={copy.date_placeholder_en} onChange={v => update('date_placeholder_en', v)} />
                    <FieldText label='Messaggio "Chiusi" (IT)' value={copy.closed_message_it} onChange={v => update('closed_message_it', v)} />
                    <FieldText label='"Closed" message (EN)' value={copy.closed_message_en} onChange={v => update('closed_message_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Avviso tariffa + consegna a domicilio</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo avviso tariffa (IT)" value={copy.rate_warning_title_it} onChange={v => update('rate_warning_title_it', v)} />
                    <FieldText label="Rate warning title (EN)" value={copy.rate_warning_title_en} onChange={v => update('rate_warning_title_en', v)} />
                    <FieldTextArea label="Body avviso tariffa (IT)" value={copy.rate_warning_body_it} onChange={v => update('rate_warning_body_it', v)} />
                    <FieldTextArea label="Rate warning body (EN)" value={copy.rate_warning_body_en} onChange={v => update('rate_warning_body_en', v)} />
                    <FieldText label="Caricamento calcolo (IT)" value={copy.delivery_calc_loading_it} onChange={v => update('delivery_calc_loading_it', v)} />
                    <FieldText label="Calc loading (EN)" value={copy.delivery_calc_loading_en} onChange={v => update('delivery_calc_loading_en', v)} />
                    <FieldText label='"Consegna a domicilio" (IT)' value={copy.delivery_label_it} onChange={v => update('delivery_label_it', v)} />
                    <FieldText label='"Home delivery" (EN)' value={copy.delivery_label_en} onChange={v => update('delivery_label_en', v)} />
                    <FieldText label='Breakdown "Consegna" (IT)' value={copy.delivery_breakdown_consegna_it} onChange={v => update('delivery_breakdown_consegna_it', v)} />
                    <FieldText label='Breakdown "Delivery" (EN)' value={copy.delivery_breakdown_consegna_en} onChange={v => update('delivery_breakdown_consegna_en', v)} />
                    <FieldText label='Breakdown "Riconsegna" (IT)' value={copy.delivery_breakdown_riconsegna_it} onChange={v => update('delivery_breakdown_riconsegna_it', v)} />
                    <FieldText label='Breakdown "Return" (EN)' value={copy.delivery_breakdown_riconsegna_en} onChange={v => update('delivery_breakdown_riconsegna_en', v)} />
                </div>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">CTA + errori</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="CTA ricerca (IT)" value={copy.search_cta_it} onChange={v => update('search_cta_it', v)} />
                    <FieldText label="Search CTA (EN)" value={copy.search_cta_en} onChange={v => update('search_cta_en', v)} />
                    <FieldText label="Errore data ritiro (IT)" value={copy.err_pickup_date_required_it} onChange={v => update('err_pickup_date_required_it', v)} />
                    <FieldText label="Pickup date required (EN)" value={copy.err_pickup_date_required_en} onChange={v => update('err_pickup_date_required_en', v)} />
                    <FieldText label="Errore data restituzione (IT)" value={copy.err_return_date_required_it} onChange={v => update('err_return_date_required_it', v)} />
                    <FieldText label="Return date required (EN)" value={copy.err_return_date_required_en} onChange={v => update('err_return_date_required_en', v)} />
                    <FieldText label="Ritiro bloccato (IT)" value={copy.err_blocked_pickup_it} onChange={v => update('err_blocked_pickup_it', v)} />
                    <FieldText label="Blocked pickup (EN)" value={copy.err_blocked_pickup_en} onChange={v => update('err_blocked_pickup_en', v)} />
                    <FieldText label="Riconsegna bloccata (IT)" value={copy.err_blocked_return_it} onChange={v => update('err_blocked_return_it', v)} />
                    <FieldText label="Blocked return (EN)" value={copy.err_blocked_return_en} onChange={v => update('err_blocked_return_en', v)} />
                    <FieldText label="Riconsegna prima di ritiro (IT)" value={copy.err_return_before_pickup_it} onChange={v => update('err_return_before_pickup_it', v)} />
                    <FieldText label="Return before pickup (EN)" value={copy.err_return_before_pickup_en} onChange={v => update('err_return_before_pickup_en', v)} />
                    <FieldText label="Orario riconsegna prima ritiro (IT)" value={copy.err_return_time_before_pickup_it} onChange={v => update('err_return_time_before_pickup_it', v)} />
                    <FieldText label="Return time before pickup (EN)" value={copy.err_return_time_before_pickup_en} onChange={v => update('err_return_time_before_pickup_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Payment Cancel editor (post-Nexi cancel landing) ─────────────────────
function PaymentCancelEditor({ copy, setCopy }: { copy: PaymentCancelCopy; setCopy: (next: PaymentCancelCopy) => void }) {
    const update = <K extends keyof PaymentCancelCopy>(key: K, value: PaymentCancelCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Pagina mostrata se il cliente annulla il pagamento Nexi (no addebito). Pochi testi: titolo,
                corpo rassicurante, e i due CTA (Home / Riprova).
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.title_it} onChange={v => update('title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.title_en} onChange={v => update('title_en', v)} />
                    <FieldTextArea label="Body (IT)" value={copy.body_it} onChange={v => update('body_it', v)} />
                    <FieldTextArea label="Body (EN)" value={copy.body_en} onChange={v => update('body_en', v)} />
                    <FieldText label="CTA Home (IT)" value={copy.cta_home_it} onChange={v => update('cta_home_it', v)} />
                    <FieldText label="CTA Home (EN)" value={copy.cta_home_en} onChange={v => update('cta_home_en', v)} />
                    <FieldText label="CTA Riprova (IT)" value={copy.cta_retry_it} onChange={v => update('cta_retry_it', v)} />
                    <FieldText label="CTA Retry (EN)" value={copy.cta_retry_en} onChange={v => update('cta_retry_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Aspetto & Funzionalita del sito ──────────────────────────────────────
// L'unica sezione dell'onglet che non modifica testi: qui si sposta il logo
// e si accendono/spengono i widget che compaiono su OGNI pagina. Prima
// vivevano nel codice del sito, quindi spostare il logo o spegnere la chat
// voleva dire un deploy.
const LOGO_ALIGNMENTS: { value: LogoAlignment; label: string; hint: string }[] = [
    { value: 'left', label: 'A sinistra', hint: 'Logo prima del menu ESPLORA.' },
    { value: 'center', label: 'Al centro', hint: 'Come oggi su dr7.app.' },
    { value: 'right', label: 'A destra', hint: 'Logo in coda ai controlli utente.' },
]

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-start justify-between gap-4 py-3 cursor-pointer border-b border-theme-border last:border-b-0">
            <span className="min-w-0">
                <span className="block text-[13px] font-medium text-theme-text-primary">{label}</span>
                <span className="block text-[11px] text-theme-text-secondary mt-0.5">{hint}</span>
            </span>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
            <span className="relative inline-block shrink-0 mt-0.5 w-9 h-5 rounded-full bg-[#e5e5ea] peer-checked:bg-[#34c759] transition-colors">
                <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </span>
        </label>
    )
}

/** Campo px. Mai type="number": si scrive la cifra, si valida qui. */
function FieldPx({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">{label}</span>
            <div className="mt-1 flex items-center gap-2">
                <input
                    type="text"
                    inputMode="numeric"
                    value={String(value)}
                    onChange={(e) => {
                        const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10)
                        onChange(isFinite(n) && n > 0 ? n : 0)
                    }}
                    className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <span className="text-[12px] text-theme-text-secondary">px</span>
            </div>
        </label>
    )
}

function AspettoEditor({ copy, setCopy }: { copy: Required<AspettoCopy>; setCopy: (next: Required<AspettoCopy>) => void }) {
    const update = <K extends keyof AspettoCopy>(key: K, value: Required<AspettoCopy>[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Layout del logo e interruttori dei widget presenti su ogni pagina di dr7.app.
                Le modifiche si vedono al primo ricaricamento del sito.
            </p>

            {/* Logo */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Logo</h3>

                <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Posizione nella barra in alto</span>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {LOGO_ALIGNMENTS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => update('logo_alignment', opt.value)}
                                className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${copy.logo_alignment === opt.value
                                    ? 'border-blue-500 bg-blue-500/10'
                                    : 'border-theme-border bg-theme-bg-secondary hover:bg-theme-bg-tertiary'}`}
                            >
                                <span className="block text-[13px] font-medium text-theme-text-primary">{opt.label}</span>
                                <span className="block text-[11px] text-theme-text-secondary mt-0.5">{opt.hint}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <FieldText
                    label="Immagine del logo (percorso o URL)"
                    value={copy.logo_url}
                    onChange={v => update('logo_url', v)}
                />
                <p className="text-[11px] text-theme-text-secondary -mt-2">
                    Usata nella barra in alto, nel menu ESPLORA e nel footer. Un percorso come
                    <b> /DR7logo1.png</b> punta a un file gia' caricato sul sito.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FieldPx label="Altezza — schermo grande" value={copy.logo_height_desktop} onChange={v => update('logo_height_desktop', v)} />
                    <FieldPx label="Altezza — telefono" value={copy.logo_height_mobile} onChange={v => update('logo_height_mobile', v)} />
                    <FieldPx label="Altezza — footer" value={copy.footer_logo_height} onChange={v => update('footer_logo_height', v)} />
                </div>

                {/* Anteprima: la barra vista dall'alto, non i valori scritti. */}
                <div className="rounded-xl border border-theme-border bg-black p-3">
                    <span className="block text-[11px] text-gray-500 mb-2">Anteprima barra in alto</span>
                    <div className="relative flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#0b0b0b]">
                        <div className="flex items-center gap-3">
                            {copy.logo_alignment === 'left' && copy.logo_url && (
                                <img src={copy.logo_url} alt="" className="w-auto" style={{ height: Math.min(copy.logo_height_desktop || 1, 40) }} />
                            )}
                            <span className="text-[11px] tracking-wider text-white">ESPLORA</span>
                        </div>
                        {copy.logo_alignment === 'center' && copy.logo_url && (
                            <img src={copy.logo_url} alt="" className="absolute left-1/2 -translate-x-1/2 w-auto" style={{ height: Math.min(copy.logo_height_desktop || 1, 40) }} />
                        )}
                        <div className="flex items-center gap-3">
                            <span className="text-[11px] text-gray-400">IT / EN</span>
                            {copy.logo_alignment === 'right' && copy.logo_url && (
                                <img src={copy.logo_url} alt="" className="w-auto" style={{ height: Math.min(copy.logo_height_desktop || 1, 40) }} />
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* Widget di ogni pagina */}
            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Widget su ogni pagina</h3>
                <p className="text-[11px] text-theme-text-secondary mt-1 mb-2">
                    Spento = il visitatore non lo vede piu' su nessuna pagina. Il banner cookie non e'
                    qui: e' obbligatorio e resta sempre attivo.
                </p>
                <ToggleRow
                    label="Chat DR7 AI"
                    hint="Bottone rotondo in basso a destra e finestra di chat."
                    checked={copy.chatbot_enabled}
                    onChange={v => update('chatbot_enabled', v)}
                />
                <ToggleRow
                    label="Popup prenotazione automatico"
                    hint="Si apre da solo dopo qualche secondo di navigazione."
                    checked={copy.auto_booking_popup_enabled}
                    onChange={v => update('auto_booking_popup_enabled', v)}
                />
                <ToggleRow
                    label="Popup tour in elicottero"
                    hint="Promozione del tour in elicottero."
                    checked={copy.heli_tour_popup_enabled}
                    onChange={v => update('heli_tour_popup_enabled', v)}
                />
                {copy.chatbot_enabled && (
                    <div className="pt-4">
                        <FieldText
                            label="Immagine del bottone chat"
                            value={copy.chatbot_avatar_url}
                            onChange={v => update('chatbot_avatar_url', v)}
                        />
                    </div>
                )}
            </section>
        </div>
    )
}

// ─── Locations editor (airports / pickup / marinas / heli) ────────────────
// Operators add / remove / reorder items. IDs (left column) are referenced
// by stored bookings — change with care; renaming an id breaks history.
function LocationsEditor({ copy, setCopy }: { copy: LocationsCopy; setCopy: (next: LocationsCopy) => void }) {
    const updateAirport = (i: number, patch: Partial<AirportItem>) =>
        setCopy({ ...copy, airports: copy.airports.map((a, idx) => idx === i ? { ...a, ...patch } : a) })
    const addAirport = () =>
        setCopy({ ...copy, airports: [...copy.airports, { iata: '', name: '', city: '' }] })
    const removeAirport = (i: number) =>
        setCopy({ ...copy, airports: copy.airports.filter((_, idx) => idx !== i) })
    const moveAirport = (i: number, dir: -1 | 1) => {
        const next = [...copy.airports]; const j = i + dir
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        setCopy({ ...copy, airports: next })
    }

    const updateBilingual = (key: 'pickup_locations' | 'return_locations' | 'yacht_marinas', i: number, patch: Partial<BilingualLocationItem>) =>
        setCopy({ ...copy, [key]: copy[key].map((it, idx) => idx === i ? { ...it, ...patch } : it) })
    const addBilingual = (key: 'pickup_locations' | 'return_locations' | 'yacht_marinas') =>
        setCopy({ ...copy, [key]: [...copy[key], { id: '', label_it: '', label_en: '' }] })
    const removeBilingual = (key: 'pickup_locations' | 'return_locations' | 'yacht_marinas', i: number) =>
        setCopy({ ...copy, [key]: copy[key].filter((_, idx) => idx !== i) })
    const moveBilingual = (key: 'pickup_locations' | 'return_locations' | 'yacht_marinas', i: number, dir: -1 | 1) => {
        const next = [...copy[key]]; const j = i + dir
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        setCopy({ ...copy, [key]: next })
    }

    const updateSimple = (key: 'heli_departure_points' | 'heli_arrival_points', i: number, patch: Partial<SimpleLocationItem>) =>
        setCopy({ ...copy, [key]: copy[key].map((it, idx) => idx === i ? { ...it, ...patch } : it) })
    const addSimple = (key: 'heli_departure_points' | 'heli_arrival_points') =>
        setCopy({ ...copy, [key]: [...copy[key], { id: '', name: '' }] })
    const removeSimple = (key: 'heli_departure_points' | 'heli_arrival_points', i: number) =>
        setCopy({ ...copy, [key]: copy[key].filter((_, idx) => idx !== i) })
    const moveSimple = (key: 'heli_departure_points' | 'heli_arrival_points', i: number, dir: -1 | 1) => {
        const next = [...copy[key]]; const j = i + dir
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        setCopy({ ...copy, [key]: next })
    }

    const RowControls: React.FC<{ onUp: () => void; onDown: () => void; onRemove: () => void; first: boolean; last: boolean }> = ({ onUp, onDown, onRemove, first, last }) => (
        <div className="flex items-center gap-1">
            <button type="button" onClick={onUp} disabled={first} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button type="button" onClick={onDown} disabled={last} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giù">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button type="button" onClick={onRemove} className="w-7 h-7 rounded-md text-red-500 hover:bg-red-500/10 flex items-center justify-center" title="Rimuovi">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
        </div>
    )

    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Catalogo di aeroporti, luoghi di ritiro/riconsegna, marine yacht e punti elicottero usati dai form di
                prenotazione. Modifica nome / etichetta / città. Gli <code className="text-[11px] bg-theme-bg-tertiary px-1 rounded">id</code> sono referenziati
                dalle prenotazioni storiche — rinominare un id rompe la cronologia, meglio aggiungere voci nuove.
            </p>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">Aeroporti ({copy.airports.length})</h3>
                </div>
                {copy.airports.map((a, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input type="text" value={a.iata} onChange={e => updateAirport(i, { iata: e.target.value.toUpperCase() })} placeholder="IATA" className="col-span-2 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono uppercase" maxLength={3} />
                        <input type="text" value={a.name} onChange={e => updateAirport(i, { name: e.target.value })} placeholder="Nome aeroporto" className="col-span-5 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={a.city} onChange={e => updateAirport(i, { city: e.target.value })} placeholder="Città" className="col-span-3 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="col-span-2 flex justify-end">
                            <RowControls onUp={() => moveAirport(i, -1)} onDown={() => moveAirport(i, 1)} onRemove={() => removeAirport(i)} first={i === 0} last={i === copy.airports.length - 1} />
                        </div>
                    </div>
                ))}
                <button type="button" onClick={addAirport} className="w-full py-2 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">+ Aggiungi aeroporto</button>
            </section>

            {(['pickup_locations', 'return_locations', 'yacht_marinas'] as const).map(key => {
                const labels = { pickup_locations: 'Luoghi di ritiro', return_locations: 'Luoghi di riconsegna', yacht_marinas: 'Marine yacht' }
                return (
                    <section key={key} className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[14px] font-semibold text-theme-text-primary">{labels[key]} ({copy[key].length})</h3>
                        </div>
                        {copy[key].map((it, i) => (
                            <div key={i} className="grid grid-cols-12 gap-2 items-center">
                                <input type="text" value={it.id} onChange={e => updateBilingual(key, i, { id: e.target.value })} placeholder="id" className="col-span-2 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                                <input type="text" value={it.label_it} onChange={e => updateBilingual(key, i, { label_it: e.target.value })} placeholder="Etichetta IT" className="col-span-4 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                                <input type="text" value={it.label_en} onChange={e => updateBilingual(key, i, { label_en: e.target.value })} placeholder="Label EN" className="col-span-4 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                                <div className="col-span-2 flex justify-end">
                                    <RowControls onUp={() => moveBilingual(key, i, -1)} onDown={() => moveBilingual(key, i, 1)} onRemove={() => removeBilingual(key, i)} first={i === 0} last={i === copy[key].length - 1} />
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={() => addBilingual(key)} className="w-full py-2 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">+ Aggiungi voce</button>
                    </section>
                )
            })}

            {(['heli_departure_points', 'heli_arrival_points'] as const).map(key => {
                const labels = { heli_departure_points: 'Punti partenza elicottero', heli_arrival_points: 'Punti arrivo elicottero' }
                return (
                    <section key={key} className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[14px] font-semibold text-theme-text-primary">{labels[key]} ({copy[key].length})</h3>
                        </div>
                        {copy[key].map((it, i) => (
                            <div key={i} className="grid grid-cols-12 gap-2 items-center">
                                <input type="text" value={it.id} onChange={e => updateSimple(key, i, { id: e.target.value })} placeholder="id" className="col-span-3 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                                <input type="text" value={it.name} onChange={e => updateSimple(key, i, { name: e.target.value })} placeholder="Nome" className="col-span-7 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                                <div className="col-span-2 flex justify-end">
                                    <RowControls onUp={() => moveSimple(key, i, -1)} onDown={() => moveSimple(key, i, 1)} onRemove={() => removeSimple(key, i)} first={i === 0} last={i === copy[key].length - 1} />
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={() => addSimple(key)} className="w-full py-2 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">+ Aggiungi voce</button>
                    </section>
                )
            })}
        </div>
    )
}

// ─── DR7 Club piano (centralina_pro_config.site_copy.dr7ClubPlan) ──
// Editor minimo per nome bilingue, prezzi mensile/annuale e feature list.
// Stub generato per sbloccare il build; espandere quando arriva il design.
function Dr7ClubPlanEditor({ copy, setCopy }: { copy: Dr7ClubPlanCopy; setCopy: (next: Dr7ClubPlanCopy) => void }) {
    const set = (patch: Partial<Dr7ClubPlanCopy>) => setCopy({ ...copy, ...patch })
    const setFeatures = (lang: 'features_it' | 'features_en', value: string) => {
        const list = value.split('\n').map(s => s.trim()).filter(Boolean)
        set({ [lang]: list } as Partial<Dr7ClubPlanCopy>)
    }
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-theme-text-primary">DR7 Club — Piano</h3>
                <p className="text-sm text-theme-text-muted mt-1">Configura il piano DR7 Club mostrato sul sito (nome bilingue, prezzi, vantaggi).</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                    <span className="block text-xs text-theme-text-muted mb-1">Nome (IT)</span>
                    <input value={copy.name_it} onChange={(e) => set({ name_it: e.target.value })} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-full px-3 py-2 text-sm text-theme-text-primary"/>
                </label>
                <label className="block">
                    <span className="block text-xs text-theme-text-muted mb-1">Nome (EN)</span>
                    <input value={copy.name_en} onChange={(e) => set({ name_en: e.target.value })} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-full px-3 py-2 text-sm text-theme-text-primary"/>
                </label>
                <label className="block">
                    <span className="block text-xs text-theme-text-muted mb-1">Prezzo mensile (€)</span>
                    <input type="number" min="0" step="1" value={copy.monthly_eur} onChange={(e) => set({ monthly_eur: Number(e.target.value) || 0 })} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-full px-3 py-2 text-sm text-theme-text-primary"/>
                </label>
                <label className="block">
                    <span className="block text-xs text-theme-text-muted mb-1">Prezzo annuale (€)</span>
                    <input type="number" min="0" step="1" value={copy.annually_eur} onChange={(e) => set({ annually_eur: Number(e.target.value) || 0 })} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-full px-3 py-2 text-sm text-theme-text-primary"/>
                </label>
                <label className="block md:col-span-2">
                    <span className="block text-xs text-theme-text-muted mb-1">Vantaggi (IT) — uno per riga</span>
                    <textarea rows={6} value={copy.features_it.join('\n')} onChange={(e) => setFeatures('features_it', e.target.value)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-xl px-3 py-2 text-sm text-theme-text-primary"/>
                </label>
                <label className="block md:col-span-2">
                    <span className="block text-xs text-theme-text-muted mb-1">Vantaggi (EN) — uno per riga</span>
                    <textarea rows={6} value={copy.features_en.join('\n')} onChange={(e) => setFeatures('features_en', e.target.value)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-xl px-3 py-2 text-sm text-theme-text-primary"/>
                </label>
            </div>
        </div>
    )
}

// ─── Yacht / Jet / Heli editor (centralina_pro_config.site_copy.aviationMarine) ──
// Operators add/remove items in the three buckets. Spec icons + bilingual
// labels are resolved on the website by SPEC_REGISTRY (utils/getAviationFleet.ts),
// so admin only edits values here. Cars are NOT here — they live in Veicoli tab.
function AviationMarineEditor({ copy, setCopy }: { copy: AviationMarineCopy; setCopy: (next: AviationMarineCopy) => void }) {
    type BucketKey = 'yachts' | 'jets' | 'helis'
    const BUCKET_LABEL: Record<BucketKey, string> = { yachts: 'Yacht', jets: 'Jet', helis: 'Elicotteri' }
    const BUCKET_SPEC_KEYS: Record<BucketKey, AviationMarineSpecKey[]> = {
        yachts: ['guests', 'length', 'cabins'],
        jets: ['passengers', 'year', 'type'],
        helis: ['passengers', 'range', 'speed'],
    }

    const updateItem = (bucket: BucketKey, i: number, patch: Partial<AviationMarineItem>) =>
        setCopy({ ...copy, [bucket]: copy[bucket].map((it, idx) => idx === i ? { ...it, ...patch } : it) })

    const addItem = (bucket: BucketKey) => {
        const defaultSpecs: AviationMarineSpec[] = BUCKET_SPEC_KEYS[bucket].map(k => ({ key: k, value: '' }))
        const newId = `${bucket === 'helis' ? 'heli' : bucket.slice(0, -1)}-${copy[bucket].length + 1}`
        setCopy({ ...copy, [bucket]: [...copy[bucket], { id: newId, name: '', image: '', specs: defaultSpecs }] })
    }

    const removeItem = (bucket: BucketKey, i: number) =>
        setCopy({ ...copy, [bucket]: copy[bucket].filter((_, idx) => idx !== i) })

    const moveItem = (bucket: BucketKey, i: number, dir: -1 | 1) => {
        const next = [...copy[bucket]]; const j = i + dir
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        setCopy({ ...copy, [bucket]: next })
    }

    const updateSpecValue = (bucket: BucketKey, i: number, specKey: AviationMarineSpecKey, value: string) => {
        const item = copy[bucket][i]
        const existing = item.specs.find(s => s.key === specKey)
        const nextSpecs = existing
            ? item.specs.map(s => s.key === specKey ? { ...s, value } : s)
            : [...item.specs, { key: specKey, value }]
        updateItem(bucket, i, { specs: nextSpecs })
    }

    const updateImagesText = (bucket: BucketKey, i: number, text: string) => {
        const list = text.split(/\n+/).map(s => s.trim()).filter(Boolean)
        updateItem(bucket, i, { images: list.length > 0 ? list : undefined })
    }

    const renderBucket = (bucket: BucketKey) => {
        const items = copy[bucket]
        const specKeys = BUCKET_SPEC_KEYS[bucket]
        return (
            <section key={bucket} className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">{BUCKET_LABEL[bucket]} ({items.length})</h3>
                </div>
                {items.map((it, i) => (
                    <div key={i} className="border border-theme-border rounded-xl p-4 space-y-3 bg-theme-bg-secondary">
                        <div className="grid grid-cols-12 gap-2">
                            <input type="text" value={it.id} onChange={e => updateItem(bucket, i, { id: e.target.value })} placeholder="id" className="col-span-3 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                            <input type="text" value={it.name} onChange={e => updateItem(bucket, i, { name: e.target.value })} placeholder="Nome / Modello" className="col-span-7 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                            <div className="col-span-2 flex justify-end items-center gap-1">
                                <button type="button" onClick={() => moveItem(bucket, i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-primary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button type="button" onClick={() => moveItem(bucket, i, 1)} disabled={i === items.length - 1} className="w-7 h-7 rounded-md text-theme-text-secondary hover:bg-theme-bg-primary disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                <button type="button" onClick={() => removeItem(bucket, i)} className="w-7 h-7 rounded-md text-red-500 hover:bg-red-500/10 flex items-center justify-center" title="Rimuovi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                            </div>
                        </div>
                        <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-6">
                                <label className="block text-[11px] font-medium text-theme-text-secondary mb-1">Immagine principale (URL o /percorso)</label>
                                <input type="text" value={it.image} onChange={e => updateItem(bucket, i, { image: e.target.value })} placeholder="/yacht1.jpeg" className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                            </div>
                            <div className="col-span-6">
                                <label className="block text-[11px] font-medium text-theme-text-secondary mb-1">Galleria (un percorso per riga, facoltativo)</label>
                                <textarea value={(it.images || []).join('\n')} onChange={e => updateImagesText(bucket, i, e.target.value)} placeholder={'/img1.jpeg\n/img2.jpeg'} rows={2} className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] font-mono" />
                            </div>
                        </div>
                        {bucket === 'yachts' && (
                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-4">
                                    <label className="block text-[11px] font-medium text-theme-text-secondary mb-1">Prezzo al giorno (€)</label>
                                    <input type="number" min={0} value={it.price_per_day_eur ?? ''} onChange={e => updateItem(bucket, i, { price_per_day_eur: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="es. 11000" className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                                </div>
                            </div>
                        )}
                        {(bucket === 'jets' || bucket === 'helis') && (
                            <div className="grid grid-cols-12 gap-2">
                                <label className="col-span-6 flex items-center gap-2 text-[12px] text-theme-text-primary">
                                    <input type="checkbox" checked={!!it.pets_allowed} onChange={e => updateItem(bucket, i, { pets_allowed: e.target.checked })} />
                                    Animali ammessi
                                </label>
                                <label className="col-span-6 flex items-center gap-2 text-[12px] text-theme-text-primary">
                                    <input type="checkbox" checked={!!it.smoking_allowed} onChange={e => updateItem(bucket, i, { smoking_allowed: e.target.checked })} />
                                    Fumatori ammessi
                                </label>
                            </div>
                        )}
                        <div className="grid grid-cols-12 gap-2">
                            {specKeys.map(specKey => {
                                const spec = it.specs.find(s => s.key === specKey)
                                return (
                                    <div key={specKey} className="col-span-4">
                                        <label className="block text-[11px] font-medium text-theme-text-secondary mb-1">{SPEC_KEY_LABEL[specKey]}</label>
                                        <input type="text" value={spec?.value || ''} onChange={e => updateSpecValue(bucket, i, specKey, e.target.value)} placeholder="es. 4 oppure 70m" className="w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px]" />
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
                <button type="button" onClick={() => addItem(bucket)} className="w-full py-2 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors">+ Aggiungi {BUCKET_LABEL[bucket].toLowerCase()}</button>
            </section>
        )
    }

    return (
        <div className="space-y-6">
            <p className="text-[13px] text-theme-text-secondary">
                Catalogo della flotta Yacht / Jet / Elicotteri mostrato sul sito pubblico. Le auto stanno nel tab
                <code className="text-[11px] bg-theme-bg-tertiary px-1 rounded mx-1">Veicoli</code> (database operativo), qui solo aviation &amp; marine.
                Le icone delle specifiche e le etichette IT/EN sono fisse nel codice — qui editi solo i valori.
            </p>
            {renderBucket('yachts')}
            {renderBucket('jets')}
            {renderBucket('helis')}
        </div>
    )
}

