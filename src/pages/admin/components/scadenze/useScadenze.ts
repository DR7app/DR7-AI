import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import type { Scadenza, NewScadenzaForm } from './scadenzeConfig'
import { CATEGORIES, CATEGORY_KEYS } from './scadenzeConfig'

export interface ScadenzeStats {
  totalActive: number
  overdue: number
  dueThisWeek: number
  totalAmount: number
  byCategory: Record<string, { count: number; mostUrgent: Scadenza | null }>
}

export function useScadenze() {
  const [scadenze, setScadenze] = useState<Scadenza[]>([])
  const [loading, setLoading] = useState(true)
  const [scadenzaSearch, setScadenzaSearch] = useState('')

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

  async function loadAutoScadenze() {
    try {
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 7)

      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, customer_name, vehicle_name, dropoff_date, price_total, booking_details')
        .gte('dropoff_date', today.toISOString())
        .lte('dropoff_date', tomorrow.toISOString())
        .in('status', ['confirmed', 'active'])
        .order('dropoff_date', { ascending: true })

      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('*, bookings(customer_name, vehicle_name, dropoff_date)')
        .in('status', ['pending', 'blocked', 'to_refund'])

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'retired')

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
        if (vehicle.insurance_expiry) {
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
            status: 'pending',
            advance_days: 2,
            advance_km: null,
            is_recurring: true,
            recurring_interval: 'yearly',
            is_manual: false,
            created_at: new Date().toISOString()
          })
        }

        if (vehicle.tax_expiry) {
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

        if (vehicle.inspection_expiry) {
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

  const handleAction = useCallback(async (scadenza: Scadenza, action: string) => {
    try {
      if (action === 'pay' || action === 'mark_paid') {
        if (scadenza.is_manual) {
          await supabase
            .from('scadenze')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', scadenza.id)
        }
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
  }, [])

  const handleAddScadenza = useCallback(async (newScadenza: NewScadenzaForm) => {
    try {
      const categoryConfig = CATEGORIES[newScadenza.category]
      const advanceDays = categoryConfig && 'advanceDays' in categoryConfig && typeof categoryConfig.advanceDays === 'number'
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
      loadScadenze()
      return true
    } catch (error) {
      console.error('Error adding scadenza:', error)
      alert('Errore durante l\'aggiunta')
      return false
    }
  }, [])

  const getScadenzeByCategory = useCallback((category: string): Scadenza[] => {
    const today = new Date()
    return scadenze
      .filter(s => s.category === category && s.status !== 'completed' && s.status !== 'paid' && s.status !== 'refunded')
      .filter(s => {
        if (category === 'veicoli_documenti') return true
        if (s.due_date) {
          const dueDate = new Date(s.due_date)
          const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          return daysUntil <= (s.advance_days + 30)
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
  }, [scadenze])

  const filterBySearch = useCallback((items: Scadenza[]): Scadenza[] => {
    if (!scadenzaSearch.trim()) return items
    const q = scadenzaSearch.trim().toLowerCase().replace(/\s/g, '')
    return items.filter(s => {
      const ref = (s.reference_name || '').toLowerCase().replace(/\s/g, '')
      const desc = (s.description || '').toLowerCase().replace(/\s/g, '')
      const itemType = (s.item_type || '').toLowerCase().replace(/\s/g, '')
      return ref.includes(q) || desc.includes(q) || itemType.includes(q)
    })
  }, [scadenzaSearch])

  // Compute stats for panoramica and sidebar badges
  const stats = useMemo((): ScadenzeStats => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const weekEnd = new Date(today)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const allActive = scadenze.filter(s =>
      s.status !== 'completed' && s.status !== 'paid' && s.status !== 'refunded'
    )

    let overdue = 0
    let dueThisWeek = 0
    let totalAmount = 0

    allActive.forEach(s => {
      if (s.amount) totalAmount += s.amount
      if (s.due_date) {
        const d = new Date(s.due_date)
        d.setHours(0, 0, 0, 0)
        if (d < today) overdue++
        else if (d <= weekEnd) dueThisWeek++
      }
      if (s.due_km && s.current_km) {
        if (s.due_km - s.current_km <= 0) overdue++
      }
    })

    const byCategory: Record<string, { count: number; mostUrgent: Scadenza | null }> = {}
    CATEGORY_KEYS.forEach(key => {
      const catItems = getScadenzeByCategory(key)
      byCategory[key] = {
        count: catItems.length,
        mostUrgent: catItems.length > 0 ? catItems[0] : null
      }
    })

    return {
      totalActive: allActive.length,
      overdue,
      dueThisWeek,
      totalAmount,
      byCategory
    }
  }, [scadenze, getScadenzeByCategory])

  // Top 5 most urgent items across all categories
  const topUrgent = useMemo((): Scadenza[] => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const allActive = scadenze.filter(s =>
      s.status !== 'completed' && s.status !== 'paid' && s.status !== 'refunded'
    )

    return allActive
      .map(s => {
        let urgency = Infinity
        if (s.due_date) {
          const d = new Date(s.due_date)
          d.setHours(0, 0, 0, 0)
          urgency = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        } else if (s.due_km && s.current_km) {
          urgency = s.due_km - s.current_km
        }
        return { scadenza: s, urgency }
      })
      .sort((a, b) => a.urgency - b.urgency)
      .slice(0, 5)
      .map(item => item.scadenza)
  }, [scadenze])

  return {
    scadenze,
    loading,
    scadenzaSearch,
    setScadenzaSearch,
    stats,
    topUrgent,
    getScadenzeByCategory,
    filterBySearch,
    handleAction,
    handleAddScadenza
  }
}
