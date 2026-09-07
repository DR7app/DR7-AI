/**
 * sitoSiteMap.ts — l'alberatura REALE di dr7.app.
 *
 * L'onglet Sito era organizzato per categorie inventate ("Pagine
 * pubbliche", "Chrome sito"): non corrispondevano a niente di visibile e
 * meta' del sito non compariva affatto. Qui invece ogni voce e' una
 * schermata che esiste davvero su dr7.app, con la sua URL, nell'ordine in
 * cui il visitatore la incontra (menu ESPLORA in testa, come nel sito).
 *
 * Fonte: Sito/App.tsx (route) + Sito/components/layout/Header.tsx (menu).
 * Quando si aggiunge una pagina al sito, si aggiunge una voce qui.
 *
 * Dal 07/09/2026 nessuna pagina resta "nel codice": chi non ha un editor
 * tipizzato usa `editor: 'testi'`, l'editor generico che elenca le frasi
 * della pagina (catalogo generato con `npm run testi:gen`) e le fa
 * riscrivere una per una. `editor: null` resta possibile solo per una
 * schermata che non mostra testo proprio.
 */

export type SitoAreaId =
    | 'struttura'
    | 'home'
    | 'mobilita'
    | 'mare'
    | 'aria'
    | 'proprieta'
    | 'servizi'
    | 'wallet'
    | 'club'
    | 'business'
    | 'digitale'
    | 'azienda'
    | 'prenotazione'
    | 'account'
    | 'partner'
    | 'accesso'
    | 'legale'

export interface SitoArea {
    id: SitoAreaId
    label: string
    /** Cosa raggruppa, mostrato come tooltip e in testa alla sezione. */
    description: string
}

export interface SitoScreen {
    /** Chiave stabile della schermata (usata nella navigazione). */
    id: string
    /** URL reale su dr7.app. `:param` = segmento dinamico. */
    path: string
    /** Nome della schermata come la chiama chi lavora in DR7. */
    label: string
    area: SitoAreaId
    /**
     * Id della sezione-editor che la gestisce, oppure null se i testi
     * vivono ancora nel codice. Piu' schermate possono puntare allo
     * stesso editor (es. i tre preventivi Aviation).
     */
    editor: string | null
    /** File del repo Sito che contiene la pagina (per chi deve intervenire). */
    file: string
    /** Precisazione utile all'operatore. */
    note?: string
}

export const SITO_AREAS: SitoArea[] = [
    { id: 'struttura',    label: 'Struttura del sito',   description: 'Menu, footer e popup di ricerca: compaiono su ogni pagina.' },
    { id: 'home',         label: 'Home',                 description: 'La prima pagina di dr7.app.' },
    { id: 'mobilita',     label: 'Mobilita',             description: 'Prima voce del menu ESPLORA: flotta e noleggio auto.' },
    { id: 'mare',         label: 'Mare',                 description: 'Yacht e imbarcazioni.' },
    { id: 'aria',         label: 'Aria',                 description: 'Elicotteri, jet privati e richieste di preventivo.' },
    { id: 'proprieta',    label: 'Proprieta',            description: 'Ville, appartamenti e soggiorni.' },
    { id: 'servizi',      label: 'Lavaggio & Meccanica', description: 'Vetrina servizi e relative prenotazioni.' },
    { id: 'wallet',       label: 'Credit Wallet',        description: 'Pagina del credito DR7.' },
    { id: 'club',         label: 'DR7 Club',             description: 'Membership e iscrizione.' },
    { id: 'business',     label: 'Business',             description: 'Franchising e investitori.' },
    { id: 'digitale',     label: 'Innovazione Digitale', description: 'DR7 Token.' },
    { id: 'azienda',      label: 'Azienda',              description: 'Chi siamo, stampa, lavora con noi, FAQ, contatti.' },
    { id: 'prenotazione', label: 'Prenotazione & Pagamento', description: 'Dal form di prenotazione fino alla conferma.' },
    { id: 'account',      label: 'Account cliente',      description: 'Area riservata del cliente dopo il login.' },
    { id: 'partner',      label: 'Area Partner',         description: 'Area riservata ai partner che pubblicano annunci.' },
    { id: 'accesso',      label: 'Accesso & Registrazione', description: 'Login, registrazione, inviti e firma contratto.' },
    { id: 'legale',       label: 'Legale',               description: 'Termini, privacy, cookie, cancellazione.' },
]

export const SITO_SCREENS: SitoScreen[] = [
    // ─── Struttura ───────────────────────────────────────────────────────
    { id: 'aspetto',           path: '(ogni pagina)',            label: 'Aspetto & Funzionalita',   area: 'struttura', editor: 'aspetto',           file: 'components/layout/Header.tsx', note: 'Posizione e dimensione del logo, e i widget presenti su ogni pagina (chat AI, popup).' },
    { id: 'header',            path: '(ogni pagina)',            label: 'Menu ESPLORA / Header',    area: 'struttura', editor: 'header',            file: 'components/layout/Header.tsx' },
    { id: 'footer',            path: '(ogni pagina)',            label: 'Footer',                   area: 'struttura', editor: 'footer',            file: 'components/layout/Footer.tsx' },
    { id: 'booking-search-box',path: '(ogni pagina)',            label: 'Popup "Prenota Ora"',      area: 'struttura', editor: 'booking-search-box',file: 'components/ui/BookingSearchBox.tsx' },
    { id: 'locations',         path: '(ogni pagina)',            label: 'Aeroporti, porti e luoghi',area: 'struttura', editor: 'locations',         file: 'utils/getLocations.ts', note: 'Elenco luoghi usato dai form di prenotazione.' },
    { id: 'testi-condivisi',   path: '(ogni pagina)',            label: 'Testi condivisi',          area: 'struttura', editor: 'testi',             file: '(vari)', note: 'Le frasi dei modali e dei wizard, che compaiono su piu\' pagine e non appartengono a una sola.' },

    // ─── Home ────────────────────────────────────────────────────────────
    { id: 'hero',              path: '/',                        label: 'Home',                     area: 'home',      editor: 'hero',              file: 'pages/HomePage.tsx', note: 'Slide del hero + titoli e immagini delle card.' },
    { id: 'reviews',           path: '/',                        label: 'Recensioni in home',       area: 'home',      editor: 'testi',             file: 'sections/ReviewsSection.tsx', note: 'Le recensioni arrivano da Google, non si scrivono da qui: la sezione non ha testo proprio.' },

    // ─── Mobilita ────────────────────────────────────────────────────────
    { id: 'flotta',            path: '/flotta',                  label: 'Flotta (indice categorie)',area: 'mobilita',  editor: 'flotta',            file: 'pages/FlottaIndexPage.tsx', note: 'L\'editor decide quali categorie sono visibili; i testi della pagina sono nel codice.' },
    { id: 'supercar-luxury',   path: '/supercar-luxury',         label: 'Supercar & Luxury',        area: 'mobilita',  editor: 'testi',                file: 'pages/RentalPage.tsx' },
    { id: 'corporate-fleet',   path: '/corporate-fleet',         label: 'Corporate Fleet',          area: 'mobilita',  editor: 'testi',                file: 'pages/RentalPage.tsx' },
    { id: 'categorie-dinamiche',path: '/<categoria>',            label: 'Categorie da Centralina',  area: 'mobilita',  editor: 'testi',                file: 'pages/RentalPage.tsx', note: 'Ogni categoria creata in Veicoli > Categorie apre una pagina propria.' },

    // ─── Mare ────────────────────────────────────────────────────────────
    { id: 'noleggio-mare',     path: '/noleggio-mare',           label: 'Noleggio Mare',            area: 'mare',      editor: 'testi',                file: 'App.tsx', note: 'Titolo e sottotitolo sono scritti nella route, non ancora nel CMS.' },
    { id: 'yachts',            path: '/yachts',                  label: 'Yacht',                    area: 'mare',      editor: 'yacht-jet-heli',    file: 'pages/RentalPage.tsx' },

    // ─── Aria ────────────────────────────────────────────────────────────
    { id: 'noleggio-aria',     path: '/noleggio-aria',           label: 'Noleggio Aria',            area: 'aria',      editor: 'testi',                file: 'App.tsx', note: 'Titolo e sottotitolo sono scritti nella route, non ancora nel CMS.' },
    { id: 'jets',              path: '/jets',                    label: 'Jet privati',              area: 'aria',      editor: 'yacht-jet-heli',    file: 'pages/RentalPage.tsx' },
    { id: 'jet-search',        path: '/jets/search',             label: 'Risultati ricerca jet',    area: 'aria',      editor: 'jet-search',        file: 'pages/JetSearchResultsPage.tsx' },
    { id: 'aviation',          path: '/aviation-quote',          label: 'Richiesta preventivo volo',area: 'aria',      editor: 'aviation',          file: 'pages/AviationQuoteRequestPage.tsx', note: 'Stessa pagina anche su /jets/quote e /helicopters/quote.' },

    // ─── Proprieta ───────────────────────────────────────────────────────
    { id: 'soggiorni',         path: '/soggiorni',               label: 'Soggiorni & Ospitalita',   area: 'proprieta', editor: 'testi',                file: 'App.tsx', note: 'Titolo e sottotitolo sono scritti nella route, non ancora nel CMS.' },

    // ─── Lavaggio & Meccanica ────────────────────────────────────────────
    { id: 'lavaggio',          path: '/prime-wash',              label: 'Vetrina Lavaggio',         area: 'servizi',   editor: 'lavaggio',          file: 'pages/CarWashServicesPage.tsx', note: 'Il listino servizi si modifica in Catalogo Lavaggio & Meccanica.' },
    { id: 'car-wash-booking',  path: '/car-wash-booking',        label: 'Prenotazione lavaggio',    area: 'servizi',   editor: 'testi',                file: 'pages/CarWashBookingPage.tsx' },
    { id: 'meccanica',         path: '/mechanical-services',     label: 'Vetrina Meccanica',        area: 'servizi',   editor: 'meccanica',         file: 'pages/MechanicalServicesPage.tsx' },
    { id: 'mechanical-booking',path: '/mechanical-booking',      label: 'Prenotazione meccanica',   area: 'servizi',   editor: 'testi',                file: 'pages/MechanicalBookingPage.tsx' },

    // ─── Credit Wallet ───────────────────────────────────────────────────
    { id: 'credit-wallet',     path: '/credit-wallet',           label: 'Credit Wallet',            area: 'wallet',    editor: 'credit-wallet',     file: 'pages/CreditWalletPage.tsx' },

    // ─── DR7 Club ────────────────────────────────────────────────────────
    { id: 'membership',        path: '/membership',              label: 'DR7 Club',                 area: 'club',      editor: 'membership',        file: 'pages/MembershipPage.tsx' },
    { id: 'dr7-club-plan',     path: '/membership',              label: 'Piano e benefit del Club', area: 'club',      editor: 'dr7-club-plan',     file: 'utils/getMembershipTiers.ts' },
    { id: 'membership-privilege', path: '/membership#privilege', label: 'DR7 Club Privilege',     area: 'club',      editor: 'membership',        file: 'pages/MembershipPage.tsx' },
    { id: 'membership-enroll', path: '/membership/enroll/:tier', label: 'Iscrizione al Club',       area: 'club',      editor: 'testi',                file: 'pages/MembershipEnrollmentPage.tsx' },

    // ─── Business ────────────────────────────────────────────────────────
    { id: 'franchising',       path: '/franchising',             label: 'Franchising',              area: 'business',  editor: 'franchising',       file: 'pages/FranchisingPage.tsx' },
    { id: 'investitori',       path: '/investitori',             label: 'Investitori',              area: 'business',  editor: 'investitori',       file: 'pages/InvestitoriPage.tsx' },

    // ─── Innovazione Digitale ────────────────────────────────────────────
    { id: 'token',             path: '/token',                   label: 'DR7 Token',                area: 'digitale',  editor: 'token',             file: 'pages/TokenPage.tsx' },

    // ─── Azienda ─────────────────────────────────────────────────────────
    { id: 'chi-siamo',         path: '/about',                   label: 'Chi Siamo',                area: 'azienda',   editor: 'chi-siamo',         file: 'pages/AboutPage.tsx' },
    { id: 'press',            path: '/press',                    label: 'Stampa & Media',           area: 'azienda',   editor: 'press',             file: 'pages/PressPage.tsx' },
    { id: 'post',              path: '/post/:id',                label: 'Articolo stampa',          area: 'azienda',   editor: 'testi',                file: 'pages/PostPage.tsx' },
    { id: 'careers',           path: '/careers',                 label: 'Lavora con Noi',           area: 'azienda',   editor: 'careers',           file: 'pages/CareersPage.tsx' },
    { id: 'faq',               path: '/faq',                     label: 'FAQ',                      area: 'azienda',   editor: 'faq',               file: 'pages/FAQPage.tsx' },
    { id: 'contatti',          path: '/contact',                 label: 'Contatti',                 area: 'azienda',   editor: 'contatti',          file: 'pages/ContactPage.tsx' },

    // ─── Prenotazione & Pagamento ────────────────────────────────────────
    { id: 'booking',           path: '/book/:categoria/:id',     label: 'Form di prenotazione',     area: 'prenotazione', editor: 'booking',        file: 'pages/BookingPage.tsx' },
    { id: 'pagamento',         path: '/pay',                     label: 'Pagina di pagamento',      area: 'prenotazione', editor: 'pagamento',      file: 'pages/PaymentPage.tsx' },
    { id: 'payment-success',   path: '/payment-success',         label: 'Pagamento riuscito',       area: 'prenotazione', editor: 'payment-success',file: 'pages/PaymentSuccessPage.tsx' },
    { id: 'payment-cancel',    path: '/payment-cancel',          label: 'Pagamento annullato',      area: 'prenotazione', editor: 'payment-cancel', file: 'pages/PaymentCancelPage.tsx' },
    { id: 'confirmation',      path: '/confirmation-success',    label: 'Conferma prenotazione',    area: 'prenotazione', editor: 'confirmation',   file: 'pages/ConfirmationSuccessPage.tsx', note: 'Stessa pagina anche su /booking-success.' },
    { id: 'car-booking-success',path: '/car-booking-success',    label: 'Conferma noleggio auto',   area: 'prenotazione', editor: 'testi',             file: 'components/ui/CarBookingConfirmationPage.tsx' },

    // ─── Account cliente ─────────────────────────────────────────────────
    { id: 'account-profilo',   path: '/account/profile',         label: 'Il mio profilo',           area: 'account',   editor: 'testi',                file: 'pages/account/ProfileSettings.tsx' },
    { id: 'account-sicurezza', path: '/account/security',        label: 'Sicurezza',                area: 'account',   editor: 'testi',                file: 'pages/account/SecuritySettings.tsx' },
    { id: 'account-documenti', path: '/account/documents',       label: 'Documenti',                area: 'account',   editor: 'testi',                file: 'pages/account/DocumentsVerification.tsx' },
    { id: 'account-club',      path: '/account/club',            label: 'Il mio DR7 Club',          area: 'account',   editor: 'testi',                file: 'pages/account/DR7Club.tsx' },
    { id: 'account-membership',path: '/account/membership',      label: 'Stato membership',         area: 'account',   editor: 'testi',                file: 'pages/account/MembershipStatus.tsx' },
    { id: 'account-prenotazioni',path: '/account/bookings',      label: 'Le mie prenotazioni',      area: 'account',   editor: 'testi',                file: 'pages/account/MyBookings.tsx' },
    { id: 'account-preventivi',path: '/account/preventivi',      label: 'I miei preventivi',        area: 'account',   editor: 'testi',                file: 'pages/account/MyPreventivi.tsx' },
    { id: 'account-referral',  path: '/account/referral',        label: 'Programma referral',       area: 'account',   editor: 'testi',                file: 'pages/account/ReferralProgram.tsx' },
    { id: 'account-notifiche', path: '/account/notifications',   label: 'Notifiche',                area: 'account',   editor: 'testi',                file: 'pages/account/NotificationSettings.tsx' },

    // ─── Area Partner ────────────────────────────────────────────────────
    { id: 'partner-dashboard', path: '/partner/dashboard',       label: 'Dashboard partner',        area: 'partner',   editor: 'testi',                file: 'pages/partner/PartnerDashboardPage.tsx' },
    { id: 'partner-annuncio',  path: '/partner/listings/new',    label: 'Nuovo annuncio',           area: 'partner',   editor: 'testi',                file: 'pages/partner/CreateListingPage.tsx' },
    { id: 'partner-verifica',  path: '/partner/verification',    label: 'Verifica partner',         area: 'partner',   editor: 'testi',                file: 'pages/partner/PartnerVerificationPage.tsx' },
    { id: 'partner-impostazioni',path: '/partner/settings/*',    label: 'Impostazioni partner',     area: 'partner',   editor: 'testi',                file: 'pages/partner/', note: 'Profilo, sicurezza, notifiche e pagamenti.' },

    // ─── Accesso & Registrazione ─────────────────────────────────────────
    { id: 'signin',            path: '/signin',                  label: 'Accedi',                   area: 'accesso',   editor: 'testi',                file: 'pages/AuthPage.tsx' },
    { id: 'signup',            path: '/signup',                  label: 'Registrazione account',    area: 'accesso',   editor: 'signup',            file: 'pages/SignUpPage.tsx' },
    { id: 'check-email',       path: '/check-email',             label: 'Controlla la tua email',   area: 'accesso',   editor: 'check-email',       file: 'pages/CheckEmailPage.tsx' },
    { id: 'password',          path: '/forgot-password',         label: 'Password dimenticata',     area: 'accesso',   editor: 'testi',                file: 'pages/ForgotPasswordPage.tsx', note: 'Include anche /reset-password.' },
    { id: 'auth-verify',       path: '/auth/v1/verify',          label: 'Verifica email',           area: 'accesso',   editor: 'testi',                file: 'pages/AuthVerifyPage.tsx' },
    { id: 'registrazione-cliente',path: '/registrazione-cliente/:token', label: 'Scheda cliente su invito', area: 'accesso', editor: 'registrazione-cliente', file: 'pages/RegistrazioneClientePage.tsx' },
    { id: 'firma',             path: '/firma/:token',            label: 'Firma contratto',          area: 'accesso',   editor: 'firma',             file: 'pages/FirmaPage.tsx' },

    // ─── Legale ──────────────────────────────────────────────────────────
    { id: 'legali',            path: '/terms',                   label: 'Termini, Privacy, Cookie', area: 'legale',    editor: 'legali',            file: 'pages/TermsOfServicePage.tsx', note: 'Un solo editor per /terms, /privacy e /cookie-policy.' },
    { id: 'cancellazione',     path: '/cancellation-policy',     label: 'Politica di cancellazione',area: 'legale',    editor: 'cancellazione',     file: 'pages/CancellationPolicyPage.tsx' },
    { id: 'rental-agreement',  path: '/rental-agreement',        label: 'Condizioni di noleggio',   area: 'legale',    editor: 'testi',                file: 'pages/RentalAgreementPage.tsx' },
]

/** URL pubblica della schermata, o null per le voci senza pagina propria. */
export function publicUrl(screen: SitoScreen): string | null {
    if (!screen.path.startsWith('/')) return null
    if (screen.path.includes(':') || screen.path.includes('*') || screen.path.includes('<')) return null
    return `https://dr7.app${screen.path}`
}

export const SCREENS_BY_AREA = SITO_AREAS.map(area => ({
    area,
    screens: SITO_SCREENS.filter(s => s.area === area.id),
}))

export const MANAGED_COUNT = SITO_SCREENS.filter(s => s.editor).length
export const TOTAL_COUNT = SITO_SCREENS.length
