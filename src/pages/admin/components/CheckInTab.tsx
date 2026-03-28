import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Cauzione {
    id: string
    importo: number
    metodo: string
    stato: string
    scadenza_cauzione: string
    data_incasso: string | null
}

interface Booking {
    id: string
    vehicle_name: string
    vehicle_plate?: string | null
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    pickup_date: string
    pickup_location: string
    dropoff_date: string
    dropoff_location: string
    price_total: number
    deposit_amount?: number | null
    payment_status: string
    status: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details: any
    service_type?: string
    cauzione?: Cauzione | null
}

export default function CheckInTab() {
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)
    const [sendingId, setSendingId] = useState<string | null>(null)
    const [sendingAll, setSendingAll] = useState(false)
    const [sentIds, setSentIds] = useState<Set<string>>(new Set())
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    useEffect(() => {
        loadTodayPickups()

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

            const bookingsList: Booking[] = data || []

            // Fetch cauzioni for these bookings
            if (bookingsList.length > 0) {
                const bookingIds = bookingsList.map(b => b.id)
                const { data: cauzioni } = await supabase
                    .from('cauzioni')
                    .select('id, importo, metodo, stato, scadenza_cauzione, data_incasso, riferimento_contratto_id')
                    .in('riferimento_contratto_id', bookingIds)

                if (cauzioni) {
                    const cauzioniMap = new Map<string, Cauzione>()
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    cauzioni.forEach((c: any) => {
                        cauzioniMap.set(c.riferimento_contratto_id, c)
                    })
                    bookingsList.forEach(b => {
                        b.cauzione = cauzioniMap.get(b.id) || null
                    })
                }
            }

            setBookings(bookingsList)
        } catch (error) {
            console.error('Failed to load today\'s pickups:', error)
        } finally {
            setLoading(false)
        }
    }

    const parseCustomerName = (fullName: string | null) => {
        if (!fullName) return { nome: 'N/A', cognome: 'N/A' }
        const parts = fullName.trim().split(' ')
        if (parts.length === 1) return { nome: parts[0], cognome: '' }
        const cognome = parts[parts.length - 1]
        const nome = parts.slice(0, -1).join(' ')
        return { nome, cognome }
    }

    const getPickupTime = (booking: Booking) => {
        return booking.booking_details?.pickupTime ||
            new Date(booking.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    }

    const getTarga = (booking: Booking) => {
        return booking.vehicle_plate ||
            booking.booking_details?.vehicle?.targa ||
            booking.booking_details?.vehicle?.plate ||
            'N/A'
    }

    const getPaymentLabel = (booking: Booking) => {
        const paid = booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded'
        if (paid) return { label: 'Pagato', color: 'text-green-400' }
        const amountPaid = booking.booking_details?.amountPaid || 0
        if (amountPaid > 0) return { label: 'Parziale', color: 'text-orange-400' }
        return { label: 'Non Pagato', color: 'text-red-400' }
    }

    const getCauzioneInfo = (booking: Booking) => {
        if (booking.booking_details?.depositOption === 'no_deposit') {
            return { label: 'Senza cauzione', color: 'text-purple-400', amount: null, method: null, stato: null }
        }
        const cauzione = booking.cauzione
        if (cauzione) {
            const statoColors: Record<string, string> = {
                'Attiva': 'text-blue-400',
                'In scadenza': 'text-orange-400',
                'Incassata': 'text-green-400',
                'Restituita': 'text-green-400',
                'Sbloccata': 'text-green-400',
                'Bloccata': 'text-red-400',
            }
            const metodoLabels: Record<string, string> = {
                'bonifico': 'Bonifico',
                'carta': 'Carta',
                'preautorizzazione': 'Preauth',
            }
            return {
                label: `${cauzione.importo.toFixed(2)}`,
                color: statoColors[cauzione.stato] || 'text-theme-text-muted',
                amount: cauzione.importo,
                method: metodoLabels[cauzione.metodo] || cauzione.metodo,
                stato: cauzione.stato,
            }
        }
        // Fallback to booking deposit_amount or booking_details.deposit
        const depositAmount = booking.deposit_amount || booking.booking_details?.deposit
        if (depositAmount && Number(depositAmount) > 0) {
            return { label: `${Number(depositAmount).toFixed(2)}`, color: 'text-yellow-400', amount: Number(depositAmount), method: null, stato: 'Da creare' }
        }
        return { label: '-', color: 'text-theme-text-muted', amount: null, method: null, stato: null }
    }

    const hasPhone = (booking: Booking) => {
        return !!(booking.customer_phone || booking.booking_details?.customer?.phone)
    }

    async function sendWhatsApp(bookingsToSend: Booking[]) {
        setErrorMsg(null)
        try {
            const response = await fetch('/.netlify/functions/send-checkin-checkout-whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookings: bookingsToSend, type: 'checkin' }),
            })
            const result = await response.json()
            if (result.success) {
                const newSent = new Set(sentIds)
                bookingsToSend.forEach(b => newSent.add(b.id))
                setSentIds(newSent)
                if (result.errors && result.errors.length > 0) {
                    setErrorMsg(`Inviati ${result.sent}/${result.total}. Errori: ${result.errors.join(', ')}`)
                }
            } else {
                setErrorMsg(result.message || 'Errore invio WhatsApp')
            }
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            setErrorMsg(_errMsg || 'Errore di rete')
        }
    }

    async function handleSendOne(booking: Booking) {
        setSendingId(booking.id)
        await sendWhatsApp([booking])
        setSendingId(null)
    }

    async function handleSendAll() {
        const toSend = bookings.filter(b => hasPhone(b) && !sentIds.has(b.id))
        if (toSend.length === 0) return
        setSendingAll(true)
        await sendWhatsApp(toSend)
        setSendingAll(false)
    }

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
                <p className="text-theme-text-primary">Caricamento check-in di oggi...</p>
            </div>
        )
    }

    const bookingsWithPhone = bookings.filter(b => hasPhone(b))
    const unsent = bookingsWithPhone.filter(b => !sentIds.has(b.id))

    return (
        <div className="space-y-6">
            <div className="bg-theme-bg-secondary rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-theme-text-primary">Check-In Oggi</h2>
                    <div className="flex items-center gap-3">
                        <div className="text-dr7-gold font-bold text-lg">
                            {bookings.length} {bookings.length === 1 ? 'ritiro' : 'ritiri'}
                        </div>
                        {bookingsWithPhone.length > 0 && (
                            <button
                                onClick={handleSendAll}
                                disabled={sendingAll || unsent.length === 0}
                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                                    unsent.length === 0
                                        ? 'bg-green-600/20 text-green-400 cursor-default'
                                        : sendingAll
                                        ? 'bg-gray-600/30 text-gray-400 cursor-wait'
                                        : 'bg-green-600/30 hover:bg-green-600/50 text-theme-text-primary'
                                }`}
                            >
                                {sendingAll ? (
                                    <>
                                        <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full"></span>
                                        Invio...
                                    </>
                                ) : unsent.length === 0 ? (
                                    <>Tutti inviati</>
                                ) : (
                                    <>Invia Tutti WhatsApp ({unsent.length})</>
                                )}
                            </button>
                        )}
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

            {errorMsg && (
                <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3 text-red-300 text-sm">
                    {errorMsg}
                    <button onClick={() => setErrorMsg(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
                </div>
            )}

            {bookings.length === 0 ? (
                <div className="bg-theme-bg-secondary rounded-lg p-8 text-center">
                    <p className="text-theme-text-muted">Nessun ritiro previsto per oggi</p>
                </div>
            ) : (
                <>
                    {/* Mobile Cards */}
                    <div className="block md:hidden space-y-3">
                        {bookings.map((booking) => {
                            const { nome, cognome } = parseCustomerName(booking.customer_name)
                            const pickupTime = getPickupTime(booking)
                            const targa = getTarga(booking)
                            const payment = getPaymentLabel(booking)
                            const cauzioneInfo = getCauzioneInfo(booking)
                            const phone = booking.customer_phone || booking.booking_details?.customer?.phone
                            const isSent = sentIds.has(booking.id)
                            const isSending = sendingId === booking.id

                            return (
                                <div key={booking.id} className="bg-theme-bg-secondary rounded-lg p-4 space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <span className="text-dr7-gold font-bold text-xl">{pickupTime}</span>
                                            <div className="text-theme-text-primary font-semibold mt-1">{nome} {cognome}</div>
                                        </div>
                                        <span className={`text-xs font-medium ${payment.color}`}>{payment.label}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div>
                                            <span className="text-theme-text-muted">Veicolo:</span>
                                            <span className="text-theme-text-primary ml-1 font-semibold">{booking.vehicle_name}</span>
                                        </div>
                                        <div>
                                            <span className="text-theme-text-muted">Targa:</span>
                                            <span className="text-theme-text-secondary ml-1 font-mono">{targa}</span>
                                        </div>
                                        <div>
                                            <span className="text-theme-text-muted">Luogo:</span>
                                            <span className="text-theme-text-primary ml-1">{booking.pickup_location || '-'}</span>
                                        </div>
                                        <div>
                                            <span className="text-theme-text-muted">Rientro:</span>
                                            <span className="text-theme-text-primary ml-1">
                                                {new Date(booking.dropoff_date).toLocaleDateString('it-IT')}
                                            </span>
                                        </div>
                                        <div className="col-span-2">
                                            <span className="text-theme-text-muted">Cauzione:</span>
                                            <span className={`ml-1 font-medium ${cauzioneInfo.color}`}>
                                                {cauzioneInfo.amount ? `${cauzioneInfo.amount.toFixed(2)}` : cauzioneInfo.label}
                                            </span>
                                            {cauzioneInfo.method && (
                                                <span className="text-theme-text-muted ml-1">({cauzioneInfo.method})</span>
                                            )}
                                            {cauzioneInfo.stato && (
                                                <span className={`ml-1 text-xs ${cauzioneInfo.color}`}>{cauzioneInfo.stato}</span>
                                            )}
                                        </div>
                                    </div>
                                    {phone && (
                                        <div className="text-sm text-theme-text-muted">{phone}</div>
                                    )}
                                    {booking.customer_email && (
                                        <div className="text-sm text-theme-text-muted">{booking.customer_email}</div>
                                    )}
                                    {phone && (
                                        <button
                                            onClick={() => handleSendOne(booking)}
                                            disabled={isSending || isSent}
                                            className={`w-full px-3 py-2 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                                                isSent
                                                    ? 'bg-green-600/20 text-green-400'
                                                    : isSending
                                                    ? 'bg-gray-600/30 text-gray-400'
                                                    : 'bg-green-600/30 hover:bg-green-600/50 text-theme-text-primary'
                                            }`}
                                        >
                                            {isSending ? (
                                                <>
                                                    <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full"></span>
                                                    Invio...
                                                </>
                                            ) : isSent ? (
                                                'Inviato'
                                            ) : (
                                                'Invia WhatsApp Check-In'
                                            )}
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Desktop Table */}
                    <div className="hidden md:block bg-theme-bg-secondary rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-theme-bg-tertiary">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Ora</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Veicolo</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Targa</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Cliente</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Telefono</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Luogo</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Cauzione</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Pagamento</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-muted uppercase tracking-wider">WhatsApp</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-theme-border">
                                    {bookings.map((booking) => {
                                        const { nome, cognome } = parseCustomerName(booking.customer_name)
                                        const pickupTime = getPickupTime(booking)
                                        const targa = getTarga(booking)
                                        const payment = getPaymentLabel(booking)
                                        const cauzioneInfo = getCauzioneInfo(booking)
                                        const phone = booking.customer_phone || booking.booking_details?.customer?.phone
                                        const isSent = sentIds.has(booking.id)
                                        const isSending = sendingId === booking.id

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
                                                    <div className="text-theme-text-primary font-semibold">{nome} {cognome}</div>
                                                    {booking.customer_email && (
                                                        <div className="text-xs text-theme-text-muted">{booking.customer_email}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="text-theme-text-primary text-sm">{phone || '-'}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="text-theme-text-primary text-sm">{booking.pickup_location || '-'}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className={`text-sm font-medium ${cauzioneInfo.color}`}>
                                                        {cauzioneInfo.amount ? `${cauzioneInfo.amount.toFixed(2)}` : cauzioneInfo.label}
                                                    </div>
                                                    {cauzioneInfo.method && (
                                                        <div className="text-xs text-theme-text-muted">{cauzioneInfo.method}</div>
                                                    )}
                                                    {cauzioneInfo.stato && (
                                                        <div className={`text-xs ${cauzioneInfo.color}`}>{cauzioneInfo.stato}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-sm font-medium ${payment.color}`}>{payment.label}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    {phone ? (
                                                        <button
                                                            onClick={() => handleSendOne(booking)}
                                                            disabled={isSending || isSent}
                                                            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                                                                isSent
                                                                    ? 'bg-green-600/20 text-green-400'
                                                                    : isSending
                                                                    ? 'bg-gray-600/30 text-gray-400'
                                                                    : 'bg-green-600/30 hover:bg-green-600/50 text-theme-text-primary'
                                                            }`}
                                                        >
                                                            {isSending ? 'Invio...' : isSent ? 'Inviato' : 'Invia'}
                                                        </button>
                                                    ) : (
                                                        <span className="text-theme-text-muted text-xs">No tel.</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
