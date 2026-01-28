import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

interface CompletedBooking {
    id: string
    customer_name: string
    customer_email: string | null
    customer_phone: string | null
    service_type: string
    service_name: string
    end_date: string // dropoff_date OR appointment_date (for wash/mech)
    status: string
    price_total: number
    review_sent_at: string | null
}

export default function ReviewsTab() {
    const [bookings, setBookings] = useState<CompletedBooking[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [multiSelectMode, setMultiSelectMode] = useState(false)
    const [sending, setSending] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        loadCompletedBookings()
    }, [])

    async function loadCompletedBookings() {
        setLoading(true)
        try {
            // Fetch all bookings
            // We consider "completed" if status is 'completed' OR 'paid' OR if the date is in the past and status is not 'cancelled'
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .order('created_at', { ascending: false })

            if (error) throw error

            const now = new Date()
            const completed: CompletedBooking[] = []

            data?.forEach((b: any) => {
                let endDateStr = b.dropoff_date
                if (!endDateStr && b.appointment_date) {
                    endDateStr = b.appointment_date // For mechanical/wash
                }

                if (endDateStr) {
                    const endDate = new Date(endDateStr)
                    // Check if date is in the past OR status is explicitly completed
                    if (endDate < now || b.status === 'completed') {
                        // Determine helpful service name
                        let serviceName = b.vehicle_name || b.service_name || b.service_type
                        if (b.service_type === 'car_wash') serviceName = `Lavaggio: ${b.service_name}`
                        if (b.service_type === 'mechanical_service') serviceName = `Meccanica: ${b.service_name}`

                        completed.push({
                            id: b.id,
                            customer_name: b.customer_name || 'Cliente',
                            customer_email: b.customer_email,
                            customer_phone: b.customer_phone,
                            service_type: b.service_type,
                            service_name: serviceName,
                            end_date: endDateStr,
                            status: b.status,
                            price_total: b.price_total,
                            review_sent_at: b.review_sent_at || null
                        })
                    }
                }
            })

            // Sort by end date descending (most recent finished first)
            completed.sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())

            setBookings(completed)
        } catch (err) {
            console.error('Error loading reviews tab data:', err)
        } finally {
            setLoading(false)
        }
    }

    const filteredBookings = bookings.filter(b =>
        b.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (b.customer_email && b.customer_email.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const handleSelectAll = () => {
        // Only select those who haven't received a review yet
        const eligibleBookings = filteredBookings.filter(b => !b.review_sent_at)

        if (selectedIds.size === eligibleBookings.length && eligibleBookings.length > 0) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(eligibleBookings.map(b => b.id)))
        }
    }

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedIds(newSet)
    }

    const executeSend = async (bookingsToSend: CompletedBooking[]) => {
        setSending(true)
        try {
            // Map to minimal data for email function
            const payload = bookingsToSend.map(b => ({
                name: b.customer_name,
                email: b.customer_email,
                service: b.service_name
            }))

            const response = await fetch('/.netlify/functions/send-review-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookings: payload })
            })

            const result = await response.json()

            if (result.success) {
                // Update DB only for successfully sent
                const sentIds = bookingsToSend.map(b => b.id)
                const { error: updateError } = await supabase
                    .from('bookings')
                    .update({ review_sent_at: new Date().toISOString() })
                    .in('id', sentIds)

                if (updateError) {
                    console.error('Error updating review status in DB:', updateError)
                    alert('Email inviate ma errore aggiornamento DB. Contatta supporto se persiste.')
                } else {
                    alert(`✅ Richieste inviate a ${result.sent} clienti!`)
                    // Update local state to reflect change immediately
                    const sentIdSet = new Set(sentIds)
                    setBookings(bookings.map(b =>
                        sentIdSet.has(b.id)
                            ? { ...b, review_sent_at: new Date().toISOString() }
                            : b
                    ))
                    setSelectedIds(new Set())
                    setMultiSelectMode(false)
                }

            } else {
                throw new Error(result.error || 'Errore invio')
            }

        } catch (error: any) {
            console.error('Error sending review requests:', error)
            alert('Errore: ' + error.message)
        } finally {
            setSending(false)
        }
    }

    const handleSendReviews = async () => {
        if (selectedIds.size === 0) return
        const selectedBookings = bookings.filter(b => selectedIds.has(b.id))
        await executeSend(selectedBookings)
    }

    const handleSendSingle = async (booking: CompletedBooking) => {
        await executeSend([booking])
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Recensioni</h2>
                <div className="flex gap-2">
                    <Button
                        onClick={() => {
                            setMultiSelectMode(!multiSelectMode)
                            setSelectedIds(new Set())
                        }}
                        variant={multiSelectMode ? 'secondary' : 'primary'}
                        className={multiSelectMode ? 'bg-blue-600 text-theme-text-primary' : ''}
                    >
                        {multiSelectMode ? 'Annulla Selezione' : 'Selezione Multipla'}
                    </Button>
                    <Button
                        onClick={handleSendReviews}
                        disabled={selectedIds.size === 0 || sending}
                        className={selectedIds.size > 0 && !sending
                            ? 'bg-dr7-gold hover:bg-yellow-500 text-black shadow-[0_0_15px_rgba(212,175,55,0.4)]'
                            : ''
                        }
                    >
                        {sending ? 'Invio...' : `Invia Richiesta (${selectedIds.size})`}
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-theme-bg-secondary p-4 rounded-full border border-theme-border flex gap-4">
                <input
                    type="text"
                    placeholder="Cerca cliente o email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-theme-bg-tertiary border border-theme-border-light text-theme-text-primary px-4 py-2 rounded-full w-full max-w-md focus:outline-none focus:border-dr7-gold"
                />
            </div>

            <div className="bg-theme-bg-secondary rounded-lg overflow-hidden border border-theme-border shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className=" text-theme-text-primary uppercase text-xs tracking-wider">
                            <tr>
                                {multiSelectMode && (
                                    <th className="p-4 w-10">
                                        <input
                                            type="checkbox"
                                            checked={filteredBookings.length > 0 && selectedIds.size === filteredBookings.filter(b => !b.review_sent_at).length}
                                            onChange={handleSelectAll}
                                            className="rounded-full border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-offset-gray-900"
                                        />
                                    </th>
                                )}
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Servizio</th>
                                <th className="p-4">Data Fine</th>
                                <th className="p-4">Contatti</th>
                                <th className="p-4">Totale</th>
                                <th className="p-4 text-right">Azioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={multiSelectMode ? 7 : 6} className="p-8 text-center text-theme-text-muted">
                                        Caricamento completati...
                                    </td>
                                </tr>
                            ) : filteredBookings.length === 0 ? (
                                <tr>
                                    <td colSpan={multiSelectMode ? 7 : 6} className="p-8 text-center text-theme-text-muted">
                                        Nessuna prenotazione completata trovata.
                                    </td>
                                </tr>
                            ) : (
                                filteredBookings.map((b) => (
                                    <tr key={b.id} className={`hover:bg-theme-bg-tertiary/50 transition-colors ${selectedIds.has(b.id) ? 'bg-dr7-gold/10' : ''} ${b.review_sent_at ? 'opacity-60 grayscale' : ''}`}>
                                        {multiSelectMode && (
                                            <td className="p-4">
                                                {!b.review_sent_at ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(b.id)}
                                                        onChange={() => toggleSelection(b.id)}
                                                        className="rounded-full border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-offset-gray-900"
                                                    />
                                                ) : (
                                                    <span title="Recensione già richiesta" className="text-xs text-green-500">✅</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="p-4 font-medium text-theme-text-primary">
                                            {b.customer_name}
                                            {b.review_sent_at && (
                                                <span className="block text-xs text-green-400 mt-1">
                                                    (Recensione inviata: {new Date(b.review_sent_at).toLocaleDateString()})
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-theme-text-secondary">
                                            {b.service_type === 'car_wash' && '🚿 '}
                                            {b.service_type === 'mechanical_service' && '🔧 '}
                                            {!b.service_type && '🚗 '}
                                            {b.service_name}
                                        </td>
                                        <td className="p-4 text-theme-text-secondary">
                                            {new Date(b.end_date).toLocaleDateString('it-IT')}
                                        </td>
                                        <td className="p-4 text-sm text-theme-text-muted">
                                            <div>{b.customer_email || '-'}</div>
                                            <div>{b.customer_phone || '-'}</div>
                                        </td>
                                        <td className="p-4 text-dr7-gold font-mono">
                                            €{(b.price_total / 100).toFixed(2)}
                                        </td>
                                        <td className="p-4 text-right">
                                            {!b.review_sent_at && (
                                                <Button
                                                    onClick={() => handleSendSingle(b)}
                                                    variant="secondary"
                                                    className="text-xs py-1 px-3 bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold border-dr7-gold/30"
                                                    disabled={sending}
                                                >
                                                    {sending ? '...' : 'Invia'}
                                                </Button>
                                            )}
                                            {b.review_sent_at && (
                                                <span className="text-xs text-green-500 font-medium border border-green-500/30 px-2 py-1 rounded-full bg-green-500/10">Inviata</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-gray-500 text-xs text-center flex justify-between px-4">
                <span>Totale trovati: {bookings.length}</span>
                <span>Mostrati: {filteredBookings.length}</span>
            </div>
        </div>
    )
}
