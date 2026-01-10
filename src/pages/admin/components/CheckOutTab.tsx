import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Booking {
    id: string
    vehicle_name: string
    vehicle_plate?: string | null
    customer_name: string | null
    dropoff_date: string
    dropoff_location: string
    booking_details: any
    status: string
}

export default function CheckOutTab() {
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadTodayReturns()

        // Real-time subscription
        const subscription = supabase
            .channel('checkout-updates')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'bookings' },
                () => loadTodayReturns()
            )
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    async function loadTodayReturns() {
        setLoading(true)
        try {
            // Get today's date in YYYY-MM-DD format
            const today = new Date()
            const todayStr = today.toISOString().split('T')[0]

            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .gte('dropoff_date', todayStr)
                .lt('dropoff_date', `${todayStr}T23:59:59`)
                .neq('status', 'cancelled')
                .neq('service_type', 'car_wash')
                .neq('service_type', 'mechanical_service')
                .order('dropoff_date', { ascending: true })

            if (error) throw error

            setBookings(data || [])
        } catch (error) {
            console.error('Failed to load today\'s returns:', error)
        } finally {
            setLoading(false)
        }
    }

    // Parse customer name into first and last name
    const parseCustomerName = (fullName: string | null) => {
        if (!fullName) return { nome: 'N/A', cognome: 'N/A' }
        const parts = fullName.trim().split(' ')
        if (parts.length === 1) return { nome: parts[0], cognome: '' }
        const cognome = parts[parts.length - 1]
        const nome = parts.slice(0, -1).join(' ')
        return { nome, cognome }
    }

    // Get return time from booking_details
    const getReturnTime = (booking: Booking) => {
        return booking.booking_details?.returnTime ||
            new Date(booking.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    }

    // Get targa from vehicle_plate or booking_details
    const getTarga = (booking: Booking) => {
        return booking.vehicle_plate ||
            booking.booking_details?.vehicle?.targa ||
            booking.booking_details?.vehicle?.plate ||
            'N/A'
    }

    // Check if return is overdue
    const isOverdue = (booking: Booking) => {
        const now = new Date()
        const returnDateTime = new Date(booking.dropoff_date)
        return now > returnDateTime
    }

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                <p className="text-theme-text-primary">Caricamento check-out di oggi...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="bg-theme-bg-secondary rounded-full p-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-theme-text-primary">Check-Out Oggi</h2>
                    <div className="text-dr7-gold font-bold text-lg">
                        {bookings.length} {bookings.length === 1 ? 'rientro' : 'rientri'}
                    </div>
                </div>
                <p className="text-theme-text-muted text-sm">
                    Veicoli in rientro oggi - {new Date().toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </p>
            </div>

            {bookings.length === 0 ? (
                <div className="bg-theme-bg-secondary rounded-full p-8 text-center">
                    <p className="text-theme-text-muted">Nessun rientro previsto per oggi</p>
                </div>
            ) : (
                <div className="bg-theme-bg-secondary rounded-full overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-theme-bg-tertiary">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                                        Ora
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                                        Veicolo
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                                        Targa
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                                        Nome
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                                        Cognome
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
                                        Calendario
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {bookings.map((booking) => {
                                    const { nome, cognome } = parseCustomerName(booking.customer_name)
                                    const returnTime = getReturnTime(booking)
                                    const targa = getTarga(booking)
                                    const overdue = isOverdue(booking)

                                    return (
                                        <tr
                                            key={booking.id}
                                            className={`hover:bg-theme-bg-tertiary transition-colors ${overdue ? 'bg-red-900/20' : ''}`}
                                        >
                                            <td className="px-4 py-4 whitespace-nowrap">
                                                <span className={`font-bold text-lg ${overdue ? 'text-red-500' : 'text-dr7-gold'}`}>
                                                    {returnTime}
                                                </span>
                                                {overdue && (
                                                    <span className="ml-2 text-xs text-red-400">IN RITARDO</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-theme-text-primary font-semibold">{booking.vehicle_name}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-theme-text-secondary font-mono">{targa}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-theme-text-primary">{nome}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-theme-text-primary font-semibold">{cognome}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-theme-text-muted text-sm">
                                                    {new Date(booking.dropoff_date).toLocaleDateString('it-IT')}
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
