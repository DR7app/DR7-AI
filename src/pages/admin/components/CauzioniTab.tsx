import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import NuovaCauzioneModal from './NuovaCauzioneModal'

interface Cauzione {
    id: string
    created_at: string
    updated_at: string
    cliente_id: string
    veicolo_id: string
    riferimento_contratto_id: string | null
    data_restituzione_veicolo: string
    scadenza_cauzione: string
    importo: number
    metodo: 'bonifico' | 'carta' | 'preautorizzazione'
    stato: 'Attiva' | 'In scadenza' | 'Restituita' | 'Sbloccata' | 'Incassata'
    note: string | null
    data_restituzione: string | null
    data_sblocco: string | null
    is_overdue: boolean
    days_until_deadline: number
    cliente_nome?: string
    cliente_email?: string
    veicolo_modello?: string
    veicolo_targa?: string
    nexi_transaction_id?: string | null
    nexi_order_id?: string | null
}

export default function CauzioniTab() {
    const [cauzioni, setCauzioni] = useState<Cauzione[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [selectedCauzione, setSelectedCauzione] = useState<Cauzione | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [filterStato, setFilterStato] = useState<string>('all')
    const [filterMetodo, setFilterMetodo] = useState<string>('all')

    // KPI Stats
    const [stats, setStats] = useState({
        attive: 0,
        in_scadenza: 0,
        overdue: 0,
        totale_importo: 0
    })

    useEffect(() => {
        fetchCauzioni()
    }, [])

    useEffect(() => {
        calculateStats()
    }, [cauzioni])

    const fetchCauzioni = async () => {
        setLoading(true)
        try {
            // Fetch from base table with proper joins
            const { data, error } = await supabase
                .from('cauzioni')
                .select(`
          *,
          customers_extended!cliente_id(nome, cognome, denominazione, tipo_cliente, email),
          vehicles!veicolo_id(display_name, plate)
        `)
                .order('scadenza_cauzione', { ascending: true })

            if (error) throw error

            // Calculate is_overdue and days_until_deadline manually
            const today = new Date()
            today.setHours(0, 0, 0, 0)

            const formattedData = (data || []).map((c: any) => {
                const scadenzaDate = new Date(c.scadenza_cauzione)
                scadenzaDate.setHours(0, 0, 0, 0)

                const daysUntilDeadline = Math.floor((scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                const isOverdue = daysUntilDeadline < 0 && c.stato !== 'Restituita' && c.stato !== 'Sbloccata'

                // Get client name based on type (azienda uses denominazione, persona_fisica uses nome/cognome)
                let clienteName = 'Cliente Sconosciuto';
                if (c.customers_extended) {
                    if (c.customers_extended.tipo_cliente === 'azienda' && c.customers_extended.denominazione) {
                        clienteName = c.customers_extended.denominazione;
                    } else if (c.customers_extended.nome || c.customers_extended.cognome) {
                        clienteName = `${c.customers_extended.nome || ''} ${c.customers_extended.cognome || ''}`.trim();
                    }
                }

                return {
                    ...c,
                    is_overdue: isOverdue,
                    days_until_deadline: daysUntilDeadline,
                    cliente_nome: clienteName,
                    cliente_email: c.customers_extended?.email || '',
                    veicolo_modello: c.vehicles?.display_name || 'N/A',
                    veicolo_targa: c.vehicles?.plate || 'N/A'
                }
            })

            setCauzioni(formattedData)
        } catch (error: any) {
            console.error('Error fetching cauzioni:', error)
            alert(`Errore nel caricamento delle cauzioni: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    const calculateStats = () => {
        const attive = cauzioni.filter(c => c.stato === 'Attiva').length
        const in_scadenza = cauzioni.filter(c => c.stato === 'In scadenza' && !c.is_overdue).length
        const overdue = cauzioni.filter(c => c.is_overdue).length
        const totale_importo = cauzioni
            .filter(c => c.stato !== 'Restituita' && c.stato !== 'Sbloccata')
            .reduce((sum, c) => sum + Number(c.importo), 0)

        setStats({ attive, in_scadenza, overdue, totale_importo })
    }

    const handleMarkRestituita = async (cauzione: Cauzione) => {
        const note = prompt('Note opzionali per la restituzione:')
        if (note === null) return // User cancelled

        try {
            const { error } = await supabase.rpc('mark_cauzione_restituita', {
                cauzione_id: cauzione.id,
                return_note: note || null
            })

            if (error) throw error

            alert('Cauzione marcata come Restituita')
            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking restituita:', error)
            alert(`Errore: ${error.message}`)
        }
    }

    const handleCreatePreauth = async (cauzione: Cauzione) => {
        if (!confirm(`Creare preautorizzazione di €${cauzione.importo} per ${cauzione.cliente_nome}?`)) return

        try {
            const response = await fetch('/.netlify/functions/nexi-create-preauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cauzioneId: cauzione.id,
                    amount: cauzione.importo,
                    customerEmail: cauzione.cliente_email,
                    customerName: cauzione.cliente_nome,
                    description: `Cauzione ${cauzione.veicolo_modello} - ${cauzione.cliente_nome}`
                })
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Errore creazione preautorizzazione')
            }

            if (result.paymentUrl) {
                // Open Nexi payment page in new window
                window.open(result.paymentUrl, '_blank', 'width=600,height=700')
                alert('Pagina di pagamento Nexi aperta. Completa il pagamento con il cliente.')
            }

            fetchCauzioni()
        } catch (error: any) {
            console.error('Error creating preauth:', error)
            alert(`Errore: ${error.message}`)
        }
    }

    const handleMarkSbloccata = async (cauzione: Cauzione) => {
        if (!confirm('Vuoi sbloccare la preautorizzazione? Il cliente riceverà indietro i fondi.')) return

        try {
            // Check if we have a Nexi transaction ID
            const nexiTransactionId = (cauzione as any).nexi_transaction_id

            if (nexiTransactionId) {
                // Call Nexi API to void pre-authorization
                const response = await fetch('/.netlify/functions/nexi-void-preauth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cauzioneId: cauzione.id,
                        transactionId: nexiTransactionId,
                        orderId: (cauzione as any).nexi_order_id
                    })
                })

                const result = await response.json()

                if (!response.ok) {
                    throw new Error(result.error || 'Errore Nexi')
                }

                alert(result.message || 'Preautorizzazione sbloccata con successo')
            } else {
                // No Nexi transaction, just update locally
                const { error } = await supabase.rpc('mark_cauzione_sbloccata', {
                    cauzione_id: cauzione.id,
                    release_note: 'Preautorizzazione sbloccata manualmente'
                })

                if (error) throw error
                alert('Cauzione marcata come sbloccata')
            }

            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking sbloccata:', error)
            alert(`Errore: ${error.message}`)
        }
    }

    const handleIncassa = async (cauzione: Cauzione) => {
        const importo = prompt(`Importo da incassare (max €${cauzione.importo}):`, String(cauzione.importo))
        if (importo === null) return // User cancelled

        const amount = parseFloat(importo)
        if (isNaN(amount) || amount <= 0 || amount > cauzione.importo) {
            alert('Importo non valido')
            return
        }

        if (!confirm(`Confermi di voler incassare €${amount.toFixed(2)} dalla preautorizzazione?`)) return

        try {
            // Check if we have a Nexi transaction ID
            const nexiTransactionId = (cauzione as any).nexi_transaction_id

            if (nexiTransactionId) {
                // Call Nexi API to capture pre-authorization
                const response = await fetch('/.netlify/functions/nexi-capture-preauth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cauzioneId: cauzione.id,
                        transactionId: nexiTransactionId,
                        amount: amount,
                        orderId: (cauzione as any).nexi_order_id
                    })
                })

                const result = await response.json()

                if (!response.ok) {
                    throw new Error(result.error || 'Errore Nexi')
                }

                alert(result.message || `Incassato €${amount.toFixed(2)} con successo`)
            } else {
                // No Nexi transaction, just update locally
                const { error } = await supabase
                    .from('cauzioni')
                    .update({
                        stato: 'Incassata',
                        note: `Incassato €${amount.toFixed(2)} manualmente`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cauzione.id)

                if (error) throw error
                alert(`Incassato €${amount.toFixed(2)} (registrato manualmente)`)
            }

            fetchCauzioni()
        } catch (error: any) {
            console.error('Error capturing payment:', error)
            alert(`Errore: ${error.message}`)
        }
    }

    const handleEdit = (cauzione: Cauzione) => {
        setSelectedCauzione(cauzione)
        setShowModal(true)
    }

    const handleCloseModal = () => {
        setShowModal(false)
        setSelectedCauzione(null)
    }

    const handleSaveSuccess = () => {
        handleCloseModal()
        fetchCauzioni()
    }

    const getStatoBadgeClass = (stato: string, isOverdue: boolean) => {
        if (isOverdue) return 'bg-red-600 text-white'
        switch (stato) {
            case 'Attiva': return 'bg-green-600 text-white'
            case 'In scadenza': return 'bg-yellow-600 text-black'
            case 'Restituita': return 'bg-blue-600 text-white'
            case 'Sbloccata': return 'bg-gray-600 text-white'
            case 'Incassata': return 'bg-purple-600 text-white'
            default: return 'bg-gray-400 text-white'
        }
    }

    const getStatoLabel = (stato: string, isOverdue: boolean) => {
        if (isOverdue) return 'Scaduta'
        return stato
    }

    const filteredCauzioni = cauzioni.filter(c => {
        const matchesSearch = searchTerm === '' ||
            c.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.veicolo_modello?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.veicolo_targa?.toLowerCase().includes(searchTerm.toLowerCase())

        const matchesStato = filterStato === 'all' ||
            (filterStato === 'overdue' ? c.is_overdue : c.stato === filterStato)

        const matchesMetodo = filterMetodo === 'all' || c.metodo === filterMetodo

        return matchesSearch && matchesStato && matchesMetodo
    })

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-xl text-theme-text-primary">Caricamento...</div>
            </div>
        )
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-theme-text-primary">Cauzioni</h2>
                <button
                    onClick={() => setShowModal(true)}
                    className="px-6 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors"
                >
                    Nuova Cauzione
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
                    <div className="text-sm text-theme-text-secondary">Attive</div>
                    <div className="text-3xl font-bold text-green-500">{stats.attive}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
                    <div className="text-sm text-theme-text-secondary">In Scadenza</div>
                    <div className="text-3xl font-bold text-yellow-500">{stats.in_scadenza}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
                    <div className="text-sm text-theme-text-secondary">Scadute</div>
                    <div className="text-3xl font-bold text-red-500">{stats.overdue}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
                    <div className="text-sm text-theme-text-secondary">Totale Attivo</div>
                    <div className="text-3xl font-bold text-dr7-gold">€{stats.totale_importo.toFixed(2)}</div>
                </div>
            </div>

            {/* Filters */}
            <div className="mb-6 bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input
                        type="text"
                        placeholder="Cerca cliente, veicolo, targa..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="px-4 py-2 bg-theme-bg-primary border border-theme-border rounded-full text-theme-text-primary placeholder-gray-400 focus:outline-none focus:border-dr7-gold transition-colors"
                    />
                    <select
                        value={filterStato}
                        onChange={(e) => setFilterStato(e.target.value)}
                        className="px-4 py-2 bg-theme-bg-primary border border-theme-border rounded-full text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                    >
                        <option value="all">Tutti gli stati</option>
                        <option value="Attiva">Attiva</option>
                        <option value="In scadenza">In scadenza</option>
                        <option value="overdue">Scadute</option>
                        <option value="Restituita">Restituita</option>
                        <option value="Sbloccata">Sbloccata</option>
                        <option value="Incassata">Incassata</option>
                    </select>
                    <select
                        value={filterMetodo}
                        onChange={(e) => setFilterMetodo(e.target.value)}
                        className="px-4 py-2 bg-theme-bg-primary border border-theme-border rounded-full text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                    >
                        <option value="all">Tutti i metodi</option>
                        <option value="bonifico">Bonifico</option>
                        <option value="carta">Carta</option>
                        <option value="preautorizzazione">Preautorizzazione</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="border border-theme-border rounded-3xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-theme-bg-hover border-b border-theme-border">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Cliente</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Veicolo</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Data Restituzione</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Scadenza</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Importo</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Metodo</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCauzioni.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-theme-text-secondary">
                                        Nessuna cauzione trovata
                                    </td>
                                </tr>
                            ) : (
                                filteredCauzioni.map((cauzione) => (
                                    <tr
                                        key={cauzione.id}
                                        className={`border-b border-theme-border hover:bg-theme-bg-hover transition-colors ${cauzione.is_overdue ? 'border-l-4 border-l-red-500' : ''
                                            }`}
                                    >
                                        <td className="px-4 py-3 text-sm text-theme-text-primary">{cauzione.cliente_nome}</td>
                                        <td className="px-4 py-3 text-sm text-theme-text-primary">
                                            <div>{cauzione.veicolo_modello}</div>
                                            <div className="text-xs text-theme-text-secondary">{cauzione.veicolo_targa}</div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-theme-text-primary">
                                            {new Date(cauzione.data_restituzione_veicolo).toLocaleDateString('it-IT')}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-theme-text-primary">
                                            <div>{new Date(cauzione.scadenza_cauzione).toLocaleDateString('it-IT')}</div>
                                            {cauzione.days_until_deadline !== null && (
                                                <div className="text-xs text-theme-text-secondary">
                                                    {cauzione.days_until_deadline > 0
                                                        ? `${cauzione.days_until_deadline} giorni`
                                                        : cauzione.days_until_deadline === 0
                                                            ? 'Oggi'
                                                            : `${Math.abs(cauzione.days_until_deadline)} giorni fa`
                                                    }
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-semibold text-theme-text-primary">
                                            €{Number(cauzione.importo).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-theme-text-primary capitalize">{cauzione.metodo}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatoBadgeClass(cauzione.stato, cauzione.is_overdue)}`}>
                                                {getStatoLabel(cauzione.stato, cauzione.is_overdue)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex gap-2 flex-wrap">
                                                <button
                                                    onClick={() => handleEdit(cauzione)}
                                                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors"
                                                >
                                                    Modifica
                                                </button>
                                                {cauzione.stato !== 'Restituita' && cauzione.stato !== 'Sbloccata' && cauzione.stato !== 'Incassata' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleMarkSbloccata(cauzione)}
                                                            className="px-3 py-1 bg-gray-600 text-white text-xs rounded-full hover:bg-gray-700 transition-colors"
                                                        >
                                                            SBLOCCA
                                                        </button>
                                                        <button
                                                            onClick={() => handleIncassa(cauzione)}
                                                            className="px-3 py-1 bg-purple-600 text-white text-xs rounded-full hover:bg-purple-700 transition-colors"
                                                        >
                                                            INCASSA
                                                        </button>
                                                        {/* For bonifico/carta: also show Restituita */}
                                                        {cauzione.metodo !== 'preautorizzazione' && (
                                                            <button
                                                                onClick={() => handleMarkRestituita(cauzione)}
                                                                className="px-3 py-1 bg-green-600 text-white text-xs rounded-full hover:bg-green-700 transition-colors"
                                                            >
                                                                Restituita
                                                            </button>
                                                        )}
                                                        {/* For preautorizzazione without transaction: show CREA PREAUTH */}
                                                        {cauzione.metodo === 'preautorizzazione' && !cauzione.nexi_transaction_id && (
                                                            <button
                                                                onClick={() => handleCreatePreauth(cauzione)}
                                                                className="px-3 py-1 bg-dr7-gold text-black text-xs rounded-full hover:bg-yellow-500 transition-colors font-semibold"
                                                            >
                                                                CREA PREAUTH
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <NuovaCauzioneModal
                    cauzione={selectedCauzione}
                    onClose={handleCloseModal}
                    onSave={handleSaveSuccess}
                />
            )}
        </div>
    )
}
