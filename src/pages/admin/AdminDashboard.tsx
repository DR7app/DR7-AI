import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useNavigate } from 'react-router-dom'
import CustomersTab from './components/CustomersTab'
import FleetTab from './components/FleetTab'
import DocumentsVerificationTab from './components/DocumentsVerificationTab'
import MarketingTab from './components/MarketingTab'
import ReviewsTab from './components/ReviewsTab'
import OverviewTab from './components/OverviewTab'
import RentalTabs from './components/RentalTabs'
import AdminManagementTab from './components/AdminManagementTab'
import UnpaidTab from './components/UnpaidTab'
import ContrattiTab from './components/ContrattiTab'
import PaymentsTab from './components/PaymentsTab'
import LotteryTicketsTab from './components/LotteryTicketsTab'
import MechanicalBookingTab from './components/MechanicalBookingTab'
import MechanicalCalendarTab from './components/MechanicalCalendarTab'
import CarWashBookingTab from './components/CarWashBookingTab'
import CarWashCalendarTab from './components/CarWashCalendarTab'
import { useAdminRole } from '../../hooks/useAdminRole'

type TabType = 'overview' | 'rentals' | 'customers' | 'fleet' | 'admins' | 'verify' | 'unpaid' | 'contratti' | 'payments' | 'tickets' | 'marketing' | 'mechanical_bookings' | 'mechanical_calendar' | 'car_wash_bookings' | 'car_wash_calendar' | 'reviews'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()
  // Add missing hook for roles
  const { canManageFleet, canManageAdmins } = useAdminRole()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const tabs: { id: TabType; label: string; access?: boolean }[] = [
    { id: 'overview', label: 'Panoramica' },
    { id: 'rentals', label: 'Noleggi' },
    { id: 'customers', label: 'Clienti' },
    { id: 'fleet', label: 'Flotta', access: canManageFleet },
    { id: 'admins', label: 'Admin', access: canManageAdmins },
    { id: 'verify', label: 'Verifiche' },
    { id: 'unpaid', label: 'Da Saldare' },
    { id: 'contratti', label: 'Contratti' },
    { id: 'payments', label: 'Pagamenti' },
    { id: 'tickets', label: 'Lotteria' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'reviews', label: 'Recensioni' },
    { id: 'mechanical_bookings', label: 'Pren. Meccanica' },
    { id: 'mechanical_calendar', label: 'Cal. Meccanica' },
    { id: 'car_wash_bookings', label: 'Pren. Lavaggio' },
    { id: 'car_wash_calendar', label: 'Cal. Lavaggio' },
  ]

  const visibleTabs = tabs.filter(t => t.access !== false)

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
              {visibleTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setMobileMenuOpen(false)
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === tab.id
                      ? 'bg-dr7-gold text-black font-semibold'
                      : 'text-gray-300 hover:bg-gray-800'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Desktop Tabs - Simple horizontal scrollable list for now to fix build */}
        <div className="mb-6 hidden lg:block overflow-x-auto pb-2">
          <div className="border-b border-gray-800">
            <nav className="-mb-px flex gap-4">
              {visibleTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === tab.id
                      ? 'border-white text-white'
                      : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Mobile Tab Indicator */}
        <div className="mb-4 lg:hidden">
          <h2 className="text-xl font-bold text-white">
            {visibleTabs.find(t => t.id === activeTab)?.label}
          </h2>
        </div>

        <div className="p-4 sm:p-8 bg-gray-900/50 rounded-2xl border border-gray-800 min-h-[500px]">
          {activeTab === 'overview' && <OverviewTab onTabChange={setActiveTab} />}
          {activeTab === 'rentals' && <RentalTabs />}
          {activeTab === 'customers' && <CustomersTab />}
          {activeTab === 'fleet' && canManageFleet && <FleetTab />}
          {activeTab === 'admins' && canManageAdmins && <AdminManagementTab />}
          {activeTab === 'verify' && <DocumentsVerificationTab />}
          {activeTab === 'unpaid' && <UnpaidTab />}
          {activeTab === 'contratti' && <ContrattiTab />}
          {activeTab === 'payments' && <PaymentsTab />}
          {activeTab === 'tickets' && <LotteryTicketsTab />}
          {activeTab === 'marketing' && <MarketingTab />}
          {activeTab === 'mechanical_bookings' && <MechanicalBookingTab />}
          {activeTab === 'mechanical_calendar' && <MechanicalCalendarTab />}
          {activeTab === 'car_wash_bookings' && <CarWashBookingTab />}
          {activeTab === 'car_wash_calendar' && <CarWashCalendarTab />}
          {activeTab === 'reviews' && <ReviewsTab />}
        </div>
      </main>
    </div>
  )
}
