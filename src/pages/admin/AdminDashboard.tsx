import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
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

type TabType = 'reservations' | 'customers' | 'vehicles' | 'calendar' | 'carwash' | 'carwash-calendar' | 'mechanical' | 'mechanical-calendar' | 'lotteria' | 'fattura' | 'contratto' | 'unpaid' | 'documents-verification' | 'marketing' | 'reviews'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('reservations')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-black">
      <header className="bg-gray-900 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden text-white p-2 hover:bg-gray-800 rounded transition-colors"
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
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-white transition-colors text-sm sm:text-base"
            >
              Esci
            </button>
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
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'reservations' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Car Rental
              </button>
              <button
                onClick={() => setActiveTab('carwash')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'carwash' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Prenotazioni Lavaggio
              </button>
              <button
                onClick={() => setActiveTab('mechanical')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'mechanical' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Prenotazioni Meccanica
              </button>
              <button
                onClick={() => setActiveTab('unpaid')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'unpaid' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Da Saldare
              </button>
              <button
                onClick={() => setActiveTab('documents-verification')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'documents-verification' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Verifica Documenti
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'customers' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Clienti
              </button>
              <button
                onClick={() => setActiveTab('vehicles')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'vehicles' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => setActiveTab('calendar')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Calendario Noleggio
              </button>
              <button
                onClick={() => setActiveTab('carwash-calendar')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'carwash-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Calendario Lavaggi
              </button>
              <button
                onClick={() => setActiveTab('mechanical-calendar')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'mechanical-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Calendario Meccanica
              </button>
              <button
                onClick={() => setActiveTab('lotteria')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'lotteria' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Biglietti Lotteria
              </button>
              <button
                onClick={() => setActiveTab('fattura')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'fattura' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Fatture
              </button>
              <button
                onClick={() => setActiveTab('contratto')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'contratto' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Contratti
              </button>
              <button
                onClick={() => setActiveTab('marketing')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'marketing' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
                  }`}
              >
                Marketing
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'reviews' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300 hover:bg-gray-800'
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
          <div className="border-b border-gray-800">
            <nav className="-mb-px flex gap-4">
              {/* Noleggio Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'reservations' || activeTab === 'calendar'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                >
                  Noleggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-900 border border-gray-700 rounded-b-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => setActiveTab('reservations')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'reservations' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Car Rental
                  </button>
                  <button
                    onClick={() => setActiveTab('calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors rounded-b-lg ${activeTab === 'calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Lavaggio Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'carwash' || activeTab === 'carwash-calendar'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                >
                  Lavaggio
                  <span className="text-xs">▼</span>
                </button>
                <div className="absolute left-0 mt-0 w-48 bg-gray-900 border border-gray-700 rounded-b-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => setActiveTab('carwash')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'carwash' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Prenotazioni
                  </button>
                  <button
                    onClick={() => setActiveTab('carwash-calendar')}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors rounded-b-lg ${activeTab === 'carwash-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Meccanica Dropdown */}
              <div className="relative group">
                <button
                  className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 ${activeTab === 'mechanical' || activeTab === 'mechanical-calendar'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
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
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-800 transition-colors rounded-b-lg ${activeTab === 'mechanical-calendar' ? 'bg-dr7-gold text-black font-semibold' : 'text-gray-300'
                      }`}
                  >
                    Calendario
                  </button>
                </div>
              </div>

              {/* Other menu items */}
              <button
                onClick={() => setActiveTab('unpaid')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'unpaid'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Da Saldare
              </button>
              <button
                onClick={() => setActiveTab('documents-verification')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'documents-verification'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Verifica Documenti
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'customers'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Clienti
              </button>
              <button
                onClick={() => setActiveTab('vehicles')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'vehicles'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => setActiveTab('lotteria')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'lotteria'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Lotteria
              </button>
              <button
                onClick={() => setActiveTab('fattura')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'fattura'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Fatture
              </button>
              <button
                onClick={() => setActiveTab('contratto')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'contratto'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Contratti
              </button>
              <button
                onClick={() => setActiveTab('marketing')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'marketing'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
              >
                Marketing
              </button>
              <button
                onClick={() => setActiveTab('reviews')}
                className={`py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === 'reviews'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
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
            {activeTab === 'reservations' && 'Car Rental'}
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
          {activeTab === 'reservations' && <ReservationsTab />}
          {activeTab === 'unpaid' && <UnpaidBookingsTab />}
          {activeTab === 'documents-verification' && <DocumentsVerificationTab />}
          {activeTab === 'customers' && <CustomersTab />}
          {activeTab === 'vehicles' && <VehiclesTab />}
          {activeTab === 'calendar' && <CalendarTab />}
          {activeTab === 'carwash' && <CarWashBookingsTab />}
          {activeTab === 'carwash-calendar' && <CarWashCalendarTab />}
          {activeTab === 'mechanical' && <MechanicalBookingTab />}
          {activeTab === 'mechanical-calendar' && <MechanicalCalendarTab />}
          {activeTab === 'lotteria' && <LotteriaBoard />}
          {activeTab === 'fattura' && <FatturaTab />}
          {activeTab === 'contratto' && <ContrattoTab />}
          {activeTab === 'marketing' && <MarketingTab />}
          {activeTab === 'reviews' && <ReviewsTab />}
        </div>
      </main>
    </div>
  )
}
