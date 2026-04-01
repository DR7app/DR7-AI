import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import NuovaCauzioneModal from './NuovaCauzioneModal'
import toast from 'react-hot-toast'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'

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
    cliente_telefono?: string
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
    const [showStorico, setShowStorico] = useState(false)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cauzioni])

    const fetchCauzioni = async () => {
        setLoading(true)
        try {
            // Try FK join first, fall back to separate queries if FKs not set up
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let data: any[] | null = null

            const { data: joinData, error: joinError } = await supabase
                .from('cauzioni')
                .select(`
          *,
          customers_extended!cliente_id(nome, cognome, denominazione, ragione_sociale, tipo_cliente, email),
          vehicles!veicolo_id(display_name, plate)
        `)
                .order('scadenza_cauzione', { ascending: true })

            if (!joinError && joinData) {
                data = joinData
            } else {
                // FK join failed — fetch cauzioni plain, then enrich with separate queries
                logger.warn('FK join failed, using fallback:', joinError?.message)
                const { data: plainData, error: plainError } = await supabase
                    .from('cauzioni')
                    .select('*')
                    .order('scadenza_cauzione', { ascending: true })

                if (plainError) throw plainError
                data = plainData || []

                // Batch-fetch customers and vehicles
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const clienteIds = [...new Set(data.map((c: any) => c.cliente_id).filter(Boolean))]
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const veicoloIds = [...new Set(data.map((c: any) => c.veicolo_id).filter(Boolean))]

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const customersMap: Record<string, any> = {}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const vehiclesMap: Record<string, any> = {}

                if (clienteIds.length > 0) {
                    const { data: customers } = await supabase
                        .from('customers_extended')
                        .select('id, nome, cognome, denominazione, ragione_sociale, tipo_cliente, email')
                        .in('id', clienteIds)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ;(customers || []).forEach((c: any) => { customersMap[c.id] = c })
                }

                if (veicoloIds.length > 0) {
                    const { data: vehicles } = await supabase
                        .from('vehicles')
                        .select('id, display_name, plate')
                        .in('id', veicoloIds)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ;(vehicles || []).forEach((v: any) => { vehiclesMap[v.id] = v })
                }

                // Attach to data
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data = data.map((c: any) => ({
                    ...c,
                    customers_extended: customersMap[c.cliente_id] || null,
                    vehicles: vehiclesMap[c.veicolo_id] || null
                }))
            }

            const today = new Date()
            today.setHours(0, 0, 0, 0)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error fetching cauzioni:', error)
            toast.error(`Errore nel caricamento delle cauzioni: ${_errMsg}`)
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error marking restituita:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    const handleAddebitaMIT = async (cauzione: Cauzione) => {
        try {
            // Find customer's contractId from customers_extended or nexi_transactions
            let contractId = ''

            if (cauzione.cliente_id) {
                const { data: cust } = await supabase
                    .from('customers_extended')
                    .select('metadata')
                    .eq('id', cauzione.cliente_id)
                    .maybeSingle()
                contractId = cust?.metadata?.nexi_contract_id || ''
            }

            // Fallback 1: check nexi_transactions for this customer's booking
            if (!contractId && cauzione.riferimento_contratto_id) {
                const { data: txn } = await supabase
                    .from('nexi_transactions')
                    .select('contract_id')
                    .eq('booking_id', cauzione.riferimento_contratto_id)
                    .eq('status', 'completed')
                    .not('contract_id', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                contractId = txn?.contract_id || ''
            }

            // Fallback 2: check nexi_transactions by customer email
            if (!contractId && cauzione.cliente_email) {
                const { data: txn } = await supabase
                    .from('nexi_transactions')
                    .select('contract_id')
                    .eq('customer_email', cauzione.cliente_email)
                    .eq('status', 'completed')
                    .not('contract_id', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                contractId = txn?.contract_id || ''
            }

            // Fallback 3: check by customer email case-insensitive
            if (!contractId && cauzione.cliente_email) {
                const { data: txn } = await supabase
                    .from('nexi_transactions')
                    .select('contract_id')
                    .ilike('customer_email', cauzione.cliente_email)
                    .eq('status', 'completed')
                    .not('contract_id', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                contractId = txn?.contract_id || ''
            }

            if (!contractId) {
                toast.error('Nessuna carta tokenizzata trovata per questo cliente. Usa "INVIA LINK" invece.')
                return
            }

            if (!confirm(`Bloccare €${Number(cauzione.importo).toFixed(2)} sulla carta salvata di ${cauzione.cliente_nome}? (Pre-autorizzazione)`)) return

            toast.loading('Pre-autorizzazione in corso...', { id: 'mit' })

            const mitPayload = {
                contractId,
                amount: Number(cauzione.importo),
                description: `Cauzione ${cauzione.veicolo_modello || ''} - ${cauzione.cliente_nome || ''}`,
                bookingId: cauzione.riferimento_contratto_id || null,
                customerName: cauzione.cliente_nome || '',
                captureType: 'EXPLICIT'
            }

            const res = await authFetch('/.netlify/functions/nexi-charge-mit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mitPayload)
            })
            const result = await res.json()
            toast.dismiss('mit')

            if (!res.ok) {
                if (JSON.stringify(result).toLowerCase().includes('implicit')) {
                    // Contract doesn't support pre-auth — tell admin to use pay link instead
                    toast.error('La carta di questo cliente non supporta la pre-autorizzazione. Usa "INVIA LINK" per creare un pagamento con blocco.')
                } else {
                    toast.error('Pre-autorizzazione fallita: ' + (result.error || 'Errore'))
                }
                return
            }

            toast.success(`€${Number(cauzione.importo).toFixed(2)} bloccato sulla carta!`)
            await supabase.from('cauzioni').update({
                stato: 'Attiva',
                nexi_transaction_id: result.operationId || result.orderId,
                nexi_order_id: result.orderId,
                note: `Pre-auth MIT — €${Number(cauzione.importo).toFixed(2)} bloccati sulla carta — ${new Date().toLocaleDateString('it-IT')}`,
                updated_at: new Date().toISOString()
            }).eq('id', cauzione.id)
            fetchCauzioni()
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            toast.dismiss('mit')
            toast.error(_errMsg || 'Errore')
        }
    }

    const handleSendPayLink = async (cauzione: Cauzione) => {
        try {
            toast.loading('Generazione link pre-autorizzazione...', { id: 'paylink' })

            // Use nexi-create-preauth for cauzioni — holds the money without charging
            const response = await authFetch('/.netlify/functions/nexi-create-preauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cauzioneId: cauzione.id,
                    amount: cauzione.importo,
                    customerEmail: cauzione.cliente_email || '',
                    customerName: cauzione.cliente_nome || 'Cliente',
                    description: `Cauzione ${cauzione.veicolo_modello || ''} - ${cauzione.cliente_nome || ''}`
                })
            })
            const result = await response.json()
            toast.dismiss('paylink')

            if (!response.ok) throw new Error(result.error || 'Errore generazione link')

            if (result.paymentUrl) {
                // Copy to clipboard (with fallback)
                try {
                    await navigator.clipboard.writeText(result.paymentUrl)
                    toast.success('Link pre-autorizzazione copiato!')
                } catch {
                    // Fallback: prompt user to copy manually
                    prompt('Copia il link:', result.paymentUrl)
                }

                // Send via WhatsApp if phone available
                const phone = cauzione.cliente_telefono
                if (phone) {
                    await fetch('/.netlify/functions/send-whatsapp-notification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: phone,
                            customMessage: `Gentile ${cauzione.cliente_nome || 'Cliente'},\n\nPer completare la pre-autorizzazione della cauzione di *€${Number(cauzione.importo).toFixed(2)}* per ${cauzione.veicolo_modello || 'il veicolo'}, clicchi qui:\n${result.paymentUrl}\n\nL'importo verrà solo bloccato sulla carta e sbloccato al termine del noleggio.\n\nGrazie,\nDR7`
                        })
                    })
                    toast.success('Link inviato via WhatsApp!')
                }

                fetchCauzioni()
            }
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            toast.dismiss('paylink')
            toast.error(_errMsg || 'Errore')
        }
    }

    const handleCreatePreauth = async (cauzione: Cauzione) => {
        try {
            const response = await authFetch('/.netlify/functions/nexi-create-preauth', {
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error creating preauth:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    const handleMarkSbloccataPreauth = async (cauzione: Cauzione) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nexiTransactionId = (cauzione as any).nexi_transaction_id

            if (nexiTransactionId) {
                const response = await authFetch('/.netlify/functions/nexi-void-preauth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cauzioneId: cauzione.id,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        operationId: (cauzione as any).nexi_operation_id || nexiTransactionId,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error marking sbloccata:', error)
            toast.error(`Errore: ${_errMsg}`)
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nexiTransactionId = (cauzione as any).nexi_transaction_id

            if (nexiTransactionId) {
                const response = await authFetch('/.netlify/functions/nexi-capture-preauth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cauzioneId: cauzione.id,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        operationId: (cauzione as any).nexi_operation_id || nexiTransactionId,
                        amount: amount,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error capturing payment:', error)
            toast.error(`Errore: ${_errMsg}`)
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error marking incassata:', error)
            toast.error(`Errore: ${_errMsg}`)
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error marking da incassare:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    const handleCassa = async (cauzione: Cauzione) => {
        try {
            const { error } = await supabase
                .from('cauzioni')
                .update({
                    stato: 'Bloccata',
                    note: 'Incassata in cassa',
                    data_incasso: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', cauzione.id)

            if (error) throw error
            toast.success('Cauzione incassata in cassa')
            fetchCauzioni()
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error marking cauzione as danno:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    const handleRevertStato = async (cauzione: Cauzione, newStato: string) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error reverting cauzione:', error)
            toast.error(`Errore: ${_errMsg}`)
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
        if (cauzione.stato === 'Incassata') return 'bg-purple-600 text-white'
        if (!cauzione.data_incasso) return 'bg-yellow-600 text-black' // Da incassare
        if (cauzione.is_overdue) return 'bg-red-600 text-white'
        if (cauzione.stato === 'In scadenza') return 'bg-yellow-600 text-black'
        if (cauzione.nexi_transaction_id && cauzione.metodo === 'preautorizzazione') return 'bg-blue-600 text-white' // Pre-autorizzata
        return 'bg-green-600 text-white' // Attiva
    }

    const getStatoLabel = (cauzione: Cauzione) => {
        if (cauzione.stato === 'Bloccata') return 'Bloccata'
        if (cauzione.stato === 'Incassata') return 'Incassata'
        if (!cauzione.data_incasso) return 'Da incassare'
        if (cauzione.is_overdue) return 'Scaduta'
        if (cauzione.stato === 'In scadenza') return 'In scadenza'
        // Show Pre-autorizzata when preauth exists (nexi_transaction_id set, metodo preautorizzazione)
        if (cauzione.nexi_transaction_id && cauzione.metodo === 'preautorizzazione') return 'Pre-autorizzata'
        return 'Attiva'
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
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowStorico(true)}
                        className="p-2 bg-theme-bg-tertiary border border-theme-border rounded-full hover:bg-theme-bg-hover transition-colors"
                        title="Storico"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.05 11a9 9 0 1 1 .5 4m-.5-4v4h4" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setShowModal(true)}
                        className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors"
                    >
                        Nuova Cauzione
                    </button>
                </div>
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
                                                className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-[#247a6f] transition-colors font-semibold"
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
                                                className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-[#247a6f] transition-colors font-semibold"
                                            >
                                                INCASSA
                                            </button>
                                            <button
                                                onClick={() => handleAddebitaMIT(cauzione)}
                                                className="px-3 py-2 bg-green-600 text-white text-xs rounded-full hover:bg-green-700 transition-colors font-semibold"
                                            >
                                                PRE-AUTH
                                            </button>
                                            <button
                                                onClick={() => handleSendPayLink(cauzione)}
                                                className="px-3 py-2 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors font-semibold"
                                            >
                                                INVIA LINK
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

            {/* === STORICO SLIDE-OVER PANEL === */}
            {showStorico && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowStorico(false)} />
                    <div className="relative w-full max-w-3xl bg-theme-bg-primary shadow-xl overflow-y-auto animate-slide-in-right">
                        <div className="sticky top-0 bg-theme-bg-primary border-b border-theme-border p-4 flex justify-between items-center z-10">
                            <h3 className="text-xl font-bold text-theme-text-primary">Storico Cauzioni ({storicoCauzioni.length})</h3>
                            <button
                                onClick={() => setShowStorico(false)}
                                className="p-2 hover:bg-theme-bg-hover rounded-full transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {storicoCauzioni.length === 0 ? (
                                <p className="text-center text-theme-text-secondary py-8">Nessuna cauzione nello storico</p>
                            ) : (
                                storicoCauzioni.map((cauzione) => (
                                    <div key={cauzione.id} className="bg-theme-bg-tertiary border border-theme-border rounded-2xl p-4">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <div className="font-semibold text-theme-text-primary">{cauzione.cliente_nome}</div>
                                                <div className="text-sm text-theme-text-secondary">{cauzione.veicolo_modello} — {cauzione.veicolo_targa}</div>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStoricoStatoBadge(cauzione.stato)}`}>
                                                {cauzione.stato}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                                            <div>
                                                <span className="text-theme-text-secondary">Importo: </span>
                                                <span className="font-semibold text-theme-text-primary">€{Number(cauzione.importo).toFixed(2)}</span>
                                            </div>
                                            <div>
                                                <span className="text-theme-text-secondary">Metodo: </span>
                                                <span className="text-theme-text-primary capitalize">{cauzione.metodo}</span>
                                            </div>
                                            <div>
                                                <span className="text-theme-text-secondary">Data: </span>
                                                <span className="text-theme-text-primary">{new Date(cauzione.updated_at).toLocaleDateString('it-IT')}</span>
                                            </div>
                                        </div>
                                        {cauzione.note && (
                                            <div className="text-sm text-theme-text-secondary mb-3">
                                                <span className="font-medium">Note:</span> {cauzione.note}
                                            </div>
                                        )}
                                        <div className="flex gap-2 flex-wrap">
                                            <button
                                                onClick={() => { setShowStorico(false); handleEdit(cauzione) }}
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
                                                    className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-[#247a6f] transition-colors font-semibold"
                                                >
                                                    INCASSATA
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

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
