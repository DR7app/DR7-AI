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

// La foto del veicolo puo\' essere salvata in piu\' posti a seconda di chi
// l'ha caricata (form admin, import precedente, edit dal sito). Provo tutti
// i campi noti in ordine di probabilita\'. Senza questa funzione i veicoli
// con foto in `image_url` o `metadata.image_url` apparivano col placeholder.
function pickVehicleImage(v: Vehicle): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (v.metadata as any) || {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = v as any
  const candidates = [
    m.image,
    m.image_url,
    m.hero_image,
    m.photo,
    m.picture,
    direct.image_url,
    direct.image,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return undefined
}

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

  // Filtri tabella unificata: gruppo (categoria) + stato veicolo.
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set())

  // Numero di scadenze in scadenza nei prossimi 30g (per alert intelligenti).
  // Dato reale dalla tabella `scadenze`. Aggiornato a ogni mount.
  const [scadenzeInScadenza, setScadenzeInScadenza] = useState<number>(0)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const now = new Date()
      const in30 = new Date(now.getTime() + 30 * 86400000)
      const { count } = await supabase
        .from('scadenze')
        .select('id', { count: 'exact', head: true })
        .lte('expiry_date', in30.toISOString().slice(0, 10))
        .gte('expiry_date', now.toISOString().slice(0, 10))
      if (!cancelled && typeof count === 'number') setScadenzeInScadenza(count)
    })().catch(() => { /* tabella opzionale, ignora errori */ })
    return () => { cancelled = true }
  }, [])

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

  // Aggregati flotta del MESE CORRENTE (1->oggi). Schema identico a
  // /monthly-report (Report Noleggio): price_total in cent / vehicle_plate
  // / status filter. Nessun gate payment_status: e\' ricavo maturato.
  type VehStats = { fatturato: number; giorniNoleggio: number; giorniFermo: number; utilizzoPct: number }
  const [vehicleStats, setVehicleStats] = useState<Map<string, VehStats>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadBookingStats = async () => {
    if (vehicles.length === 0) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    // Mese corrente: 1 del mese 00:00 -> oggi. Reset automatico al cambio mese.
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const daysElapsed = Math.max(1, Math.round((today.getTime() - monthStart.getTime()) / 86400000) + 1)
    const STATI_NOLEGGIO_REPORT = ['confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending', 'Confirmed', 'Completed', 'Active']
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, vehicle_id, vehicle_plate, vehicle_name, pickup_date, dropoff_date, price_total, status, payment_status, service_type')
      // pickup oltre fine mese e\' escluso (non e\' ancora questo mese);
      // pickup prima del mese ma con dropoff nel mese viene catturato perche\'
      // l'overlap calcolato sotto include i giorni clamp-ati al mese.
      .gte('pickup_date', new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString())
      .in('status', STATI_NOLEGGIO_REPORT)
      .or('service_type.is.null,service_type.eq.car_rental,service_type.eq.rental')
      .limit(2000)
    const stats = new Map<string, VehStats>()
    const byId = new Map<string, Vehicle>()
    const byPlate = new Map<string, Vehicle>()
    const byName = new Map<string, Vehicle>()
    for (const v of vehicles) {
      byId.set(v.id, v)
      if (v.plate) byPlate.set(v.plate.toLowerCase().replace(/\s/g, ''), v)
      if (v.display_name) byName.set(v.display_name.toLowerCase().trim(), v)
    }
    const occupied = new Map<string, Set<string>>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of ((bookings || []) as any[])) {
      let vid: string | null = null
      if (b.vehicle_id && byId.has(b.vehicle_id)) vid = b.vehicle_id
      else if (b.vehicle_plate) {
        const v = byPlate.get(String(b.vehicle_plate).toLowerCase().replace(/\s/g, ''))
        if (v) vid = v.id
      }
      if (!vid && b.vehicle_name) {
        const v = byName.get(String(b.vehicle_name).toLowerCase().trim())
        if (v) vid = v.id
      }
      if (!vid) continue
      // Overlap del booking col mese corrente + PRORAZIONE come monthly-report:
      //   rev_month = (price_total/100 / total_booking_days) * overlap_days
      // Senza proration, un noleggio €1000 da 10 giorni a cavallo del mese
      // contava interamente nel mese in cui pickup_date cadeva, gonfiando
      // il fatturato vs Report Noleggio.
      let overlapDays = 0
      if (b.pickup_date && b.dropoff_date) {
        const s = new Date(b.pickup_date); s.setHours(0, 0, 0, 0)
        const e = new Date(b.dropoff_date); e.setHours(0, 0, 0, 0)
        if (e < monthStart || s > today) continue
        const sC = s < monthStart ? monthStart : s
        const eC = e > today ? today : e
        const set = occupied.get(vid) || new Set<string>()
        for (let t = sC.getTime(); t <= eC.getTime(); t += 86400000) set.add(new Date(t).toISOString().slice(0, 10))
        occupied.set(vid, set)
        overlapDays = Math.round((eC.getTime() - sC.getTime()) / 86400000) + 1
      } else if (b.pickup_date) {
        // Senza dropoff: considera 1 giorno se pickup nel mese, altrimenti skip.
        const s = new Date(b.pickup_date); s.setHours(0, 0, 0, 0)
        if (s < monthStart || s > today) continue
        overlapDays = 1
      } else continue
      const cur = stats.get(vid) || { fatturato: 0, giorniNoleggio: 0, giorniFermo: 0, utilizzoPct: 0 }
      const raw = b.price_total
      const fullEur = (typeof raw === 'string' ? parseFloat(raw) : (raw || 0)) / 100
      if (Number.isFinite(fullEur) && fullEur > 0) {
        // Total booking days = pickup -> dropoff inclusive, min 1.
        let totalBookingDays = 1
        if (b.pickup_date && b.dropoff_date) {
          const ps = new Date(b.pickup_date); ps.setHours(0, 0, 0, 0)
          const pe = new Date(b.dropoff_date); pe.setHours(0, 0, 0, 0)
          totalBookingDays = Math.max(1, Math.round((pe.getTime() - ps.getTime()) / 86400000) + 1)
        }
        cur.fatturato += (fullEur / totalBookingDays) * overlapDays
      }
      stats.set(vid, cur)
    }
    for (const [vid, set] of occupied.entries()) {
      const cur = stats.get(vid) || { fatturato: 0, giorniNoleggio: 0, giorniFermo: 0, utilizzoPct: 0 }
      cur.giorniNoleggio = set.size
      cur.giorniFermo = Math.max(0, daysElapsed - set.size)
      cur.utilizzoPct = Math.min(100, Math.round((set.size / daysElapsed) * 100))
      stats.set(vid, cur)
    }
    setVehicleStats(stats)
  }
  useEffect(() => { loadBookingStats() }, [vehicles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Giorni trascorsi nel mese corrente (1..today). Usato per ROI/utilizzo.
  const daysElapsedThisMonth = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return t.getDate()
  }, [])

  // Etichetta mese corrente per i sub-label delle KPI.
  const currentMonthLabel = useMemo(() => {
    const t = new Date()
    return t.toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
  }, [])

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
      const potential = (v?.daily_rate || 0) * daysElapsedThisMonth
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
      {/* KPI strip — 6 metriche flotta, dati reali da vehicles + bookings 30g.
          Stile mockup: icona a sinistra, valore grande, sub-label muted.       */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        {(() => {
          const total = fleetKpi.total
          const pct = (n: number) => total > 0 ? `${Math.round((n / total) * 100)}% della flotta` : '—'
          const cards = [
            { label: 'TOTALE VEICOLI', value: String(total), sub: '100% della flotta', tone: '#3B82F6', icon: 'car' },
            { label: 'VEICOLI ATTIVI', value: String(fleetKpi.attivi), sub: pct(fleetKpi.attivi), tone: '#10B981', icon: 'check' },
            { label: 'VEICOLI FERMI', value: String(fleetKpi.fermi), sub: pct(fleetKpi.fermi), tone: '#EF4444', icon: 'wrench' },
            { label: 'FATTURATO FLOTTA', value: `€${fleetKpi.totalFatturato.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`, sub: currentMonthLabel, tone: '#F59E0B', icon: 'euro' },
            { label: 'UTILIZZO MEDIO', value: `${fleetKpi.utilizzoMedio}%`, sub: 'media veicolare', tone: '#06B6D4', icon: 'chart' },
            { label: 'ROI MEDIO FLOTTA', value: `${String(fleetKpi.roiMedio).replace('.', ',')}%`, sub: 'fatturato/potenziale', tone: '#A855F7', icon: 'trend' },
          ]
          const renderIcon = (name: string, tone: string) => {
            const common = { className: 'w-5 h-5', fill: 'none', stroke: tone, viewBox: '0 0 24 24', strokeWidth: 2 } as const
            switch (name) {
              case 'car': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13l1-4a2 2 0 012-1.5h12a2 2 0 012 1.5l1 4M5 17a2 2 0 100-4 2 2 0 000 4zm14 0a2 2 0 100-4 2 2 0 000 4zM3 13h18v3a1 1 0 01-1 1h-1m-14 0H4a1 1 0 01-1-1v-3z"/></svg>
              case 'check': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              case 'wrench': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4.5 4.5 0 005.7 5.7l-9.7 9.7a2.4 2.4 0 11-3.4-3.4l9.7-9.7-2.3-2.3 3-3 2.3 2.3-5.3 5.3-1.4-1.4z"/></svg>
              case 'euro': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M15 9a4 4 0 100 6m-7-3h7m-7-3h7"/></svg>
              case 'chart': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V9m4 10V5m4 14v-7M5 19h14"/></svg>
              case 'trend': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8m0 0v6m0-6h-6"/></svg>
              default: return null
            }
          }
          return cards.map(k => (
            <div key={k.label} className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary px-3 py-3" style={{ borderColor: `${k.tone}30` }}>
              <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${k.tone}1f` }}/>
              <div className="relative flex items-start gap-2.5">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${k.tone}22` }}>
                  {renderIcon(k.icon, k.tone)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wider font-semibold leading-tight" style={{ color: `${k.tone}cc` }}>{k.label}</div>
                  <div className="text-xl lg:text-2xl font-bold text-theme-text-primary mt-0.5 tabular-nums leading-none">{k.value}</div>
                  <div className="text-[10px] text-theme-text-muted mt-1">{k.sub}</div>
                </div>
              </div>
            </div>
          ))
        })()}
      </div>

      {/* Alert intelligenti — solo segnali reali (no mock). Tono colore e
          dot match mockup: rosso=fermi>3gg, ambra=sotto target utilizzo,
          arancio=scadenze nei prossimi 30g. Nessun avviso => non renderizza. */}
      {(() => {
        const alerts: { tone: 'red' | 'amber' | 'orange'; text: string }[] = []
        if (fleetKpi.fermiOltre3 > 0) alerts.push({ tone: 'red', text: `${fleetKpi.fermiOltre3} ${fleetKpi.fermiOltre3 === 1 ? 'veicolo fermo' : 'veicoli fermi'} da oltre 3 giorni` })
        if (fleetKpi.sottoTarget > 0) alerts.push({ tone: 'amber', text: `${fleetKpi.sottoTarget} ${fleetKpi.sottoTarget === 1 ? 'veicolo sotto' : 'veicoli sotto'} il target di utilizzo` })
        if (scadenzeInScadenza > 0) alerts.push({ tone: 'orange', text: `${scadenzeInScadenza} ${scadenzeInScadenza === 1 ? 'scadenza' : 'scadenze'} nei prossimi 30 giorni` })
        if (alerts.length === 0) return null
        const dot = { red: 'bg-red-500', amber: 'bg-amber-500', orange: 'bg-orange-500' }
        return (
          <div className="bg-gradient-to-r from-red-500/10 via-amber-500/8 to-transparent border border-red-500/30 rounded-2xl px-4 py-3 mb-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <span className="text-sm font-bold text-red-400">ALERT INTELLIGENTI!</span>
              <span className="text-[11px] text-theme-text-muted">{alerts.length} {alerts.length === 1 ? 'avviso attivo' : 'avvisi attivi'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 bg-theme-bg-primary/50 border border-theme-border/60 rounded-full px-3 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${dot[a.tone]}`}/>
                  <span className="text-[11px] text-theme-text-primary">{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Header (mockup style) — titolo Gestione Flotta + sottotitolo.
          Selezione Multipla resta accessibile, "+ Nuovo Veicolo" si sposta
          nella filter row qui sotto come da mockup.                        */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Flotta</h2>
          <p className="text-sm text-theme-text-muted mt-0.5">Panoramica completa della tua flotta aziendale</p>
        </div>
        {multiSelectMode && (
          <Button
            onClick={() => { setMultiSelectMode(false); setSelectedVehicles(new Set()) }}
            variant="secondary"
            className="text-xs"
          >
            Annulla Selezione
          </Button>
        )}
      </div>

      {/* Filter row — search + 3 dropdowns + Filtri + Nuovo Veicolo (mockup) */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            placeholder="Cerca per targa, nome o modello..."
            value={plateSearch}
            onChange={(e) => setPlateSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-sm text-theme-text-primary placeholder-theme-text-muted"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="bg-theme-bg-tertiary border border-theme-border rounded-full px-3 py-2 text-sm text-theme-text-primary"
        >
          <option value="all">Tutti i gruppi</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          {/* "Senza categoria" appare solo se ci sono veicoli orfani: i loro
              category id non esistono piu\' in Centralina Pro. Si calcola
              al volo, identico a `orphanVehicles` piu\' in basso.            */}
          {vehicles.some(v => !v.category || !categories.some(c => c.id === v.category)) && (
            <option value="__orphan__">Senza categoria</option>
          )}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-theme-bg-tertiary border border-theme-border rounded-full px-3 py-2 text-sm text-theme-text-primary"
        >
          <option value="all">Tutti gli stati</option>
          <option value="available">Disponibile</option>
          <option value="maintenance">Manutenzione</option>
          <option value="unavailable">Non disponibile</option>
        </select>
        <button
          onClick={() => {
            setMultiSelectMode(!multiSelectMode)
            setSelectedVehicles(new Set())
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border ${multiSelectMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-theme-bg-tertiary text-theme-text-primary border-theme-border'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.5L14 13v6l-4 2v-8L3 6.5V4z"/>
          </svg>
          Filtri
        </button>
        <button
          onClick={() => { resetForm(); setEditingId(null); setShowForm(true) }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm bg-cyan-500 hover:bg-cyan-600 text-white font-medium"
        >
          + Nuovo Veicolo
        </button>
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

      {/* Layout unificato (mockup): tabella veicoli a sinistra + sidebar
          analitica a destra. Sostituisce il vecchio grid-3 per categoria.
          Pulsanti azione: solo Modifica e Elimina (Sync Google Calendar
          rimosso — uso del calendario interno).                            */}
      {categories.length === 0 && (
        <div className="rounded-lg border border-dashed border-theme-border bg-theme-bg-secondary p-8 text-center">
          <p className="text-sm font-semibold text-theme-text-primary">Nessuna categoria configurata</p>
          <p className="text-xs text-theme-text-muted mt-1">
            Vai in <span className="font-medium">Centralina Pro &rsaquo; Categorie &amp; Fascia</span> per crearle.
            Senza categorie i veicoli non possono essere catalogati.
          </p>
        </div>
      )}
      {allSections.length > 0 && (() => {
        // Flatten + filtra sezioni in un'unica lista per la tabella.
        type FlatRow = { vehicle: Vehicle; sectionId: string; sectionLabel: string; palette: typeof allSections[number]['palette'] }
        const allFlat: FlatRow[] = allSections.flatMap(s =>
          s.vehicles.map(v => ({ vehicle: v, sectionId: s.category.id, sectionLabel: s.category.label, palette: s.palette }))
        )
        const flatRows = allFlat.filter(r => {
          if (groupFilter !== 'all' && r.sectionId !== groupFilter) return false
          if (statusFilter !== 'all' && r.vehicle.status !== statusFilter) return false
          return true
        })

        // Distribuzione per gruppo — donut data.
        const groupCounts = allSections.map(s => ({ label: s.category.label, count: s.vehicles.length, palette: s.palette }))
        const groupTotal = groupCounts.reduce((acc, g) => acc + g.count, 0)

        // Top 5 per fatturato (30g, dati reali).
        const topByFatturato = [...allFlat]
          .map(r => ({ ...r, fatturato: vehicleStats.get(r.vehicle.id)?.fatturato || 0 }))
          .sort((a, b) => b.fatturato - a.fatturato)
          .slice(0, 5)

        // Performance flotta.
        const kmTotali = vehicles.reduce((acc, v) => acc + (Number((v as Vehicle & { current_km?: number }).current_km) || 0), 0)
        const mediaKm = vehicles.length > 0 ? Math.round(kmTotali / vehicles.length) : 0
        const giorniFermiTotali = Array.from(vehicleStats.values()).reduce((acc, s) => acc + s.giorniFermo, 0)

        // Donut SVG geometry.
        const R = 36; const C = 2 * Math.PI * R
        let offset = 0

        // ROI per riga — usa lo stesso calcolo del fleetKpi.
        const roiOf = (v: Vehicle) => {
          const s = vehicleStats.get(v.id)
          const potential = ((v as Vehicle & { daily_rate?: number }).daily_rate || 0) * 30
          if (!s || potential <= 0) return 0
          return Math.round((s.fatturato / potential) * 1000) / 10
        }
        const stateOf = (v: Vehicle) => {
          const s = vehicleStats.get(v.id)
          if (v.status === 'maintenance' || v.status === 'unavailable') return { label: 'Fermo', dot: 'bg-red-500', text: 'text-red-400' }
          if (s && s.giorniFermo >= 3 && s.utilizzoPct < 40) return { label: 'Attenzione', dot: 'bg-amber-500', text: 'text-amber-400' }
          return { label: 'Attivo', dot: 'bg-emerald-500', text: 'text-emerald-400' }
        }

        return (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* TABELLA — col-span-9 */}
            <div className="xl:col-span-9 bg-theme-bg-secondary rounded-2xl border border-theme-border overflow-hidden">
              {/* Mobile cards (sotto xl) */}
              <div className="xl:hidden divide-y divide-theme-border">
                {flatRows.length === 0 && (
                  <div className="p-8 text-center text-theme-text-muted text-sm">Nessun veicolo trovato</div>
                )}
                {flatRows.map(({ vehicle, sectionLabel, palette }) => {
                  const stats = vehicleStats.get(vehicle.id)
                  const img = pickVehicleImage(vehicle)
                  const st = stateOf(vehicle)
                  const km = Number((vehicle as Vehicle & { current_km?: number }).current_km) || 0
                  const roi = roiOf(vehicle)
                  return (
                    <div key={vehicle.id} className={`p-3 ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/20' : ''}`}>
                      <div className="flex items-start gap-3">
                        {multiSelectMode && (
                          <input type="checkbox" checked={selectedVehicles.has(vehicle.id)} onChange={() => toggleVehicleSelection(vehicle.id)} className="w-5 h-5 mt-1 flex-shrink-0"/>
                        )}
                        <div className="w-14 h-10 rounded-md bg-theme-bg-tertiary overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {img ? <img src={img} alt={vehicle.display_name} className="w-full h-full object-cover"/> : <svg className="w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13l1-4a2 2 0 012-1.5h12a2 2 0 012 1.5l1 4M5 17a2 2 0 100-4 2 2 0 000 4zm14 0a2 2 0 100-4 2 2 0 000 4z"/></svg>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`px-2 py-0.5 ${palette.pillBg} ${palette.pillText} rounded text-[10px] font-medium`}>{sectionLabel}</span>
                            <span className="text-[11px] text-theme-text-muted font-mono">{vehicle.plate || '—'}</span>
                            <span className="text-[11px] text-theme-text-muted">{km.toLocaleString('it-IT')} km</span>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs">
                            <span className={`inline-flex items-center gap-1 ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}</span>
                            <span className="text-theme-text-muted">Utilizzo <span className="text-theme-text-primary font-semibold">{stats?.utilizzoPct ?? 0}%</span></span>
                            <span className="text-theme-text-muted">ROI <span className="text-theme-text-primary font-semibold">{String(roi).replace('.', ',')}%</span></span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <button onClick={() => handleEdit(vehicle)} className="text-xs px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white">Modifica</button>
                            <button onClick={() => handleDelete(vehicle.id)} className="text-xs px-3 py-1.5 rounded-full bg-red-700 hover:bg-red-600 text-white">Elimina</button>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold text-theme-text-primary tabular-nums">€{(stats?.fatturato || 0).toLocaleString('it-IT', { maximumFractionDigits: 0 })}</div>
                          <div className="text-[10px] text-theme-text-muted">mese</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop table (xl+) */}
              <div className="hidden xl:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-theme-text-muted border-b border-theme-border">
                      {multiSelectMode && (
                        <th className="px-3 py-3 text-left w-8">
                          <input
                            type="checkbox"
                            checked={flatRows.length > 0 && flatRows.every(r => selectedVehicles.has(r.vehicle.id))}
                            onChange={() => toggleSelectCategory(flatRows.map(r => r.vehicle))}
                            className="w-4 h-4 rounded border-theme-border-light"
                          />
                        </th>
                      )}
                      <th className="px-3 py-3 text-left font-semibold">Veicolo</th>
                      <th className="px-3 py-3 text-left font-semibold">Gruppo</th>
                      <th className="px-3 py-3 text-left font-semibold">Targa</th>
                      <th className="px-3 py-3 text-right font-semibold">Km Attuali</th>
                      <th className="px-3 py-3 text-left font-semibold">Stato</th>
                      <th className="px-3 py-3 text-left font-semibold">Utilizzo</th>
                      <th className="px-3 py-3 text-right font-semibold">Fatturato</th>
                      <th className="px-3 py-3 text-right font-semibold">Giorni Fermo</th>
                      <th className="px-3 py-3 text-right font-semibold">ROI</th>
                      <th className="px-3 py-3 text-left font-semibold">Disponibilita\'</th>
                      <th className="px-3 py-3 text-center font-semibold">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.length === 0 && (
                      <tr>
                        <td colSpan={multiSelectMode ? 12 : 11} className="px-3 py-12 text-center text-theme-text-muted text-sm">
                          Nessun veicolo trovato con i filtri selezionati
                        </td>
                      </tr>
                    )}
                    {flatRows.map(({ vehicle, sectionLabel, palette }) => {
                      const stats = vehicleStats.get(vehicle.id)
                      const utilizzo = stats?.utilizzoPct ?? 0
                      const fatt = stats?.fatturato || 0
                      const fermi = stats?.giorniFermo ?? 0
                      const roi = roiOf(vehicle)
                      const km = Number((vehicle as Vehicle & { current_km?: number }).current_km) || 0
                      const img = pickVehicleImage(vehicle)
                      const st = stateOf(vehicle)
                      const dispLabel = vehicle.status === 'available' ? 'Disponibile' : vehicle.status === 'unavailable' ? 'Non disponibile' : vehicle.status === 'rented' ? 'Noleggiato' : vehicle.status === 'maintenance' ? 'Manutenzione' : '—'
                      const dispClass = vehicle.status === 'available' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : vehicle.status === 'rented' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'
                      const utilBar = utilizzo >= 70 ? 'bg-emerald-500' : utilizzo >= 40 ? 'bg-amber-500' : 'bg-red-500'
                      return (
                        <tr key={vehicle.id} className={`border-t border-theme-border hover:bg-theme-bg-tertiary/40 ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/15' : ''}`}>
                          {multiSelectMode && (
                            <td className="px-3 py-2.5">
                              <input type="checkbox" checked={selectedVehicles.has(vehicle.id)} onChange={() => toggleVehicleSelection(vehicle.id)} className="w-4 h-4 rounded border-theme-border-light"/>
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-12 h-9 rounded-md bg-theme-bg-tertiary overflow-hidden flex-shrink-0 flex items-center justify-center">
                                {img ? (
                                  <img src={img} alt={vehicle.display_name} className="w-full h-full object-cover"/>
                                ) : (
                                  <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13l1-4a2 2 0 012-1.5h12a2 2 0 012 1.5l1 4M5 17a2 2 0 100-4 2 2 0 000 4zm14 0a2 2 0 100-4 2 2 0 000 4z"/>
                                  </svg>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</div>
                                <div className="text-[10px] text-theme-text-muted">
                                  {(vehicle.metadata as { cv?: number } | null)?.cv && <span>{(vehicle.metadata as { cv?: number }).cv} CV</span>}
                                  {(vehicle.metadata as { model_year?: number } | null)?.model_year && <span>{(vehicle.metadata as { cv?: number } | null)?.cv ? ' · ' : ''}{(vehicle.metadata as { model_year?: number }).model_year}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 ${palette.pillBg} ${palette.pillText} rounded text-[10px] font-medium uppercase tracking-wider`}>{sectionLabel}</span>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-mono text-theme-text-primary tabular-nums">{vehicle.plate || '—'}</td>
                          <td className="px-3 py-2.5 text-xs text-theme-text-primary tabular-nums text-right">{km.toLocaleString('it-IT')} km</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${st.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-[110px]">
                              <div className="w-16 h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden">
                                <div className={`h-full ${utilBar}`} style={{ width: `${Math.min(100, utilizzo)}%` }}/>
                              </div>
                              <span className="text-xs text-theme-text-primary font-semibold tabular-nums">{utilizzo}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-sm text-theme-text-primary tabular-nums text-right">€{fatt.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</td>
                          <td className="px-3 py-2.5 text-sm text-theme-text-primary tabular-nums text-right">{fermi}</td>
                          <td className="px-3 py-2.5 text-sm tabular-nums text-right">
                            <span className={roi >= 0 ? 'text-emerald-400' : 'text-red-400'}>{roi >= 0 ? '▲' : '▼'} {String(Math.abs(roi)).replace('.', ',')}%</span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${dispClass}`}>{dispLabel}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex justify-center gap-1.5">
                              <button onClick={() => handleEdit(vehicle)} className="px-2.5 py-1 text-[11px] rounded-md bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/30">Modifica</button>
                              <button onClick={() => handleDelete(vehicle.id)} className="px-2.5 py-1 text-[11px] rounded-md bg-red-600/15 hover:bg-red-600/25 text-red-400 border border-red-500/30">×</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-theme-border text-[11px] text-theme-text-muted flex items-center justify-between">
                <span>Mostra <span className="text-theme-text-primary">{flatRows.length}</span> di <span className="text-theme-text-primary">{allFlat.length}</span> veicoli</span>
                {orphanSection && orphanSection.vehicles.length > 0 && (
                  <span>{orphanSection.vehicles.length} senza categoria</span>
                )}
              </div>
            </div>

            {/* SIDEBAR — col-span-3 */}
            <div className="xl:col-span-3 space-y-4">
              {/* Distribuzione per gruppo */}
              <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-4">
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-3">Distribuzione per Gruppo</div>
                {groupTotal > 0 ? (
                  <div className="flex items-center gap-4">
                    <svg width="96" height="96" viewBox="0 0 96 96" className="flex-shrink-0">
                      <circle cx="48" cy="48" r={R} fill="none" stroke="var(--color-bg-tertiary, #1f2937)" strokeWidth="14"/>
                      {groupCounts.map((g, idx) => {
                        const len = (g.count / groupTotal) * C
                        const dashArray = `${len} ${C - len}`
                        const dashOffset = -offset
                        offset += len
                        const stroke = g.palette.dotHex || '#60a5fa'
                        return <circle key={idx} cx="48" cy="48" r={R} fill="none" stroke={stroke} strokeWidth="14" strokeDasharray={dashArray} strokeDashoffset={dashOffset} transform="rotate(-90 48 48)"/>
                      })}
                      <text x="48" y="45" textAnchor="middle" className="fill-current text-theme-text-primary" style={{ fontSize: 14, fontWeight: 700 }}>{groupTotal}</text>
                      <text x="48" y="60" textAnchor="middle" className="fill-current text-theme-text-muted" style={{ fontSize: 9 }}>veicoli</text>
                    </svg>
                    <div className="flex-1 min-w-0 space-y-1">
                      {groupCounts.map(g => (
                        <div key={g.label} className="flex items-center gap-1.5 text-[11px]">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.palette.dotHex || '#60a5fa' }}/>
                          <span className="text-theme-text-primary truncate flex-1">{g.label}</span>
                          <span className="text-theme-text-muted tabular-nums">{g.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-theme-text-muted text-center py-3">Nessun veicolo</div>
                )}
              </div>

              {/* Top per fatturato */}
              <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-4">
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-3">Top per Fatturato (mese)</div>
                <div className="space-y-2">
                  {topByFatturato.filter(r => r.fatturato > 0).length === 0 ? (
                    <div className="text-xs text-theme-text-muted text-center py-2">Nessun fatturato nel mese corrente</div>
                  ) : topByFatturato.filter(r => r.fatturato > 0).map((r, i) => (
                    <div key={r.vehicle.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-theme-text-muted font-mono w-3 flex-shrink-0">{i + 1}</span>
                      <span className={`w-1.5 h-6 rounded-full flex-shrink-0`} style={{ background: r.palette.dotHex || '#60a5fa' }}/>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-theme-text-primary truncate">{r.vehicle.display_name}</div>
                        <div className="text-[10px] text-theme-text-muted truncate">{r.sectionLabel}</div>
                      </div>
                      <span className="text-xs font-bold text-theme-text-primary tabular-nums">€{r.fatturato.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Performance flotta */}
              <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-4">
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-3">Performance Flotta</div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-theme-text-muted">Km totali percorsi</span>
                    <span className="text-xs font-bold text-theme-text-primary tabular-nums">{kmTotali.toLocaleString('it-IT')} km</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-theme-text-muted">Media km per veicolo</span>
                    <span className="text-xs font-bold text-theme-text-primary tabular-nums">{mediaKm.toLocaleString('it-IT')} km</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-theme-text-muted">Giorni totali fermi (mese)</span>
                    <span className="text-xs font-bold text-theme-text-primary tabular-nums">{giorniFermiTotali} giorni</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-theme-text-muted">Utilizzo medio flotta</span>
                    <span className="text-xs font-bold text-theme-text-primary tabular-nums">{fleetKpi.utilizzoMedio}%</span>
                  </div>
                </div>
              </div>

              {/* Suggerimenti smart — solo se ha senso renderizzare */}
              {fleetKpi.sottoTarget > 0 && (
                <div className="bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent border border-cyan-500/30 rounded-2xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                    <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">Suggerimenti Smart</span>
                  </div>
                  <p className="text-[11px] text-theme-text-primary leading-relaxed mb-3">
                    {fleetKpi.sottoTarget} {fleetKpi.sottoTarget === 1 ? 'veicolo ha' : 'veicoli hanno'} un utilizzo basso.
                    Considera promozioni mirate o riallocazione.
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
