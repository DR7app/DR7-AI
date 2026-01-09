import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Select from './Select'
import Button from './Button'

interface AviationQuote {
  id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_type: 'individual' | 'company'
  company_vat?: string

  // 1. Flight Details
  departure_location: string
  arrival_location: string
  flight_type: 'one_way' | 'round_trip'
  return_date?: string
  return_time?: string
  direct_flight: boolean
  intermediate_stops?: string
  flight_flexibility: 'fixed' | 'flexible'
  flight_time: 'day' | 'night' | 'both'

  // 2. Passengers
  passenger_count: number
  has_children: boolean
  children_count?: number
  has_pets: boolean
  pet_details?: string
  needs_hostess: boolean
  is_vip: boolean
  vip_details?: string

  // 3. Luggage
  luggage_count: number
  luggage_weight: string
  special_equipment: string
  bulky_luggage: boolean

  // 4. Flight Type & Preferences
  purpose: 'business' | 'tourist' | 'event' | 'transfer'
  priority: 'speed' | 'luxury' | 'cost'
  preferred_aircraft?: string
  needs_branding: boolean
  needs_wifi: boolean
  needs_catering: boolean
  catering_details?: string
  needs_ground_transfer: boolean

  // 5. Technical & Logistics
  known_airport: boolean
  airport_details?: string
  landing_restrictions: string
  helicopter_landing_type?: string
  international_flight: boolean
  needs_luggage_assistance: boolean

  // 6. Economic & Administrative
  payment_method: 'card' | 'bank_transfer' | 'cash'
  vat_included: boolean
  needs_contract: boolean

  // 7. Optional Services
  needs_insurance: boolean
  needs_security: boolean
  needs_crew_accommodation: boolean
  needs_nda: boolean

  notes?: string
  status: 'pending' | 'quoted' | 'accepted' | 'rejected'
  quote_amount?: number
  created_at: string
  updated_at: string
}

export default function AviationQuotesTab() {
  const [quotes, setQuotes] = useState<AviationQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_type: 'individual' as 'individual' | 'company',
    company_vat: '',
    departure_location: '',
    arrival_location: '',
    flight_type: 'one_way' as 'one_way' | 'round_trip',
    return_date: '',
    return_time: '',
    direct_flight: true,
    intermediate_stops: '',
    flight_flexibility: 'fixed' as 'fixed' | 'flexible',
    flight_time: 'day' as 'day' | 'night' | 'both',
    passenger_count: 1,
    has_children: false,
    children_count: 0,
    has_pets: false,
    pet_details: '',
    needs_hostess: false,
    is_vip: false,
    vip_details: '',
    luggage_count: 0,
    luggage_weight: '',
    special_equipment: '',
    bulky_luggage: false,
    purpose: 'business' as 'business' | 'tourist' | 'event' | 'transfer',
    priority: 'speed' as 'speed' | 'luxury' | 'cost',
    preferred_aircraft: '',
    needs_branding: false,
    needs_wifi: false,
    needs_catering: false,
    catering_details: '',
    needs_ground_transfer: false,
    known_airport: true,
    airport_details: '',
    landing_restrictions: '',
    helicopter_landing_type: '',
    international_flight: false,
    needs_luggage_assistance: false,
    payment_method: 'bank_transfer' as 'card' | 'bank_transfer' | 'cash',
    vat_included: true,
    needs_contract: false,
    needs_insurance: false,
    needs_security: false,
    needs_crew_accommodation: false,
    needs_nda: false,
    notes: '',
    status: 'pending' as 'pending' | 'quoted' | 'accepted' | 'rejected',
    quote_amount: 0
  })

  useEffect(() => {
    loadQuotes()
  }, [])

  async function loadQuotes() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('aviation_quotes')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setQuotes(data || [])
    } catch (error) {
      console.error('Failed to load aviation quotes:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const { error } = await supabase
        .from('aviation_quotes')
        .insert([formData])

      if (error) throw error

      alert('Preventivo salvato con successo!')
      setShowForm(false)
      resetForm()
      loadQuotes()
    } catch (error) {
      console.error('Failed to save quote:', error)
      alert('Errore durante il salvataggio: ' + (error as Error).message)
    }
  }

  function resetForm() {
    setFormData({
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      customer_type: 'individual',
      company_vat: '',
      departure_location: '',
      arrival_location: '',
      flight_type: 'one_way',
      return_date: '',
      return_time: '',
      direct_flight: true,
      intermediate_stops: '',
      flight_flexibility: 'fixed',
      flight_time: 'day',
      passenger_count: 1,
      has_children: false,
      children_count: 0,
      has_pets: false,
      pet_details: '',
      needs_hostess: false,
      is_vip: false,
      vip_details: '',
      luggage_count: 0,
      luggage_weight: '',
      special_equipment: '',
      bulky_luggage: false,
      purpose: 'business',
      priority: 'speed',
      preferred_aircraft: '',
      needs_branding: false,
      needs_wifi: false,
      needs_catering: false,
      catering_details: '',
      needs_ground_transfer: false,
      known_airport: true,
      airport_details: '',
      landing_restrictions: '',
      helicopter_landing_type: '',
      international_flight: false,
      needs_luggage_assistance: false,
      payment_method: 'bank_transfer',
      vat_included: true,
      needs_contract: false,
      needs_insurance: false,
      needs_security: false,
      needs_crew_accommodation: false,
      needs_nda: false,
      notes: '',
      status: 'pending',
      quote_amount: 0
    })
  }

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Preventivi Elicottero / Jet Privato</h2>
          <p className="text-sm text-theme-text-muted mt-1">Gestione richieste preventivi voli privati</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Chiudi Form' : '+ Nuovo Preventivo'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-theme-bg-primary p-6 rounded-lg border border-theme-border mb-6 space-y-6">
          {/* Customer Info */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Informazioni Cliente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nome Completo"
                required
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                required
                value={formData.customer_email}
                onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
              />
              <Input
                label="Telefono"
                required
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
              />
              <Select
                label="Tipo Cliente"
                value={formData.customer_type}
                onChange={(e) => setFormData({ ...formData, customer_type: e.target.value as 'individual' | 'company' })}
                options={[
                  { value: 'individual', label: 'Persona Fisica' },
                  { value: 'company', label: 'Società' }
                ]}
              />
              {formData.customer_type === 'company' && (
                <Input
                  label="Partita IVA"
                  value={formData.company_vat}
                  onChange={(e) => setFormData({ ...formData, company_vat: e.target.value })}
                />
              )}
            </div>
          </div>

          {/* 1. Flight Details */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">📍 1. Dettagli del Volo</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Partenza (Aeroporto/Eliporto)"
                required
                placeholder="Es: Milano Linate (LIN)"
                value={formData.departure_location}
                onChange={(e) => setFormData({ ...formData, departure_location: e.target.value })}
              />
              <Input
                label="Arrivo (Aeroporto/Eliporto)"
                required
                placeholder="Es: Roma Fiumicino (FCO)"
                value={formData.arrival_location}
                onChange={(e) => setFormData({ ...formData, arrival_location: e.target.value })}
              />
              <Select
                label="Tipo Volo"
                value={formData.flight_type}
                onChange={(e) => setFormData({ ...formData, flight_type: e.target.value as 'one_way' | 'round_trip' })}
                options={[
                  { value: 'one_way', label: 'Solo Andata' },
                  { value: 'round_trip', label: 'Andata e Ritorno' }
                ]}
              />
              {formData.flight_type === 'round_trip' && (
                <>
                  <Input
                    label="Data Ritorno"
                    type="date"
                    value={formData.return_date}
                    onChange={(e) => setFormData({ ...formData, return_date: e.target.value })}
                  />
                  <Input
                    label="Orario Ritorno"
                    type="time"
                    value={formData.return_time}
                    onChange={(e) => setFormData({ ...formData, return_time: e.target.value })}
                  />
                </>
              )}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.direct_flight}
                  onChange={(e) => setFormData({ ...formData, direct_flight: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Volo Diretto</label>
              </div>
              {!formData.direct_flight && (
                <Input
                  label="Tappe Intermedie"
                  placeholder="Es: Napoli, Palermo"
                  value={formData.intermediate_stops}
                  onChange={(e) => setFormData({ ...formData, intermediate_stops: e.target.value })}
                />
              )}
              <Select
                label="Flessibilità Orario"
                value={formData.flight_flexibility}
                onChange={(e) => setFormData({ ...formData, flight_flexibility: e.target.value as 'fixed' | 'flexible' })}
                options={[
                  { value: 'fixed', label: 'Data Fissa' },
                  { value: 'flexible', label: 'Flessibile' }
                ]}
              />
              <Select
                label="Orario Volo"
                value={formData.flight_time}
                onChange={(e) => setFormData({ ...formData, flight_time: e.target.value as 'day' | 'night' | 'both' })}
                options={[
                  { value: 'day', label: 'Diurno' },
                  { value: 'night', label: 'Notturno' },
                  { value: 'both', label: 'Entrambi' }
                ]}
              />
            </div>
          </div>

          {/* 2. Passengers */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">👥 2. Passeggeri</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Numero Passeggeri"
                type="number"
                min="1"
                required
                value={formData.passenger_count}
                onChange={(e) => setFormData({ ...formData, passenger_count: parseInt(e.target.value) })}
              />
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.has_children}
                    onChange={(e) => setFormData({ ...formData, has_children: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Bambini/Neonati</label>
                </div>
                {formData.has_children && (
                  <Input
                    label="Numero Bambini"
                    type="number"
                    min="0"
                    value={formData.children_count}
                    onChange={(e) => setFormData({ ...formData, children_count: parseInt(e.target.value) })}
                  />
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.has_pets}
                    onChange={(e) => setFormData({ ...formData, has_pets: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Animali a Bordo</label>
                </div>
                {formData.has_pets && (
                  <Input
                    label="Dettagli Animali (razza, dimensione)"
                    value={formData.pet_details}
                    onChange={(e) => setFormData({ ...formData, pet_details: e.target.value })}
                  />
                )}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_hostess}
                  onChange={(e) => setFormData({ ...formData, needs_hostess: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Hostess di Bordo</label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.is_vip}
                    onChange={(e) => setFormData({ ...formData, is_vip: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Passeggero VIP</label>
                </div>
                {formData.is_vip && (
                  <textarea
                    placeholder="Dettagli VIP e misure di sicurezza"
                    value={formData.vip_details}
                    onChange={(e) => setFormData({ ...formData, vip_details: e.target.value })}
                    className="w-full bg-theme-bg-tertiary text-theme-text-primary p-2 rounded"
                    rows={2}
                  />
                )}
              </div>
            </div>
          </div>

          {/* 3. Luggage */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">💼 3. Bagagli</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Numero Bagagli"
                type="number"
                min="0"
                value={formData.luggage_count}
                onChange={(e) => setFormData({ ...formData, luggage_count: parseInt(e.target.value) })}
              />
              <Input
                label="Peso Approssimativo"
                placeholder="Es: 20kg per bagaglio"
                value={formData.luggage_weight}
                onChange={(e) => setFormData({ ...formData, luggage_weight: e.target.value })}
              />
              <Input
                label="Attrezzature Speciali"
                placeholder="Es: mazze da golf, strumenti musicali"
                value={formData.special_equipment}
                onChange={(e) => setFormData({ ...formData, special_equipment: e.target.value })}
              />
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.bulky_luggage}
                  onChange={(e) => setFormData({ ...formData, bulky_luggage: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Bagagli Ingombranti</label>
              </div>
            </div>
          </div>

          {/* 4. Flight Type & Preferences */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">🛫 4. Tipologia e Preferenze</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Scopo del Volo"
                value={formData.purpose}
                onChange={(e) => setFormData({ ...formData, purpose: e.target.value as any })}
                options={[
                  { value: 'business', label: 'Business' },
                  { value: 'tourist', label: 'Turistico' },
                  { value: 'event', label: 'Eventi Speciali' },
                  { value: 'transfer', label: 'Transfer Rapido' }
                ]}
              />
              <Select
                label="Priorità Principale"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                options={[
                  { value: 'speed', label: 'Velocità' },
                  { value: 'luxury', label: 'Lusso' },
                  { value: 'cost', label: 'Risparmio' }
                ]}
              />
              <Input
                label="Modello Velivolo Preferito"
                placeholder="Es: AW109, Phenom 300, Citation"
                value={formData.preferred_aircraft}
                onChange={(e) => setFormData({ ...formData, preferred_aircraft: e.target.value })}
              />
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.needs_branding}
                    onChange={(e) => setFormData({ ...formData, needs_branding: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Logo Aziendale a Bordo</label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.needs_wifi}
                    onChange={(e) => setFormData({ ...formData, needs_wifi: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Wi-Fi a Bordo</label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.needs_catering}
                    onChange={(e) => setFormData({ ...formData, needs_catering: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Catering di Bordo</label>
                </div>
                {formData.needs_catering && (
                  <Input
                    label="Dettagli Catering"
                    placeholder="Es: Champagne, snack, menu specifico"
                    value={formData.catering_details}
                    onChange={(e) => setFormData({ ...formData, catering_details: e.target.value })}
                  />
                )}
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.needs_ground_transfer}
                    onChange={(e) => setFormData({ ...formData, needs_ground_transfer: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-theme-text-primary">Transfer a Terra (Auto di Lusso)</label>
                </div>
              </div>
            </div>
          </div>

          {/* 5. Technical & Logistics */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">⚙️ 5. Dettagli Tecnici e Logistici</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.known_airport}
                  onChange={(e) => setFormData({ ...formData, known_airport: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Aeroporto/Eliporto Conosciuto</label>
              </div>
              {!formData.known_airport && (
                <Input
                  label="Dettagli Aeroporto da Individuare"
                  value={formData.airport_details}
                  onChange={(e) => setFormData({ ...formData, airport_details: e.target.value })}
                />
              )}
              <Input
                label="Limitazioni Atterraggio"
                placeholder="Es: proprietà privata, rooftop, zone urbane"
                value={formData.landing_restrictions}
                onChange={(e) => setFormData({ ...formData, landing_restrictions: e.target.value })}
              />
              <Input
                label="Tipo Atterraggio Elicottero"
                placeholder="Es: rooftop, terreno privato, zona urbana"
                value={formData.helicopter_landing_type}
                onChange={(e) => setFormData({ ...formData, helicopter_landing_type: e.target.value })}
              />
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.international_flight}
                  onChange={(e) => setFormData({ ...formData, international_flight: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Volo Internazionale</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_luggage_assistance}
                  onChange={(e) => setFormData({ ...formData, needs_luggage_assistance: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Assistenza Bagagli</label>
              </div>
            </div>
          </div>

          {/* 6. Economic & Administrative */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">💳 6. Condizioni Economiche</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Metodo di Pagamento"
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as any })}
                options={[
                  { value: 'card', label: 'Carta' },
                  { value: 'bank_transfer', label: 'Bonifico' },
                  { value: 'cash', label: 'Contanti' }
                ]}
              />
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.vat_included}
                  onChange={(e) => setFormData({ ...formData, vat_included: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">IVA Inclusa</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_contract}
                  onChange={(e) => setFormData({ ...formData, needs_contract: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Contratto Sub-Noleggio</label>
              </div>
            </div>
          </div>

          {/* 7. Optional Services */}
          <div className="border-b border-theme-border pb-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">🔒 7. Servizi Opzionali Premium</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_insurance}
                  onChange={(e) => setFormData({ ...formData, needs_insurance: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Assicurazione Full Risk</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_security}
                  onChange={(e) => setFormData({ ...formData, needs_security: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Sicurezza Privata/Scorta</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_crew_accommodation}
                  onChange={(e) => setFormData({ ...formData, needs_crew_accommodation: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">Pernottamento Equipaggio</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.needs_nda}
                  onChange={(e) => setFormData({ ...formData, needs_nda: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-theme-text-primary">NDA / Massima Discrezione</label>
              </div>
            </div>
          </div>

          {/* Notes & Quote */}
          <div>
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">📝 Note Aggiuntive</h3>
            <textarea
              placeholder="Note o richieste speciali..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full bg-theme-bg-tertiary text-theme-text-primary p-3 rounded"
              rows={4}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Input
                label="Importo Preventivo (€)"
                type="number"
                min="0"
                value={formData.quote_amount}
                onChange={(e) => setFormData({ ...formData, quote_amount: parseFloat(e.target.value) })}
              />
              <Select
                label="Stato"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                options={[
                  { value: 'pending', label: 'In Attesa' },
                  { value: 'quoted', label: 'Preventivato' },
                  { value: 'accepted', label: 'Accettato' },
                  { value: 'rejected', label: 'Rifiutato' }
                ]}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit">Salva Preventivo</Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Annulla</Button>
          </div>
        </form>
      )}

      {/* Quotes List */}
      <div className="bg-theme-bg-primary rounded-lg border border-theme-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-theme-bg-primaryer">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Tratta</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Tipo</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Passeggeri</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Importo</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Stato</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Data</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id} className="border-t border-theme-border hover:bg-theme-bg-primaryer/50">
                  <td className="px-4 py-3 text-sm">
                    <div className="text-theme-text-primary font-medium">{quote.customer_name}</div>
                    <div className="text-theme-text-muted text-xs">{quote.customer_email}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">
                    {quote.departure_location} → {quote.arrival_location}
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-muted">
                    {quote.flight_type === 'round_trip' ? 'A/R' : 'Andata'}
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{quote.passenger_count}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">
                    {quote.quote_amount ? `€${quote.quote_amount.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      quote.status === 'accepted' ? 'bg-green-900 text-green-300' :
                      quote.status === 'quoted' ? 'bg-blue-900 text-blue-300' :
                      quote.status === 'rejected' ? 'bg-red-900 text-red-300' :
                      'bg-gray-700 text-theme-text-secondary'
                    }`}>
                      {quote.status === 'pending' ? 'In Attesa' :
                       quote.status === 'quoted' ? 'Preventivato' :
                       quote.status === 'accepted' ? 'Accettato' : 'Rifiutato'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-muted">
                    {new Date(quote.created_at).toLocaleDateString('it-IT')}
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Nessun preventivo ancora
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
