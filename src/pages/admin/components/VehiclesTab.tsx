import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { logger } from '../../../utils/logger'
import { ORPHAN_PALETTE, getPaletteForCategory } from '../../../utils/categoryPalettes'

// Estrae un messaggio leggibile da qualunque shape di errore (Error,
// PostgrestError di Supabase, oggetto generico). Senza questa logica
// l'alert mostrava "[object Object]" perche\' Supabase tira oggetti
// piatti che non sono istanze di Error.
function extractErrorMessage(error: unknown): string {
  if (!error) return 'Errore sconosciuto'
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts: string[] = []
    if (typeof e.message === 'string' && e.message) parts.push(e.message)
    if (typeof e.details === 'string' && e.details) parts.push(e.details)
    if (typeof e.hint === 'string' && e.hint) parts.push(`hint: ${e.hint}`)
    if (typeof e.code === 'string' && e.code) parts.push(`(${e.code})`)
    if (parts.length) return parts.join(' — ')
    try { return JSON.stringify(error) } catch { return String(error) }
  }
  return String(error)
}

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  status: 'available' | 'unavailable' | 'rented' | 'maintenance' | 'retired'
  daily_rate: number
  // category id is whatever the operator typed in Centralina Pro > Categorie & Fascia.
  // The legacy seeds 'exotic' / 'urban' / 'aziendali' still work; new ids are accepted.
  category: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

interface ProCategory { id: string; label: string }

// Palette ciclata definita in utils/categoryPalettes.ts e condivisa con
// CalendarTab perche\' il tag categoria deve avere gli stessi colori in
// entrambi i tab.

export default function VehiclesTab() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [categories, setCategories] = useState<ProCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // const [selectedCategory, setSelectedCategory] = useState<'all' | 'exotic' | 'urban'>('all')
  // const [selectedVehicle, setSelectedVehicle] = useState<string>('all')
  const [adjustmentPercentage, setAdjustmentPercentage] = useState<string>('10')
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<string>('all')

  const [plateSearch, setPlateSearch] = useState('')

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set())

  const [formData, setFormData] = useState({
    display_name: '',
    plate: '',
    status: 'available',
    daily_rate: '0',
    category: '',
    unavailable_from: '',
    unavailable_until: '',
    unavailable_from_time: '',
    unavailable_until_time: '',
    unavailable_reason: '',
    model_year: '',
    cv: '',
    acceleration_0_100: '',
    image_url: ''
  })

  const [uploadingImage, setUploadingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadVehicles()
  }, [])

  // Quando le categorie da Centralina Pro arrivano o cambiano, riallinea
  // il valore del Select del form alla prima categoria valida.
  useEffect(() => {
    if (categories.length === 0) return
    setFormData(prev => {
      if (prev.category && categories.some(c => c.id === prev.category)) return prev
      return { ...prev, category: categories[0].id }
    })
  }, [categories])

  // Categories live in centralina_pro_config.config.categories (Centralina Pro
  // > Categorie & Fascia is the single source of truth). We subscribe so any
  // add/rename/delete done there propagates here within a couple of seconds.
  useEffect(() => {
    let cancelled = false
    async function loadCategories() {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config as { categories?: ProCategory[] } | null) || null
      const list = Array.isArray(cfg?.categories) ? cfg.categories : []
      setCategories(list)
    }
    loadCategories()
    const channel = supabase
      .channel('vehicles-categories-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, (payload) => {
        const cfg = (payload.new as { config?: { categories?: ProCategory[] } } | undefined)?.config
        const list = Array.isArray(cfg?.categories) ? cfg.categories : []
        setCategories(list)
      })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [])

  async function loadVehicles() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'retired')
        .order('display_name')

      if (error) throw error
      setVehicles(data || [])
    } catch (error) {
      console.error('Failed to load vehicles:', error)
    } finally {
      setLoading(false)
    }
  }

  // Aggregati flotta dagli ultimi 30 giorni di bookings (stesso pattern
  // di FleetList). Pure dati reali — niente mock. Caricati una volta
  // dopo che `vehicles` e\' pronto, refresh su realtime bookings.
  type VehStats = { fatturato: number; giorniNoleggio: number; giorniFermo: number; utilizzoPct: number }
  const [vehicleStats, setVehicleStats] = useState<Map<string, VehStats>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadBookingStats = async () => {
    if (vehicles.length === 0) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const thirtyAgo = new Date(today.getTime() - 30 * 86400000)
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, vehicle_id, vehicle_plate, vehicle_name, pickup_date, dropoff_date, price_total, status, payment_status, service_type')
      .gte('pickup_date', thirtyAgo.toISOString())
      .or('service_type.is.null,service_type.eq.car_rental,service_type.eq.rental')
      .limit(2000)
    const stats = new Map<string, VehStats>()
    const byId = new Map<string, Vehicle>()
    const byPlate = new Map<string, Vehicle>()
    for (const v of vehicles) {
      byId.set(v.id, v)
      if (v.plate) byPlate.set(v.plate.toLowerCase().replace(/\s/g, ''), v)
    }
    const occupied = new Map<string, Set<string>>()
    const PAID = new Set(['paid', 'succeeded', 'completed'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of ((bookings || []) as any[])) {
      if (b.status === 'cancelled' || b.status === 'annullata') continue
      let vid: string | null = null
      if (b.vehicle_id && byId.has(b.vehicle_id)) vid = b.vehicle_id
      else if (b.vehicle_plate) {
        const v = byPlate.get(String(b.vehicle_plate).toLowerCase().replace(/\s/g, ''))
        if (v) vid = v.id
      }
      if (!vid) continue
      const cur = stats.get(vid) || { fatturato: 0, giorniNoleggio: 0, giorniFermo: 0, utilizzoPct: 0 }
      if (PAID.has(String(b.payment_status || '').toLowerCase())) {
        cur.fatturato += Number(b.price_total || 0) / 100
      }
      if (b.pickup_date && b.dropoff_date) {
        const s = new Date(b.pickup_date); s.setHours(0, 0, 0, 0)
        const e = new Date(b.dropoff_date); e.setHours(0, 0, 0, 0)
        const sC = s < thirtyAgo ? thirtyAgo : s
        const eC = e > today ? today : e
        const set = occupied.get(vid) || new Set<string>()
        for (let t = sC.getTime(); t <= eC.getTime(); t += 86400000) set.add(new Date(t).toISOString().slice(0, 10))
        occupied.set(vid, set)
      }
      stats.set(vid, cur)
    }
    for (const [vid, set] of occupied.entries()) {
      const cur = stats.get(vid)
      if (!cur) continue
      cur.giorniNoleggio = set.size
      cur.giorniFermo = Math.max(0, 30 - set.size)
      cur.utilizzoPct = Math.min(100, Math.round((set.size / 30) * 100))
    }
    setVehicleStats(stats)
  }
  useEffect(() => { loadBookingStats() }, [vehicles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stats aggregate per la dashboard (KPI + alert + suggerimenti).
  const fleetKpi = useMemo(() => {
    const total = vehicles.length
    const attivi = vehicles.filter(v => v.status === 'available').length
    const fermi = vehicles.filter(v => v.status === 'maintenance').length
    let totalFatturato = 0
    let utilSum = 0
    let utilCount = 0
    let roiSum = 0
    let roiCount = 0
    let sottoTarget = 0
    let fermiOltre3 = 0
    vehicleStats.forEach((s, vid) => {
      totalFatturato += s.fatturato
      utilSum += s.utilizzoPct; utilCount++
      if (s.utilizzoPct < 40) sottoTarget++
      if (s.giorniFermo >= 3) fermiOltre3++
      const v = vehicles.find(x => x.id === vid)
      const potential = (v?.daily_rate || 0) * 30
      if (potential > 0) { roiSum += (s.fatturato / potential) * 100; roiCount++ }
    })
    const utilizzoMedio = utilCount > 0 ? Math.round(utilSum / utilCount) : 0
    const roiMedio = roiCount > 0 ? Math.round((roiSum / roiCount) * 10) / 10 : 0
    return { total, attivi, fermi, totalFatturato, utilizzoMedio, roiMedio, sottoTarget, fermiOltre3 }
  }, [vehicles, vehicleStats])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate that "targa" is not in the display_name
    if (formData.display_name.toLowerCase().includes('targa')) {
      alert('⚠️ ERRORE: Non scrivere "targa" nel campo Nome!\n\nUsa il campo "Targa" separato sotto.\n\nEsempio:\n✅ Nome: "Audi RS3 Verde"\n✅ Targa: "AB123CD"')
      return
    }

    // Validate that the plate number is not in the display_name
    if (formData.plate && formData.display_name.includes(formData.plate.trim())) {
      alert('⚠️ ERRORE: Non mettere la targa nel campo Nome!\n\nIl numero di targa va SOLO nel campo "Targa".\n\nEsempio SBAGLIATO:\n❌ Nome: "Audi RS3 Verde PAMT299"\n\nEsempio CORRETTO:\n✅ Nome: "Audi RS3 Verde"\n✅ Targa: "PAMT299"')
      return
    }

    // Validate dates when status is unavailable
    if (formData.status === 'unavailable') {
      if (!formData.unavailable_from || !formData.unavailable_until) {
        alert('⚠️ ATTENZIONE: Per sincronizzare con Google Calendar, devi specificare ENTRAMBE le date:\n\n📅 Non Disponibile Dal (data inizio)\n📅 Non Disponibile Fino Al (data fine)\n\nSe è solo per un giorno, inserisci la stessa data in entrambi i campi.')
        return
      }

      // Validate that from date is not after until date
      if (formData.unavailable_from > formData.unavailable_until) {
        alert('⚠️ ERRORE: La data "Dal" non può essere successiva alla data "Fino Al"!')
        return
      }
    }

    try {
      // Preserve unknown metadata keys (display_group, booking_disabled, specs, …)
      // by merging on top of the row's current metadata when editing.
      const existingMetadata = editingId
        ? (vehicles.find(v => v.id === editingId)?.metadata || {})
        : {}

      const parsedRate = Number.parseFloat(formData.daily_rate)
      const dataToSave = {
        display_name: formData.display_name,
        plate: formData.plate || null,
        status: formData.status,
        daily_rate: Number.isFinite(parsedRate) ? parsedRate : 0,
        category: formData.category,
        metadata: {
          ...existingMetadata,
          unavailable_from: formData.unavailable_from || null,
          unavailable_until: formData.unavailable_until || null,
          unavailable_from_time: formData.unavailable_from_time || null,
          unavailable_until_time: formData.unavailable_until_time || null,
          unavailable_reason: formData.unavailable_reason || null,
          model_year: formData.model_year ? parseInt(formData.model_year) : null,
          cv: formData.cv ? parseInt(formData.cv) : null,
          acceleration_0_100: formData.acceleration_0_100 ? parseFloat(formData.acceleration_0_100) : null,
          image: formData.image_url || null
        }
      }

      if (editingId) {
        const { data, error } = await supabase
          .from('vehicles')
          .update(dataToSave)
          .eq('id', editingId)
          .select()

        if (error) throw error
        logger.log('Vehicle updated:', data)
      } else {
        const { data, error } = await supabase
          .from('vehicles')
          .insert([dataToSave])
          .select()

        if (error) throw error
        logger.log('Vehicle created:', data)
      }

      // Sync with Google Calendar if vehicle is marked unavailable with dates
      if (
        formData.status === 'unavailable' &&
        formData.unavailable_from &&
        formData.unavailable_until
      ) {
        try {
          const response = await fetch('/.netlify/functions/create-vehicle-unavailability-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vehicleName: formData.display_name,
              vehiclePlate: formData.plate || undefined,
              unavailableFrom: formData.unavailable_from,
              unavailableUntil: formData.unavailable_until,
              unavailableFromTime: formData.unavailable_from_time || '09:00',
              unavailableUntilTime: formData.unavailable_until_time || '18:00',
              reason: formData.unavailable_reason || 'Non disponibile'
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to create calendar event:', errorText);
          } else {
            logger.log('Calendar event created successfully');
          }
        } catch (calendarError) {
          console.error('Error syncing with calendar:', calendarError);
        }
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadVehicles()
    } catch (error: unknown) {
      console.error('Failed to save vehicle:', error)
      alert('Impossibile salvare il veicolo: ' + extractErrorMessage(error))
    }
  }

  async function deleteVehicleLogic(id: string, vehicleName: string) {
    logger.log(`Starting deletion for vehicle: ${vehicleName} (ID: ${id})`)

    // Delete from reservations
    logger.log('  Deleting reservations...')
    const { data: deletedReservations, error: resError } = await supabase
      .from('reservations')
      .delete()
      .eq('vehicle_id', id)
      .select()

    if (resError) {
      console.error('  Error deleting reservations:', resError)
      throw new Error(`Failed to delete reservations: ${resError.message}`)
    }
    logger.log(`  Deleted ${deletedReservations?.length || 0} reservations`)

    // Get booking IDs first so we can delete dependent records.
    // Match BOTH on vehicle_id (authoritative FK) AND vehicle_name (string fallback
    // for legacy bookings that never had vehicle_id populated). Prima bug: solo
    // vehicle_name → prenotazioni rimanevano orfane dopo delete del veicolo.
    logger.log('  Fetching booking IDs...')
    const { data: bookingsToDelete, error: fetchError } = await supabase
      .from('bookings')
      .select('id')
      .or(`vehicle_id.eq.${id},vehicle_name.eq.${vehicleName}`)

    if (fetchError) {
      console.error('  Error fetching bookings:', fetchError)
      throw new Error(`Failed to fetch bookings: ${fetchError.message}`)
    }

    const bookingIds = (bookingsToDelete || []).map(b => b.id)
    logger.log(`  Found ${bookingIds.length} bookings to delete (matched by vehicle_id or vehicle_name)`)

    if (bookingIds.length > 0) {
      // Delete contracts referencing these bookings (FK: contracts_booking_id_fkey)
      logger.log('  Deleting contracts...')
      const { error: contractError } = await supabase
        .from('contracts')
        .delete()
        .in('booking_id', bookingIds)

      if (contractError) {
        console.error('  Error deleting contracts:', contractError)
        throw new Error(`Failed to delete contracts: ${contractError.message}`)
      }

      // Delete fatture (invoices) referencing these bookings
      logger.log('  Deleting fatture...')
      const { error: fattureError } = await supabase
        .from('fatture')
        .delete()
        .in('booking_id', bookingIds)

      if (fattureError) {
        console.error('  Error deleting fatture:', fattureError)
        throw new Error(`Failed to delete fatture: ${fattureError.message}`)
      }
    }

    // Delete from bookings — same OR match so niente prenotazioni orfane
    logger.log('  Deleting bookings...')
    const { data: deletedBookings, error: bookError } = await supabase
      .from('bookings')
      .delete()
      .or(`vehicle_id.eq.${id},vehicle_name.eq.${vehicleName}`)
      .select()

    if (bookError) {
      console.error('  Error deleting bookings:', bookError)
      throw new Error(`Failed to delete bookings: ${bookError.message}`)
    }
    logger.log(`  Deleted ${deletedBookings?.length || 0} bookings`)

    // Delete cauzioni (security deposits) referencing this vehicle
    logger.log('  Deleting cauzioni...')
    const { error: cauzioniError } = await supabase
      .from('cauzioni')
      .delete()
      .eq('veicolo_id', id)

    if (cauzioniError) {
      console.error('  Error deleting cauzioni:', cauzioniError)
      throw new Error(`Failed to delete cauzioni: ${cauzioniError.message}`)
    }

    // Nullify preventivi.vehicle_id (FK preventivi_vehicle_id_fkey) so the
    // vehicle delete doesn't trip the constraint. Preventivi history stays.
    logger.log('  Clearing preventivi.vehicle_id references...')
    const { error: preventiviError } = await supabase
      .from('preventivi')
      .update({ vehicle_id: null })
      .eq('vehicle_id', id)

    if (preventiviError) {
      console.error('  Error clearing preventivi vehicle_id:', preventiviError)
      throw new Error(`Failed to clear preventivi vehicle_id: ${preventiviError.message}`)
    }

    // Finally, delete the vehicle itself
    logger.log('  Deleting vehicle record...')
    const { data: deletedVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', id)
      .select()

    if (vehicleError) {
      console.error('  Error deleting vehicle:', vehicleError)
      throw new Error(`Failed to delete vehicle: ${vehicleError.message}`)
    }

    if (!deletedVehicle || deletedVehicle.length === 0) {
      console.error('  Vehicle was not deleted (no rows affected)')
      throw new Error('Vehicle deletion failed: No rows were deleted. The vehicle may not exist or you may not have permission to delete it.')
    }

    logger.log('  Vehicle deleted successfully')
  }

  async function handleDelete(id: string) {
    const vehicle = vehicles.find(v => v.id === id)
    if (!vehicle) return

    const confirmed = confirm(
      `Sei sicuro di voler eliminare ${vehicle.display_name}?\n\nTutte le prenotazioni, contratti, fatture e cauzioni resteranno intatte.`
    )
    if (!confirmed) return

    try {
      // Nullify FK references (UUID only) — keep all records intact
      // vehicle_name and vehicle_plate are text fields on bookings, they stay untouched
      await supabase.from('cauzioni').update({ veicolo_id: null }).eq('veicolo_id', id)
      await supabase.from('bookings').update({ vehicle_id: null }).eq('vehicle_id', id)
      await supabase.from('preventivi').update({ vehicle_id: null }).eq('vehicle_id', id)
      await supabase.from('reservations').delete().eq('vehicle_id', id)

      // Now delete the vehicle record
      const { data: deletedVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', id)
        .select()

      if (vehicleError) throw new Error(`Failed to delete vehicle: ${vehicleError.message}`)

      if (!deletedVehicle || deletedVehicle.length === 0) {
        throw new Error('Il veicolo non è stato eliminato. Potresti non avere i permessi necessari.')
      }

      await loadVehicles()
      alert('Veicolo eliminato con successo! Prenotazioni e documenti sono stati conservati.')
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Failed to delete vehicle:', error)
      alert('Errore durante l\'eliminazione: ' + _errMsg)
    }
  }

  async function deleteSelectedVehicles() {
    if (selectedVehicles.size === 0) return

    setLoading(true)
    try {
      const vehiclesToDelete = vehicles.filter(v => selectedVehicles.has(v.id))

      for (const vehicle of vehiclesToDelete) {
        try {
          await deleteVehicleLogic(vehicle.id, vehicle.display_name)
        } catch (err) {
          console.error(`Failed to delete vehicle ${vehicle.display_name}:`, err)
        }
      }

      setSelectedVehicles(new Set())
      setMultiSelectMode(false)
      loadVehicles()
    } catch (error) {
      console.error('Error during bulk delete:', error)
    } finally {
      setLoading(false)
    }
  }

  function toggleVehicleSelection(id: string) {
    const newSelected = new Set(selectedVehicles)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedVehicles(newSelected)
  }

  function toggleSelectCategory(categoryVehicles: Vehicle[]) {
    const allSelected = categoryVehicles.every(v => selectedVehicles.has(v.id))
    const newSelected = new Set(selectedVehicles)

    if (allSelected) {
      // Deselect all in this category
      categoryVehicles.forEach(v => newSelected.delete(v.id))
    } else {
      // Select all in this category
      categoryVehicles.forEach(v => newSelected.add(v.id))
    }
    setSelectedVehicles(newSelected)
  }

  async function syncToGoogleCalendar(vehicle: Vehicle) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = vehicle.metadata as any
    const unavailableFrom = metadata?.unavailable_from
    const unavailableUntil = metadata?.unavailable_until
    const unavailableFromTime = metadata?.unavailable_from_time || '09:00'
    const unavailableUntilTime = metadata?.unavailable_until_time || '18:00'
    const unavailableReason = metadata?.unavailable_reason

    if (!unavailableFrom || !unavailableUntil) {
      alert('⚠️ Impossibile sincronizzare: Date di non disponibilità mancanti.\n\nModifica il veicolo e inserisci entrambe le date.')
      return
    }

    try {
      const response = await fetch('/.netlify/functions/create-vehicle-unavailability-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleName: vehicle.display_name,
          vehiclePlate: vehicle.plate || undefined,
          unavailableFrom: unavailableFrom,
          unavailableUntil: unavailableUntil,
          unavailableFromTime: unavailableFromTime,
          unavailableUntilTime: unavailableUntilTime,
          reason: unavailableReason || 'Non disponibile'
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to create calendar event:', errorText)
        alert('❌ Errore nella sincronizzazione con Google Calendar.\n\nVerifica le credenziali.')
      }
    } catch (error) {
      console.error('Error syncing with calendar:', error)
    }
  }

  function resetForm() {
    setFormData({
      display_name: '',
      plate: '',
      status: 'available',
      daily_rate: '0',
      category: categories[0]?.id || '',
      unavailable_from: '',
      unavailable_until: '',
      unavailable_from_time: '',
      unavailable_until_time: '',
      unavailable_reason: '',
      model_year: '',
      cv: '',
      acceleration_0_100: '',
      image_url: ''
    })
  }

  function handleEdit(vehicle: Vehicle) {
    setFormData({
      display_name: vehicle.display_name,
      plate: vehicle.plate || '',
      status: vehicle.status,
      daily_rate: vehicle.daily_rate.toString(),
      category: vehicle.category || categories[0]?.id || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unavailable_from: (vehicle.metadata as any)?.unavailable_from || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unavailable_until: (vehicle.metadata as any)?.unavailable_until || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unavailable_from_time: (vehicle.metadata as any)?.unavailable_from_time || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unavailable_until_time: (vehicle.metadata as any)?.unavailable_until_time || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unavailable_reason: (vehicle.metadata as any)?.unavailable_reason || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model_year: (vehicle.metadata as any)?.model_year?.toString() || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cv: (vehicle.metadata as any)?.cv?.toString() || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      acceleration_0_100: (vehicle.metadata as any)?.acceleration_0_100?.toString() || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      image_url: (vehicle.metadata as any)?.image || ''
    })
    setEditingId(vehicle.id)
    setShowForm(true)
  }

  async function handlePriceAdjustment(increase: boolean) {
    const percentage = parseFloat(adjustmentPercentage)
    if (isNaN(percentage) || percentage <= 0) {
      alert('Inserisci una percentuale valida')
      return
    }

    setIsAdjusting(true)
    try {
      // Determine which vehicles to update
      let vehiclesToUpdate: Vehicle[] = []
      if (selectedVehicle === 'all') {
        vehiclesToUpdate = vehicles
      } else {
        const vehicle = vehicles.find(v => v.id === selectedVehicle)
        if (vehicle) vehiclesToUpdate = [vehicle]
      }

      // Update each vehicle's price
      const updates = vehiclesToUpdate.map(async (vehicle) => {
        const adjustment = increase ? (1 + percentage / 100) : (1 - percentage / 100)
        const newRate = Math.round(vehicle.daily_rate * adjustment)

        const { error } = await supabase
          .from('vehicles')
          .update({ daily_rate: newRate })
          .eq('id', vehicle.id)

        if (error) throw error
        return { id: vehicle.id, newRate }
      })

      await Promise.all(updates)

      // Reload vehicles
      await loadVehicles()

      // Success — prices updated, UI refreshes
    } catch (error) {
      console.error('Failed to adjust prices:', error)
      alert('Errore nell\'aggiornamento dei prezzi')
    } finally {
      setIsAdjusting(false)
    }
  }

  // Separate vehicles by category
  const searchFilter = (v: Vehicle) => {
    if (!plateSearch.trim()) return true
    const q = plateSearch.trim().toLowerCase().replace(/\s/g, '')
    const plate = (v.plate || '').toLowerCase().replace(/\s/g, '')
    const name = v.display_name.toLowerCase()
    return plate.includes(q) || name.includes(q)
  }

  // Centralina Pro e\' la sola fonte di verita\' per le categorie. Per ogni
  // categoria costruiamo una sezione con i veicoli filtrati e la palette
  // assegnata in base all'ordine in Centralina Pro.
  const knownIds = new Set(categories.map(c => c.id))
  // Use the SAME palette resolver as CalendarTab so the section banner /
  // pill colors here stay perfectly in sync with the per-vehicle category
  // tags shown in the rental calendar. Refactoring this to a positional
  // index would silently drift the two views apart.
  const sections = categories.map((c) => ({
    category: c,
    palette: getPaletteForCategory(c.id, categories),
    vehicles: vehicles.filter(v => v.category === c.id).filter(searchFilter),
  }))
  // Veicoli con un category id non piu\' presente in Centralina Pro (es.
  // dopo un rename) finirebbero invisibili: li raccogliamo in "Altre"
  // per garantire che restino editabili.
  const orphanVehicles = vehicles
    .filter(v => !v.category || !knownIds.has(v.category))
    .filter(searchFilter)
  const orphanSection = orphanVehicles.length > 0
    ? { category: { id: '__orphan__', label: 'Altre / Senza categoria' }, palette: ORPHAN_PALETTE, vehicles: orphanVehicles }
    : null
  const allSections = orphanSection ? [...sections, orphanSection] : sections

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      {/* KPI strip — 6 metriche flotta, dati reali da vehicles + bookings 30g */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        {[
          { label: 'Totale Veicoli', value: String(fleetKpi.total), sub: '100% della flotta', ring: '#3B82F6' },
          { label: 'Veicoli Attivi', value: String(fleetKpi.attivi), sub: fleetKpi.total > 0 ? `${Math.round((fleetKpi.attivi / fleetKpi.total) * 100)}% della flotta` : '—', ring: '#10B981' },
          { label: 'Veicoli Fermi', value: String(fleetKpi.fermi), sub: fleetKpi.total > 0 ? `${Math.round((fleetKpi.fermi / fleetKpi.total) * 100)}% della flotta` : '—', ring: '#EF4444' },
          { label: 'Fatturato Flotta', value: `€${fleetKpi.totalFatturato.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`, sub: 'ultimi 30 giorni', ring: '#F59E0B' },
          { label: 'Utilizzo Medio', value: `${fleetKpi.utilizzoMedio}%`, sub: 'media veicolare', ring: '#06B6D4' },
          { label: 'ROI Medio Flotta', value: `${String(fleetKpi.roiMedio).replace('.', ',')}%`, sub: 'fatturato/potenziale', ring: '#A855F7' },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary p-3" style={{ borderColor: `${k.ring}33` }}>
            <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl pointer-events-none" style={{ background: `${k.ring}22` }}/>
            <div className="relative">
              <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: `${k.ring}cc` }}>{k.label}</div>
              <div className="text-xl lg:text-2xl font-bold text-theme-text-primary mt-1 tabular-nums">{k.value}</div>
              <div className="text-[10px] text-theme-text-muted mt-0.5">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Alert intelligenti — appare solo se ci sono avvisi */}
      {(() => {
        const alerts: { tone: 'red' | 'amber'; text: string }[] = []
        if (fleetKpi.fermiOltre3 > 0) alerts.push({ tone: 'red', text: `${fleetKpi.fermiOltre3} ${fleetKpi.fermiOltre3 === 1 ? 'veicolo fermo' : 'veicoli fermi'} da oltre 3 giorni` })
        if (fleetKpi.sottoTarget > 0) alerts.push({ tone: 'amber', text: `${fleetKpi.sottoTarget} ${fleetKpi.sottoTarget === 1 ? 'veicolo sotto' : 'veicoli sotto'} il target di utilizzo` })
        if (alerts.length === 0) return null
        const dot = { red: 'bg-red-500', amber: 'bg-amber-500' }
        return (
          <div className="bg-gradient-to-br from-red-500/8 via-amber-500/5 to-transparent border border-amber-500/20 rounded-2xl px-4 py-3 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Alert Intelligenti</span>
              <span className="text-[11px] text-theme-text-muted">{alerts.length} {alerts.length === 1 ? 'avviso' : 'avvisi'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 bg-theme-bg-primary/40 border border-theme-border/50 rounded-full px-3 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${dot[a.tone]}`}/>
                  <span className="text-[11px] text-theme-text-primary">{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <div className="flex flex-col lg:flex-row justify-between items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Veicoli</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            {sections.map(s => `${s.category.label}: ${s.vehicles.length}`).join(' | ')}
            {sections.length > 0 ? ' | ' : ''}Totale: {vehicles.length}
            {orphanSection ? ` | Senza categoria: ${orphanSection.vehicles.length}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setMultiSelectMode(!multiSelectMode)
              setSelectedVehicles(new Set())
            }}
            variant={multiSelectMode ? 'secondary' : 'primary'}
            className={multiSelectMode ? 'bg-blue-600 text-theme-text-primary' : ''}
          >
            {multiSelectMode ? 'Annulla Selezione' : 'Selezione Multipla'}
          </Button>
          <Button onClick={() => { resetForm(); setEditingId(null); setShowForm(true) }}>
            + Nuovo Veicolo
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <Input
          label="Cerca per targa o nome veicolo"
          placeholder="Cerca per targa o nome veicolo..."
          value={plateSearch}
          onChange={(e) => setPlateSearch(e.target.value)}
        />
      </div>

      {multiSelectMode && selectedVehicles.size > 0 && (
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="text-blue-200">
            <strong>{selectedVehicles.size}</strong> veicoli selezionati
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                const percentage = prompt('Inserisci percentuale aumento (es. 10):')
                if (percentage) {
                  setAdjustmentPercentage(percentage)
                  // TODO: Implement bulk adjustment for selected
                  alert('Funzionalità in arrivo...')
                }
              }}
              variant="secondary"
              className="text-sm"
            >
              Modifica Prezzi
            </Button>
            <Button
              onClick={deleteSelectedVehicles}
              className="bg-red-600 hover:bg-red-700 text-theme-text-primary text-sm"
            >
              × Selezionati
            </Button>
          </div>
        </div>
      )}

      {/* Price Adjustment Section - Compact */}
      <div className="bg-theme-bg-secondary/50 border border-theme-border rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-theme-text-muted mb-1">Veicolo</label>
            <select
              value={selectedVehicle}
              onChange={(e) => setSelectedVehicle(e.target.value)}
              className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary text-sm"
            >
              <option value="all">Tutti i veicoli ({vehicles.length})</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.display_name} (€{vehicle.daily_rate})
                </option>
              ))}
            </select>
          </div>

          <div className="w-32">
            <label className="block text-xs text-theme-text-muted mb-1">Percentuale</label>
            <input
              type="number"
              value={adjustmentPercentage}
              onChange={(e) => setAdjustmentPercentage(e.target.value)}
              min="1"
              max="100"
              className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary text-sm"
              placeholder="10"
            />
          </div>

          <button
            onClick={() => handlePriceAdjustment(true)}
            disabled={isAdjusting}
            className="bg-green-700 hover:bg-green-600 text-theme-text-primary px-4 py-2 rounded-full text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            + Aumenta
          </button>

          <button
            onClick={() => handlePriceAdjustment(false)}
            disabled={isAdjusting}
            className="bg-red-700 hover:bg-red-600 text-theme-text-primary px-4 py-2 rounded-full text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            - Diminuisci
          </button>
        </div>

        {isAdjusting && (
          <div className="mt-3 text-center text-sm text-theme-text-muted">
            <p>Aggiornamento prezzi in corso...</p>
          </div>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-theme-bg-secondary p-6 rounded-lg mb-6 border border-theme-border">
          <h3 className="text-xl font-semibold text-theme-text-primary mb-4">
            {editingId ? 'Modifica Veicolo' : 'Nuovo Veicolo'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Input
                label="Nome (solo modello auto)"
                placeholder="Es: Audi RS3 Verde"
                required
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </div>
            <div>
              <Input
                label="Targa (numero di targa)"
                placeholder="Es: AB123CD"
                value={formData.plate}
                onChange={(e) => setFormData({ ...formData, plate: e.target.value })}
              />
            </div>
            <Select
              label="Categoria"
              required
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              options={(() => {
                const opts = categories.map(c => ({ value: c.id, label: c.label }))
                // If we're editing a vehicle whose category was renamed/deleted in
                // Centralina Pro, keep the current value selectable so the operator
                // doesn't accidentally clear it just by opening the form.
                if (formData.category && !opts.some(o => o.value === formData.category)) {
                  opts.push({ value: formData.category, label: `${formData.category} (non in Centralina Pro)` })
                }
                return opts
              })()}
            />
            <Select
              label="Stato"
              required
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              options={[
                { value: 'available', label: 'Disponibile' },
                { value: 'unavailable', label: 'Non Disponibile' }
              ]}
            />
            <Input
              label="Tariffa Giornaliera (€)"
              type="number"
              step="0.01"
              required
              value={formData.daily_rate}
              onChange={(e) => setFormData({ ...formData, daily_rate: e.target.value })}
            />
          </div>

          {/* Scheda Tecnica - Vehicle Specs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
            <p className="col-span-full text-sm text-theme-text-muted font-semibold mb-1">Scheda Tecnica (per Preventivi)</p>
            <Input
              label="Anno Modello"
              type="number"
              value={formData.model_year}
              onChange={(e) => setFormData({ ...formData, model_year: e.target.value })}
              placeholder="2025"
            />
            <Input
              label="Cavalli (CV)"
              type="number"
              value={formData.cv}
              onChange={(e) => setFormData({ ...formData, cv: e.target.value })}
              placeholder="400"
            />
            <Input
              label="0-100 km/h (s)"
              type="number"
              step="0.1"
              value={formData.acceleration_0_100}
              onChange={(e) => setFormData({ ...formData, acceleration_0_100: e.target.value })}
              placeholder="3.8"
            />
          </div>

          {/* Foto Veicolo - shown on the website */}
          <div className="mt-4 p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
            <p className="text-sm text-theme-text-muted font-semibold mb-2">Foto Veicolo (visibile sul sito web)</p>
            <div className="flex items-start gap-4">
              {formData.image_url ? (
                <div className="relative">
                  <img
                    src={formData.image_url}
                    alt="Anteprima"
                    className="w-32 h-24 object-cover rounded border border-theme-border"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, image_url: '' })}
                    className="absolute -top-2 -right-2 bg-red-700 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                    title="Rimuovi immagine"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="w-32 h-24 border-2 border-dashed border-theme-border rounded flex items-center justify-center text-xs text-theme-text-muted">
                  Nessuna foto
                </div>
              )}
              <div className="flex-1">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (!file.type.startsWith('image/')) {
                      alert('Solo file immagine (JPG, PNG, WEBP)')
                      return
                    }
                    if (file.size > 10 * 1024 * 1024) {
                      alert('Immagine troppo grande (max 10 MB)')
                      return
                    }
                    setUploadingImage(true)
                    try {
                      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
                      const fileName = `vehicle-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`
                      const path = `vehicles/${fileName}`
                      const { error: upErr } = await supabase.storage
                        .from('vehicle-images')
                        .upload(path, file, { cacheControl: '31536000', upsert: false })
                      if (upErr) throw upErr
                      const { data: urlData } = supabase.storage.from('vehicle-images').getPublicUrl(path)
                      setFormData(prev => ({ ...prev, image_url: urlData?.publicUrl || '' }))
                    } catch (err) {
                      console.error('Vehicle image upload failed:', err)
                      alert('Errore caricamento: ' + extractErrorMessage(err))
                    } finally {
                      setUploadingImage(false)
                      if (imageInputRef.current) imageInputRef.current.value = ''
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="text-xs"
                >
                  {uploadingImage ? 'Caricamento…' : (formData.image_url ? 'Sostituisci foto' : 'Carica foto')}
                </Button>
                <p className="text-xs text-theme-text-muted mt-2">
                  JPG / PNG / WEBP. Max 10 MB. Consigliato 1200×800 px o superiore, formato orizzontale.
                </p>
              </div>
            </div>
          </div>

          {/* Date Range for Unavailability */}
          {formData.status === 'unavailable' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
              <div>
                <label className="block text-sm text-yellow-200 mb-1 font-semibold">📅 Non Disponibile Dal *</label>
                <EuropeanDateInput
                  value={formData.unavailable_from}
                  onChange={(value) => setFormData({ ...formData, unavailable_from: value })}
                  required={formData.status === 'unavailable'}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-yellow-200 mb-1 font-semibold">🕐 Ora Inizio (opzionale - formato 24h)</label>
                <input
                  type="text"
                  value={formData.unavailable_from_time}
                  onChange={(e) => setFormData({ ...formData, unavailable_from_time: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary font-mono"
                  placeholder="10:00"
                  pattern="^([0-1][0-9]|2[0-3]):[0-5][0-9]$"
                  maxLength={5}
                  title="Formato 24 ore: HH:MM (es: 09:00, 14:00, 23:30)"
                />
                <p className="text-xs text-yellow-100 mt-1">Formato 24 ore: HH:MM (es: 09:00, 14:00, 23:30)</p>
              </div>
              <div>
                <label className="block text-sm text-yellow-200 mb-1 font-semibold">📅 Non Disponibile Fino Al *</label>
                <EuropeanDateInput
                  value={formData.unavailable_until}
                  onChange={(value) => setFormData({ ...formData, unavailable_until: value })}
                  required={formData.status === 'unavailable'}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-yellow-200 mb-1 font-semibold">🕐 Ora Fine (opzionale - formato 24h)</label>
                <input
                  type="text"
                  value={formData.unavailable_until_time}
                  onChange={(e) => setFormData({ ...formData, unavailable_until_time: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary font-mono"
                  placeholder="16:00"
                  pattern="^([0-1][0-9]|2[0-3]):[0-5][0-9]$"
                  maxLength={5}
                  title="Formato 24 ore: HH:MM (es: 14:00, 18:00, 23:30)"
                />
                <p className="text-xs text-yellow-100 mt-1">Formato 24 ore: HH:MM (es: 14:00, 18:00, 23:30)</p>
              </div>
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm text-yellow-200 mb-1 font-semibold">🔧 Motivo *</label>
                <select
                  value={formData.unavailable_reason}
                  onChange={(e) => setFormData({ ...formData, unavailable_reason: e.target.value })}
                  required={formData.status === 'unavailable'}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-full px-3 py-2 text-theme-text-primary"
                >
                  <option value="">Seleziona un motivo...</option>
                  <option value="Tagliando">Tagliando</option>
                  <option value="Gommista">Gommista</option>
                  <option value="Officina meccanica">Officina meccanica</option>
                  <option value="Viaggio">Viaggio</option>
                  <option value="Elettrauto">Elettrauto</option>
                </select>
              </div>
              <div className="col-span-1 md:col-span-2">
                <p className="text-xs text-yellow-200">
                  <strong>IMPORTANTE:</strong> Entrambe le date sono obbligatorie per sincronizzare con Google Calendar. Le ore sono opzionali - se specificate, il veicolo sarà non disponibile solo in quell'orario.
                </p>
              </div>
            </div>
          )}

          <div className="mt-4">
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ display: 'none' }}>
            {/* Hidden placeholder to maintain structure */}
          </div>
          <div className="flex gap-3 mt-4">
            <Button type="submit">Salva</Button>
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setEditingId(null); resetForm() }}>
              Annulla
            </Button>
          </div>
        </form>
      )}

      {/* Categorie veicoli — Centralina Pro e\' la sola fonte di verita\'.
          Ogni categoria e\' una card con pill colorato (palette ciclata),
          7 colonne (Nome, Targa, Stato, CV, Anno, Tariffa, Azioni), vista
          mobile a card, bulk select, pulsanti Modifica / Sync / Elimina.
          I veicoli orfani (category id non piu\' in Centralina Pro) finiscono
          nella sezione "Altre / Senza categoria" per restare modificabili. */}
      {categories.length === 0 && (
        <div className="rounded-lg border border-dashed border-theme-border bg-theme-bg-secondary p-8 text-center">
          <p className="text-sm font-semibold text-theme-text-primary">Nessuna categoria configurata</p>
          <p className="text-xs text-theme-text-muted mt-1">
            Vai in <span className="font-medium">Centralina Pro &rsaquo; Categorie &amp; Fascia</span> per crearle.
            Senza categorie i veicoli non possono essere catalogati.
          </p>
        </div>
      )}
      {allSections.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {allSections.map(section => (
            <div key={section.category.id} className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
              <div className={`${section.palette.wrapBg} px-4 py-3 border-b border-theme-border`}>
                <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
                  <span className={`px-3 py-1 ${section.palette.pillBg} ${section.palette.pillText} rounded text-sm`}>
                    {section.category.label}
                  </span>
                  <span className="text-sm text-theme-text-muted">({section.vehicles.length} veicoli)</span>
                </h3>
              </div>
              {/* Mobile Card View */}
              <div className="lg:hidden divide-y divide-theme-border">
                {section.vehicles.map((vehicle) => (
                  <div key={vehicle.id} className={`p-3 ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/20' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {multiSelectMode && (
                          <input
                            type="checkbox"
                            checked={selectedVehicles.has(vehicle.id)}
                            onChange={() => toggleVehicleSelection(vehicle.id)}
                            className="w-5 h-5 flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</div>
                          <div className="text-xs text-theme-text-muted">
                            {vehicle.plate || '-'}
                            {(vehicle.metadata as { cv?: number } | null)?.cv && <span className="ml-2">{(vehicle.metadata as { cv?: number }).cv} CV</span>}
                            {(vehicle.metadata as { model_year?: number } | null)?.model_year && <span className="ml-2">{(vehicle.metadata as { model_year?: number }).model_year}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-medium text-theme-text-primary">€{vehicle.daily_rate}</div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium inline-block mt-1 ${vehicle.status === 'available' ? 'bg-green-900 text-green-200' :
                          vehicle.status === 'unavailable' ? 'bg-red-900 text-red-200' :
                            vehicle.status === 'rented' ? 'bg-blue-900 text-blue-200' :
                              vehicle.status === 'maintenance' ? 'bg-yellow-900 text-yellow-200' :
                                'bg-theme-bg-tertiary text-theme-text-secondary'
                        }`}>
                          {vehicle.status === 'available' ? 'Disponibile' :
                            vehicle.status === 'unavailable' ? 'Non Disp.' :
                              vehicle.status === 'rented' ? 'Noleggiato' :
                                vehicle.status === 'maintenance' ? 'Manut.' : 'Ritirato'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button onClick={() => handleEdit(vehicle)} variant="secondary" className="text-xs py-2 px-3 flex-1">Modifica</Button>
                      <Button onClick={() => syncToGoogleCalendar(vehicle)} variant="secondary" className="text-xs py-2 px-3 bg-blue-900 hover:bg-blue-800">Sync</Button>
                      <Button onClick={() => handleDelete(vehicle.id)} variant="secondary" className="text-xs py-2 px-3 bg-red-900 hover:bg-red-800">×</Button>
                    </div>
                  </div>
                ))}
                {section.vehicles.length === 0 && (
                  <div className="p-8 text-center text-theme-text-muted">
                    Nessun veicolo in {section.category.label}
                  </div>
                )}
              </div>
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr>
                      {multiSelectMode && (
                        <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary w-10">
                          <input
                            type="checkbox"
                            checked={section.vehicles.length > 0 && section.vehicles.every(v => selectedVehicles.has(v.id))}
                            onChange={() => toggleSelectCategory(section.vehicles)}
                            className="w-4 h-4 rounded-full border-theme-border-light bg-theme-bg-tertiary text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                      )}
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">CV</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Anno</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tariffa</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.vehicles.map((vehicle) => (
                      <tr key={vehicle.id} className={`border-t border-theme-border hover:bg-theme-bg-tertiary ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/20 hover:bg-blue-900/30' : ''}`}>
                        {multiSelectMode && (
                          <td className="px-4 py-3 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedVehicles.has(vehicle.id)}
                              onChange={() => toggleVehicleSelection(vehicle.id)}
                              className="w-4 h-4 rounded-full border-theme-border-light bg-theme-bg-tertiary text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm text-theme-text-primary font-semibold">{vehicle.display_name}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-primary">{vehicle.plate || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${vehicle.status === 'available' ? 'bg-green-900 text-green-200' :
                            vehicle.status === 'unavailable' ? 'bg-red-900 text-red-200' :
                              vehicle.status === 'rented' ? 'bg-blue-900 text-blue-200' :
                                vehicle.status === 'maintenance' ? 'bg-yellow-900 text-yellow-200' :
                                  'bg-theme-bg-tertiary text-theme-text-secondary'
                            }`}>
                            {vehicle.status === 'available' ? 'Disponibile' :
                              vehicle.status === 'unavailable' ? 'Non Disponibile' :
                                vehicle.status === 'rented' ? 'Noleggiato' :
                                  vehicle.status === 'maintenance' ? 'Manutenzione' : 'Ritirato'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-primary">{(vehicle.metadata as { cv?: number } | null)?.cv || '-'}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-primary">{(vehicle.metadata as { model_year?: number } | null)?.model_year || '-'}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-primary">€{vehicle.daily_rate}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex gap-2">
                            <Button onClick={() => handleEdit(vehicle)} variant="secondary" className="text-xs py-1 px-3">Modifica</Button>
                            <Button onClick={() => syncToGoogleCalendar(vehicle)} variant="secondary" className="text-xs py-2 px-3 bg-blue-900 hover:bg-blue-800" title="Sincronizza con Google Calendar">📅 Sync</Button>
                            <Button onClick={() => handleDelete(vehicle.id)} variant="secondary" className="text-xs py-2 px-3 bg-red-900 hover:bg-red-800">×</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {section.vehicles.length === 0 && (
                      <tr>
                        <td colSpan={multiSelectMode ? 8 : 7} className="px-4 py-8 text-center text-theme-text-muted">
                          Nessun veicolo in {section.category.label}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
