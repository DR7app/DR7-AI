import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

// Types
interface Scadenza {
  id: string
  category: string
  item_type: string
  description: string
  reference_id: string | null
  reference_type: string | null
  reference_name: string | null
  due_date: string | null
  due_km: number | null
  current_km: number | null
  amount: number | null
  status: 'pending' | 'completed' | 'paid' | 'blocked' | 'refunded' | 'to_refund' | 'to_block'
  advance_days: number
  advance_km: number | null
  is_recurring: boolean
  recurring_interval: string | null
  is_manual: boolean
  created_at: string
}

interface NewScadenzaForm {
  category: string
  item_type: string
  description: string
  due_date: string
  amount: string
  reference_name: string
}

// Category configurations with advance periods
const CATEGORIES = {
  noleggi: {
    label: 'Scadenze Noleggi',
    color: 'blue',
    advanceDays: 1,
    items: ['Fine noleggio'],
    actions: ['complete']
  },
  cauzioni: {
    label: 'Scadenze Cauzioni',
    color: 'purple',
    advanceDays: 1,
    items: ['Cauzione noleggio'],
    actions: ['block', 'collect', 'refund', 'mark_refunded'],
    statuses: ['to_block', 'blocked', 'collected', 'to_refund', 'refunded']
  },
  rate_pagamenti: {
    label: 'Scadenze Rate e Pagamenti Finanziari',
    color: 'orange',
    advanceDays: 5,
    items: ['Rata leasing veicolo', 'Rata noleggio flotta', 'Rata carta di credito'],
    actions: ['pay', 'mark_paid']
  },
  carte_credito: {
    label: 'Scadenze Carte di Credito Aziendali',
    color: 'red',
    advanceDays: 5,
    items: ['Carta aziendale principale', 'Carta business secondaria'],
    actions: ['pay', 'mark_paid']
  },
  veicoli_manutenzione: {
    label: 'Scadenze Veicoli - Manutenzione (KM)',
    color: 'yellow',
    advanceKm: { tagliando: 5000, gomme: 500, pastiglie: 500 },
    items: ['Tagliando', 'Gomme', 'Pastiglie'],
    actions: ['complete']
  },
  veicoli_documenti: {
    label: 'Scadenze Veicoli - Documenti e Tasse',
    color: 'green',
    advanceDays: { assicurazione: 2, bollo: 0, superbollo: 0, revisione: 7 },
    items: ['Assicurazione', 'Bollo', 'Superbollo', 'Revisione'],
    actions: ['pay', 'mark_paid', 'complete']
  },
  affitti: {
    label: 'Scadenze Affitti',
    color: 'teal',
    advanceDays: 5,
    items: ['Canone affitto locale 1', 'Canone affitto locale 2'],
    actions: ['pay', 'mark_paid', 'delete'],
    allowCustomItems: true
  },
  personale: {
    label: 'Scadenze Personale',
    color: 'pink',
    advanceDays: { stipendi: 3, consulente: 0, commercialista: 0 },
    items: ['Stipendi', 'Consulente', 'Commercialista'],
    actions: ['pay', 'mark_paid']
  },
  fiscali: {
    label: 'Scadenze Fiscali',
    color: 'indigo',
    advanceDays: 0,
    items: ['IVA'],
    actions: ['pay', 'mark_paid']
  }
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'In attesa',
  completed: 'Completata',
  paid: 'Pagata',
  blocked: 'Bloccata',
  refunded: 'Rimborsata',
  to_refund: 'Da rimborsare',
  to_block: 'Da bloccare',
  collected: 'Incassata'
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-900 text-yellow-200',
  completed: 'bg-green-900 text-green-200',
  paid: 'bg-green-900 text-green-200',
  blocked: 'bg-blue-900 text-blue-200',
  refunded: 'bg-gray-700 text-gray-300',
  to_refund: 'bg-orange-900 text-orange-200',
  to_block: 'bg-red-900 text-red-200',
  collected: 'bg-green-900 text-green-200'
}

export default function ScadenzeTab() {
  const [scadenze, setScadenze] = useState<Scadenza[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newScadenza, setNewScadenza] = useState<NewScadenzaForm>({
    category: 'affitti',
    item_type: '',
    description: '',
    due_date: '',
    amount: '',
    reference_name: ''
  })

  useEffect(() => {
    loadScadenze()
    loadAutoScadenze()
  }, [])

  async function loadScadenze() {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('scadenze')
        .select('*')
        .order('due_date', { ascending: true })

      if (error) throw error
      setScadenze(data || [])
    } catch (error) {
      console.error('Error loading scadenze:', error)
    } finally {
      setLoading(false)
    }
  }

  // Load automatic scadenze from bookings and vehicles
  async function loadAutoScadenze() {
    try {
      // Load upcoming rental endings
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 7) // Load next 7 days of rentals

      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, customer_name, vehicle_name, dropoff_date, price_total, booking_details')
        .gte('dropoff_date', today.toISOString())
        .lte('dropoff_date', tomorrow.toISOString())
        .in('status', ['confirmed', 'active'])
        .order('dropoff_date', { ascending: true })

      // Load cauzioni
      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('*, bookings(customer_name, vehicle_name, dropoff_date)')
        .in('status', ['pending', 'blocked', 'to_refund'])

      // Load vehicles for document/maintenance deadlines
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'retired')

      // Combine auto scadenze with manual ones
      const autoScadenze: Scadenza[] = []

      // Rental endings
      bookings?.forEach(booking => {
        autoScadenze.push({
          id: `rental-${booking.id}`,
          category: 'noleggi',
          item_type: 'Fine noleggio',
          description: `${booking.customer_name} - ${booking.vehicle_name}`,
          reference_id: booking.id,
          reference_type: 'booking',
          reference_name: booking.customer_name,
          due_date: booking.dropoff_date,
          due_km: null,
          current_km: null,
          amount: booking.price_total,
          status: 'pending',
          advance_days: 1,
          advance_km: null,
          is_recurring: false,
          recurring_interval: null,
          is_manual: false,
          created_at: new Date().toISOString()
        })
      })

      // Cauzioni
      cauzioni?.forEach(cauzione => {
        const statusMap: Record<string, Scadenza['status']> = {
          pending: 'to_block',
          blocked: 'blocked',
          to_refund: 'to_refund',
          refunded: 'refunded'
        }
        autoScadenze.push({
          id: `cauzione-${cauzione.id}`,
          category: 'cauzioni',
          item_type: 'Cauzione noleggio',
          description: `${cauzione.bookings?.customer_name || 'Cliente'} - ${cauzione.bookings?.vehicle_name || 'Veicolo'}`,
          reference_id: cauzione.id,
          reference_type: 'cauzione',
          reference_name: cauzione.bookings?.customer_name,
          due_date: cauzione.bookings?.dropoff_date || null,
          due_km: null,
          current_km: null,
          amount: cauzione.amount,
          status: statusMap[cauzione.status] || 'pending',
          advance_days: 1,
          advance_km: null,
          is_recurring: false,
          recurring_interval: null,
          is_manual: false,
          created_at: new Date().toISOString()
        })
      })

      // Vehicle documents
      vehicles?.forEach(vehicle => {
        // Insurance
        if (vehicle.insurance_expiry) {
          const daysUntil = Math.ceil((new Date(vehicle.insurance_expiry).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          if (daysUntil <= 30) { // Show if within 30 days
            autoScadenze.push({
              id: `insurance-${vehicle.id}`,
              category: 'veicoli_documenti',
              item_type: 'Assicurazione',
              description: vehicle.display_name,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: vehicle.insurance_expiry,
              due_km: null,
              current_km: null,
              amount: null,
              status: daysUntil <= 0 ? 'pending' : 'pending',
              advance_days: 2,
              advance_km: null,
              is_recurring: true,
              recurring_interval: 'yearly',
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Tax (Bollo)
        if (vehicle.tax_expiry) {
          const daysUntil = Math.ceil((new Date(vehicle.tax_expiry).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          if (daysUntil <= 30) {
            autoScadenze.push({
              id: `tax-${vehicle.id}`,
              category: 'veicoli_documenti',
              item_type: 'Bollo',
              description: vehicle.display_name,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: vehicle.tax_expiry,
              due_km: null,
              current_km: null,
              amount: null,
              status: 'pending',
              advance_days: 0,
              advance_km: null,
              is_recurring: true,
              recurring_interval: 'yearly',
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Inspection (Revisione)
        if (vehicle.inspection_expiry) {
          const daysUntil = Math.ceil((new Date(vehicle.inspection_expiry).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          if (daysUntil <= 30) {
            autoScadenze.push({
              id: `inspection-${vehicle.id}`,
              category: 'veicoli_documenti',
              item_type: 'Revisione',
              description: vehicle.display_name,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: vehicle.inspection_expiry,
              due_km: null,
              current_km: null,
              amount: null,
              status: 'pending',
              advance_days: 7,
              advance_km: null,
              is_recurring: true,
              recurring_interval: 'biennial',
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Maintenance - Tagliando
        if (vehicle.maintenance_service_interval_km && vehicle.current_km) {
          const lastService = vehicle.last_service_km || 0
          const nextService = lastService + vehicle.maintenance_service_interval_km
          const kmRemaining = nextService - vehicle.current_km
          if (kmRemaining <= 5000) {
            autoScadenze.push({
              id: `tagliando-${vehicle.id}`,
              category: 'veicoli_manutenzione',
              item_type: 'Tagliando',
              description: vehicle.display_name,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: null,
              due_km: nextService,
              current_km: vehicle.current_km,
              amount: null,
              status: 'pending',
              advance_days: 0,
              advance_km: 5000,
              is_recurring: true,
              recurring_interval: null,
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Tires - Front
        if (vehicle.maintenance_tires_front_interval_km && vehicle.current_km) {
          const lastChange = vehicle.last_tire_change_front_km || 0
          const nextChange = lastChange + vehicle.maintenance_tires_front_interval_km
          const kmRemaining = nextChange - vehicle.current_km
          if (kmRemaining <= 500) {
            autoScadenze.push({
              id: `tires-front-${vehicle.id}`,
              category: 'veicoli_manutenzione',
              item_type: 'Gomme',
              description: `${vehicle.display_name} - Anteriori`,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: null,
              due_km: nextChange,
              current_km: vehicle.current_km,
              amount: null,
              status: 'pending',
              advance_days: 0,
              advance_km: 500,
              is_recurring: true,
              recurring_interval: null,
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Tires - Rear
        if (vehicle.maintenance_tires_rear_interval_km && vehicle.current_km) {
          const lastChange = vehicle.last_tire_change_rear_km || 0
          const nextChange = lastChange + vehicle.maintenance_tires_rear_interval_km
          const kmRemaining = nextChange - vehicle.current_km
          if (kmRemaining <= 500) {
            autoScadenze.push({
              id: `tires-rear-${vehicle.id}`,
              category: 'veicoli_manutenzione',
              item_type: 'Gomme',
              description: `${vehicle.display_name} - Posteriori`,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: null,
              due_km: nextChange,
              current_km: vehicle.current_km,
              amount: null,
              status: 'pending',
              advance_days: 0,
              advance_km: 500,
              is_recurring: true,
              recurring_interval: null,
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Brakes - Front
        if (vehicle.maintenance_brake_front_interval_km && vehicle.current_km) {
          const lastChange = vehicle.last_brake_change_front_km || 0
          const nextChange = lastChange + vehicle.maintenance_brake_front_interval_km
          const kmRemaining = nextChange - vehicle.current_km
          if (kmRemaining <= 500) {
            autoScadenze.push({
              id: `brakes-front-${vehicle.id}`,
              category: 'veicoli_manutenzione',
              item_type: 'Pastiglie',
              description: `${vehicle.display_name} - Anteriori`,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: null,
              due_km: nextChange,
              current_km: vehicle.current_km,
              amount: null,
              status: 'pending',
              advance_days: 0,
              advance_km: 500,
              is_recurring: true,
              recurring_interval: null,
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }

        // Brakes - Rear
        if (vehicle.maintenance_brake_rear_interval_km && vehicle.current_km) {
          const lastChange = vehicle.last_brake_change_rear_km || 0
          const nextChange = lastChange + vehicle.maintenance_brake_rear_interval_km
          const kmRemaining = nextChange - vehicle.current_km
          if (kmRemaining <= 500) {
            autoScadenze.push({
              id: `brakes-rear-${vehicle.id}`,
              category: 'veicoli_manutenzione',
              item_type: 'Pastiglie',
              description: `${vehicle.display_name} - Posteriori`,
              reference_id: vehicle.id,
              reference_type: 'vehicle',
              reference_name: vehicle.display_name,
              due_date: null,
              due_km: nextChange,
              current_km: vehicle.current_km,
              amount: null,
              status: 'pending',
              advance_days: 0,
              advance_km: 500,
              is_recurring: true,
              recurring_interval: null,
              is_manual: false,
              created_at: new Date().toISOString()
            })
          }
        }
      })

      // Merge with manual scadenze
      setScadenze(prev => {
        const manualScadenze = prev.filter(s => s.is_manual)
        return [...autoScadenze, ...manualScadenze].sort((a, b) => {
          if (a.due_date && b.due_date) {
            return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
          }
          if (a.due_km && b.due_km && a.current_km && b.current_km) {
            return (a.due_km - a.current_km) - (b.due_km - b.current_km)
          }
          return 0
        })
      })
    } catch (error) {
      console.error('Error loading auto scadenze:', error)
    }
  }

  async function handleAction(scadenza: Scadenza, action: string) {
    try {
      if (action === 'pay' || action === 'mark_paid') {
        if (scadenza.is_manual) {
          await supabase
            .from('scadenze')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', scadenza.id)
        }
        // Update local state
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'paid' } : s
        ))
      } else if (action === 'complete') {
        if (scadenza.is_manual) {
          await supabase
            .from('scadenze')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', scadenza.id)
        }
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'completed' } : s
        ))
      } else if (action === 'block' && scadenza.reference_type === 'cauzione') {
        // Update cauzione status
        await supabase
          .from('cauzioni')
          .update({ status: 'blocked', blocked_at: new Date().toISOString() })
          .eq('id', scadenza.reference_id)
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'blocked' } : s
        ))
      } else if (action === 'collect' && scadenza.reference_type === 'cauzione') {
        await supabase
          .from('cauzioni')
          .update({ status: 'collected', collected_at: new Date().toISOString() })
          .eq('id', scadenza.reference_id)
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'collected' as any } : s
        ))
      } else if (action === 'refund' && scadenza.reference_type === 'cauzione') {
        await supabase
          .from('cauzioni')
          .update({ status: 'to_refund' })
          .eq('id', scadenza.reference_id)
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'to_refund' } : s
        ))
      } else if (action === 'mark_refunded' && scadenza.reference_type === 'cauzione') {
        await supabase
          .from('cauzioni')
          .update({ status: 'refunded', refunded_at: new Date().toISOString() })
          .eq('id', scadenza.reference_id)
        setScadenze(prev => prev.filter(s => s.id !== scadenza.id))
      } else if (action === 'delete' && scadenza.is_manual) {
        await supabase
          .from('scadenze')
          .delete()
          .eq('id', scadenza.id)
        setScadenze(prev => prev.filter(s => s.id !== scadenza.id))
      }
    } catch (error) {
      console.error('Error performing action:', error)
      alert('Errore durante l\'operazione')
    }
  }

  async function handleAddScadenza() {
    try {
      const categoryConfig = CATEGORIES[newScadenza.category as keyof typeof CATEGORIES]
      const advanceDays = 'advanceDays' in categoryConfig && typeof categoryConfig.advanceDays === 'number'
        ? categoryConfig.advanceDays
        : 5

      const { error } = await supabase
        .from('scadenze')
        .insert({
          category: newScadenza.category,
          item_type: newScadenza.item_type,
          description: newScadenza.description,
          reference_name: newScadenza.reference_name,
          due_date: newScadenza.due_date,
          amount: newScadenza.amount ? Math.round(parseFloat(newScadenza.amount) * 100) : null,
          status: 'pending',
          advance_days: advanceDays,
          is_manual: true,
          is_recurring: false
        })

      if (error) throw error

      setShowAddModal(false)
      setNewScadenza({
        category: 'affitti',
        item_type: '',
        description: '',
        due_date: '',
        amount: '',
        reference_name: ''
      })
      loadScadenze()
    } catch (error) {
      console.error('Error adding scadenza:', error)
      alert('Errore durante l\'aggiunta')
    }
  }

  function getScadenzeByCategory(category: string): Scadenza[] {
    const today = new Date()
    return scadenze
      .filter(s => s.category === category && s.status !== 'completed' && s.status !== 'paid' && s.status !== 'refunded')
      .filter(s => {
        // Check if within advance period
        if (s.due_date) {
          const dueDate = new Date(s.due_date)
          const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          return daysUntil <= (s.advance_days + 30) // Show if within advance period + 30 days buffer
        }
        if (s.due_km && s.current_km && s.advance_km) {
          const kmRemaining = s.due_km - s.current_km
          return kmRemaining <= s.advance_km
        }
        return true
      })
      .sort((a, b) => {
        if (a.due_date && b.due_date) {
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        }
        return 0
      })
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  function formatAmount(cents: number | null): string {
    if (cents === null) return '-'
    return `${(cents / 100).toFixed(2)}`.replace('.', ',')
  }

  function getDaysRemaining(dateStr: string | null): { days: number; urgent: boolean; warning: boolean } | null {
    if (!dateStr) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueDate = new Date(dateStr)
    dueDate.setHours(0, 0, 0, 0)
    const days = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return {
      days,
      urgent: days <= 0,
      warning: days <= 3 && days > 0
    }
  }

  function getKmRemaining(dueKm: number | null, currentKm: number | null): { km: number; urgent: boolean; warning: boolean } | null {
    if (dueKm === null || currentKm === null) return null
    const km = dueKm - currentKm
    return {
      km,
      urgent: km <= 0,
      warning: km <= 500 && km > 0
    }
  }

  function renderCategoryTable(categoryKey: string) {
    const category = CATEGORIES[categoryKey as keyof typeof CATEGORIES]
    const categoryScadenze = getScadenzeByCategory(categoryKey)

    const colorClasses: Record<string, string> = {
      blue: 'bg-blue-900/30 border-blue-700/50',
      purple: 'bg-purple-900/30 border-purple-700/50',
      orange: 'bg-orange-900/30 border-orange-700/50',
      red: 'bg-red-900/30 border-red-700/50',
      yellow: 'bg-yellow-900/30 border-yellow-700/50',
      green: 'bg-green-900/30 border-green-700/50',
      teal: 'bg-teal-900/30 border-teal-700/50',
      pink: 'bg-pink-900/30 border-pink-700/50',
      indigo: 'bg-indigo-900/30 border-indigo-700/50'
    }

    const isKmBased = categoryKey === 'veicoli_manutenzione'

    return (
      <div key={categoryKey} className={`rounded-lg border ${colorClasses[category.color]} mb-6`}>
        <div className="px-4 py-3 border-b border-theme-border">
          <h3 className="text-lg font-bold text-theme-text-primary flex items-center justify-between">
            {category.label}
            <span className="text-sm font-normal text-theme-text-muted">
              {categoryScadenze.length} {categoryScadenze.length === 1 ? 'scadenza' : 'scadenze'}
            </span>
          </h3>
        </div>

        {categoryScadenze.length === 0 ? (
          <div className="p-4 text-theme-text-muted text-center">
            Nessuna scadenza imminente
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-border">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">
                    {isKmBased ? 'KM Scadenza' : 'Data Scadenza'}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Voce</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Riferimento</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Importo</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {categoryScadenze.map(scadenza => {
                  const daysInfo = getDaysRemaining(scadenza.due_date)
                  const kmInfo = getKmRemaining(scadenza.due_km, scadenza.current_km)

                  return (
                    <tr key={scadenza.id} className="border-b border-theme-border/50 hover:bg-white/5">
                      <td className="px-4 py-3">
                        {isKmBased ? (
                          <div>
                            <span className="text-theme-text-primary font-mono">
                              {scadenza.due_km?.toLocaleString()} km
                            </span>
                            {kmInfo && (
                              <div className={`text-xs mt-1 ${kmInfo.urgent ? 'text-red-400 font-bold' : kmInfo.warning ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                                {kmInfo.km <= 0 ? 'SCADUTO' : `Mancano ${kmInfo.km.toLocaleString()} km`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className="text-theme-text-primary">{formatDate(scadenza.due_date)}</span>
                            {daysInfo && (
                              <div className={`text-xs mt-1 ${daysInfo.urgent ? 'text-red-400 font-bold' : daysInfo.warning ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                                {daysInfo.days === 0 ? 'OGGI' : daysInfo.days < 0 ? 'SCADUTO' : `Tra ${daysInfo.days} giorni`}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-theme-text-primary">{scadenza.item_type}</td>
                      <td className="px-4 py-3 text-theme-text-secondary">{scadenza.description || scadenza.reference_name || '-'}</td>
                      <td className="px-4 py-3 text-theme-text-primary font-mono">
                        {scadenza.amount ? `${formatAmount(scadenza.amount)}` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${STATUS_COLORS[scadenza.status] || 'bg-gray-700 text-gray-300'}`}>
                          {STATUS_LABELS[scadenza.status] || scadenza.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {/* Cauzione specific actions */}
                          {categoryKey === 'cauzioni' && (
                            <>
                              {scadenza.status === 'to_block' && (
                                <button
                                  onClick={() => handleAction(scadenza, 'block')}
                                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                                >
                                  Blocca
                                </button>
                              )}
                              {scadenza.status === 'blocked' && (
                                <>
                                  <button
                                    onClick={() => handleAction(scadenza, 'collect')}
                                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                                  >
                                    Incassa
                                  </button>
                                  <button
                                    onClick={() => handleAction(scadenza, 'refund')}
                                    className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-medium"
                                  >
                                    Rimborsa
                                  </button>
                                </>
                              )}
                              {scadenza.status === 'to_refund' && (
                                <button
                                  onClick={() => handleAction(scadenza, 'mark_refunded')}
                                  className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-medium"
                                >
                                  Segna rimborsata
                                </button>
                              )}
                            </>
                          )}

                          {/* Payment actions */}
                          {category.actions.includes('pay') && categoryKey !== 'cauzioni' && (
                            <>
                              <button
                                onClick={() => handleAction(scadenza, 'pay')}
                                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                              >
                                Paga adesso
                              </button>
                              <button
                                onClick={() => handleAction(scadenza, 'mark_paid')}
                                className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-medium"
                              >
                                Segna pagata
                              </button>
                            </>
                          )}

                          {/* Complete action */}
                          {category.actions.includes('complete') && categoryKey !== 'cauzioni' && (
                            <button
                              onClick={() => handleAction(scadenza, 'complete')}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                            >
                              Segna completata
                            </button>
                          )}

                          {/* Delete action for manual items */}
                          {category.actions.includes('delete') && scadenza.is_manual && (
                            <button
                              onClick={() => handleAction(scadenza, 'delete')}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium"
                            >
                              Elimina
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return <div className="text-theme-text-muted">Caricamento scadenze...</div>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Scadenze</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Gestione scadenze aziendali, operative e fiscali
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-dr7-gold text-black rounded-lg font-medium hover:bg-dr7-gold/90"
        >
          Aggiungi nuova scadenza
        </button>
      </div>

      {/* Category Tables */}
      {Object.keys(CATEGORIES).map(categoryKey => renderCategoryTable(categoryKey))}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-theme-bg-secondary rounded-lg p-6 w-full max-w-md border border-theme-border">
            <h3 className="text-xl font-bold text-theme-text-primary mb-4">Aggiungi Nuova Scadenza</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Categoria</label>
                <select
                  value={newScadenza.category}
                  onChange={(e) => setNewScadenza({ ...newScadenza, category: e.target.value, item_type: '' })}
                  className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                >
                  {Object.entries(CATEGORIES).map(([key, cat]) => (
                    <option key={key} value={key}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Voce</label>
                <select
                  value={newScadenza.item_type}
                  onChange={(e) => setNewScadenza({ ...newScadenza, item_type: e.target.value })}
                  className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                >
                  <option value="">Seleziona voce...</option>
                  {CATEGORIES[newScadenza.category as keyof typeof CATEGORIES]?.items.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                  <option value="__custom__">+ Aggiungi voce personalizzata</option>
                </select>
                {newScadenza.item_type === '__custom__' && (
                  <input
                    type="text"
                    placeholder="Nome voce personalizzata"
                    onChange={(e) => setNewScadenza({ ...newScadenza, item_type: e.target.value })}
                    className="w-full mt-2 bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Riferimento</label>
                <input
                  type="text"
                  value={newScadenza.reference_name}
                  onChange={(e) => setNewScadenza({ ...newScadenza, reference_name: e.target.value })}
                  placeholder="es. Cliente / Veicolo / Fornitore"
                  className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Data Scadenza</label>
                <input
                  type="date"
                  value={newScadenza.due_date}
                  onChange={(e) => setNewScadenza({ ...newScadenza, due_date: e.target.value })}
                  className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Importo (opzionale)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newScadenza.amount}
                  onChange={(e) => setNewScadenza({ ...newScadenza, amount: e.target.value })}
                  placeholder="0,00"
                  className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Descrizione (opzionale)</label>
                <input
                  type="text"
                  value={newScadenza.description}
                  onChange={(e) => setNewScadenza({ ...newScadenza, description: e.target.value })}
                  placeholder="Note aggiuntive"
                  className="w-full bg-gray-700 text-theme-text-primary rounded px-3 py-2 border border-theme-border"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                Annulla
              </button>
              <button
                onClick={handleAddScadenza}
                disabled={!newScadenza.item_type || !newScadenza.due_date}
                className="px-4 py-2 bg-dr7-gold text-black rounded-lg font-medium hover:bg-dr7-gold/90 disabled:opacity-50"
              >
                Aggiungi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
