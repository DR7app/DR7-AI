import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { formatEUR } from '../../../utils/moneyUtils'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import CustomerAddebitoButton from './CustomerAddebitoButton'
import DateRangeFilter from '../../../components/DateRangeFilter'

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
    status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'preauth_held' | 'preauth_captured' | 'preauth_voided' | 'preauth_pending_link' | 'preauth_pending_refresh_confirm' | 'preauth_refresh_failed' | 'preauth_wrongly_charged' | 'preauth_wrongly_charged_refunded' | 'orphan_removed'
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

interface CardPayment {
    order_id: string
    amount_cents: number
    status: string
    description: string
    paid_at: string
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
    is_default?: boolean
    paid_total_cents?: number
    paid_count?: number
    payments?: CardPayment[]
}

export default function NexiTab() {
    const [transactions, setTransactions] = useState<NexiTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    // Tokenized cards
    const [tokenizedCards, setTokenizedCards] = useState<TokenizedCard[]>([])
    const [cardsLoading, setCardsLoading] = useState(true)
    const [backfillRunning, setBackfillRunning] = useState(false)
    // Which card row has its payment history expanded. Only one at a time
    // to keep the panel compact; clicking the same card again collapses.
    const [expandedCardId, setExpandedCardId] = useState<string | null>(null)

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
    // 2026-06-01: filtro periodo Da/A — su created_at/updated_at.
    // Coexiste con il preset dateFilter (entrambi applicati).
    const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
    const matchesDateRange = (iso: string | null | undefined): boolean => {
        if (!dateRange.from && !dateRange.to) return true
        if (!iso) return true
        const day = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
        if (dateRange.from && day < dateRange.from) return false
        if (dateRange.to && day > dateRange.to) return false
        return true
    }
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
        && matchesDateRange(c.updated_at)
    )
    const filteredTransactions = transactions.filter(tx =>
        filterMatches(
            [tx.customer_email, tx.order_id, tx.description, tx.booking?.customer_name, tx.booking?.vehicle_name, tx.contract_id, tx.booking_id],
            search,
        )
        && matchesDate(tx.created_at)
        && matchesDateRange(tx.created_at)
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
            // Parse defensively — nexi-tokenize-backfill can return an HTML
            // error page on 502/504/404 and res.json() crashes with the
            // useless "Unexpected token '<'" error. Read as text and surface
            // a real status + snippet so admin sees WHAT went wrong.
            const dryRaw = await dry.text()
            let dryData: Record<string, unknown> = {}
            try { dryData = JSON.parse(dryRaw) as Record<string, unknown> } catch {
                toast.dismiss(toastId)
                const snippet = dryRaw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
                throw new Error(`Backfill ha risposto HTTP ${dry.status}, non JSON. "${snippet || '(vuota)'}"`)
            }
            toast.dismiss(toastId)
            if (!dry.ok) throw new Error(((dryData as { error?: string })?.error) || `HTTP ${dry.status}`)

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
            const applyRaw = await apply.text()
            let applyData: Record<string, unknown> = {}
            try { applyData = JSON.parse(applyRaw) as Record<string, unknown> } catch {
                toast.dismiss(applyToast)
                const snippet = applyRaw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
                throw new Error(`Apply ha risposto HTTP ${apply.status}, non JSON. "${snippet || '(vuota)'}"`)
            }
            toast.dismiss(applyToast)
            if (!apply.ok) throw new Error((applyData as { error?: string })?.error || `HTTP ${apply.status}`)
            toast.success(`✓ ${(applyData as { saved?: number }).saved ?? 0} carte recuperate!`)
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

    // Pre-autorizzazione su carta tokenizzata (MIT con captureType=EXPLICIT).
    // Blocca i fondi sulla carta del cliente ma NON li addebita finche\' non
    // viene catturata (entro 7gg) o annullata.
    const [showPreauthModal, setShowPreauthModal] = useState(false)
    const [preauthCard, setPreauthCard] = useState<TokenizedCard | null>(null)
    const [preauthAmount, setPreauthAmount] = useState('')
    const [preauthDescription, setPreauthDescription] = useState('')
    const [preauthDurationDays, setPreauthDurationDays] = useState('7')
    const [preauthSending, setPreauthSending] = useState(false)

    // 2026-05-20: Pre-autorizzazione VIA LINK — il cliente paga via link
    // Nexi e i fondi vengono BLOCCATI (non addebitati). Cattura/svincolo
    // poi gestiti dall'admin con i bottoni "Cattura"/"Sblocca" sulla
    // riga della transazione. Usa il backend esistente nexi-create-preauth
    // (stesso endpoint usato per le cauzioni; cauzioneId opzionale).
    const [showPreauthLinkModal, setShowPreauthLinkModal] = useState(false)
    const [preauthLinkAmount, setPreauthLinkAmount] = useState('')
    const [preauthLinkCustomerName, setPreauthLinkCustomerName] = useState('')
    const [preauthLinkCustomerEmail, setPreauthLinkCustomerEmail] = useState('')
    const [preauthLinkCustomerPhone, setPreauthLinkCustomerPhone] = useState('')
    const [preauthLinkDescription, setPreauthLinkDescription] = useState('')
    const [preauthLinkExpirationHours, setPreauthLinkExpirationHours] = useState('168') // 7 giorni default
    const [preauthLinkSending, setPreauthLinkSending] = useState(false)
    const [preauthLinkResult, setPreauthLinkResult] = useState<{ url: string; orderId: string } | null>(null)
    const [preauthLinkSendWhatsApp, setPreauthLinkSendWhatsApp] = useState(true)

    function openPreauthModal(card: TokenizedCard) {
        setPreauthCard(card)
        setPreauthAmount('')
        setPreauthDescription('')
        setPreauthDurationDays('7')
        setShowPreauthModal(true)
    }

    async function handleCapturePreauth(tx: NexiTransaction) {
        const eur = (tx.amount_cents || 0) / 100
        const input = window.prompt(
            `Cattura €${eur.toFixed(2)} dalla pre-autorizzazione?\n\n` +
            `Lascia vuoto per catturare l'intero importo, oppure inserisci un importo minore (es. ${(eur * 0.8).toFixed(2)}).`,
            eur.toFixed(2)
        )
        if (input === null) return
        const amt = parseFloat(input)
        if (!amt || amt <= 0 || amt > eur) {
            toast.error('Importo non valido (max ' + eur.toFixed(2) + ')')
            return
        }
        const toastId = toast.loading('Catturo i fondi...')
        try {
            const res = await authFetch('/.netlify/functions/nexi-capture-preauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: tx.order_id,
                    transactionId: tx.id,
                    amount: amt,
                }),
            })
            const data = await res.json()
            toast.dismiss(toastId)
            if (res.ok && data.success) {
                toast.success(data.message || `Catturato €${amt.toFixed(2)}`)
                await fetchTransactions()
            } else {
                toast.error(data.error || 'Cattura fallita')
            }
        } catch (err) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        }
    }

    async function handleVoidPreauth(tx: NexiTransaction) {
        const eur = (tx.amount_cents || 0) / 100
        if (!window.confirm(`Sbloccare la pre-autorizzazione di €${eur.toFixed(2)}? I fondi torneranno disponibili sulla carta del cliente.`)) return
        const toastId = toast.loading('Sblocco i fondi...')
        try {
            const res = await authFetch('/.netlify/functions/nexi-void-preauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: tx.order_id,
                    transactionId: tx.id,
                }),
            })
            const data = await res.json()
            toast.dismiss(toastId)
            if (res.ok && data.success) {
                toast.success(data.message || 'Pre-autorizzazione sbloccata')
                await fetchTransactions()
            } else {
                toast.error(data.error || 'Sblocco fallito')
            }
        } catch (err) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        }
    }

    async function handleCreatePreauth() {
        if (!preauthCard) return
        const amt = parseFloat(preauthAmount)
        if (!amt || amt <= 0) {
            toast.error('Inserisci un importo valido')
            return
        }
        setPreauthSending(true)
        try {
            const days = Math.max(1, Math.min(365, parseInt(preauthDurationDays) || 7))
            const captureBy = new Date(Date.now() + days * 86400000).toISOString()
            // Silent MIT preauth: chiamata diretta su carta tokenizzata, no link.
            // Il backend ora include recurrence.action=USE_CONTRACT nel payload,
            // condizione richiesta da Nexi per onorare captureType=EXPLICIT.
            const res = await authFetch('/.netlify/functions/nexi-charge-mit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractId: preauthCard.contract_id,
                    amount: amt,
                    description: preauthDescription || `Pre-autorizzazione - ${preauthCard.full_name || preauthCard.email}`,
                    customerEmail: preauthCard.email || null,
                    customerName: preauthCard.full_name || null,
                    captureType: 'EXPLICIT',
                    expectedCaptureBy: captureBy,
                    durationDays: days,
                }),
            })
            const data = await res.json()
            if (res.ok && data.success) {
                toast.success(data.message || `Pre-autorizzazione di €${amt.toFixed(2)} creata`)
                setShowPreauthModal(false)
                await fetchTransactions()
                await fetchTokenizedCards()
            } else if (data.wronglyCharged) {
                // Safety: Nexi ha addebitato invece di bloccare. Auto-refund
                // gia\' tentato lato backend. Avvisa con stato chiaro.
                toast.error(data.error || 'Pre-autorizzazione fallita: addebito invece di blocco')
            } else {
                // Logga TUTTA la risposta Nexi in console cosi\' possiamo
                // diagnosticare perche\' la preauth e\' stata rifiutata.
                if (data.rawResponse) {
                    console.error('[Preauth declined] Full Nexi response:', data.rawResponse)
                }
                const detailed = data.error || 'Pre-autorizzazione fallita'
                // Toast piu\' lungo se ha dettagli (per leggerli).
                toast.error(detailed, { duration: 12000 })
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        } finally {
            setPreauthSending(false)
        }
    }

    function openPreauthLinkModal() {
        setPreauthLinkAmount('')
        setPreauthLinkCustomerName('')
        setPreauthLinkCustomerEmail('')
        setPreauthLinkCustomerPhone('')
        setPreauthLinkDescription('')
        setPreauthLinkExpirationHours('168')
        setPreauthLinkSendWhatsApp(true)
        setPreauthLinkResult(null)
        setShowPreauthLinkModal(true)
    }

    async function handleCreatePreauthLink() {
        const amt = parseFloat(preauthLinkAmount)
        if (!amt || amt <= 0) {
            toast.error('Inserisci un importo valido')
            return
        }
        const hours = Math.max(1, Math.min(8760, parseInt(preauthLinkExpirationHours) || 168))
        setPreauthLinkSending(true)
        const toastId = toast.loading('Creo link pre-autorizzazione...')
        try {
            const res = await authFetch('/.netlify/functions/nexi-create-preauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // cauzioneId omesso → backend genera orderId con prefisso "PA"
                    amount: amt,
                    customerEmail: preauthLinkCustomerEmail || null,
                    customerName: preauthLinkCustomerName || null,
                    description: preauthLinkDescription || `Pre-autorizzazione - ${preauthLinkCustomerName || preauthLinkCustomerEmail || 'cliente'}`,
                    expirationHours: hours,
                }),
            })
            const data = await res.json()
            toast.dismiss(toastId)
            if (!res.ok || !data.success || !data.paymentUrl) {
                toast.error(data.error || 'Creazione link fallita')
                return
            }
            setPreauthLinkResult({ url: data.paymentUrl, orderId: data.orderId })
            toast.success('Link pre-autorizzazione creato')

            // Invio WhatsApp opzionale via Green API (template invio link)
            if (preauthLinkSendWhatsApp && preauthLinkCustomerPhone) {
                try {
                    const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: preauthLinkCustomerPhone,
                            customMessage:
                                `Salve ${preauthLinkCustomerName || ''},\n\n` +
                                `di seguito trova il link per la pre-autorizzazione di €${amt.toFixed(2)} sulla sua carta.\n\n` +
                                `${preauthLinkDescription ? preauthLinkDescription + '\n\n' : ''}` +
                                `${data.paymentUrl}\n\n` +
                                `I fondi verranno solo bloccati (NON addebitati). La pre-autorizzazione decade automaticamente entro ${hours >= 24 ? Math.round(hours / 24) + ' giorni' : hours + ' ore'} se non catturata.\n\n` +
                                `Cordiali Saluti,\nDR7`,
                        }),
                    })
                    if (waRes.ok) {
                        toast.success('Link inviato via WhatsApp')
                    } else {
                        toast('Link creato ma invio WhatsApp fallito — copialo manualmente.', { duration: 8000 })
                    }
                } catch (waErr) {
                    console.error('[preauth-link] WhatsApp send failed:', waErr)
                    toast('Link creato ma invio WhatsApp fallito — copialo manualmente.', { duration: 8000 })
                }
            }

            await fetchTransactions()
        } catch (err) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        } finally {
            setPreauthLinkSending(false)
        }
    }

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
        fetchTokenizedCards().then(async () => {
            // First recover any missing PANs (so the BIN becomes visible),
            // THEN auto-classify credit/debit/prepaid from the BIN/Nexi.
            await autoSyncMissingPans()
            await autoResolveCardTypes()
        })
    }, [])

    async function diagnoseCard(card: TokenizedCard) {
        // contract_id == orderId for our pay-by-link flow (legacy + current).
        const params = new URLSearchParams()
        params.set('orderId', card.contract_id)
        const toastId = toast.loading('Interrogo Nexi...')
        try {
            const res = await authFetch(`/.netlify/functions/nexi-debug-operation?${params.toString()}`)
            // Some failure modes return an HTML error page (404 on missing
            // function, 502/503 from Netlify, etc). Reading res.json() directly
            // throws "Unexpected token '<'" and the operator sees a useless
            // error. Read as text first, parse defensively, surface the real
            // status + a snippet of what came back so we can debug.
            const raw = await res.text()
            let json: Record<string, unknown> = {}
            try {
                json = JSON.parse(raw) as Record<string, unknown>
            } catch {
                toast.dismiss(toastId)
                const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
                toast.error(`Diagnostica fallita — Nexi/Netlify ha risposto HTTP ${res.status}, non JSON. Prime parole della risposta: "${snippet || '(vuota)'}"`, { duration: 12000 })
                console.error('[diagnoseCard] Non-JSON response from nexi-debug-operation:', res.status, raw)
                return
            }
            toast.dismiss(toastId)
            if (!res.ok) {
                toast.error((json?.error as string) || `HTTP ${res.status}`)
                return
            }

            const operation = (json as Record<string, unknown>).operation as Record<string, unknown> | null
            const operationStatus = (json as Record<string, unknown>).operation_status as number | null
            const orderOps = (json as Record<string, unknown>).order_operations as { operations?: Record<string, unknown>[] } | null
            const orderOpsStatus = (json as Record<string, unknown>).order_operations_status as number | null

            const findMaskedPan = (op: Record<string, unknown> | null | undefined): string => {
                if (!op) return ''
                const pm = (op.paymentMethod || {}) as Record<string, unknown>
                const ad = (op.additionalData || {}) as Record<string, unknown>
                return String(pm.maskedPan || op.maskedPan || ad.maskedPan || op.paymentInstrumentInfo || '')
            }

            const opMaskedPan = findMaskedPan(operation)
            const ops = orderOps?.operations || []
            const orderMaskedPan = ops.map(findMaskedPan).find(Boolean) || ''

            // Inspect what the order's operations actually contain so the
            // admin sees why no PAN — wrong operation type, missing
            // paymentMethod block, etc.
            const opsSummary = ops.map(o => {
                const type = String(o.operationType || o.type || '?')
                const result = String(o.operationResult || o.status || '?')
                const hasPaymentMethod = !!(o.paymentMethod && typeof o.paymentMethod === 'object')
                const circuit = String((o.paymentMethod as Record<string, unknown> | undefined)?.circuit || o.paymentCircuit || '')
                const pan = findMaskedPan(o)
                return `  • ${type} (${result})${hasPaymentMethod ? ` — paymentMethod ${circuit ? `[${circuit}]` : ''}${pan ? ` PAN=${pan}` : ' senza maskedPan'}` : ' — senza paymentMethod'}`
            })

            const verdict = (opMaskedPan || orderMaskedPan)
                ? '✓ Nexi ESPONE il PAN — bug di salvataggio nostro. JSON completa in console (F12).'
                : ops.length === 0
                    ? '✗ Nessuna operazione trovata su questo ordine. Pagamento probabilmente abbandonato/scaduto prima del callback finale.'
                    : ops.every(o => !o.paymentMethod)
                        ? '✗ Operazioni presenti ma NESSUNA contiene paymentMethod. Tipico di:\n  - Wallet payment (Apple Pay / Google Pay)\n  - Merchant config Nexi che strippa card data dopo il callback (PCI scope reduction)\n  - Direct-link product che espone il PAN solo nel callback live, non nei GET successivi'
                        : '✗ Operazioni con paymentMethod ma SENZA maskedPan. Probabile wallet token (DPAN) — il PAN reale non esiste lato Nexi.'

            const summary = [
                `Cliente: ${card.full_name || card.email}`,
                `Order ID: ${card.contract_id}`,
                '',
                `GET /operations/{id}: HTTP ${operationStatus ?? '—'}, maskedPan = ${opMaskedPan || '(vuoto)'}`,
                `GET /orders/{id}/operations: HTTP ${orderOpsStatus ?? '—'}, ${ops.length} operazion${ops.length === 1 ? 'e' : 'i'}`,
                ...opsSummary,
                '',
                verdict,
            ].join('\n')
            console.log('[diagnoseCard] Full Nexi response:', json)

            // Se l'ordine non esiste su Nexi (orphan: customer non ha mai
            // completato il pagamento o pulizia retention), offro di
            // rimuovere il riferimento dal cliente cosi\' la carta non
            // appare piu\' nella lista "Carte Tokenizzate".
            const isOrphan = ops.length === 0 && !opMaskedPan && !orderMaskedPan
            if (isOrphan) {
                const explanation = [
                    summary,
                    '',
                    '— — — DIAGNOSI — — —',
                    '',
                    'Questa carta NON è tokenizzata su Nexi:',
                    '  • L\'ordine non risulta sul portale Nexi (nessuna operazione)',
                    '  • Tipico se il cliente ha abbandonato il pagamento',
                    '    o se Nexi ha applicato retention/cleanup',
                    '',
                    'NON puoi usare questa carta per addebiti/preauth:',
                    'qualsiasi tentativo MIT verrebbe rifiutato da Nexi.',
                    '',
                    '— — — AZIONE PROPOSTA — — —',
                    '',
                    'Rimuovo il riferimento dal NOSTRO database',
                    '(customers_extended.metadata.nexi_contract_id) cosi\' la carta',
                    'non appare piu\' nella lista "Carte Tokenizzate".',
                    '',
                    'NESSUN impatto su Nexi (non possiamo cancellare di la\').',
                    'Operazione reversibile solo manualmente via Supabase.',
                    '',
                    'Procedere?',
                ].join('\n')
                const shouldDelete = window.confirm(explanation)
                if (shouldDelete) {
                    await forgetOrphanCard(card)
                }
            } else {
                // Carta valida o anomala (con operazioni ma senza PAN). Mostra
                // diagnosi completa, l'admin decide se intervenire altrove.
                alert(summary)
            }
        } catch (err: unknown) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`Errore diagnostica: ${msg}`)
        }
    }
    // 2026-06-04: il bottone Diagnostica è stato rimosso ma diagnoseCard resta
    // come utility per debug futuro. Reference no-op per non far fallire il
    // build (tsc noUnusedLocals) senza eliminare la funzione.
    void diagnoseCard

    // Bulk: verifica tutte le carte contro Nexi e pulisce gli orfani.
    const [bulkCleanupRunning, setBulkCleanupRunning] = useState(false)
    async function runBulkOrphanCleanup() {
        // Step 1: dry-run per mostrare quante saranno rimosse
        setBulkCleanupRunning(true)
        const toastId = toast.loading('Verifica carte contro Nexi (1-2 min)...')
        try {
            const dryRes = await authFetch('/.netlify/functions/nexi-bulk-cleanup-orphans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: true }),
            })
            const dryData = await dryRes.json()
            toast.dismiss(toastId)
            if (!dryRes.ok) {
                toast.error(dryData.error || 'Verifica fallita')
                return
            }
            const { checked, alive, orphansCount } = dryData
            if (orphansCount === 0) {
                toast.success(`Tutte ${alive}/${checked} carte sono attive su Nexi. Nessuna pulizia necessaria.`)
                return
            }
            const ok = window.confirm(
                `Verifica completata:\n\n` +
                `• Verificate: ${checked}\n` +
                `• Attive su Nexi: ${alive}\n` +
                `• Non riconosciute (orfane): ${orphansCount}\n\n` +
                `Procedere con la pulizia? I riferimenti orfani verranno rimossi dai clienti e marcati come "orphan_removed" nello storico.`
            )
            if (!ok) return

            const toastId2 = toast.loading('Pulizia in corso...')
            const realRes = await authFetch('/.netlify/functions/nexi-bulk-cleanup-orphans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: false }),
            })
            const realData = await realRes.json()
            toast.dismiss(toastId2)
            if (realRes.ok) {
                toast.success(`Pulite ${realData.cleaned} carte orfane`)
                await fetchTokenizedCards()
            } else {
                toast.error(realData.error || 'Pulizia fallita')
            }
        } catch (err) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        } finally {
            setBulkCleanupRunning(false)
        }
    }

    // Rimuove il riferimento nexi_contract_id dal cliente quando Nexi non
    // riconosce piu\' l'ordine (orphan). Pulisce sia customers_extended.
    // metadata.nexi_contract_id sia le righe nexi_transactions con quel
    // contract_id (status finale 'orphan_removed' cosi\' resta tracciato).
    async function forgetOrphanCard(card: TokenizedCard) {
        const toastId = toast.loading('Rimozione riferimento...')
        try {
            const res = await authFetch('/.netlify/functions/nexi-forget-card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractId: card.contract_id })
            })
            const data = await res.json()
            toast.dismiss(toastId)
            if (res.ok && data.success) {
                // Confirmation con dettaglio: cosa abbiamo TOLTO dal nostro DB
                // e cosa NON abbiamo toccato (Nexi resta come sta — non c'era
                // nulla da togliere comunque, era un orfano).
                toast.success(
                    `Pulizia completata (${data.affected || 0} record DR7 rimossi).\n` +
                    `Carta NON era tokenizzata su Nexi: nessun impatto sul portale Nexi.\n` +
                    `Il cliente dovra' inserire di nuovo i dati carta per i prossimi pagamenti.`,
                    { duration: 8000 }
                )
                await fetchTokenizedCards()
            } else {
                toast.error(data.error || 'Rimozione fallita')
            }
        } catch (err) {
            toast.dismiss(toastId)
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + msg)
        }
    }

    // Elimina una carta tokenizzata dal cliente (la toglie dall'array
    // nexi_cards / chiavi flat tramite nexi-forget-card e riassegna la
    // predefinita). Le transazioni passate restano per lo storico.
    async function deleteCard(card: TokenizedCard) {
        const label = card.masked_pan || card.circuit || `...${card.contract_id.slice(-6)}`
        if (!confirm(
            `Eliminare la carta ${label}${card.full_name ? ` di ${card.full_name}` : ''}?\n\n` +
            `La carta verra' rimossa dall'elenco e non sara' piu' addebitabile.\n` +
            `Le transazioni passate restano nello storico.`
        )) return
        const toastId = toast.loading('Eliminazione carta...')
        try {
            const res = await authFetch('/.netlify/functions/nexi-forget-card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractId: card.contract_id })
            })
            const data = await res.json().catch(() => ({}))
            toast.dismiss(toastId)
            if (res.ok && data.success) {
                toast.success('Carta eliminata')
                await fetchTokenizedCards()
            } else {
                toast.error(data.error || 'Eliminazione fallita')
            }
        } catch (err) {
            toast.dismiss(toastId)
            toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
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

    // 2026-06-04: classifica AUTOMATICAMENTE credit/debit/prepaid dal BIN
    // (prime 6 cifre del PAN mascherato) o, se il PAN nasconde il BIN,
    // recuperandolo da Nexi (operations dell'ordine). Persiste il risultato
    // così ai caricamenti successivi è già pronto. Non sovrascrive mai un
    // tipo impostato a mano dal dropdown. Il dropdown resta come override.
    async function autoResolveCardTypes() {
        try {
            const res = await authFetch('/.netlify/functions/nexi-resolve-card-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: 80 }),
            })
            if (!res.ok) return
            const data = await res.json().catch(() => ({}))
            if ((data?.resolved || 0) > 0) {
                await fetchTokenizedCards()
            }
        } catch (err) {
            // Silent — il dropdown inline resta come fallback manuale.
            console.warn('[NexiTab] Auto-resolve card types failed:', err)
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

            const nexiTx: NexiTransaction[] = data.transactions || []

            // 2026-06-12: includi anche le RICARICHE CREDIT WALLET pagate con
            // carta (tabella credit_wallet_purchases). Passano da un flusso Nexi
            // separato (nexi-callback.js) che NON scrive nexi_transactions, quindi
            // prima NON comparivano qui pur essendo incassi Nexi reali. Merge
            // non-bloccante: se fallisce, restano i soli ordini Nexi standard.
            let walletTx: NexiTransaction[] = []
            try {
                const { data: rech } = await supabase
                    .from('credit_wallet_purchases')
                    .select('id, nexi_order_id, recharge_amount, package_name, payment_status, customer_email, customer_name, payment_completed_at, created_at')
                    .not('nexi_order_id', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(500)
                walletTx = (rech || []).map((r: Record<string, unknown>) => {
                    const ps = String(r.payment_status || '').toLowerCase()
                    const status: NexiTransaction['status'] =
                        ['succeeded', 'paid', 'completed'].includes(ps) ? 'completed'
                        : ps === 'pending' ? 'pending' : 'failed'
                    const eur = Number(r.recharge_amount || 0)
                    const who = String(r.customer_name || r.customer_email || '').trim()
                    return {
                        id: String(r.id),
                        created_at: String(r.payment_completed_at || r.created_at || ''),
                        order_id: String(r.nexi_order_id || ''),
                        amount_cents: Math.round(eur * 100),
                        status,
                        description: `Ricarica Wallet${who ? ' — ' + who : ''}${r.package_name ? ' · ' + r.package_name : ''}`,
                        customer_email: String(r.customer_email || ''),
                    } as NexiTransaction
                })
            } catch (wErr) {
                console.warn('[NexiTab] merge ricariche wallet fallito (non-bloccante):', wErr)
            }

            const combined = [...nexiTx, ...walletTx].sort((a, b) =>
                String(b.created_at || '').localeCompare(String(a.created_at || '')))
            setTransactions(combined)
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            setError(_errMsg)
        } finally {
            setLoading(false)
        }
    }

    function getStatusBadge(status: string) {
        const styles: Record<string, string> = {
            completed: 'bg-green-900/50 text-green-300 border-green-700/50',
            pending: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
            failed: 'bg-red-900/50 text-red-300 border-red-700/50',
            cancelled: 'bg-theme-bg-tertiary/50 text-theme-text-secondary border-theme-border/50',
            preauth_held: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
            preauth_captured: 'bg-green-900/50 text-green-300 border-green-700/50',
            preauth_voided: 'bg-theme-bg-tertiary/50 text-theme-text-secondary border-theme-border/50',
            preauth_pending_link: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
            preauth_pending_refresh_confirm: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
            preauth_refresh_failed: 'bg-red-900/50 text-red-300 border-red-700/50',
            preauth_wrongly_charged: 'bg-red-900/50 text-red-300 border-red-700/50',
            preauth_wrongly_charged_refunded: 'bg-orange-900/50 text-orange-300 border-orange-700/50',
            orphan_removed: 'bg-theme-bg-tertiary/30 text-theme-text-muted border-theme-border/30',
        }
        const labels: Record<string, string> = {
            completed: 'Completato',
            pending: 'In attesa',
            failed: 'Fallito',
            cancelled: 'Annullato',
            preauth_held: 'Pre-autorizzato',
            preauth_captured: 'Catturato',
            preauth_voided: 'Sbloccato',
            preauth_pending_link: 'In attesa conferma cliente',
            preauth_pending_refresh_confirm: 'Rinnovo - cliente deve confermare',
            preauth_refresh_failed: 'Rinnovo fallito',
            preauth_wrongly_charged: 'ERRORE - Addebitato (no refund)',
            preauth_wrongly_charged_refunded: 'Refund effettuato (era addebito)',
            orphan_removed: 'Riferimento rimosso',
        }
        const style = styles[status] || styles.pending
        const label = labels[status] || status

        return (
            <span className={`px-2 py-1 rounded text-xs font-bold border ${style} uppercase tracking-wider whitespace-nowrap`}>
                {label}
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
                    {/* 2026-06-01: periodo Da/A custom (DD/MM/YYYY) accanto al preset */}
                    <DateRangeFilter value={dateRange} onChange={setDateRange} showPresets={false} compact />

                    <button
                        onClick={openPreauthLinkModal}
                        className="px-3 py-2 text-sm rounded-lg bg-dr7-gold text-black hover:bg-dr7-gold/85 font-semibold transition-colors"
                        title="Crea un link pay-by-link che BLOCCA i fondi (non addebita) sulla carta del cliente — gli mandi il link via WhatsApp e lui paga, la cattura/sblocco li gestisci dopo"
                    >
                        + Link Pre-Autorizzazione
                    </button>
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
                        <button
                            onClick={runBulkOrphanCleanup}
                            disabled={bulkCleanupRunning}
                            className="text-xs px-3 py-1 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                            title="Verifica TUTTE le carte contro Nexi e rimuove i riferimenti che non esistono piu' (es. orfani di vecchio merchant)"
                        >
                            {bulkCleanupRunning ? 'Verifica...' : '🧹 Pulisci carte non riconosciute'}
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
                        {filteredCards.map((card) => {
                            const paidCents = card.paid_total_cents ?? 0
                            const paidCount = card.paid_count ?? 0
                            const payments = card.payments ?? []
                            const isExpanded = expandedCardId === card.id
                            const hasHistory = paidCount > 0
                            return (
                                <div key={card.id} className="px-6 py-3">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-theme-text-primary font-semibold text-sm">{card.full_name || 'N/A'}</span>
                                                {card.masked_pan && (
                                                    <span className="font-mono text-sm text-theme-text-secondary">
                                                        {card.masked_pan}
                                                    </span>
                                                )}
                                                {/* 2026-06-02: badge brand + tipo finanziario mostrati
                                                    SEMPRE. Se Nexi/BIN lookup non hanno valorizzato i
                                                    campi, ricaviamo il brand dalla prima cifra del PAN
                                                    (4=Visa, 5=MC, 3=Amex/Diners) e marchiamo il tipo
                                                    "Sconosciuto" cosi' direzione vede subito quali
                                                    carte vanno rilookuppate. */}
                                                {(() => {
                                                    const rawBrand = (card.card_brand || card.circuit || '').toLowerCase()
                                                    const panFirst = (card.masked_pan || '').replace(/\D/g, '').charAt(0)
                                                    const derivedBrand = !rawBrand && panFirst
                                                        ? (panFirst === '4' ? 'visa'
                                                            : panFirst === '5' || panFirst === '2' ? 'mastercard'
                                                            : panFirst === '3' ? 'amex'
                                                            : '')
                                                        : ''
                                                    const brandLabel = rawBrand || derivedBrand || 'Brand sconosciuto'
                                                    const brandKnown = !!(rawBrand || derivedBrand)
                                                    return (
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${
                                                            brandKnown
                                                                ? 'bg-dr7-gold/10 text-dr7-gold border-dr7-gold/30'
                                                                : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                                                        }`}>
                                                            {brandLabel}
                                                        </span>
                                                    )
                                                })()}
                                                {(() => {
                                                    // 2026-06-04: il tipo carta viene risolto AUTOMATICAMENTE
                                                    // al caricamento (autoResolveCardTypes → BIN del PAN o
                                                    // recupero da Nexi). Questo dropdown resta come OVERRIDE
                                                    // manuale: se l'auto-detection sbaglia o lascia
                                                    // "Sconosciuto", la direzione forza credit/debit/prepaid
                                                    // da qui (source 'manual', mai sovrascritto dall'auto).
                                                    const t = (card.card_type || '').toLowerCase()
                                                    const cls = t === 'credit' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' :
                                                        t === 'debit' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
                                                        t === 'prepaid' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                                                        'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                                                    return (
                                                        <select
                                                            value={t === 'credit' || t === 'debit' || t === 'prepaid' ? t : ''}
                                                            onChange={async (e) => {
                                                                const next = e.target.value
                                                                if (!card.contract_id) return
                                                                const prev = card.card_type
                                                                // Optimistic UI: update list synchronously so the
                                                                // badge changes color instantly. Roll back on error.
                                                                setTokenizedCards(cards => cards.map(c =>
                                                                    c.id === card.id ? { ...c, card_type: next } : c
                                                                ))
                                                                try {
                                                                    const res = await authFetch('/.netlify/functions/nexi-set-card-type', {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ contractId: card.contract_id, cardType: next || 'unknown' }),
                                                                    })
                                                                    const json = await res.json().catch(() => ({} as Record<string, unknown>))
                                                                    if (!res.ok) {
                                                                        setTokenizedCards(cards => cards.map(c =>
                                                                            c.id === card.id ? { ...c, card_type: prev } : c
                                                                        ))
                                                                        toast.error(`Errore: ${(json as { error?: string }).error || res.status}`)
                                                                    } else {
                                                                        toast.success(next ? `Tipo carta impostato: ${next}` : 'Tipo carta azzerato')
                                                                    }
                                                                } catch (err: unknown) {
                                                                    setTokenizedCards(cards => cards.map(c =>
                                                                        c.id === card.id ? { ...c, card_type: prev } : c
                                                                    ))
                                                                    toast.error(`Errore: ${err instanceof Error ? err.message : 'sconosciuto'}`)
                                                                }
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase cursor-pointer focus:outline-none focus:ring-1 focus:ring-dr7-gold ${cls}`}
                                                            title="Imposta credito / debito / prepagata"
                                                        >
                                                            <option value="">Tipo sconosciuto</option>
                                                            <option value="credit">Credito</option>
                                                            <option value="debit">Debito</option>
                                                            <option value="prepaid">Prepagata</option>
                                                        </select>
                                                    )
                                                })()}
                                            </div>
                                            <div className="text-xs text-theme-text-muted mt-0.5">
                                                {card.email}{card.phone ? ` · ${card.phone}` : ''}
                                                <span className="ml-2 font-mono">ID: ...{card.contract_id.slice(-8)}</span>
                                                {card.updated_at && (
                                                    <span className="ml-2">{formatRomeDate(new Date(card.updated_at), { dateStyle: 'short' })}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {hasHistory && (
                                                <button
                                                    onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                                                    className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20"
                                                    title={isExpanded ? 'Nascondi storico' : 'Mostra storico pagamenti'}
                                                >
                                                    <span className="font-semibold">€{(paidCents / 100).toFixed(2).replace('.', ',')}</span>
                                                    <span className="text-emerald-400/70">· {paidCount} pagament{paidCount === 1 ? 'o' : 'i'}</span>
                                                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>
                                            )}
                                            {card.contract_id && (
                                                <button
                                                    onClick={() => openPreauthModal(card)}
                                                    className="text-[11px] px-2 py-1 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 whitespace-nowrap"
                                                    title="Crea pre-autorizzazione (blocca fondi senza addebitare)"
                                                >
                                                    Pre-autorizza
                                                </button>
                                            )}
                                            {card.contract_id && (
                                                <button
                                                    onClick={() => deleteCard(card)}
                                                    className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 whitespace-nowrap"
                                                    title="Elimina questa carta tokenizzata"
                                                >
                                                    Elimina
                                                </button>
                                            )}
                                            {/* 2026-06-04: bottone Diagnostica rimosso su richiesta utente.
                                                Il dropdown "Tipo" inline copre il caso d'uso (forzare il
                                                tipo carta). diagnoseCard() resta nel file come utility
                                                in caso serva per debug futuro. */}
                                        </div>
                                    </div>
                                    {card.contract_id && (
                                        <div className="mt-2">
                                            <CustomerAddebitoButton
                                                cards={(card.email ? tokenizedCards.filter(tc => tc.email === card.email && tc.contract_id) : [card]).map(tc => ({
                                                    contractId: tc.contract_id,
                                                    maskedPan: tc.masked_pan || undefined,
                                                    circuit: tc.circuit || undefined,
                                                    cardType: tc.card_type || undefined,
                                                    brand: tc.card_brand || undefined,
                                                    isDefault: tc.is_default,
                                                }))}
                                                defaultContractId={card.contract_id}
                                                customerEmail={card.email}
                                                customerName={card.full_name}
                                                onDone={fetchAllAddebiti}
                                            />
                                        </div>
                                    )}
                                    {isExpanded && hasHistory && (
                                        <div className="mt-3 pl-2 border-l-2 border-emerald-500/30 space-y-1.5">
                                            {payments.map((p, i) => (
                                                <div key={`${p.order_id}_${i}`} className="flex items-center justify-between gap-3 text-xs">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-theme-text-primary truncate">{p.description || 'Pagamento Nexi'}</div>
                                                        <div className="text-theme-text-muted font-mono text-[10px]">
                                                            {p.paid_at ? formatRomeDate(new Date(p.paid_at), { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                                            {p.order_id ? ` · ${p.order_id}` : ''}
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-emerald-400 font-semibold shrink-0">
                                                        €{(p.amount_cents / 100).toFixed(2).replace('.', ',')}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
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
                                            {tx.status === 'preauth_held' ? (
                                                <div className="flex flex-col sm:flex-row gap-1.5">
                                                    <button
                                                        onClick={() => handleCapturePreauth(tx)}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-700/50 whitespace-nowrap"
                                                        title="Cattura i fondi bloccati"
                                                    >
                                                        Cattura
                                                    </button>
                                                    <button
                                                        onClick={() => handleVoidPreauth(tx)}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover border border-theme-border whitespace-nowrap"
                                                        title="Sblocca i fondi senza addebitare"
                                                    >
                                                        Annulla
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => openAddebitoModal(tx)}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors"
                                                >
                                                    Nuovo Addebito
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Nuovo Addebito Modal — bottom-sheet su mobile, centered card
                su sm+. Body scrollabile, footer pinned con safe-area-inset-bottom. */}
            {showAddebitoModal && addebitoTx && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowAddebitoModal(false)}>
                    <div
                        className="bg-theme-bg-secondary w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl border border-theme-border flex flex-col max-h-full sm:max-h-[90vh] overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-4">
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
                    </div>

                    {/* Footer pinned al fondo del modal, safe-area aware */}
                    <div
                        className="flex gap-3 justify-end px-5 sm:px-6 pt-3 border-t border-theme-border bg-theme-bg-secondary flex-shrink-0"
                        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                    >
                        <button
                            onClick={() => setShowAddebitoModal(false)}
                            className="px-4 py-2 min-h-[44px] rounded-lg text-sm bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={handleNuovoAddebito}
                            disabled={addebitoSending}
                            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                            {addebitoSending ? 'Invio...' : 'Invia Email e Programma Addebito'}
                        </button>
                    </div>
                    </div>
                </div>
            )}

            {/* Pre-autorizzazione modal — usa la carta tokenizzata esistente
                (MIT con captureType=EXPLICIT). Blocca i fondi sulla carta del
                cliente ma non li addebita finche\' non viene catturata o
                annullata (entro 7gg lato Nexi).                              */}
            {showPreauthModal && preauthCard && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => !preauthSending && setShowPreauthModal(false)}>
                    <div
                        className="bg-theme-bg-secondary w-full sm:max-w-md rounded-t-2xl sm:rounded-xl border border-theme-border flex flex-col max-h-full sm:max-h-[90vh] overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-theme-text-primary">Pre-autorizzazione</h3>
                                    <p className="text-xs text-theme-text-muted mt-0.5">Blocca i fondi senza addebitarli. Cattura entro {Math.max(1, Math.min(365, parseInt(preauthDurationDays) || 7))} {Math.max(1, Math.min(365, parseInt(preauthDurationDays) || 7)) === 1 ? 'giorno' : 'giorni'} o annulla.</p>
                                </div>
                                <button
                                    onClick={() => setShowPreauthModal(false)}
                                    disabled={preauthSending}
                                    className="text-theme-text-muted hover:text-theme-text-primary text-xl leading-none"
                                    title="Chiudi"
                                >×</button>
                            </div>

                            <div className="text-sm text-theme-text-secondary space-y-1 bg-theme-bg-tertiary rounded-lg p-3">
                                <p><strong>Cliente:</strong> {preauthCard.full_name || preauthCard.email}</p>
                                <p><strong>Email:</strong> {preauthCard.email || '—'}</p>
                                {preauthCard.masked_pan && (
                                    <p><strong>Carta:</strong> <span className="font-mono">{preauthCard.masked_pan}</span></p>
                                )}
                                <p className="text-xs text-theme-text-muted"><strong>Contract ID:</strong> <span className="font-mono">{preauthCard.contract_id}</span></p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Importo (€) *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={preauthAmount}
                                    onChange={(e) => setPreauthAmount(e.target.value)}
                                    placeholder="es. 500.00"
                                    disabled={preauthSending}
                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Causale (opzionale)</label>
                                <input
                                    type="text"
                                    value={preauthDescription}
                                    onChange={(e) => setPreauthDescription(e.target.value)}
                                    placeholder="es. Cauzione noleggio Audi RS3"
                                    disabled={preauthSending}
                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Durata blocco fondi</label>
                                <div className="flex gap-1.5 flex-wrap items-center">
                                    {[
                                        { d: 1, l: '1g' },
                                        { d: 7, l: '7g' },
                                        { d: 30, l: '1 mese' },
                                        { d: 90, l: '3 mesi' },
                                        { d: 180, l: '6 mesi' },
                                        { d: 365, l: '1 anno' },
                                    ].map(({ d, l }) => (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => setPreauthDurationDays(String(d))}
                                            disabled={preauthSending}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${preauthDurationDays === String(d) ? 'bg-blue-600 text-white border-blue-600' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border hover:border-blue-500/50'}`}
                                        >{l}</button>
                                    ))}
                                    <input
                                        type="number"
                                        min="1"
                                        max="365"
                                        value={preauthDurationDays}
                                        onChange={(e) => setPreauthDurationDays(e.target.value)}
                                        disabled={preauthSending}
                                        className="w-24 px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                        placeholder="giorni"
                                    />
                                </div>
                                {preauthAmount && parseFloat(preauthAmount) > 0 && (() => {
                                    const days = Math.max(1, Math.min(365, parseInt(preauthDurationDays) || 7))
                                    const captureBy = new Date(Date.now() + days * 86400000)
                                    return (
                                        <p className="text-[11px] text-theme-text-muted mt-1.5">
                                            Scadenza pre-autorizzazione: <span className="text-theme-text-primary font-semibold">{captureBy.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                            {days > 6 && <span className="text-blue-400"> · auto-rinnovo ogni 6g</span>}
                                        </p>
                                    )
                                })()}
                            </div>

                            <div className="text-[11px] text-theme-text-muted bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 leading-relaxed">
                                <strong className="text-blue-400">Come funziona:</strong> blocco fondi silenzioso sulla carta tokenizzata del cliente. Per durate {'>'} 6 giorni il sistema rinnova automaticamente il blocco ogni 6g (cron giornaliero). Catturi o annulli in qualsiasi momento.
                            </div>
                        </div>

                        <div
                            className="px-5 sm:px-6 py-3 sm:py-4 border-t border-theme-border bg-theme-bg-secondary flex gap-2 justify-end flex-shrink-0"
                            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                        >
                            <button
                                onClick={() => setShowPreauthModal(false)}
                                disabled={preauthSending}
                                className="px-4 py-2 rounded-lg text-sm bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover"
                            >Annulla</button>
                            <button
                                onClick={handleCreatePreauth}
                                disabled={preauthSending || !preauthAmount}
                                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {preauthSending ? 'Creazione...' : 'Crea Pre-autorizzazione'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modale "Link Pre-Autorizzazione" — invia link al cliente per
                bloccare fondi (no addebito). Usa nexi-create-preauth backend
                (cauzioneId omesso → orderId con prefisso "PA"). */}
            {showPreauthLinkModal && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !preauthLinkSending && setShowPreauthLinkModal(false)}>
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl max-w-lg w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-lg font-bold text-theme-text-primary">Link Pre-Autorizzazione</h3>
                                <p className="text-xs text-theme-text-muted mt-1">
                                    Il cliente paga via link Nexi; i fondi vengono <strong>bloccati</strong>, non addebitati.
                                    Tu poi clicchi <em>Cattura</em> o <em>Sblocca</em> sulla riga della transazione.
                                </p>
                            </div>
                            <button
                                onClick={() => !preauthLinkSending && setShowPreauthLinkModal(false)}
                                className="text-theme-text-muted hover:text-theme-text-primary text-xl leading-none"
                                aria-label="Chiudi"
                            >×</button>
                        </div>

                        {!preauthLinkResult ? (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="block">
                                        <span className="text-xs text-theme-text-muted">Importo (€) *</span>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={preauthLinkAmount}
                                            onChange={e => setPreauthLinkAmount(e.target.value)}
                                            placeholder="es. 500.00"
                                            className="w-full mt-1 px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs text-theme-text-muted">Scadenza (ore) *</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max="8760"
                                            value={preauthLinkExpirationHours}
                                            onChange={e => setPreauthLinkExpirationHours(e.target.value)}
                                            className="w-full mt-1 px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                        />
                                        <span className="text-[10px] text-theme-text-muted">Default 168 (7 giorni). Max 8760 (1 anno).</span>
                                    </label>
                                </div>

                                <label className="block">
                                    <span className="text-xs text-theme-text-muted">Nome cliente</span>
                                    <input
                                        type="text"
                                        value={preauthLinkCustomerName}
                                        onChange={e => setPreauthLinkCustomerName(e.target.value)}
                                        placeholder="Mario Rossi"
                                        className="w-full mt-1 px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                    />
                                </label>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="block">
                                        <span className="text-xs text-theme-text-muted">Email cliente</span>
                                        <input
                                            type="email"
                                            value={preauthLinkCustomerEmail}
                                            onChange={e => setPreauthLinkCustomerEmail(e.target.value)}
                                            placeholder="cliente@example.com"
                                            className="w-full mt-1 px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs text-theme-text-muted">Telefono (WhatsApp)</span>
                                        <input
                                            type="tel"
                                            value={preauthLinkCustomerPhone}
                                            onChange={e => setPreauthLinkCustomerPhone(e.target.value)}
                                            placeholder="+39 333 1234567"
                                            className="w-full mt-1 px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                        />
                                    </label>
                                </div>

                                <label className="block">
                                    <span className="text-xs text-theme-text-muted">Descrizione</span>
                                    <input
                                        type="text"
                                        value={preauthLinkDescription}
                                        onChange={e => setPreauthLinkDescription(e.target.value)}
                                        placeholder="es. Cauzione noleggio Porsche 911 - 25/05"
                                        className="w-full mt-1 px-3 py-2 text-sm bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                    />
                                </label>

                                <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                                    <input
                                        type="checkbox"
                                        checked={preauthLinkSendWhatsApp}
                                        onChange={e => setPreauthLinkSendWhatsApp(e.target.checked)}
                                        className="w-4 h-4"
                                    />
                                    Invia link via WhatsApp al telefono inserito
                                </label>

                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        onClick={() => setShowPreauthLinkModal(false)}
                                        disabled={preauthLinkSending}
                                        className="px-4 py-2 rounded-lg text-sm bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-50"
                                    >Annulla</button>
                                    <button
                                        onClick={handleCreatePreauthLink}
                                        disabled={preauthLinkSending || !preauthLinkAmount}
                                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-black hover:bg-dr7-gold/85 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {preauthLinkSending ? 'Creazione...' : 'Crea link e invia'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="p-4 bg-green-900/20 border border-green-600/50 rounded-lg space-y-2">
                                    <p className="text-sm text-green-300 font-semibold">✓ Link creato</p>
                                    <p className="text-xs text-theme-text-muted">Order ID: <code className="text-theme-text-primary">{preauthLinkResult.orderId}</code></p>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={preauthLinkResult.url}
                                            readOnly
                                            className="flex-1 px-3 py-2 text-xs bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                                        />
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(preauthLinkResult.url); toast.success('Link copiato') }}
                                            className="px-3 py-2 text-xs rounded-lg bg-dr7-gold text-black font-semibold"
                                        >Copia</button>
                                    </div>
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setShowPreauthLinkModal(false)}
                                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-black hover:bg-dr7-gold/85"
                                    >Chiudi</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
