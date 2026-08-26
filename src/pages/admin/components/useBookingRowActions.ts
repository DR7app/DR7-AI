/**
 * Azioni di riga di una prenotazione — UNA sola implementazione per tutti i
 * business (roadmap #11 / #16).
 *
 * Il Noleggio Terra aveva il menu "Gestisci" con contratto, fattura, link di
 * pagamento, mezzo pronto, danni e penali. Mare, Aria e Soggiorni avevano tre
 * link scarni (Dettagli · Modifica · Elimina): stessa tabella `bookings`,
 * stesse funzioni serverless disponibili, ma niente di tutto questo a portata
 * di mano.
 *
 * La tentazione era ricopiare le azioni nell'altro tab. E' esattamente cio' che
 * ha prodotto la situazione attuale: due implementazioni della stessa cosa, che
 * divergono alla prima correzione. Qui la logica sta in UN punto e i tab la
 * chiamano. Correggere un comportamento lo corregge ovunque.
 *
 * Terra NON passa (ancora) da qui: e' il business piu' usato e il suo codice
 * resta intatto finche' queste azioni non sono verificate sugli altri. Le
 * chiamate replicano pero' le sue, endpoint e payload compresi, cosi' il
 * passaggio successivo e' una sostituzione e non una riscrittura.
 */
import { useCallback, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { logAdminAction } from '../../../utils/logAdminAction'

export interface BookingLike {
    id: string
    customer_name?: string | null
    customer_email?: string | null
    customer_phone?: string | null
    vehicle_name?: string | null
    price_total?: number | null
    payment_method?: string | null
    payment_status?: string | null
    status?: string | null
    service_type?: string | null
    contract_url?: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details?: Record<string, any> | null
}

/**
 * Etichetta del "pronto al ritiro": una parola sola, uguale per ogni business.
 * Prima cambiava per servizio ("Auto Pronta", "Mezzo Pronto", "Velivolo
 * Pronto", "Struttura Pronta"): lo stesso bottone si chiamava in quattro modi.
 */
export function prontoLabel(_serviceType?: string | null): string {
    return 'PRONTA'
}

/** Trigger dei Messaggi di Sistema Pro per il "pronto", uno per business. */
function prontoEvent(serviceType?: string | null): string {
    switch (String(serviceType || '').toLowerCase()) {
        case 'boat_rental': return 'boat_pronto'
        case 'heli_rental': return 'heli_pronto'
        case 'stay_rental': return 'stay_pronto'
        default: return 'rental_auto_pronta'
    }
}

const isNexiPayByLink = (m?: string | null) => /nexi/i.test(String(m || ''))
const isPaid = (b: BookingLike) =>
    ['paid', 'completed', 'succeeded'].includes(String(b.payment_status || '').toLowerCase())

export function useBookingRowActions(onChanged: () => void) {
    const [busy, setBusy] = useState<string | null>(null)
    // Lock sincrono per prenotazione: `busy` e' stato React e si aggiorna al
    // rendere successivo, quindi un doppio click passa comunque e il cliente
    // riceve due volte lo stesso messaggio.
    const lock = useRef<Set<string>>(new Set())

    const conLock = useCallback(async (key: string, fn: () => Promise<void>) => {
        if (lock.current.has(key)) return
        lock.current.add(key)
        setBusy(key)
        try { await fn() } finally { lock.current.delete(key); setBusy(null) }
    }, [])

    /** Genera il contratto. Se esiste gia', il chiamante apre l'URL. */
    const generaContratto = useCallback((b: BookingLike) => conLock(`contract:${b.id}`, async () => {
        const id = toast.loading('Generazione contratto...')
        try {
            const res = await authFetch('/.netlify/functions/generate-contract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: b.id }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data?.skipped) {
                toast.error(data?.reason || data?.error || 'Contratto non generato', { id })
                return
            }
            toast.success('Contratto generato', { id })
            logAdminAction('generate_contract', 'booking', b.id, { business: b.service_type })
            onChanged()
        } catch (e) {
            toast.error('Errore: ' + (e as Error).message, { id })
        }
    }), [conLock, onChanged])

    /** Rimanda il contratto al cliente per la firma. */
    const inviaContratto = useCallback((b: BookingLike) => conLock(`send-contract:${b.id}`, async () => {
        const id = toast.loading('Invio contratto...')
        try {
            const res = await authFetch('/.netlify/functions/generate-contract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // reconduct: se il contratto e' GIA' firmato non si richiede una
                // nuova firma, si ristampa la firma sulle date correnti. Stessa
                // regola del Noleggio Terra.
                body: JSON.stringify({ bookingId: b.id, reconduct: true, sendToCustomer: true }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data?.error || 'Invio non riuscito', { id }); return }
            toast.success('Contratto inviato al cliente', { id })
            logAdminAction('send_contract', 'booking', b.id, { business: b.service_type })
            onChanged()
        } catch (e) {
            toast.error('Errore: ' + (e as Error).message, { id })
        }
    }), [conLock, onChanged])

    const generaFattura = useCallback((b: BookingLike) => conLock(`invoice:${b.id}`, async () => {
        const id = toast.loading('Generazione fattura...')
        try {
            const res = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: b.id, includeIVA: true }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                // Fattura gia' esistente non e' un errore: il backend la rimanda a SDI.
                if (data?.invoiceNumber) { toast.success(`Fattura ${data.invoiceNumber} già esistente`, { id }); return }
                toast.error(data?.message || data?.error || 'Impossibile generare la fattura', { id })
                return
            }
            toast.success(`Fattura ${data?.invoiceNumber || ''} generata`, { id })
            logAdminAction('generate_invoice', 'booking', b.id, { business: b.service_type })
            onChanged()
        } catch (e) {
            toast.error('Errore: ' + (e as Error).message, { id })
        }
    }), [conLock, onChanged])

    const linkPagamento = useCallback((b: BookingLike) => conLock(`paylink:${b.id}`, async () => {
        // Nexi rifiuta un link da 0 euro. Meglio dirlo subito che lasciare
        // partire una chiamata destinata a fallire.
        if (!(Number(b.price_total) > 0)) {
            toast.error('Il totale della prenotazione e\' 0,00 €: correggi l\'importo prima di generare il link.')
            return
        }
        const id = toast.loading('Generazione link di pagamento...')
        try {
            const ref = b.id.substring(0, 8).toUpperCase()
            const res = await authFetch('/.netlify/functions/nexi-pay-by-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: b.id,
                    amount: (b.price_total || 0) / 100,
                    customerEmail: b.customer_email || b.booking_details?.customer?.email || '',
                    customerName: b.customer_name || 'Cliente',
                    description: `Prenotazione #${ref} - ${b.vehicle_name || ''}`.trim(),
                    expirationHours: 1,
                    paymentPurpose: 'booking',
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.paymentUrl) {
                toast.error('Errore generazione link: ' + (data?.error || 'riprova'), { id })
                return
            }
            await supabase.from('bookings').update({
                booking_details: {
                    ...(b.booking_details || {}),
                    nexi_payment_link: data.paymentUrl,
                    nexi_order_id: data.orderId || null,
                    payment_link_created_at: new Date().toISOString(),
                    payment_link_expires_at: data.expiresAt || new Date(Date.now() + 3600000).toISOString(),
                },
            }).eq('id', b.id)

            const phone = String(b.customer_phone || '').replace(/\D/g, '')
            if (!phone) {
                toast('Link generato, ma il cliente non ha un numero di telefono in scheda.', { id, icon: '⚠️' })
                onChanged()
                return
            }
            const amount = ((b.price_total || 0) / 100).toFixed(2)
            const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customPhone: phone,
                    templateKey: 'payment_link_customer',
                    booking: b,
                    templateVars: {
                        nome: String(b.customer_name || 'Cliente').split(' ')[0],
                        amount, total: amount, importo: amount, totale: amount,
                        link: data.paymentUrl, payment_link: data.paymentUrl,
                        booking_id: ref, booking_ref: ref, expiry: '1 ora',
                    },
                }),
            })
            // L'esito VA letto. La funzione risponde 200 anche quando non
            // spedisce: template assente, spento, vuoto, oppure limitato a un
            // altro tipo di servizio (un template "Solo Noleggio" scarta una
            // prenotazione Mare). Dirlo "inviato" senza guardare era il motivo
            // per cui il link non arrivava e nessuno capiva perche'.
            const waOut = await waRes.json().catch(() => ({}))
            if (!waRes.ok || waOut?.skipped) {
                const perche = waOut?.reason === 'service_type_mismatch'
                    ? 'il messaggio "Invio link pagamento" e\' limitato a un altro tipo di servizio: in Messaggi di Sistema Pro mettilo su "Tutti" oppure sul business giusto.'
                    : waOut?.reason === 'pro_template_unavailable'
                        ? 'manca il messaggio "Invio link pagamento" in Messaggi di Sistema Pro (assente, spento o senza testo).'
                        : waOut?.reason === 'invalid_phone'
                            ? `il numero "${b.customer_phone}" non e' utilizzabile.`
                            : (waOut?.message || 'motivo sconosciuto')
                toast.error(`Link generato ma NON inviato: ${perche}`, { id, duration: 12000 })
                console.error('[linkPagamento] invio non riuscito:', waOut)
                onChanged()
                return
            }
            toast.success('Link inviato al cliente', { id })
            logAdminAction('send_payment_link', 'booking', b.id, { business: b.service_type })
            onChanged()
        } catch (e) {
            toast.error('Errore: ' + (e as Error).message, { id })
        }
    }), [conLock, onChanged])

    /**
     * "Pronto al ritiro" — il corpo arriva dal template Pro del business
     * (boat_pronto / heli_pronto / stay_pronto). Nessun testo nel codice: se il
     * template non e' compilato non parte niente, ed e' il comportamento voluto.
     */
    const segnalaPronto = useCallback((b: BookingLike) => conLock(`pronto:${b.id}`, async () => {
        if (b.booking_details?.pronto_sent_at) { toast('Cliente già avvisato'); return }
        const phone = String(b.customer_phone || '').replace(/\D/g, '')
        if (!phone) { toast.error('Il cliente non ha un numero di telefono in scheda'); return }
        const id = toast.loading('Invio avviso...')
        try {
            const res = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customPhone: phone,
                    templateKey: prontoEvent(b.service_type),
                    booking: b,
                    templateVars: { nome: String(b.customer_name || 'Cliente').split(' ')[0] },
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data?.skipped) {
                toast.error(
                    data?.reason === 'pro_template_unavailable'
                        ? 'Il messaggio non esiste, è spento o è vuoto in Messaggi di Sistema Pro'
                        : (data?.message || 'Invio non riuscito'),
                    { id },
                )
                return
            }
            await supabase.from('bookings').update({
                booking_details: { ...(b.booking_details || {}), pronto_sent_at: new Date().toISOString() },
            }).eq('id', b.id)
            toast.success('Cliente avvisato', { id })
            logAdminAction('pronto_sent', 'booking', b.id, { business: b.service_type })
            onChanged()
        } catch (e) {
            toast.error('Errore: ' + (e as Error).message, { id })
        }
    }), [conLock, onChanged])

    return { busy, generaContratto, inviaContratto, generaFattura, linkPagamento, segnalaPronto, isNexiPayByLink, isPaid }
}
