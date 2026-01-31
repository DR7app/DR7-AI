import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
import { useTheme } from '../../contexts/ThemeContext'
import ReservationsTab from './components/ReservationsTab'
import CustomersTab from './components/CustomersTab'
import VehiclesTab from './components/VehiclesTab'
import CalendarTab from './components/CalendarTab'
import CarWashBookingsTab from './components/CarWashBookingsTab'
import CarWashCalendarTab from './components/CarWashCalendarTab'
import MechanicalBookingTab from './components/MechanicalBookingTab'
import MechanicalCalendarTab from './components/MechanicalCalendarTab'
import LotteriaBoard from './components/LotteriaBoard'
import UnpaidBookingsTab from './components/UnpaidBookingsTab'
import DocumentsVerificationTab from './components/DocumentsVerificationTab'
import MarketingTab from './components/MarketingTab'
import ReviewsTab from './components/ReviewsTab'
import FatturaTab from './components/FatturaTab'
import ContrattoTab from './components/ContrattoTab'
import CargosTab from './components/CargosTab'
import DailyCalendarModal from './components/DailyCalendarModal'
import ScannerTab from './components/ScannerTab'
import CauzioniTab from './components/CauzioniTab'
import NexiTab from './components/NexiTab'
import BirthdaysTab, { useBirthdayCount } from './components/BirthdaysTab'

import FleetManagementTab from './components/FleetManagementTab'
import ScadenzeTab from './components/ScadenzeTab'

type TabType = 'reservations' | 'customers' | 'vehicles' | 'calendar' | 'cauzioni' | 'carwash' | 'carwash-calendar' | 'mechanical' | 'mechanical-calendar' | 'lotteria' | 'fattura' | 'contratto' | 'cargos' | 'unpaid' | 'documents-verification' | 'marketing' | 'reviews' | 'fleet' | 'scanner' | 'nexi' | 'birthdays' | 'scadenze'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('reservations')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false)
  // State to pass data from Calendar to Reservations tab
  const [initialReservationData, setInitialReservationData] = useState<{ vehicleName?: string, pickupDate?: Date, bookingId?: string } | null>(null)
  // State to pass data from Car Wash Calendar to Car Wash Bookings tab
  const [initialCarWashData, setInitialCarWashData] = useState<{ appointmentDate?: string, appointmentTime?: string } | null>(null)

  const navigate = useNavigate()
  const { alarmState, enableAudio } = useVehicleAlarm()
  const { theme, toggleTheme } = useTheme()
  const birthdayCount = useBirthdayCount()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  function handleCalendarBooking(vehicleName: string, date: Date, bookingId?: string) {
    setInitialReservationData({ vehicleName, pickupDate: date, bookingId })
    setActiveTab('reservations')
  }

  function handleCarWashCalendarBooking(date: string, time: string) {
    setInitialCarWashData({ appointmentDate: date, appointmentTime: time })
    setActiveTab('carwash')
  }

  useEffect(() => {
    const handleOpenBookingForm = (event: CustomEvent) => {
      const { vehicleName, date, bookingId } = event.detail
      handleCalendarBooking(vehicleName, date, bookingId)
    }

    window.addEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    return () => {
      window.removeEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    }
  }, [])

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Gradient Background - same as login page */}
      <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800 -z-10" />

      {/* Subtle overlay pattern */}
      <div className="fixed inset-0 opacity-5 -z-10" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />

      <header className="bg-black backdrop-blur-md border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-24">
            <div className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden text-theme-text-primary p-2 hover:bg-theme-bg-hover rounded-3xl transition-colors"
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
              <img src="/rentora.jpeg" alt="DR7 Empire" className="h-16 sm:h-20" />
              <h1 className="text-sm sm:text-base font-normal text-theme-text-primary tracking-widest">Management Platform</h1>
            </div>
            <div className="flex items-center gap-3">
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
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
          <div className="bg-gray-900/95 backdrop-blur-xl w-64 h-full shadow-2xl overflow-y-auto border-r border-gray-700/50" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-700/50 flex justify-between items-center">
              <h2 className="text-white font-semibold">Menu</h2>
              <button onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-2 space-y-1">
              <button
                onClick={() => { setActiveTab('reservations'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'reservations' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Noleggio
              </button>
              <button
                onClick={() => { setActiveTab('carwash'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'carwash' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Prenotazioni Lavaggio
              </button>
              <button
                onClick={() => { setActiveTab('mechanical'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'mechanical' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Prenotazioni Meccanica
              </button>
              <button
                onClick={() => { setActiveTab('unpaid'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'unpaid' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Da Saldare
              </button>
              <button
                onClick={() => { setActiveTab('documents-verification'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'documents-verification' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Verifica Documenti
              </button>
              <button
                onClick={() => { setActiveTab('customers'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'customers' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Clienti
              </button>
              <button
                onClick={() => { setActiveTab('vehicles'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'vehicles' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => { setActiveTab('fleet'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'fleet' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Gestione Flotta
              </button>
              <button
                onClick={() => { setActiveTab('calendar'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Calendario Noleggio
              </button>
              <button
                onClick={() => { setActiveTab('cauzioni'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'cauzioni' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Cauzioni
              </button>
              <button
                onClick={() => { setActiveTab('carwash-calendar'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'carwash-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Calendario Lavaggi
              </button>
              <button
                onClick={() => { setActiveTab('mechanical-calendar'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'mechanical-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Calendario Meccanica
              </button>
              <button
                onClick={() => { setActiveTab('lotteria'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'lotteria' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Biglietti Lotteria
              </button>
              <button
                onClick={() => { setActiveTab('fattura'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'fattura' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Fatture
              </button>
              <button
                onClick={() => { setActiveTab('contratto'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'contratto' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Contratti
              </button>
              <button
                onClick={() => { setActiveTab('cargos'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'cargos' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Cargos
              </button>
              <button
                onClick={() => { setActiveTab('marketing'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'marketing' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Marketing
              </button>
              <button
                onClick={() => { setActiveTab('birthdays'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors flex items-center justify-between ${activeTab === 'birthdays' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                <span>Compleanni</span>
                {birthdayCount > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeTab === 'birthdays' ? 'bg-black text-dr7-gold' : 'bg-dr7-gold text-black'}`}>
                    {birthdayCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('reviews'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'reviews' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Recensioni
              </button>
              <button
                onClick={() => { setActiveTab('scanner'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'scanner' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Scanner
              </button>
              <button
                onClick={() => { setActiveTab('scadenze'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'scadenze' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
              >
                Scadenze
              </button>
            </nav>
          </div>
        </div>
      )}

      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Desktop Tabs */}
        <div className="mb-6 hidden lg:block relative z-50">
          <div>
            <nav className="-mb-px flex gap-4">
              {/* Noleggio Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'reservations' || activeTab === 'calendar' || activeTab === 'cauzioni' || activeTab === 'contratto' || activeTab === 'cargos'
                    ? 'text-theme-text-primary'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                    }`}
                >
                  Noleggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button
                    onClick={() => setActiveTab('reservations')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'reservations' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Prenotazioni
                  </button>
                  <button
                    onClick={() => setActiveTab('calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Calendario
                  </button>
                  <button
                    onClick={() => setActiveTab('cauzioni')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'cauzioni' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Cauzioni
                  </button>
                  <button
                    onClick={() => setActiveTab('contratto')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'contratto' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Contratti
                  </button>
                  <button
                    onClick={() => setActiveTab('cargos')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'cargos' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Cargos
                  </button>
                </div>
              </div>

              {/* Lavaggio Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'carwash' || activeTab === 'carwash-calendar'
                    ? 'text-theme-text-primary'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                    }`}
                >
                  Lavaggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button
                    onClick={() => setActiveTab('carwash')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'carwash' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Prenotazioni
                  </button>
                  <button
                    onClick={() => setActiveTab('carwash-calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'carwash-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Meccanica Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'mechanical' || activeTab === 'mechanical-calendar'
                    ? 'text-theme-text-primary'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                    }`}
                >
                  Meccanica
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button
                    onClick={() => setActiveTab('mechanical')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'mechanical' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Prenotazioni
                  </button>
                  <button
                    onClick={() => setActiveTab('mechanical-calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'mechanical-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Flotta Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'vehicles' || activeTab === 'fleet'
                    ? 'text-theme-text-primary'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                    }`}
                >
                  Flotta
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100]">
                  <button
                    onClick={() => setActiveTab('vehicles')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'vehicles' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Veicoli
                  </button>
                  <button
                    onClick={() => setActiveTab('fleet')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-theme-bg-hover transition-colors rounded-full ${activeTab === 'fleet' ? 'bg-dr7-gold text-black font-semibold' : 'text-white'
                      }`}
                  >
                    Gestione Flotta
                  </button>
                </div>
              </div>

              {/* Other menu items */}
              <button
                onClick={() => setActiveTab('unpaid')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'unpaid'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Da Saldare
              </button>
              <button
                onClick={() => setActiveTab('documents-verification')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'documents-verification'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Verifica Documenti
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'customers'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Clienti
              </button>
              <button
                onClick={() => setActiveTab('lotteria')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'lotteria'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Lotteria
              </button>
              <button
                onClick={() => setActiveTab('fattura')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'fattura'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Fatture
              </button>
              <button
                onClick={() => setActiveTab('marketing')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'marketing'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Marketing
              </button>
              <button
                onClick={() => setActiveTab('birthdays')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'birthdays'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Compleanni
                {birthdayCount > 0 && (
                  <span className="bg-dr7-gold text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {birthdayCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'reviews'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Recensioni
              </button>
              <button
                onClick={() => setActiveTab('scanner')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'scanner'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Scanner
              </button>
              <button
                onClick={() => setActiveTab('nexi')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'nexi'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Nexi
              </button>
              <button
                onClick={() => setActiveTab('scadenze')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'scadenze'
                  ? 'text-theme-text-primary'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
              >
                Scadenze
              </button>
            </nav>
          </div>
        </div>

        {/* Mobile Tab Indicator */}
        <div className="mb-4 lg:hidden">
          <h2 className="text-xl font-bold text-theme-text-primary">
            {activeTab === 'reservations' && 'Noleggio'}
            {activeTab === 'carwash' && 'Prenotazioni Lavaggio'}
            {activeTab === 'mechanical' && 'Prenotazioni Meccanica'}
            {activeTab === 'unpaid' && 'Da Saldare'}
            {activeTab === 'documents-verification' && 'Verifica Documenti'}
            {activeTab === 'customers' && 'Clienti'}
            {activeTab === 'vehicles' && 'Veicoli'}
            {activeTab === 'calendar' && 'Calendario Noleggio'}
            {activeTab === 'carwash-calendar' && 'Calendario Lavaggi'}
            {activeTab === 'mechanical-calendar' && 'Calendario Meccanica'}
            {activeTab === 'lotteria' && 'Biglietti Lotteria'}
            {activeTab === 'fattura' && 'Fatture'}
            {activeTab === 'contratto' && 'Contratti'}
            {activeTab === 'cargos' && 'Cargos'}
            {activeTab === 'cauzioni' && 'Cauzioni'}
            {activeTab === 'marketing' && 'Marketing'}
            {activeTab === 'birthdays' && 'Compleanni'}
            {activeTab === 'reviews' && 'Recensioni'}
            {activeTab === 'scanner' && 'Scanner Documenti'}
            {activeTab === 'nexi' && 'Nexi'}
            {activeTab === 'scadenze' && 'Scadenze'}
          </h2>
        </div>

        <div className="mt-8">
          {activeTab === 'reservations' && (
            <ReservationsTab
              initialData={initialReservationData}
              onDataConsumed={() => setInitialReservationData(null)}
            />
          )}
          {activeTab === 'unpaid' && <UnpaidBookingsTab />}
          {activeTab === 'documents-verification' && <DocumentsVerificationTab />}
          {activeTab === 'customers' && <CustomersTab />}
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
          {activeTab === 'mechanical' && <MechanicalBookingTab />}
          {activeTab === 'mechanical-calendar' && <MechanicalCalendarTab />}
          {activeTab === 'lotteria' && <LotteriaBoard />}
          {activeTab === 'fattura' && <FatturaTab />}
          {activeTab === 'contratto' && <ContrattoTab />}
          {activeTab === 'cargos' && <CargosTab />}
          {activeTab === 'cauzioni' && <CauzioniTab />}
          {activeTab === 'marketing' && <MarketingTab />}
          {activeTab === 'birthdays' && <BirthdaysTab />}
          {activeTab === 'reviews' && <ReviewsTab />}
          {activeTab === 'fleet' && <FleetManagementTab />}
          {activeTab === 'scanner' && <ScannerTab />}
          {activeTab === 'nexi' && <NexiTab />}
          {activeTab === 'scadenze' && <ScadenzeTab />}
        </div>
      </main>

      {/* Daily Calendar Modal */}
      <DailyCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
      />
    </div>
  )
}
