import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import toast from 'react-hot-toast'

interface CompletedBooking {
    id: string
    customer_name: string
    customer_email: string | null
    customer_phone: string | null
    service_type: string
    service_name: string
    end_date: string // dropoff_date OR appointment_date (for wash/mech)
    status: string
    price_total: number
    review_sent_at: string | null
}

export default function ReviewsTab() {
    const [bookings, setBookings] = useState<CompletedBooking[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [multiSelectMode, setMultiSelectMode] = useState(false)
    const [sending, setSending] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // WhatsApp template editor state
    const [waTemplateOpen, setWaTemplateOpen] = useState(false)
    const [waTemplate, setWaTemplate] = useState('')
    const [waDraft, setWaDraft] = useState('')
    const [waEditing, setWaEditing] = useState(false)
    const [waSaving, setWaSaving] = useState(false)
    const [waSentCount, setWaSentCount] = useState(0)
    const [waTesting, setWaTesting] = useState(false)

    useEffect(() => {
        loadCompletedBookings()
        loadWhatsAppData()
    }, [])

    async function loadCompletedBookings() {
        setLoading(true)
        try {
            // Fetch all bookings
            // We consider "completed" if status is 'completed' OR 'paid' OR if the date is in the past and status is not 'cancelled'
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .neq('status', 'cancelled')
                .order('created_at', { ascending: false })

            if (error) throw error

            const now = new Date()
            const completed: CompletedBooking[] = []

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data?.forEach((b: any) => {
                let endDateStr = b.dropoff_date
                if (!endDateStr && b.appointment_date) {
                    endDateStr = b.appointment_date // For mechanical/wash
                }

                if (endDateStr) {
                    const endDate = new Date(endDateStr)
                    // Check if date is in the past OR status is explicitly completed
                    if (endDate < now || b.status === 'completed') {
                        // Determine helpful service name
                        let serviceName = b.vehicle_name || b.service_name || b.service_type
                        if (b.service_type === 'car_wash') serviceName = `Lavaggio: ${b.service_name}`
                        if (b.service_type === 'mechanical_service') serviceName = `Meccanica: ${b.service_name}`

                        completed.push({
                            id: b.id,
                            customer_name: b.customer_name || 'Cliente',
                            customer_email: b.customer_email,
                            customer_phone: b.customer_phone,
                            service_type: b.service_type,
                            service_name: serviceName,
                            end_date: endDateStr,
                            status: b.status,
                            price_total: b.price_total,
                            review_sent_at: b.review_sent_at || null
                        })
                    }
                }
            })

            // Sort by end date descending (most recent finished first)
            completed.sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())

            setBookings(completed)
        } catch (err) {
            console.error('Error loading reviews tab data:', err)
        } finally {
            setLoading(false)
        }
    }

    async function loadWhatsAppData() {
        try {
            // Load template
            const { data: settingData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'review_whatsapp_template')
                .single()

            if (settingData?.value) {
                setWaTemplate(settingData.value)
            }

            // Load sent count
            const { count } = await supabase
                .from('review_whatsapp_sent')
                .select('id', { count: 'exact', head: true })

            setWaSentCount(count || 0)
        } catch (err) {
            console.error('Error loading WhatsApp review data:', err)
        }
    }

    async function saveWaTemplate() {
        setWaSaving(true)
        try {
            const { error } = await supabase
                .from('app_settings')
                .upsert({
                    key: 'review_whatsapp_template',
                    value: waDraft,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' })

            if (error) throw error

            setWaTemplate(waDraft)
            setWaEditing(false)
            toast.success('Template WhatsApp salvato!')
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error saving WhatsApp template:', error)
            toast.error(`Errore nel salvataggio: ${_errMsg}`)
        } finally {
            setWaSaving(false)
        }
    }

    async function sendWaTest() {
        setWaTesting(true)
        try {
            const template = waTemplate || 'Ciao {nome} 👋🏻\n\nQuesto è un messaggio di test dal sistema recensioni DR7.'
            const testMessage = template.replace(/\{nome\}/g, 'Test')

            const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customMessage: testMessage
                })
            })

            const result = await response.json()

            if (response.ok && result.success) {
                toast.success('Messaggio test inviato al numero admin!')
            } else {
                throw new Error(result.message || result.error || 'Errore invio')
            }
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error sending test WhatsApp:', error)
            toast.error('Errore test: ' + _errMsg)
        } finally {
            setWaTesting(false)
        }
    }

    const filteredBookings = bookings.filter(b =>
        b.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (b.customer_email && b.customer_email.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const handleSelectAll = () => {
        // Only select those who haven't received a review yet
        const eligibleBookings = filteredBookings.filter(b => !b.review_sent_at)

        if (selectedIds.size === eligibleBookings.length && eligibleBookings.length > 0) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(eligibleBookings.map(b => b.id)))
        }
    }

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedIds(newSet)
    }

    const executeSend = async (bookingsToSend: CompletedBooking[]) => {
        setSending(true)
        try {
            // Map to minimal data for email function
            const payload = bookingsToSend.map(b => ({
                name: b.customer_name,
                email: b.customer_email,
                service: b.service_name
            }))

            const response = await fetch('/.netlify/functions/send-review-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookings: payload })
            })

            const result = await response.json()

            if (result.success) {
                // Update DB only for successfully sent
                const sentIds = bookingsToSend.map(b => b.id)
                const { error: updateError } = await supabase
                    .from('bookings')
                    .update({ review_sent_at: new Date().toISOString() })
                    .in('id', sentIds)

                if (updateError) {
                    console.error('Error updating review status in DB:', updateError)
                    toast.error('Email inviate ma errore aggiornamento DB. Contatta supporto se persiste.')
                } else {
                    toast.success(`Richieste inviate a ${result.sent} clienti!`)
                    // Update local state to reflect change immediately
                    const sentIdSet = new Set(sentIds)
                    setBookings(bookings.map(b =>
                        sentIdSet.has(b.id)
                            ? { ...b, review_sent_at: new Date().toISOString() }
                            : b
                    ))
                    setSelectedIds(new Set())
                    setMultiSelectMode(false)
                }

            } else {
                throw new Error(result.error || 'Errore invio')
            }

        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error sending review requests:', error)
            toast.error('Errore: ' + _errMsg)
        } finally {
            setSending(false)
        }
    }

    const handleSendReviews = async () => {
        if (selectedIds.size === 0) return
        const selectedBookings = bookings.filter(b => selectedIds.has(b.id))
        await executeSend(selectedBookings)
    }

    const handleSendSingle = async (booking: CompletedBooking) => {
        await executeSend([booking])
    }

    // Generate two preset codes (€100 supercar + €10 lavaggio) for a customer
    // who left a review, then offer to send them via WhatsApp.
    // Codes land in `discount_codes` so they're tracked in the Codice Sconto tab.
    const [generatingCodesFor, setGeneratingCodesFor] = useState<string | null>(null)
    const handleGenerateReviewCodes = async (booking: CompletedBooking) => {
        if (!booking.customer_email && !booking.customer_phone) {
            toast.error('Email o telefono cliente mancanti')
            return
        }
        setGeneratingCodesFor(booking.id)
        try {
            const res = await fetch('/.netlify/functions/generate-review-codes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerEmail: booking.customer_email || null,
                    customerPhone: booking.customer_phone || null,
                    customerName: booking.customer_name || '',
                    source: 'review',
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                toast.error('Errore generazione codici: ' + (data.error || res.status))
                return
            }
            const rentalCode = data.rentalCode as string
            const carwashCode = data.carwashCode as string

            const firstName = (booking.customer_name || '').split(' ')[0] || 'Cliente'
            const messageBody = `Grazie Mille per la recensione☺️\n\n` +
                `In qualità di nostro cliente, abbiamo il piacere di riservarti un pensiero dedicato, in linea con il tuo stile 🎁\n\n` +
                `Per questo ti abbiamo riservato:\n\n` +
                `Credito personale di *€100* utilizzabile per un noleggio Supercar DR7\n\n` +
                `Buono sconto di *€10* per un lavaggio auto DR7\n\n` +
                `CODICE SCONTO NOLEGGIO: *${rentalCode}*\n` +
                `CODICE SCONTO LAVAGGIO: *${carwashCode}*\n\n` +
                `(I codici sono validi 10 giorni. Spesa minima: €400 per il codice noleggio Supercar, €40 per il codice lavaggio. Validi esclusivamente per prenotazioni effettuate tramite www.dr7empire.com)\n\n` +
                `Ti basterà inserire il codice al check-out della prenotazione per attivare il tuo credito. Saremo lieti di accompagnarti nella scelta 👇🏻\n\n` +
                `www.dr7empire.com\n\n` +
                `Con Stima\n*DR7*`

            // Try copy to clipboard for the admin
            try { await navigator.clipboard.writeText(messageBody) } catch { /* ignore */ }

            // Offer to send via WhatsApp
            if (booking.customer_phone) {
                const send = window.confirm(
                    `Codici generati e copiati negli appunti:\n\n` +
                    `Noleggio: ${rentalCode}\nLavaggio: ${carwashCode}\n\n` +
                    `Vuoi inviarli adesso via WhatsApp a ${firstName} (${booking.customer_phone})?`
                )
                if (send) {
                    const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: booking.customer_phone,
                            customMessage: messageBody,
                        }),
                    })
                    if (waRes.ok) toast.success('Codici inviati via WhatsApp')
                    else toast.error('WhatsApp send fallito — codici comunque salvati')
                } else {
                    toast.success('Codici generati (testo copiato negli appunti)')
                }
            } else {
                toast.success(`Codici generati: ${rentalCode} / ${carwashCode}`)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        } finally {
            setGeneratingCodesFor(null)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Recensioni</h2>
                <div className="flex gap-2">
                    <Button
                        onClick={() => {
                            setMultiSelectMode(!multiSelectMode)
                            setSelectedIds(new Set())
                        }}
                        variant={multiSelectMode ? 'secondary' : 'primary'}
                        className={multiSelectMode ? 'bg-blue-600 text-theme-text-primary' : ''}
                    >
                        {multiSelectMode ? 'Annulla Selezione' : 'Selezione Multipla'}
                    </Button>
                    <Button
                        onClick={handleSendReviews}
                        disabled={selectedIds.size === 0 || sending}
                        className={selectedIds.size > 0 && !sending
                            ? 'bg-dr7-gold hover:bg-[#0A8FA3] text-white shadow-[0_0_15px_rgba(212,175,55,0.4)]'
                            : ''
                        }
                    >
                        {sending ? 'Invio...' : `Invia Richiesta (${selectedIds.size})`}
                    </Button>
                </div>
            </div>

            {/* WhatsApp Auto Review Template */}
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                <button
                    onClick={() => setWaTemplateOpen(!waTemplateOpen)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-bg-tertiary/50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-lg">📱</span>
                        <div>
                            <h3 className="font-semibold text-theme-text-primary">Messaggio WhatsApp Automatico</h3>
                            <p className="text-xs text-theme-text-muted">
                                Inviato automaticamente 60 min dopo la fine del noleggio/lavaggio. Ogni cliente lo riceve 1 sola volta.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-theme-text-muted bg-theme-bg-tertiary px-2 py-1 rounded-full">
                            {waSentCount} inviati
                        </span>
                        <span className={`transition-transform ${waTemplateOpen ? 'rotate-180' : ''}`}>▼</span>
                    </div>
                </button>

                {waTemplateOpen && (
                    <div className="p-4 border-t border-theme-border animate-fadeIn">
                        {waEditing ? (
                            <div className="space-y-3">
                                <textarea
                                    value={waDraft}
                                    onChange={(e) => setWaDraft(e.target.value)}
                                    rows={14}
                                    className="w-full bg-theme-bg-tertiary border border-theme-border-light text-theme-text-primary p-3 rounded-lg text-sm font-mono focus:outline-none focus:border-dr7-gold resize-y"
                                />
                                <p className="text-xs text-theme-text-muted">
                                    Placeholder disponibile: <code className="bg-theme-bg-tertiary px-1 rounded">{'{nome}'}</code> = nome del cliente
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={saveWaTemplate}
                                        disabled={waSaving}
                                        className="bg-dr7-gold hover:bg-[#0A8FA3] text-white"
                                    >
                                        {waSaving ? 'Salvataggio...' : 'Salva Template'}
                                    </Button>
                                    <Button
                                        onClick={() => setWaEditing(false)}
                                        variant="secondary"
                                    >
                                        Annulla
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <pre className="whitespace-pre-wrap text-sm text-theme-text-secondary bg-theme-bg-tertiary p-3 rounded-lg max-h-64 overflow-y-auto">
                                    {waTemplate || '(Nessun template configurato — verrà usato il messaggio predefinito)'}
                                </pre>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={() => {
                                            setWaDraft(waTemplate)
                                            setWaEditing(true)
                                        }}
                                        variant="secondary"
                                        className="text-sm"
                                    >
                                        Modifica Template
                                    </Button>
                                    <Button
                                        onClick={sendWaTest}
                                        disabled={waTesting}
                                        variant="secondary"
                                        className="text-sm bg-green-600/20 hover:bg-green-600/30 text-green-400 border-green-500/30"
                                    >
                                        {waTesting ? 'Invio test...' : 'Invia Test'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Filters */}
            <div className="bg-theme-bg-secondary p-4 rounded-full border border-theme-border flex gap-4">
                <input
                    type="text"
                    placeholder="Cerca cliente o email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-theme-bg-tertiary border border-theme-border-light text-theme-text-primary px-4 py-2 rounded-full w-full max-w-md focus:outline-none focus:border-dr7-gold"
                />
            </div>

            <div className="bg-theme-bg-secondary rounded-lg overflow-hidden border border-theme-border shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className=" text-theme-text-primary uppercase text-xs tracking-wider">
                            <tr>
                                {multiSelectMode && (
                                    <th className="p-4 w-10">
                                        <input
                                            type="checkbox"
                                            checked={filteredBookings.length > 0 && selectedIds.size === filteredBookings.filter(b => !b.review_sent_at).length}
                                            onChange={handleSelectAll}
                                            className="rounded-full border-theme-border-light bg-theme-bg-tertiary text-dr7-gold focus:ring-offset-gray-900"
                                        />
                                    </th>
                                )}
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Servizio</th>
                                <th className="p-4">Data Fine</th>
                                <th className="p-4">Contatti</th>
                                <th className="p-4">Totale</th>
                                <th className="p-4 text-right">Azioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {loading ? (
                                <tr>
                                    <td colSpan={multiSelectMode ? 7 : 6} className="p-8 text-center text-theme-text-muted">
                                        Caricamento completati...
                                    </td>
                                </tr>
                            ) : filteredBookings.length === 0 ? (
                                <tr>
                                    <td colSpan={multiSelectMode ? 7 : 6} className="p-8 text-center text-theme-text-muted">
                                        Nessuna prenotazione completata trovata.
                                    </td>
                                </tr>
                            ) : (
                                filteredBookings.map((b) => (
                                    <tr key={b.id} className={`hover:bg-theme-bg-tertiary/50 transition-colors ${selectedIds.has(b.id) ? 'bg-dr7-gold/10' : ''} ${b.review_sent_at ? 'opacity-60 grayscale' : ''}`}>
                                        {multiSelectMode && (
                                            <td className="p-4">
                                                {!b.review_sent_at ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(b.id)}
                                                        onChange={() => toggleSelection(b.id)}
                                                        className="rounded-full border-theme-border-light bg-theme-bg-tertiary text-dr7-gold focus:ring-offset-gray-900"
                                                    />
                                                ) : (
                                                    <span title="Recensione già richiesta" className="text-xs text-green-500">✅</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="p-4 font-medium text-theme-text-primary">
                                            {b.customer_name}
                                            {b.review_sent_at && (
                                                <span className="block text-xs text-green-400 mt-1">
                                                    (Recensione inviata: {new Date(b.review_sent_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })})
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-theme-text-secondary">
                                            {b.service_type === 'car_wash' && '🚿 '}
                                            {b.service_type === 'mechanical_service' && '🔧 '}
                                            {!b.service_type && '🚗 '}
                                            {b.service_name}
                                        </td>
                                        <td className="p-4 text-theme-text-secondary">
                                            {new Date(b.end_date).toLocaleDateString('it-IT')}
                                        </td>
                                        <td className="p-4 text-sm text-theme-text-muted">
                                            <div>{b.customer_email || '-'}</div>
                                            <div>{b.customer_phone || '-'}</div>
                                        </td>
                                        <td className="p-4 text-dr7-gold font-mono">
                                            €{(b.price_total / 100).toFixed(2)}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-2 flex-wrap">
                                                {!b.review_sent_at && (
                                                    <Button
                                                        onClick={() => handleSendSingle(b)}
                                                        variant="secondary"
                                                        className="text-xs py-1 px-3 bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold border-dr7-gold/30"
                                                        disabled={sending}
                                                    >
                                                        {sending ? '...' : 'Invia'}
                                                    </Button>
                                                )}
                                                {b.review_sent_at && (
                                                    <span className="text-xs text-green-500 font-medium border border-green-500/30 px-2 py-1 rounded-full bg-green-500/10">Inviata</span>
                                                )}
                                                <Button
                                                    onClick={() => handleGenerateReviewCodes(b)}
                                                    variant="secondary"
                                                    className="text-xs py-1 px-3 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border-purple-400/30"
                                                    disabled={generatingCodesFor === b.id}
                                                >
                                                    {generatingCodesFor === b.id ? '...' : '🎁 Codici'}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-theme-text-muted text-xs text-center flex justify-between px-4">
                <span>Totale trovati: {bookings.length}</span>
                <span>Mostrati: {filteredBookings.length}</span>
            </div>
        </div>
    )
}
