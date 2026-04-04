import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import Select from './Select'
import CustomerAutocomplete from './CustomerAutocomplete'

/** Convert EUR to integer cents using string parsing (no floating point) */
function eurToCents(eur: number): number {
  return Math.round(eur * 100)
}

const LOCATIONS_MAP: Record<string, string> = {
  dr7_office: 'Viale Marconi, 229, 09131 Cagliari CA',
  cagliari_airport: 'Aeroporto di Cagliari Elmas (+€50)',
}

const PAYMENT_METHODS = [
  { value: 'Bonifico', label: 'Bonifico' },
  { value: 'Contanti', label: 'Contanti' },
  { value: 'Credit Wallet', label: 'Credit Wallet' },
  { value: 'Carta di Credito / bancomat', label: 'Carta di Credito / bancomat' },
  { value: 'Paypal', label: 'Paypal' },
  { value: 'RIBA', label: 'RIBA' },
]

interface Props {
  isOpen: boolean
  preventivo: any
  customers: Array<{ id: string; full_name: string; email: string | null; phone: string | null }>
  onClose: () => void
  onConverted: () => void
}

export default function ConvertPreventivoModal({ isOpen, preventivo, customers, onClose, onConverted }: Props) {
  const [customerId, setCustomerId] = useState(preventivo.customer_id || '')
  const [paymentStatus, setPaymentStatus] = useState('pending')
  const [paymentMethod, setPaymentMethod] = useState('Contanti')
  const [amountPaid, setAmountPaid] = useState('0')
  const [converting, setConverting] = useState(false)

  const selectedCustomer = customers.find(c => c.id === customerId)

  const handleConvert = async () => {
    if (!customerId) { toast.error('Seleziona un cliente per convertire'); return }
    if (!selectedCustomer) return

    setConverting(true)
    try {
      const totalCents = eurToCents(preventivo.total_amount || 0)
      const paidCents = eurToCents(parseFloat(amountPaid) || 0)

      const pickupLocationLabel = LOCATIONS_MAP[preventivo.pickup_location] || preventivo.pickup_location
      const dropoffLocationLabel = LOCATIONS_MAP[preventivo.dropoff_location] || preventivo.dropoff_location

      // Create booking
      const bookingData: any = {
        user_id: customerId,
        vehicle_id: preventivo.vehicle_id,
        vehicle_name: preventivo.vehicle_name,
        vehicle_plate: preventivo.vehicle_plate,
        pickup_date: preventivo.pickup_date,
        dropoff_date: preventivo.dropoff_date,
        pickup_location: pickupLocationLabel,
        dropoff_location: dropoffLocationLabel,
        price_total: totalCents,
        currency: 'EUR',
        status: paymentStatus === 'paid' ? 'confirmed' : 'pending',
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        amount_paid: paidCents,
        customer_name: selectedCustomer.full_name,
        customer_email: selectedCustomer.email,
        customer_phone: selectedCustomer.phone,
        booking_source: 'admin',
        service_type: 'rental',
        km_overage_fee: preventivo.km_overage_fee || 0,
        delivery_enabled: preventivo.delivery_enabled || false,
        delivery_address: preventivo.delivery_enabled ? { street: preventivo.delivery_street || '', city: preventivo.delivery_city || '', zip: preventivo.delivery_zip || '', province: preventivo.delivery_province || '', notes: preventivo.delivery_notes || '' } : null,
        delivery_fee: eurToCents(preventivo.delivery_fee || 0),
        pickup_enabled: preventivo.pickup_enabled || false,
        pickup_address: preventivo.pickup_enabled ? { street: preventivo.pickup_street || '', city: preventivo.pickup_city || '', zip: preventivo.pickup_zip || '', province: preventivo.pickup_province || '', notes: preventivo.pickup_notes || '' } : null,
        pickup_fee: eurToCents(preventivo.pickup_fee || 0),
        deposit_amount: eurToCents(preventivo.deposit_amount || 0),
        booking_details: {
          customer: {
            fullName: selectedCustomer.full_name,
            email: selectedCustomer.email,
            phone: selectedCustomer.phone,
            id: customerId,
            customerId: customerId,
          },
          vehicle_id: preventivo.vehicle_id,
          pickupLocation: pickupLocationLabel,
          dropoffLocation: dropoffLocationLabel,
          amountPaid: paidCents,
          source: 'admin_manual',
          from_preventivo: preventivo.id,
          fascia: preventivo.fascia,
          insuranceOption: preventivo.insurance_option,
          insurance_daily: preventivo.insurance_daily,
          deposit: preventivo.deposit_amount,
          deposit_status: 'da_incassare',
          km_limit: preventivo.unlimited_km ? 'Illimitati' : (preventivo.km_limit || 0),
          unlimited_km: preventivo.unlimited_km || false,
          km_overage_fee: preventivo.km_overage_fee,
          second_driver: preventivo.second_driver ? { enabled: true } : undefined,
          delivery_enabled: preventivo.delivery_enabled,
          delivery_address: preventivo.delivery_enabled ? { street: preventivo.delivery_street || '', city: preventivo.delivery_city || '', zip: preventivo.delivery_zip || '', province: preventivo.delivery_province || '', notes: preventivo.delivery_notes || '' } : null,
          delivery_fee: eurToCents(preventivo.delivery_fee || 0),
          pickup_enabled: preventivo.pickup_enabled,
          pickup_address: preventivo.pickup_enabled ? { street: preventivo.pickup_street || '', city: preventivo.pickup_city || '', zip: preventivo.pickup_zip || '', province: preventivo.pickup_province || '', notes: preventivo.pickup_notes || '' } : null,
          pickup_fee: eurToCents(preventivo.pickup_fee || 0),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        booked_at: new Date().toISOString(),
      }

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert(bookingData)
        .select('id')
        .single()

      if (bookingError) throw bookingError

      // Update preventivo status
      await supabase.from('preventivi').update({
        status: 'convertito',
        booking_id: booking.id,
        customer_id: customerId,
        customer_name: selectedCustomer.full_name,
        updated_at: new Date().toISOString(),
      }).eq('id', preventivo.id)

      toast.success(`Preventivo convertito in prenotazione!`)
      onConverted()
    } catch (err: any) {
      console.error('Convert error:', err)
      toast.error(`Errore: ${err.message}`)
    } finally {
      setConverting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-theme-border">
          <h2 className="text-lg font-light text-dr7-gold tracking-[0.2em] uppercase">Converti in Prenotazione</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Preventivo summary */}
          <div className="p-3 rounded-lg border border-dr7-gold/30 bg-dr7-gold/5">
            <div className="text-sm text-theme-text-muted">
              <span className="font-semibold text-theme-text-primary">{preventivo.vehicle_name}</span>
              {preventivo.vehicle_plate && <span className="ml-1">({preventivo.vehicle_plate})</span>}
            </div>
            <div className="text-sm text-theme-text-muted mt-1">
              {preventivo.rental_days} giorni • Fascia {preventivo.fascia} • {preventivo.insurance_option}
            </div>
            <div className="text-xl font-bold text-dr7-gold mt-1">€{(preventivo.total_amount || 0).toFixed(2)}</div>
          </div>

          {/* Customer Selection */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cliente *</label>
            <CustomerAutocomplete
              customers={customers}
              selectedCustomerId={customerId}
              onSelectCustomer={(id) => setCustomerId(id)}
              placeholder="Cerca cliente..."
              required={true}
            />
            {selectedCustomer && (
              <div className="mt-2 p-2 bg-green-900/30 border border-green-600/50 rounded-lg text-sm">
                <span className="text-green-400 font-medium">{selectedCustomer.full_name}</span>
                {selectedCustomer.email && <span className="text-theme-text-muted ml-2">{selectedCustomer.email}</span>}
              </div>
            )}
          </div>

          {/* Payment */}
          <Select
            label="Stato Pagamento"
            required
            value={paymentStatus}
            onChange={(e) => {
              const st = e.target.value
              setPaymentStatus(st)
              if (st === 'paid') setAmountPaid(preventivo.total_amount?.toFixed(2) || '0')
              else if (st === 'pending') setAmountPaid('0')
            }}
            options={[
              { value: 'pending', label: 'Da Saldare' },
              { value: 'paid', label: 'Pagato' },
            ]}
          />

          <Select
            label="Metodo di Pagamento"
            required
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            options={PAYMENT_METHODS}
          />
        </div>

        <div className="flex gap-3 p-5 border-t border-theme-border">
          <Button onClick={handleConvert} disabled={converting || !customerId}>
            {converting ? 'Conversione...' : 'Converti'}
          </Button>
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
        </div>
      </div>
    </div>
  )
}
