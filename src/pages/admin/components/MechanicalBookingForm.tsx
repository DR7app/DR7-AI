import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

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
    const [newCustomerMode, setNewCustomerMode] = useState(false)
    const [customerSearchQuery, setCustomerSearchQuery] = useState('')

    const [formData, setFormData] = useState({
        customer_id: '',
        service_name: '',
        vehicle_info: '',
        appointment_date: '',
        appointment_time: '',
        price_total: 0,
        payment_status: 'paid',
        notes: ''
    })

    const [newCustomerData, setNewCustomerData] = useState({
        // Global fields
        nazione: 'Italia',
        telefono: '',
        email: '',
        // Persona Fisica fields
        nome: '',
        cognome: '',
        codice_fiscale: '',
        data_nascita: '',
        luogo_nascita: '',
        indirizzo: '',
        numero_civico: '',
        codice_postale: '',
        citta_residenza: '',
        provincia_residenza: '',
        pec: ''
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
                    payment_status: initialData.payment_status || 'paid',
                    notes: initialData.booking_details?.notes || ''
                })

                // NOTE: We might not have the customer_id in initialData if it comes from the calendar view 
                // which might return a subset of fields. However, the calendar view usually fetches * from bookings.
                // Let's assume initialData has what we need, or we need to be careful about customer_id.
                // If initialData has customer_id (from booking_details or direct column), use it.
                if (initialData.booking_details?.customer?.customerId) {
                    setFormData(prev => ({ ...prev, customer_id: initialData.booking_details.customer.customerId }))
                }
            }
        }
    }, [initialData, editingId, customers])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        try {
            let customerId = formData.customer_id

            // Create new customer if needed in customers_extended
            if (newCustomerMode) {
                const customerData: any = {
                    tipo_cliente: 'persona_fisica',
                    nazione: newCustomerData.nazione,
                    email: newCustomerData.email || null,
                    telefono: newCustomerData.telefono || null,
                    nome: newCustomerData.nome,
                    cognome: newCustomerData.cognome,
                    codice_fiscale: newCustomerData.codice_fiscale,
                    data_nascita: newCustomerData.data_nascita || null,
                    luogo_nascita: newCustomerData.luogo_nascita || null,
                    indirizzo: newCustomerData.indirizzo || null,
                    numero_civico: newCustomerData.numero_civico || null,
                    codice_postale: newCustomerData.codice_postale,
                    citta_residenza: newCustomerData.citta_residenza,
                    provincia_residenza: newCustomerData.provincia_residenza,
                    pec: newCustomerData.pec || null,
                    source: 'admin',
                    created_at: new Date().toISOString()
                }

                const { data: newCustomer, error: customerError } = await supabase
                    .from('customers_extended')
                    .insert([customerData])
                    .select()
                    .single()

                if (customerError) throw customerError
                customerId = newCustomer.id
            }

            const customerInfo = newCustomerMode ? {
                ...newCustomerData,
                id: customerId,
                full_name: `${newCustomerData.nome} ${newCustomerData.cognome}`,
                phone: newCustomerData.telefono
            } : customers.find(c => c.id === customerId)

            const bookingData = {
                user_id: null,
                guest_name: customerInfo?.full_name || 'N/A',
                guest_email: customerInfo?.email || null,
                guest_phone: customerInfo?.phone || null,
                vehicle_type: 'service',
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
                            totalPrice: formData.price_total
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

    const filteredCustomers = customers.filter(c =>
        c.full_name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
        c.phone?.toLowerCase().includes(customerSearchQuery.toLowerCase())
    )

    return (
        <div className="bg-gray-900 rounded-xl w-full border border-gray-700">
            <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">
                    {editingId ? 'Modifica Prenotazione' : 'Nuova Prenotazione Meccanica'}
                </h3>
                <button
                    onClick={onCancel}
                    className="text-gray-400 hover:text-white text-2xl"
                >
                    ×
                </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Customer Selection */}
                <div>
                    <label className="block text-white font-semibold mb-3">Cliente</label>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        <button
                            type="button"
                            onClick={() => setNewCustomerMode(false)}
                            className={`px-4 py-2 rounded-lg font-medium ${!newCustomerMode ? 'bg-dr7-gold text-black' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        >
                            Cliente Esistente
                        </button>
                        <button
                            type="button"
                            onClick={() => setNewCustomerMode(true)}
                            className={`px-4 py-2 rounded-lg font-medium ${newCustomerMode ? 'bg-dr7-gold text-black' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        >
                            Nuovo Cliente
                        </button>
                    </div>

                    {!newCustomerMode ? (
                        <div>
                            <input
                                type="text"
                                placeholder="Cerca cliente..."
                                value={customerSearchQuery}
                                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white mb-2"
                            />
                            <select
                                required
                                value={formData.customer_id}
                                onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })}
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                            >
                                <option value="">Seleziona cliente...</option>
                                {filteredCustomers.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.full_name} {c.phone ? `- ${c.phone}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-white font-semibold mb-2">Nome *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCustomerData.nome}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, nome: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">Cognome *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCustomerData.cognome}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, cognome: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-white font-semibold mb-2">Codice Fiscale *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCustomerData.codice_fiscale}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_fiscale: e.target.value.toUpperCase() })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                        maxLength={16}
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">Data di Nascita</label>
                                    <input
                                        type="date"
                                        value={newCustomerData.data_nascita}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, data_nascita: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-white font-semibold mb-2">Luogo di Nascita</label>
                                    <input
                                        type="text"
                                        value={newCustomerData.luogo_nascita}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, luogo_nascita: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">Nazione *</label>
                                    <select
                                        required
                                        value={newCustomerData.nazione}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, nazione: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    >
                                        <option value="Italia">Italia</option>
                                        <option value="Francia">Francia</option>
                                        <option value="Germania">Germania</option>
                                        <option value="Spagna">Spagna</option>
                                        <option value="Regno Unito">Regno Unito</option>
                                        <option value="Altro">Altro</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-white font-semibold mb-2">Email *</label>
                                    <input
                                        type="email"
                                        required
                                        value={newCustomerData.email}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">Telefono *</label>
                                    <input
                                        type="tel"
                                        required
                                        value={newCustomerData.telefono}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, telefono: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-white font-semibold mb-2">Indirizzo</label>
                                    <input
                                        type="text"
                                        value={newCustomerData.indirizzo}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, indirizzo: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">Numero Civico</label>
                                    <input
                                        type="text"
                                        value={newCustomerData.numero_civico}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, numero_civico: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-white font-semibold mb-2">Città di Residenza *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCustomerData.citta_residenza}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, citta_residenza: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">CAP *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCustomerData.codice_postale}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_postale: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                        maxLength={5}
                                    />
                                </div>
                                <div>
                                    <label className="block text-white font-semibold mb-2">Provincia *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCustomerData.provincia_residenza}
                                        onChange={(e) => setNewCustomerData({ ...newCustomerData, provincia_residenza: e.target.value.toUpperCase() })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                        maxLength={2}
                                        placeholder="ES: CA"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-white font-semibold mb-2">PEC (opzionale)</label>
                                <input
                                    type="email"
                                    value={newCustomerData.pec}
                                    onChange={(e) => setNewCustomerData({ ...newCustomerData, pec: e.target.value })}
                                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Service Selection */}
                <div>
                    <label className="block text-white font-semibold mb-2">Servizio</label>
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
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
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
                    <label className="block text-white font-semibold mb-2">Info Veicolo Cliente</label>
                    <input
                        type="text"
                        required
                        placeholder="es. Fiat Panda 2018 - AA123BB"
                        value={formData.vehicle_info}
                        onChange={(e) => setFormData({ ...formData, vehicle_info: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                    />
                </div>

                {/* Appointment Date & Time */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-white font-semibold mb-2">Data</label>
                        <input
                            type="date"
                            required
                            value={formData.appointment_date}
                            onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
                            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-white font-semibold mb-2">Ora</label>
                        <select
                            required
                            value={formData.appointment_time}
                            onChange={(e) => setFormData({ ...formData, appointment_time: e.target.value })}
                            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                        >
                            <option value="">Seleziona orario...</option>
                            {TIME_SLOTS.map(slot => (
                                <option key={slot} value={slot}>{slot}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Price & Payment Status */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-white font-semibold mb-2">Prezzo (€)</label>
                        <input
                            type="number"
                            step="0.01"
                            required
                            value={formData.price_total}
                            onChange={(e) => setFormData({ ...formData, price_total: parseFloat(e.target.value) })}
                            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-white font-semibold mb-2">Stato Pagamento</label>
                        <select
                            value={formData.payment_status}
                            onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                        >
                            <option value="paid">Pagato</option>
                            <option value="pending">Da Saldare</option>
                            <option value="unpaid">Non Pagato</option>
                        </select>
                    </div>
                </div>

                {/* Notes */}
                <div>
                    <label className="block text-white font-semibold mb-2">Note</label>
                    <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                        rows={3}
                        placeholder="Note aggiuntive..."
                    />
                </div>

                <div className="flex gap-3">
                    <button
                        type="submit"
                        className="flex-1 px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-md transition-colors"
                    >
                        Salva
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-md transition-colors"
                    >
                        Annulla
                    </button>
                </div>
            </form>
        </div>
    )
}
