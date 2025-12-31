import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface CarWashBooking {
    id: string
    vehicle_name: string
    customer_name: string | null
    appointment_date: string
    appointment_time: string
    service_name: string
    price_total: number
    booking_details: any
    status: string
}

export default function LavaggioTab() {
    const [bookings, setBookings] = useState<CarWashBooking[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadTodayCarWash()

        // Real-time subscription
        const subscription = supabase
            .channel('lavaggio-updates')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'bookings' },
                () => loadTodayCarWash()
            )
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    async function loadTodayCarWash() {
        setLoading(true)
        try {
            // Get today's date in YYYY-MM-DD format
            const today = new Date()
            const todayStr = today.toISOString().split('T')[0]

            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .eq('service_type', 'car_wash')
                .gte('appointment_date', todayStr)
                .lt('appointment_date', `${todayStr}T23:59:59`)
                .neq('status', 'cancelled')
                .order('appointment_time', { ascending: true })

            if (error) throw error

            setBookings(data || [])
        } catch (error) {
            console.error('Failed to load today\'s car wash appointments:', error)
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

    // Get targa from booking_details
    const getTarga = (booking: CarWashBooking) => {
        return booking.booking_details?.vehicle?.targa ||
            booking.booking_details?.vehicle?.plate ||
            'N/A'
    }

    // Get service type label
    const getServiceLabel = (serviceName: string, priceTotal: number) => {
        // Map price to service type
        const priceMap: Record<number, string> = {
            2500: 'Basic',
            4900: 'Premium',
            7500: 'VIP',
            9900: 'DR7 Luxury'
        }
        return priceMap[priceTotal] || serviceName || 'Standard'
    }

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                <p className="text-white">Caricamento lavaggi di oggi...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-white">Lavaggi Oggi</h2>
                    <div className="text-dr7-gold font-bold text-lg">
                        {bookings.length} {bookings.length === 1 ? 'appuntamento' : 'appuntamenti'}
                    </div>
                </div>
                <p className="text-gray-400 text-sm">
                    Lavaggi previsti per oggi - {new Date().toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </p>
            </div>

            {bookings.length === 0 ? (
                <div className="bg-gray-900 rounded-lg p-8 text-center">
                    <p className="text-gray-400">Nessun lavaggio previsto per oggi</p>
                </div>
            ) : (
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-800">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Ora
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Veicolo
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Targa
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Nome
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Cognome
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Servizio
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                        Calendario
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {bookings.map((booking) => {
                                    const { nome, cognome } = parseCustomerName(booking.customer_name)
                                    const targa = getTarga(booking)
                                    const serviceLabel = getServiceLabel(booking.service_name, booking.price_total)

                                    return (
                                        <tr key={booking.id} className="hover:bg-gray-800 transition-colors">
                                            <td className="px-4 py-4 whitespace-nowrap">
                                                <span className="text-dr7-gold font-bold text-lg">{booking.appointment_time}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-white font-semibold">{booking.vehicle_name}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-gray-300 font-mono">{targa}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-white">{nome}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-white font-semibold">{cognome}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-blue-400 text-sm font-medium">{serviceLabel}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-gray-400 text-sm">
                                                    {new Date(booking.appointment_date).toLocaleDateString('it-IT')}
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
