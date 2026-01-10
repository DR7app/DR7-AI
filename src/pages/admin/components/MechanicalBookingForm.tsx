import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import NewClientModal from './NewClientModal'
import CustomerAutocomplete from './CustomerAutocomplete'
import {
    fetchConflictingBookings,
    filterAvailableTimeSlots,
    findNextAvailableSlots,
    formatTimeSlotWithDuration
} from '../../../utils/bookingConflictUtils'

interface Customer {
    id: string
    full_name: string
    email: string | null
    phone: string | null
}

interface MechanicalBookingFormProps {
    initialData?: any
    customers: Customer[]
    onSave: () => void
    onCancel: () => void
    editingId?: string | null
}

// Mechanical services based on the price list
const MECHANICAL_SERVICES = [
    // CAMBIO PASTIGLIE FRENI
    { id: 'brake-pads-front', name: 'Cambio Pastiglie Freni - Anteriori', price: 29, category: 'Freni' },
    { id: 'brake-pads-rear', name: 'Cambio Pastiglie Freni - Posteriori', price: 29, category: 'Freni' },
    { id: 'brake-pads-all', name: 'Cambio Pastiglie Freni - Anteriori + Posteriori', price: 49, category: 'Freni' },

    // TAGLIANDO RAPIDO
    { id: 'service-city', name: 'Tagliando Rapido (Olio + Filtri) - City Car/Utilitarie', price: 39, category: 'Tagliando' },
    { id: 'service-sedan', name: 'Tagliando Rapido (Olio + Filtri) - Berlina/SUV', price: 49, category: 'Tagliando' },
    { id: 'service-luxury', name: 'Tagliando Rapido (Olio + Filtri) - Luxury/Sportive', price: 59, category: 'Tagliando' },

    // CAMBIO SPAZZOLE TERGICRISTALLI
    { id: 'wipers-front', name: 'Cambio Spazzole Tergicristalli - Coppia Anteriore', price: 5, category: 'Accessori' },
    { id: 'wipers-rear', name: 'Cambio Spazzole Tergicristalli - Posteriore', price: 3, category: 'Accessori' },

    // SOSTITUZIONE BATTERIA
    { id: 'battery-city', name: 'Sostituzione Batteria - City Car/Utilitarie', price: 15, category: 'Elettrica' },
    { id: 'battery-sedan', name: 'Sostituzione Batteria - Berlina/SUV', price: 19, category: 'Elettrica' },

    // CAMBIO LAMPADINE
    { id: 'bulb-standard', name: 'Cambio Lampadina - Standard', price: 5, category: 'Elettrica' },
    { id: 'bulb-led', name: 'Cambio Lampadina - LED/Xenon', price: 10, category: 'Elettrica' },

    // LUCIDATURA FARI
    { id: 'headlight-polish-1', name: 'Lucidatura Fari - 1 Faro', price: 15, category: 'Carrozzeria' },
    { id: 'headlight-polish-2', name: 'Lucidatura Fari - 2 Fari', price: 30, category: 'Carrozzeria' },
    { id: 'headlight-polish-4', name: 'Lucidatura Fari - 4 Fari', price: 50, category: 'Carrozzeria' },

    // LUCIDATURA COMPLETA CARROZZERIA
    { id: 'body-polish-small', name: 'Lucidatura Completa Carrozzeria - Auto Piccola', price: 200, category: 'Carrozzeria' },
    { id: 'body-polish-medium', name: 'Lucidatura Completa Carrozzeria - Auto Media', price: 250, category: 'Carrozzeria' },
    { id: 'body-polish-large', name: 'Lucidatura Completa Carrozzeria - Auto Grande/SUV', price: 300, category: 'Carrozzeria' },
]

// Generate time slots: 9h-13h and 15h-19h, every 30 minutes
const generateTimeSlots = () => {
    const slots: string[] = []

    // Morning slots: 9h-13h
    for (let hour = 9; hour < 13; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
            slots.push(time)
        }
    }

    // Afternoon slots: 15h-18h (18:00 is the last slot)
    for (let hour = 15; hour < 19; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
            if (hour === 18 && minute > 0) break
            slots.push(time)
        }
    }

    return slots
}

const TIME_SLOTS = generateTimeSlots()

export default function MechanicalBookingForm({ initialData, customers, onSave, onCancel, editingId }: MechanicalBookingFormProps) {
    const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false)

    // New state for conflict detection
    const [availableTimeSlots, setAvailableTimeSlots] = useState<string[]>([])
    const [conflictingBookings, setConflictingBookings] = useState<any[]>([])

    const [formData, setFormData] = useState({
        customer_id: '',
        service_name: '',
        vehicle_info: '',
        appointment_date: '',
        appointment_time: '',
        price_total: 0,
        amount_paid: 0,
        payment_status: 'paid',
        notes: ''
    })

    useEffect(() => {
        if (initialData) {
            // If editing existing booking
            if (editingId) {
                // Find existing customer
                const existingCustomer = customers.find(c => c.full_name === initialData.customer_name)

                setFormData({
                    customer_id: existingCustomer?.id || '', // Try to match by name if ID missing? Or pass full customer object?
                    service_name: initialData.service_name || '',
                    vehicle_info: initialData.vehicle_name || '', // Note: mapped from vehicle_name
                    appointment_date: initialData.appointment_date ? initialData.appointment_date.split('T')[0] : '',
                    appointment_time: initialData.appointment_time || '',
                    price_total: initialData.price_total ? initialData.price_total / 100 : 0, // Convert from cents
                    amount_paid: initialData.booking_details?.amountPaid ? initialData.booking_details.amountPaid / 100 : 0, // Convert from cents
                    payment_status: initialData.payment_status || 'paid',
                    notes: initialData.booking_details?.notes || ''
                })

                if (initialData.booking_details?.customer?.customerId) {
                    setFormData(prev => ({ ...prev, customer_id: initialData.booking_details.customer.customerId }))
                }
            }
        }
    }, [initialData, editingId, customers])

    // Fetch conflicting bookings when date changes
    useEffect(() => {
        async function fetchAvailableSlots() {
            if (!formData.appointment_date) {
                setAvailableTimeSlots([])
                return
            }

            // Fetch all conflicting bookings (both car_wash and mechanical_service)
            const bookings = await fetchConflictingBookings(formData.appointment_date, editingId || undefined)
            setConflictingBookings(bookings)

            // Mechanical services default to 60 minutes duration
            const mechanicalDuration = 60

            // Filter out conflicting slots
            const available = filterAvailableTimeSlots(
                TIME_SLOTS,
                bookings,
                mechanicalDuration
            )

            setAvailableTimeSlots(available)
        }

        fetchAvailableSlots()
    }, [formData.appointment_date, editingId])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        try {
            const customerId = formData.customer_id

            const customerInfo = customers.find(c => c.id === customerId)

            const bookingData = {
                user_id: null,
                guest_name: customerInfo?.full_name || 'N/A',
                guest_email: customerInfo?.email || null,
                guest_phone: customerInfo?.phone || null,
                vehicle_type: 'car',
                vehicle_name: formData.vehicle_info, // Customer's vehicle info
                service_type: 'mechanical_service',
                service_name: formData.service_name,
                appointment_date: formData.appointment_date,
                appointment_time: formData.appointment_time,
                price_total: Math.round(formData.price_total * 100), // Convert to cents
                currency: 'EUR',
                status: 'confirmed',
                payment_status: formData.payment_status,
                payment_method: 'agency',
                customer_name: customerInfo?.full_name || 'N/A',
                customer_email: customerInfo?.email || null,
                customer_phone: customerInfo?.phone || null,
                booking_source: 'admin',
                booking_details: {
                    customer: {
                        fullName: customerInfo?.full_name || '',
                        email: customerInfo?.email || '',
                        phone: customerInfo?.phone || '',
                        customerId: customerId
                    },
                    vehicleInfo: formData.vehicle_info,
                    notes: formData.notes || null,
                    amountPaid: Math.round(formData.amount_paid * 100),
                    source: 'admin_manual'
                }
            }

            if (editingId) {
                const { error } = await supabase
                    .from('bookings')
                    .update(bookingData)
                    .eq('id', editingId)

                if (error) throw error
            } else {
                const { data: insertedBooking, error } = await supabase
                    .from('bookings')
                    .insert([bookingData])
                    .select()
                    .single()

                if (error) throw error

                // Generate PDF invoice for mechanical service
                try {
                    await fetch('/.netlify/functions/generate-invoice-pdf', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: insertedBooking?.id || '',
                            bookingType: 'mechanical',
                            customerName: customerInfo?.full_name || '',
                            customerEmail: customerInfo?.email || '',
                            customerPhone: customerInfo?.phone || '',
                            items: [{
                                description: `Servizio Meccanico: ${formData.service_name} - ${formData.vehicle_info}`,
                                quantity: 1,
                                unitPrice: Math.round(formData.price_total * 100),
                                total: Math.round(formData.price_total * 100)
                            }],
                            subtotal: Math.round(formData.price_total * 100),
                            tax: 0,
                            total: Math.round(formData.price_total * 100),
                            paymentStatus: formData.payment_status,
                            bookingDate: new Date().toISOString(),
                            serviceDate: `${formData.appointment_date}T${formData.appointment_time}:00`,
                            notes: formData.notes || ''
                        })
                    })
                    console.log('✅ Invoice generated successfully')
                } catch (invoiceError) {
                    console.error('⚠️ Failed to generate invoice:', invoiceError)
                    // Don't fail the whole booking if invoice generation fails
                }

                // Create Google Calendar event
                try {
                    const [hours, minutes] = formData.appointment_time.split(':').map(Number)
                    const endHours = hours + 1 // Default 1 hour duration for mechanical services
                    const endTime = `${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

                    await fetch('/.netlify/functions/create-calendar-event', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            vehicleName: `🔧 ${formData.service_name}`,
                            customerName: customerInfo?.full_name || '',
                            customerEmail: customerInfo?.email || '',
                            customerPhone: customerInfo?.phone || '',
                            pickupDate: formData.appointment_date,
                            pickupTime: formData.appointment_time,
                            returnDate: formData.appointment_date,
                            returnTime: endTime,
                            pickupLocation: `DR7 Rapid Service - ${formData.vehicle_info}`,
                            returnLocation: 'DR7 Office',
                            totalPrice: formData.price_total,
                            bookingId: insertedBooking.id
                        })
                    })
                    console.log('✅ Calendar event created')
                } catch (calendarError) {
                    console.error('⚠️ Failed to create calendar event:', calendarError)
                }
            }

            onSave()
        } catch (error) {
            console.error('Failed to save booking:', error)
            alert('Errore durante il salvataggio: ' + (error as Error).message)
        }
    }

    const handleClientCreated = (newClient: any) => {
        if (newClient?.id) {
            setFormData(prev => ({ ...prev, customer_id: newClient.id }))
        }
        setIsNewClientModalOpen(false)
    }

    return (
        <div className="bg-theme-bg-secondary rounded-full w-full border border-theme-border">
            <div className="p-6 border-b border-theme-border flex justify-between items-center">
                <h3 className="text-xl font-bold text-theme-text-primary">
                    {editingId ? 'Modifica Prenotazione' : 'Nuova Prenotazione Meccanica'}
                </h3>
                <button
                    onClick={onCancel}
                    className="text-theme-text-muted hover:text-theme-text-primary text-2xl"
                >
                    ×
                </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Customer Selection */}
                <div className="border-b border-theme-border pb-4">
                    <div className="flex items-center gap-4 mb-4">
                        <button
                            type="button"
                            onClick={() => setIsNewClientModalOpen(false)}
                            className={`px-4 py-2 rounded-full ${!isNewClientModalOpen
                                ? 'bg-white text-black font-semibold'
                                : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'
                                }`}
                        >
                            Seleziona Cliente
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsNewClientModalOpen(true)}
                            className={`px-4 py-2 rounded-full ${isNewClientModalOpen
                                ? 'bg-white text-black font-semibold'
                                : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'
                                }`}
                        >
                            Nuovo Cliente
                        </button>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cerca Cliente</label>
                        <CustomerAutocomplete
                            customers={customers}
                            selectedCustomerId={formData.customer_id}
                            onSelectCustomer={(customerId) => setFormData({ ...formData, customer_id: customerId })}
                            placeholder="Inizia a scrivere nome, email o telefono..."
                            required={true}
                        />
                    </div>
                </div>

                {/* Service Selection */}
                <div>
                    <label className="block text-theme-text-primary font-semibold mb-2">Servizio</label>
                    <select
                        required
                        value={formData.service_name}
                        onChange={(e) => {
                            const selectedService = MECHANICAL_SERVICES.find(s => s.name === e.target.value)
                            setFormData({
                                ...formData,
                                service_name: e.target.value,
                                price_total: selectedService?.price || 0
                            })
                        }}
                        className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                    >
                        <option value="">Seleziona servizio...</option>
                        {MECHANICAL_SERVICES.map(s => (
                            <option key={s.id} value={s.name}>
                                {s.name} - €{s.price} ({s.category})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Vehicle Info */}
                <div>
                    <label className="block text-theme-text-primary font-semibold mb-2">Info Veicolo Cliente</label>
                    <input
                        type="text"
                        required
                        placeholder="es. Fiat Panda 2018 - AA123BB"
                        value={formData.vehicle_info}
                        onChange={(e) => setFormData({ ...formData, vehicle_info: e.target.value })}
                        className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                    />
                </div>

                {/* Appointment Date & Time */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-theme-text-primary font-semibold mb-2">Data</label>
                        <input
                            type="date"
                            required
                            value={formData.appointment_date}
                            onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                        />
                    </div>
                    <div>
                        <label className="block text-theme-text-primary font-semibold mb-2">Ora</label>
                        {!formData.appointment_date ? (
                            <div className="p-4 bg-yellow-900/20 border border-yellow-600/50 rounded-full">
                                <p className="text-yellow-400 text-sm">
                                    ⚠️ Seleziona prima la data per vedere gli orari disponibili
                                </p>
                            </div>
                        ) : availableTimeSlots.length === 0 ? (
                            <div className="p-4 bg-red-900/20 border border-red-600/50 rounded-full">
                                <p className="text-red-400 text-sm font-semibold mb-2">
                                    ❌ Nessun orario disponibile per questa data
                                </p>
                                <p className="text-theme-text-secondary text-sm mb-3">
                                    Tutti gli orari sono occupati da prenotazioni di lavaggio o meccanica.
                                </p>
                                {(() => {
                                    const mechanicalDuration = 60
                                    const nextSlots = findNextAvailableSlots(
                                        TIME_SLOTS,
                                        conflictingBookings,
                                        mechanicalDuration,
                                        3
                                    )

                                    if (nextSlots.length > 0) {
                                        return (
                                            <div className="mt-2">
                                                <p className="text-green-400 text-sm font-semibold mb-1">
                                                    ✅ Prossimi orari disponibili:
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {nextSlots.map(slot => (
                                                        <span key={slot} className="px-3 py-1 bg-green-900/30 border border-green-600/50 rounded text-green-300 text-sm">
                                                            {formatTimeSlotWithDuration(slot, mechanicalDuration)}
                                                        </span>
                                                    ))}
                                                </div>
                                                <p className="text-theme-text-muted text-xs mt-2">
                                                    Seleziona una data diversa per prenotare in questi orari
                                                </p>
                                            </div>
                                        )
                                    }
                                    return null
                                })()}
                            </div>
                        ) : (
                            <select
                                required
                                value={formData.appointment_time}
                                onChange={(e) => setFormData({ ...formData, appointment_time: e.target.value })}
                                className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                            >
                                <option value="">Seleziona orario... ({availableTimeSlots.length} disponibili)</option>
                                {availableTimeSlots.map(slot => (
                                    <option key={slot} value={slot}>{slot}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* Price & Payment Status */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-theme-text-primary font-semibold mb-2">Prezzo Totale (€)</label>
                        <input
                            type="number"
                            step="0.01"
                            required
                            value={formData.price_total}
                            onChange={(e) => setFormData({ ...formData, price_total: parseFloat(e.target.value) })}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary font-bold text-lg"
                        />
                    </div>
                    <div>
                        <label className="block text-theme-text-primary font-semibold mb-2">Importo Pagato (€)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.amount_paid}
                            onChange={(e) => setFormData({ ...formData, amount_paid: parseFloat(e.target.value) })}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                        />
                    </div>
                    <div>
                        <label className="block text-theme-text-primary font-semibold mb-2">Stato Pagamento</label>
                        <select
                            value={formData.payment_status}
                            onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                            className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                        >
                            <option value="paid">Pagato</option>
                            <option value="pending">Da Saldare</option>
                            <option value="unpaid">Non Pagato</option>
                        </select>
                        <div className="mt-2 text-right">
                            <span className="text-theme-text-muted text-sm">Rimanente: </span>
                            <span className={`font-bold ${formData.price_total - formData.amount_paid > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                €{(formData.price_total - formData.amount_paid).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Notes */}
                <div>
                    <label className="block text-theme-text-primary font-semibold mb-2">Note</label>
                    <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary"
                        rows={3}
                        placeholder="Note aggiuntive..."
                    />
                </div>

                <div className="flex gap-3">
                    <button
                        type="submit"
                        className="flex-1 px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-full transition-colors"
                    >
                        Salva
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-theme-text-primary font-semibold rounded-full transition-colors"
                    >
                        Annulla
                    </button>
                </div>
            </form>

            <NewClientModal
                isOpen={isNewClientModalOpen}
                onClose={() => setIsNewClientModalOpen(false)}
                onClientCreated={handleClientCreated}
            />
        </div>
    )
}
