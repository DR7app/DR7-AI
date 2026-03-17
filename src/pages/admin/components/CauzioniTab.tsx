import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import NuovaCauzioneModal from './NuovaCauzioneModal'
import toast from 'react-hot-toast'

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
    stato: 'Attiva' | 'In scadenza' | 'Restituita' | 'Sbloccata' | 'Incassata' | 'Bloccata' | 'Danno'
    note: string | null
    data_restituzione: string | null
    data_sblocco: string | null
    data_incasso: string | null
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
    const [filterMetodo, setFilterMetodo] = useState<string>('all')

    // KPI Stats
    const [stats, setStats] = useState({
        incassate: 0,
        in_cassa: 0,
        da_incassare: 0,
        scadute: 0,
        totale_incassate: 0,
        totale_da_incassare: 0,
        totale_in_cassa: 0
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
            const { data, error } = await supabase
                .from('cauzioni')
                .select(`
          *,
          customers_extended!cliente_id(nome, cognome, denominazione, ragione_sociale, tipo_cliente, email),
          vehicles!veicolo_id(display_name, plate)
        `)
                .order('scadenza_cauzione', { ascending: true })

            if (error) throw error

            const today = new Date()
            today.setHours(0, 0, 0, 0)

            const formattedData = (data || []).map((c: any) => {
                const scadenzaDate = new Date(c.scadenza_cauzione)
                scadenzaDate.setHours(0, 0, 0, 0)

                const daysUntilDeadline = Math.floor((scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                const isOverdue = daysUntilDeadline < 0 && c.stato !== 'Restituita' && c.stato !== 'Sbloccata' && c.stato !== 'Bloccata'

                let clienteName = 'Cliente Sconosciuto';
                if (c.customers_extended) {
                    if (c.customers_extended.tipo_cliente === 'azienda' && (c.customers_extended.ragione_sociale || c.customers_extended.denominazione)) {
                        clienteName = c.customers_extended.ragione_sociale || c.customers_extended.denominazione;
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
            toast.error(`Errore nel caricamento delle cauzioni: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    const calculateStats = () => {
        const visible = cauzioni.filter(c => c.stato !== 'Restituita' && c.stato !== 'Sbloccata' && c.stato !== 'Bloccata')
        const incassateList = visible.filter(c => c.data_incasso)
        const daIncassareList = visible.filter(c => !c.data_incasso)
        const incassate = incassateList.length
        const inCassaList = cauzioni.filter(c => c.stato === 'Bloccata')
        const in_cassa = inCassaList.length
        const da_incassare = daIncassareList.length
        const scadute = visible.filter(c => c.is_overdue).length
        const totale_incassate = incassateList.reduce((sum, c) => sum + Number(c.importo), 0)
        const totale_da_incassare = daIncassareList.reduce((sum, c) => sum + Number(c.importo), 0)
        const totale_in_cassa = inCassaList.reduce((sum, c) => sum + Number(c.importo), 0)

        setStats({ incassate, in_cassa, da_incassare, scadute, totale_incassate, totale_da_incassare, totale_in_cassa })
    }

    // --- Section Filters ---
    const visibleCauzioni = cauzioni.filter(c => c.stato !== 'Restituita' && c.stato !== 'Sbloccata' && c.stato !== 'Bloccata' && c.stato !== 'Danno')

    const applySearch = (list: Cauzione[]) => list.filter(c => {
        const matchesSearch = searchTerm === '' ||
            c.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.veicolo_modello?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.veicolo_targa?.toLowerCase().includes(searchTerm.toLowerCase())
        const matchesMetodo = filterMetodo === 'all' || c.metodo === filterMetodo
        return matchesSearch && matchesMetodo
    })

    // Sort for INCASSATE: scadute first, then in scadenza, then attive. Within each group, nearest deadline first.
    const sortByUrgency = (list: Cauzione[]) => {
        return [...list].sort((a, b) => {
            const priorityA = a.is_overdue ? 0 : a.stato === 'In scadenza' ? 1 : 2
            const priorityB = b.is_overdue ? 0 : b.stato === 'In scadenza' ? 1 : 2
            if (priorityA !== priorityB) return priorityA - priorityB
            return a.days_until_deadline - b.days_until_deadline
        })
    }

    const incassate = sortByUrgency(applySearch(
        visibleCauzioni.filter(c => c.data_incasso)
    ))
    const daIncassare = applySearch(
        visibleCauzioni.filter(c => !c.data_incasso)
    ).sort((a, b) => a.days_until_deadline - b.days_until_deadline)

    // Storico: processed cauzioni (Restituita, Sbloccata, Bloccata, Danno)
    const storicoCauzioni = applySearch(
        cauzioni.filter(c => c.stato === 'Restituita' || c.stato === 'Sbloccata' || c.stato === 'Bloccata' || c.stato === 'Danno')
    ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

    // --- Handlers ---

    const handleMarkRestituita = async (cauzione: Cauzione) => {
        const note = prompt('Note opzionali per la restituzione:')
        if (note === null) return

        try {
            const { error } = await supabase.rpc('mark_cauzione_restituita', {
                cauzione_id: cauzione.id,
                return_note: note || null
            })

            if (error) throw error

            toast.success('Cauzione marcata come Restituita')
            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking restituita:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleCreatePreauth = async (cauzione: Cauzione) => {
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
                window.open(result.paymentUrl, '_blank', 'width=600,height=700')
                toast.success('Pagina di pagamento Nexi aperta. Completa il pagamento con il cliente.')
            }

            fetchCauzioni()
        } catch (error: any) {
            console.error('Error creating preauth:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleMarkSbloccataPreauth = async (cauzione: Cauzione) => {
        try {
            const nexiTransactionId = (cauzione as any).nexi_transaction_id

            if (nexiTransactionId) {
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

                toast.success(result.message || 'Preautorizzazione sbloccata con successo')
            } else {
                const { error } = await supabase.rpc('mark_cauzione_sbloccata', {
                    cauzione_id: cauzione.id,
                    release_note: 'Preautorizzazione sbloccata manualmente'
                })

                if (error) throw error
                toast.success('Cauzione marcata come sbloccata')
            }

            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking sbloccata:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleIncassa = async (cauzione: Cauzione) => {
        const importo = prompt(`Importo da incassare (max €${cauzione.importo}):`, String(cauzione.importo))
        if (importo === null) return

        const amount = parseFloat(importo)
        if (isNaN(amount) || amount <= 0 || amount > cauzione.importo) {
            toast.error('Importo non valido')
            return
        }

        try {
            const nexiTransactionId = (cauzione as any).nexi_transaction_id

            if (nexiTransactionId) {
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

                toast.success(result.message || `Incassato €${amount.toFixed(2)} con successo`)
            } else {
                const { error } = await supabase
                    .from('cauzioni')
                    .update({
                        stato: 'Incassata',
                        data_incasso: new Date().toISOString(),
                        note: `Incassato €${amount.toFixed(2)} manualmente`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cauzione.id)

                if (error) throw error
                toast.success(`Incassato €${amount.toFixed(2)} (registrato manualmente)`)
            }

            fetchCauzioni()
        } catch (error: any) {
            console.error('Error capturing payment:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleSegnaIncassata = async (cauzione: Cauzione) => {
        try {
            const { error } = await supabase
                .from('cauzioni')
                .update({
                    data_incasso: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzione.id)

            if (error) throw error
            toast.success('Cauzione segnata come incassata')
            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking incassata:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleSegnaDaIncassare = async (cauzione: Cauzione) => {
        try {
            const { error } = await supabase
                .from('cauzioni')
                .update({
                    data_incasso: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzione.id)

            if (error) throw error
            toast.success('Cauzione riportata a Da incassare')
            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking da incassare:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleCassa = async (cauzione: Cauzione) => {
        try {
            const { error } = await supabase
                .from('cauzioni')
                .update({
                    stato: 'Danno',
                    note: 'CASSA: Danno',
                    data_incasso: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzione.id)

            if (error) throw error
            toast.success('Cauzione incassata come danno')
            fetchCauzioni()
        } catch (error: any) {
            console.error('Error marking cauzione as danno:', error)
            toast.error(`Errore: ${error.message}`)
        }
    }

    const handleRevertStato = async (cauzione: Cauzione, newStato: string) => {
        try {
            const updateData: any = {
                stato: newStato,
                updated_at: new Date().toISOString()
            }
            // Clear date fields when reverting
            if (newStato === 'Attiva' || newStato === 'In scadenza') {
                updateData.data_restituzione = null
                updateData.data_sblocco = null
                updateData.data_incasso = null
                updateData.note = `Ripristinata da ${cauzione.stato}`
            }

            const { error } = await supabase
                .from('cauzioni')
                .update(updateData)
                .eq('id', cauzione.id)

            if (error) throw error
            toast.success(`Cauzione ripristinata a "${newStato}"`)
            fetchCauzioni()
        } catch (error: any) {
            console.error('Error reverting cauzione:', error)
            toast.error(`Errore: ${error.message}`)
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

    const getStatoBadgeClass = (cauzione: Cauzione) => {
        if (cauzione.stato === 'Bloccata') return 'bg-orange-600 text-white'
        if (!cauzione.data_incasso) return 'bg-yellow-600 text-black' // Da incassare
        if (cauzione.is_overdue) return 'bg-red-600 text-white'
        if (cauzione.stato === 'In scadenza') return 'bg-yellow-600 text-black'
        return 'bg-green-600 text-white' // Incassata / Attiva
    }

    const getStatoLabel = (cauzione: Cauzione) => {
        if (cauzione.stato === 'Bloccata') return 'Bloccata'
        if (!cauzione.data_incasso) return 'Da incassare'
        if (cauzione.is_overdue) return 'Scaduta'
        if (cauzione.stato === 'In scadenza') return 'In scadenza'
        return 'Attiva' // Incassata and within deadline
    }

    const getStoricoStatoBadge = (stato: string) => {
        switch (stato) {
            case 'Restituita': return 'bg-green-600 text-white'
            case 'Sbloccata': return 'bg-blue-600 text-white'
            case 'Bloccata': return 'bg-orange-600 text-white'
            case 'Danno': return 'bg-red-600 text-white'
            default: return 'bg-gray-600 text-white'
        }
    }

    // --- Shared table row renderer ---
    const renderRow = (cauzione: Cauzione, actions: React.ReactNode) => (
        <tr
            key={cauzione.id}
            className={`border-b border-theme-border hover:bg-theme-bg-hover transition-colors ${cauzione.is_overdue ? 'border-l-4 border-l-red-500' : ''}`}
        >
            <td className="px-4 py-3 text-sm text-theme-text-primary">{cauzione.cliente_nome}</td>
            <td className="px-4 py-3 text-sm text-theme-text-primary">
                <div>{cauzione.veicolo_modello}</div>
                <div className="text-xs text-theme-text-secondary">{cauzione.veicolo_targa}</div>
            </td>
            <td className="px-4 py-3 text-sm text-theme-text-primary">
                {new Date(cauzione.data_restituzione_veicolo + 'T00:00:00').toLocaleDateString('it-IT')}
            </td>
            <td className="px-4 py-3 text-sm text-theme-text-primary">
                <div>{new Date(cauzione.scadenza_cauzione + 'T00:00:00').toLocaleDateString('it-IT')}</div>
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
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatoBadgeClass(cauzione)}`}>
                    {getStatoLabel(cauzione)}
                </span>
            </td>
            <td className="px-4 py-3">
                <div className="flex gap-2 flex-wrap">
                    {actions}
                </div>
            </td>
        </tr>
    )

    const tableHeader = (
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
    )

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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-4">
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
                    <div className="text-xs sm:text-sm text-theme-text-secondary">Incassate</div>
                    <div className="text-2xl sm:text-3xl font-bold text-green-500">{stats.incassate}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
                    <div className="text-xs sm:text-sm text-theme-text-secondary">Da Incassare</div>
                    <div className="text-2xl sm:text-3xl font-bold text-yellow-500">{stats.da_incassare}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-red-500/30 rounded-3xl p-3 sm:p-4">
                    <div className="text-xs sm:text-sm text-theme-text-secondary">In Cassa</div>
                    <div className="text-2xl sm:text-3xl font-bold text-red-500">{stats.in_cassa}</div>
                    <div className="text-xs sm:text-sm text-red-400 mt-1">€{stats.totale_in_cassa.toFixed(2)}</div>
                </div>
            </div>
            {/* Totali Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-6">
                <div className="bg-theme-bg-tertiary border border-green-500/30 rounded-3xl p-3 sm:p-4">
                    <div className="text-xs sm:text-sm text-theme-text-secondary">Totale Incassate</div>
                    <div className="text-xl sm:text-3xl font-bold text-green-500">€{stats.totale_incassate.toFixed(2)}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-yellow-500/30 rounded-3xl p-3 sm:p-4">
                    <div className="text-xs sm:text-sm text-theme-text-secondary">Totale Da Incassare</div>
                    <div className="text-xl sm:text-3xl font-bold text-yellow-500">€{stats.totale_da_incassare.toFixed(2)}</div>
                </div>
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
                    <div className="text-xs sm:text-sm text-theme-text-secondary">Scadute</div>
                    <div className="text-2xl sm:text-3xl font-bold text-red-500">{stats.scadute}</div>
                </div>
            </div>

            {/* Filters */}
            <div className="mb-6 bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Cerca cliente, veicolo, targa..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="px-4 py-2 bg-theme-bg-primary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold transition-colors"
                    />
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

            {/* === SECTION: INCASSATE === */}
            <div className="mb-8">
                <h3 className="text-lg font-bold text-green-500 mb-3 flex items-center gap-2">
                    INCASSATE
                    <span className="text-sm font-normal text-theme-text-secondary">({incassate.length})</span>
                </h3>
                <div className="border border-theme-border rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            {tableHeader}
                            <tbody>
                                {incassate.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-6 text-center text-theme-text-secondary">
                                            Nessuna cauzione incassata
                                        </td>
                                    </tr>
                                ) : (
                                    incassate.map((cauzione) =>
                                        renderRow(cauzione, <>
                                            <button
                                                onClick={() => handleEdit(cauzione)}
                                                className="px-3 py-2 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors"
                                            >
                                                Modifica
                                            </button>
                                            <button
                                                onClick={() => handleSegnaDaIncassare(cauzione)}
                                                className="px-3 py-2 bg-yellow-600 text-black text-xs rounded-full hover:bg-yellow-500 transition-colors font-semibold"
                                            >
                                                DA INCASSARE
                                            </button>
                                            <button
                                                onClick={() => handleCassa(cauzione)}
                                                className="px-3 py-2 bg-red-600 text-white text-xs rounded-full hover:bg-red-700 transition-colors"
                                            >
                                                CASSA
                                            </button>
                                            <button
                                                onClick={() => handleMarkRestituita(cauzione)}
                                                className="px-3 py-2 bg-green-600 text-white text-xs rounded-full hover:bg-green-700 transition-colors"
                                            >
                                                RESTITUITA
                                            </button>
                                        </>)
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* === SECTION: DA INCASSARE === */}
            <div className="mb-8">
                <h3 className="text-lg font-bold text-yellow-500 mb-3 flex items-center gap-2">
                    DA INCASSARE
                    <span className="text-sm font-normal text-theme-text-secondary">({daIncassare.length})</span>
                </h3>
                <div className="border border-theme-border rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            {tableHeader}
                            <tbody>
                                {daIncassare.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-6 text-center text-theme-text-secondary">
                                            Nessuna cauzione da incassare
                                        </td>
                                    </tr>
                                ) : (
                                    daIncassare.map((cauzione) =>
                                        renderRow(cauzione, <>
                                            <button
                                                onClick={() => handleEdit(cauzione)}
                                                className="px-3 py-2 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors"
                                            >
                                                Modifica
                                            </button>
                                            <button
                                                onClick={() => handleSegnaIncassata(cauzione)}
                                                className="px-3 py-2 bg-dr7-gold text-black text-xs rounded-full hover:bg-yellow-500 transition-colors font-semibold"
                                            >
                                                INCASSA
                                            </button>
                                            {cauzione.metodo === 'preautorizzazione' && !cauzione.nexi_transaction_id && (
                                                <button
                                                    onClick={() => handleCreatePreauth(cauzione)}
                                                    className="px-3 py-2 bg-purple-600 text-white text-xs rounded-full hover:bg-purple-700 transition-colors font-semibold"
                                                >
                                                    CREA PREAUTH
                                                </button>
                                            )}
                                            {cauzione.metodo === 'preautorizzazione' && cauzione.nexi_transaction_id && (
                                                <>
                                                    <button
                                                        onClick={() => handleIncassa(cauzione)}
                                                        className="px-3 py-2 bg-purple-600 text-white text-xs rounded-full hover:bg-purple-700 transition-colors"
                                                    >
                                                        INCASSA
                                                    </button>
                                                    <button
                                                        onClick={() => handleMarkSbloccataPreauth(cauzione)}
                                                        className="px-3 py-2 bg-theme-bg-hover text-theme-text-primary text-xs rounded-full hover:bg-theme-bg-tertiary transition-colors"
                                                    >
                                                        SBLOCCA PREAUTH
                                                    </button>
                                                </>
                                            )}
                                        </>)
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* === SECTION: STORICO === */}
            <div className="mb-8">
                <h3 className="text-lg font-bold text-theme-text-secondary mb-3 flex items-center gap-2">
                    STORICO
                    <span className="text-sm font-normal text-theme-text-secondary">({storicoCauzioni.length})</span>
                </h3>
                <div className="border border-theme-border rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-theme-bg-hover border-b border-theme-border">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Cliente</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Veicolo</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Importo</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Metodo</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Note</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Data</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                                </tr>
                            </thead>
                            <tbody>
                                {storicoCauzioni.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-6 text-center text-theme-text-secondary">
                                            Nessuna cauzione nello storico
                                        </td>
                                    </tr>
                                ) : (
                                    storicoCauzioni.map((cauzione) => (
                                        <tr
                                            key={cauzione.id}
                                            className="border-b border-theme-border hover:bg-theme-bg-hover transition-colors"
                                        >
                                            <td className="px-4 py-3 text-sm text-theme-text-primary">{cauzione.cliente_nome}</td>
                                            <td className="px-4 py-3 text-sm text-theme-text-primary">
                                                <div>{cauzione.veicolo_modello}</div>
                                                <div className="text-xs text-theme-text-secondary">{cauzione.veicolo_targa}</div>
                                            </td>
                                            <td className="px-4 py-3 text-sm font-semibold text-theme-text-primary">
                                                €{Number(cauzione.importo).toFixed(2)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-theme-text-primary capitalize">{cauzione.metodo}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStoricoStatoBadge(cauzione.stato)}`}>
                                                    {cauzione.stato}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-theme-text-secondary max-w-[200px] truncate">
                                                {cauzione.note || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-theme-text-secondary">
                                                {new Date(cauzione.updated_at).toLocaleDateString('it-IT')}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-2 flex-wrap">
                                                    <button
                                                        onClick={() => handleEdit(cauzione)}
                                                        className="px-3 py-2 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors"
                                                    >
                                                        Modifica
                                                    </button>
                                                    <button
                                                        onClick={() => handleRevertStato(cauzione, 'Attiva')}
                                                        className="px-3 py-2 bg-green-600 text-white text-xs rounded-full hover:bg-green-700 transition-colors"
                                                    >
                                                        RIPRISTINA
                                                    </button>
                                                    {cauzione.stato === 'Danno' && (
                                                        <button
                                                            onClick={() => handleRevertStato(cauzione, 'Incassata')}
                                                            className="px-3 py-2 bg-dr7-gold text-black text-xs rounded-full hover:bg-yellow-500 transition-colors font-semibold"
                                                        >
                                                            INCASSATA
                                                        </button>
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
