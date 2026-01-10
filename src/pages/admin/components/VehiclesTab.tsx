import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import EuropeanDateInput from '../../../components/EuropeanDateInput'

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  status: 'available' | 'unavailable' | 'rented' | 'maintenance' | 'retired'
  daily_rate: number
  category: 'exotic' | 'urban' | 'aziendali' | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export default function VehiclesTab() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // const [selectedCategory, setSelectedCategory] = useState<'all' | 'exotic' | 'urban'>('all')
  // const [selectedVehicle, setSelectedVehicle] = useState<string>('all')
  const [adjustmentPercentage, setAdjustmentPercentage] = useState<string>('10')
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<string>('all')

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set())

  const [formData, setFormData] = useState({
    display_name: '',
    plate: '',
    status: 'available',
    daily_rate: '0',
    category: 'exotic',
    unavailable_from: '',
    unavailable_until: '',
    unavailable_from_time: '',
    unavailable_until_time: '',
    unavailable_reason: ''
  })

  useEffect(() => {
    loadVehicles()
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
      const dataToSave = {
        display_name: formData.display_name,
        plate: formData.plate || null,
        status: formData.status,
        daily_rate: parseFloat(formData.daily_rate),
        category: formData.category,
        metadata: {
          unavailable_from: formData.unavailable_from || null,
          unavailable_until: formData.unavailable_until || null,
          unavailable_from_time: formData.unavailable_from_time || null,
          unavailable_until_time: formData.unavailable_until_time || null,
          unavailable_reason: formData.unavailable_reason || null
        }
      }

      if (editingId) {
        const { data, error } = await supabase
          .from('vehicles')
          .update(dataToSave)
          .eq('id', editingId)
          .select()

        if (error) throw error
        console.log('Vehicle updated:', data)
      } else {
        const { data, error } = await supabase
          .from('vehicles')
          .insert([dataToSave])
          .select()

        if (error) throw error
        console.log('Vehicle created:', data)
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
            alert('⚠️ Veicolo salvato ma calendario non sincronizzato. Verifica le credenziali Google Calendar.');
          } else {
            console.log('Calendar event created successfully');
            alert('✅ Veicolo salvato e calendario aggiornato!');
          }
        } catch (calendarError) {
          console.error('Error syncing with calendar:', calendarError);
          alert('⚠️ Veicolo salvato ma errore nella sincronizzazione del calendario.');
        }
      } else {
        alert('✅ Veicolo salvato!');
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadVehicles()
    } catch (error: any) {
      console.error('Failed to save vehicle:', error)
      alert('Impossibile salvare il veicolo: ' + (error.message || JSON.stringify(error)))
    }
  }

  async function deleteVehicleLogic(id: string, vehicleName: string) {
    console.log(`Starting deletion for vehicle: ${vehicleName} (ID: ${id})`)

    // Delete from reservations
    console.log('  Deleting reservations...')
    const { data: deletedReservations, error: resError } = await supabase
      .from('reservations')
      .delete()
      .eq('vehicle_id', id)
      .select()

    if (resError) {
      console.error('  Error deleting reservations:', resError)
      throw new Error(`Failed to delete reservations: ${resError.message}`)
    }
    console.log(`  Deleted ${deletedReservations?.length || 0} reservations`)

    // Delete from bookings
    // We use vehicle_name because that is what we used to check for dependencies
    console.log('  Deleting bookings...')
    const { data: deletedBookings, error: bookError } = await supabase
      .from('bookings')
      .delete()
      .eq('vehicle_name', vehicleName)
      .select()

    if (bookError) {
      console.error('  Error deleting bookings:', bookError)
      throw new Error(`Failed to delete bookings: ${bookError.message}`)
    }
    console.log(`  Deleted ${deletedBookings?.length || 0} bookings`)

    // Finally, delete the vehicle itself
    console.log('  Deleting vehicle record...')
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

    console.log('  Vehicle deleted successfully')
  }

  async function handleDelete(id: string) {
    const vehicle = vehicles.find(v => v.id === id)
    if (!vehicle) {
      console.error('Vehicle not found in list:', id)
      alert('Errore: Veicolo non trovato')
      return
    }

    if (!confirm('Sei sicuro di voler eliminare questo veicolo?')) return

    try {
      console.log(`Checking dependencies for vehicle: ${vehicle.display_name}`)

      // Check dependencies
      const { count: resCount, error: resCountError } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', id)

      if (resCountError) {
        console.error('Error checking reservations:', resCountError)
        throw new Error(`Failed to check reservations: ${resCountError.message}`)
      }

      const { count: bookCount, error: bookCountError } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_name', vehicle.display_name)

      if (bookCountError) {
        console.error('Error checking bookings:', bookCountError)
        throw new Error(`Failed to check bookings: ${bookCountError.message}`)
      }

      const totalDeps = (resCount || 0) + (bookCount || 0)
      console.log(`  Found ${totalDeps} dependencies (${resCount || 0} reservations, ${bookCount || 0} bookings)`)

      if (totalDeps > 0) {
        if (!confirm(`⚠️ Questo veicolo ha ${totalDeps} prenotazioni associate (storico incluso).\n\nVerranno eliminate TUTTE le prenotazioni associate.\n\nProcedere con l'eliminazione definitiva?`)) {
          console.log('  User cancelled deletion')
          return
        }
      }

      // Attempt deletion
      await deleteVehicleLogic(id, vehicle.display_name)

      console.log('Vehicle deletion completed successfully')
      alert('Veicolo eliminato con successo!')

      // Reload vehicles list
      await loadVehicles()
    } catch (error: any) {
      console.error('Failed to delete vehicle:', error)

      // Provide detailed error message to user
      const errorMessage = error.message || 'Errore sconosciuto'
      alert(`❌ Impossibile eliminare il veicolo:\n\n${errorMessage}\n\nControlla la console del browser (F12) per maggiori dettagli.`)
    }
  }

  async function deleteSelectedVehicles() {
    if (selectedVehicles.size === 0) return

    if (!confirm(`Sei sicuro di voler eliminare ${selectedVehicles.size} veicoli selezionati?`)) return

    // Double confirmation for bulk delete
    if (!confirm(`⚠️ ATTENZIONE: Questa azione eliminerà anche TUTTE le prenotazioni associate a questi ${selectedVehicles.size} veicoli.\n\nSei ASSOLUTAMENTE sicuro?`)) return

    setLoading(true)
    try {
      const vehiclesToDelete = vehicles.filter(v => selectedVehicles.has(v.id))

      for (const vehicle of vehiclesToDelete) {
        try {
          await deleteVehicleLogic(vehicle.id, vehicle.display_name)
        } catch (err) {
          console.error(`Failed to delete vehicle ${vehicle.display_name}:`, err)
          // Continue with others
        }
      }

      alert('✅ Veicoli selezionati eliminati!')
      setSelectedVehicles(new Set())
      setMultiSelectMode(false)
      loadVehicles()
    } catch (error) {
      console.error('Error during bulk delete:', error)
      alert('Errore durante l\'eliminazione multipla')
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
      } else {
        alert('✅ Sincronizzato con Google Calendar!')
      }
    } catch (error) {
      console.error('Error syncing with calendar:', error)
      alert('❌ Errore nella sincronizzazione del calendario.')
    }
  }

  function resetForm() {
    setFormData({
      display_name: '',
      plate: '',
      status: 'available',
      daily_rate: '0',
      category: 'exotic',
      unavailable_from: '',
      unavailable_until: '',
      unavailable_from_time: '',
      unavailable_until_time: '',
      unavailable_reason: ''
    })
  }

  function handleEdit(vehicle: Vehicle) {
    setFormData({
      display_name: vehicle.display_name,
      plate: vehicle.plate || '',
      status: vehicle.status,
      daily_rate: vehicle.daily_rate.toString(),
      category: vehicle.category || 'exotic',
      unavailable_from: (vehicle.metadata as any)?.unavailable_from || '',
      unavailable_until: (vehicle.metadata as any)?.unavailable_until || '',
      unavailable_from_time: (vehicle.metadata as any)?.unavailable_from_time || '',
      unavailable_until_time: (vehicle.metadata as any)?.unavailable_until_time || '',
      unavailable_reason: (vehicle.metadata as any)?.unavailable_reason || ''
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

    const vehicleName = selectedVehicle === 'all' ? 'tutti i veicoli' : vehicles.find(v => v.id === selectedVehicle)?.display_name
    if (!confirm(`Sei sicuro di voler ${increase ? 'aumentare' : 'diminuire'} i prezzi del ${percentage}% per ${vehicleName}?`)) {
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

      alert(`Prezzi ${increase ? 'aumentati' : 'diminuiti'} con successo!`)
    } catch (error) {
      console.error('Failed to adjust prices:', error)
      alert('Errore nell\'aggiornamento dei prezzi')
    } finally {
      setIsAdjusting(false)
    }
  }

  // Separate vehicles by category
  const exoticVehicles = vehicles.filter(v => v.category === 'exotic')
  const urbanVehicles = vehicles.filter(v => v.category === 'urban')
  const aziendaliVehicles = vehicles.filter(v => v.category === 'aziendali')

  const exoticCount = exoticVehicles.length
  const urbanCount = urbanVehicles.length
  const aziendaliCount = aziendaliVehicles.length

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Veicoli</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Exotic Supercars: {exoticCount} | Urban: {urbanCount} | Aziendali: {aziendaliCount} | Totale: {vehicles.length}
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

      {multiSelectMode && selectedVehicles.size > 0 && (
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-full p-4 mb-6 flex items-center justify-between">
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
              Elimina Selezionati
            </Button>
          </div>
        </div>
      )}

      {/* Price Adjustment Section - Compact */}
      <div className="bg-theme-bg-secondary/50 border border-theme-border rounded-full p-4 mb-6">
        <div className="flex items-end gap-3">
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
        <form onSubmit={handleSubmit} className="bg-theme-bg-secondary p-6 rounded-full mb-6 border border-theme-border">
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
              options={[
                { value: 'exotic', label: 'Exotic Supercars' },
                { value: 'urban', label: 'Urban' },
                { value: 'aziendali', label: 'Aziendali' }
              ]}
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

          {/* Date Range for Unavailability */}
          {formData.status === 'unavailable' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-full">
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
              <div className="col-span-2">
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
              <div className="col-span-2">
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

      {/* Three Column Layout: Urban, Exotic, and Aziendali */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Urban Vehicles Column */}
        <div className="bg-theme-bg-secondary rounded-full border border-theme-border overflow-hidden">
          <div className="bg-cyan-900/30 px-4 py-3 border-b border-theme-border">
            <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
              <span className="px-3 py-1 bg-cyan-900 text-cyan-200 rounded text-sm">Urban</span>
              <span className="text-sm text-theme-text-muted">({urbanCount} veicoli)</span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="">
                <tr>
                  {multiSelectMode && (
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary w-10">
                      <input
                        type="checkbox"
                        checked={urbanVehicles.length > 0 && urbanVehicles.every(v => selectedVehicles.has(v.id))}
                        onChange={() => toggleSelectCategory(urbanVehicles)}
                        className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tariffa</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {urbanVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className={`border-t border-theme-border hover:bg-theme-bg-tertiary ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/20 hover:bg-blue-900/30' : ''}`}>
                    {multiSelectMode && (
                      <td className="px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedVehicles.has(vehicle.id)}
                          onChange={() => toggleVehicleSelection(vehicle.id)}
                          className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-blue-600 focus:ring-blue-500"
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
                              'bg-gray-700 text-gray-200'
                        }`}>
                        {vehicle.status === 'available' ? 'Disponibile' :
                          vehicle.status === 'unavailable' ? 'Non Disponibile' :
                            vehicle.status === 'rented' ? 'Noleggiato' :
                              vehicle.status === 'maintenance' ? 'Manutenzione' : 'Ritirato'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">€{vehicle.daily_rate}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleEdit(vehicle)}
                          variant="secondary"
                          className="text-xs py-1 px-3"
                        >
                          Modifica
                        </Button>
                        <Button
                          onClick={() => syncToGoogleCalendar(vehicle)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-blue-900 hover:bg-blue-800"
                          title="Sincronizza con Google Calendar"
                        >
                          📅 Sync
                        </Button>
                        <Button
                          onClick={() => handleDelete(vehicle.id)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-red-900 hover:bg-red-800"
                        >
                          Elimina
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {urbanVehicles.length === 0 && (
                  <tr>
                    <td colSpan={multiSelectMode ? 6 : 5} className="px-4 py-8 text-center text-gray-500">
                      Nessun veicolo Urban trovato
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Exotic Vehicles Column */}
        <div className="bg-theme-bg-secondary rounded-full border border-theme-border overflow-hidden">
          <div className="bg-purple-900/30 px-4 py-3 border-b border-theme-border">
            <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
              <span className="px-3 py-1 bg-purple-900 text-purple-200 rounded text-sm">Exotic Supercars</span>
              <span className="text-sm text-theme-text-muted">({exoticCount} veicoli)</span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="">
                <tr>
                  {multiSelectMode && (
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary w-10">
                      <input
                        type="checkbox"
                        checked={exoticVehicles.length > 0 && exoticVehicles.every(v => selectedVehicles.has(v.id))}
                        onChange={() => toggleSelectCategory(exoticVehicles)}
                        className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tariffa</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {exoticVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className={`border-t border-theme-border hover:bg-theme-bg-tertiary ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/20 hover:bg-blue-900/30' : ''}`}>
                    {multiSelectMode && (
                      <td className="px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedVehicles.has(vehicle.id)}
                          onChange={() => toggleVehicleSelection(vehicle.id)}
                          className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-blue-600 focus:ring-blue-500"
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
                              'bg-gray-700 text-gray-200'
                        }`}>
                        {vehicle.status === 'available' ? 'Disponibile' :
                          vehicle.status === 'unavailable' ? 'Non Disponibile' :
                            vehicle.status === 'rented' ? 'Noleggiato' :
                              vehicle.status === 'maintenance' ? 'Manutenzione' : 'Ritirato'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">€{vehicle.daily_rate}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleEdit(vehicle)}
                          variant="secondary"
                          className="text-xs py-1 px-3"
                        >
                          Modifica
                        </Button>
                        <Button
                          onClick={() => syncToGoogleCalendar(vehicle)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-blue-900 hover:bg-blue-800"
                          title="Sincronizza con Google Calendar"
                        >
                          📅 Sync
                        </Button>
                        <Button
                          onClick={() => handleDelete(vehicle.id)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-red-900 hover:bg-red-800"
                        >
                          Elimina
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {exoticVehicles.length === 0 && (
                  <tr>
                    <td colSpan={multiSelectMode ? 6 : 5} className="px-4 py-8 text-center text-gray-500">
                      Nessun veicolo Exotic trovato
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Aziendali Vehicles Column */}
        <div className="bg-theme-bg-secondary rounded-full border border-theme-border overflow-hidden">
          <div className="bg-orange-900/30 px-4 py-3 border-b border-theme-border">
            <h3 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
              <span className="px-3 py-1 bg-orange-900 text-orange-200 rounded text-sm">Aziendali</span>
              <span className="text-sm text-theme-text-muted">({aziendaliCount} veicoli)</span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="">
                <tr>
                  {multiSelectMode && (
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary w-10">
                      <input
                        type="checkbox"
                        checked={aziendaliVehicles.length > 0 && aziendaliVehicles.every(v => selectedVehicles.has(v.id))}
                        onChange={() => toggleSelectCategory(aziendaliVehicles)}
                        className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Targa</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tariffa</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {aziendaliVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className={`border-t border-theme-border hover:bg-theme-bg-tertiary ${selectedVehicles.has(vehicle.id) ? 'bg-blue-900/20 hover:bg-blue-900/30' : ''}`}>
                    {multiSelectMode && (
                      <td className="px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedVehicles.has(vehicle.id)}
                          onChange={() => toggleVehicleSelection(vehicle.id)}
                          className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-blue-600 focus:ring-blue-500"
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
                              'bg-gray-700 text-gray-200'
                        }`}>
                        {vehicle.status === 'available' ? 'Disponibile' :
                          vehicle.status === 'unavailable' ? 'Non Disponibile' :
                            vehicle.status === 'rented' ? 'Noleggiato' :
                              vehicle.status === 'maintenance' ? 'Manutenzione' : 'Ritirato'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">€{vehicle.daily_rate}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleEdit(vehicle)}
                          variant="secondary"
                          className="text-xs py-1 px-3"
                        >
                          Modifica
                        </Button>
                        <Button
                          onClick={() => syncToGoogleCalendar(vehicle)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-blue-900 hover:bg-blue-800"
                          title="Sincronizza con Google Calendar"
                        >
                          📅 Sync
                        </Button>
                        <Button
                          onClick={() => handleDelete(vehicle.id)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-red-900 hover:bg-red-800"
                        >
                          Elimina
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {aziendaliVehicles.length === 0 && (
                  <tr>
                    <td colSpan={multiSelectMode ? 6 : 5} className="px-4 py-8 text-center text-gray-500">
                      Nessun veicolo Aziendali trovato
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
