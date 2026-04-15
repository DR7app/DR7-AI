import { useState, useEffect, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
import RentalTabs from './components/RentalTabs'
import { useBirthdayCount } from './components/BirthdaysTab'
import PlaceholderTab from './components/PlaceholderTab'
import { useAdminRole } from '../../hooks/useAdminRole'
import { clearAdminCache } from '../../utils/logAdminAction'
import lazyWithRetry from '../../utils/lazyWithRetry'

// Lazy-load all tabs with automatic retry on chunk load failure (post-deploy resilience)
const CustomersTab = lazyWithRetry(() => import('./components/CustomersTab'))
const CustomerWalletTab = lazyWithRetry(() => import('./components/CustomerWalletTab'))
const SiteUsersTab = lazyWithRetry(() => import('./components/SiteUsersTab'))
const VehiclesTab = lazyWithRetry(() => import('./components/VehiclesTab'))
const CalendarTab = lazyWithRetry(() => import('./components/CalendarTab'))
const CarWashBookingsTab = lazyWithRetry(() => import('./components/CarWashBookingsTab'))
const CarWashCalendarTab = lazyWithRetry(() => import('./components/CarWashCalendarTab'))
const UnpaidBookingsTab = lazyWithRetry(() => import('./components/UnpaidBookingsTab'))
const MarketingTab = lazyWithRetry(() => import('./components/MarketingTab'))
const ReviewManagementTab = lazyWithRetry(() => import('./components/ReviewManagementTab'))
const FatturaTab = lazyWithRetry(() => import('./components/FatturaTab'))
const ContrattoTab = lazyWithRetry(() => import('./components/ContrattoTab'))
const GestioneMulteTab = lazyWithRetry(() => import('./components/GestioneMulteTab'))
const DailyCalendarModal = lazyWithRetry(() => import('./components/DailyCalendarModal'))
const ScannerTab = lazyWithRetry(() => import('./components/ScannerTab'))
const CauzioniTab = lazyWithRetry(() => import('./components/CauzioniTab'))
const NexiTab = lazyWithRetry(() => import('./components/NexiTab'))
const BirthdaysTab = lazyWithRetry(() => import('./components/BirthdaysTab'))
const FleetManagementTab = lazyWithRetry(() => import('./components/FleetManagementTab'))
const ScadenzeTab = lazyWithRetry(() => import('./components/ScadenzeTab'))
const ReportsTab = lazyWithRetry(() => import('./components/ReportsTab'))
const ReportLavaggioTab = lazyWithRetry(() => import('./components/ReportLavaggioTab'))
const ReportClientiTab = lazyWithRetry(() => import('./components/ReportClientiTab'))
const ReportPenaliDanniTab = lazyWithRetry(() => import('./components/ReportPenaliDanniTab'))
const BulkImportTab = lazyWithRetry(() => import('./components/BulkImportTab'))
const ReferralProgramTab = lazyWithRetry(() => import('./components/ReferralProgramTab'))
const CodiciScontoTab = lazyWithRetry(() => import('./components/CodiciScontoTab'))
const GestioneDanniTab = lazyWithRetry(() => import('./components/GestioneDanniTab'))
const CargosTab = lazyWithRetry(() => import('./components/CargosTab'))
const TrusteraTab = lazyWithRetry(() => import('./components/TrusteraTab'))
const CarWashCatalogTab = lazyWithRetry(() => import('./components/CarWashCatalogTab'))
const OperatoriTab = lazyWithRetry(() => import('./components/OperatoriTab'))
const DashboardTab = lazyWithRetry(() => import('./components/DashboardTab'))
const RevenuePricingTab = lazyWithRetry(() => import('./components/RevenuePricingTab'))
const ReportPreventiviTab = lazyWithRetry(() => import('./components/ReportPreventiviTab'))
const CentralinaProTab = lazyWithRetry(() => import('./components/CentralinaProTab'))

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold"></div>
  </div>
)

type TabType = 'reservations' | 'report-preventivi' | 'customers' | 'vehicles' | 'calendar' | 'cauzioni' | 'carwash' | 'carwash-calendar' | 'carwash-catalog' |'fattura' | 'contratto' | 'unpaid' | 'marketing' | 'reviews' | 'fleet' | 'scanner' | 'nexi' | 'birthdays' | 'scadenze' | 'reports' | 'bulk-import' | 'referral' | 'gestione-danni' | 'gestione-multe' | 'gps-keyless' | 'codice-sconto' | 'report-noleggio' | 'report-lavaggio' | 'report-clienti' | 'report-penali-danni' | 'customer-wallet' | 'com-email' | 'com-pec' | 'com-whatsapp' | 'com-sms' | 'com-chiamate' | 'com-chatgpt' | 'com-aruba' | 'cargos' | 'trustera' | 'operatori' | 'dashboard-kpi' | 'revenue-pricing' | 'site-users' | 'centralina-pro'

export default function AdminDashboard() {
  const [activeTab, _setActiveTab] = useState<TabType>('reservations')
  const [tabHistory, setTabHistory] = useState<TabType[]>([])
  const setActiveTab = (tab: TabType) => {
    setTabHistory(prev => [...prev.slice(-19), activeTab])
    _setActiveTab(tab)
  }
  const goBack = () => {
    if (tabHistory.length > 0) {
      const prev = tabHistory[tabHistory.length - 1]
      setTabHistory(h => h.slice(0, -1))
      _setActiveTab(prev)
    }
  }
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
  const { role: adminRole, canViewFinancials } = useAdminRole()

  // RBAC: tabs restricted to superadmin
  const financialTabs: TabType[] = ['fattura', 'nexi', 'unpaid', 'cauzioni']
  const adminOnlyTabs: TabType[] = ['bulk-import', 'reports', 'report-noleggio', 'report-lavaggio', 'report-clienti']
  const isTabRestricted = (tab: TabType) => {
    if (adminRole === 'superadmin') return false
    if (financialTabs.includes(tab) && !canViewFinancials) return true
    if (adminOnlyTabs.includes(tab)) return true
    return false
  }

  async function handleSignOut() {
    clearAdminCache()
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

  // Reusable style helpers for nav
  const sidebarItemClass = (isActive: boolean) =>
    `w-full text-left px-3 py-2 min-h-[44px] flex items-center rounded-lg text-sm font-medium transition-colors select-none touch-manipulation ${isActive ? 'bg-dr7-gold text-white' : 'text-white/60 hover:text-white hover:bg-[#243044] active:bg-[#243044]'}`
  const sidebarSectionClass = 'px-3 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider'

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
    'carwash': 'Prenotazioni Prime Wash',
    'carwash-calendar': 'Calendario Prime Wash',
    'carwash-catalog': 'Catalogo Prime Wash',
    'vehicles': 'Veicoli',
    'fleet': 'Gestione Flotta',
    'gps-keyless': 'GPS & Keyless',
    'unpaid': 'In attesa di pagamento',
    'customers': 'Lead',
    'birthdays': 'Compleanni',
    'reviews': 'Recensioni',
    'marketing': 'Messaggi di Sistema',
    'referral': 'Referral',
    'codice-sconto': 'Codice Sconto',
    'bulk-import': 'Import Clienti',
    'scanner': 'Scanner',
    'nexi': 'Nexi',
    'report-noleggio': 'Report Noleggio',
    'report-lavaggio': 'Report Lavaggio',
    'report-clienti': 'Report Clienti',
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
    'dashboard-kpi': 'Dashboard',
    'revenue-pricing': 'Centralina',
  }

  return (
    <div className="min-h-screen flex bg-theme-bg-secondary">
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — max-w-[280px] on mobile to leave space for closing */}
      <aside className={`fixed inset-y-0 left-0 z-[70] w-[85vw] max-w-[280px] bg-[#1a2332] flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo + Close */}
        <div className="px-5 py-4 bg-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/rentora-logo.jpeg" alt="Rentora" className="h-10 w-auto" />
            <div>
              <h1 className="text-[#1a2332] font-semibold text-sm tracking-wide">Operating Platform</h1>
              <p className="text-[#1a2332]/50 text-[10px] tracking-widest">A.I.</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="text-[#1a2332]/40 hover:text-[#1a2332] min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg -mr-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          <div className={sidebarSectionClass}>Noleggio</div>
          <button onClick={() => { setActiveTab('reservations'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'reservations')}>Prenotazioni</button>
          <button onClick={() => { setActiveTab('calendar'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'calendar')}>Calendario</button>
          <button onClick={() => { setActiveTab('cauzioni'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'cauzioni')}>Cauzioni</button>
          <button onClick={() => { setActiveTab('contratto'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'contratto')}>Contratti</button>
          <button onClick={() => { setActiveTab('gestione-danni'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'gestione-danni')}>Danni & Penali</button>
          <button onClick={() => { setActiveTab('gestione-multe'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'gestione-multe')}>Multe</button>
          <button onClick={() => { setActiveTab('cargos'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'cargos')}>Cargos</button>
          <button onClick={() => { setActiveTab('trustera'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'trustera')}>Trustera</button>

          <div className={sidebarSectionClass}>Prime Wash</div>
          <button onClick={() => { setActiveTab('carwash'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'carwash')}>Prenotazioni</button>
          <button onClick={() => { setActiveTab('carwash-calendar'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'carwash-calendar')}>Calendario</button>
          <button onClick={() => { setActiveTab('carwash-catalog'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'carwash-catalog')}>Catalogo</button>

          <div className={sidebarSectionClass}>Flotta</div>
          <button onClick={() => { setActiveTab('vehicles'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'vehicles')}>Veicoli</button>
          <button onClick={() => { setActiveTab('fleet'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'fleet')}>Gestione Flotta</button>
          <button onClick={() => { setActiveTab('gps-keyless'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'gps-keyless')}>GPS & Keyless</button>

          <div className={sidebarSectionClass}>Clienti</div>
          <button onClick={() => { setActiveTab('customers'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'customers')}>Lead</button>
          <button onClick={() => { setActiveTab('unpaid'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'unpaid')}>In attesa di pagamento</button>
          <button onClick={() => { setActiveTab('customer-wallet'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'customer-wallet')}>Credit Wallet</button>
          <button onClick={() => { setActiveTab('site-users'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'site-users')}>Iscritti al Sito</button>

          <div className={sidebarSectionClass}>Marketing</div>
          <button onClick={() => { setActiveTab('birthdays'); setSidebarOpen(false); }} className={`${sidebarItemClass(activeTab === 'birthdays')} flex items-center justify-between`}>
            <span>Compleanni</span>
            {birthdayCount > 0 && (
              <span className="bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{birthdayCount}</span>
            )}
          </button>
          <button onClick={() => { setActiveTab('reviews'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'reviews')}>Recensioni</button>
          <button onClick={() => { setActiveTab('marketing'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'marketing')}>Messaggi di Sistema</button>
          <button onClick={() => { setActiveTab('referral'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'referral')}>Referral</button>
          <button onClick={() => { setActiveTab('codice-sconto'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'codice-sconto')}>Codice Sconto</button>

          <div className={sidebarSectionClass}>Strumenti</div>
          <button onClick={() => { setActiveTab('scanner'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'scanner')}>Scanner</button>
          <button onClick={() => { setActiveTab('bulk-import'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'bulk-import')}>Import Clienti</button>
          <button onClick={() => { setActiveTab('nexi'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'nexi')}>Nexi</button>

          <div className={sidebarSectionClass}>Report</div>
          <button onClick={() => { setActiveTab('report-noleggio'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'report-noleggio')}>Noleggio</button>
          <button onClick={() => { setActiveTab('report-lavaggio'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'report-lavaggio')}>Lavaggio</button>
          <button onClick={() => { setActiveTab('report-clienti'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'report-clienti')}>Clienti</button>
          <button onClick={() => { setActiveTab('report-penali-danni'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'report-penali-danni')}>Penali & Danni</button>
          <button onClick={() => { setActiveTab('report-preventivi'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'report-preventivi')}>Preventivi</button>
          {adminRole === 'superadmin' && (
            <button onClick={() => { setActiveTab('operatori'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'operatori')}>Operatori</button>
          )}
          <button onClick={() => { setActiveTab('dashboard-kpi'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'dashboard-kpi')}>Dashboard</button>
          <button onClick={() => { setActiveTab('revenue-pricing'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'revenue-pricing')}>Centralina</button>

          <div className={sidebarSectionClass}>Comunicazione</div>
          <button onClick={() => { setActiveTab('com-email'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-email')}>E-mail</button>
          <button onClick={() => { setActiveTab('com-pec'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-pec')}>PEC</button>
          <button onClick={() => { setActiveTab('com-whatsapp'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-whatsapp')}>WhatsApp</button>
          <button onClick={() => { setActiveTab('com-sms'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-sms')}>SMS</button>
          <button onClick={() => { setActiveTab('com-chiamate'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-chiamate')}>Chiamate</button>
          <button onClick={() => { setActiveTab('com-chatgpt'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-chatgpt')}>Chat GPT</button>
          <button onClick={() => { setActiveTab('com-aruba'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'com-aruba')}>Aruba</button>

          <div className={sidebarSectionClass}>Altro</div>
          <button onClick={() => { setActiveTab('scadenze'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'scadenze')}>Scadenze</button>
          <button onClick={() => { setActiveTab('fattura'); setSidebarOpen(false); }} className={sidebarItemClass(activeTab === 'fattura')}>Fattura</button>
        </nav>

        {/* Bottom actions */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          <button
            onClick={() => setIsCalendarModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm text-white/60 hover:text-white hover:bg-[#243044] transition-colors"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Calendario Giornaliero
          </button>
          {!alarmState.audioEnabled && (
            <button
              onClick={enableAudio}
              className="w-full flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm text-white/60 hover:text-white hover:bg-[#243044] transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              Attiva Allarmi
            </button>
          )}
          <button
            onClick={() => { setActiveTab('centralina-pro'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm transition-colors ${
              activeTab === 'centralina-pro'
                ? 'bg-[#243044] text-white'
                : 'text-white/60 hover:text-white hover:bg-[#243044]'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Centralina Pro
          </button>
          <button
            onClick={() => { setShowPasswordModal(true); setPasswordMsg(null); setNewPassword(''); setConfirmPassword(''); }}
            className="w-full flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm text-white/60 hover:text-white hover:bg-[#243044] transition-colors"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Cambia Password
          </button>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm text-white/40 hover:text-red-400 hover:bg-[#243044] transition-colors"
          >
            Esci
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen w-full max-w-full">
        {/* Top Bar */}
        <header className="bg-theme-bg-primary border-b border-theme-border px-4 sm:px-8 py-4 flex justify-between items-center">
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
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-theme-bg-hover transition-colors text-theme-text-muted hover:text-theme-text-primary flex-shrink-0"
                aria-label="Indietro"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-lg sm:text-xl font-bold text-theme-text-primary truncate">
              {tabLabels[activeTab] || activeTab}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-theme-text-muted hidden sm:block">
              {new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-3 sm:p-6 lg:p-8 bg-theme-bg-secondary">
          <Suspense fallback={<TabLoader />}>
          <div>
          {activeTab === 'reservations' && (
            <RentalTabs
              initialData={initialReservationData}
              onDataConsumed={() => setInitialReservationData(null)}
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
          {activeTab === 'marketing' && <MarketingTab />}
          {activeTab === 'birthdays' && <BirthdaysTab />}
          {activeTab === 'reviews' && <ReviewManagementTab />}
          {activeTab === 'fleet' && <FleetManagementTab />}
          {activeTab === 'scanner' && <ScannerTab />}
          {activeTab === 'nexi' && (isTabRestricted('nexi') ? <PlaceholderTab title="Accesso non autorizzato" /> : <NexiTab />)}
          {activeTab === 'scadenze' && <ScadenzeTab />}
          {activeTab === 'reports' && (isTabRestricted('reports') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportsTab />)}
          {activeTab === 'report-noleggio' && (isTabRestricted('report-noleggio') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportsTab />)}
          {activeTab === 'bulk-import' && (isTabRestricted('bulk-import') ? <PlaceholderTab title="Accesso non autorizzato" /> : <BulkImportTab />)}
          {activeTab === 'referral' && <ReferralProgramTab />}
          {/* Placeholder tabs for new features */}
          {activeTab === 'gestione-danni' && <GestioneDanniTab />}
          {activeTab === 'gestione-multe' && <GestioneMulteTab />}
          {activeTab === 'cargos' && <CargosTab />}
          {activeTab === 'trustera' && <TrusteraTab />}
          {activeTab === 'gps-keyless' && <PlaceholderTab title="GPS & Keyless" />}
          {activeTab === 'codice-sconto' && <CodiciScontoTab />}
          {activeTab === 'report-lavaggio' && (isTabRestricted('report-lavaggio') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportLavaggioTab />)}
          {activeTab === 'report-clienti' && (isTabRestricted('report-clienti') ? <PlaceholderTab title="Accesso non autorizzato" /> : <ReportClientiTab />)}
          {activeTab === 'report-penali-danni' && <ReportPenaliDanniTab />}
          {activeTab === 'com-email' && <PlaceholderTab title="E-mail" />}
          {activeTab === 'com-pec' && <PlaceholderTab title="PEC" />}
          {activeTab === 'com-whatsapp' && <PlaceholderTab title="WhatsApp" />}
          {activeTab === 'com-sms' && <PlaceholderTab title="SMS" />}
          {activeTab === 'com-chiamate' && <PlaceholderTab title="Chiamate" />}
          {activeTab === 'com-chatgpt' && <PlaceholderTab title="Chat GPT" />}
          {activeTab === 'com-aruba' && <PlaceholderTab title="Aruba" />}
          {activeTab === 'operatori' && adminRole === 'superadmin' && <OperatoriTab />}
          {activeTab === 'dashboard-kpi' && <DashboardTab />}
          {activeTab === 'revenue-pricing' && <RevenuePricingTab />}
          {activeTab === 'centralina-pro' && <CentralinaProTab />}
          </div>
          </Suspense>
        </main>
      </div>

      {/* Daily Calendar Modal */}
      <Suspense fallback={null}>
        <DailyCalendarModal
          isOpen={isCalendarModalOpen}
          onClose={() => setIsCalendarModalOpen(false)}
        />
      </Suspense>

      {/* Password Change Modal */}
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
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nuova password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all"
                  placeholder="Min. 6 caratteri"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Conferma password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all"
                  placeholder="Ripeti password"
                />
              </div>
              {passwordMsg && (
                <div className={`px-4 py-3 rounded-full text-sm ${passwordMsg.type === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-500' : 'bg-red-500/10 border border-red-500/30 text-red-500'}`}>
                  {passwordMsg.text}
                </div>
              )}
              <button
                type="submit"
                disabled={passwordLoading}
                className="w-full bg-dr7-gold hover:bg-[#247a6f] text-white font-medium py-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wide"
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
