import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
import { useTheme } from '../../contexts/ThemeContext'
import ReservationsTab from './components/ReservationsTab'
import CustomersTab from './components/CustomersTab'
import CustomerWalletTab from './components/CustomerWalletTab'
import VehiclesTab from './components/VehiclesTab'
import CalendarTab from './components/CalendarTab'
import CarWashBookingsTab from './components/CarWashBookingsTab'
import CarWashCalendarTab from './components/CarWashCalendarTab'
import UnpaidBookingsTab from './components/UnpaidBookingsTab'
import MarketingTab from './components/MarketingTab'
import ReviewsTab from './components/ReviewsTab'
import FatturaTab from './components/FatturaTab'
import ContrattoTab from './components/ContrattoTab'
import GestioneMulteTab from './components/GestioneMulteTab'
import DailyCalendarModal from './components/DailyCalendarModal'
import ScannerTab from './components/ScannerTab'
import CauzioniTab from './components/CauzioniTab'
import NexiTab from './components/NexiTab'
import BirthdaysTab, { useBirthdayCount } from './components/BirthdaysTab'
import FleetManagementTab from './components/FleetManagementTab'
import ScadenzeTab from './components/ScadenzeTab'
import ReportsTab from './components/ReportsTab'
import ReportLavaggioTab from './components/ReportLavaggioTab'
import ReportClientiTab from './components/ReportClientiTab'
import ReportPenaliDanniTab from './components/ReportPenaliDanniTab'
import BulkImportTab from './components/BulkImportTab'
import ReferralProgramTab from './components/ReferralProgramTab'
import CodiciScontoTab from './components/CodiciScontoTab'
import GestioneDanniTab from './components/GestioneDanniTab'
import CargosTab from './components/CargosTab'
import TrusteraTab from './components/TrusteraTab'
import PlaceholderTab from './components/PlaceholderTab'
import CarWashCatalogTab from './components/CarWashCatalogTab'
import OperatoriTab from './components/OperatoriTab'
import DashboardTab from './components/DashboardTab'
import { useAdminRole } from '../../hooks/useAdminRole'
import { clearAdminCache } from '../../utils/logAdminAction'

type TabType = 'reservations' | 'customers' | 'vehicles' | 'calendar' | 'cauzioni' | 'carwash' | 'carwash-calendar' | 'carwash-catalog' |'fattura' | 'contratto' | 'unpaid' | 'marketing' | 'reviews' | 'fleet' | 'scanner' | 'nexi' | 'birthdays' | 'scadenze' | 'reports' | 'bulk-import' | 'referral' | 'gestione-danni' | 'gestione-multe' | 'gps-keyless' | 'codice-sconto' | 'report-noleggio' | 'report-lavaggio' | 'report-clienti' | 'report-penali-danni' | 'customer-wallet' | 'com-email' | 'com-pec' | 'com-whatsapp' | 'com-sms' | 'com-chiamate' | 'com-chatgpt' | 'com-aruba' | 'cargos' | 'trustera' | 'operatori' | 'dashboard-kpi'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('reservations')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  // State to pass data from Calendar to Reservations tab
  const [initialReservationData, setInitialReservationData] = useState<{ vehicleId?: string, pickupDate?: Date, bookingId?: string } | null>(null)
  // State to pass data from Car Wash Calendar to Car Wash Bookings tab
  const [initialCarWashData, setInitialCarWashData] = useState<{ appointmentDate?: string, appointmentTime?: string } | null>(null)

  const navigate = useNavigate()
  const { alarmState, enableAudio } = useVehicleAlarm()
  const { theme, toggleTheme } = useTheme()
  const birthdayCount = useBirthdayCount()
  const { role: adminRole } = useAdminRole()

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
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message || 'Errore durante l\'aggiornamento.' })
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
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileMenuOpen])

  useEffect(() => {
    const handleOpenBookingForm = (event: CustomEvent) => {
      const { vehicleId, date, bookingId } = event.detail
      handleCalendarBooking(vehicleId, date, bookingId)
    }

    window.addEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    return () => {
      window.removeEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    }
  }, [])

  // Reusable style helpers for nav
  const dropdownBtnClass = (isActive: boolean) =>
    `py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${isActive ? 'text-theme-text-primary' : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'}`
  const dropdownItemClass = (isActive: boolean) =>
    `w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${isActive ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-primary'}`
  const standaloneBtnClass = (isActive: boolean) =>
    `py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${isActive ? 'text-theme-text-primary' : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'}`
  const mobileItemClass = (isActive: boolean) =>
    `w-full text-left px-4 py-3 rounded-3xl transition-colors ${isActive ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`

  // Mobile tab labels
  const tabLabels: Record<string, string> = {
    'reservations': 'Prenotazioni Noleggio',
    'calendar': 'Calendario Noleggio',
    'cauzioni': 'Cauzioni',
    'contratto': 'Contratti',
    'gestione-danni': 'Gestione Danni & Penali & Penali',
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
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Gradient Background - same as login page */}
      <div className="fixed inset-0 bg-gradient-to-br from-theme-bg-primary via-theme-bg-primary to-theme-bg-secondary -z-10" />

      {/* Subtle overlay pattern */}
      <div className="fixed inset-0 opacity-5 -z-10" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />

      <header className="bg-theme-bg-primary backdrop-blur-md relative">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-theme-border/50 z-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2 lg:py-0 lg:h-24">
            <div className="flex items-center gap-1 sm:gap-4 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden text-theme-text-primary p-2 min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center hover:bg-theme-bg-hover rounded-3xl transition-colors"
                aria-label="Toggle menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
              <img src={theme === 'dark' ? '/rentora-dark.jpeg' : '/rentora-light.jpeg'} alt="DR7 Empire" className="h-10 sm:h-20 lg:h-28 flex-shrink-0" />
              <h1 className="hidden sm:block text-sm sm:text-base font-normal text-theme-text-primary tracking-widest">Operating Platform <span className="text-xs">A.I.</span></h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {!alarmState.audioEnabled && (
                <button
                  onClick={enableAudio}
                  className="px-3 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors flex items-center gap-2 text-sm"
                  title="Enable sound alerts for vehicle returns"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <span className="hidden sm:inline">Enable Sound Alerts</span>
                </button>
              )}
              <button
                onClick={() => setIsCalendarModalOpen(true)}
                className="px-3 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-full hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-blue-500/50 flex items-center gap-2 text-sm"
                title="Apri Calendario Giornaliero"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">Calendario Giornaliero</span>
              </button>
              <button
                onClick={toggleTheme}
                className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => { setShowPasswordModal(true); setPasswordMsg(null); setNewPassword(''); setConfirmPassword(''); }}
                className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                title="Cambia password"
                aria-label="Cambia password"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </button>
              <button
                onClick={handleSignOut}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors text-sm sm:text-base"
              >
                Esci
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      <div
        className={`lg:hidden fixed inset-0 z-50 transition-opacity duration-300 ${mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="absolute inset-0 bg-theme-overlay backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
        <div
          className={`relative bg-theme-bg-primary/95 backdrop-blur-xl w-72 h-full shadow-2xl overflow-y-auto border-r border-theme-border/50 transition-transform duration-300 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          onClick={(e) => e.stopPropagation()}
        >
            <div className="p-4 border-b border-theme-border/50 flex justify-between items-center">
              <h2 className="text-theme-text-primary font-semibold">Menu</h2>
              <button onClick={() => setMobileMenuOpen(false)} className="text-theme-text-muted hover:text-theme-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-2 space-y-1">
              {/* NOLEGGIO */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Noleggio</div>
              <button onClick={() => { setActiveTab('reservations'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'reservations')}>Prenotazioni</button>
              <button onClick={() => { setActiveTab('calendar'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'calendar')}>Calendario</button>
              <button onClick={() => { setActiveTab('cauzioni'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'cauzioni')}>Cauzioni</button>
              <button onClick={() => { setActiveTab('contratto'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'contratto')}>Contratti</button>
              <button onClick={() => { setActiveTab('gestione-danni'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'gestione-danni')}>Gestione Danni & Penali</button>
              <button onClick={() => { setActiveTab('gestione-multe'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'gestione-multe')}>Gestione Multe</button>
              <button onClick={() => { setActiveTab('cargos'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'cargos')}>Cargos</button>
              <button onClick={() => { setActiveTab('trustera'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'trustera')}>Trustera</button>

              {/* PRIME WASH */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Prime Wash</div>
              <button onClick={() => { setActiveTab('carwash'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'carwash')}>Prenotazioni</button>
              <button onClick={() => { setActiveTab('carwash-calendar'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'carwash-calendar')}>Calendario</button>
              <button onClick={() => { setActiveTab('carwash-catalog'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'carwash-catalog')}>Catalogo</button>


              {/* FLOTTA */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Flotta</div>
              <button onClick={() => { setActiveTab('vehicles'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'vehicles')}>Veicoli</button>
              <button onClick={() => { setActiveTab('fleet'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'fleet')}>Gestione Flotta</button>
              <button onClick={() => { setActiveTab('gps-keyless'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'gps-keyless')}>GPS & Keyless</button>

              {/* CLIENTI */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Clienti</div>
              <button onClick={() => { setActiveTab('customers'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'customers')}>Lead</button>
              <button onClick={() => { setActiveTab('unpaid'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'unpaid')}>In attesa di pagamento</button>
              <button onClick={() => { setActiveTab('customer-wallet'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'customer-wallet')}>Credit Wallet</button>

              {/* MARKETING */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Marketing</div>
              <button
                onClick={() => { setActiveTab('birthdays'); setMobileMenuOpen(false); }}
                className={`${mobileItemClass(activeTab === 'birthdays')} flex items-center justify-between`}
              >
                <span>Compleanni</span>
                {birthdayCount > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeTab === 'birthdays' ? 'bg-theme-bg-primary text-dr7-gold' : 'bg-dr7-gold text-black'}`}>
                    {birthdayCount}
                  </span>
                )}
              </button>
              <button onClick={() => { setActiveTab('reviews'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'reviews')}>Recensioni</button>
              <button onClick={() => { setActiveTab('marketing'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'marketing')}>Messaggi di Sistema</button>
              <button onClick={() => { setActiveTab('referral'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'referral')}>Referral</button>
              <button onClick={() => { setActiveTab('codice-sconto'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'codice-sconto')}>Codice Sconto</button>

              {/* SCANNER */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Scanner</div>
              <button onClick={() => { setActiveTab('scanner'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'scanner')}>Scanner</button>
              <button onClick={() => { setActiveTab('bulk-import'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'bulk-import')}>Import Clienti</button>

              {/* NEXI */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Nexi</div>
              <button onClick={() => { setActiveTab('nexi'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'nexi')}>Nexi</button>

              {/* REPORT */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Report</div>
              <button onClick={() => { setActiveTab('report-noleggio'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-noleggio')}>Noleggio</button>
              <button onClick={() => { setActiveTab('report-lavaggio'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-lavaggio')}>Lavaggio</button>
              <button onClick={() => { setActiveTab('report-clienti'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-clienti')}>Clienti</button>
              <button onClick={() => { setActiveTab('report-penali-danni'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-penali-danni')}>Penali & Danni</button>
              {adminRole === 'superadmin' && (
                <button onClick={() => { setActiveTab('operatori'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'operatori')}>Operatori</button>
              )}
              <button onClick={() => { setActiveTab('dashboard-kpi'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'dashboard-kpi')}>Dashboard</button>

              {/* COMUNICAZIONE */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Comunicazione</div>
              <button onClick={() => { setActiveTab('com-email'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-email')}>E-mail</button>
              <button onClick={() => { setActiveTab('com-pec'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-pec')}>PEC</button>
              <button onClick={() => { setActiveTab('com-whatsapp'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-whatsapp')}>WhatsApp</button>
              <button onClick={() => { setActiveTab('com-sms'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-sms')}>SMS</button>
              <button onClick={() => { setActiveTab('com-chiamate'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-chiamate')}>Chiamate</button>
              <button onClick={() => { setActiveTab('com-chatgpt'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-chatgpt')}>Chat GPT</button>
              <button onClick={() => { setActiveTab('com-aruba'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-aruba')}>Aruba</button>

              {/* SCADENZE */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Scadenze</div>
              <button onClick={() => { setActiveTab('scadenze'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'scadenze')}>Scadenze</button>

              {/* FATTURA */}
              <div className="px-4 pt-4 pb-1 text-xs font-bold text-theme-text-muted uppercase tracking-wider">Fattura</div>
              <button onClick={() => { setActiveTab('fattura'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'fattura')}>Fattura</button>
            </nav>
        </div>
      </div>

      <main className="max-w-[1920px] mx-auto px-3 sm:px-6 lg:px-8 py-4 lg:py-8">
        {/* Desktop Tabs */}
        <div className="mb-6 hidden lg:block relative z-50">
          <div>
            <nav className="-mb-px flex gap-4 flex-wrap">
              {/* NOLEGGIO Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(['reservations', 'calendar', 'cauzioni', 'contratto', 'gestione-danni', 'gestione-multe', 'cargos'].includes(activeTab))}>
                  Noleggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('reservations')} className={dropdownItemClass(activeTab === 'reservations')}>Prenotazioni</button>
                  <button onClick={() => setActiveTab('calendar')} className={dropdownItemClass(activeTab === 'calendar')}>Calendario</button>
                  <button onClick={() => setActiveTab('cauzioni')} className={dropdownItemClass(activeTab === 'cauzioni')}>Cauzioni</button>
                  <button onClick={() => setActiveTab('contratto')} className={dropdownItemClass(activeTab === 'contratto')}>Contratti</button>
                  <button onClick={() => setActiveTab('gestione-danni')} className={dropdownItemClass(activeTab === 'gestione-danni')}>Gestione Danni & Penali</button>
                  <button onClick={() => setActiveTab('gestione-multe')} className={dropdownItemClass(activeTab === 'gestione-multe')}>Gestione Multe</button>
                  <button onClick={() => setActiveTab('cargos')} className={dropdownItemClass(activeTab === 'cargos')}>Cargos</button>
                </div>
              </div>

              {/* PRIME WASH Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(['carwash', 'carwash-calendar', 'carwash-catalog'].includes(activeTab))}>

                  Prime Wash
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('carwash')} className={dropdownItemClass(activeTab === 'carwash')}>Prenotazioni</button>
                  <button onClick={() => setActiveTab('carwash-calendar')} className={dropdownItemClass(activeTab === 'carwash-calendar')}>Calendario</button>
                  <button onClick={() => setActiveTab('carwash-catalog')} className={dropdownItemClass(activeTab === 'carwash-catalog')}>Catalogo</button>
                </div>
              </div>

              {/* FLOTTA Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(activeTab === 'vehicles' || activeTab === 'fleet' || activeTab === 'gps-keyless')}>
                  Flotta
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('vehicles')} className={dropdownItemClass(activeTab === 'vehicles')}>Veicoli</button>
                  <button onClick={() => setActiveTab('fleet')} className={dropdownItemClass(activeTab === 'fleet')}>Gestione Flotta</button>
                  <button onClick={() => setActiveTab('gps-keyless')} className={dropdownItemClass(activeTab === 'gps-keyless')}>GPS & Keyless</button>
                </div>
              </div>

              {/* CLIENTI Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(['customers', 'unpaid', 'customer-wallet'].includes(activeTab))}>
                  Clienti
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-56 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('customers')} className={dropdownItemClass(activeTab === 'customers')}>Lead</button>
                  <button onClick={() => setActiveTab('unpaid')} className={dropdownItemClass(activeTab === 'unpaid')}>In attesa di pagamento</button>
                  <button onClick={() => setActiveTab('customer-wallet')} className={dropdownItemClass(activeTab === 'customer-wallet')}>Credit Wallet</button>
                </div>
              </div>

              {/* MARKETING Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(['birthdays', 'reviews', 'marketing', 'referral', 'codice-sconto'].includes(activeTab))}>
                  Marketing
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-56 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('birthdays')} className={`${dropdownItemClass(activeTab === 'birthdays')} flex items-center justify-between`}>
                    <span>Compleanni</span>
                    {birthdayCount > 0 && (
                      <span className="bg-dr7-gold text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
                        {birthdayCount}
                      </span>
                    )}
                  </button>
                  <button onClick={() => setActiveTab('reviews')} className={dropdownItemClass(activeTab === 'reviews')}>Recensioni</button>
                  <button onClick={() => setActiveTab('marketing')} className={dropdownItemClass(activeTab === 'marketing')}>Messaggi di Sistema</button>
                  <button onClick={() => setActiveTab('referral')} className={dropdownItemClass(activeTab === 'referral')}>Referral</button>
                  <button onClick={() => setActiveTab('codice-sconto')} className={dropdownItemClass(activeTab === 'codice-sconto')}>Codice Sconto</button>
                </div>
              </div>

              {/* SCANNER Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(activeTab === 'scanner' || activeTab === 'bulk-import')}>
                  Scanner
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('scanner')} className={dropdownItemClass(activeTab === 'scanner')}>Scanner</button>
                  <button onClick={() => setActiveTab('bulk-import')} className={dropdownItemClass(activeTab === 'bulk-import')}>Import Clienti</button>
                </div>
              </div>

              {/* NEXI - standalone */}
              <button onClick={() => setActiveTab('nexi')} className={standaloneBtnClass(activeTab === 'nexi')}>
                Nexi
              </button>

              {/* REPORT Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(['report-noleggio', 'report-lavaggio', 'report-clienti', 'report-penali-danni', 'reports', 'operatori', 'dashboard-kpi'].includes(activeTab))}>
                  Report
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('report-noleggio')} className={dropdownItemClass(activeTab === 'report-noleggio')}>Noleggio</button>
                  <button onClick={() => setActiveTab('report-lavaggio')} className={dropdownItemClass(activeTab === 'report-lavaggio')}>Lavaggio</button>
                  <button onClick={() => setActiveTab('report-clienti')} className={dropdownItemClass(activeTab === 'report-clienti')}>Clienti</button>
                  <button onClick={() => setActiveTab('report-penali-danni')} className={dropdownItemClass(activeTab === 'report-penali-danni')}>Penali & Danni</button>
                  {adminRole === 'superadmin' && (
                    <button onClick={() => setActiveTab('operatori')} className={dropdownItemClass(activeTab === 'operatori')}>Operatori</button>
                  )}
                  <button onClick={() => setActiveTab('dashboard-kpi')} className={dropdownItemClass(activeTab === 'dashboard-kpi')}>Dashboard</button>
                </div>
              </div>

              {/* COMUNICAZIONE Dropdown */}
              <div className="relative group">
                <button className={dropdownBtnClass(['com-email', 'com-pec', 'com-whatsapp', 'com-sms', 'com-chiamate', 'com-chatgpt', 'com-aruba'].includes(activeTab))}>
                  Comunicazione
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button onClick={() => setActiveTab('com-email')} className={dropdownItemClass(activeTab === 'com-email')}>E-mail</button>
                  <button onClick={() => setActiveTab('com-pec')} className={dropdownItemClass(activeTab === 'com-pec')}>PEC</button>
                  <button onClick={() => setActiveTab('com-whatsapp')} className={dropdownItemClass(activeTab === 'com-whatsapp')}>WhatsApp</button>
                  <button onClick={() => setActiveTab('com-sms')} className={dropdownItemClass(activeTab === 'com-sms')}>SMS</button>
                  <button onClick={() => setActiveTab('com-chiamate')} className={dropdownItemClass(activeTab === 'com-chiamate')}>Chiamate</button>
                  <button onClick={() => setActiveTab('com-chatgpt')} className={dropdownItemClass(activeTab === 'com-chatgpt')}>Chat GPT</button>
                  <button onClick={() => setActiveTab('com-aruba')} className={dropdownItemClass(activeTab === 'com-aruba')}>Aruba</button>
                </div>
              </div>

              {/* SCADENZE - standalone */}
              <button onClick={() => setActiveTab('scadenze')} className={standaloneBtnClass(activeTab === 'scadenze')}>
                Scadenze
              </button>

              {/* FATTURA - standalone */}
              <button onClick={() => setActiveTab('fattura')} className={standaloneBtnClass(activeTab === 'fattura')}>
                Fattura
              </button>

              {/* TRUSTERA - standalone */}
              <button onClick={() => setActiveTab('trustera')} className={standaloneBtnClass(activeTab === 'trustera')}>
                Trustera
              </button>
            </nav>
          </div>
        </div>

        {/* Mobile Tab Indicator */}
        <div className="mb-4 lg:hidden">
          <h2 className="text-xl font-bold text-theme-text-primary">
            {tabLabels[activeTab] || activeTab}
          </h2>
        </div>

        <div className="mt-4 lg:mt-8">
          {activeTab === 'reservations' && (
            <ReservationsTab
              initialData={initialReservationData}
              onDataConsumed={() => setInitialReservationData(null)}
            />
          )}
          {activeTab === 'unpaid' && <UnpaidBookingsTab />}
          {activeTab === 'customers' && <CustomersTab />}
          {activeTab === 'customer-wallet' && <CustomerWalletTab />}
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
          {activeTab === 'fattura' && <FatturaTab />}
          {activeTab === 'contratto' && <ContrattoTab />}
          {activeTab === 'cauzioni' && <CauzioniTab />}
          {activeTab === 'marketing' && <MarketingTab />}
          {activeTab === 'birthdays' && <BirthdaysTab />}
          {activeTab === 'reviews' && <ReviewsTab />}
          {activeTab === 'fleet' && <FleetManagementTab />}
          {activeTab === 'scanner' && <ScannerTab />}
          {activeTab === 'nexi' && <NexiTab />}
          {activeTab === 'scadenze' && <ScadenzeTab />}
          {activeTab === 'reports' && <ReportsTab />}
          {activeTab === 'report-noleggio' && <ReportsTab />}
          {activeTab === 'bulk-import' && <BulkImportTab />}
          {activeTab === 'referral' && <ReferralProgramTab />}
          {/* Placeholder tabs for new features */}
          {activeTab === 'gestione-danni' && <GestioneDanniTab />}
          {activeTab === 'gestione-multe' && <GestioneMulteTab />}
          {activeTab === 'cargos' && <CargosTab />}
          {activeTab === 'trustera' && <TrusteraTab />}
          {activeTab === 'gps-keyless' && <PlaceholderTab title="GPS & Keyless" />}
          {activeTab === 'codice-sconto' && <CodiciScontoTab />}
          {activeTab === 'report-lavaggio' && <ReportLavaggioTab />}
          {activeTab === 'report-clienti' && <ReportClientiTab />}
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
        </div>
      </main>

      {/* Daily Calendar Modal */}
      <DailyCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
      />

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
                className="w-full bg-dr7-gold hover:bg-yellow-500 text-black font-medium py-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wide"
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
