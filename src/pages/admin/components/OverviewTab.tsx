import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

type TabType = 'overview' | 'rentals' | 'customers' | 'fleet' | 'admins' | 'verify' | 'unpaid' | 'contratti' | 'payments' | 'tickets' | 'marketing' | 'mechanical_bookings' | 'mechanical_calendar' | 'car_wash_bookings' | 'car_wash_calendar' | 'reviews'

interface OverviewTabProps {
    onTabChange: (tab: TabType) => void
}

export default function OverviewTab({ onTabChange }: OverviewTabProps) {
    const [stats, setStats] = useState({
        totalCustomers: 0,
        activeRentals: 0,
        unpaidBookings: 0,
        pendingVerifications: 0,
    })
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadStats()
    }, [])

    async function loadStats() {
        try {
            setLoading(true)

            // Get total customers
            const { count: customersCount } = await supabase
                .from('customers_extended')
                .select('*', { count: 'exact', head: true })

            // Get active rentals (bookings with status 'confermata' or 'in_corso')
            const { count: activeRentalsCount } = await supabase
                .from('bookings')
                .select('*', { count: 'exact', head: true })
                .in('status', ['confermata', 'in_corso'])

            // Get unpaid bookings
            const { count: unpaidCount } = await supabase
                .from('bookings')
                .select('*', { count: 'exact', head: true })
                .eq('payment_status', 'parziale')

            // Get pending verifications
            const { count: verificationsCount } = await supabase
                .from('verification_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending')

            setStats({
                totalCustomers: customersCount || 0,
                activeRentals: activeRentalsCount || 0,
                unpaidBookings: unpaidCount || 0,
                pendingVerifications: verificationsCount || 0,
            })
        } catch (error) {
            console.error('Error loading stats:', error)
        } finally {
            setLoading(false)
        }
    }

    const statCards: Array<{
        title: string
        value: number
        tab: TabType
        color: string
    }> = [
            {
                title: 'Clienti Totali',
                value: stats.totalCustomers,
                tab: 'customers' as const,
                color: 'from-blue-500 to-blue-600',
            },
            {
                title: 'Noleggi Attivi',
                value: stats.activeRentals,
                tab: 'rentals' as const,
                color: 'from-green-500 to-green-600',
            },
            {
                title: 'Da Saldare',
                value: stats.unpaidBookings,
                tab: 'unpaid' as const,
                color: 'from-yellow-500 to-yellow-600',
            },
            {
                title: 'Verifiche Pendenti',
                value: stats.pendingVerifications,
                tab: 'verify' as const,
                color: 'from-red-500 to-red-600',
            },
        ]

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-theme-text-primary text-lg">Caricamento...</div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-theme-text-primary mb-6">Panoramica</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statCards.map((card) => (
                    <button
                        key={card.tab}
                        onClick={() => onTabChange(card.tab)}
                        className={`bg-gradient-to-br ${card.color} p-6 rounded-full shadow-lg hover:shadow-xl transition-all transform hover:scale-105`}
                    >
                        <h3 className="text-theme-text-primary text-sm font-medium mb-2">{card.title}</h3>
                        <p className="text-theme-text-primary text-4xl font-bold">{card.value}</p>
                    </button>
                ))}
            </div>

            <div className="mt-8 bg-theme-bg-tertiary p-6 rounded-full">
                <h3 className="text-xl font-semibold text-theme-text-primary mb-4">Azioni Rapide</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <button
                        onClick={() => onTabChange('rentals')}
                        className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary p-4 rounded-full transition-colors text-left"
                    >
                        <div className="font-semibold">Gestisci Noleggi</div>
                        <div className="text-sm text-theme-text-secondary mt-1">Visualizza e modifica prenotazioni</div>
                    </button>
                    <button
                        onClick={() => onTabChange('customers')}
                        className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary p-4 rounded-full transition-colors text-left"
                    >
                        <div className="font-semibold">Gestisci Clienti</div>
                        <div className="text-sm text-theme-text-secondary mt-1">Aggiungi o modifica clienti</div>
                    </button>
                    <button
                        onClick={() => onTabChange('verify')}
                        className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary p-4 rounded-full transition-colors text-left"
                    >
                        <div className="font-semibold">Verifiche Documenti</div>
                        <div className="text-sm text-theme-text-secondary mt-1">Approva richieste pendenti</div>
                    </button>
                </div>
            </div>
        </div>
    )
}
