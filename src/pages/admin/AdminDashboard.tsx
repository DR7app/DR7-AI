import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'
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
import DailyCalendarModal from './components/DailyCalendarModal'

import FleetManagementTab from './components/FleetManagementTab'

type TabType = 'reservations' | 'customers' | 'vehicles' | 'calendar' | 'carwash' | 'carwash-calendar' | 'mechanical' | 'mechanical-calendar' | 'lotteria' | 'fattura' | 'contratto' | 'unpaid' | 'documents-verification' | 'marketing' | 'reviews' | 'fleet'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('reservations')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false)
  // State to pass data from Calendar to Reservations tab
  const [initialReservationData, setInitialReservationData] = useState<{ vehicleName?: string, pickupDate?: Date } | null>(null)

  const navigate = useNavigate()
  const { alarmState, enableAudio } = useVehicleAlarm()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  function handleCalendarBooking(vehicleName: string, date: Date) {
    setInitialReservationData({ vehicleName, pickupDate: date })
    setActiveTab('reservations')
  }

  useEffect(() => {
    const handleOpenBookingForm = (event: CustomEvent) => {
      const { vehicleName, date } = event.detail
      handleCalendarBooking(vehicleName, date)
    }

    window.addEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    return () => {
      window.removeEventListener('openBookingForm', handleOpenBookingForm as EventListener)
    }
  }, [])

  return (
    <div className="min-h-screen bg-black">
      <header className="bg-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden text-white p-2 hover:bg-gray-800 rounded-3xl transition-colors"
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
              <img src="/DR7logo1.png" alt="DR7 Empire" className="h-8 sm:h-10" />
              <h1 className="text-lg sm:text-2xl font-bold text-white">DR7 Control Room</h1>
            </div>
            <div className="flex items-center gap-3">
              {!alarmState.audioEnabled && (
                <button
                  onClick={enableAudio}
                  className="px-3 py-2 bg-dr7-gold text-black font-semibold rounded-lg hover:bg-yellow-500 transition-colors flex items-center gap-2 text-sm"
                  title="Enable sound alerts for vehicle returns"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <span className="hidden sm:inline">Enable Sound Alerts</span>
                </button>
              )}
              <button
                onClick={handleSignOut}
                className="text-gray-400 hover:text-white transition-colors text-sm sm:text-base"
              >
                Esci
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black bg-opacity-75" onClick={() => setMobileMenuOpen(false)}>
          <div className="bg-gray-900 w-64 h-full shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-white font-semibold">Menu</h2>
              <button onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-2 space-y-1">
              <button
                onClick={() => setActiveTab('reservations')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'reservations' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Noleggio
              </button>
              <button
                onClick={() => setActiveTab('carwash')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'carwash' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Prenotazioni Lavaggio
              </button>
              <button
                onClick={() => setActiveTab('mechanical')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'mechanical' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Prenotazioni Meccanica
              </button>
              <button
                onClick={() => setActiveTab('unpaid')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'unpaid' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Da Saldare
              </button>
              <button
                onClick={() => setActiveTab('documents-verification')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'documents-verification' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Verifica Documenti
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'customers' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Clienti
              </button>
              <button
                onClick={() => setActiveTab('vehicles')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'vehicles' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => setActiveTab('fleet')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'fleet' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Gestione Flotta
              </button>
              <button
                onClick={() => setActiveTab('calendar')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Calendario Noleggio
              </button>
              <button
                onClick={() => setActiveTab('carwash-calendar')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'carwash-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Calendario Lavaggi
              </button>
              <button
                onClick={() => setActiveTab('mechanical-calendar')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'mechanical-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Calendario Meccanica
              </button>
              <button
                onClick={() => setActiveTab('lotteria')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'lotteria' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Biglietti Lotteria
              </button>
              <button
                onClick={() => setActiveTab('fattura')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'fattura' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Fatture
              </button>
              <button
                onClick={() => setActiveTab('contratto')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'contratto' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Contratti
              </button>
              <button
                onClick={() => setActiveTab('marketing')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'marketing' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Marketing
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`w-full text-left px-4 py-3 rounded-3xl transition-colors ${activeTab === 'reviews' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Recensioni
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
                  className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'reservations' || activeTab === 'calendar'
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                    }`}
                >
                  Noleggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-900 border border-gray-700 rounded-b-3xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => setActiveTab('reservations')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'reservations' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Noleggio
                  </button>
                  <button
                    onClick={() => setActiveTab('calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors rounded-b-3xl ${activeTab === 'calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Lavaggio Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'carwash' || activeTab === 'carwash-calendar'
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                    }`}
                >
                  Lavaggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-900 border border-gray-700 rounded-b-3xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => setActiveTab('carwash')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'carwash' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Prenotazioni
                  </button>
                  <button
                    onClick={() => setActiveTab('carwash-calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors rounded-b-3xl ${activeTab === 'carwash-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
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
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                    }`}
                >
                  Meccanica
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-900 border border-gray-700 rounded-b-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => setActiveTab('mechanical')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'mechanical' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Prenotazioni
                  </button>
                  <button
                    onClick={() => setActiveTab('mechanical-calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors rounded-b-3xl ${activeTab === 'mechanical-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Other menu items */}
              <button
                onClick={() => setActiveTab('unpaid')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'unpaid'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Da Saldare
              </button>
              <button
                onClick={() => setActiveTab('documents-verification')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'documents-verification'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Verifica Documenti
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'customers'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Clienti
              </button>
              <button
                onClick={() => setActiveTab('vehicles')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'vehicles'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => setActiveTab('fleet')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'fleet'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Gestione Flotta
              </button>
              <button
                onClick={() => setActiveTab('lotteria')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'lotteria'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Lotteria
              </button>
              <button
                onClick={() => setActiveTab('fattura')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'fattura'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Fatture
              </button>
              <button
                onClick={() => setActiveTab('contratto')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'contratto'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Contratti
              </button>
              <button
                onClick={() => setActiveTab('marketing')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'marketing'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Marketing
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`py-4 px-3 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'reviews'
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
              >
                Recensioni
              </button>
            </nav>
          </div>
        </div>

        {/* Mobile Tab Indicator */}
        <div className="mb-4 lg:hidden">
          <h2 className="text-xl font-bold text-white">
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
            {activeTab === 'marketing' && 'Marketing'}
            {activeTab === 'reviews' && 'Recensioni'}
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
          {activeTab === 'carwash' && <CarWashBookingsTab />}
          {activeTab === 'carwash-calendar' && <CarWashCalendarTab />}
          {activeTab === 'mechanical' && <MechanicalBookingTab />}
          {activeTab === 'mechanical-calendar' && <MechanicalCalendarTab />}
          {activeTab === 'lotteria' && <LotteriaBoard />}
          {activeTab === 'fattura' && <FatturaTab />}
          {activeTab === 'contratto' && <ContrattoTab />}
          {activeTab === 'marketing' && <MarketingTab />}
          {activeTab === 'reviews' && <ReviewsTab />}
          {activeTab === 'fleet' && <FleetManagementTab />}
        </div>
      </main>

      {/* Floating Action Button for Daily Calendar */}
      <button
        onClick={() => setIsCalendarModalOpen(true)}
        className="fixed bottom-8 right-8 z-40 w-16 h-16 rounded-full bg-gradient-to-br from-dr7-gold to-yellow-600 shadow-2xl shadow-dr7-gold/50 flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-dr7-gold/70 group"
        title="Calendario Giornaliero"
      >
        <svg className="w-8 h-8 text-black transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {/* Daily Calendar Modal */}
      <DailyCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
      />
    </div>
  )
}
