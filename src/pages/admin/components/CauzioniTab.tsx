import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import NuovaCauzioneModal from './NuovaCauzioneModal'
import CassaCauzioneModal from './CassaCauzioneModal'
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
    const [cassaCauzione, setCassaCauzione] = useState<Cauzione | null>(null)

    // KPI Stats
    const [stats, setStats] = useState({
        incassate: 0,
        in_cassa: 0,
        da_incassare: 0,
        scadute: 0,
        a_rischio: 0,
        totale_attive: 0,
        totale_incassate: 0,
        totale_da_incassare: 0,
        totale_in_cassa: 0,
        totale_attive_amount: 0,
        totale_scadute_amount: 0,
        totale_rischio_amount: 0,
        byMonth: [] as Array<{ key: string; label: string; count: number; amount: number }>,
        topClienti: [] as Array<{ id: string; nome: string; count: number; amount: number }>,
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
          customers_extended!cliente_id(nome, cognome, denominazione, ragione_sociale, tipo_cliente, email, telefono),
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

            // Fallback: when veicolo_id was nulled (vehicle deleted) or the join missed,
            // resolve the vehicle from the linked booking — bookings keep vehicle_name /
            // vehicle_plate as denormalized strings even after the vehicle is removed.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const needsBookingLookup: any[] = (data || []).filter((c: any) => {
                const v = c.vehicles
                const hasVehicle = v && (v.display_name || v.plate)
                return !hasVehicle && c.riferimento_contratto_id
            })
            if (needsBookingLookup.length > 0) {
                const bookingIds = [...new Set(needsBookingLookup.map(c => c.riferimento_contratto_id).filter(Boolean))]
                const { data: bookingRows } = await supabase
                    .from('bookings')
                    .select('id, vehicle_name, vehicle_plate, booking_details')
                    .in('id', bookingIds)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const bookingMap: Record<string, any> = {}
                ;(bookingRows || []).forEach(b => { bookingMap[b.id] = b })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data = (data || []).map((c: any) => {
                    if (c.vehicles && (c.vehicles.display_name || c.vehicles.plate)) return c
                    const b = c.riferimento_contratto_id ? bookingMap[c.riferimento_contratto_id] : null
                    if (!b) return c
                    const fallbackName = b.vehicle_name || b.booking_details?.vehicleMakeModel || ''
                    const fallbackPlate = b.vehicle_plate || ''
                    if (!fallbackName && !fallbackPlate) return c
                    return { ...c, vehicles: { display_name: fallbackName, plate: fallbackPlate } }
                })
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
                    cliente_telefono: c.customers_extended?.telefono || '',
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
        const scaduteList = visible.filter(c => c.is_overdue)
        const scadute = scaduteList.length
        // "A rischio": cauzioni attive (non scadute, non incassate) entro 3 gg.
        const rischioList = daIncassareList.filter(c => !c.is_overdue && c.days_until_deadline <= 3 && c.days_until_deadline >= 0)
        const a_rischio = rischioList.length

        const totale_incassate = incassateList.reduce((sum, c) => sum + Number(c.importo), 0)
        const totale_da_incassare = daIncassareList.reduce((sum, c) => sum + Number(c.importo), 0)
        const totale_in_cassa = inCassaList.reduce((sum, c) => sum + Number(c.importo), 0)
        const totale_attive = visible.length + in_cassa
        const totale_attive_amount = visible.reduce((s, c) => s + Number(c.importo), 0) + totale_in_cassa
        const totale_scadute_amount = scaduteList.reduce((s, c) => s + Number(c.importo), 0)
        const totale_rischio_amount = rischioList.reduce((s, c) => s + Number(c.importo), 0)

        // Andamento ultimi 6 mesi: count + somma importi per mese di created_at.
        const now = new Date()
        const monthKeys: string[] = []
        const byMonthMap = new Map<string, { count: number; amount: number }>()
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            monthKeys.push(key)
            byMonthMap.set(key, { count: 0, amount: 0 })
        }
        cauzioni.forEach(c => {
            const d = new Date(c.created_at)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            const b = byMonthMap.get(key)
            if (!b) return
            b.count++
            b.amount += Number(c.importo) || 0
        })
        const byMonth = monthKeys.map(key => {
            const [y, m] = key.split('-').map(Number)
            const dd = new Date(y, m - 1, 1)
            return {
                key,
                label: dd.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
                count: byMonthMap.get(key)!.count,
                amount: byMonthMap.get(key)!.amount,
            }
        })

        // Top clienti per cauzioni ATTIVE (non chiuse).
        const clienteMap = new Map<string, { id: string; nome: string; count: number; amount: number }>()
        const activeForRanking = [...visible, ...inCassaList]
        activeForRanking.forEach(c => {
            const id = c.cliente_id || 'unknown'
            const nome = c.cliente_nome || 'N/A'
            const cur = clienteMap.get(id) || { id, nome, count: 0, amount: 0 }
            cur.count++
            cur.amount += Number(c.importo) || 0
            clienteMap.set(id, cur)
        })
        const topClienti = Array.from(clienteMap.values()).sort((a, b) => b.amount - a.amount).slice(0, 4)

        setStats({
            incassate, in_cassa, da_incassare, scadute, a_rischio,
            totale_attive,
            totale_incassate, totale_da_incassare, totale_in_cassa,
            totale_attive_amount, totale_scadute_amount, totale_rischio_amount,
            byMonth, topClienti,
        })
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

    /**
     * Fire-and-forget: notifica al sistema Messaggi di Sistema Pro che e'
     * accaduto un evento cauzione (collected, refunded, ecc.). Il backend
     * (trigger-system-event netlify function) carica l'entita', costruisce
     * il synthetic booking col cliente reale e dispatcha ai template Pro
     * con quel trigger_event configurato. Non blocca il flusso UI.
     */
    const fireCauzioneEvent = async (cauzioneId: string, event: string) => {
        try {
            await fetch('/.netlify/functions/trigger-system-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event, entityType: 'cauzione', entityId: cauzioneId }),
            })
        } catch (e) {
            console.warn(`[CauzioniTab] ${event} trigger failed (non-blocking):`, e)
        }
    }

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
            fireCauzioneEvent(cauzione.id, 'on_cauzione_refunded')
            fetchCauzioni()
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error marking restituita:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    // @ts-ignore
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
                    description: `Cauzione ${cauzione.veicolo_modello || ''} - ${cauzione.cliente_nome || ''}`,
                    expirationHours: 1
                })
            })
            const result = await response.json()
            toast.dismiss('paylink')

            if (!response.ok) throw new Error(result.error || 'Errore generazione link')

            if (result.paymentUrl) {
                // Send via WhatsApp first (priority)
                const phone = cauzione.cliente_telefono
                if (phone) {
                    const contractRef = (cauzione.riferimento_contratto_id || '').substring(0, 8).toUpperCase() || 'N/A'
                    const sendRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: phone,
                            // BUG FIX 2026-05-13: era 'pro_richiesta_cauzione' hardcoded.
                            // Adesso legacy event key — il resolver sceglie il template
                            // via handled_events (custom > canonical).
                            templateKey: 'deposit_request_customer',
                            booking: { service_type: 'rental' },
                            templateVars: (() => {
                                const customerName = cauzione.cliente_nome || 'Cliente'
                                const amountStr = Number(cauzione.importo).toFixed(2)
                                return {
                                    '{customer_name}': customerName,
                                    '{nome}': customerName.split(' ')[0] || 'Cliente',
                                    '{amount}': amountStr,
                                    '{total}': amountStr,
                                    '{importo}': amountStr,
                                    '{link}': result.paymentUrl,
                                    '{payment_link}': result.paymentUrl,
                                    '{contract_ref}': contractRef,
                                    '{contratto}': contractRef,
                                    '{booking_ref}': contractRef,
                                    '{booking_id}': contractRef,
                                }
                            })(),
                            skipHeader: false,
                        })
                    })
                    const sendJson = await sendRes.json().catch(() => ({}))
                    if (sendJson?.skipped && sendJson?.reason === 'pro_template_unavailable') {
                        toast.error('Template mancante in Messaggi di Sistema Pro')
                    } else {
                        toast.success('Link cauzione inviato via WhatsApp al cliente!')
                    }
                } else {
                    // No phone — copy to clipboard as fallback
                    try {
                        await navigator.clipboard.writeText(result.paymentUrl)
                        toast.success('Link copiato! Nessun telefono trovato per inviare WhatsApp.')
                    } catch {
                        prompt('Nessun telefono trovato. Copia il link:', result.paymentUrl)
                    }
                }

                fetchCauzioni()
            }
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            toast.dismiss('paylink')
            toast.error(_errMsg || 'Errore')
        }
    }

    // @ts-ignore
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
                    description: `Cauzione ${cauzione.veicolo_modello} - ${cauzione.cliente_nome}`,
                    expirationHours: 1
                })
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Errore creazione preautorizzazione')
            }

            if (result.paymentUrl) {
                // Copy to clipboard
                try {
                    await navigator.clipboard.writeText(result.paymentUrl)
                } catch { /* ignore */ }

                // Send via WhatsApp with full branded message
                const phone = cauzione.cliente_telefono
                if (phone) {
                    const contractRef = (cauzione.riferimento_contratto_id || '').substring(0, 8).toUpperCase() || 'N/A'
                    const sendRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: phone,
                            // BUG FIX 2026-05-13: era 'pro_richiesta_cauzione' hardcoded.
                            templateKey: 'deposit_request_customer',
                            booking: { service_type: 'rental' },
                            templateVars: (() => {
                                const customerName = cauzione.cliente_nome || 'Cliente'
                                const amountStr = Number(cauzione.importo).toFixed(2)
                                return {
                                    '{customer_name}': customerName,
                                    '{nome}': customerName.split(' ')[0] || 'Cliente',
                                    '{amount}': amountStr,
                                    '{total}': amountStr,
                                    '{importo}': amountStr,
                                    '{link}': result.paymentUrl,
                                    '{payment_link}': result.paymentUrl,
                                    '{contract_ref}': contractRef,
                                    '{contratto}': contractRef,
                                    '{booking_ref}': contractRef,
                                    '{booking_id}': contractRef,
                                }
                            })(),
                            skipHeader: false,
                        })
                    })
                    const sendJson = await sendRes.json().catch(() => ({}))
                    if (sendJson?.skipped && sendJson?.reason === 'pro_template_unavailable') {
                        toast.error('Template mancante in Messaggi di Sistema Pro')
                    } else {
                        toast.success('Link cauzione inviato via WhatsApp!')
                    }
                } else {
                    toast.success('Link cauzione creato e copiato!')
                }
            }

            fetchCauzioni()
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error creating preauth:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    // @ts-ignore
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

    // Capture full preauth amount
    // @ts-ignore
    const handleIncassaFull = async (cauzione: Cauzione) => {
        const amount = Number(cauzione.importo)
        try {
            toast.loading(`Incasso €${amount.toFixed(2)} in corso...`, { id: 'capture' })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nexiTransactionId = (cauzione as any).nexi_transaction_id
            if (nexiTransactionId) {
                const response = await fetch('/.netlify/functions/nexi-capture-preauth', {
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
                toast.dismiss('capture')
                if (!response.ok) throw new Error(result.error || 'Errore Nexi')
                toast.success(`Incassato €${amount.toFixed(2)} con successo!`)
            } else {
                toast.dismiss('capture')
                // No Nexi transaction — mark manually
                await supabase.from('cauzioni').update({
                    stato: 'Incassata',
                    data_incasso: new Date().toISOString(),
                    note: `Incassato €${amount.toFixed(2)} manualmente`,
                    updated_at: new Date().toISOString()
                }).eq('id', cauzione.id)
                toast.success(`Incassato €${amount.toFixed(2)} (manuale)`)
            }
            fireCauzioneEvent(cauzione.id, 'on_cauzione_collected')
            fetchCauzioni()
        } catch (error: unknown) {
            toast.dismiss('capture')
            const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error capturing:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    // Capture partial preauth amount (with prompt)
    // @ts-ignore
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

            // Distingui partial vs full capture: se l'admin incassa MENO
            // dell'importo totale della cauzione, fire on_cauzione_partial_capture
            // (cosi' template diversi possono partire). Sempre fire anche
            // on_cauzione_collected per retro-compatibilita'.
            const isPartial = amount > 0 && amount < cauzione.importo
            if (isPartial) {
                fireCauzioneEvent(cauzione.id, 'on_cauzione_partial_capture')
            }
            fireCauzioneEvent(cauzione.id, 'on_cauzione_collected')
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
            fireCauzioneEvent(cauzione.id, 'on_cauzione_collected')
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

    const handleCassa = (cauzione: Cauzione) => {
        setCassaCauzione(cauzione)
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
    // Mobile-friendly card alternative: same data as the table row, stacked
    // vertically for phones (<sm). Action buttons are min-h-[44px] for touch.
    const renderCard = (cauzione: Cauzione, actions: React.ReactNode) => (
        <div
            key={`card-${cauzione.id}`}
            className={`border border-theme-border rounded-2xl bg-theme-bg-secondary p-3 ${cauzione.is_overdue ? 'border-l-4 border-l-red-500' : ''}`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-theme-text-primary truncate">{cauzione.cliente_nome}</div>
                    <div className="text-xs text-theme-text-secondary truncate">{cauzione.veicolo_modello} · {cauzione.veicolo_targa}</div>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase ${getStatoBadgeClass(cauzione)}`}>
                    {getStatoLabel(cauzione)}
                </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                <div>
                    <div className="text-theme-text-muted uppercase tracking-wider">Restituzione</div>
                    <div className="text-theme-text-primary">{new Date(cauzione.data_restituzione_veicolo + 'T00:00:00').toLocaleDateString('it-IT')}</div>
                </div>
                <div>
                    <div className="text-theme-text-muted uppercase tracking-wider">Scadenza</div>
                    <div className="text-theme-text-primary">
                        {new Date(cauzione.scadenza_cauzione + 'T00:00:00').toLocaleDateString('it-IT')}
                        {cauzione.days_until_deadline !== null && (
                            <span className="ml-1 text-[10px] text-theme-text-secondary">
                                ({cauzione.days_until_deadline > 0
                                    ? `${cauzione.days_until_deadline}g`
                                    : cauzione.days_until_deadline === 0
                                        ? 'oggi'
                                        : `${Math.abs(cauzione.days_until_deadline)}g fa`})
                            </span>
                        )}
                    </div>
                </div>
                <div>
                    <div className="text-theme-text-muted uppercase tracking-wider">Importo</div>
                    <div className="text-theme-text-primary font-semibold">€{Number(cauzione.importo).toFixed(2)}</div>
                </div>
                <div>
                    <div className="text-theme-text-muted uppercase tracking-wider">Metodo</div>
                    <div className="text-theme-text-primary capitalize">{cauzione.metodo}</div>
                </div>
            </div>
            <div className="flex gap-2 flex-wrap mt-3 [&_button]:flex-1 [&_button]:min-h-[40px]">
                {actions}
            </div>
        </div>
    )

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
            <td className="px-4 py-3 whitespace-nowrap">
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${getStatoBadgeClass(cauzione)}`}>
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
        <div className="p-6 space-y-4 lg:space-y-6">
            {/* Hero Header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
                <div className="absolute -top-12 -right-12 w-56 h-56 bg-dr7-gold/10 rounded-full blur-3xl pointer-events-none"/>
                <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"/>
                <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-xl bg-dr7-gold/10 border border-dr7-gold/30 grid place-items-center flex-shrink-0">
                            <svg className="w-5 h-5 text-dr7-gold" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">Cauzioni Amministrazione</h2>
                            <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Gestisci tutte le cauzioni, i pagamenti e lo stato</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowStorico(true)}
                            className="px-3 py-2 rounded-full bg-theme-bg-tertiary border border-theme-border hover:bg-theme-bg-hover text-theme-text-secondary text-xs font-medium flex items-center gap-1.5 transition-colors"
                            title="Storico"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3"/><path strokeLinecap="round" strokeLinejoin="round" d="M3.05 11a9 9 0 1 1 .5 4m-.5-4v4h4"/></svg>
                            Storico
                        </button>
                        <button
                            onClick={() => setShowModal(true)}
                            className="px-4 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors text-sm shadow-lg shadow-dr7-gold/20"
                        >
                            + Nuova Cauzione
                        </button>
                    </div>
                </div>
            </div>

            {/* 6 KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <CauzioneKpi label="Cauzioni Incassate" count={stats.incassate} amount={stats.totale_incassate} ring="#10B981"/>
                <CauzioneKpi label="Da Incassare" count={stats.da_incassare} amount={stats.totale_da_incassare} ring="#F59E0B"/>
                <CauzioneKpi label="In Cassa" count={stats.in_cassa} amount={stats.totale_in_cassa} ring="#EF4444"/>
                <CauzioneKpi label="Totale Attive" count={stats.totale_attive} amount={stats.totale_attive_amount} ring="#A855F7"/>
                <CauzioneKpi label="Scadute" count={stats.scadute} amount={stats.totale_scadute_amount} ring="#DC2626" urgent={stats.scadute > 0}/>
                <CauzioneKpi label="A Rischio" count={stats.a_rischio} amount={stats.totale_rischio_amount} ring="#EAB308" urgent={stats.a_rischio > 0}/>
            </div>

            {/* 2-column layout: main (8) + right sidebar (4) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="xl:col-span-8 space-y-4">

            {/* Filters */}
            <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-4">
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
                    </select>
                </div>
            </div>

            {/* === SECTION: INCASSATE === */}
            <div className="mb-8">
                <h3 className="text-lg font-bold text-green-500 mb-3 flex items-center gap-2">
                    INCASSATE
                    <span className="text-sm font-normal text-theme-text-secondary">({incassate.length})</span>
                </h3>
                {/* Mobile: card list. Desktop (sm+): full table. */}
                {(() => {
                    const actions = (cauzione: Cauzione) => (
                        <>
                            <button onClick={() => handleEdit(cauzione)} className="px-3 py-2 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors">Modifica</button>
                            <button onClick={() => handleSegnaDaIncassare(cauzione)} className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-[#0A8FA3] transition-colors font-semibold">DA INCASSARE</button>
                            <button onClick={() => handleCassa(cauzione)} className="px-3 py-2 bg-red-600 text-white text-xs rounded-full hover:bg-red-700 transition-colors">CASSA</button>
                            <button onClick={() => handleMarkRestituita(cauzione)} className="px-3 py-2 bg-green-600 text-white text-xs rounded-full hover:bg-green-700 transition-colors">RESTITUITA</button>
                        </>
                    )
                    if (incassate.length === 0) {
                        return <div className="border border-theme-border rounded-2xl px-4 py-6 text-center text-theme-text-secondary">Nessuna cauzione incassata</div>
                    }
                    return (
                        <>
                            <div className="sm:hidden space-y-3">
                                {incassate.map(c => renderCard(c, actions(c)))}
                            </div>
                            <div className="hidden sm:block border border-theme-border rounded-3xl overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        {tableHeader}
                                        <tbody>
                                            {incassate.map(c => renderRow(c, actions(c)))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )
                })()}
            </div>

            {/* === SECTION: DA INCASSARE === */}
            <div className="mb-8">
                <h3 className="text-lg font-bold text-yellow-500 mb-3 flex items-center gap-2">
                    DA INCASSARE
                    <span className="text-sm font-normal text-theme-text-secondary">({daIncassare.length})</span>
                </h3>
                {(() => {
                    const actions = (cauzione: Cauzione) => (
                        <>
                            <button onClick={() => handleEdit(cauzione)} className="px-3 py-2 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors">Modifica</button>
                            <button onClick={() => handleSegnaIncassata(cauzione)} className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-[#0A8FA3] transition-colors font-semibold">INCASSA</button>
                            <button onClick={() => handleSendPayLink(cauzione)} className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-dr7-gold/80 transition-colors font-semibold">INVIA LINK</button>
                            <button onClick={() => handleMarkRestituita(cauzione)} className="px-3 py-2 bg-green-600 text-white text-xs rounded-full hover:bg-green-700 transition-colors">RESTITUITA</button>
                        </>
                    )
                    if (daIncassare.length === 0) {
                        return <div className="border border-theme-border rounded-2xl px-4 py-6 text-center text-theme-text-secondary">Nessuna cauzione da incassare</div>
                    }
                    return (
                        <>
                            <div className="sm:hidden space-y-3">
                                {daIncassare.map(c => renderCard(c, actions(c)))}
                            </div>
                            <div className="hidden sm:block border border-theme-border rounded-3xl overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        {tableHeader}
                                        <tbody>
                                            {daIncassare.map(c => renderRow(c, actions(c)))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )
                })()}
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
                                                    className="px-3 py-2 bg-dr7-gold text-white text-xs rounded-full hover:bg-[#0A8FA3] transition-colors font-semibold"
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

            {/* Bottom row: Andamento 6 mesi + Top Clienti + Analisi donut */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Andamento ultimi 6 mesi */}
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">Andamento cauzioni</h3>
                        <span className="text-[10px] text-theme-text-muted">ultimi 6 mesi</span>
                    </div>
                    <CauzioniMonthlyBars data={stats.byMonth}/>
                </div>

                {/* Top Clienti */}
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">Top clienti</h3>
                        <span className="text-[10px] text-theme-text-muted">cauzioni attive</span>
                    </div>
                    {stats.topClienti.length === 0 ? (
                        <div className="text-xs text-theme-text-muted py-8 text-center">Nessun cliente con cauzioni attive</div>
                    ) : (
                        <div className="space-y-2.5">
                            {stats.topClienti.map((c, i) => {
                                const palette = ['bg-rose-500/20 text-rose-300 border-rose-500/40', 'bg-amber-500/20 text-amber-300 border-amber-500/40', 'bg-blue-500/20 text-blue-300 border-blue-500/40', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40']
                                const initials = c.nome.split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase() || '?'
                                return (
                                    <div key={c.id} className="flex items-center gap-2.5">
                                        <div className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border flex-shrink-0 ${palette[i % palette.length]}`}>{initials}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-theme-text-primary font-semibold truncate">{c.nome}</div>
                                            <div className="text-[10px] text-theme-text-muted">{c.count} {c.count === 1 ? 'cauzione' : 'cauzioni'}</div>
                                        </div>
                                        <div className="text-xs font-bold text-dr7-gold tabular-nums whitespace-nowrap">€{c.amount.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Analisi: donut percentuale incassato vs da incassare */}
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                    <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider mb-3">Analisi cauzioni</h3>
                    <CauzioniAnalysisDonut
                        incassate={stats.totale_incassate}
                        daIncassare={stats.totale_da_incassare}
                        inCassa={stats.totale_in_cassa}
                    />
                </div>
            </div>
            </div>{/* end main col */}

            {/* Right sidebar */}
            <aside className="xl:col-span-4 space-y-4">
                <RiepilogoDonut stats={stats} />
                <ScadenzeProssime cauzioni={cauzioni} />
                <CauzioniARischio cauzioni={cauzioni} onCassa={handleCassa} />
                <AzioniRapide
                    onNuova={() => setShowModal(true)}
                    onStorico={() => setShowStorico(true)}
                />
                <ReportVeloci />
            </aside>

            </div>{/* end 8/4 grid */}

            {/* Modal */}
            {showModal && (
                <NuovaCauzioneModal
                    cauzione={selectedCauzione}
                    onClose={handleCloseModal}
                    onSave={handleSaveSuccess}
                />
            )}

            {/* Cassa Modal */}
            {cassaCauzione && (
                <CassaCauzioneModal
                    cauzione={cassaCauzione}
                    onClose={() => setCassaCauzione(null)}
                    onSuccess={() => { setCassaCauzione(null); fetchCauzioni() }}
                />
            )}
        </div>
    )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CauzioneKpi({ label, count, amount, ring, urgent }: {
    label: string
    count: number
    amount: number
    ring: string
    urgent?: boolean
}) {
    return (
        <div className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary p-4" style={{ borderColor: `${ring}33` }}>
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${ring}22` }}/>
            <div className="relative">
                <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: `${ring}cc` }}>{label}</div>
                <div className={`text-2xl lg:text-3xl font-bold mt-2 tabular-nums ${urgent ? 'animate-pulse' : ''}`} style={{ color: ring }}>{count}</div>
                <div className="text-[11px] text-theme-text-muted mt-1 tabular-nums">€{amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
        </div>
    )
}

function CauzioniMonthlyBars({ data }: { data: Array<{ key: string; label: string; count: number; amount: number }> }) {
    const maxCount = Math.max(...data.map(m => m.count), 1)
    const totalCount = data.reduce((s, m) => s + m.count, 0)
    const totalAmount = data.reduce((s, m) => s + m.amount, 0)
    if (totalCount === 0) {
        return <div className="text-xs text-theme-text-muted py-12 text-center">Nessuna cauzione negli ultimi 6 mesi</div>
    }
    return (
        <div>
            <div className="flex items-end gap-2 h-32 px-1">
                {data.map(m => {
                    const h = m.count > 0 ? Math.max(8, Math.round((m.count / maxCount) * 100)) : 0
                    return (
                        <div key={m.key} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${m.label}: ${m.count} cauzioni · €${m.amount.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}>
                            <div className="w-full flex flex-col justify-end h-full">
                                {m.count > 0 && (
                                    <div className="w-full rounded-t bg-gradient-to-t from-dr7-gold/40 via-dr7-gold/70 to-dr7-gold transition-all duration-300" style={{ height: `${h}%` }}/>
                                )}
                            </div>
                            <div className="text-[10px] text-theme-text-muted truncate w-full text-center">{m.label}</div>
                            <div className="text-[11px] font-bold text-theme-text-primary tabular-nums">{m.count > 0 ? m.count : ''}</div>
                        </div>
                    )
                })}
            </div>
            <div className="mt-3 pt-3 border-t border-theme-border flex items-center justify-between text-[11px]">
                <span className="text-theme-text-muted">Totale 6 mesi</span>
                <span className="text-theme-text-primary font-bold tabular-nums">{totalCount} · €{totalAmount.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
        </div>
    )
}

function CauzioniAnalysisDonut({ incassate, daIncassare, inCassa }: { incassate: number; daIncassare: number; inCassa: number }) {
    const total = incassate + daIncassare + inCassa
    if (total === 0) {
        return <div className="text-xs text-theme-text-muted py-8 text-center">Nessuna cauzione da analizzare</div>
    }
    const pctIncassate = Math.round((incassate / total) * 100)
    const slices = [
        { label: 'Incassate', value: incassate, pct: Math.round((incassate / total) * 100), color: '#10B981' },
        { label: 'Da incassare', value: daIncassare, pct: Math.round((daIncassare / total) * 100), color: '#F59E0B' },
        { label: 'In cassa', value: inCassa, pct: Math.round((inCassa / total) * 100), color: '#EF4444' },
    ].filter(s => s.value > 0)
    const r = 15.91549
    let offset = 0
    return (
        <div className="flex items-center gap-3">
            <div className="relative w-28 h-28 shrink-0">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-theme-bg-tertiary"/>
                    {slices.map((s, i) => {
                        const dash = `${s.pct}, 100`
                        const el = <circle key={i} cx="18" cy="18" r={r} fill="none" strokeWidth="4" stroke={s.color} strokeDasharray={dash} strokeDashoffset={-offset}/>
                        offset += s.pct
                        return el
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-emerald-400 tabular-nums">{pctIncassate}%</div>
                    <div className="text-[9px] text-theme-text-muted">incassate</div>
                </div>
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
                {slices.map(s => (
                    <div key={s.label} className="flex items-center gap-2 text-[11px]">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }}/>
                        <span className="text-theme-text-secondary flex-1 truncate">{s.label}</span>
                        <span className="text-theme-text-primary font-bold tabular-nums">€{s.value.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

/* ---------- Right sidebar components ---------- */

function fmtMoney(n: number): string {
    return `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Big donut + breakdown delle cauzioni attive per stato.
function RiepilogoDonut({ stats }: { stats: {
    incassate: number; da_incassare: number; in_cassa: number; scadute: number;
    totale_incassate: number; totale_da_incassare: number; totale_in_cassa: number;
    totale_attive_amount: number; totale_scadute_amount: number;
} }) {
    const total = stats.totale_attive_amount + stats.totale_incassate + stats.totale_in_cassa + stats.totale_scadute_amount
    const segments = [
        { label: 'Incassate',    value: stats.totale_incassate,     color: '#10B981' },
        { label: 'Da incassare', value: stats.totale_da_incassare,  color: '#F59E0B' },
        { label: 'In cassa',     value: stats.totale_in_cassa,      color: '#3B82F6' },
        { label: 'Scadute',      value: stats.totale_scadute_amount, color: '#EF4444' },
    ]
    const sum = segments.reduce((a, b) => a + b.value, 0) || 1
    // Build SVG donut
    const r = 56
    const c = 2 * Math.PI * r
    let offset = 0
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Riepilogo Cauzioni</h3>
            </div>
            <div className="flex items-center gap-4">
                <div className="relative w-32 h-32 shrink-0">
                    <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
                        <circle cx="70" cy="70" r={r} fill="none" stroke="currentColor" className="text-theme-bg-tertiary" strokeWidth={14}/>
                        {segments.map(s => {
                            const len = (s.value / sum) * c
                            const seg = (
                                <circle key={s.label} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth={14}
                                    strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt"/>
                            )
                            offset += len
                            return seg
                        })}
                    </svg>
                    <div className="absolute inset-0 grid place-items-center text-center">
                        <div>
                            <p className="text-base font-bold text-theme-text-primary tabular-nums leading-none">{fmtMoney(total)}</p>
                            <p className="text-[9px] uppercase tracking-wider text-theme-text-muted mt-0.5">totale</p>
                        </div>
                    </div>
                </div>
                <ul className="flex-1 space-y-1.5 min-w-0">
                    {segments.map(s => {
                        const pct = sum > 0 ? Math.round((s.value / sum) * 100) : 0
                        return (
                            <li key={s.label} className="flex items-center gap-2 text-[11px]">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }}/>
                                <span className="text-theme-text-secondary flex-1 truncate">{s.label}</span>
                                <span className="text-theme-text-primary font-semibold tabular-nums">{fmtMoney(s.value)}</span>
                                <span className="text-theme-text-muted tabular-nums w-9 text-right">{pct}%</span>
                            </li>
                        )
                    })}
                </ul>
            </div>
        </section>
    )
}

// Cauzioni Attive in scadenza nei prossimi 30 giorni.
function ScadenzeProssime({ cauzioni }: { cauzioni: Cauzione[] }) {
    const upcoming = cauzioni
        .filter(c => c.stato === 'Attiva' && typeof c.days_until_deadline === 'number' && c.days_until_deadline >= 0 && c.days_until_deadline <= 30)
        .sort((a, b) => a.days_until_deadline - b.days_until_deadline)
        .slice(0, 5)
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Scadenze prossime</h3>
                <span className="text-[10px] text-theme-text-muted">{upcoming.length}</span>
            </div>
            {upcoming.length === 0 ? (
                <p className="text-[11px] text-theme-text-muted italic">Nessuna scadenza nei prossimi 30 giorni.</p>
            ) : (
                <ul className="space-y-2">
                    {upcoming.map(c => {
                        const urgent = c.days_until_deadline <= 3
                        return (
                            <li key={c.id} className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-theme-text-primary truncate">{c.cliente_nome || 'Cliente'}</p>
                                    <p className="text-[10px] text-theme-text-muted truncate">{c.veicolo_modello || ''}{c.veicolo_targa ? ` · ${c.veicolo_targa}` : ''}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-theme-text-primary font-semibold tabular-nums">{fmtMoney(c.importo)}</p>
                                    <p className={'text-[10px] tabular-nums ' + (urgent ? 'text-red-400 font-semibold' : 'text-theme-text-muted')}>
                                        {c.days_until_deadline} {c.days_until_deadline === 1 ? 'giorno' : 'giorni'}
                                    </p>
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}

// Cauzioni scadute o in stato "danno" / "bloccata".
function CauzioniARischio({ cauzioni, onCassa }: { cauzioni: Cauzione[]; onCassa: (c: Cauzione) => void }) {
    const rischio = cauzioni
        .filter(c => c.is_overdue || c.stato === 'Bloccata' || c.stato === 'Danno')
        .sort((a, b) => (b.importo || 0) - (a.importo || 0))
        .slice(0, 4)
    return (
        <section className="rounded-2xl border border-red-500/20 bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-red-400">Cauzioni a rischio</h3>
                <span className="text-[10px] text-theme-text-muted">{rischio.length}</span>
            </div>
            {rischio.length === 0 ? (
                <p className="text-[11px] text-theme-text-muted italic">Nessuna cauzione a rischio.</p>
            ) : (
                <ul className="space-y-2">
                    {rischio.map(c => (
                        <li key={c.id} className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-theme-text-primary truncate">{c.cliente_nome || 'Cliente'}</p>
                                <p className="text-[10px] text-red-400 truncate">{c.stato}{c.is_overdue ? ' · scaduta' : ''}</p>
                            </div>
                            <span className="text-xs text-red-400 font-semibold tabular-nums">{fmtMoney(c.importo)}</span>
                            <button
                                type="button"
                                onClick={() => onCassa(c)}
                                className="px-2 py-1 rounded-full bg-red-500/10 border border-red-500/40 text-red-400 text-[10px] font-semibold hover:bg-red-500/20"
                            >
                                Incassa
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

function AzioniRapide({ onNuova, onStorico }: { onNuova: () => void; onStorico: () => void }) {
    const items = [
        { label: 'Nuova', icon: 'M12 5v14M5 12h14', onClick: onNuova },
        { label: 'Storico', icon: 'M12 8v4l3 3', onClick: onStorico },
        { label: 'Esporta CSV', icon: 'M12 5v12m0 0l-4-4m4 4l4-4', onClick: () => {
            // CSV download trigger handled inline — placeholder; fallback to no-op if not wired.
            window.alert('Esporta CSV disponibile dalla sezione Storico.')
        } },
        { label: 'Report', icon: 'M3 7h18M3 12h18M3 17h12', onClick: () => window.alert('Apri sezione Report (in arrivo).') },
        { label: 'Filtri', icon: 'M4 6h16M6 12h12M10 18h4', onClick: () => {
            const el = document.querySelector<HTMLInputElement>('input[placeholder="Cerca cliente, veicolo, targa..."]')
            el?.focus()
        } },
        { label: 'Stampa', icon: 'M6 9V2h12v7M6 18h12v4H6zM6 14h12', onClick: () => window.print() },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Azioni rapide</h3>
            <div className="grid grid-cols-3 gap-2">
                {items.map(it => (
                    <button
                        key={it.label}
                        type="button"
                        onClick={it.onClick}
                        className="flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-lg border border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover transition-colors"
                    >
                        <svg className="w-4 h-4 text-theme-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={it.icon}/>
                        </svg>
                        <span className="text-[10px] text-theme-text-secondary text-center leading-tight">{it.label}</span>
                    </button>
                ))}
            </div>
        </section>
    )
}

function ReportVeloci() {
    const reports = [
        { label: 'Cauzioni per cliente', filter: 'cliente' },
        { label: 'Cauzioni per veicolo', filter: 'veicolo' },
        { label: 'Cauzioni scadute', filter: 'scadute' },
        { label: 'Cauzioni incassate', filter: 'incassate' },
        { label: 'Andamento mensile', filter: 'andamento' },
    ]
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Report veloci</h3>
            <ul className="space-y-1.5">
                {reports.map(r => (
                    <li key={r.filter}>
                        <button
                            type="button"
                            onClick={() => window.alert(`Report "${r.label}" — in arrivo nella prossima iterazione.`)}
                            className="flex items-center justify-between w-full px-2 py-1.5 rounded text-xs text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors"
                        >
                            <span>{r.label}</span>
                            <svg className="w-3 h-3 text-theme-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                            </svg>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    )
}
