import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { formatEUR } from '../../../utils/moneyUtils'
import toast from 'react-hot-toast'

interface PendingAddebito {
    id: string
    customer_name: string
    customer_email: string
    contract_number: string
    amount_cents: number
    charged_amount_cents: number | null
    causale: string
    status: string
    recurring: boolean
    interval_hours: number | null
    charge_count: number
    error_message: string | null
    mit_charge_after: string | null
    created_at: string
}

interface NexiTransaction {
    id: string
    created_at: string
    order_id: string
    amount_cents: number
    status: 'pending' | 'completed' | 'failed' | 'cancelled'
    description: string
    customer_email: string
    contract_id?: string
    booking_id?: string
    booking?: {
        id: string
        vehicle_name: string
        customer_name: string
    }
}

export default function NexiTab() {
    const [transactions, setTransactions] = useState<NexiTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    // Nuovo Addebito modal state
    const [showAddebitoModal, setShowAddebitoModal] = useState(false)
    const [addebitoTx, setAddebitoTx] = useState<NexiTransaction | null>(null)
    const [addebitoAmount, setAddebitoAmount] = useState('')
    const [addebitoSending, setAddebitoSending] = useState(false)
    const [addebitoRecurring, setAddebitoRecurring] = useState(false)
    const [addebitoIntervalHours, setAddebitoIntervalHours] = useState('24')
    const [addebitoPhotos, setAddebitoPhotos] = useState<File[]>([])
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([])

    // All pending addebiti
    const [allAddebiti, setAllAddebiti] = useState<PendingAddebito[]>([])

    useEffect(() => {
        fetchTransactions()
        fetchAllAddebiti()
    }, [])

    async function fetchAllAddebiti() {
        const { data } = await supabase
            .from('pending_addebiti')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)
        setAllAddebiti(data || [])
    }

    async function triggerSecondEmail(id: string) {
        try {
            toast.loading('Invio 2a email...', { id: 'trigger-email' })
            const res = await fetch('/.netlify/functions/trigger-second-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addebitoId: id }),
            })
            const data = await res.json()
            toast.dismiss('trigger-email')
            if (res.ok && data.success) {
                toast.success(`${data.message} (PDF: ${data.pdfAttached ? 'allegato' : 'no foto'})`)
                fetchAllAddebiti()
            } else {
                toast.error(data.error || 'Errore invio email')
            }
        } catch (err: any) {
            toast.dismiss('trigger-email')
            toast.error('Errore: ' + err.message)
        }
    }

    async function stopRecurring(id: string) {
        const { error } = await supabase
            .from('pending_addebiti')
            .update({ status: 'stopped', recurring: false })
            .eq('id', id)
        if (error) {
            toast.error('Errore: ' + error.message)
        } else {
            toast.success('Addebito ricorrente fermato')
            fetchAllAddebiti()
        }
    }

    async function cancelAddebito(id: string) {
        if (!confirm('Annullare questo addebito?')) return
        const { error } = await supabase
            .from('pending_addebiti')
            .update({ status: 'stopped', recurring: false })
            .eq('id', id)
        if (error) {
            toast.error('Errore: ' + error.message)
        } else {
            toast.success('Addebito annullato')
            fetchAllAddebiti()
        }
    }

    async function fetchTransactions() {
        try {
            setLoading(true)
            const response = await fetch('/.netlify/functions/nexi-list-orders')
            const data = await response.json()

            if (!response.ok) throw new Error(data.error || 'Failed to fetch messages')

            setTransactions(data.transactions || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    function getStatusBadge(status: string) {
        const styles = {
            completed: 'bg-green-900/50 text-green-300 border-green-700/50',
            pending: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
            failed: 'bg-red-900/50 text-red-300 border-red-700/50',
            cancelled: 'bg-theme-bg-tertiary/50 text-theme-text-secondary border-theme-border/50'
        }
        const style = styles[status as keyof typeof styles] || styles.pending

        return (
            <span className={`px-2 py-1 rounded text-xs font-bold border ${style} uppercase tracking-wider`}>
                {status}
            </span>
        )
    }

    function openAddebitoModal(tx: NexiTransaction) {
        setAddebitoTx(tx)
        setAddebitoAmount('')
        setAddebitoRecurring(false)
        setAddebitoIntervalHours('24')
        setAddebitoPhotos([])
        setPhotoPreviewUrls([])
        setShowAddebitoModal(true)
    }

    function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || [])
        setAddebitoPhotos(prev => [...prev, ...files])
        const newUrls = files.map(f => URL.createObjectURL(f))
        setPhotoPreviewUrls(prev => [...prev, ...newUrls])
    }

    function removePhoto(index: number) {
        URL.revokeObjectURL(photoPreviewUrls[index])
        setAddebitoPhotos(prev => prev.filter((_, i) => i !== index))
        setPhotoPreviewUrls(prev => prev.filter((_, i) => i !== index))
    }

    async function uploadPhotos(addebitoId: string): Promise<string[]> {
        const urls: string[] = []
        for (const file of addebitoPhotos) {
            const ext = file.name.split('.').pop() || 'jpg'
            const path = `addebiti/${addebitoId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
            const { error } = await supabase.storage.from('contracts').upload(path, file)
            if (!error) {
                const { data: publicUrl } = supabase.storage.from('contracts').getPublicUrl(path)
                urls.push(publicUrl.publicUrl)
            }
        }
        return urls
    }

    async function handleNuovoAddebito() {
        if (!addebitoTx) return
        if (!addebitoAmount || parseFloat(addebitoAmount) <= 0) {
            toast.error('Inserisci un importo valido')
            return
        }
        if (!addebitoTx.customer_email) {
            toast.error('Email cliente mancante')
            return
        }

        setAddebitoSending(true)
        try {
            // Upload photos first if any
            let photoUrls: string[] = []
            if (addebitoPhotos.length > 0) {
                const tempId = `${addebitoTx.id}_${Date.now()}`
                photoUrls = await uploadPhotos(tempId)
            }

            const res = await fetch('/.netlify/functions/nexi-nuovo-addebito', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionId: addebitoTx.id,
                    bookingId: addebitoTx.booking_id || addebitoTx.booking?.id || null,
                    customerName: addebitoTx.booking?.customer_name || '',
                    customerEmail: addebitoTx.customer_email,
                    contractNumber: addebitoTx.booking_id?.substring(0, 8)?.toUpperCase() || addebitoTx.order_id,
                    amount: addebitoAmount,
                    causale: `Addebito - ${addebitoTx.booking?.customer_name || addebitoTx.customer_email}`,
                    contractId: addebitoTx.contract_id || null,
                    recurring: addebitoRecurring,
                    intervalHours: addebitoRecurring ? parseInt(addebitoIntervalHours) : null,
                    photoUrls,
                }),
            })
            const data = await res.json()
            if (res.ok && data.success) {
                toast.success(data.message || 'Addebito programmato')
                setShowAddebitoModal(false)
                fetchAllAddebiti()
            } else {
                toast.error(data.error || 'Errore nell\'invio')
            }
        } catch (err: any) {
            toast.error('Errore: ' + err.message)
        } finally {
            setAddebitoSending(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-theme-text-primary">Transazioni Nexi</h2>
                <button
                    onClick={fetchTransactions}
                    className="p-2 hover:bg-theme-text-primary/5 rounded-full transition-colors"
                    title="Aggiorna"
                >
                    <svg className="w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            </div>

            {/* Stato Addebiti */}
            {allAddebiti.length > 0 && (
                <div className="bg-theme-text-primary/5 rounded-xl border border-theme-border/50 overflow-hidden">
                    <div className="px-6 py-3 bg-theme-bg-primary/20 border-b border-theme-border/50 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Stato Addebiti</h3>
                        <button onClick={fetchAllAddebiti} className="text-xs text-theme-text-muted hover:text-dr7-gold">Aggiorna</button>
                    </div>
                    <div className="divide-y divide-white/5">
                        {allAddebiti.map((a) => {
                            const statusColors: Record<string, string> = {
                                email_sent: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
                                second_email_sent: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
                                charged: 'bg-green-900/50 text-green-300 border-green-700/50',
                                charge_failed: 'bg-red-900/50 text-red-300 border-red-700/50',
                                error: 'bg-red-900/50 text-red-300 border-red-700/50',
                                stopped: 'bg-theme-bg-tertiary/50 text-theme-text-secondary border-theme-border/50',
                                no_contract_id: 'bg-red-900/50 text-red-300 border-red-700/50',
                            }
                            const statusLabels: Record<string, string> = {
                                email_sent: '1a Email inviata',
                                second_email_sent: '2a Email inviata — In attesa addebito',
                                charged: 'Addebitato',
                                charge_failed: 'Addebito fallito',
                                error: 'Errore',
                                stopped: 'Fermato',
                                no_contract_id: 'No Contract ID',
                            }
                            return (
                                <div key={a.id} className="px-6 py-3 flex items-center justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-theme-text-primary font-semibold text-sm">{a.customer_name || a.customer_email}</span>
                                            {a.status === 'charged' && a.charged_amount_cents != null && a.charged_amount_cents < a.amount_cents ? (
                                                <>
                                                    <span className="font-mono text-theme-text-muted text-sm line-through">{formatEUR(a.amount_cents)}</span>
                                                    <span className="text-[11px] px-2 py-0.5 rounded bg-green-900/30 text-green-300 border border-green-700/50 font-bold">
                                                        Incassato: {formatEUR(a.charged_amount_cents)}
                                                    </span>
                                                    <span className="text-[11px] px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50 font-bold">
                                                        Rimanente: {formatEUR(a.amount_cents - a.charged_amount_cents)}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="font-mono text-dr7-gold font-bold text-sm">{formatEUR(a.amount_cents)}</span>
                                            )}
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${statusColors[a.status] || 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'}`}>
                                                {a.status === 'charged' && a.charged_amount_cents != null && a.charged_amount_cents < a.amount_cents
                                                    ? 'Addebitato Parziale'
                                                    : (statusLabels[a.status] || a.status)}
                                            </span>
                                            {a.recurring && !['charged', 'stopped'].includes(a.status) && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-300 border border-orange-700/50">ricorrente</span>
                                            )}
                                            {a.charge_count > 0 && (
                                                <span className="text-[10px] text-theme-text-muted">{a.charge_count} tentativi</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-theme-text-muted mt-0.5 truncate">
                                            {a.causale}
                                            {a.contract_id && <span className="text-theme-text-muted ml-2 font-mono">Card: ...{a.contract_id.slice(-4)}</span>}
                                            {a.error_message && <span className="text-red-400 ml-2">— {a.error_message}</span>}
                                        </div>
                                    </div>
                                    <div className="flex gap-1.5 flex-shrink-0">
                                        {(a.status === 'email_sent' || a.status === 'second_email_sent' || a.status === 'error' || a.status === 'charge_failed') && (
                                            <button
                                                onClick={() => triggerSecondEmail(a.id)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-700/50 transition-colors"
                                            >
                                                {a.status === 'email_sent' ? 'Invia 2a Email' : 'Rinvia Email'}
                                            </button>
                                        )}
                                        {a.recurring && !['charged', 'stopped'].includes(a.status) && (
                                            <button
                                                onClick={() => stopRecurring(a.id)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-theme-bg-tertiary text-theme-text-muted hover:bg-red-600/20 hover:text-red-400 border border-theme-border transition-colors"
                                            >
                                                Stop
                                            </button>
                                        )}
                                        {!['charged', 'stopped'].includes(a.status) && !a.recurring && (
                                            <button
                                                onClick={() => cancelAddebito(a.id)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors"
                                            >
                                                Annulla
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {error && (
                <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold mx-auto mb-4"></div>
                    <p className="text-theme-text-muted">Caricamento transazioni...</p>
                </div>
            ) : transactions.length === 0 ? (
                <div className="text-center py-12 bg-theme-text-primary/5 rounded-xl border border-theme-border/50">
                    <p className="text-theme-text-muted">Nessuna transazione trovata</p>
                </div>
            ) : (
                <div className="bg-theme-text-primary/5 rounded-xl border border-theme-border/50 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-theme-bg-primary/20 text-xs uppercase text-theme-text-muted font-medium">
                                <tr>
                                    <th className="px-6 py-4">Data</th>
                                    <th className="px-6 py-4">Order ID</th>
                                    <th className="px-6 py-4">Descrizione</th>
                                    <th className="px-6 py-4">Importo</th>
                                    <th className="px-6 py-4">Stato</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Azioni</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {transactions.map((tx) => (
                                    <tr key={tx.id} className="hover:bg-theme-text-primary/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="text-theme-text-primary font-mono text-sm">
                                                {formatRomeDate(new Date(tx.created_at), { dateStyle: 'short', timeStyle: 'short' })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-mono text-dr7-gold">{tx.order_id}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-theme-text-secondary">{tx.description}</div>
                                            {tx.booking && (
                                                <div className="text-xs text-theme-text-muted mt-1">
                                                    Ref: {tx.booking.vehicle_name}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-theme-text-primary font-mono font-bold">
                                                {formatEUR(tx.amount_cents || 0)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {getStatusBadge(tx.status)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-theme-text-primary">
                                                {tx.booking?.customer_name || 'N/A'}
                                            </div>
                                            <div className="text-xs text-theme-text-muted">{tx.customer_email}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => openAddebitoModal(tx)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors"
                                            >
                                                Nuovo Addebito
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Nuovo Addebito Modal */}
            {showAddebitoModal && addebitoTx && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-6 w-full max-w-lg space-y-4">
                        <h3 className="text-lg font-bold text-theme-text-primary">Nuovo Addebito</h3>
                        <div className="text-sm text-theme-text-secondary">
                            <p><strong>Cliente:</strong> {addebitoTx.booking?.customer_name || 'N/A'}</p>
                            <p><strong>Email:</strong> {addebitoTx.customer_email}</p>
                            {addebitoTx.contract_id && (
                                <p><strong>Contract ID Nexi:</strong> <span className="font-mono text-xs">{addebitoTx.contract_id}</span></p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Importo (€) *</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={addebitoAmount}
                                onChange={(e) => setAddebitoAmount(e.target.value)}
                                placeholder="es. 150.00"
                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Foto Danni</label>
                            <label className="flex items-center justify-center w-full px-3 py-3 rounded-lg bg-theme-bg-tertiary border border-dashed border-theme-border text-theme-text-muted hover:border-dr7-gold/50 hover:text-dr7-gold cursor-pointer transition-colors">
                                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-sm">{addebitoPhotos.length > 0 ? `${addebitoPhotos.length} foto selezionate` : 'Aggiungi foto...'}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handlePhotoSelect}
                                    className="hidden"
                                />
                            </label>
                            {photoPreviewUrls.length > 0 && (
                                <div className="flex gap-2 mt-2 flex-wrap">
                                    {photoPreviewUrls.map((url, i) => (
                                        <div key={i} className="relative group">
                                            <img src={url} alt={`Foto ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-theme-border" />
                                            <button
                                                onClick={() => removePhoto(i)}
                                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                X
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={addebitoRecurring}
                                    onChange={(e) => setAddebitoRecurring(e.target.checked)}
                                    className="w-4 h-4 rounded border-theme-border accent-red-500"
                                />
                                <span className="text-sm font-medium text-theme-text-secondary">Addebito ricorrente</span>
                            </label>
                            {addebitoRecurring && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-theme-text-muted">ogni</span>
                                    <input
                                        type="number"
                                        min="1"
                                        value={addebitoIntervalHours}
                                        onChange={(e) => setAddebitoIntervalHours(e.target.value)}
                                        className="w-16 px-2 py-1 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                                    />
                                    <span className="text-xs text-theme-text-muted">ore</span>
                                </div>
                            )}
                        </div>

                        <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-xs text-yellow-300">
                            {addebitoRecurring ? (
                                <><strong>Flusso ricorrente:</strong> Email formale → dopo 24h seconda email + addebito MIT → ripetuto ogni {addebitoIntervalHours}h fino a stop manuale.</>
                            ) : (
                                <><strong>Flusso:</strong> Email formale inviata subito → dopo 24h seconda email con foto danni + avviso → dopo 2 min addebito MIT (se rifiutato, ritenta con -10% ogni secondo).</>
                            )}
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowAddebitoModal(false)}
                                className="px-4 py-2 rounded-lg text-sm bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleNuovoAddebito}
                                disabled={addebitoSending}
                                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                                {addebitoSending ? 'Invio...' : 'Invia Email e Programma Addebito'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
