import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import MechanicalBookingForm from './MechanicalBookingForm'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface MechanicalBooking {
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
  vehicle_info: string // Customer's vehicle info
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  booking_details: any
  created_at: string
}



export default function MechanicalBookingTab() {
  const [bookings, setBookings] = useState<MechanicalBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)


  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
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

      setCustomers(mappedCustomers)

      // Load mechanical service bookings
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('service_type', 'mechanical_service')
        .order('appointment_date', { ascending: false })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData || [])
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }



  async function handleDelete(id: string) {
    if (!confirm('Sei sicuro di voler eliminare questa prenotazione?')) return

    try {
      // Try to delete from Google Calendar
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: id }),
        })
        console.log('Google Calendar event deletion requested for booking:', id)
      } catch (calError) {
        console.warn('Failed to request deletion from Google Calendar:', calError)
        // Continue with database deletion even if Google Calendar deletion fails
      }

      // Delete from database
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', id)

      if (error) throw error
      loadData()
    } catch (error) {
      console.error('Failed to delete booking:', error)
      alert('Errore durante l\'eliminazione')
    }
  }

  // State for search query
  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white">Caricamento...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">🔧 Prenotazioni Meccanica</h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-md transition-colors"
        >
          + Nuova Prenotazione
        </button>
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


      {/* Booking Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <MechanicalBookingForm
              initialData={editingId ? bookings.find(b => b.id === editingId) : undefined}
              editingId={editingId}
              customers={customers}
              onSave={() => {
                setShowForm(false)
                setEditingId(null)
                loadData()
              }}
              onCancel={() => {
                setShowForm(false)
                setEditingId(null)
              }}
            />
          </div>
        </div>
      )}

      {/* Bookings Table */}
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Cliente</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Veicolo</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Servizio</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Appuntamento</th>
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
            }).map(booking => (
              <tr key={booking.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                <td className="px-4 py-3 text-sm text-white">
                  <div>{booking.customer_name}</div>
                  <div className="text-gray-400 text-xs">{booking.customer_phone}</div>
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {booking.booking_details?.vehicleInfo || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  {booking.service_name}
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  <div>
                    {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </div>
                  <div className="text-dr7-gold">{booking.appointment_time}</div>
                </td>
                <td className="px-4 py-3 text-sm text-white">
                  €{(booking.price_total / 100).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${booking.payment_status === 'paid' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                    {booking.payment_status === 'paid' ? 'Pagato' : 'Non Pagato'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(booking.id)
                        setShowForm(true)
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                    >
                      Modifica
                    </button>
                    <button
                      onClick={() => handleDelete(booking.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                    >
                      Elimina
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {bookings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Nessuna prenotazione trovata
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Info Note */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <h4 className="text-white font-semibold mb-2">📝 Note Importanti</h4>
        <ul className="text-gray-300 text-sm space-y-1">
          <li>• Tutti i prezzi, tranne le lucidature, sono di sola manodopera</li>
          <li>• I pezzi possono essere forniti dal cliente o acquistati tramite DR7</li>
          <li>• Controllo livelli incluso nei tagliandi rapidi</li>
        </ul>
      </div>
    </div>
  )
}
