import { useState, useEffect, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
import { useTheme, PALETTES, type Palette } from '../../contexts/ThemeContext'
import RentalTabs from './components/RentalTabs'
import { useBirthdayCount } from './components/BirthdaysTab'
import { useFatturaScartataCount } from './components/FatturaTab'
import PlaceholderTab from './components/PlaceholderTab'
import AlarmInventoryModal from '../../components/admin/AlarmInventoryModal'
import MyDayEditorModal from './components/MyDayEditorModal'
import { useAdminRole } from '../../hooks/useAdminRole'
import { clearAdminCache } from '../../utils/logAdminAction'
import lazyWithRetry from '../../utils/lazyWithRetry'

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
const FleetManagementTab = lazyWithRetry(() => import('./components/FleetManagementTab'))
const ScadenzeTab = lazyWithRetry(() => import('./components/ScadenzeTab'))
const ReportsTab = lazyWithRetry(() => import('./components/ReportsTab'))
const ReportLavaggioTab = lazyWithRetry(() => import('./components/ReportLavaggioTab'))
const ReportClientiTab = lazyWithRetry(() => import('./components/ReportClientiTab'))
const ReportTrafficTab = lazyWithRetry(() => import('./components/ReportTrafficTab'))
const ReportPenaliDanniTab = lazyWithRetry(() => import('./components/ReportPenaliDanniTab'))
const ReferralProgramTab = lazyWithRetry(() => import('./components/ReferralProgramTab'))
const CodiciScontoTab = lazyWithRetry(() => import('./components/CodiciScontoTab'))
const GestioneDanniTab = lazyWithRetry(() => import('./components/GestioneDanniTab'))
const CargosTab = lazyWithRetry(() => import('./components/CargosTab'))
const TrusteraTab = lazyWithRetry(() => import('./components/TrusteraTab'))
const CarWashCatalogTab = lazyWithRetry(() => import('./components/CarWashCatalogTab'))
const OperatoriTab = lazyWithRetry(() => import('./components/OperatoriTab'))
const RilevazioneOrariTab = lazyWithRetry(() => import('./components/RilevazioneOrariTab'))
const DashboardTab = lazyWithRetry(() => import('./components/DashboardTab'))
// RevenuePricingTab removed — replaced by CentralinaProTab
const ReportPreventiviTab = lazyWithRetry(() => import('./components/ReportPreventiviTab'))
const CentralinaProTab = lazyWithRetry(() => import('./components/CentralinaProTab'))
const SitoTab = lazyWithRetry(() => import('./components/SitoTab'))
const MaxiPromoGapTab = lazyWithRetry(() => import('./components/MaxiPromoGapTab'))
const PromoIncassiTab = lazyWithRetry(() => import('./components/PromoIncassiTab'))
const GestioneOtpTab = lazyWithRetry(() => import('./components/GestioneOtpTab'))
const DocumentsVerificationTab = lazyWithRetry(() => import('./components/DocumentsVerificationTab'))
const EMTNTab = lazyWithRetry(() => import('./components/EMTNTab'))
const GpsKeylessTab = lazyWithRetry(() => import('./components/GpsKeylessTab'))

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold"></div>
  </div>
)

type TabType = 'reservations' | 'report-preventivi' | 'customers' | 'vehicles' | 'calendar' | 'cauzioni' | 'carwash' | 'carwash-calendar' | 'carwash-catalog' |'fattura' | 'contratto' | 'unpaid' | 'marketing-pro' | 'campagna-marketing' | 'social-links' | 'reviews' | 'fleet' | 'scanner' | 'nexi' | 'birthdays' | 'scadenze' | 'reports' | 'bulk-import' | 'referral' | 'gestione-danni' | 'gestione-multe' | 'gps-keyless' | 'codice-sconto' | 'report-noleggio' | 'report-lavaggio' | 'report-clienti' | 'report-penali-danni' | 'customer-wallet' | 'com-email' | 'com-pec' | 'com-whatsapp' | 'com-sms' | 'com-chiamate' | 'com-chatgpt' | 'com-aruba' | 'cargos' | 'trustera' | 'emtn' | 'operatori' | 'rilevazione-orari' | 'dashboard-kpi' | 'revenue-pricing' | 'site-users' | 'centralina-pro' | 'maxi-promo-gap' | 'promo-incassi' | 'gestione-otp' | 'verifica-documenti' | 'fornitori' | 'report-traffic' | 'sito'

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
  const { role: adminRole, hasPermission, adminName, adminEmail } = useAdminRole()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { theme, toggleTheme, palette, setPalette } = useTheme()
  const [paletteMenuOpen, setPaletteMenuOpen] = useState(false)

  // Permission gate: a tab is restricted iff the operator's permissions[]
  // doesn't include it (and isn't '*' / direzione / superadmin).
  // useAdminRole.hasPermission encapsulates that logic and stays optimistic
  // while loading so we don't flash "Accesso non autorizzato" on mount.
  const isTabRestricted = (tab: TabType) => !hasPermission(tab)

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
  type SubTab = { tab: TabType; label: string; titleLabel?: string; superadminOnly?: boolean; subView?: 'bookings' | 'preventivi' }
  const [rentalSubView, setRentalSubView] = useState<'bookings' | 'preventivi'>('bookings')
  const SECTIONS: { name: string; tabs: SubTab[] }[] = [
    { name: 'Noleggio', tabs: [
      { tab: 'reservations', label: 'Noleggio', titleLabel: 'Prenotazioni', subView: 'bookings' },
      { tab: 'reservations', label: 'Preventivi', subView: 'preventivi' },
      { tab: 'calendar', label: 'Calendario' },
      { tab: 'contratto', label: 'Contratti' },
      { tab: 'gestione-danni', label: 'Danni & Penali' },
      { tab: 'gestione-multe', label: 'Multe' },
      { tab: 'cargos', label: 'Cargos' },
    ] },
    { name: 'Prime Wash', tabs: [
      { tab: 'carwash', label: 'Prenotazioni' },
      { tab: 'carwash-calendar', label: 'Calendario' },
      { tab: 'carwash-catalog', label: 'Catalogo' },
    ] },
    { name: 'Flotta', tabs: [
      { tab: 'vehicles', label: 'Veicoli' },
      { tab: 'fleet', label: 'Gestione Flotta' },
      { tab: 'gps-keyless', label: 'GPS Flotta' },
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
      { tab: 'maxi-promo-gap', label: 'Maxi Promo Gap' },
      { tab: 'promo-incassi', label: 'Promo Incassi' },
    ] },
    { name: 'Report', tabs: [
      { tab: 'report-noleggio', label: 'Noleggio' },
      { tab: 'report-lavaggio', label: 'Lavaggio' },
      { tab: 'report-clienti', label: 'Clienti' },
      { tab: 'report-penali-danni', label: 'Penali & Danni' },
      { tab: 'report-preventivi', label: 'Preventivi' },
      { tab: 'report-traffic', label: 'Rendimento Sito' },
      { tab: 'operatori', label: 'Operatori' },
      { tab: 'dashboard-kpi', label: 'Dashboard' },
    ] },
    { name: 'Comunicazione', tabs: [
      { tab: 'com-email', label: 'E-mail' },
      { tab: 'com-pec', label: 'PEC' },
      { tab: 'com-whatsapp', label: 'WhatsApp' },
      { tab: 'com-sms', label: 'SMS' },
      { tab: 'com-chiamate', label: 'Chiamate' },
      { tab: 'com-chatgpt', label: 'Chat GPT' },
      { tab: 'com-aruba', label: 'Aruba' },
    ] },
    { name: 'Amministrazione', tabs: [
      { tab: 'unpaid', label: 'In attesa di pagamento' },
      { tab: 'cauzioni', label: 'Cauzioni' },
      { tab: 'scadenze', label: 'Scadenze' },
      { tab: 'fattura', label: 'Fattura' },
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
    { name: 'Trustera', tabs: [
      { tab: 'trustera', label: 'Trustera' },
    ] },
    { name: 'E.M.T.N.', tabs: [
      { tab: 'emtn', label: 'E.M.T.N.' },
    ] },
  ]
  const sectionForActiveTab = SECTIONS.find(s => s.tabs.some(t => t.tab === activeTab)) || null
  const isSectionActive = (sectionName: string) => sectionForActiveTab?.name === sectionName

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
    'trustera': 'Trustera',
    'emtn': 'E.M.T.N.',
    'gestione-otp': 'Gestione OTP',
    'verifica-documenti': 'Verifica Documenti',
    'fornitori': 'Fornitori',
    'carwash': 'Prenotazioni Prime Wash',
    'carwash-calendar': 'Calendario Prime Wash',
    'carwash-catalog': 'Catalogo Prime Wash',
    'vehicles': 'Veicoli',
    'fleet': 'Gestione Flotta',
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
    'report-traffic': 'Rendimento Sito',
    'report-penali-danni': 'Report Penali & Danni',
    'customer-wallet': 'Credit Wallet',
    'site-users': 'Iscritti al Sito',
    'reports': 'Report',
    'com-email': 'E-mail',
    'com-pec': 'PEC',
    'com-whatsapp': 'WhatsApp',
    'com-sms': 'SMS',
    'com-chiamate': 'Chiamate',
    'com-chatgpt': 'Chat GPT',
    'com-aruba': 'Aruba',
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
        className={`fixed left-3 z-[70] w-[60vw] max-w-[180px] bg-theme-bg-primary flex flex-col rounded-3xl shadow-2xl shadow-black/40 overflow-hidden transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-[110%]'}`}
        style={{
          top: 'max(0.75rem, env(safe-area-inset-top))',
          bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* Logo + Close.
            The logo (2048×632, ratio ≈ 3.24:1) must NEVER be compressed
            horizontally. object-contain + matched max-width/max-height
            lets the browser preserve aspect ratio inside the sidebar's
            narrow ~140px inner panel without flex shrinking it. */}
        {/* Logo tile: bg SEMPRE nera in entrambi i temi cosi' il PNG (che
            ha sfondo nero) si fonde sempre. La X close usa colori chiari
            perche' sta sopra al nero. */}
        <div className="relative px-3 py-3 flex items-center justify-center bg-black">
          <img
            src="/DR7logo1.png"
            alt="DR7 A.I."
            className="max-h-10 max-w-[120px] w-auto h-auto object-contain"
          />
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-white/60 hover:text-white min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
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
        <nav className="flex-1 flex flex-col justify-evenly py-2 px-3 overflow-y-auto scrollbar-thin">
          {SECTIONS.map(section => {
            const visibleTabs = section.tabs.filter(t => hasPermission(t.tab) && (!t.superadminOnly || adminRole === 'superadmin'))
            if (visibleTabs.length === 0) return null
            const firstTab = visibleTabs[0].tab
            const sectionActive = isSectionActive(section.name)
            const showBirthdayBadge = section.name === 'Marketing' && birthdayCount > 0
            const showScartataBadge = section.name === 'Amministrazione' && scartataCount > 0
            return (
              <button
                key={section.name}
                onClick={() => {
                  if (!sectionActive) setActiveTab(firstTab)
                  setSidebarOpen(false)
                }}
                // Full-width clickable row, but the active highlight only
                // wraps the text — not the entire row. Text-only pill avoids
                // the oversized green block that spanned the full sidebar.
                className="w-full text-left flex items-center justify-between px-1 transition-colors group"
              >
                <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${sectionActive ? 'bg-gradient-to-r from-primary-dark via-primary to-primary-light text-white shadow-md shadow-dr7-gold/20' : 'text-theme-text-secondary group-hover:text-theme-text-primary group-hover:bg-dr7-gold/10'}`}>
                  {section.name}
                </span>
                {showBirthdayBadge && (
                  <span className="bg-dr7-gold/20 text-dr7-gold text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-2">{birthdayCount}</span>
                )}
                {showScartataBadge && (
                  <span className="bg-red-500/30 text-red-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-2" title={`${scartataCount} fattur${scartataCount === 1 ? 'a scartata' : 'e scartate'} dal SDI`}>
                    {scartataCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          {/* Alarm row: bell button (Attiva Allarmi) + gear opens the inventory.
              The gear is always visible so admins can review what alarms exist
              even after audio is enabled. */}
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
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-theme-text-primary p-2 min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center hover:bg-theme-bg-hover rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
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
                const sameTabEntries = sectionForActiveTab.tabs.filter(t => t.tab === activeTab)
                const subTab = sameTabEntries.length > 1
                  ? sameTabEntries.find(t => t.subView === rentalSubView)
                  : sameTabEntries[0]
                if (subTab) {
                  // Prefer the explicit titleLabel (e.g. Noleggio's bookings
                  // sub-view shows "Noleggio" in the bar but "Prenotazioni"
                  // in the title), then fall back to the bar label. Avoid
                  // "Noleggio Noleggio" by collapsing to the section name
                  // alone when the chosen label equals it.
                  const titleSub = subTab.titleLabel || subTab.label
                  if (titleSub.toLowerCase() === sectionForActiveTab.name.toLowerCase()) {
                    return sectionForActiveTab.name
                  }
                  return `${titleSub} ${sectionForActiveTab.name}`
                }
                return tabLabels[activeTab] || activeTab
              })()}
            </h2>
          </div>
          <div className="flex items-center gap-3">
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
              {paletteMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPaletteMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-theme-border bg-theme-bg-secondary shadow-lg z-50 overflow-hidden">
                    <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-theme-text-muted border-b border-theme-border">
                      Palette
                    </div>
                    {PALETTES.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setPalette(p.id); setPaletteMenuOpen(false) }}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          palette === p.id
                            ? 'bg-theme-bg-hover text-theme-text-primary'
                            : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <PalettePreview palette={p.id} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{p.label}</div>
                            <div className="text-[10px] text-theme-text-muted truncate">{p.description}</div>
                          </div>
                        </div>
                        {palette === p.id && (
                          <svg className="w-4 h-4 text-dr7-gold shrink-0" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="text-sm text-theme-text-secondary hidden lg:block">
              {new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>

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
                <div className="w-8 h-8 rounded-lg bg-dr7-gold/20 text-dr7-gold flex items-center justify-center text-xs font-bold border border-dr7-gold/30">
                  {(() => {
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
                    <div className="px-3 pb-2 border-b border-theme-border">
                      <div className="text-xs font-bold text-theme-text-primary truncate">{adminName || 'Operatore'}</div>
                      <div className="text-[11px] text-theme-text-muted truncate">{adminEmail || '—'}</div>
                      <div className="text-[10px] text-theme-text-muted mt-0.5">{adminRole === 'superadmin' ? 'Super Admin' : 'Admin'}</div>
                    </div>
                    {/* I miei orari — quick access to the operator's own
                        Rilevazione Orari tab. */}
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
            sub-tab so single-tab sections don't get a one-button bar. */}
        {sectionForActiveTab && sectionForActiveTab.tabs.filter(t => hasPermission(t.tab) && (!t.superadminOnly || adminRole === 'superadmin')).length > 1 && (
          <div className="bg-theme-bg-primary border-b border-theme-border overflow-x-auto scrollbar-thin sticky top-[60px] z-20">
            <div className="flex items-center gap-1 px-3 sm:px-6 lg:px-8">
              {sectionForActiveTab.tabs
                .filter(t => hasPermission(t.tab) && (!t.superadminOnly || adminRole === 'superadmin'))
                .map((t, idx) => {
                  const tabMatch = activeTab === t.tab
                  const subMatch = t.subView ? rentalSubView === t.subView : (t.tab !== 'reservations' || true)
                  const sameTabEntries = sectionForActiveTab.tabs.filter(x => x.tab === t.tab)
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
        <main className="flex-1 p-3 sm:p-6 lg:p-8 bg-theme-bg-secondary">
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
          {activeTab === 'fattura' && (isTabRestricted('fattura') ? <PlaceholderTab title="Accesso non autorizzato" /> : <FatturaTab />)}
          {activeTab === 'contratto' && <ContrattoTab />}
          {activeTab === 'cauzioni' && (isTabRestricted('cauzioni') ? <PlaceholderTab title="Accesso non autorizzato" /> : <CauzioniTab />)}
          {activeTab === 'birthdays' && <BirthdaysTab />}
          {activeTab === 'reviews' && <ReviewManagementTab />}
          {activeTab === 'marketing-pro' && <MessaggiSistemaProTab />}
          {activeTab === 'campagna-marketing' && <CampagnaMarketingTab />}
          {activeTab === 'social-links' && <SocialLinksTab />}
          {activeTab === 'fleet' && <FleetManagementTab />}
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
          {activeTab === 'report-traffic' && (isTabRestricted('report-traffic') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportTrafficTab />)}
          {activeTab === 'report-penali-danni' && <ReportPenaliDanniTab />}
          {activeTab === 'com-email' && <PlaceholderTab title="E-mail" />}
          {activeTab === 'com-pec' && <PlaceholderTab title="PEC" />}
          {activeTab === 'com-whatsapp' && <PlaceholderTab title="WhatsApp" />}
          {activeTab === 'com-sms' && <PlaceholderTab title="SMS" />}
          {activeTab === 'com-chiamate' && <PlaceholderTab title="Chiamate" />}
          {activeTab === 'com-chatgpt' && <PlaceholderTab title="Chat GPT" />}
          {activeTab === 'com-aruba' && <PlaceholderTab title="Aruba" />}
          {activeTab === 'operatori' && adminRole === 'superadmin' && <OperatoriTab />}
          {activeTab === 'rilevazione-orari' && <RilevazioneOrariTab />}
          {activeTab === 'dashboard-kpi' && <DashboardTab />}
          {activeTab === 'centralina-pro' && <CentralinaProTab />}
          {activeTab === 'sito' && <SitoTab />}
          {activeTab === 'maxi-promo-gap' && <MaxiPromoGapTab />}
          {activeTab === 'promo-incassi' && <PromoIncassiTab />}
          {activeTab === 'gestione-otp' && <GestioneOtpTab />}
          {activeTab === 'verifica-documenti' && <DocumentsVerificationTab />}
          {activeTab === 'fornitori' && <FornitoriTab />}
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
function PalettePreview({ palette }: { palette: Palette }) {
    const swatch: Record<Palette, { a: string; b: string; c: string }> = {
        dr7:      { a: '#19C2D6', b: '#4DE3F0', c: '#050708' },
        slate:    { a: '#3B82F6', b: '#1E293B', c: '#0F172A' },
        midnight: { a: '#6366F1', b: '#112236', c: '#0A1628' },
        graphite: { a: '#06B6D4', b: '#262626', c: '#1A1A1A' },
    }
    const s = swatch[palette]
    return (
        <div className="flex shrink-0 items-center -space-x-1.5">
            <span className="w-4 h-4 rounded-full border-2 border-theme-bg-secondary" style={{ backgroundColor: s.a }} />
            <span className="w-4 h-4 rounded-full border-2 border-theme-bg-secondary" style={{ backgroundColor: s.b }} />
            <span className="w-4 h-4 rounded-full border-2 border-theme-bg-secondary" style={{ backgroundColor: s.c }} />
        </div>
    )
}
