import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface NuovaCauzioneModalProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cauzione?: any | null
    onClose: () => void
    onSave: () => void
}

interface Customer {
    id: string
    nome: string | null
    cognome: string | null
    denominazione: string | null
    tipo_cliente: string
    email: string | null
}

interface Vehicle {
    id: string
    display_name: string
    plate: string | null
}

export default function NuovaCauzioneModal({ cauzione, onClose, onSave }: NuovaCauzioneModalProps) {
    const [loading, setLoading] = useState(false)
    const [customers, setCustomers] = useState<Customer[]>([])
    const [vehicles, setVehicles] = useState<Vehicle[]>([])
    const [loadingData, setLoadingData] = useState(true)

    const [formData, setFormData] = useState({
        cliente_id: cauzione?.cliente_id || '',
        veicolo_id: cauzione?.veicolo_id || '',
        data_restituzione_veicolo: cauzione?.data_restituzione_veicolo || '',
        importo: cauzione?.importo || '',
        metodo: cauzione?.metodo || 'bonifico',
        note: cauzione?.note || ''
    })

    useEffect(() => {
        loadCustomersAndVehicles()
    }, [])

    const loadCustomersAndVehicles = async () => {
        setLoadingData(true)
        try {
            // Load customers
            const { data: customersData, error: customersError } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, denominazione, tipo_cliente, email')
                .order('cognome', { ascending: true })

            if (customersError) throw customersError

            // Load vehicles
            const { data: vehiclesData, error: vehiclesError } = await supabase
                .from('vehicles')
                .select('id, display_name, plate')
                .order('display_name', { ascending: true })

            if (vehiclesError) throw vehiclesError

            setCustomers(customersData || [])
            setVehicles(vehiclesData || [])
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error loading data:', error)
            toast.error(`Errore nel caricamento dei dati: ${_errMsg}`)
        } finally {
            setLoadingData(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        // Validation
        if (!formData.cliente_id || !formData.veicolo_id || !formData.data_restituzione_veicolo || !formData.importo) {
            toast.error('Compila tutti i campi obbligatori')
            return
        }

        if (Number(formData.importo) <= 0) {
            toast.error('L\'importo deve essere maggiore di zero')
            return
        }

        setLoading(true)
        try {
            const dataToSave = {
                cliente_id: formData.cliente_id,
                veicolo_id: formData.veicolo_id,
                data_restituzione_veicolo: formData.data_restituzione_veicolo,
                importo: Number(formData.importo),
                metodo: formData.metodo,
                note: formData.note || null
            }

            if (cauzione) {
                // Update existing
                const { error } = await supabase
                    .from('cauzioni')
                    .update(dataToSave)
                    .eq('id', cauzione.id)

                if (error) throw error
                toast.success('Cauzione aggiornata con successo')
            } else {
                // Create new
                const { error } = await supabase
                    .from('cauzioni')
                    .insert([dataToSave])

                if (error) throw error
                toast.success('Cauzione creata con successo')
            }

            onSave()
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error saving cauzione:', error)
            toast.error(`Errore nel salvataggio: ${_errMsg}`)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary rounded-3xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="p-6 border-b border-theme-border flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-theme-text-primary">
                        {cauzione ? 'Modifica Cauzione' : 'Nuova Cauzione'}
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none disabled:opacity-50"
                    >
                        ×
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {loadingData ? (
                        <div className="text-center py-8">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-dr7-gold mx-auto mb-4"></div>
                            <p className="text-theme-text-secondary">Caricamento dati...</p>
                        </div>
                    ) : (
                        <>
                            {/* Cliente */}
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                                    Cliente *
                                </label>
                                <select
                                    value={formData.cliente_id}
                                    onChange={(e) => setFormData({ ...formData, cliente_id: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                >
                                    <option value="">Seleziona cliente...</option>
                                    {customers.map((customer) => {
                                        const displayName = customer.tipo_cliente === 'azienda'
                                            ? customer.denominazione
                                            : `${customer.cognome || ''} ${customer.nome || ''}`.trim();
                                        return (
                                            <option key={customer.id} value={customer.id}>
                                                {displayName || 'N/A'} - {customer.email || 'N/A'}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>

                            {/* Veicolo */}
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                                    Veicolo *
                                </label>
                                <select
                                    value={formData.veicolo_id}
                                    onChange={(e) => setFormData({ ...formData, veicolo_id: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                >
                                    <option value="">Seleziona veicolo...</option>
                                    {vehicles.map((vehicle) => (
                                        <option key={vehicle.id} value={vehicle.id}>
                                            {vehicle.display_name} - {vehicle.plate || 'N/A'}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Data Restituzione Veicolo */}
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                                    Data Restituzione Veicolo *
                                </label>
                                <input
                                    type="date"
                                    value={formData.data_restituzione_veicolo}
                                    onChange={(e) => setFormData({ ...formData, data_restituzione_veicolo: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                                <p className="text-xs text-theme-text-muted mt-1">
                                    La scadenza cauzione sarà calcolata automaticamente (14 giorni lavorativi dopo questa data)
                                </p>
                            </div>

                            {/* Importo */}
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                                    Importo (€) *
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={formData.importo}
                                    onChange={(e) => setFormData({ ...formData, importo: e.target.value })}
                                    required
                                    placeholder="0.00"
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                            </div>

                            {/* Metodo */}
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                                    Metodo *
                                </label>
                                <select
                                    value={formData.metodo}
                                    onChange={(e) => setFormData({ ...formData, metodo: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                >
                                    <option value="bonifico">Bonifico</option>
                                    <option value="carta">Carta</option>
                                    <option value="preautorizzazione">Preautorizzazione</option>
                                </select>
                            </div>

                            {/* Note */}
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                                    Note
                                </label>
                                <textarea
                                    value={formData.note}
                                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                                    rows={3}
                                    placeholder="Note opzionali..."
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors resize-none"
                                />
                            </div>
                        </>
                    )}
                </form>

                {/* Footer */}
                <div className="p-6 border-t border-theme-border flex gap-3 justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-6 py-2 bg-theme-bg-hover text-theme-text-primary rounded-full hover:bg-theme-bg-tertiary transition-colors disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        disabled={loading || loadingData}
                        className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Salvataggio...' : 'Salva'}
                    </button>
                </div>
            </div>
        </div>
    )
}
