import { useState, useEffect, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
import { useTheme, PALETTES, type Palette } from '../../contexts/ThemeContext'
import RentalTabs from './components/RentalTabs'
import ImmondiziaTab from './components/ImmondiziaTab'
import TicketTab from './components/TicketTab'
import MovimentiAereiTab from './components/MovimentiAereiTab'
import { useBirthdayCount } from './components/BirthdaysTab'
import { useFatturaScartataCount } from './components/FatturaTab'
import PlaceholderTab from './components/PlaceholderTab'
import AlarmInventoryModal from '../../components/admin/AlarmInventoryModal'
import MyDayEditorModal from './components/MyDayEditorModal'
import { useAdminRole } from '../../hooks/useAdminRole'
import { clearAdminCache } from '../../utils/logAdminAction'
import lazyWithRetry from '../../utils/lazyWithRetry'
import SedePicker from '../../components/SedePicker'

// Lazy-load all tabs with automatic retry on chunk load failure (post-deploy resilience)
const CustomersTab = lazyWithRetry(() => import('./components/CustomersTab'))
const CustomerWalletTab = lazyWithRetry(() => import('./components/CustomerWalletTab'))
const SiteUsersTab = lazyWithRetry(() => import('./components/SiteUsersTab'))
const VehiclesTab = lazyWithRetry(() => import('./components/VehiclesTab'))
const FornitoriTab = lazyWithRetry(() => import('./components/FornitoriTab'))
const CalendarTab = lazyWithRetry(() => import('./components/CalendarTab'))
const CarWashBookingsTab = lazyWithRetry(() => import('./components/CarWashBookingsTab'))
const CarWashCalendarTab = lazyWithRetry(() => import('./components/CarWashCalendarTab'))
const UnpaidBookingsTab = lazyWithRetry(() => import('./components/UnpaidBookingsTab'))
const MessaggiSistemaProTab = lazyWithRetry(() => import('./components/MessaggiSistemaProTab'))
const CampagnaMarketingTab = lazyWithRetry(() => import('./components/CampagnaMarketingTab'))
const SocialLinksTab = lazyWithRetry(() => import('./components/SocialLinksTab'))
const ReviewManagementTab = lazyWithRetry(() => import('./components/ReviewManagementTab'))
const FatturaTab = lazyWithRetry(() => import('./components/FatturaTab'))
const ContrattoTab = lazyWithRetry(() => import('./components/ContrattoTab'))
const GestioneMulteTab = lazyWithRetry(() => import('./components/GestioneMulteTab'))
const CauzioniTab = lazyWithRetry(() => import('./components/CauzioniTab'))
const NexiTab = lazyWithRetry(() => import('./components/NexiTab'))
const BirthdaysTab = lazyWithRetry(() => import('./components/BirthdaysTab'))
// FleetManagementTab rimosso 2026-05-22: la tab "Gestione Flotta" e'
// stata eliminata perche' duplicato di "Veicoli".
const FleetInventory = lazyWithRetry(() => import('./components/FleetInventory'))
const ScadenzeTab = lazyWithRetry(() => import('./components/ScadenzeTab'))
const ReportsTab = lazyWithRetry(() => import('./components/ReportsTab'))
const ReportLavaggioTab = lazyWithRetry(() => import('./components/ReportLavaggioTab'))
const ReportClientiTab = lazyWithRetry(() => import('./components/ReportClientiTab'))
const ReportAutistiTab = lazyWithRetry(() => import('./components/ReportAutistiTab'))
const ReportTrafficTab = lazyWithRetry(() => import('./components/ReportTrafficTab'))
const ReportGoogleBusinessTab = lazyWithRetry(() => import('./components/ReportGoogleBusinessTab'))
const ReportPenaliDanniTab = lazyWithRetry(() => import('./components/ReportPenaliDanniTab'))
const ReferralProgramTab = lazyWithRetry(() => import('./components/ReferralProgramTab'))
const CodiciScontoTab = lazyWithRetry(() => import('./components/CodiciScontoTab'))
const GestioneDanniTab = lazyWithRetry(() => import('./components/GestioneDanniTab'))
const CargosTab = lazyWithRetry(() => import('./components/CargosTab'))
const TrusteraTab = lazyWithRetry(() => import('./components/TrusteraTab'))
const CarWashCatalogTab = lazyWithRetry(() => import('./components/CarWashCatalogTab'))
const NoleggioServiceTab = lazyWithRetry(() => import('./components/NoleggioServiceTab'))
const OperatoriTab = lazyWithRetry(() => import('./components/OperatoriTab'))
const RilevazioneOrariTab = lazyWithRetry(() => import('./components/RilevazioneOrariTab'))
const DashboardTab = lazyWithRetry(() => import('./components/DashboardTab'))
// RevenuePricingTab removed — replaced by CentralinaProTab
const ReportPreventiviTab = lazyWithRetry(() => import('./components/ReportPreventiviTab'))
const CentralinaProTab = lazyWithRetry(() => import('./components/CentralinaProTab'))
const SitoTab = lazyWithRetry(() => import('./components/SitoTab'))
const GestioneOtpTab = lazyWithRetry(() => import('./components/GestioneOtpTab'))
const DocumentsVerificationTab = lazyWithRetry(() => import('./components/DocumentsVerificationTab'))
const EMTNTab = lazyWithRetry(() => import('./components/EMTNTab'))
const GpsKeylessTab = lazyWithRetry(() => import('./components/GpsKeylessTab'))

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold"></div>
  </div>
)

type TabType = 'reservations' | 'report-preventivi' | 'customers' | 'vehicles' | 'calendar' | 'cauzioni' | 'carwash' | 'carwash-calendar' | 'carwash-catalog' |'fattura' | 'contratto' | 'unpaid' | 'marketing-pro' | 'campagna-marketing' | 'social-links' | 'reviews' | 'magazzino' | 'scanner' | 'nexi' | 'birthdays' | 'scadenze' | 'reports' | 'bulk-import' | 'referral' | 'gestione-danni' | 'gestione-multe' | 'gps-keyless' | 'codice-sconto' | 'report-noleggio' | 'report-lavaggio' | 'report-clienti' | 'report-autisti' | 'report-penali-danni' | 'customer-wallet' | 'cargos' | 'trustera' | 'emtn' | 'operatori' | 'rilevazione-orari' | 'dashboard-kpi' | 'revenue-pricing' | 'site-users' | 'centralina-pro' | 'gestione-otp' | 'verifica-documenti' | 'fornitori' | 'report-traffic' | 'report-gmb' | 'sito' | 'mare-bookings' | 'mare-calendar' | 'mare-catalog' | 'mare-tours' | 'mare-preventivi' | 'aria-bookings' | 'aria-calendar' | 'aria-catalog' | 'aria-tours' | 'aria-preventivi' | 'aria-movimenti' | 'stay-bookings' | 'stay-calendar' | 'stay-catalog' | 'stay-tours' | 'stay-preventivi' | 'immondizia' | 'ticket'

export default function AdminDashboard() {
  // Persist the active tab to sessionStorage so a chunk-load failure
  // (which triggers window.location.reload() in lazyWithRetry) does not
  // dump the user back to 'reservations'. After the reload the saved tab
  // is read here and rendered transparently.
  const ACTIVE_TAB_KEY = 'dr7_admin_active_tab'
  const readSavedTab = (): TabType => {
    // Override via query string: dopo un OAuth callback (?ga_oauth=connected
    // o ?ga_oauth_error=...) forziamo la tab Rendimento Sito altrimenti
    // l'utente atterra sulla tab default e non vede l'esito.
    try {
      const qs = new URLSearchParams(window.location.search)
      if (qs.get('ga_oauth') === 'connected' || qs.get('ga_oauth_error')) {
        return 'report-traffic' as TabType
      }
    } catch { /* ignore */ }
    try {
      const saved = sessionStorage.getItem(ACTIVE_TAB_KEY)
      if (saved) return saved as TabType
    } catch { /* sessionStorage may be blocked */ }
    return 'reservations'
  }
  const [activeTab, _setActiveTab] = useState<TabType>(readSavedTab)
  const [tabHistory, setTabHistory] = useState<TabType[]>([])
  const setActiveTab = (tab: TabType) => {
    setTabHistory(prev => [...prev.slice(-19), activeTab])
    _setActiveTab(tab)
    try { sessionStorage.setItem(ACTIVE_TAB_KEY, tab) } catch { /* ignore */ }
  }
  const goBack = () => {
    if (tabHistory.length > 0) {
      const prev = tabHistory[tabHistory.length - 1]
      setTabHistory(h => h.slice(0, -1))
      _setActiveTab(prev)
    }
  }

  // Allow any child (e.g. DashboardTab cards) to switch tab without
  // prop-drilling, via a window CustomEvent.
  useEffect(() => {
    function handleNav(e: Event) {
      const detail = (e as CustomEvent<{ tab: string }>).detail
      if (detail?.tab) setActiveTab(detail.tab as TabType)
    }
    window.addEventListener('admin:navigate-tab', handleNav)
    return () => window.removeEventListener('admin:navigate-tab', handleNav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showAlarmInventory, setShowAlarmInventory] = useState(false)
  const [showMyOrari, setShowMyOrari] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  // State to pass data from Calendar to Reservations tab
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [initialReservationData, setInitialReservationData] = useState<{ vehicleId?: string, pickupDate?: Date, bookingId?: string, fromPreventivo?: Record<string, any> } | null>(null)
  // State to pass data from Car Wash Calendar to Car Wash Bookings tab
  const [initialCarWashData, setInitialCarWashData] = useState<{ appointmentDate?: string, appointmentTime?: string } | null>(null)

  const navigate = useNavigate()
  const { alarmState, enableAudio } = useVehicleAlarm()
  const birthdayCount = useBirthdayCount()
  const scartataCount = useFatturaScartataCount()
  const { role: adminRole, hasPermission, adminName, adminEmail, adminAvatar, permissions, loading: roleLoading } = useAdminRole()
  // 2026-05-19: isElevated rimosso (era declared but never read). Quando
  // serve in futuro, riaggiungerlo qui basato su:
  // adminRole === 'superadmin' || hasRole('direzione') || hasRole('developer')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { theme, toggleTheme, palette, setPalette } = useTheme()
  const [paletteMenuOpen, setPaletteMenuOpen] = useState(false)

  // Permission gate: a tab is restricted iff the operator's permissions[]
  // doesn't include it (and isn't '*' / direzione / superadmin).
  // useAdminRole.hasPermission encapsulates that logic and stays optimistic
  // while loading so we don't flash "Accesso non autorizzato" on mount.
  const isTabRestricted = (tab: TabType) => !hasPermission(tab)

  // 2026-05-22: dopo il caricamento di useAdminRole, se l'activeTab
  // (default 'reservations' o quello salvato in sessionStorage) non e'
  // accessibile a questo operatore, redirigi alla PRIMA tab autorizzata.
  // Cosi' un utente con solo carwash + customers non atterra mai sulla
  // pagina Noleggio "vuota".
  useEffect(() => {
    if (roleLoading) return
    if (hasPermission(activeTab)) return
    // Trova la prima tab nel menu per cui l'operatore ha permesso.
    for (const s of SECTIONS) {
      for (const t of s.tabs) {
        if (t.superadminOnly && adminRole !== 'superadmin') continue
        if (hasPermission(t.permKey || t.tab)) {
          _setActiveTab(t.tab)
          try { sessionStorage.setItem(ACTIVE_TAB_KEY, t.tab) } catch { /* ignore */ }
          return
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading])

  // "Collaboratore" = utente esterno che ha SOLO accesso a creare
  // preventivi, NON ha permesso sulle prenotazioni complete.
  const isCollaboratore = hasPermission('reservations-preventivi') && !hasPermission('reservations')

  // Hide-keys espliciti: spuntando un "hide:X" nella modale invito,
  // l'elemento UI corrispondente sparisce per QUELL'operatore. Non
  // toccano gli altri utenti perché si leggono direttamente da
  // permissions[] (no bypass direzione/developer/`*`).
  const isHidden = (key: 'miei-orari' | 'allarmi' | 'richieste-no-cauzione') =>
    Array.isArray(permissions) && permissions.includes(`hide:${key}`)

  async function handleSignOut() {
    clearAdminCache()
    try { sessionStorage.removeItem(ACTIVE_TAB_KEY) } catch { /* ignore */ }
    await supabase.auth.signOut()
    navigate('/login')
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordMsg(null)
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'La password deve avere almeno 6 caratteri.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Le password non corrispondono.' })
      return
    }
    setPasswordLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPasswordMsg({ type: 'success', text: 'Password aggiornata con successo!' })
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setShowPasswordModal(false), 1500)
    } catch (err: unknown) {
      setPasswordMsg({ type: 'error', text: (err as Error).message || 'Errore durante l\'aggiornamento.' })
    } finally {
      setPasswordLoading(false)
    }
  }

  function handleCalendarBooking(vehicleId: string, date: Date, bookingId?: string) {
    setInitialReservationData({ vehicleId, pickupDate: date, bookingId })
    setActiveTab('reservations')
  }

  function handleCarWashCalendarBooking(date: string, time: string) {
    setInitialCarWashData({ appointmentDate: date, appointmentTime: time })
    setActiveTab('carwash')
  }

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  useEffect(() => {
    const handleOpenBookingForm = (event: CustomEvent) => {
      const { vehicleId, date, bookingId } = event.detail
      handleCalendarBooking(vehicleId, date, bookingId)
    }

    window.addEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    return () => {
      window.removeEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Section structure. Each section's first tab is the default landing page
  // when the user clicks the section in the sidebar. Sub-tabs render as a
  // horizontal pill bar at the top of the content area.
  // `subView` (optional) lets a sub-tab redirect to the same admin tab as
  // another entry but switch an internal sub-view (used to expose
  // RentalTabs' Noleggio / Preventivi as separate section sub-tabs).
  // permKey overrides the default permission check (which uses `tab`).
  // Used when two sub-tabs share the same TabType but need separate access
  // grants — e.g. Preventivi vs Prenotazioni both target tab='reservations'.
  type SubTab = { tab: TabType; label: string; titleLabel?: string; superadminOnly?: boolean; subView?: 'bookings' | 'preventivi' | 'uscite'; permKey?: string }
  const [rentalSubView, setRentalSubView] = useState<'bookings' | 'preventivi' | 'uscite'>('bookings')
  const SECTIONS: { name: string; tabs: SubTab[] }[] = [
    { name: 'Noleggio Terra', tabs: [
      { tab: 'reservations', label: 'Noleggio', titleLabel: 'Prenotazioni', subView: 'bookings' },
      { tab: 'reservations', label: 'Preventivi', subView: 'preventivi', permKey: 'reservations-preventivi' },
      { tab: 'reservations', label: 'Uscite Straordinarie', subView: 'uscite' },
      { tab: 'calendar', label: 'Calendario' },
      { tab: 'contratto', label: 'Contratti' },
      { tab: 'gestione-danni', label: 'Danni & Penali' },
      { tab: 'gestione-multe', label: 'Multe' },
      { tab: 'cargos', label: 'Cargos' },
      // 2026-06-10: sezione "Flotta" spostata DENTRO Noleggio.
      { tab: 'vehicles', label: 'Veicoli' },
      { tab: 'magazzino', label: 'Magazzino' },
      { tab: 'gps-keyless', label: 'GPS Flotta' },
    ] },
    { name: 'Noleggio Mare', tabs: [
      { tab: 'mare-bookings', label: 'Prenotazioni' },
      { tab: 'mare-calendar', label: 'Calendario' },
      { tab: 'mare-catalog', label: 'Catalogo' },
      { tab: 'mare-tours', label: 'Tour' },
      { tab: 'mare-preventivi', label: 'Preventivi' },
    ] },
    { name: 'Noleggio Aria', tabs: [
      { tab: 'aria-bookings', label: 'Prenotazioni' },
      { tab: 'aria-calendar', label: 'Calendario' },
      { tab: 'aria-catalog', label: 'Catalogo' },
      { tab: 'aria-tours', label: 'Tour' },
      { tab: 'aria-preventivi', label: 'Preventivi' },
      { tab: 'aria-movimenti', label: 'Movimenti' },
    ] },
    { name: 'Soggiorni & Ospitalità', tabs: [
      { tab: 'stay-bookings', label: 'Prenotazioni' },
      { tab: 'stay-calendar', label: 'Calendario' },
      { tab: 'stay-catalog', label: 'Catalogo' },
      { tab: 'stay-tours', label: 'Tour' },
      { tab: 'stay-preventivi', label: 'Preventivi' },
    ] },
    { name: 'Lavaggio & Meccanica', tabs: [
      { tab: 'carwash', label: 'Prenotazioni' },
      { tab: 'carwash-calendar', label: 'Calendario' },
      { tab: 'carwash-catalog', label: 'Catalogo' },
    ] },
    { name: 'Clienti', tabs: [
      { tab: 'customers', label: 'Lead' },
      { tab: 'customer-wallet', label: 'Credit Wallet' },
      { tab: 'site-users', label: 'Iscritti al Sito' },
    ] },
    { name: 'Marketing', tabs: [
      { tab: 'birthdays', label: 'Compleanni' },
      { tab: 'reviews', label: 'Recensioni' },
      { tab: 'marketing-pro', label: 'Messaggi di Sistema Pro' },
      { tab: 'campagna-marketing', label: 'Campagna Marketing' },
      { tab: 'social-links', label: 'Social Links' },
      { tab: 'referral', label: 'Referral' },
      { tab: 'codice-sconto', label: 'Codice Sconto' },
    ] },
    { name: 'Report', tabs: [
      { tab: 'report-noleggio', label: 'Noleggio' },
      { tab: 'report-lavaggio', label: 'Lavaggio' },
      { tab: 'report-clienti', label: 'Clienti' },
      { tab: 'report-autisti', label: 'Autisti' },
      { tab: 'report-penali-danni', label: 'Penali & Danni' },
      { tab: 'report-preventivi', label: 'Preventivi' },
      { tab: 'report-traffic', label: 'Rendimento Sito' },
      { tab: 'report-gmb', label: 'Rendimento Google My Business' },
      // 2026-05-18: 'rilevazione-orari' rimossa dal menu — adesso e' una
      // sub-view dentro Operatori (Dashboard / Rilevazione / Contratti / Audit).
      { tab: 'dashboard-kpi', label: 'Dashboard' },
    ] },
    // 2026-06-02: sezione Comunicazione rimossa — tutti i sub-tab erano
    // PlaceholderTab vuoti. Se mai serviranno (E-mail, PEC, WhatsApp, SMS,
    // Chiamate, Chat GPT, Aruba) si reintroducono qui.
    { name: 'Amministrazione', tabs: [
      { tab: 'unpaid', label: 'In attesa di pagamento' },
      { tab: 'cauzioni', label: 'Cauzioni' },
      { tab: 'scadenze', label: 'Scadenze' },
      { tab: 'fattura', label: 'Fattura' },
      { tab: 'operatori', label: 'Operatori' },
      { tab: 'immondizia', label: 'Immondizia' },
      { tab: 'ticket', label: 'Ticket' },
      { tab: 'fornitori', label: 'Fornitori' },
      { tab: 'nexi', label: 'Nexi' },
      { tab: 'gestione-otp', label: 'Gestione OTP' },
      { tab: 'verifica-documenti', label: 'Verifica Documenti' },
    ] },
    { name: 'Centralina Pro', tabs: [
      { tab: 'centralina-pro', label: 'Centralina Pro' },
    ] },
    { name: 'Sito', tabs: [
      { tab: 'sito', label: 'Sito' },
    ] },
    { name: 'DR7 Trust', tabs: [
      { tab: 'trustera', label: 'DR7 Trust' },
    ] },
    { name: 'DR7 Emtn', tabs: [
      { tab: 'emtn', label: 'DR7 Emtn' },
    ] },
  ]
  const sectionForActiveTab = SECTIONS.find(s => s.tabs.some(t => t.tab === activeTab)) || null
  const isSectionActive = (sectionName: string) => sectionForActiveTab?.name === sectionName

  // Sidebar grouping: maps each section to a top-level group (CORE BUSINESS,
  // GESTIONE, SISTEMI) + an icon. Missing entries default to 'sistemi' and
  // render with a generic dot icon.
  const SECTION_META: Record<string, { group: 'core' | 'gestione' | 'sistemi'; icon: React.ReactNode }> = {
    'Noleggio Terra':  { group: 'core', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 13l1-3a4 4 0 014-3h8a4 4 0 014 3l1 3v5a1 1 0 01-1 1h-2a1 1 0 01-1-1v-1H7v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-5z"/> },
    'Noleggio Mare':   { group: 'core', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 17l1-4h14l1 4M5 13l7-9 7 9M12 4v9"/> },
    'Noleggio Aria':   { group: 'core', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 5h18M12 5v3M7 11h8a3 3 0 013 3v2H6a2 2 0 01-2-2v-1a2 2 0 012-2zm9 7l3 3"/> },
    'Soggiorni & Ospitalità': { group: 'core', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 11l9-7 9 7M5 9.5V20a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V9.5"/> },
    'Lavaggio & Meccanica': { group: 'core', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 2v6m0 0l-3-3m3 3l3-3M5 12a7 7 0 1014 0c0-3-2-5-7-10-5 5-7 7-7 10z"/> },
    'Clienti':         { group: 'gestione', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zm6 4a3 3 0 11-6 0 3 3 0 016 0z"/> },
    'Marketing':       { group: 'gestione', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/> },
    'Report':          { group: 'gestione', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/> },
    'Amministrazione':{ group: 'sistemi', icon: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></> },
    'Centralina Pro':  { group: 'sistemi', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M13 10V3L4 14h7v7l9-11h-7z"/> },
    'DR7 Trust':       { group: 'sistemi', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/> },
    'DR7 Emtn':        { group: 'sistemi', icon: <><circle cx="12" cy="12" r="9" strokeWidth={1.7}/><path strokeWidth={1.7} d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></> },
    'Sito':            { group: 'sistemi', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/> },
  }
  const GROUP_LABELS: Record<'core' | 'gestione' | 'sistemi', string> = {
    core: 'CORE BUSINESS',
    gestione: 'GESTIONE',
    sistemi: 'SISTEMI',
  }

  // Per i collaboratori la sidebar non serve: tutte le tab accessibili
  // (potenzialmente sparpagliate fra sezioni — es. Preventivi + Calendario
  // sotto Noleggio + Centralina Pro readonly) le mostriamo come barra
  // piatta in alto. Tutti gli operatori standard mantengono sidebar +
  // sezioni come prima.
  const visibleSectionCount = SECTIONS.filter(s =>
    s.tabs.some(t => hasPermission(t.permKey || t.tab) && (!t.superadminOnly || adminRole === 'superadmin'))
  ).length
  const hideSidebar = visibleSectionCount <= 1 || isCollaboratore
  // Lista piatta di tutte le tab accessibili (per collaboratori). Tiene il
  // primo entry per ogni (tab + permKey) cosi' Preventivi sotto Noleggio
  // e Centralina Pro readonly compaiono nello stesso bar. Label di
  // 'centralina-pro' viene sovrascritta a "Cauzioni" se l'utente ha
  // solo `view-cauzioni-readonly` (e quindi vedra' SOLO Cauzioni dentro
  // Centralina Pro), per evitare confusione nel bar in alto.
  const hasCauzioniReadOnly = permissions.includes('view-cauzioni-readonly')
  const collaboratoreFlatTabs = SECTIONS.flatMap(s => s.tabs)
    .filter(t => hasPermission(t.permKey || t.tab) && (!t.superadminOnly || adminRole === 'superadmin'))
    .map(t => (t.tab === 'centralina-pro' && hasCauzioniReadOnly) ? { ...t, label: 'Cauzioni' } : t)

  // Mobile tab labels
  const tabLabels: Record<string, string> = {
    'reservations': 'Prenotazioni Noleggio',
    'report-preventivi': 'Report Preventivi',
    'calendar': 'Calendario Noleggio',
    'cauzioni': 'Cauzioni',
    'contratto': 'Contratti',
    'gestione-danni': 'Gestione Danni & Penali',
    'gestione-multe': 'Gestione Multe',
    'cargos': 'Cargos',
    'trustera': 'DR7 Trust',
    'mare-bookings': 'Prenotazioni Noleggio Mare',
    'mare-calendar': 'Calendario Noleggio Mare',
    'mare-catalog': 'Catalogo Noleggio Mare',
    'mare-tours': 'Tour & Posti Noleggio Mare',
    'mare-preventivi': 'Preventivi Noleggio Mare',
    'aria-bookings': 'Prenotazioni Noleggio Aria',
    'aria-calendar': 'Calendario Noleggio Aria',
    'aria-catalog': 'Catalogo Noleggio Aria',
    'aria-tours': 'Tour & Posti Noleggio Aria',
    'aria-preventivi': 'Preventivi Noleggio Aria',
    'stay-bookings': 'Prenotazioni Soggiorni & Ospitalità',
    'stay-calendar': 'Calendario Soggiorni & Ospitalità',
    'stay-catalog': 'Catalogo Soggiorni & Ospitalità',
    'stay-tours': 'Tour & Posti Soggiorni & Ospitalità',
    'stay-preventivi': 'Preventivi Soggiorni & Ospitalità',
    'emtn': 'DR7 Emtn',
    'gestione-otp': 'Gestione OTP',
    'verifica-documenti': 'Verifica Documenti',
    'fornitori': 'Fornitori',
    'carwash': 'Prenotazioni Prime Wash',
    'carwash-calendar': 'Calendario Prime Wash',
    'carwash-catalog': 'Catalogo Prime Wash',
    'vehicles': 'Veicoli',
    'gps-keyless': 'GPS Flotta',
    'unpaid': 'In attesa di pagamento',
    'customers': 'Lead',
    'birthdays': 'Compleanni',
    'reviews': 'Recensioni',
    'marketing-pro': 'Messaggi di Sistema Pro',
    'campagna-marketing': 'Campagna Marketing',
    'social-links': 'Social Links',
    'referral': 'Referral',
    'codice-sconto': 'Codice Sconto',
    'nexi': 'Nexi',
    'report-noleggio': 'Report Noleggio',
    'report-lavaggio': 'Report Lavaggio',
    'report-clienti': 'Report Clienti',
    'report-autisti': 'Report Autisti',
    'report-traffic': 'Rendimento Sito',
    'report-gmb': 'Rendimento Google My Business',
    'report-penali-danni': 'Report Penali & Danni',
    'customer-wallet': 'Credit Wallet',
    'site-users': 'Iscritti al Sito',
    'reports': 'Report',
    'scadenze': 'Scadenze',
    'fattura': 'Fattura',
    'operatori': 'Operatori',
    'rilevazione-orari': 'Rilevazione Orari',
    'dashboard-kpi': 'Dashboard',
    'sito': 'Sito',
  }

  return (
    <div className="min-h-screen flex bg-theme-bg-secondary">
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — width tightened on phone, safe-area-aware top/bottom so
          notch + home indicator don't eat the close button or bottom
          action row. */}
      <aside
        className={`fixed left-3 z-[70] w-[72vw] max-w-[244px] bg-theme-bg-primary flex flex-col rounded-3xl shadow-2xl shadow-black/40 overflow-hidden transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-[110%]'}`}
        style={{
          top: 'max(0.75rem, env(safe-area-inset-top))',
          maxHeight: 'calc(100vh - max(1.5rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)))',
        }}
      >
        {/* Logo + Close.
            The logo (2048×632, ratio ≈ 3.24:1) must NEVER be compressed
            horizontally. object-contain + matched max-width/max-height
            lets the browser preserve aspect ratio inside the sidebar's
            narrow ~140px inner panel without flex shrinking it. */}
        {/* Logo trasparente come la pagina di login: il PNG (dr7-logo.png,
            sfondo trasparente) si appoggia direttamente sul tema corrente
            (bg-theme-bg-primary) — nero+glow ciano su tema chiaro, neon
            ciano su tema scuro. Niente piu' rettangolo nero. La X close usa
            colori theme-aware perche' ora sta sopra allo sfondo del tema. */}
        <div className="relative px-3 py-3 flex items-center justify-center">
          <img
            src="/dr7-logo.png"
            alt="DR7 A.I."
            className="max-h-10 max-w-[120px] w-auto h-auto object-contain"
          />
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation — one entry per section. Click switches activeTab to
            the first sub-tab of that section. The in-page horizontal tab
            bar (rendered above the content) lets the user pick a sub-tab.
            Spacing: flex-col + justify-evenly distribuisce le sezioni in
            modo uniforme su tutta l'altezza disponibile, eliminando il
            grosso vuoto sotto l'ultima voce. */}
        <nav className="flex flex-col gap-2.5 py-2.5 px-2 overflow-y-auto scrollbar-thin min-h-0">
          {(['core', 'gestione', 'sistemi'] as const).map(grp => {
            const groupSections = SECTIONS.filter(s => (SECTION_META[s.name]?.group || 'sistemi') === grp)
            const renderable = groupSections
              .map(section => {
                const visibleTabs = section.tabs.filter(t => hasPermission(t.permKey || t.tab) && (!t.superadminOnly || adminRole === 'superadmin'))
                return visibleTabs.length > 0 ? { section, visibleTabs } : null
              })
              .filter((x): x is { section: typeof groupSections[number]; visibleTabs: typeof groupSections[number]['tabs'] } => x !== null)
            if (renderable.length === 0) return null
            return (
              <div key={grp} className="space-y-0.5">
                <div className="px-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-theme-text-muted/70">{GROUP_LABELS[grp]}</div>
                {renderable.map(({ section, visibleTabs }) => {
                  const firstVisible = visibleTabs[0]
                  const firstTab = firstVisible.tab
                  const sectionActive = isSectionActive(section.name)
                  const meta = SECTION_META[section.name]
                  const badge = section.name === 'Marketing' ? birthdayCount
                              : section.name === 'Amministrazione' ? scartataCount : 0
                  return (
                    <button
                      key={section.name}
                      onClick={() => {
                        if (!sectionActive) {
                          setActiveTab(firstTab)
                          if (firstVisible.subView) setRentalSubView(firstVisible.subView)
                        }
                        setSidebarOpen(false)
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold transition-all ${
                        sectionActive
                          ? 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/40 shadow-[0_0_20px_-8px_rgba(34,211,238,0.4)]'
                          : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover'
                      }`}
                    >
                      {meta?.icon && (
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">{meta.icon}</svg>
                      )}
                      <span className="flex-1 text-left truncate">{section.name}</span>
                      {badge > 0 && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                            section.name === 'Amministrazione' ? 'bg-rose-500/20 text-rose-300' : 'bg-cyan-500/20 text-cyan-300'
                          }`}
                          title={section.name === 'Amministrazione' ? `${scartataCount} fattur${scartataCount === 1 ? 'a scartata' : 'e scartate'} dal SDI` : undefined}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 py-3 border-t border-white/10 space-y-2">
          {/* User card — avatar + name + role badge */}
          {(adminName || adminEmail) && (() => {
            const display = adminName || adminEmail || 'Utente'
            const parts = display.trim().split(/\s+/).filter(Boolean)
            const init = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : display.slice(0, 2).toUpperCase()
            return (
              <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-theme-bg-tertiary/40 ring-1 ring-theme-border">
                {adminAvatar ? (
                  <img src={adminAvatar} alt={display} className="w-8 h-8 rounded-full object-cover ring-1 ring-cyan-500/40 shrink-0"/>
                ) : (
                  <div className="grid w-8 h-8 place-items-center rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40 shrink-0">{init}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-semibold text-theme-text-primary truncate">{display}</p>
                  <span className="inline-block mt-0.5 text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30">
                    {adminRole === 'superadmin' ? 'Super Admin' : 'Admin'}
                  </span>
                </div>
              </div>
            )
          })()}
          {/* Alarm row: bell button (Attiva Allarmi) + gear opens the inventory.
              The gear is always visible so admins can review what alarms exist
              even after audio is enabled. Nascosto per collaboratori
              (heuristic) o quando admin imposta esplicitamente
              `hide:allarmi` sul row dell'operatore. */}
          {!isCollaboratore && !isHidden('allarmi') && (
          <div className="flex items-stretch gap-1">
            {!alarmState.audioEnabled ? (
              <button
                onClick={enableAudio}
                className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Attiva Allarmi
              </button>
            ) : (
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] text-green-400">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Allarmi attivi
              </div>
            )}
            <button
              onClick={() => setShowAlarmInventory(true)}
              title="Gestione Allarmi — vedi quali allarmi sono attivi, quando suonano e perché"
              aria-label="Gestione Allarmi"
              className="px-2 py-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors flex items-center justify-center"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          )}
          {!isCollaboratore && !isHidden('miei-orari') && (
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => { setSidebarOpen(false); setShowMyOrari(true); }}
                title="I miei orari — inserisci/modifica i tuoi orari di oggi"
                className="flex-1 flex items-center justify-center gap-1.5 px-2 min-h-[36px] rounded-lg text-[10px] text-theme-text-secondary hover:text-amber-400 hover:bg-theme-bg-hover transition-colors"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 2" />
                </svg>
                I miei orari
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowPasswordModal(true); setPasswordMsg(null); setNewPassword(''); setConfirmPassword(''); setPasswordVisible(false); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 min-h-[36px] rounded-lg text-[10px] text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Cambia Password
            </button>
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center px-3 min-h-[36px] rounded-lg text-[10px] text-theme-text-muted hover:text-red-400 hover:bg-theme-bg-hover transition-colors"
            >
              Esci
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen w-full max-w-full">
        {/* Top Bar — segue il tema (light = white bg + dark text,
            dark = black bg + light text). Le classi text-white/border-white
            erano hardcoded per dark; ora usano i token tema-aware. */}
        <header className="bg-theme-bg-primary border-b border-theme-border px-3 sm:px-8 py-3 sm:py-4 flex flex-wrap justify-between items-center gap-y-2 gap-x-3 sticky top-0 z-30" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-3">
            {!hideSidebar && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-theme-text-primary p-2 min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center hover:bg-theme-bg-hover rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            )}
            {tabHistory.length > 0 && (
              <button
                onClick={goBack}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-theme-bg-hover transition-colors text-theme-text-secondary hover:text-theme-text-primary flex-shrink-0"
                aria-label="Indietro"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-lg sm:text-xl font-bold text-theme-text-primary truncate">
              {(() => {
                if (!sectionForActiveTab) return tabLabels[activeTab] || activeTab
                // Match by tab AND subView when multiple entries point at the same tab.
                // Filter out sub-tab entries the current user can't access so a
                // limited user (e.g. only reservations-preventivi) never sees
                // "Prenotazioni Noleggio" in the page title when they're
                // actually looking at Preventivi.
                const accessibleSameTab = sectionForActiveTab.tabs
                  .filter(t => t.tab === activeTab)
                  .filter(t => hasPermission(t.permKey || t.tab))
                const subTab = accessibleSameTab.length > 1
                  ? accessibleSameTab.find(t => t.subView === rentalSubView) || accessibleSameTab[0]
                  : accessibleSameTab[0]
                if (subTab) {
                  // Prefer the explicit titleLabel (e.g. Noleggio's bookings
                  // sub-view shows "Noleggio" in the bar but "Prenotazioni"
                  // in the title), then fall back to the bar label. Avoid
                  // "Noleggio Noleggio" / "Gestione Flotta Flotta" by NOT
                  // appending the section name when the title already
                  // contains it (or vice versa).
                  const titleSub = subTab.titleLabel || subTab.label
                  const titleLower = titleSub.toLowerCase()
                  const sectionLower = sectionForActiveTab.name.toLowerCase()
                  if (titleLower === sectionLower
                      || titleLower.includes(sectionLower)
                      || sectionLower.includes(titleLower)) {
                    return titleSub
                  }
                  return `${titleSub} ${sectionForActiveTab.name}`
                }
                return tabLabels[activeTab] || activeTab
              })()}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {!isCollaboratore && !isHidden('miei-orari') && (
              <button
                onClick={() => setShowMyOrari(true)}
                title="I miei orari — inserisci/modifica i tuoi orari di oggi"
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-dr7-gold/40 bg-dr7-gold/5 text-dr7-gold text-[13px] font-semibold hover:bg-dr7-gold/10 active:scale-95 transition-all"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 2" />
                </svg>
                <span className="hidden sm:inline">I miei orari</span>
              </button>
            )}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
              aria-label="Cambia tema"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full border border-theme-border hover:border-dr7-gold text-theme-text-secondary hover:text-dr7-gold transition-colors"
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="4" strokeWidth={2} />
                  <path strokeLinecap="round" strokeWidth={2} d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            {/* Palette picker — swap brand palette without changing dark/light mode */}
            <div className="relative">
              <button
                onClick={() => setPaletteMenuOpen(v => !v)}
                title="Cambia palette"
                aria-label="Cambia palette"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full border border-theme-border hover:border-dr7-gold text-theme-text-secondary hover:text-dr7-gold transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <circle cx="13.5" cy="6.5" r="2.5" />
                  <circle cx="17.5" cy="10.5" r="2.5" />
                  <circle cx="8.5" cy="7.5" r="2.5" />
                  <circle cx="6.5" cy="12.5" r="2.5" />
                  <path d="M12 22a10 10 0 1 1 .01-20 7.5 7.5 0 0 1 5.3 12.79l-1.55 1.55a2 2 0 0 0 0 2.83 2 2 0 0 1-1.41 3.41A10 10 0 0 1 12 22z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {paletteMenuOpen && createPortal(
                <>
                  <div className="fixed inset-0 z-[9990] backdrop-blur-[2px]" onClick={() => setPaletteMenuOpen(false)} />
                  <div
                    className="fixed right-4 top-20 w-[340px] max-h-[85vh] overflow-y-auto rounded-2xl border border-theme-border bg-theme-bg-secondary z-[9991]"
                    style={{ boxShadow: '0 24px 60px -12px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)' }}
                  >
                    <div className="sticky top-0 z-10 bg-theme-bg-secondary/95 backdrop-blur px-4 pt-4 pb-3 border-b border-theme-border">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-theme-text-muted font-semibold">Theme</p>
                      <p className="text-sm text-theme-text-primary font-semibold mt-0.5">Premium Interface Modes</p>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">Apple-style enterprise platform.</p>
                    </div>
                    <div className="p-3 space-y-2">
                      {PALETTES.map(p => {
                        const selected = palette === p.id
                        return (
                          <button
                            key={p.id}
                            onClick={() => { setPalette(p.id); setPaletteMenuOpen(false) }}
                            className={
                              'group relative w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-300 ' +
                              (selected
                                ? 'border-dr7-gold/60 bg-theme-bg-hover shadow-[0_0_0_1px_var(--color-dr7-gold)] '
                                : 'border-theme-border hover:border-theme-border-light bg-theme-bg-primary hover:bg-theme-bg-hover')
                            }
                          >
                            <PalettePreview palette={p.id} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={'text-sm font-semibold truncate ' + (selected ? 'text-theme-text-primary' : 'text-theme-text-primary')}>
                                  {p.label}
                                </span>
                                {selected && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-dr7-gold/15 border border-dr7-gold/40">
                                    <svg className="w-2.5 h-2.5 text-dr7-gold" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span className="text-[9px] uppercase tracking-wider text-dr7-gold font-semibold">Attivo</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-theme-text-secondary truncate mt-0.5">{p.description}</p>
                              <p className="text-[10px] text-theme-text-muted truncate mt-0.5 italic">{p.inspiration}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    <div className="sticky bottom-0 px-4 py-2.5 border-t border-theme-border bg-theme-bg-secondary/95 backdrop-blur">
                      <p className="text-[10px] text-theme-text-muted text-center">
                        Dark/Light mode si controlla con il pulsante luna/sole accanto.
                      </p>
                    </div>
                  </div>
                </>,
                document.body
              )}
            </div>
            <span className="text-sm text-theme-text-secondary hidden lg:block">
              {new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>

            {/* Sede picker — visible solo per direzione con piu' sedi.
                Per operatori sede-bound mostra solo il nome sede come badge. */}
            <SedePicker />

            {/* Operator badge — current admin login. On mobile shows only the
                square avatar + chevron; on sm+ also name + role. Click toggles
                a dropdown with email + logout. */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl bg-theme-bg-tertiary border border-theme-border hover:border-dr7-gold transition-colors min-h-[40px]"
                aria-label="Operatore"
                title={adminEmail || 'Operatore'}
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-dr7-gold/20 text-dr7-gold flex items-center justify-center text-xs font-bold border border-dr7-gold/30 shrink-0">
                  {adminAvatar ? (
                    <img src={adminAvatar} alt={adminName || 'Operatore'} className="w-full h-full object-cover" />
                  ) : (() => {
                    const src = adminName || adminEmail || ''
                    const parts = src.split(/[\s@.]+/).filter(Boolean)
                    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
                  })()}
                </div>
                <div className="hidden sm:flex flex-col items-start leading-tight pr-1">
                  <span className="text-[12px] font-bold text-theme-text-primary truncate max-w-[140px]">{adminName || (adminEmail || '').split('@')[0] || 'Operatore'}</span>
                  <span className="text-[10px] text-theme-text-muted truncate max-w-[140px]">{adminRole === 'superadmin' ? 'Super Admin' : 'Admin'}</span>
                </div>
                <svg className={`w-3.5 h-3.5 text-theme-text-muted shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  {/* Dropdown — width capped to viewport so it never clips
                      off-screen on narrow phones. Touch targets >=44px. */}
                  <div className="absolute right-0 top-12 z-50 w-64 max-w-[calc(100vw-1rem)] bg-theme-bg-secondary border border-theme-border rounded-xl shadow-2xl py-2 text-sm overflow-hidden">
                    <div className="px-3 pb-2 border-b border-theme-border flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full overflow-hidden bg-dr7-gold/20 text-dr7-gold flex items-center justify-center text-sm font-bold border border-dr7-gold/30 shrink-0">
                        {adminAvatar ? (
                          <img src={adminAvatar} alt={adminName || 'Operatore'} className="w-full h-full object-cover" />
                        ) : (() => {
                          const src = adminName || adminEmail || ''
                          const parts = src.split(/[\s@.]+/).filter(Boolean)
                          return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
                        })()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-theme-text-primary truncate">{adminName || 'Operatore'}</div>
                        <div className="text-[11px] text-theme-text-muted truncate">{adminEmail || '—'}</div>
                        <div className="text-[10px] text-theme-text-muted mt-0.5">{adminRole === 'superadmin' ? 'Super Admin' : 'Admin'}</div>
                      </div>
                    </div>
                    {/* I miei orari — quick access to the operator's own
                        Rilevazione Orari tab. Nascosto per collaboratori
                        (heuristic) o quando admin imposta `hide:miei-orari`
                        sul row dell'operatore. */}
                    {!isCollaboratore && !isHidden('miei-orari') && (
                      <>
                        <button
                          onClick={() => { setUserMenuOpen(false); setActiveTab('rilevazione-orari') }}
                          className="w-full text-left px-3 py-3 hover:bg-theme-bg-tertiary text-theme-text-primary flex items-center gap-2 min-h-[44px]"
                        >
                          <svg className="w-4 h-4 text-dr7-gold shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          I miei orari
                        </button>
                        <div className="border-t border-theme-border my-1" />
                      </>
                    )}
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowPasswordModal(true); setPasswordMsg(null); setNewPassword(''); setConfirmPassword(''); setPasswordVisible(false); }}
                      className="w-full text-left px-3 py-3 hover:bg-theme-bg-tertiary text-theme-text-primary flex items-center gap-2 min-h-[44px]"
                    >
                      <svg className="w-4 h-4 text-theme-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Cambia Password
                    </button>
                    <button
                      onClick={() => { setUserMenuOpen(false); handleSignOut() }}
                      className="w-full text-left px-3 py-3 hover:bg-theme-bg-tertiary text-red-400 flex items-center gap-2 min-h-[44px]"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Esci
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* In-page horizontal sub-tab bar — lists all sub-tabs of the
            active section. Renders only if the section has more than one
            sub-tab so single-tab sections don't get a one-button bar.
            2026-05-20: gate su !roleLoading per evitare flash di subtab
            non autorizzate durante il caricamento iniziale (hasPermission
            è ottimistico → torna true mentre carica → tutti i tab
            apparivano per ~500ms anche a collaboratori ristretti). */}
        {!roleLoading && (isCollaboratore
          ? collaboratoreFlatTabs.length > 1
          : sectionForActiveTab && sectionForActiveTab.tabs.filter(t => hasPermission(t.permKey || t.tab) && (!t.superadminOnly || adminRole === 'superadmin')).length > 1
        ) && (
          <div className="bg-theme-bg-primary border-b border-theme-border overflow-x-auto scrollbar-thin sticky top-[60px] z-20">
            <div className="flex items-center gap-1 px-3 sm:px-6 lg:px-8">
              {(isCollaboratore
                ? collaboratoreFlatTabs
                : (sectionForActiveTab?.tabs.filter(t => hasPermission(t.permKey || t.tab) && (!t.superadminOnly || adminRole === 'superadmin')) || [])
              )
                .map((t, idx) => {
                  const tabMatch = activeTab === t.tab
                  const subMatch = t.subView ? rentalSubView === t.subView : (t.tab !== 'reservations' || true)
                  const sourceTabs = isCollaboratore ? collaboratoreFlatTabs : (sectionForActiveTab?.tabs || [])
                  const sameTabEntries = sourceTabs.filter(x => x.tab === t.tab)
                  const isActive = sameTabEntries.length > 1
                    ? (tabMatch && t.subView === rentalSubView)
                    : tabMatch && subMatch
                  return (
                    <button
                      key={`${t.tab}-${t.subView || 'main'}-${idx}`}
                      onClick={() => {
                        setActiveTab(t.tab)
                        if (t.subView) setRentalSubView(t.subView)
                      }}
                      className={`relative px-3 sm:px-4 py-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                        isActive
                          ? 'text-primary-light'
                          : 'text-theme-text-secondary hover:text-dr7-gold'
                      }`}
                    >
                      {t.label}
                      {t.tab === 'fattura' && scartataCount > 0 && (
                        <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/30 text-red-300 text-[10px] font-bold align-middle">
                          {scartataCount}
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-primary-dark via-primary to-primary-light" />
                      )}
                    </button>
                  )
                })}
            </div>
          </div>
        )}

        {/* Content */}
        <main className={`flex-1 bg-theme-bg-secondary ${(activeTab === 'calendar' || activeTab === 'carwash-calendar') ? 'p-0' : 'p-3 sm:p-6 lg:p-8'}`}>
          <Suspense fallback={<TabLoader />}>
          <div>
          {activeTab === 'reservations' && (
            <RentalTabs
              initialData={initialReservationData}
              onDataConsumed={() => setInitialReservationData(null)}
              activeSubView={rentalSubView}
              onSubViewChange={setRentalSubView}
            />
          )}
          {activeTab === 'report-preventivi' && <ReportPreventiviTab />}
          {activeTab === 'unpaid' && (isTabRestricted('unpaid') ? <PlaceholderTab title="Accesso non autorizzato" /> : <UnpaidBookingsTab />)}
          {activeTab === 'customers' && <CustomersTab />}
          {activeTab === 'customer-wallet' && <CustomerWalletTab />}
          {activeTab === 'site-users' && <SiteUsersTab />}
          {activeTab === 'vehicles' && <VehiclesTab />}
          {activeTab === 'calendar' && (
            <CalendarTab
              onNewBooking={handleCalendarBooking}
            />
          )}
          {activeTab === 'carwash' && (
            <CarWashBookingsTab
              initialData={initialCarWashData}
              onDataConsumed={() => setInitialCarWashData(null)}
            />
          )}
          {activeTab === 'carwash-calendar' && (
            <CarWashCalendarTab
              onNewBooking={handleCarWashCalendarBooking}
            />
          )}
          {activeTab === 'carwash-catalog' && <CarWashCatalogTab />}
          {activeTab === 'mare-bookings' && <NoleggioServiceTab serviceType="boat_rental" view="bookings" labels={{ title: 'Noleggio Mare', asset: 'Barca', assetPlural: 'Barche' }} />}
          {activeTab === 'mare-calendar' && <NoleggioServiceTab serviceType="boat_rental" view="calendar" labels={{ title: 'Noleggio Mare', asset: 'Barca', assetPlural: 'Barche' }} />}
          {activeTab === 'mare-catalog' && <NoleggioServiceTab serviceType="boat_rental" view="catalog" labels={{ title: 'Noleggio Mare', asset: 'Barca', assetPlural: 'Barche' }} />}
          {activeTab === 'mare-tours' && <NoleggioServiceTab serviceType="boat_rental" view="tours" labels={{ title: 'Noleggio Mare', asset: 'Barca', assetPlural: 'Barche' }} />}
          {activeTab === 'mare-preventivi' && <NoleggioServiceTab serviceType="boat_rental" view="preventivi" labels={{ title: 'Noleggio Mare', asset: 'Barca', assetPlural: 'Barche' }} />}
          {activeTab === 'aria-bookings' && <NoleggioServiceTab serviceType="heli_rental" view="bookings" labels={{ title: 'Noleggio Aria', asset: 'Elicottero', assetPlural: 'Elicotteri' }} />}
          {activeTab === 'aria-calendar' && <NoleggioServiceTab serviceType="heli_rental" view="calendar" labels={{ title: 'Noleggio Aria', asset: 'Elicottero', assetPlural: 'Elicotteri' }} />}
          {activeTab === 'aria-catalog' && <NoleggioServiceTab serviceType="heli_rental" view="catalog" labels={{ title: 'Noleggio Aria', asset: 'Elicottero', assetPlural: 'Elicotteri' }} />}
          {activeTab === 'aria-tours' && <NoleggioServiceTab serviceType="heli_rental" view="tours" labels={{ title: 'Noleggio Aria', asset: 'Elicottero', assetPlural: 'Elicotteri' }} />}
          {activeTab === 'aria-preventivi' && <NoleggioServiceTab serviceType="heli_rental" view="preventivi" labels={{ title: 'Noleggio Aria', asset: 'Elicottero', assetPlural: 'Elicotteri' }} />}
          {activeTab === 'aria-movimenti' && <MovimentiAereiTab />}
          {activeTab === 'stay-bookings' && <NoleggioServiceTab serviceType="stay_rental" view="bookings" labels={{ title: 'Soggiorni & Ospitalità', asset: 'Alloggio', assetPlural: 'Alloggi' }} />}
          {activeTab === 'stay-calendar' && <NoleggioServiceTab serviceType="stay_rental" view="calendar" labels={{ title: 'Soggiorni & Ospitalità', asset: 'Alloggio', assetPlural: 'Alloggi' }} />}
          {activeTab === 'stay-catalog' && <NoleggioServiceTab serviceType="stay_rental" view="catalog" labels={{ title: 'Soggiorni & Ospitalità', asset: 'Alloggio', assetPlural: 'Alloggi' }} />}
          {activeTab === 'stay-tours' && <NoleggioServiceTab serviceType="stay_rental" view="tours" labels={{ title: 'Soggiorni & Ospitalità', asset: 'Alloggio', assetPlural: 'Alloggi' }} />}
          {activeTab === 'stay-preventivi' && <NoleggioServiceTab serviceType="stay_rental" view="preventivi" labels={{ title: 'Soggiorni & Ospitalità', asset: 'Alloggio', assetPlural: 'Alloggi' }} />}
          {activeTab === 'fattura' && (isTabRestricted('fattura') ? <PlaceholderTab title="Accesso non autorizzato" /> : <FatturaTab />)}
          {activeTab === 'contratto' && <ContrattoTab />}
          {activeTab === 'cauzioni' && (isTabRestricted('cauzioni') ? <PlaceholderTab title="Accesso non autorizzato" /> : <CauzioniTab />)}
          {activeTab === 'birthdays' && <BirthdaysTab />}
          {activeTab === 'reviews' && <ReviewManagementTab />}
          {activeTab === 'marketing-pro' && <MessaggiSistemaProTab />}
          {activeTab === 'campagna-marketing' && <CampagnaMarketingTab />}
          {activeTab === 'social-links' && <SocialLinksTab />}
          {/* 'fleet' route eliminata 2026-05-22 — vedi nota sulla sidebar. */}
          {activeTab === 'magazzino' && <FleetInventory />}
          {activeTab === 'nexi' && (isTabRestricted('nexi') ? <PlaceholderTab title="Accesso non autorizzato" /> : <NexiTab />)}
          {activeTab === 'scadenze' && <ScadenzeTab />}
          {activeTab === 'reports' && (isTabRestricted('reports') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportsTab />)}
          {activeTab === 'report-noleggio' && (isTabRestricted('report-noleggio') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportsTab />)}
          {activeTab === 'referral' && <ReferralProgramTab />}
          {/* Placeholder tabs for new features */}
          {activeTab === 'gestione-danni' && <GestioneDanniTab />}
          {activeTab === 'gestione-multe' && <GestioneMulteTab />}
          {activeTab === 'cargos' && <CargosTab />}
          {activeTab === 'trustera' && <TrusteraTab />}
          {activeTab === 'emtn' && <EMTNTab />}
          {activeTab === 'gps-keyless' && <GpsKeylessTab />}
          {activeTab === 'codice-sconto' && <CodiciScontoTab />}
          {activeTab === 'report-lavaggio' && (isTabRestricted('report-lavaggio') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportLavaggioTab />)}
          {activeTab === 'report-clienti' && (isTabRestricted('report-clienti') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportClientiTab />)}
          {activeTab === 'report-autisti' && (isTabRestricted('report-autisti') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportAutistiTab />)}
          {activeTab === 'report-traffic' && (isTabRestricted('report-traffic') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportTrafficTab />)}
          {activeTab === 'report-gmb' && (isTabRestricted('report-gmb') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportGoogleBusinessTab />)}
          {activeTab === 'report-penali-danni' && <ReportPenaliDanniTab />}
          {activeTab === 'operatori' && <OperatoriTab />}
          {activeTab === 'rilevazione-orari' && <RilevazioneOrariTab />}
          {activeTab === 'dashboard-kpi' && <DashboardTab />}
          {activeTab === 'centralina-pro' && <CentralinaProTab />}
          {activeTab === 'sito' && <SitoTab />}
          {activeTab === 'gestione-otp' && <GestioneOtpTab />}
          {activeTab === 'verifica-documenti' && <DocumentsVerificationTab />}
          {activeTab === 'fornitori' && <FornitoriTab />}
          {activeTab === 'immondizia' && <ImmondiziaTab />}
          {activeTab === 'ticket' && <TicketTab />}
          </div>
          </Suspense>
        </main>
      </div>

      {/* Password Change Modal */}
      <AlarmInventoryModal
        isOpen={showAlarmInventory}
        onClose={() => setShowAlarmInventory(false)}
        audioEnabled={alarmState.audioEnabled}
        onEnableAudio={enableAudio}
      />

      {showMyOrari && (
        <MyDayEditorModal onClose={() => setShowMyOrari(false)} />
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowPasswordModal(false)} />
          <div className="relative bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-theme-text-primary">Cambia Password</h3>
              <button onClick={() => setShowPasswordModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nuova password</label>
                <div className="relative">
                  <input
                    type={passwordVisible ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full px-4 py-3 pr-12 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all"
                    placeholder="Min. 6 caratteri"
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordVisible(v => !v)}
                    aria-label={passwordVisible ? 'Nascondi password' : 'Mostra password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary"
                  >
                    {passwordVisible ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Conferma password</label>
                <div className="relative">
                  <input
                    type={passwordVisible ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full px-4 py-3 pr-12 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all"
                    placeholder="Ripeti password"
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordVisible(v => !v)}
                    aria-label={passwordVisible ? 'Nascondi password' : 'Mostra password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary"
                  >
                    {passwordVisible ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              {passwordMsg && (
                <div className={`px-4 py-3 rounded-full text-sm ${passwordMsg.type === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-500' : 'bg-red-500/10 border border-red-500/30 text-red-500'}`}>
                  {passwordMsg.text}
                </div>
              )}
              <button
                type="submit"
                disabled={passwordLoading}
                className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white font-medium py-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wide"
              >
                {passwordLoading ? 'Aggiornamento...' : 'Aggiorna Password'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Small 3-dot swatch showing the palette's primary tones.
 * Used inside the palette picker dropdown so the user previews
 * each option without applying it.
 */
/**
 * Mini dashboard preview per ogni tema. Renderizza un "mockup" in 70x44px:
 *  - sidebar verticale a sinistra con 3 nav item
 *  - top bar
 *  - card principale + 2 stat boxes
 *  - accent dot in alto a destra
 * Tutti i colori sono i token reali del tema (dark variant) cosi\' il
 * preview riflette esattamente l'aspetto effettivo del CRM.
 */
function PalettePreview({ palette }: { palette: Palette }) {
    const swatch: Record<Palette, { bg: string; surface: string; border: string; accent: string; text: string }> = {
        dr7:      { bg: '#050708', surface: '#12171B', border: '#1E262C', accent: '#19C2D6', text: '#F5F7FA' },
        graphite: { bg: '#090909', surface: '#141414', border: '#1F1F1F', accent: '#8BA3B8', text: '#F5F5F5' },
        slate:    { bg: '#0B1220', surface: '#131C2E', border: '#1F2A3F', accent: '#5E7CE2', text: '#E5EAF2' },
        mono:     { bg: '#000000', surface: '#111111', border: '#2A2A2A', accent: '#FFFFFF', text: '#FFFFFF' },
        obsidian: { bg: '#050505', surface: '#101010', border: '#1A1A1B', accent: '#C0C7D1', text: '#E8EAEE' },
        frost:    { bg: '#0A0F18', surface: '#0F1622', border: '#1A2438', accent: '#7DD3FC', text: '#E0E8F2' },
        tesla:    { bg: '#08090B', surface: '#171A1F', border: '#1F232A', accent: '#00BFFF', text: '#F5F7FA' },
    }
    const s = swatch[palette]
    return (
        <div
            className="relative shrink-0 w-[72px] h-11 rounded-md overflow-hidden border"
            style={{ backgroundColor: s.bg, borderColor: s.border }}
        >
            {/* Sidebar */}
            <div
                className="absolute left-0 top-0 bottom-0 w-[14px] flex flex-col items-center justify-around"
                style={{ backgroundColor: s.bg, borderRight: `1px solid ${s.border}` }}
            >
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: s.accent }}/>
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: s.text, opacity: 0.4 }}/>
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: s.text, opacity: 0.4 }}/>
            </div>
            {/* Top bar */}
            <div
                className="absolute left-[14px] right-0 top-0 h-[6px]"
                style={{ backgroundColor: s.surface, borderBottom: `1px solid ${s.border}` }}
            />
            {/* Main card */}
            <div
                className="absolute left-[18px] top-[10px] right-[20px] h-[16px] rounded-sm"
                style={{ backgroundColor: s.surface, border: `1px solid ${s.border}` }}
            >
                <div className="absolute left-1 top-1 w-3 h-0.5 rounded-full" style={{ backgroundColor: s.accent }}/>
                <div className="absolute left-1 top-2.5 w-6 h-0.5 rounded-full" style={{ backgroundColor: s.text, opacity: 0.3 }}/>
            </div>
            {/* Two mini stat boxes */}
            <div
                className="absolute left-[18px] top-[30px] w-[20px] h-[10px] rounded-sm"
                style={{ backgroundColor: s.surface, border: `1px solid ${s.border}` }}
            />
            <div
                className="absolute left-[42px] top-[30px] w-[20px] h-[10px] rounded-sm"
                style={{ backgroundColor: s.surface, border: `1px solid ${s.border}` }}
            >
                <div className="absolute left-0.5 bottom-0.5 right-0.5 h-1 rounded-sm" style={{ backgroundColor: s.accent, opacity: 0.7 }}/>
            </div>
            {/* Accent dot top-right */}
            <span
                className="absolute top-1 right-1 w-1 h-1 rounded-full"
                style={{ backgroundColor: s.accent, boxShadow: `0 0 4px ${s.accent}` }}
            />
        </div>
    )
}
