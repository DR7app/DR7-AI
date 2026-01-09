import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Booking {
    id: string
    vehicle_name: string
    vehicle_plate?: string | null
    customer_name: string | null
    pickup_date: string
    pickup_location: string
    booking_details: any
    status: string
}

export default function CheckInTab() {
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadTodayPickups()

        // Real-time subscription
        const subscription = supabase
            .channel('checkin-updates')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'bookings' },
                () => loadTodayPickups()
            )
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    async function loadTodayPickups() {
        setLoading(true)
        try {
            // Get today's date in YYYY-MM-DD format
            const today = new Date()
            const todayStr = today.toISOString().split('T')[0]

            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .gte('pickup_date', todayStr)
                .lt('pickup_date', `${todayStr}T23:59:59`)
                .neq('status', 'cancelled')
                .neq('service_type', 'car_wash')
                .neq('service_type', 'mechanical_service')
                .order('pickup_date', { ascending: true })

            if (error) throw error

            setBookings(data || [])
        } catch (error) {
            console.error('Failed to load today\'s pickups:', error)
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

    // Get pickup time from booking_details
    const getPickupTime = (booking: Booking) => {
        return booking.booking_details?.pickupTime ||
            new Date(booking.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    }

    // Get targa from vehicle_plate or booking_details
    const getTarga = (booking: Booking) => {
        return booking.vehicle_plate ||
            booking.booking_details?.vehicle?.targa ||
            booking.booking_details?.vehicle?.plate ||
            'N/A'
    }

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                <p className="text-theme-text-primary">Caricamento check-in di oggi...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="bg-theme-bg-secondary rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-theme-text-primary">Check-In Oggi</h2>
                    <div className="text-dr7-gold font-bold text-lg">
                        {bookings.length} {bookings.length === 1 ? 'ritiro' : 'ritiri'}
                    </div>
                </div>
                <p className="text-theme-text-muted text-sm">
                    Veicoli in partenza oggi - {new Date().toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </p>
            </div>

            {bookings.length === 0 ? (
                <div className="bg-theme-bg-secondary rounded-lg p-8 text-center">
                    <p className="text-theme-text-muted">Nessun ritiro previsto per oggi</p>
                </div>
            ) : (
                <div className="bg-theme-bg-secondary rounded-lg overflow-hidden">
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
                                    const pickupTime = getPickupTime(booking)
                                    const targa = getTarga(booking)

                                    return (
                                        <tr key={booking.id} className="hover:bg-theme-bg-tertiary transition-colors">
                                            <td className="px-4 py-4 whitespace-nowrap">
                                                <span className="text-dr7-gold font-bold text-lg">{pickupTime}</span>
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
                                                    {new Date(booking.pickup_date).toLocaleDateString('it-IT')}
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
