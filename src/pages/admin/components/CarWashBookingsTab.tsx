import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
import toast from 'react-hot-toast'
// Conflict utilities are now handled inline
import { validateScheduling } from '../../../utils/schedulingRules'
import { classifyVehicle, classifyVehicleLocally, type VehicleCategory } from '../../../utils/vehicleClassification'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface CarWashBooking {
  id: string
  customer_id: string
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
  vehicle_name?: string
  vehicle_plate?: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  booking_details: any
  created_at: string
}

interface CarWashService {
  id: string
  name: string
  name_en: string
  price: number
  duration: string
  description: string
  description_en: string
  features: string[]
  features_en: string[]
  display_order: number
  is_active: boolean
  category: string
  main_tab: string
  price_unit?: string
  price_options?: { label: string; price: number }[]
  durationMinutes?: number
  allowedTimeRanges?: { start: string; end: string }[]
}

// Helper to parse duration string to minutes
function parseDurationToMinutes(duration: string): number {
  if (!duration || duration === '-') return 30 // Default 30 min for services without duration
  const match = duration.match(/(\d+)\s*min/i)
  if (match) return parseInt(match[1])
  // Handle "X ore" format
  const hoursMatch = duration.match(/(\d+)\s*or/i)
  if (hoursMatch) return parseInt(hoursMatch[1]) * 60
  return 30 // Default
}

// Helper to get allowed time ranges based on duration
// Saturday: continuous 9:00-17:00, Weekdays: 9:00-13:00 + 15:00-19:00
function getAllowedTimeRanges(durationMinutes: number, isSaturday: boolean = false): { start: string; end: string }[] {
  if (isSaturday) {
    const satEnd = 17 * 60 - durationMinutes // Must finish by 17:00
    const satEndHour = Math.floor(satEnd / 60)
    const satEndMin = satEnd % 60
    return [
      { start: '09:00', end: `${satEndHour.toString().padStart(2, '0')}:${satEndMin.toString().padStart(2, '0')}` }
    ]
  }

  // Weekdays: split schedule
  const morningEnd = 13 * 60 - durationMinutes // Must finish by 13:00
  const afternoonEnd = 19 * 60 - durationMinutes // Must finish by 19:00

  const morningEndHour = Math.floor(morningEnd / 60)
  const morningEndMin = morningEnd % 60
  const afternoonEndHour = Math.floor(afternoonEnd / 60)
  const afternoonEndMin = afternoonEnd % 60

  return [
    { start: '09:00', end: `${morningEndHour.toString().padStart(2, '0')}:${morningEndMin.toString().padStart(2, '0')}` },
    { start: '15:00', end: `${afternoonEndHour.toString().padStart(2, '0')}:${afternoonEndMin.toString().padStart(2, '0')}` }
  ]
}


// Generate time slots for car wash, every 15 minutes
// Weekdays: 9h-13h and 15h-18h | Saturday: 9h-17h continuous
const generateTimeSlots = (isSaturday: boolean = false) => {
  const slots: string[] = []

  if (isSaturday) {
    // Saturday: continuous 9:00-17:00
    for (let hour = 9; hour <= 17; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        if (hour === 17 && minute > 0) break // Stop at 17:00
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        slots.push(time)
      }
    }
  } else {
    // Weekdays: Morning 9h-13h
    for (let hour = 9; hour < 13; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        slots.push(time)
      }
    }

    // Weekdays: Afternoon 15h-18h (18:00 is the maximum/last slot)
    for (let hour = 15; hour < 19; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        if (hour === 18 && minute > 0) break
        slots.push(time)
      }
    }
  }

  return slots
}

const CAR_WASH_TIME_SLOTS = generateTimeSlots(false)
const CAR_WASH_TIME_SLOTS_SATURDAY = generateTimeSlots(true)

interface CarWashBookingsTabProps {
  initialData?: { appointmentDate?: string, appointmentTime?: string } | null
  onDataConsumed?: () => void
}

export default function CarWashBookingsTab({ initialData, onDataConsumed }: CarWashBookingsTabProps = {}) {
  const [bookings, setBookings] = useState<CarWashBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [carWashServices, setCarWashServices] = useState<CarWashService[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingBooking, setEditingBooking] = useState<CarWashBooking | null>(null)
  const [selectedMainTab, setSelectedMainTab] = useState<'lavaggio' | 'meccanica'>('lavaggio')

  // Wizard state
  const [currentStep, setCurrentStep] = useState<0 | 1 | 2 | 3>(0)
  const [selectedService, setSelectedService] = useState<CarWashService | null>(null)
  const [selectedPriceOption, setSelectedPriceOption] = useState<{ label: string; price: number } | null>(null)
  const [selectedExtras, setSelectedExtras] = useState<CarWashService[]>([])
  const [extraPriceOptions, setExtraPriceOptions] = useState<Record<string, { label: string; price: number }>>({})
  const [extraQuantities, setExtraQuantities] = useState<Record<string, number>>({})
  const [showNewClientModal, setShowNewClientModal] = useState(false)

  // Vehicle classification state (Step 0)
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleMakeModel, setVehicleMakeModel] = useState('')
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory | null>(null)
  const [classificationSource, setClassificationSource] = useState<'local' | 'api' | 'manual' | null>(null)
  const [lookingUpTarga, setLookingUpTarga] = useState(false)
  const [targaVehicleInfo, setTargaVehicleInfo] = useState<{ brand?: string; model?: string; year?: string; fuel?: string; powerCV?: string } | null>(null)

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const [formData, setFormData] = useState({
    customer_id: '',
    service_name: '',
    appointment_date: todayStr,
    appointment_time: '',
    price_total: 0,
    payment_status: 'paid',
    amount_paid: '0',
    notes: ''
  })

  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

  // Manual price override
  const [manualPrice, setManualPrice] = useState<string | null>(null)

  // Quick Edit Customer Modal State
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [customerToEdit, setCustomerToEdit] = useState<any>(null)




  // Wizard computed values
  const getTotal = () => {
    let total = 0
    if (selectedService) {
      total += selectedPriceOption?.price ?? selectedService.price
    }
    for (const extra of selectedExtras) {
      const ep = extraPriceOptions[extra.id]
      const qty = extraQuantities[extra.id] || 1
      total += (ep?.price ?? extra.price) * qty
    }
    return total
  }

  const getFinalPrice = () => {
    if (manualPrice !== null && manualPrice !== '') {
      const parsed = parseFloat(manualPrice)
      return isNaN(parsed) ? getTotal() : parsed
    }
    return getTotal()
  }

  const getTotalDuration = () => {
    let duration = 0
    if (selectedService) {
      duration += selectedService.durationMinutes || parseDurationToMinutes(selectedService.duration)
    }
    for (const extra of selectedExtras) {
      const qty = extraQuantities[extra.id] || 1
      duration += (extra.durationMinutes || parseDurationToMinutes(extra.duration)) * qty
    }
    return duration
  }

  const buildServiceNames = () => {
    const parts: string[] = []
    if (selectedService) {
      let name = selectedService.name
      if (selectedPriceOption) name += ` (${selectedPriceOption.label})`
      parts.push(name)
    }
    for (const extra of selectedExtras) {
      let name = extra.name
      const ep = extraPriceOptions[extra.id]
      if (ep) name += ` (${ep.label})`
      const qty = extraQuantities[extra.id] || 1
      if (qty > 1) name += ` x${qty}`
      parts.push(name)
    }
    return parts.join(' + ')
  }

  const resetWizard = () => {
    setCurrentStep(0)
    setSelectedService(null)
    setSelectedPriceOption(null)
    setSelectedExtras([])
    setExtraPriceOptions({})
    setExtraQuantities({})
    setManualPrice(null)
    setVehiclePlate('')
    setVehicleMakeModel('')
    setVehicleCategory(null)
    setClassificationSource(null)
    setLookingUpTarga(false)
    setTargaVehicleInfo(null)
    setFormData({
      customer_id: '',
      service_name: '',
      appointment_date: todayStr,
      appointment_time: '',
      price_total: 0,
      payment_status: 'paid',
      amount_paid: '0',
      notes: ''
    })
  }

  // Service filtering
  const categoryLabels: Record<string, string> = {
    urban: 'PRIME URBAN CLASS',
    maxi: 'PRIME MAXI CLASS',
    extra: 'PRIME EXTRA CARE',
    moto: 'PRIME MOTO',
    experience: 'PRIME EXPERIENCE',
    tech: 'PRIME TECH SERVICE'
  }

  // Targa lookup handler
  async function handleTargaLookup() {
    if (vehiclePlate.length < 5 || lookingUpTarga) return
    setLookingUpTarga(true)
    setTargaVehicleInfo(null)
    try {
      const response = await fetch('/.netlify/functions/lookup-targa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targa: vehiclePlate }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        toast.error(err.error || 'Targa non trovata')
        return
      }
      const data = await response.json()
      setTargaVehicleInfo({
        brand: data.brand,
        model: data.model,
        year: data.year,
        fuel: data.fuel,
        powerCV: data.powerCV,
      })
      // Auto-fill make/model and classify
      if (data.makeModel) {
        setVehicleMakeModel(data.makeModel)
        // Auto-classify
        const localResult = classifyVehicleLocally(data.makeModel)
        if (localResult) {
          setVehicleCategory(localResult.category)
          setClassificationSource('local')
        } else {
          // Fallback to API classification
          classifyVehicle(data.makeModel).then(result => {
            setVehicleCategory(result.category)
            setClassificationSource(result.source === 'local' ? 'local' : 'api')
          })
        }
      }
    } catch (err) {
      console.error('Targa lookup error:', err)
      toast.error('Errore nella ricerca targa')
    } finally {
      setLookingUpTarga(false)
    }
  }

  const filteredByTab = carWashServices.filter(s => s.main_tab === selectedMainTab)
  // Filter main services by vehicle category if classified
  const mainServices = filteredByTab.filter(s => {
    if (s.category === 'extra' || s.category === 'experience') return false
    // If vehicle is classified, only show matching urban/maxi services (plus moto, tech)
    if (vehicleCategory && (s.category === 'urban' || s.category === 'maxi')) {
      return s.category === vehicleCategory
    }
    return true
  })
  const extraServices = filteredByTab.filter(s => s.category === 'extra' || s.category === 'experience')

  const servicesByCategory = mainServices.reduce<Record<string, CarWashService[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})



  async function openEditCustomer(customerId: string) {
    if (!customerId) return
    try {
      const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

      if (error) throw error
      if (data) {
        setCustomerToEdit(data)
        setEditModalOpen(true)
      }
    } catch (error) {
      console.error('Error fetching customer for edit:', error)
      toast.error("Impossibile caricare i dati del cliente per la modifica.")
    }
  }

  useEffect(() => {
    loadData()

    // Real-time subscription for new bookings
    const subscription = supabase
      .channel('carwash-bookings-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          console.log('🔄 CarWashBookingsTab: Real-time update received', payload)
          loadData()
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Handle initial data from calendar
  useEffect(() => {
    if (initialData && initialData.appointmentDate && initialData.appointmentTime) {
      setFormData(prev => ({
        ...prev,
        appointment_date: initialData.appointmentDate!,
        appointment_time: initialData.appointmentTime!
      }))
      setShowForm(true)
      if (onDataConsumed) {
        onDataConsumed()
      }
    }
  }, [initialData, onDataConsumed])

  async function loadData() {
    setLoading(true)
    try {
      // Load bookings (exclude cancelled) - sorted by creation time (newest first)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'car_wash')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })

      if (bookingsError) throw bookingsError

      // Load customers from customers_extended (includes all customers from all sources)
      const { data: customersData, error: customersError } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, ragione_sociale, email, telefono')
        .order('cognome')

      if (customersError) throw customersError

      // Load car wash services from database
      const { data: servicesData, error: servicesError } = await supabase
        .from('car_wash_services')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true })

      if (servicesError) throw servicesError

      // Map services with computed fields
      const mappedServices: CarWashService[] = (servicesData || []).map((s: any) => ({
        ...s,
        durationMinutes: parseDurationToMinutes(s.duration),
        allowedTimeRanges: getAllowedTimeRanges(parseDurationToMinutes(s.duration))
      }))

      // Map customers_extended to Customer interface
      const mappedCustomers: Customer[] = (customersData || []).map((c: any) => ({
        id: c.id,
        full_name: c.ragione_sociale || `${c.nome || ''} ${c.cognome || ''}`.trim(),
        email: c.email,
        phone: c.telefono
      }))

      setBookings(bookingsData || [])
      setCustomers(mappedCustomers)
      setCarWashServices(mappedServices)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteBooking(bookingId: string, customerName: string) {
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
      }

      // Delete dependent records first (FK constraints)
      await supabase.from('contracts').delete().eq('booking_id', bookingId)
      await supabase.from('fatture').delete().eq('booking_id', bookingId)
      await supabase.from('cauzioni').delete().eq('riferimento_contratto_id', bookingId)

      // Delete from database
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)

      if (error) throw error

      toast.success('Prenotazione eliminata')
      loadData()
    } catch (error: any) {
      console.error('Failed to delete booking:', error)
      toast.error(`Errore durante l'eliminazione: ${error.message}`)
    }
  }

  const [generatingInvoice, setGeneratingInvoice] = useState(false)

  async function handleGenerateInvoice(booking: CarWashBooking) {
    if (!booking.id) return

    // Include IVA (22%) in invoice breakdown
    const includeIVA = true

    setGeneratingInvoice(true)
    try {
      const response = await fetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, includeIVA })
      })

      const data = await response.json()
      if (!response.ok) {
        if (data.invoiceNumber) {
          toast.error(`Fattura già esistente: ${data.invoiceNumber}. Vai alla tab "Fatture" per visualizzarla.`)
        } else {
          const errorMsg = data.message || data.error || 'Impossibile generare la fattura'
          const errorDetails = data.details ? `\n\nDettagli: ${data.details}` : ''
          const errorHint = data.hint ? `\n\nSuggerimento: ${data.hint}` : ''
          throw new Error(errorMsg + errorDetails + errorHint)
        }
        return
      }

      // Generate and open the invoice PDF
      const invoiceId = data.invoice.id
      const pdfResponse = await fetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })

      if (pdfResponse.ok) {
        const html = await pdfResponse.text()
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const printWindow = window.open(url, '_blank')

        if (printWindow) {
          setTimeout(() => URL.revokeObjectURL(url), 3000)
          toast.success(`Fattura generata con successo! Numero: ${data.invoice.numero_fattura}`)
        } else {
          toast.success(`Fattura generata con successo! Numero: ${data.invoice.numero_fattura}. Vai alla tab "Fatture" per visualizzarla.`)
        }
      } else {
        toast.success(`Fattura generata con successo! Numero: ${data.invoice.numero_fattura}. Vai alla tab "Fatture" per visualizzarla.`)
      }

      loadData()
    } catch (error: any) {
      console.error('Error generating invoice:', error)
      const errorMessage = error.message || ''

      // Check for validation errors (missing address/tax code)
      if (errorMessage.includes('obbligatorio') || errorMessage.includes('incomplete') || errorMessage.includes('required') || errorMessage.includes('missing')) {
        openEditCustomer(booking.customer_id)
        return
      }
      toast.error('Errore nella generazione della fattura: ' + errorMessage)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  async function createBooking(forceBooking: boolean = false) {
    // Get customer details from selected customer
    const customer = customers.find(c => c.id === formData.customer_id)
    if (!customer) throw new Error('Cliente non trovato')

    const customerName = customer.full_name
    const customerEmail = customer.email || ''
    const customerPhone = customer.phone || ''

    // Create appointment datetime in Europe/Rome timezone
    const [year, month, day] = formData.appointment_date.split('-').map(Number)
    const [hours, minutes] = formData.appointment_time.split(':').map(Number)
    const appointmentDate = new Date(year, month - 1, day, hours, minutes, 0)
    const appointmentDateTime = appointmentDate.toISOString()

    // Total price: manual override or wizard selections
    const totalPrice = getFinalPrice()
    const serviceNames = buildServiceNames()

    // Build cart items for booking details (backward compatible format)
    const cartItems: any[] = []
    if (selectedService) {
      cartItems.push({
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        quantity: 1,
        price: selectedPriceOption?.price ?? selectedService.price,
        option: selectedPriceOption?.label || null,
        subtotal: selectedPriceOption?.price ?? selectedService.price
      })
    }
    for (const extra of selectedExtras) {
      const ep = extraPriceOptions[extra.id]
      const qty = extraQuantities[extra.id] || 1
      const unitPrice = ep?.price ?? extra.price
      cartItems.push({
        serviceId: extra.id,
        serviceName: extra.name,
        quantity: qty,
        price: unitPrice,
        option: ep?.label || null,
        subtotal: unitPrice * qty
      })
    }

    const bookingDetails: any = {
      notes: formData.notes,
      forceBooked: forceBooking,
      amountPaid: Math.round(parseFloat(formData.amount_paid) * 100),
      adminOverride: forceBooking,
      createdBy: 'admin_panel',
      cartItems: cartItems,
      totalDuration: getTotalDuration(),
      ...(vehicleCategory && { vehicleCategory }),
      ...(vehicleMakeModel && { vehicleMakeModel }),
      ...(classificationSource && { classificationSource }),
    }

    const bookingPayload: any = {
      service_type: 'car_wash',
      service_name: serviceNames,
      vehicle_name: vehicleMakeModel || 'Car Wash Service',
      vehicle_plate: vehiclePlate || null,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      guest_name: customerName,
      guest_email: customerEmail || null,
      guest_phone: customerPhone || null,
      appointment_date: appointmentDateTime,
      appointment_time: formData.appointment_time,
      pickup_date: appointmentDateTime,
      dropoff_date: appointmentDateTime,
      pickup_location: 'DR7 Empire - Car Wash',
      dropoff_location: 'DR7 Empire - Car Wash',
      price_total: Math.round(totalPrice * 100),
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
          customerName,
          customerEmail,
          customerPhone,
          items: [{
            description: `Servizio Lavaggio: ${serviceNames}`,
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
    } catch (invoiceError) {
      console.error('⚠️ Failed to generate invoice:', invoiceError)
    }

    // Send WhatsApp notification
    try {
      const paymentStatus = formData.payment_status || 'pending'
      const amountPaid = paymentStatus === 'paid' ? totalPrice * 100 : 0

      // Send admin notification (detailed internal format)
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking: {
            id: data.id || '',
            service_type: 'car_wash',
            service_name: serviceNames,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            vehicle_plate: vehiclePlate || null,
            appointment_date: appointmentDateTime,
            price_total: totalPrice * 100,
            payment_status: paymentStatus,
            booking_details: {
              serviceName: serviceNames,
              amountPaid: amountPaid,
              notes: formData.notes || ''
            }
          }
        })
      })

      // Send customer confirmation message
      if (customerPhone) {
        const custFirstName = customerName?.split(' ')[0] || 'Cliente'
        const apptDt = new Date(appointmentDateTime)
        const fmtDate = apptDt.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
        const fmtTime = apptDt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
        const totalEur = totalPrice.toFixed(2)
        const bookingIdShort = (data.id || '').substring(0, 8).toUpperCase()

        let paymentLabel = ''
        if (paymentStatus === 'paid') {
          paymentLabel = 'Pagato'
        } else if (amountPaid > 0) {
          paymentLabel = `${(amountPaid / 100).toFixed(2)}€ pagati - ${((totalPrice * 100 - amountPaid) / 100).toFixed(2)}€ da pagare`
        } else {
          paymentLabel = 'Da saldare'
        }

        let custMsg = `Salve ${custFirstName},\n\nConfermiamo il suo appuntamento.\n\n`
        custMsg += `*NUOVA PRENOTAZIONE AUTOLAVAGGIO*\n\n`
        custMsg += `*ID:* DR7-${bookingIdShort}\n`
        custMsg += `*Servizio:* ${serviceNames}\n`
        custMsg += `*Data e Ora:* ${fmtDate} alle ${fmtTime}\n`
        if (formData.notes) custMsg += `*Note:* ${formData.notes}\n`
        custMsg += `*Totale:* €${totalEur}\n`
        custMsg += `*Pagamento:* ${paymentLabel}\n`
        custMsg += `\nCordiali Saluti,\nDR7`

        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customMessage: custMsg, customPhone: customerPhone })
        })
        console.log('✅ WhatsApp customer confirmation sent to', customerPhone)
      }
    } catch (whatsappError) {
      console.error('⚠️ WhatsApp notification failed:', whatsappError)
    }

    // Add to Google Calendar
    try {
      const durationMinutes = getTotalDuration()
      const endDate = new Date(year, month - 1, day, hours, minutes + durationMinutes, 0)
      const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const endTimeStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`

      await fetch('/.netlify/functions/create-calendar-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleName: `🧼 ${serviceNames}${vehicleMakeModel ? ` - ${vehicleMakeModel}` : ''}${vehiclePlate ? ` [${vehiclePlate}]` : ''}`,
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
    } catch (calendarError) {
      console.error('⚠️ Failed to create Google Calendar event:', calendarError)
    }

    // Success — UI updates automatically
    setShowForm(false)
    resetWizard()
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

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)

    try {
      if (!selectedService) {
        toast.error('Seleziona almeno un servizio')
        setSubmitting(false)
        return
      }

      if (!formData.customer_id) {
        toast.error('Seleziona un cliente')
        setSubmitting(false)
        return
      }

      if (!formData.appointment_time) {
        toast.error('Seleziona un orario')
        setSubmitting(false)
        return
      }

      const totalDuration = getTotalDuration()
      const serviceNames = buildServiceNames()

      // ===== SCHEDULING RULES VALIDATION =====
      // Enforce non-negotiable scheduling rules for WASH events
      console.log('🔍 Validating scheduling rules for wash booking...')
      console.log(`  Services: ${serviceNames}`)
      console.log(`  Date: ${formData.appointment_date}`)
      console.log(`  Time: ${formData.appointment_time}`)
      console.log(`  Total Duration: ${totalDuration} min`)

      // Create wash event datetime
      const [year, month, day] = formData.appointment_date.split('-').map(Number)
      const [hours, minutes] = formData.appointment_time.split(':').map(Number)
      const washDateTime = new Date(year, month - 1, day, hours, minutes, 0)

      const washEvent = {
        type: 'WASH' as const,
        dateTime: washDateTime,
        vehicleName: serviceNames,
        durationMinutes: totalDuration
      }

      const schedulingValidation = await validateScheduling(washEvent)

      if (!schedulingValidation.isValid) {
        console.error('❌ Scheduling validation failed:', schedulingValidation.errors)

        // Build error message
        let errorMessage = '🚫 CONFLITTO DI PROGRAMMAZIONE\n\n'
        errorMessage += 'La prenotazione lavaggio viola le regole di programmazione obbligatorie:\n\n'

        schedulingValidation.errors.forEach((error, index) => {
          errorMessage += `${index + 1}. ${error.message}\n\n`
        })

        errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
        errorMessage += '📋 REGOLE DI PROGRAMMAZIONE:\n\n'
        errorMessage += '• LAVAGGIO + RICONSEGNA → Gap minimo 30 minuti\n'
        errorMessage += '• LAVAGGIO + RITIRO → Gap minimo 15 minuti\n'
        errorMessage += '• LAVAGGIO + LAVAGGIO → Nessun evento simultaneo\n\n'

        // Add suggested slots if available
        if (schedulingValidation.suggestedSlots && schedulingValidation.suggestedSlots.length > 0) {
          errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
          errorMessage += '✅ ORARI DISPONIBILI SUGGERITI:\n\n'
          schedulingValidation.suggestedSlots.slice(0, 3).forEach((slot, index) => {
            const slotDate = new Date(slot)
            errorMessage += `${index + 1}. ${slotDate.toLocaleDateString('it-IT')} alle ${slotDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n`
          })
          errorMessage += '\n'
        }

        errorMessage += 'Modifica l\'orario per rispettare le regole di programmazione.'

        toast.error(errorMessage, { duration: 8000 })
        setSubmitting(false)
        return
      }

      console.log('✅ Scheduling validation passed')

      // ADMIN PANEL: Always allow bookings, just show warning if there's a conflict
      console.log('🔧 ADMIN PANEL: Checking for conflicts (informational only)')

      const newBookingDuration = totalDuration

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
          const existingService = carWashServices.find(s => s.name === booking.service_name)
          const existingDuration = existingService?.durationMinutes || 60 // Default to 1 hour if not found

          // Check if time ranges overlap
          if (checkTimeOverlap(formData.appointment_time, newBookingDuration, bookingTime, existingDuration as number)) {
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

      // Log overlap info but don't block the admin
      if (hasConflict && conflictingBooking) {
        console.log('ℹ️ Overlap with existing booking:', conflictingBooking.customer_name, conflictDetails)
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
        toast.error(
          `Impossibile creare la prenotazione. Dettaglio tecnico: ${errorMessage}. Possibile causa: Database constraint o trigger che blocca le doppie prenotazioni.`,
          { duration: 6000 }
        )
      } else {
        toast.error(`Errore nella creazione della prenotazione: ${errorMessage}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Loading...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl sm:text-2xl font-light text-dr7-gold tracking-[0.3em] uppercase">Lavaggio</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-theme-text-muted">
            {bookings.length} prenotazion{bookings.length !== 1 ? 'i' : 'e'}
          </div>
          <button
            onClick={() => {
              if (!showForm) resetWizard()
              setShowForm(!showForm)
            }}
            className="px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-full transition-colors"
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
          className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold"
        />
      </div>

      {/* Quick Edit Customer Modal */}
      <NewClientModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialData={customerToEdit}
        onClientCreated={() => {
          loadData()
        }}
      />

      {/* New Client Modal for Wizard Step 3 */}
      <NewClientModal
        isOpen={showNewClientModal}
        onClose={() => setShowNewClientModal(false)}
        onClientCreated={(clientId) => {
          setFormData(prev => ({ ...prev, customer_id: clientId }))
          setShowNewClientModal(false)
          loadData()
        }}
      />

      {showForm && (
        <div className="bg-transparent rounded-lg p-6 border border-theme-border mb-6">
          {/* Step Indicator */}
          <div className="flex items-center justify-center mb-6">
            {[
              { step: 0 as const, label: 'Veicolo' },
              { step: 1 as const, label: 'Servizio' },
              { step: 2 as const, label: 'Extra' },
              { step: 3 as const, label: 'Conferma' }
            ].map(({ step, label }, idx) => (
              <div key={step} className="flex items-center">
                <button
                  type="button"
                  onClick={() => { if (step < currentStep) setCurrentStep(step) }}
                  disabled={step > currentStep}
                  className={`flex flex-col items-center ${step <= currentStep ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    step === currentStep
                      ? 'bg-dr7-gold text-black'
                      : step < currentStep
                        ? 'bg-dr7-gold/60 text-black'
                        : 'bg-theme-bg-tertiary text-theme-text-muted'
                  }`}>
                    {step < currentStep ? '✓' : step}
                  </div>
                  <span className={`text-xs mt-1 ${step <= currentStep ? 'text-dr7-gold' : 'text-theme-text-muted'}`}>
                    {label}
                  </span>
                </button>
                {idx < 3 && (
                  <div className={`w-12 h-0.5 mx-1.5 mb-4 ${step < currentStep ? 'bg-dr7-gold/60' : 'bg-theme-bg-tertiary'}`} />
                )}
              </div>
            ))}
          </div>

          {/* ===== STEP 0: Vehicle Identification ===== */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-theme-text-primary">Identificazione Veicolo</h3>

              {/* Targa + Cerca */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Targa</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="ES. AB123CD"
                    className="flex-1 px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary font-mono tracking-widest uppercase focus:border-dr7-gold focus:outline-none"
                    maxLength={10}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && vehiclePlate.length >= 5 && !lookingUpTarga) {
                        e.preventDefault()
                        handleTargaLookup()
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={vehiclePlate.length < 5 || lookingUpTarga}
                    onClick={handleTargaLookup}
                    className={`px-5 py-3 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${
                      vehiclePlate.length < 5 || lookingUpTarga
                        ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                        : 'bg-dr7-gold hover:bg-yellow-500 text-black'
                    }`}
                  >
                    {lookingUpTarga ? 'Ricerca...' : 'Cerca'}
                  </button>
                </div>
              </div>

              {/* Targa lookup result card */}
              {targaVehicleInfo && (
                <div className="p-3 bg-green-900/20 border border-green-600/40 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-green-400 text-sm font-bold">Veicolo trovato</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                    {targaVehicleInfo.brand && (
                      <div><span className="text-theme-text-muted">Marca:</span> <span className="text-theme-text-primary font-medium">{targaVehicleInfo.brand}</span></div>
                    )}
                    {targaVehicleInfo.model && (
                      <div><span className="text-theme-text-muted">Modello:</span> <span className="text-theme-text-primary font-medium">{targaVehicleInfo.model}</span></div>
                    )}
                    {targaVehicleInfo.year && (
                      <div><span className="text-theme-text-muted">Anno:</span> <span className="text-theme-text-primary">{targaVehicleInfo.year}</span></div>
                    )}
                    {targaVehicleInfo.fuel && (
                      <div><span className="text-theme-text-muted">Carburante:</span> <span className="text-theme-text-primary">{targaVehicleInfo.fuel}</span></div>
                    )}
                    {targaVehicleInfo.powerCV && (
                      <div><span className="text-theme-text-muted">Potenza:</span> <span className="text-theme-text-primary">{targaVehicleInfo.powerCV} CV</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Classification Result (auto from targa) */}
              {vehicleCategory && (
                <div className={`p-4 rounded-lg border-2 ${
                  vehicleCategory === 'urban'
                    ? 'bg-blue-900/20 border-blue-500/50'
                    : 'bg-orange-900/20 border-orange-500/50'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${
                      vehicleCategory === 'urban'
                        ? 'bg-blue-600 text-white'
                        : 'bg-orange-600 text-white'
                    }`}>
                      {vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                    </span>
                    <span className="text-theme-text-primary font-medium">{vehicleMakeModel}</span>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Annulla
                </button>
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    disabled={!targaVehicleInfo}
                    onClick={() => {
                      // Clear service selection when changing step from 0 to 1 (category may have changed)
                      setSelectedService(null)
                      setSelectedPriceOption(null)
                      setSelectedExtras([])
                      setExtraPriceOptions({})
    setExtraQuantities({})
                      setCurrentStep(1)
                    }}
                    className={`px-6 py-2 rounded-full font-semibold transition-colors ${
                      targaVehicleInfo
                        ? 'bg-dr7-gold hover:bg-yellow-500 text-black'
                        : 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                    }`}
                  >
                    Avanti
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== STEP 1: Service Selection ===== */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* LAVAGGIO / MECCANICA toggle */}
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMainTab('lavaggio')
                    setSelectedService(null)
                    setSelectedPriceOption(null)
                    setSelectedExtras([])
                    setExtraPriceOptions({})
    setExtraQuantities({})
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                    selectedMainTab === 'lavaggio'
                      ? 'bg-theme-text-primary text-theme-bg-primary border-theme-text-primary'
                      : 'bg-theme-bg-primary text-theme-text-primary border-white hover:bg-theme-text-primary hover:text-theme-bg-primary'
                  }`}
                >
                  LAVAGGIO
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMainTab('meccanica')
                    setSelectedService(null)
                    setSelectedPriceOption(null)
                    setSelectedExtras([])
                    setExtraPriceOptions({})
    setExtraQuantities({})
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                    selectedMainTab === 'meccanica'
                      ? 'bg-theme-text-primary text-theme-bg-primary border-theme-text-primary'
                      : 'bg-theme-bg-primary text-theme-text-primary border-white hover:bg-theme-text-primary hover:text-theme-bg-primary'
                  }`}
                >
                  MECCANICA
                </button>
              </div>

              {/* Service Dropdown Selector */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Servizio</label>
                <select
                  value={selectedService?.id || ''}
                  onChange={(e) => {
                    const allServices = Object.values(servicesByCategory).flat()
                    const service = allServices.find(s => s.id === e.target.value) || null
                    setSelectedService(service)
                    setSelectedPriceOption(null)
                  }}
                  className="w-full appearance-none bg-theme-bg-tertiary text-theme-text-primary rounded-lg px-4 py-3 pr-10 border border-theme-border focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                >
                  <option value="">Seleziona servizio...</option>
                  {Object.entries(servicesByCategory).map(([category, services]) => (
                    <optgroup key={category} label={categoryLabels[category] || category.toUpperCase()}>
                      {services.map(service => (
                        <option key={service.id} value={service.id}>
                          {service.name} - EUR {service.price.toFixed(2)} ({service.duration})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Price options (if service has variants) */}
              {selectedService?.price_options && selectedService.price_options.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Opzione prezzo</label>
                  <select
                    value={selectedPriceOption?.label || ''}
                    onChange={(e) => {
                      const opt = selectedService.price_options!.find(o => o.label === e.target.value) || null
                      setSelectedPriceOption(opt)
                    }}
                    className="w-full appearance-none bg-theme-bg-tertiary text-theme-text-primary rounded-lg px-4 py-3 pr-10 border border-theme-border focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="">Seleziona opzione...</option>
                    {selectedService.price_options.map(opt => (
                      <option key={opt.label} value={opt.label}>
                        {opt.label} - EUR {opt.price.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Category badge reminder */}
              {vehicleCategory && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-theme-text-muted">Categoria:</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    vehicleCategory === 'urban' ? 'bg-blue-600 text-white' : 'bg-orange-600 text-white'
                  }`}>
                    {vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                  </span>
                  {vehicleMakeModel && <span className="text-theme-text-muted text-xs">({vehicleMakeModel})</span>}
                </div>
              )}

              {/* Avanti button */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(0)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Indietro
                </button>
                <button
                  type="button"
                  disabled={!selectedService || (selectedService.price_options && selectedService.price_options.length > 0 && !selectedPriceOption)}
                  onClick={() => setCurrentStep(2)}
                  className={`px-6 py-2 rounded-full font-semibold transition-colors ${
                    selectedService && (!selectedService.price_options?.length || selectedPriceOption)
                      ? 'bg-dr7-gold hover:bg-yellow-500 text-black'
                      : 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                  }`}
                >
                  Avanti
                </button>
              </div>
            </div>
          )}

          {/* ===== STEP 2: Extras ===== */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-theme-text-primary">Servizi Extra (opzionale)</h3>

              {extraServices.length === 0 ? (
                <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg text-center">
                  <p className="text-theme-text-muted text-sm mb-3">Nessun extra disponibile per {selectedMainTab === 'lavaggio' ? 'Lavaggio' : 'Meccanica'}</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {extraServices.filter(e => e.id !== selectedService?.id).map(extra => {
                    const isToggled = selectedExtras.some(e => e.id === extra.id)
                    const hasPriceOptions = extra.price_options && extra.price_options.length > 0
                    const currentExtraOption = extraPriceOptions[extra.id]

                    return (
                      <div key={extra.id} className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (isToggled) {
                              setSelectedExtras(prev => prev.filter(e => e.id !== extra.id))
                              setExtraPriceOptions(prev => {
                                const next = { ...prev }
                                delete next[extra.id]
                                return next
                              })
                            } else if (!hasPriceOptions) {
                              setSelectedExtras(prev => [...prev, extra])
                            } else {
                              // For extras with price options, toggle on (user picks variant below)
                              setSelectedExtras(prev => [...prev, extra])
                            }
                          }}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border flex items-center gap-2 ${
                            isToggled
                              ? 'bg-dr7-gold/20 border-dr7-gold text-dr7-gold'
                              : 'bg-theme-bg-tertiary border-theme-border text-theme-text-primary hover:border-dr7-gold'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                            isToggled ? 'bg-dr7-gold border-dr7-gold text-black' : 'border-theme-text-muted'
                          }`}>
                            {isToggled && '✓'}
                          </span>
                          {extra.name}
                          {!hasPriceOptions && <span className="text-xs opacity-70">EUR {extra.price.toFixed(2)}</span>}
                        </button>
                        {/* Price option variants for this extra */}
                        {isToggled && hasPriceOptions && (
                          <div className="flex flex-wrap gap-1 ml-2">
                            {extra.price_options!.map(opt => (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => {
                                  setExtraPriceOptions(prev => ({ ...prev, [extra.id]: opt }))
                                }}
                                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                                  currentExtraOption?.label === opt.label
                                    ? 'bg-dr7-gold text-black border-dr7-gold font-bold'
                                    : 'border-theme-border text-theme-text-secondary hover:border-dr7-gold'
                                }`}
                              >
                                {opt.label} EUR {opt.price}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Quantity selector for per-unit extras */}
                        {isToggled && extra.price_unit && (
                          <div className="flex items-center gap-2 ml-2">
                            <span className="text-xs text-theme-text-muted">{extra.price_unit}:</span>
                            <button
                              type="button"
                              onClick={() => setExtraQuantities(prev => ({ ...prev, [extra.id]: Math.max(1, (prev[extra.id] || 1) - 1) }))}
                              className="w-7 h-7 rounded-full border border-theme-border text-theme-text-primary hover:border-dr7-gold flex items-center justify-center text-sm"
                            >-</button>
                            <span className="text-sm font-bold text-theme-text-primary w-6 text-center">{extraQuantities[extra.id] || 1}</span>
                            <button
                              type="button"
                              onClick={() => setExtraQuantities(prev => ({ ...prev, [extra.id]: Math.min(10, (prev[extra.id] || 1) + 1) }))}
                              className="w-7 h-7 rounded-full border border-theme-border text-theme-text-primary hover:border-dr7-gold flex items-center justify-center text-sm"
                            >+</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Running total */}
              <div className="p-3 bg-theme-bg-tertiary/50 rounded-lg flex justify-between items-center">
                <span className="text-sm text-theme-text-muted">Durata: ~{getTotalDuration()} min</span>
                <span className="text-lg font-bold text-dr7-gold">Totale: EUR {getTotal().toFixed(2)}</span>
              </div>

              {/* Navigation */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Indietro
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedExtras([])
                      setExtraPriceOptions({})
    setExtraQuantities({})
                      setCurrentStep(3)
                    }}
                    className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
                  >
                    Salta Extra
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="px-6 py-2 rounded-full font-semibold bg-dr7-gold hover:bg-yellow-500 text-black transition-colors"
                  >
                    Avanti
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== STEP 3: Confirm & Book ===== */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg border border-dr7-gold/30">
                <h4 className="text-sm font-semibold text-dr7-gold mb-2">Riepilogo</h4>
                {/* Vehicle info */}
                {(vehicleMakeModel || vehiclePlate) && (
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-theme-border text-sm">
                    {vehiclePlate && <span className="font-mono text-dr7-gold font-bold">{vehiclePlate}</span>}
                    {vehicleMakeModel && <span className="text-theme-text-primary">{vehicleMakeModel}</span>}
                    {vehicleCategory && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        vehicleCategory === 'urban' ? 'bg-blue-600 text-white' : 'bg-orange-600 text-white'
                      }`}>
                        {vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                      </span>
                    )}
                  </div>
                )}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-theme-text-primary">
                      {selectedService?.name}
                      {selectedPriceOption && <span className="text-theme-text-muted ml-1">({selectedPriceOption.label})</span>}
                    </span>
                    <span className="text-theme-text-primary font-medium">
                      EUR {(selectedPriceOption?.price ?? selectedService?.price ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {selectedExtras.map(extra => {
                    const ep = extraPriceOptions[extra.id]
                    return (
                      <div key={extra.id} className="flex justify-between text-theme-text-muted">
                        <span>+ {extra.name}{ep ? ` (${ep.label})` : ''}</span>
                        <span>EUR {(ep?.price ?? extra.price).toFixed(2)}</span>
                      </div>
                    )
                  })}
                  <div className="pt-2 mt-2 border-t border-theme-border flex justify-between items-center">
                    <span className="text-theme-text-muted">Durata: ~{getTotalDuration()} min</span>
                    <span className="text-dr7-gold font-bold text-base">EUR {getTotal().toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Manual Price Override */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Prezzo manuale (opzionale)</label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">EUR</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={manualPrice ?? ''}
                      onChange={(e) => setManualPrice(e.target.value === '' ? null : e.target.value)}
                      placeholder={getTotal().toFixed(2)}
                      className="w-full pl-12 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary placeholder-theme-text-muted"
                    />
                  </div>
                  {manualPrice !== null && (
                    <button
                      type="button"
                      onClick={() => setManualPrice(null)}
                      className="px-3 py-2 text-xs text-theme-text-muted hover:text-theme-text-primary border border-theme-border rounded transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {manualPrice !== null && manualPrice !== '' && (
                  <p className="text-xs text-dr7-gold mt-1">
                    Prezzo manuale: EUR {parseFloat(manualPrice).toFixed(2)} (invece di EUR {getTotal().toFixed(2)})
                  </p>
                )}
              </div>

              {/* Customer */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cliente *</label>
                <CustomerAutocomplete
                  customers={customers}
                  selectedCustomerId={formData.customer_id}
                  onSelectCustomer={(customerId) => setFormData(prev => ({ ...prev, customer_id: customerId }))}
                  placeholder="Inizia a scrivere nome, email o telefono..."
                  required={true}
                />
                <button
                  type="button"
                  onClick={() => setShowNewClientModal(true)}
                  className="mt-2 text-sm text-dr7-gold hover:underline"
                >
                  + Nuovo Cliente
                </button>
                {formData.customer_id && (() => {
                  const sel = customers.find(c => c.id === formData.customer_id)
                  if (!sel) return null
                  return (
                    <div className="mt-2 p-2 bg-green-900/30 border border-green-600/50 rounded-lg text-sm">
                      <span className="text-green-400 font-medium">{sel.full_name}</span>
                      {sel.phone && <span className="text-theme-text-muted ml-2">{sel.phone}</span>}
                    </div>
                  )
                })()}
              </div>

              {/* Date + Time side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data *</label>
                  <input
                    type="date"
                    value={formData.appointment_date}
                    onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Ora *</label>
                  <select
                    value={formData.appointment_time}
                    onChange={(e) => setFormData({ ...formData, appointment_time: e.target.value })}
                    className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="">Seleziona orario</option>
                    {(() => {
                      const selectedDay = formData.appointment_date ? new Date(formData.appointment_date + 'T12:00:00').getDay() : -1
                      const isSat = selectedDay === 6
                      const slots = isSat ? CAR_WASH_TIME_SLOTS_SATURDAY : CAR_WASH_TIME_SLOTS
                      const morningSlots = slots.filter(t => t.startsWith('09') || t.startsWith('10') || t.startsWith('11') || t.startsWith('12'))
                      const afternoonSlots = isSat
                        ? slots.filter(t => t.startsWith('13') || t.startsWith('14') || t.startsWith('15') || t.startsWith('16') || t.startsWith('17'))
                        : slots.filter(t => t.startsWith('15') || t.startsWith('16') || t.startsWith('17') || t.startsWith('18'))

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

              {/* Payment + Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Pagamento</label>
                  <select
                    value={formData.payment_status}
                    onChange={(e) => {
                      const newStatus = e.target.value
                      const total = getFinalPrice()
                      const newAmountPaid = newStatus === 'paid' ? total.toString() : '0'
                      setFormData({ ...formData, payment_status: newStatus, amount_paid: newAmountPaid })
                    }}
                    className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                  >
                    <option value="paid">Pagato</option>
                    <option value="pending">Da Saldare</option>
                    <option value="unpaid">Non Pagato</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Note</label>
                  <input
                    type="text"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    placeholder="Opzionale..."
                  />
                </div>
              </div>

              {/* Navigation + Confirm */}
              <div className="flex justify-between items-center pt-4 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Indietro
                </button>
                <button
                  type="button"
                  disabled={submitting || !formData.customer_id || !formData.appointment_time}
                  onClick={() => handleSubmit()}
                  className={`px-8 py-3 rounded-full font-bold text-base transition-colors ${
                    submitting || !formData.customer_id || !formData.appointment_time
                      ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                      : 'bg-dr7-gold hover:bg-yellow-500 text-black'
                  }`}
                >
                  {submitting ? 'Creazione...' : `Conferma - EUR ${getFinalPrice().toFixed(2)}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {
        bookings.length === 0 ? (
          <div className=" rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
            Nessuna prenotazione lavaggio trovata
          </div>
        ) : (
          <div className=" rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead className="er">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Cliente</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Servizio</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Data & Ora</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Prezzo</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Pagamento</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.filter(booking => {

                    // Search filter
                    if (!bookingSearchQuery) return true
                    const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean)
                    const customerName = (booking.customer_name || '').toLowerCase()
                    return words.every(word => customerName.includes(word))
                  }).map((booking) => (
                    <tr key={booking.id} className="border-t border-theme-border hover:er/50">
                      <td className="px-4 py-3 text-sm text-theme-text-primary">
                        {booking.customer_name === 'Lavaggio Rientro' ? (
                          <>
                            <div className="font-medium">Lavaggio Rientro</div>
                            {booking.vehicle_name && (
                              <div className="text-xs text-theme-text-primary mt-1">
                                {booking.vehicle_name}
                              </div>
                            )}
                            {booking.vehicle_plate && (
                              <div className="text-xs text-dr7-gold font-mono">
                                {booking.vehicle_plate}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="font-medium">{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</div>
                            <div className="text-xs text-theme-text-muted">{booking.customer_email || booking.booking_details?.customer?.email || '-'}</div>
                            <div className="text-xs text-theme-text-muted">{booking.customer_phone || booking.booking_details?.customer?.phone || '-'}</div>
                            {/* Vehicle info */}
                            {(booking.booking_details?.vehicleMakeModel || (booking.vehicle_name && booking.vehicle_name !== 'Car Wash Service')) && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-xs text-theme-text-primary">{booking.booking_details?.vehicleMakeModel || booking.vehicle_name}</span>
                                {booking.booking_details?.vehicleCategory && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    booking.booking_details.vehicleCategory === 'urban' ? 'bg-blue-600/30 text-blue-400' : 'bg-orange-600/30 text-orange-400'
                                  }`}>
                                    {booking.booking_details.vehicleCategory === 'urban' ? 'U' : 'M'}
                                  </span>
                                )}
                              </div>
                            )}
                            {booking.vehicle_plate && (
                              <div className="text-xs text-dr7-gold font-mono">{booking.vehicle_plate}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">
                        <div className="font-medium">{booking.service_name}</div>
                        {booking.booking_details?.additionalService && (
                          <div className="text-xs text-theme-text-muted">
                            + {booking.booking_details.additionalService}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">
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
                        <div className="text-xs text-theme-text-muted">
                          {booking.appointment_time || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary font-bold">
                        EUR {(booking.price_total / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${booking.payment_status === 'completed' || booking.payment_status === 'paid' || booking.payment_status === 'succeeded'
                            ? 'bg-green-900 text-green-300'
                            : 'bg-red-900 text-red-300'
                            }`}
                        >
                          {booking.payment_status === 'completed' || booking.payment_status === 'paid' || booking.payment_status === 'succeeded' ? 'Pagato' : 'Non Pagato'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingBooking(booking)}
                            className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-theme-text-primary rounded-full text-xs font-medium transition-colors"
                          >
                            Modifica
                          </button>
                          <button
                            onClick={() => handleGenerateInvoice(booking)}
                            disabled={generatingInvoice}
                            className={`px-3 py-1.5 ${generatingInvoice ? 'bg-theme-bg-hover text-theme-text-secondary' : 'bg-purple-600 hover:bg-purple-700 text-theme-text-primary'} rounded-full text-xs font-medium transition-colors`}
                          >
                            {generatingInvoice ? '...' : 'Fattura'}
                          </button>
                          <button
                            onClick={() => handleDeleteBooking(booking.id, booking.customer_name)}
                            className="px-3 py-1.5 bg-red-600/30 hover:bg-red-600/50 text-theme-text-primary rounded-full text-xs font-medium transition-colors"
                          >
                            ×
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
          <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-theme-border">
              <div className="p-6 border-b border-theme-border">
                <div className="flex justify-between items-start">
                  <h3 className="text-2xl font-bold text-theme-text-primary">Modifica Prenotazione</h3>
                  <button
                    onClick={() => setEditingBooking(null)}
                    className="text-theme-text-muted hover:text-theme-text-primary text-2xl"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cliente</label>
                  <input
                    type="text"
                    value={editingBooking.customer_name}
                    onChange={(e) => setEditingBooking({ ...editingBooking, customer_name: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email</label>
                    <input
                      type="email"
                      value={editingBooking.customer_email || ''}
                      onChange={(e) => setEditingBooking({ ...editingBooking, customer_email: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono</label>
                    <input
                      type="tel"
                      value={editingBooking.customer_phone || ''}
                      onChange={(e) => setEditingBooking({ ...editingBooking, customer_phone: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Servizio</label>
                  <input
                    type="text"
                    value={editingBooking.service_name}
                    onChange={(e) => setEditingBooking({ ...editingBooking, service_name: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data</label>
                    <input
                      type="date"
                      value={editingBooking.appointment_date}
                      onChange={(e) => setEditingBooking({ ...editingBooking, appointment_date: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Ora</label>
                    <input
                      type="time"
                      value={editingBooking.appointment_time}
                      onChange={(e) => setEditingBooking({ ...editingBooking, appointment_time: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Prezzo (€)</label>
                  <input
                    type="number"
                    value={editingBooking.price_total / 100}
                    onChange={(e) => setEditingBooking({ ...editingBooking, price_total: parseFloat(e.target.value) * 100 })}
                    step="0.01"
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato</label>
                    <select
                      value={editingBooking.status}
                      onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value })}
                      className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                    >
                      <option value="pending">In Attesa</option>
                      <option value="confirmed">Confermata</option>
                      <option value="cancelled">Annullata</option>
                      <option value="completed">Completata</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-2">Pagamento</label>
                    <select
                      value={editingBooking.payment_status}
                      onChange={(e) => setEditingBooking({ ...editingBooking, payment_status: e.target.value })}
                      className="w-full appearance-none px-4 py-3 pr-10 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:border-dr7-gold focus:outline-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat"
                    >
                      <option value="pending">In Attesa</option>
                      <option value="paid">Pagato</option>
                      <option value="completed">Completato</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-theme-border flex gap-3">
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

                      // Success — UI updates automatically
                      setEditingBooking(null)
                      loadData()
                    } catch (error) {
                      console.error('Failed to update booking:', error)
                      toast.error('Errore durante l\'aggiornamento')
                    }
                  }}
                  className="flex-1 bg-dr7-gold hover:bg-dr7-gold/90 text-black px-6 py-3 rounded-full font-medium transition-colors"
                >
                  Salva Modifiche
                </button>
                <button
                  onClick={() => setEditingBooking(null)}
                  className="px-6 py-3 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded font-medium transition-colors"
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
