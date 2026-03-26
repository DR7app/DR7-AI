import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
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
import RevenuePricingTab from './components/RevenuePricingTab'
import { useAdminRole } from '../../hooks/useAdminRole'
import { clearAdminCache } from '../../utils/logAdminAction'

type TabType = 'reservations' | 'customers' | 'vehicles' | 'calendar' | 'cauzioni' | 'carwash' | 'carwash-calendar' | 'carwash-catalog' |'fattura' | 'contratto' | 'unpaid' | 'marketing' | 'reviews' | 'fleet' | 'scanner' | 'nexi' | 'birthdays' | 'scadenze' | 'reports' | 'bulk-import' | 'referral' | 'gestione-danni' | 'gestione-multe' | 'gps-keyless' | 'codice-sconto' | 'report-noleggio' | 'report-lavaggio' | 'report-clienti' | 'report-penali-danni' | 'customer-wallet' | 'com-email' | 'com-pec' | 'com-whatsapp' | 'com-sms' | 'com-chiamate' | 'com-chatgpt' | 'com-aruba' | 'cargos' | 'trustera' | 'operatori' | 'dashboard-kpi' | 'revenue-pricing'

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
  const sidebarItemClass = (isActive: boolean) =>
    `w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-dr7-gold text-white' : 'text-white/60 hover:text-white hover:bg-[#243044]'}`
  const sidebarSectionClass = 'px-3 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider'
  const mobileItemClass = (isActive: boolean) =>
    `w-full text-left px-4 py-3 rounded-3xl transition-colors ${isActive ? 'bg-dr7-gold text-white font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`

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
    'revenue-pricing': 'Revenue Management',
  }

  return (
    <div className="min-h-screen flex bg-theme-bg-secondary">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#1a2332] flex-col flex-shrink-0 fixed inset-y-0 left-0 z-40">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/rentora-logo.jpeg" alt="Rentora" className="h-10 w-auto" />
            <h1 className="text-white font-medium text-sm tracking-widest">Operating Platform <span className="text-[10px]">A.I.</span></h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          <div className={sidebarSectionClass}>Noleggio</div>
          <button onClick={() => setActiveTab('reservations')} className={sidebarItemClass(activeTab === 'reservations')}>Prenotazioni</button>
          <button onClick={() => setActiveTab('calendar')} className={sidebarItemClass(activeTab === 'calendar')}>Calendario</button>
          <button onClick={() => setActiveTab('cauzioni')} className={sidebarItemClass(activeTab === 'cauzioni')}>Cauzioni</button>
          <button onClick={() => setActiveTab('contratto')} className={sidebarItemClass(activeTab === 'contratto')}>Contratti</button>
          <button onClick={() => setActiveTab('gestione-danni')} className={sidebarItemClass(activeTab === 'gestione-danni')}>Danni & Penali</button>
          <button onClick={() => setActiveTab('gestione-multe')} className={sidebarItemClass(activeTab === 'gestione-multe')}>Multe</button>
          <button onClick={() => setActiveTab('cargos')} className={sidebarItemClass(activeTab === 'cargos')}>Cargos</button>
          <button onClick={() => setActiveTab('trustera')} className={sidebarItemClass(activeTab === 'trustera')}>Trustera</button>

          <div className={sidebarSectionClass}>Prime Wash</div>
          <button onClick={() => setActiveTab('carwash')} className={sidebarItemClass(activeTab === 'carwash')}>Prenotazioni</button>
          <button onClick={() => setActiveTab('carwash-calendar')} className={sidebarItemClass(activeTab === 'carwash-calendar')}>Calendario</button>
          <button onClick={() => setActiveTab('carwash-catalog')} className={sidebarItemClass(activeTab === 'carwash-catalog')}>Catalogo</button>

          <div className={sidebarSectionClass}>Flotta</div>
          <button onClick={() => setActiveTab('vehicles')} className={sidebarItemClass(activeTab === 'vehicles')}>Veicoli</button>
          <button onClick={() => setActiveTab('fleet')} className={sidebarItemClass(activeTab === 'fleet')}>Gestione Flotta</button>
          <button onClick={() => setActiveTab('gps-keyless')} className={sidebarItemClass(activeTab === 'gps-keyless')}>GPS & Keyless</button>

          <div className={sidebarSectionClass}>Clienti</div>
          <button onClick={() => setActiveTab('customers')} className={sidebarItemClass(activeTab === 'customers')}>Lead</button>
          <button onClick={() => setActiveTab('unpaid')} className={sidebarItemClass(activeTab === 'unpaid')}>In attesa di pagamento</button>
          <button onClick={() => setActiveTab('customer-wallet')} className={sidebarItemClass(activeTab === 'customer-wallet')}>Credit Wallet</button>

          <div className={sidebarSectionClass}>Marketing</div>
          <button onClick={() => setActiveTab('birthdays')} className={`${sidebarItemClass(activeTab === 'birthdays')} flex items-center justify-between`}>
            <span>Compleanni</span>
            {birthdayCount > 0 && (
              <span className="bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{birthdayCount}</span>
            )}
          </button>
          <button onClick={() => setActiveTab('reviews')} className={sidebarItemClass(activeTab === 'reviews')}>Recensioni</button>
          <button onClick={() => setActiveTab('marketing')} className={sidebarItemClass(activeTab === 'marketing')}>Messaggi di Sistema</button>
          <button onClick={() => setActiveTab('referral')} className={sidebarItemClass(activeTab === 'referral')}>Referral</button>
          <button onClick={() => setActiveTab('codice-sconto')} className={sidebarItemClass(activeTab === 'codice-sconto')}>Codice Sconto</button>

          <div className={sidebarSectionClass}>Strumenti</div>
          <button onClick={() => setActiveTab('scanner')} className={sidebarItemClass(activeTab === 'scanner')}>Scanner</button>
          <button onClick={() => setActiveTab('bulk-import')} className={sidebarItemClass(activeTab === 'bulk-import')}>Import Clienti</button>
          <button onClick={() => setActiveTab('nexi')} className={sidebarItemClass(activeTab === 'nexi')}>Nexi</button>

          <div className={sidebarSectionClass}>Report</div>
          <button onClick={() => setActiveTab('report-noleggio')} className={sidebarItemClass(activeTab === 'report-noleggio')}>Noleggio</button>
          <button onClick={() => setActiveTab('report-lavaggio')} className={sidebarItemClass(activeTab === 'report-lavaggio')}>Lavaggio</button>
          <button onClick={() => setActiveTab('report-clienti')} className={sidebarItemClass(activeTab === 'report-clienti')}>Clienti</button>
          <button onClick={() => setActiveTab('report-penali-danni')} className={sidebarItemClass(activeTab === 'report-penali-danni')}>Penali & Danni</button>
          {adminRole === 'superadmin' && (
            <button onClick={() => setActiveTab('operatori')} className={sidebarItemClass(activeTab === 'operatori')}>Operatori</button>
          )}
          <button onClick={() => setActiveTab('dashboard-kpi')} className={sidebarItemClass(activeTab === 'dashboard-kpi')}>Dashboard</button>
          <button onClick={() => setActiveTab('revenue-pricing')} className={sidebarItemClass(activeTab === 'revenue-pricing')}>Revenue Management</button>

          <div className={sidebarSectionClass}>Comunicazione</div>
          <button onClick={() => setActiveTab('com-email')} className={sidebarItemClass(activeTab === 'com-email')}>E-mail</button>
          <button onClick={() => setActiveTab('com-pec')} className={sidebarItemClass(activeTab === 'com-pec')}>PEC</button>
          <button onClick={() => setActiveTab('com-whatsapp')} className={sidebarItemClass(activeTab === 'com-whatsapp')}>WhatsApp</button>
          <button onClick={() => setActiveTab('com-sms')} className={sidebarItemClass(activeTab === 'com-sms')}>SMS</button>
          <button onClick={() => setActiveTab('com-chiamate')} className={sidebarItemClass(activeTab === 'com-chiamate')}>Chiamate</button>
          <button onClick={() => setActiveTab('com-chatgpt')} className={sidebarItemClass(activeTab === 'com-chatgpt')}>Chat GPT</button>
          <button onClick={() => setActiveTab('com-aruba')} className={sidebarItemClass(activeTab === 'com-aruba')}>Aruba</button>

          <div className={sidebarSectionClass}>Altro</div>
          <button onClick={() => setActiveTab('scadenze')} className={sidebarItemClass(activeTab === 'scadenze')}>Scadenze</button>
          <button onClick={() => setActiveTab('fattura')} className={sidebarItemClass(activeTab === 'fattura')}>Fattura</button>
        </nav>

        {/* Bottom actions */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          <button
            onClick={() => setIsCalendarModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-[#243044] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Calendario Giornaliero
          </button>
          {!alarmState.audioEnabled && (
            <button
              onClick={enableAudio}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-[#243044] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              Attiva Allarmi
            </button>
          )}
          <button
            onClick={() => { setShowPasswordModal(true); setPasswordMsg(null); setNewPassword(''); setConfirmPassword(''); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-[#243044] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Cambia Password
          </button>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/40 hover:text-red-400 hover:bg-[#243044] transition-colors"
          >
            Esci
          </button>
        </div>
      </aside>

      {/* Mobile Menu */}
      <div
        className={`lg:hidden fixed inset-0 z-50 transition-opacity duration-300 ${mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
        <div
          className={`relative bg-[#1a2332] w-72 h-full shadow-2xl overflow-y-auto transition-transform duration-300 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          onClick={(e) => e.stopPropagation()}
        >
            <div className="p-4 border-b border-white/10 flex justify-between items-center">
              <img src="/rentora-logo.jpeg" alt="Rentora" className="h-8 w-auto" />
              <button onClick={() => setMobileMenuOpen(false)} className="text-white/40 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-2 space-y-1">
              {/* NOLEGGIO */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Noleggio</div>
              <button onClick={() => { setActiveTab('reservations'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'reservations')}>Prenotazioni</button>
              <button onClick={() => { setActiveTab('calendar'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'calendar')}>Calendario</button>
              <button onClick={() => { setActiveTab('cauzioni'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'cauzioni')}>Cauzioni</button>
              <button onClick={() => { setActiveTab('contratto'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'contratto')}>Contratti</button>
              <button onClick={() => { setActiveTab('gestione-danni'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'gestione-danni')}>Danni & Penali</button>
              <button onClick={() => { setActiveTab('gestione-multe'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'gestione-multe')}>Multe</button>
              <button onClick={() => { setActiveTab('cargos'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'cargos')}>Cargos</button>
              <button onClick={() => { setActiveTab('trustera'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'trustera')}>Trustera</button>

              {/* PRIME WASH */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Prime Wash</div>
              <button onClick={() => { setActiveTab('carwash'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'carwash')}>Prenotazioni</button>
              <button onClick={() => { setActiveTab('carwash-calendar'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'carwash-calendar')}>Calendario</button>
              <button onClick={() => { setActiveTab('carwash-catalog'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'carwash-catalog')}>Catalogo</button>

              {/* FLOTTA */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Flotta</div>
              <button onClick={() => { setActiveTab('vehicles'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'vehicles')}>Veicoli</button>
              <button onClick={() => { setActiveTab('fleet'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'fleet')}>Gestione Flotta</button>
              <button onClick={() => { setActiveTab('gps-keyless'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'gps-keyless')}>GPS & Keyless</button>

              {/* CLIENTI */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Clienti</div>
              <button onClick={() => { setActiveTab('customers'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'customers')}>Lead</button>
              <button onClick={() => { setActiveTab('unpaid'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'unpaid')}>In attesa di pagamento</button>
              <button onClick={() => { setActiveTab('customer-wallet'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'customer-wallet')}>Credit Wallet</button>

              {/* MARKETING */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Marketing</div>
              <button
                onClick={() => { setActiveTab('birthdays'); setMobileMenuOpen(false); }}
                className={`${mobileItemClass(activeTab === 'birthdays')} flex items-center justify-between`}
              >
                <span>Compleanni</span>
                {birthdayCount > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeTab === 'birthdays' ? 'bg-theme-bg-primary text-dr7-gold' : 'bg-dr7-gold text-white'}`}>
                    {birthdayCount}
                  </span>
                )}
              </button>
              <button onClick={() => { setActiveTab('reviews'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'reviews')}>Recensioni</button>
              <button onClick={() => { setActiveTab('marketing'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'marketing')}>Messaggi di Sistema</button>
              <button onClick={() => { setActiveTab('referral'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'referral')}>Referral</button>
              <button onClick={() => { setActiveTab('codice-sconto'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'codice-sconto')}>Codice Sconto</button>

              {/* STRUMENTI */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Strumenti</div>
              <button onClick={() => { setActiveTab('scanner'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'scanner')}>Scanner</button>
              <button onClick={() => { setActiveTab('bulk-import'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'bulk-import')}>Import Clienti</button>
              <button onClick={() => { setActiveTab('nexi'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'nexi')}>Nexi</button>

              {/* REPORT */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Report</div>
              <button onClick={() => { setActiveTab('report-noleggio'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-noleggio')}>Noleggio</button>
              <button onClick={() => { setActiveTab('report-lavaggio'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-lavaggio')}>Lavaggio</button>
              <button onClick={() => { setActiveTab('report-clienti'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-clienti')}>Clienti</button>
              <button onClick={() => { setActiveTab('report-penali-danni'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'report-penali-danni')}>Penali & Danni</button>
              {adminRole === 'superadmin' && (
                <button onClick={() => { setActiveTab('operatori'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'operatori')}>Operatori</button>
              )}
              <button onClick={() => { setActiveTab('dashboard-kpi'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'dashboard-kpi')}>Dashboard</button>
              <button onClick={() => { setActiveTab('revenue-pricing'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'revenue-pricing')}>Revenue Management</button>

              {/* COMUNICAZIONE */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Comunicazione</div>
              <button onClick={() => { setActiveTab('com-email'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-email')}>E-mail</button>
              <button onClick={() => { setActiveTab('com-pec'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-pec')}>PEC</button>
              <button onClick={() => { setActiveTab('com-whatsapp'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-whatsapp')}>WhatsApp</button>
              <button onClick={() => { setActiveTab('com-sms'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-sms')}>SMS</button>
              <button onClick={() => { setActiveTab('com-chiamate'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-chiamate')}>Chiamate</button>
              <button onClick={() => { setActiveTab('com-chatgpt'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-chatgpt')}>Chat GPT</button>
              <button onClick={() => { setActiveTab('com-aruba'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'com-aruba')}>Aruba</button>

              {/* ALTRO */}
              <div className="px-4 pt-4 pb-1 text-[10px] font-bold text-white/30 uppercase tracking-wider">Altro</div>
              <button onClick={() => { setActiveTab('scadenze'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'scadenze')}>Scadenze</button>
              <button onClick={() => { setActiveTab('fattura'); setMobileMenuOpen(false); }} className={mobileItemClass(activeTab === 'fattura')}>Fattura</button>
            </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-64">
        {/* Top Bar */}
        <header className="bg-theme-bg-primary border-b border-theme-border px-4 sm:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden text-theme-text-primary p-2 min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center hover:bg-theme-bg-hover rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {tabHistory.length > 0 && (
              <button
                onClick={goBack}
                className="p-2 rounded-lg hover:bg-theme-bg-hover transition-colors text-theme-text-muted hover:text-theme-text-primary flex-shrink-0"
                aria-label="Indietro"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-xl font-bold text-theme-text-primary">
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
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div>
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
          {activeTab === 'revenue-pricing' && <RevenuePricingTab />}
          </div>
        </main>
      </div>

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
