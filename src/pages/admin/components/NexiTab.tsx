import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { formatEUR } from '../../../utils/moneyUtils'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

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
    contract_id: string | null
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

interface TokenizedCard {
    id: string
    full_name: string
    email: string
    phone: string
    contract_id: string
    masked_pan: string
    circuit: string
    card_type: string
    card_brand: string
    updated_at: string
}

export default function NexiTab() {
    const [transactions, setTransactions] = useState<NexiTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    // Tokenized cards
    const [tokenizedCards, setTokenizedCards] = useState<TokenizedCard[]>([])
    const [cardsLoading, setCardsLoading] = useState(true)
    const [backfillRunning, setBackfillRunning] = useState(false)

    // Search bar — filtra carte tokenizzate e transazioni per nome cliente,
    // email, order_id (booking id) o numero contratto. Permette di capire
    // a colpo d'occhio chi ha gia' una carta on file (= candidato per
    // rentale senza cauzione).
    const [search, setSearch] = useState('')
    // Card type filter — credit / debit / prepaid / wallets / unknown
    const [cardTypeFilter, setCardTypeFilter] = useState<'' | 'credit' | 'debit' | 'prepaid' | 'unknown'>('')
    // Date range filter — applied to the tokenized card's updated_at
    // (= when the card was last tokenized/refreshed).
    const [dateFilter, setDateFilter] = useState<'' | '7d' | '30d' | '90d' | 'year'>('')
    const filterMatches = (haystacks: (string | null | undefined)[], needle: string) => {
        const q = needle.trim().toLowerCase()
        if (!q) return true
        return haystacks.some(h => (h || '').toLowerCase().includes(q))
    }
    const dateCutoff = (() => {
        if (!dateFilter) return null
        const now = Date.now()
        const days = dateFilter === '7d' ? 7 : dateFilter === '30d' ? 30 : dateFilter === '90d' ? 90 : 365
        return new Date(now - days * 24 * 60 * 60 * 1000)
    })()
    const matchesCardType = (rawType: string | null | undefined): boolean => {
        if (!cardTypeFilter) return true
        const t = (rawType || '').toLowerCase()
        if (cardTypeFilter === 'unknown') return !t || (t !== 'credit' && t !== 'debit' && t !== 'prepaid')
        return t === cardTypeFilter
    }
    const matchesDate = (iso: string | null | undefined): boolean => {
        if (!dateCutoff) return true
        if (!iso) return false
        const d = new Date(iso)
        return Number.isFinite(d.getTime()) && d >= dateCutoff
    }
    const filteredCards = tokenizedCards.filter(c =>
        filterMatches([c.full_name, c.email, c.phone, c.masked_pan, c.contract_id], search)
        && matchesCardType(c.card_type)
        && matchesDate(c.updated_at)
    )
    const filteredTransactions = transactions.filter(tx =>
        filterMatches(
            [tx.customer_email, tx.order_id, tx.description, tx.booking?.customer_name, tx.booking?.vehicle_name, tx.contract_id, tx.booking_id],
            search,
        )
        && matchesDate(tx.created_at)
    )

    async function runBackfill() {
        // Two-step: dry run first to count, then ask for confirm before applying.
        setBackfillRunning(true)
        const toastId = toast.loading('Scansione transazioni Nexi...')
        try {
            const dry = await authFetch('/.netlify/functions/nexi-tokenize-backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: true, limit: 500 }),
            })
            const dryData = await dry.json()
            toast.dismiss(toastId)
            if (!dry.ok) throw new Error(dryData.error || `HTTP ${dry.status}`)

            const wouldSave = dryData.would_save || 0
            const skipped = dryData.skipped || 0
            const noCust = dryData.no_customer_match || 0
            const noNexi = dryData.no_nexi_data || 0

            if (wouldSave === 0) {
                toast(`Niente da recuperare. Già aggiornati: ${skipped}, no match cliente: ${noCust}, no dati Nexi: ${noNexi}`, { icon: 'ℹ️', duration: 6000 })
                return
            }

            const ok = confirm(
                `Recuperare ${wouldSave} carte dalle transazioni passate?\n\n` +
                `Salterà: ${skipped} (già aggiornate), ${noCust} (cliente non trovato), ${noNexi} (Nexi non risponde).\n\n` +
                `Premi OK per procedere.`
            )
            if (!ok) return

            const applyToast = toast.loading(`Salvataggio ${wouldSave} carte...`)
            const apply = await authFetch('/.netlify/functions/nexi-tokenize-backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: false, limit: 500 }),
            })
            const applyData = await apply.json()
            toast.dismiss(applyToast)
            if (!apply.ok) throw new Error(applyData.error || `HTTP ${apply.status}`)
            toast.success(`✓ ${applyData.saved} carte recuperate!`)
            await fetchTokenizedCards()
        } catch (err: any) {
            toast.dismiss(toastId)
            toast.error('Errore: ' + (err.message || String(err)))
        } finally {
            setBackfillRunning(false)
        }
    }

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
    const filteredAddebiti = allAddebiti.filter(a => filterMatches(
        [a.customer_name, a.customer_email, a.causale, a.contract_id], search
    ))

    useEffect(() => {
        fetchTransactions()
        fetchAllAddebiti()
        // Initial fetch + silent auto-enrichment so PANs show without
        // forcing the admin to click "Recupera carte mancanti". Runs the
        // apply path of the backfill in background; if it saves anything
        // we refetch and the new PANs replace the empty rows in place.
        fetchTokenizedCards().then(() => { autoSyncMissingPans() })
    }, [])

    async function diagnoseCard(card: TokenizedCard) {
        // contract_id == orderId for our pay-by-link flow (legacy + current).
        // We don't store the operationId on the TokenizedCard payload, so the
        // backend extracts it from the matching nexi_transactions row.
        const params = new URLSearchParams()
        params.set('orderId', card.contract_id)
        const toastId = toast.loading('Interrogo Nexi...')
        try {
            const res = await authFetch(`/.netlify/functions/nexi-debug-operation?${params.toString()}`)
            const json = await res.json()
            toast.dismiss(toastId)
            if (!res.ok) {
                toast.error(json?.error || `HTTP ${res.status}`)
                return
            }
            // Extract maskedPan from any of the responses to summarise.
            const operation = (json as Record<string, unknown>).operation as Record<string, unknown> | null
            const orderOps = (json as Record<string, unknown>).order_operations as { operations?: unknown[] } | null
            const opMaskedPan = (operation as { paymentMethod?: { maskedPan?: string } })?.paymentMethod?.maskedPan
                || (operation as { maskedPan?: string })?.maskedPan
                || ''
            let orderMaskedPan = ''
            for (const op of (orderOps?.operations || []) as Array<{ paymentMethod?: { maskedPan?: string }; maskedPan?: string }>) {
                if (op?.paymentMethod?.maskedPan) { orderMaskedPan = op.paymentMethod.maskedPan; break }
                if (op?.maskedPan) { orderMaskedPan = op.maskedPan; break }
            }
            const summary = [
                `Cliente: ${card.full_name || card.email}`,
                `Order ID: ${card.contract_id}`,
                '',
                `/operations: maskedPan = ${opMaskedPan || '(vuoto)'}`,
                `/orders/.../operations: maskedPan = ${orderMaskedPan || '(vuoto)'}`,
                '',
                opMaskedPan || orderMaskedPan
                    ? 'Nexi espone il PAN — bug di salvataggio nostro. Riapri la console (F12) per la JSON completa.'
                    : 'Nexi NON espone il PAN per questa transazione. Tipico di pagamenti wallet (Apple Pay/Google Pay) o di pre-tokenizzazioni senza checkout completo.',
            ].join('\n')
            console.log('[diagnoseCard] Full Nexi response:', json)
            alert(summary)
        } catch (err: unknown) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`Errore diagnostica: ${msg}`)
        }
    }

    async function autoSyncMissingPans() {
        try {
            const res = await authFetch('/.netlify/functions/nexi-tokenize-backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: false, limit: 100 }),
            })
            if (!res.ok) return
            const data = await res.json().catch(() => ({}))
            if ((data?.saved || 0) > 0) {
                await fetchTokenizedCards()
            }
        } catch (err) {
            // Silent — manual "Recupera" button stays available as a fallback.
            console.warn('[NexiTab] Auto-sync missing PANs failed:', err)
        }
    }

    async function fetchTokenizedCards() {
        setCardsLoading(true)
        try {
            // Goes through the netlify function (service role) so every
            // authenticated admin sees the same count regardless of RLS
            // policies on customers_extended / nexi_transactions. Direct
            // supabase queries from the client previously hid rows from
            // admins without read policies (e.g. one operator saw 64 cards,
            // another saw 27).
            const res = await authFetch('/.netlify/functions/nexi-list-tokenized-cards')
            if (!res.ok) {
                const errText = await res.text().catch(() => '')
                console.error('[fetchTokenizedCards] HTTP', res.status, errText)
                return
            }
            const data = await res.json()
            setTokenizedCards(Array.isArray(data?.cards) ? data.cards : [])
        } catch (err) {
            console.error('Error fetching tokenized cards:', err)
        } finally {
            setCardsLoading(false)
        }
    }

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
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.dismiss('trigger-email')
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function cancelAddebito(id: string) {
        if (!confirm('Annullare questo addebito?')) return
        try {
            // Use server-side function to bypass RLS
            const res = await fetch('/.netlify/functions/stop-addebito', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addebitoId: id })
            })
            const data = await res.json()
            if (res.ok && data.success) {
                toast.success('Addebito annullato')
                fetchAllAddebiti()
            } else {
                toast.error('Errore: ' + (data.error || 'Errore sconosciuto'))
            }
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function fetchTransactions() {
        try {
            setLoading(true)
            const response = await authFetch('/.netlify/functions/nexi-list-orders')
            const data = await response.json()

            if (!response.ok) throw new Error(data.error || 'Failed to fetch messages')

            setTransactions(data.transactions || [])
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            setError(_errMsg)
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

            const res = await authFetch('/.netlify/functions/nexi-nuovo-addebito', {
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
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        } finally {
            setAddebitoSending(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-2xl font-bold text-theme-text-primary">Transazioni Nexi</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Cerca per cliente, email, prenotazione, order ID, contratto…"
                        className="px-3 py-2 text-sm bg-theme-text-primary/5 border border-theme-border/50 rounded-lg w-72 text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold"
                    />
                    {search && (
                        <button onClick={() => setSearch('')}
                            className="text-xs px-2 py-2 rounded text-theme-text-muted hover:text-theme-text-primary"
                            title="Cancella ricerca">×</button>
                    )}
                    <select
                        value={cardTypeFilter}
                        onChange={e => setCardTypeFilter(e.target.value as typeof cardTypeFilter)}
                        title="Filtra per tipo carta (carte tokenizzate)"
                        className="px-3 py-2 text-sm bg-theme-text-primary/5 border border-theme-border/50 rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                    >
                        <option value="">Tutti i tipi</option>
                        <option value="credit">Credit</option>
                        <option value="debit">Debit</option>
                        <option value="prepaid">Prepaid</option>
                        <option value="unknown">Sconosciuto</option>
                    </select>
                    <select
                        value={dateFilter}
                        onChange={e => setDateFilter(e.target.value as typeof dateFilter)}
                        title="Filtra per data"
                        className="px-3 py-2 text-sm bg-theme-text-primary/5 border border-theme-border/50 rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                    >
                        <option value="">Tutte le date</option>
                        <option value="7d">Ultimi 7 giorni</option>
                        <option value="30d">Ultimi 30 giorni</option>
                        <option value="90d">Ultimi 90 giorni</option>
                        <option value="year">Ultimo anno</option>
                    </select>
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
            </div>

            {/* Carte Tokenizzate */}
            <div className="bg-theme-text-primary/5 rounded-xl border border-theme-border/50 overflow-hidden">
                <div className="px-6 py-3 bg-theme-bg-primary/20 border-b border-theme-border/50 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Carte Tokenizzate</h3>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-theme-text-muted">
                            {(search || cardTypeFilter || dateFilter) ? `${filteredCards.length}/${tokenizedCards.length}` : tokenizedCards.length} carte
                        </span>
                        <button
                            onClick={runBackfill}
                            disabled={backfillRunning}
                            className="text-xs px-3 py-1 rounded-full bg-dr7-gold/15 text-dr7-gold hover:bg-dr7-gold/25 disabled:opacity-50"
                            title="Recupera dati carta da Nexi per le transazioni passate il cui callback non ha attaccato il contractId al cliente"
                        >
                            {backfillRunning ? 'Recupero...' : '↻ Recupera carte mancanti'}
                        </button>
                        <button onClick={fetchTokenizedCards} className="text-xs text-theme-text-muted hover:text-dr7-gold">Aggiorna</button>
                    </div>
                </div>
                {cardsLoading ? (
                    <div className="px-6 py-8 text-center text-theme-text-muted text-sm">Caricamento...</div>
                ) : filteredCards.length === 0 ? (
                    <div className="px-6 py-8 text-center text-theme-text-muted text-sm">
                        {search ? `Nessuna carta corrisponde a "${search}"` : 'Nessuna carta tokenizzata'}
                    </div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {filteredCards.map((card) => (
                            <div key={card.id} className="px-6 py-3 flex items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-theme-text-primary font-semibold text-sm">{card.full_name || 'N/A'}</span>
                                        {card.masked_pan && (
                                            <span className="font-mono text-sm text-theme-text-secondary">
                                                {card.masked_pan}
                                            </span>
                                        )}
                                        {card.circuit && (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-dr7-gold/10 text-dr7-gold border-dr7-gold/30 uppercase">
                                                {card.circuit}
                                            </span>
                                        )}
                                        {card.card_type && (
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${
                                                card.card_type === 'credit' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' :
                                                card.card_type === 'debit' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
                                                card.card_type === 'prepaid' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                                                'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                                            }`}>
                                                {card.card_type}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-theme-text-muted mt-0.5">
                                        {card.email}{card.phone ? ` · ${card.phone}` : ''}
                                        <span className="ml-2 font-mono">ID: ...{card.contract_id.slice(-8)}</span>
                                        {card.updated_at && (
                                            <span className="ml-2">{formatRomeDate(new Date(card.updated_at), { dateStyle: 'short' })}</span>
                                        )}
                                    </div>
                                </div>
                                {!card.masked_pan && card.contract_id && (
                                    <button
                                        onClick={() => diagnoseCard(card)}
                                        className="text-[11px] px-2 py-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 shrink-0"
                                        title="Mostra cosa restituisce Nexi per questa carta"
                                    >
                                        Diagnostica
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Stato Addebiti */}
            {filteredAddebiti.length > 0 && (
                <div className="bg-theme-text-primary/5 rounded-xl border border-theme-border/50 overflow-hidden">
                    <div className="px-6 py-3 bg-theme-bg-primary/20 border-b border-theme-border/50 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Stato Addebiti</h3>
                        <button onClick={fetchAllAddebiti} className="text-xs text-theme-text-muted hover:text-dr7-gold">Aggiorna</button>
                    </div>
                    <div className="divide-y divide-white/5">
                        {filteredAddebiti.map((a) => {
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
                                        {a.status !== 'stopped' && (
                                            <button
                                                onClick={() => cancelAddebito(a.id)}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors"
                                            >
                                                {a.status === 'charged' ? 'Chiudi' : 'Annulla'}
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
            ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12 bg-theme-text-primary/5 rounded-xl border border-theme-border/50">
                    <p className="text-theme-text-muted">
                        {search ? `Nessuna transazione corrisponde a "${search}"` : 'Nessuna transazione trovata'}
                    </p>
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
                                {filteredTransactions.map((tx) => (
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
