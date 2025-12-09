import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import CustomerAutocomplete from './CustomerAutocomplete'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface CarWashBooking {
  id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_codice_fiscale?: string
  customer_indirizzo?: string
  customer_numero_civico?: string
  customer_citta?: string
  customer_cap?: string
  customer_provincia?: string
  service_name: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  booking_details: any
  created_at: string
}

const CAR_WASH_SERVICES = [
  {
    id: 'full-clean',
    name: 'Lavaggio Completo',
    price: 25,
    duration: '1 ora',
    durationMinutes: 60,
    allowedTimeRanges: [
      { start: '09:00', end: '12:00' },
      { start: '15:00', end: '18:00' }
    ]
  },
  {
    id: 'top-shine',
    name: 'Lavaggio Top',
    price: 49,
    duration: '2 ore',
    durationMinutes: 120,
    allowedTimeRanges: [
      { start: '09:00', end: '11:00' },
      { start: '15:00', end: '17:00' }
    ]
  },
  {
    id: 'vip',
    name: 'Lavaggio VIP',
    price: 75,
    duration: '3 ore',
    durationMinutes: 180,
    allowedTimeRanges: [
      { start: '09:00', end: '10:00' },
      { start: '15:00', end: '16:00' }
    ]
  },
  {
    id: 'dr7-luxury',
    name: 'Lavaggio DR7 Luxury',
    price: 99,
    duration: '4 ore',
    durationMinutes: 240,
    allowedTimeRanges: [
      { start: '09:00', end: '09:00' },
      { start: '15:00', end: '15:00' }
    ]
  }
]


// Generate time slots for car wash: 9h-13h and 15h-19h, every 15 minutes
const generateTimeSlots = () => {
  const slots: string[] = []

  // Morning slots: 9h-13h
  for (let hour = 9; hour < 13; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      slots.push(time)
    }
  }

  // Afternoon slots: 15h-18h (18:00 is the maximum/last slot)
  for (let hour = 15; hour < 19; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      // Stop at 18:00 - no slots after
      if (hour === 18 && minute > 0) break
      slots.push(time)
    }
  }

  return slots
}

const CAR_WASH_TIME_SLOTS = generateTimeSlots()

// Filter time slots based on selected service
const getAvailableTimeSlotsForService = (serviceName: string): string[] => {
  const service = CAR_WASH_SERVICES.find(s => s.name === serviceName)
  if (!service) return []

  return CAR_WASH_TIME_SLOTS.filter(timeSlot => {
    const [hours, minutes] = timeSlot.split(':').map(Number)
    const slotMinutes = hours * 60 + minutes

    return service.allowedTimeRanges.some(range => {
      const [startHours, startMinutes] = range.start.split(':').map(Number)
      const [endHours, endMinutes] = range.end.split(':').map(Number)
      const startMinutesTotal = startHours * 60 + startMinutes
      const endMinutesTotal = endHours * 60 + endMinutes

      return slotMinutes >= startMinutesTotal && slotMinutes <= endMinutesTotal
    })
  })
}

export default function CarWashBookingsTab() {
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingBooking, setEditingBooking] = useState<CarWashBooking | null>(null)
  const [newCustomerMode, setNewCustomerMode] = useState(false)

  const [formData, setFormData] = useState({
    customer_id: '',
    service_name: '',
    appointment_date: '',
    appointment_time: '',
    price_total: 0,
    payment_status: 'paid',
    amount_paid: '0',
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

  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load bookings (exclude cancelled)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .order('appointment_date', { ascending: false })

      if (bookingsError) throw bookingsError

      // Load customers from customers_extended (includes all customers from all sources)
      const { data: customersData, error: customersError } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, ragione_sociale, email, telefono')
        .order('cognome')

      if (customersError) throw customersError

      // Map customers_extended to Customer interface
      const mappedCustomers: Customer[] = (customersData || []).map((c: any) => ({
        id: c.id,
        full_name: c.ragione_sociale || `${c.nome || ''} ${c.cognome || ''}`.trim(),
        email: c.email,
        phone: c.telefono
      }))

      setBookings(bookingsData || [])
      setCustomers(mappedCustomers)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCancelBooking(bookingId: string, customerName: string) {
    if (!confirm(`Sei sicuro di voler annullare la prenotazione di ${customerName}?`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)

      if (error) throw error

      alert('✅ Prenotazione annullata con successo!')
      loadData()
    } catch (error: any) {
      console.error('Failed to cancel booking:', error)
      alert(`❌ Errore nell'annullamento: ${error.message}`)
    }
  }

  async function handleDeleteBooking(bookingId: string, customerName: string) {
    if (!confirm(`⚠️ ATTENZIONE: Sei sicuro di voler ELIMINARE DEFINITIVAMENTE la prenotazione di ${customerName}?\n\nQuesta azione è irreversibile e rimuoverà la prenotazione dal database.`)) {
      return
    }

    try {
      // Try to delete from Google Calendar
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: bookingId,
            customerName: customerName,
            vehicleName: 'Car Wash'
          }),
        })
        console.log('Google Calendar event deletion requested for booking:', bookingId)
      } catch (calError) {
        console.warn('Failed to delete from Google Calendar:', calError)
        // Continue with database deletion even if Google Calendar deletion fails
      }

      // Delete from database
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)

      if (error) throw error

      alert('✅ Prenotazione eliminata definitivamente!')
      loadData()
    } catch (error: any) {
      console.error('Failed to delete booking:', error)
      alert(`❌ Errore durante l'eliminazione: ${error.message}`)
    }
  }

  async function createBooking(forceBooking: boolean = false) {
    let customerName = ''
    let customerEmail = ''
    let customerPhone = ''

    // If new customer mode, create the customer first in customers_extended
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

      customerName = `${newCustomer.nome} ${newCustomer.cognome}`
      customerEmail = newCustomer.email || ''
      customerPhone = newCustomer.telefono || ''
    } else {
      // Get customer details from selected customer
      const customer = customers.find(c => c.id === formData.customer_id)
      if (!customer) throw new Error('Cliente non trovato')

      customerName = customer.full_name
      customerEmail = customer.email || ''
      customerPhone = customer.phone || ''
    }

    // Create appointment datetime in Europe/Rome timezone
    // Parse the date and time and create a proper Date object
    const [year, month, day] = formData.appointment_date.split('-').map(Number)
    const [hours, minutes] = formData.appointment_time.split(':').map(Number)

    // Create date in local timezone (Europe/Rome for Italian admin)
    const appointmentDate = new Date(year, month - 1, day, hours, minutes, 0)
    const appointmentDateTime = appointmentDate.toISOString()

    // Total price is just the service price
    const totalPrice = formData.price_total

    const bookingDetails: any = {
      notes: formData.notes,
      forceBooked: forceBooking,
      amountPaid: Math.round(parseFloat(formData.amount_paid) * 100),
      adminOverride: forceBooking, // Mark as admin override for backend
      createdBy: 'admin_panel'
    }

    // Build payload carefully to match database schema
    const bookingPayload: any = {
      service_type: 'car_wash',
      service_name: formData.service_name,
      vehicle_name: 'Car Wash Service', // Required field with placeholder for car wash
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      guest_name: customerName,
      guest_email: customerEmail || null,
      guest_phone: customerPhone || null,
      appointment_date: appointmentDateTime,
      appointment_time: formData.appointment_time,
      pickup_date: appointmentDateTime, // Use appointment date for compatibility
      dropoff_date: appointmentDateTime, // Use appointment date for compatibility
      pickup_location: 'DR7 Empire - Car Wash',
      dropoff_location: 'DR7 Empire - Car Wash',
      price_total: totalPrice * 100, // Convert to cents
      currency: 'EUR',
      status: 'confirmed',
      payment_status: formData.payment_status,
      booking_details: bookingDetails
    }

    console.log('📤 Attempting to insert car wash booking:', JSON.stringify(bookingPayload, null, 2))

    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingPayload])
      .select()
      .single()

    if (error) {
      console.error('❌ Supabase insert error:', error)
      console.error('Error code:', error.code)
      console.error('Error message:', error.message)
      console.error('Error details:', error.details)
      console.error('Error hint:', error.hint)
      throw error
    }

    console.log('✅ Booking created successfully:', data)

    // Generate PDF invoice for car wash
    try {
      await fetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: data.id || '',
          bookingType: 'car_wash',
          customerName: customerName,
          customerEmail: customerEmail,
          customerPhone: customerPhone,
          items: [{
            description: `Servizio Lavaggio: ${formData.service_name}`,
            quantity: 1,
            unitPrice: totalPrice * 100,
            total: totalPrice * 100
          }],
          subtotal: totalPrice * 100,
          tax: 0,
          total: totalPrice * 100,
          paymentStatus: formData.payment_status || 'pending',
          bookingDate: new Date().toISOString(),
          serviceDate: appointmentDateTime,
          notes: formData.notes || ''
        })
      })
      console.log('✅ Invoice generated successfully')
    } catch (invoiceError) {
      console.error('⚠️ Failed to generate invoice:', invoiceError)
      // Don't fail the whole booking if invoice generation fails
    }

    // Send WhatsApp notification
    try {
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking: {
            id: data.id || '',
            service_type: 'car_wash',
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            vehicle_name: formData.service_name,
            pickup_date: appointmentDateTime,
            dropoff_date: appointmentDateTime,
            pickup_location: 'DR7 Empire - Car Wash',
            price_total: totalPrice * 100,
            payment_status: formData.payment_status || 'pending'
          }
        })
      })
      console.log('✅ WhatsApp notification sent')
    } catch (whatsappError) {
      console.error('⚠️ WhatsApp notification failed:', whatsappError)
      // Don't block the booking if WhatsApp fails
    }

    // Add to Google Calendar
    try {
      const selectedService = CAR_WASH_SERVICES.find(s => s.name === formData.service_name)
      const durationMinutes = selectedService?.durationMinutes || 60

      // Calculate end time
      const endDate = new Date(year, month - 1, day, hours, minutes + durationMinutes, 0)
      const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const endTimeStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`

      await fetch('/.netlify/functions/create-calendar-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleName: `🧼 ${formData.service_name}`,
          customerName,
          customerEmail,
          customerPhone,
          pickupDate: formData.appointment_date,
          pickupTime: formData.appointment_time,
          returnDate: endDateStr,
          returnTime: endTimeStr,
          pickupLocation: 'DR7 Empire - Car Wash',
          returnLocation: 'DR7 Empire - Car Wash',
          totalPrice: totalPrice,
          bookingId: data.id
        })
      })
      console.log('✅ Google Calendar event created')
    } catch (calendarError) {
      console.error('⚠️ Failed to create Google Calendar event:', calendarError)
      // Don't block the booking if calendar fails
    }

    alert('✅ Prenotazione creata con successo!')
    setShowForm(false)
    setNewCustomerMode(false)
    setFormData({
      customer_id: '',
      service_name: '',
      appointment_date: '',
      appointment_time: '',
      price_total: 0,
      payment_status: 'paid',
      amount_paid: '0',
      notes: ''
    })
    setNewCustomerData({
      nazione: 'Italia',
      telefono: '',
      email: '',
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
    loadData()
  }

  // Helper function to check if two time ranges overlap
  function checkTimeOverlap(
    start1: string, duration1Minutes: number,
    start2: string, duration2Minutes: number
  ): boolean {
    // Parse time strings (HH:MM format)
    const [h1, m1] = start1.split(':').map(Number)
    const [h2, m2] = start2.split(':').map(Number)

    const start1Minutes = h1 * 60 + m1
    const end1Minutes = start1Minutes + duration1Minutes
    const start2Minutes = h2 * 60 + m2
    const end2Minutes = start2Minutes + duration2Minutes

    // Check if ranges overlap
    return start1Minutes < end2Minutes && end1Minutes > start2Minutes
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Prevent double submission
    if (submitting) {
      console.log('⚠️ Form already submitting, ignoring duplicate submission')
      return
    }

    setSubmitting(true)

    try {
      // Get the selected service duration
      const selectedService = CAR_WASH_SERVICES.find(s => s.name === formData.service_name)
      if (!selectedService) {
        alert('❌ Errore: Seleziona un servizio valido')
        setSubmitting(false)
        return
      }

      // ADMIN PANEL: Always allow bookings, just show warning if there's a conflict
      console.log('🔧 ADMIN PANEL: Checking for conflicts (informational only)')

      const newBookingDuration = selectedService.durationMinutes

      // Check if there's already a booking that overlaps with this time slot (informational only)
      const { data: existingBookings, error: checkError } = await supabase
        .from('bookings')
        .select('id, customer_name, appointment_date, appointment_time, service_name, booking_details')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .gte('appointment_date', formData.appointment_date)
        .lte('appointment_date', `${formData.appointment_date}T23:59:59`)

      if (checkError) {
        console.error('Error checking existing bookings:', checkError)
      }

      // Check if there's a time conflict considering service durations
      let hasConflict = false
      let conflictingBooking = null
      let conflictDetails = ''

      if (existingBookings && existingBookings.length > 0) {
        for (const booking of existingBookings) {
          const bookingTime = booking.appointment_time || new Date(booking.appointment_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })

          // Get the service duration of the existing booking
          const existingService = CAR_WASH_SERVICES.find(s => s.name === booking.service_name)
          const existingDuration = existingService ? existingService.durationMinutes : 60 // Default to 1 hour if not found

          // Check if time ranges overlap
          if (checkTimeOverlap(formData.appointment_time, newBookingDuration, bookingTime, existingDuration)) {
            hasConflict = true
            conflictingBooking = booking
            const endTime = bookingTime.split(':').map(Number)
            const endMinutes = endTime[0] * 60 + endTime[1] + existingDuration
            const endHour = Math.floor(endMinutes / 60)
            const endMin = endMinutes % 60
            conflictDetails = `${bookingTime} - ${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`
            break
          }
        }
      }

      // If there's a conflict, show informational warning (but always proceed)
      if (hasConflict && conflictingBooking) {
        const bookingId = conflictingBooking.id.substring(0, 8).toUpperCase()
        const confirmed = confirm(
          `ℹ️ INFO: Esiste già una prenotazione a quest'orario\n\n` +
          `Cliente esistente: ${conflictingBooking.customer_name}\n` +
          `Servizio: ${conflictingBooking.service_name}\n` +
          `Orario occupato: ${conflictDetails}\n` +
          `ID Prenotazione: DR7-${bookingId}\n\n` +
          `Stai per creare una doppia prenotazione.\n\n` +
          `• Clicca OK per procedere\n` +
          `• Clicca ANNULLA per scegliere un altro orario`
        )

        if (!confirmed) {
          return // User cancelled
        }
      }

      // Admin panel: ALWAYS create as forced booking (bypass all backend checks)
      console.log('🔧 ADMIN PANEL: Creating booking with admin override')
      await createBooking(true)
    } catch (error: any) {
      console.error('Failed to create booking:', error)

      // Handle any remaining errors in Italian
      const errorMessage = error.message || ''

      // If it's a conflict error even after admin override, show more details
      if (errorMessage.includes('Car wash slot already booked') ||
        errorMessage.includes('already booked') ||
        errorMessage.includes('Slot già occupato') ||
        errorMessage.includes('duplicate') ||
        errorMessage.includes('constraint')) {
        alert(
          `❌ ERRORE: Impossibile creare la prenotazione\n\n` +
          `Dettaglio tecnico: ${errorMessage}\n\n` +
          `Possibile causa: Database constraint o trigger che blocca le doppie prenotazioni.\n\n` +
          `Soluzione: Controlla i constraint del database 'bookings' table.`
        )
      } else {
        alert(`❌ Errore nella creazione della prenotazione: ${errorMessage}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Loading...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-dr7-gold">Prenotazioni Lavaggio</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-400">
            {bookings.length} prenotazion{bookings.length !== 1 ? 'i' : 'e'}
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-md transition-colors"
          >
            {showForm ? 'Chiudi' : '+ Nuova Prenotazione'}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca prenotazione per nome cliente..."
          value={bookingSearchQuery}
          onChange={(e) => setBookingSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-dr7-gold"
        />
      </div>

      {showForm && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Crea Nuova Prenotazione Lavaggio</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Customer Selection */}
            <div className="border-b border-gray-700 pb-4">
              <div className="flex items-center gap-4 mb-4">
                <button
                  type="button"
                  onClick={() => setNewCustomerMode(false)}
                  className={`px-4 py-2 rounded ${!newCustomerMode
                    ? 'bg-dr7-gold text-black font-semibold'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                  Seleziona Cliente
                </button>
                <button
                  type="button"
                  onClick={() => setNewCustomerMode(true)}
                  className={`px-4 py-2 rounded ${newCustomerMode
                    ? 'bg-dr7-gold text-black font-semibold'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                  Nuovo Cliente
                </button>
              </div>

              {!newCustomerMode ? (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Cerca Cliente</label>
                  <CustomerAutocomplete
                    customers={customers}
                    selectedCustomerId={formData.customer_id}
                    onSelectCustomer={(customerId) => setFormData({ ...formData, customer_id: customerId })}
                    placeholder="Inizia a scrivere nome, email o telefono..."
                    required={true}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Nome *</label>
                      <input
                        type="text"
                        required
                        value={newCustomerData.nome}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, nome: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Cognome *</label>
                      <input
                        type="text"
                        required
                        value={newCustomerData.cognome}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, cognome: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Codice Fiscale *</label>
                      <input
                        type="text"
                        required
                        value={newCustomerData.codice_fiscale}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_fiscale: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                        maxLength={16}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Data di Nascita</label>
                      <input
                        type="date"
                        value={newCustomerData.data_nascita}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, data_nascita: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Luogo di Nascita</label>
                      <input
                        type="text"
                        value={newCustomerData.luogo_nascita}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, luogo_nascita: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Nazione *</label>
                      <select
                        required
                        value={newCustomerData.nazione}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, nazione: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
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
                      <label className="block text-sm font-medium text-gray-300 mb-2">Email *</label>
                      <input
                        type="email"
                        required
                        value={newCustomerData.email}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Telefono *</label>
                      <input
                        type="tel"
                        required
                        value={newCustomerData.telefono}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, telefono: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Indirizzo</label>
                      <input
                        type="text"
                        value={newCustomerData.indirizzo}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, indirizzo: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Numero Civico</label>
                      <input
                        type="text"
                        value={newCustomerData.numero_civico}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, numero_civico: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Città di Residenza *</label>
                      <input
                        type="text"
                        required
                        value={newCustomerData.citta_residenza}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, citta_residenza: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">CAP *</label>
                      <input
                        type="text"
                        required
                        value={newCustomerData.codice_postale}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, codice_postale: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                        maxLength={5}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Provincia *</label>
                      <input
                        type="text"
                        required
                        value={newCustomerData.provincia_residenza}
                        onChange={(e) => setNewCustomerData({ ...newCustomerData, provincia_residenza: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                        maxLength={2}
                        placeholder="ES: CA"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">PEC (opzionale)</label>
                    <input
                      type="email"
                      value={newCustomerData.pec}
                      onChange={(e) => setNewCustomerData({ ...newCustomerData, pec: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Service Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Servizio</label>
                <select
                  required
                  value={formData.service_name}
                  onChange={(e) => {
                    const service = CAR_WASH_SERVICES.find(s => s.name === e.target.value)
                    setFormData({
                      ...formData,
                      service_name: e.target.value,
                      price_total: service?.price || 0,
                      appointment_time: '' // Reset time when service changes
                    })
                  }}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                >
                  <option value="">Seleziona servizio</option>
                  {CAR_WASH_SERVICES.map(service => (
                    <option key={service.id} value={service.name}>
                      {service.name} - EUR {service.price} ({service.duration})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Data</label>
                <input
                  type="date"
                  required
                  value={formData.appointment_date}
                  onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Ora</label>
                <select
                  required
                  value={formData.appointment_time}
                  onChange={(e) => setFormData({ ...formData, appointment_time: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  disabled={!formData.service_name}
                >
                  <option value="">{formData.service_name ? 'Seleziona orario' : 'Seleziona prima il servizio'}</option>
                  {formData.service_name && (() => {
                    const availableSlots = getAvailableTimeSlotsForService(formData.service_name)
                    const morningSlots = availableSlots.filter(t => t.startsWith('09') || t.startsWith('10') || t.startsWith('11') || t.startsWith('12'))
                    const afternoonSlots = availableSlots.filter(t => t.startsWith('15') || t.startsWith('16') || t.startsWith('17') || t.startsWith('18'))

                    return (
                      <>
                        {morningSlots.length > 0 && (
                          <optgroup label="Mattina">
                            {morningSlots.map(time => (
                              <option key={time} value={time}>{time}</option>
                            ))}
                          </optgroup>
                        )}
                        {afternoonSlots.length > 0 && (
                          <optgroup label="Pomeriggio">
                            {afternoonSlots.map(time => (
                              <option key={time} value={time}>{time}</option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    )
                  })()}
                </select>
              </div>
            </div>

            {/* Payment Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Stato Pagamento</label>
                <select
                  required
                  value={formData.payment_status}
                  onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                >
                  <option value="paid">Pagato</option>
                  <option value="pending">Da Saldare</option>
                  <option value="unpaid">Non Pagato</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Importo Pagato (€)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={formData.amount_paid}
                  onChange={(e) => setFormData({ ...formData, amount_paid: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Note (opzionale)</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                rows={3}
              />
            </div>
            {
              formData.price_total > 0 && (
                <div className="text-right">
                  <span className="text-lg font-bold text-dr7-gold">
                    Totale: EUR {formData.price_total.toFixed(2)}
                  </span>
                </div>
              )
            }
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 font-semibold rounded ${submitting
                  ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                  : 'bg-dr7-gold hover:bg-yellow-500 text-black'
                  }`}
              >
                {submitting ? 'Creazione in corso...' : 'Crea Prenotazione'}
              </button>
            </div>
          </form >
        </div >
      )
      }

      {
        bookings.length === 0 ? (
          <div className="bg-dr7-dark rounded-lg border border-gray-800 p-8 text-center text-gray-500">
            Nessuna prenotazione lavaggio trovata
          </div>
        ) : (
          <div className="bg-dr7-dark rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead className="bg-dr7-darker">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Cliente</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Servizio</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Data & Ora</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Prezzo</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Pagamento</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.filter(booking => {

                    // Search filter
                    if (!bookingSearchQuery) return true
                    const query = bookingSearchQuery.toLowerCase()
                    const customerName = (booking.customer_name || '').toLowerCase()
                    return customerName.includes(query)
                  }).map((booking) => (
                    <tr key={booking.id} className="border-t border-gray-800 hover:bg-dr7-darker/50">
                      <td className="px-4 py-3 text-sm text-white">
                        <div className="font-medium">{booking.customer_name}</div>
                        <div className="text-xs text-gray-400">{booking.customer_email}</div>
                        <div className="text-xs text-gray-400">{booking.customer_phone}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-white">
                        <div className="font-medium">{booking.service_name}</div>
                        {booking.booking_details?.additionalService && (
                          <div className="text-xs text-gray-400">
                            + {booking.booking_details.additionalService}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-white">
                        <div>
                          {booking.appointment_date
                            ? new Date(booking.appointment_date).toLocaleDateString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              timeZone: 'Europe/Rome'
                            })
                            : '-'}
                        </div>
                        <div className="text-xs text-gray-400">
                          {booking.appointment_time || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-white font-bold">
                        EUR {(booking.price_total / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${booking.payment_status === 'completed' || booking.payment_status === 'paid'
                            ? 'bg-green-900 text-green-300'
                            : 'bg-red-900 text-red-300'
                            }`}
                        >
                          {booking.payment_status === 'completed' || booking.payment_status === 'paid' ? 'Pagato' : 'Non Pagato'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingBooking(booking)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors"
                          >
                            Modifica
                          </button>
                          {booking.status !== 'cancelled' ? (
                            <button
                              onClick={() => handleCancelBooking(booking.id, booking.customer_name)}
                              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-medium transition-colors"
                            >
                              Annulla
                            </button>
                          ) : (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-400">
                              Annullata
                            </span>
                          )}
                          <button
                            onClick={() => handleDeleteBooking(booking.id, booking.customer_name)}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors"
                          >
                            Elimina
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }

      {/* Edit Booking Modal */}
      {
        editingBooking && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-700">
              <div className="p-6 border-b border-gray-800">
                <div className="flex justify-between items-start">
                  <h3 className="text-2xl font-bold text-white">Modifica Prenotazione</h3>
                  <button
                    onClick={() => setEditingBooking(null)}
                    className="text-gray-400 hover:text-white text-2xl"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Cliente</label>
                  <input
                    type="text"
                    value={editingBooking.customer_name}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={editingBooking.customer_email || ''}
                      onChange={(e) => setEditingBooking({ ...editingBooking, customer_email: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Telefono</label>
                    <input
                      type="tel"
                      value={editingBooking.customer_phone || ''}
                      onChange={(e) => setEditingBooking({ ...editingBooking, customer_phone: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Servizio</label>
                  <input
                    type="text"
                    value={editingBooking.service_name}
                    onChange={(e) => setEditingBooking({ ...editingBooking, service_name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Data</label>
                    <input
                      type="date"
                      value={editingBooking.appointment_date}
                      onChange={(e) => setEditingBooking({ ...editingBooking, appointment_date: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Ora</label>
                    <input
                      type="time"
                      value={editingBooking.appointment_time}
                      onChange={(e) => setEditingBooking({ ...editingBooking, appointment_time: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Prezzo (€)</label>
                  <input
                    type="number"
                    value={editingBooking.price_total / 100}
                    onChange={(e) => setEditingBooking({ ...editingBooking, price_total: parseFloat(e.target.value) * 100 })}
                    step="0.01"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Stato</label>
                    <select
                      value={editingBooking.status}
                      onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    >
                      <option value="pending">In Attesa</option>
                      <option value="confirmed">Confermata</option>
                      <option value="cancelled">Annullata</option>
                      <option value="completed">Completata</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Pagamento</label>
                    <select
                      value={editingBooking.payment_status}
                      onChange={(e) => setEditingBooking({ ...editingBooking, payment_status: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    >
                      <option value="pending">In Attesa</option>
                      <option value="paid">Pagato</option>
                      <option value="completed">Completato</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-gray-800 flex gap-3">
                <button
                  onClick={async () => {
                    try {
                      const { error } = await supabase
                        .from('bookings')
                        .update({
                          customer_name: editingBooking.customer_name,
                          customer_email: editingBooking.customer_email,
                          customer_phone: editingBooking.customer_phone,
                          service_name: editingBooking.service_name,
                          appointment_date: editingBooking.appointment_date,
                          appointment_time: editingBooking.appointment_time,
                          price_total: editingBooking.price_total,
                          status: editingBooking.status,
                          payment_status: editingBooking.payment_status,
                        })
                        .eq('id', editingBooking.id)

                      if (error) throw error

                      alert('✅ Prenotazione aggiornata!')
                      setEditingBooking(null)
                      loadData()
                    } catch (error) {
                      console.error('Failed to update booking:', error)
                      alert('❌ Errore durante l\'aggiornamento')
                    }
                  }}
                  className="flex-1 bg-dr7-gold hover:bg-dr7-gold/90 text-black px-6 py-3 rounded font-medium transition-colors"
                >
                  Salva Modifiche
                </button>
                <button
                  onClick={() => setEditingBooking(null)}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors"
                >
                  Annulla
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  )
}
