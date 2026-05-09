import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../../supabaseClient'
import type { Scadenza, NewScadenzaForm } from './scadenzeConfig'
import { CATEGORIES, CATEGORY_KEYS } from './scadenzeConfig'

export interface ScadenzeStats {
  totalActive: number
  overdue: number
  dueThisWeek: number      // legacy: 0–7 days (manteniamo per retrocompat)
  urgent3Days: number      // 0–3 giorni
  in7Days: number          // 4–7 giorni
  over7Days: number        // 8+ giorni
  totalAmount: number
  overdueAmount: number
  urgent3Amount: number
  in7Amount: number
  over7Amount: number
  byCategory: Record<string, { count: number; mostUrgent: Scadenza | null }>
  amountByCategory: Record<string, number>
  amountByPriority: { critica: number; alta: number; media: number; bassa: number }
  countByPriority: { critica: number; alta: number; media: number; bassa: number }
  // 12 mesi a partire dal mese corrente — count e importo delle scadenze
  // attive con due_date in quel mese (esclude scadenze a km).
  byMonth: Array<{ key: string; label: string; count: number; amount: number }>
  // Trend impatto: array di 12 punti, ogni punto e' il TOTALE cumulato
  // dell'importo in scadenza fino a fine mese (utile per vedere
  // "quanto avro' speso per scadenze entro fine giugno", "fine luglio", ...).
  trendCumulative: Array<{ key: string; label: string; cumulative: number }>
}

export function useScadenze() {
  const [scadenze, setScadenze] = useState<Scadenza[]>([])
  const [loading, setLoading] = useState(true)
  const [scadenzaSearch, setScadenzaSearch] = useState('')

  useEffect(() => {
    // loadScadenze must complete before loadAutoScadenze so the latter
    // can merge manual DB scadenze with auto-generated ones without race conditions.
    loadScadenze().then(() => loadAutoScadenze())
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
      const ahead = new Date(today)
      ahead.setDate(ahead.getDate() + 30)

      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, customer_name, vehicle_name, dropoff_date, price_total, booking_details, service_type')
        .gte('dropoff_date', today.toISOString())
        .lte('dropoff_date', ahead.toISOString())
        .in('status', ['confirmed', 'active'])
        .or('service_type.is.null,service_type.eq.car_rental')
        .order('dropoff_date', { ascending: true })

      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('*, customers_extended!cliente_id(nome, cognome, denominazione, tipo_cliente), vehicles!veicolo_id(display_name)')
        .not('stato', 'in', '("Restituita","Sbloccata")')

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'retired')

      const autoScadenze: Scadenza[] = []

      // Filter: keep only real rental bookings (exclude car wash and lavaggio rientro)
      const rentalBookings = (bookings || []).filter(b => {
        // Exclude explicit car_wash service type
        if (b.service_type === 'car_wash') return false
        // Exclude "Lavaggio Rientro" bookings (car wash tied to rental returns)
        if (b.customer_name?.toLowerCase().includes('lavaggio')) return false
        return true
      })

      // Rental endings
      rentalBookings.forEach(booking => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cauzioni?.forEach((cauzione: any) => {
        // Build customer name from customers_extended join
        const custData = cauzione.customers_extended
        let customerName = 'Cliente'
        if (custData) {
          if (custData.tipo_cliente === 'azienda' && custData.denominazione) {
            customerName = custData.denominazione
          } else if (custData.nome || custData.cognome) {
            customerName = `${custData.nome || ''} ${custData.cognome || ''}`.trim()
          }
        }
        const vehicleName = cauzione.vehicles?.display_name || 'Veicolo'

        // Map DB stato (Italian) to scadenze status
        const statoMap: Record<string, Scadenza['status']> = {
          'Attiva': 'to_block',
          'In scadenza': 'to_block',
          'Bloccata': 'blocked',
          'Incassata': 'blocked',
        }

        autoScadenze.push({
          id: `cauzione-${cauzione.id}`,
          category: 'cauzioni',
          item_type: 'Cauzione noleggio',
          description: `${customerName} - ${vehicleName}`,
          reference_id: cauzione.id,
          reference_type: 'cauzione',
          reference_name: customerName,
          due_date: cauzione.scadenza_cauzione || null,
          due_km: null,
          current_km: null,
          amount: Math.round(Number(cauzione.importo) * 100),
          status: statoMap[cauzione.stato] || 'to_block',
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
          .update({ stato: 'Bloccata', note: 'Bloccata da Scadenze', updated_at: new Date().toISOString() })
          .eq('id', scadenza.reference_id)
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'blocked' } : s
        ))
      } else if (action === 'collect' && scadenza.reference_type === 'cauzione') {
        await supabase
          .from('cauzioni')
          .update({ data_incasso: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', scadenza.reference_id)
        setScadenze(prev => prev.map(s =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          s.id === scadenza.id ? { ...s, status: 'collected' as any } : s
        ))
      } else if (action === 'refund' && scadenza.reference_type === 'cauzione') {
        // Local state only — confirm step before actual refund
        setScadenze(prev => prev.map(s =>
          s.id === scadenza.id ? { ...s, status: 'to_refund' } : s
        ))
      } else if (action === 'mark_refunded' && scadenza.reference_type === 'cauzione') {
        await supabase.rpc('mark_cauzione_restituita', {
          cauzione_id: scadenza.reference_id,
          return_note: 'Restituita da Scadenze'
        })
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
      console.error('Errore durante l\'operazione')
    }
  }, [])

  const handleAddScadenza = useCallback(async (newScadenza: NewScadenzaForm) => {
    try {
      const categoryConfig = CATEGORIES[newScadenza.category]
      const advanceDays = categoryConfig && 'advanceDays' in categoryConfig && typeof categoryConfig.advanceDays === 'number'
        ? categoryConfig.advanceDays
        : 5

      const isRecurring = !!newScadenza.recurring_interval

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
          is_recurring: isRecurring,
          recurring_interval: isRecurring ? newScadenza.recurring_interval : null
        })

      if (error) throw error
      loadScadenze()
      return true
    } catch (error) {
      console.error('Error adding scadenza:', error)
      console.error('Errore durante l\'aggiunta')
      return false
    }
  }, [])

  const handleEditScadenza = useCallback(async (id: string, updates: Partial<NewScadenzaForm>) => {
    try {
      const isRecurring = !!updates.recurring_interval

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbUpdates: Record<string, any> = {}
      if (updates.item_type !== undefined) dbUpdates.item_type = updates.item_type
      if (updates.description !== undefined) dbUpdates.description = updates.description
      if (updates.reference_name !== undefined) dbUpdates.reference_name = updates.reference_name
      if (updates.due_date !== undefined) dbUpdates.due_date = updates.due_date
      if (updates.amount !== undefined) dbUpdates.amount = updates.amount ? Math.round(parseFloat(updates.amount) * 100) : null
      if (updates.recurring_interval !== undefined) {
        dbUpdates.is_recurring = isRecurring
        dbUpdates.recurring_interval = isRecurring ? updates.recurring_interval : null
      }

      const { error } = await supabase
        .from('scadenze')
        .update(dbUpdates)
        .eq('id', id)

      if (error) throw error
      loadScadenze()
      return true
    } catch (error) {
      console.error('Error editing scadenza:', error)
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
    const day = 1000 * 60 * 60 * 24

    const allActive = scadenze.filter(s =>
      s.status !== 'completed' && s.status !== 'paid' && s.status !== 'refunded'
    )

    let overdue = 0
    let urgent3Days = 0
    let in7Days = 0
    let over7Days = 0
    let totalAmount = 0
    let overdueAmount = 0
    let urgent3Amount = 0
    let in7Amount = 0
    let over7Amount = 0

    const amountByCategory: Record<string, number> = {}
    const amountByPriority = { critica: 0, alta: 0, media: 0, bassa: 0 }
    const countByPriority = { critica: 0, alta: 0, media: 0, bassa: 0 }

    allActive.forEach(s => {
      const amt = s.amount || 0
      totalAmount += amt
      // Bucket by urgency: scaduto / 0–3gg / 4–7gg / 8+gg
      let bucket: 'overdue' | '3d' | '7d' | 'over7' | null = null
      if (s.due_date) {
        const d = new Date(s.due_date)
        d.setHours(0, 0, 0, 0)
        const diffDays = Math.floor((d.getTime() - today.getTime()) / day)
        if (diffDays < 0) bucket = 'overdue'
        else if (diffDays <= 3) bucket = '3d'
        else if (diffDays <= 7) bucket = '7d'
        else bucket = 'over7'
      } else if (s.due_km && s.current_km) {
        const km = s.due_km - s.current_km
        if (km <= 0) bucket = 'overdue'
        else if (km <= 500) bucket = '3d'
        else if (km <= 2000) bucket = '7d'
        else bucket = 'over7'
      }
      if (bucket === 'overdue') { overdue++; overdueAmount += amt; countByPriority.critica++; amountByPriority.critica += amt }
      else if (bucket === '3d') { urgent3Days++; urgent3Amount += amt; countByPriority.alta++; amountByPriority.alta += amt }
      else if (bucket === '7d') { in7Days++; in7Amount += amt; countByPriority.media++; amountByPriority.media += amt }
      else if (bucket === 'over7') { over7Days++; over7Amount += amt; countByPriority.bassa++; amountByPriority.bassa += amt }

      // Aggregato importo per categoria
      const k = s.category || 'altro'
      amountByCategory[k] = (amountByCategory[k] || 0) + amt
    })

    const byCategory: Record<string, { count: number; mostUrgent: Scadenza | null }> = {}
    CATEGORY_KEYS.forEach(key => {
      const catItems = getScadenzeByCategory(key)
      byCategory[key] = {
        count: catItems.length,
        mostUrgent: catItems.length > 0 ? catItems[0] : null
      }
    })

    // ── Aggregato per mese (prossimi 12 mesi) ──────────────────────────
    const byMonthMap = new Map<string, { count: number; amount: number }>()
    const trendKeys: string[] = []
    const now = new Date()
    now.setDate(1)
    now.setHours(0, 0, 0, 0)
    for (let i = 0; i < 12; i++) {
      const d = new Date(now)
      d.setMonth(d.getMonth() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      trendKeys.push(key)
      byMonthMap.set(key, { count: 0, amount: 0 })
    }
    allActive.forEach(s => {
      if (!s.due_date) return
      const d = new Date(s.due_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const bucket = byMonthMap.get(key)
      if (!bucket) return // out of 12-month window
      bucket.count++
      bucket.amount += s.amount || 0
    })
    const monthLabel = (key: string) => {
      const [y, m] = key.split('-').map(Number)
      const d = new Date(y, m - 1, 1)
      return d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })
    }
    const byMonth = trendKeys.map(key => {
      const b = byMonthMap.get(key)!
      return { key, label: monthLabel(key), count: b.count, amount: b.amount }
    })
    // Trend cumulativo: somma progressiva dell'importo mese dopo mese.
    let running = 0
    const trendCumulative = byMonth.map(m => {
      running += m.amount
      return { key: m.key, label: m.label, cumulative: running }
    })

    return {
      totalActive: allActive.length,
      overdue,
      dueThisWeek: urgent3Days + in7Days,
      urgent3Days,
      in7Days,
      over7Days,
      totalAmount,
      overdueAmount,
      urgent3Amount,
      in7Amount,
      over7Amount,
      byCategory,
      amountByCategory,
      amountByPriority,
      countByPriority,
      byMonth,
      trendCumulative,
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
    handleAddScadenza,
    handleEditScadenza
  }
}
