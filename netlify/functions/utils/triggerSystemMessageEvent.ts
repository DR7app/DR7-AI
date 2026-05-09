/**
 * triggerSystemMessageEvent — invia in tempo reale i template Messaggi di
 * Sistema Pro che hanno trigger_event = <event> e offset compatibile con "ora".
 *
 * Usato dai code-path che sanno *quando* avviene un evento (creazione
 * prenotazione, pagamento ricevuto, firma contratto, ecc.) per non aspettare
 * il prossimo giro del cron process-scheduled-system-messages-cron.
 *
 * Dedup: usa la stessa tabella system_message_send_log del cron, quindi
 * niente doppi invii.
 *
 * Esempio:
 *   await triggerSystemMessageEvent({ bookingId, event: 'on_booking' })
 */
import { createClient } from '@supabase/supabase-js'

type TriggerEvent =
    | 'on_booking' | 'on_payment' | 'on_signature' | 'on_extension'
    | 'on_cauzione_created' | 'on_cauzione_collected' | 'on_cauzione_refunded'
    | 'on_first_booking'
    | 'on_doc_uploaded' | 'on_doc_verified'
    | 'on_payment_failed' | 'on_payment_link_expired'

interface TriggerArgs {
    /** ID dell'entità da collegare nel send_log. Se l'evento e' booking-based,
     *  e' il booking_id reale. Per cauzione e' cauzione_id, ecc. */
    bookingId: string
    event: TriggerEvent
    /** Massimo offset_hours da considerare "immediato" (default: 1) */
    maxOffsetHours?: number
    /** Synthetic entity passato direttamente al sender quando l'evento NON
     *  e' booking-based. Se omesso, il sender carica la riga 'bookings'.
     *  Usalo per gli eventi cauzione/documenti/customer-lifecycle. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syntheticBooking?: Record<string, any>
}

/**
 * Applica i filtri avanzati alla coppia (template, booking).
 * Ritorna true se il template DEVE partire per questa booking, false
 * se va saltato perche' il booking non rispetta uno dei filtri.
 *
 * Filtri (tutti opzionali, default = nessuna restrizione):
 *  - target_service_type: rental | car_wash | mechanical | all
 *  - target_with_deposit: yes | no | all (booking ha cauzione?)
 *  - target_plate: targa esatta del veicolo
 *  - target_payment_method: card | wallet | cash | bonifico | all
 *  - target_amount_min/max: range importo booking in euro
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matchesAdvancedFilters(tpl: any, booking: any): boolean {
    // Service type — solo 2 categorie reali nel sistema:
    //   rental     = car rental (service_type vuoto / 'rental' / 'car_rental')
    //   prime_wash = lavaggio + meccanica (service_type 'car_wash' /
    //                'mechanical' / 'mechanical_service')
    const tplSvc = String(tpl.target_service_type || 'all').toLowerCase()
    if (tplSvc !== 'all') {
        const bSvc = String(booking.service_type || 'rental').toLowerCase()
        const bookingIsRental = !booking.service_type || bSvc === 'rental' || bSvc === 'car_rental'
        const bookingIsPrimeWash = bSvc === 'car_wash' || bSvc === 'mechanical' || bSvc === 'mechanical_service'
        if (tplSvc === 'rental' && !bookingIsRental) return false
        if (tplSvc === 'prime_wash' && !bookingIsPrimeWash) return false
        // Retrocompatibilita': accetta anche le vecchie etichette se gia' configurate
        if (tplSvc === 'car_wash' && bSvc !== 'car_wash') return false
        if (tplSvc === 'mechanical' && bSvc !== 'mechanical' && bSvc !== 'mechanical_service') return false
    }

    // With deposit? — controlla TUTTI i tipi di cauzione possibili:
    //   1. cauzione standard di noleggio (booking_details.deposit)
    //   2. deposit_amount top-level
    //   3. cauzione_veicoli extra (extras.cauzione_veicoli_total)
    //   4. cauzione_veicoli_total in booking_details.extras
    const tplDep = String(tpl.target_with_deposit || 'all').toLowerCase()
    if (tplDep !== 'all') {
        const depAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0)
        const depOption = booking.booking_details?.depositOption
        const standardDeposit = depAmount > 0 && depOption !== 'no_deposit'
        const cauzioneVeicoli = Number(
            booking.booking_details?.extras?.cauzione_veicoli_total
            ?? booking.booking_details?.cauzione_veicoli_total
            ?? booking.extras?.cauzione_veicoli_total
            ?? 0
        )
        const hasDeposit = standardDeposit || cauzioneVeicoli > 0
        if (tplDep === 'yes' && !hasDeposit) return false
        if (tplDep === 'no' && hasDeposit) return false
    }

    // Plate
    if (tpl.target_plate && typeof tpl.target_plate === 'string') {
        const want = tpl.target_plate.toUpperCase().replace(/\s/g, '')
        const have = String(booking.vehicle_plate || booking.plate || '').toUpperCase().replace(/\s/g, '')
        if (want && have !== want) return false
    }

    // Payment method
    const tplPM = String(tpl.target_payment_method || 'all').toLowerCase()
    if (tplPM !== 'all') {
        const m = String(booking.payment_method || '').toLowerCase()
        const isCard = m.includes('card') || m.includes('carta') || m.includes('nexi') || m.includes('stripe') || m.includes('bancomat') || m.includes('pos') || m.includes('debit')
        const isWallet = m === 'credit' || m.includes('wallet') || m.includes('credit_wallet')
        const isCash = m.includes('contanti') || m.includes('cash')
        const isBonifico = m.includes('bonifico') || m.includes('wire') || m.includes('bank')
        if (tplPM === 'card' && !isCard) return false
        if (tplPM === 'wallet' && !isWallet) return false
        if (tplPM === 'cash' && !isCash) return false
        if (tplPM === 'bonifico' && !isBonifico) return false
    }

    // Amount range (booking.price_total e' in cents in alcuni schemi,
    // booking.total_amount in euro in altri — proviamo entrambi).
    const min = tpl.target_amount_min == null ? null : Number(tpl.target_amount_min)
    const max = tpl.target_amount_max == null ? null : Number(tpl.target_amount_max)
    if (min != null || max != null) {
        let amountEur = 0
        if (typeof booking.total_amount === 'number') amountEur = booking.total_amount
        else if (typeof booking.price_total === 'number') amountEur = booking.price_total / 100
        if (min != null && amountEur < min) return false
        if (max != null && amountEur > max) return false
    }

    return true
}

export async function triggerSystemMessageEvent({ bookingId, event, maxOffsetHours = 1, syntheticBooking }: TriggerArgs): Promise<{ sent: number; skipped: number; errors: number }> {
    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'

    // 1. Carica la booking — oppure usa il syntheticBooking passato dal caller
    //    (per eventi cauzione/documenti/customer dove non c'e' una vera booking).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let booking: any = null
    if (syntheticBooking) {
        booking = syntheticBooking
    } else {
        const { data } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .maybeSingle()
        booking = data
    }
    if (!booking) return { sent: 0, skipped: 0, errors: 0 }

    // 2. Carica i template attivi per questo evento, con offset basso (<= 1h
    //    di default). Templates con offset alto (es. 24h prima del pickup)
    //    saranno gestiti dal cron, non qui.
    const { data: templates } = await supabase
        .from('system_messages')
        .select('id, message_key, label, trigger_offset_hours, target_status, target_category, target_service_type, target_with_deposit, target_plate, target_payment_method, target_amount_min, target_amount_max')
        .eq('is_automatic', true)
        .eq('is_enabled', true)
        .eq('trigger_event', event)
        .lte('trigger_offset_hours', maxOffsetHours)
    if (!templates?.length) return { sent: 0, skipped: 0, errors: 0 }

    let sent = 0, skipped = 0, errors = 0

    for (const tpl of templates) {
        if (!matchesAdvancedFilters(tpl, booking)) continue

        // 3. Filtri: status + categoria
        const statuses = (tpl.target_status || 'confirmed,active').split(',').map((s: string) => s.trim()).filter(Boolean)
        if (statuses.length > 0 && !statuses.includes(booking.status)) continue

        if (tpl.target_category && tpl.target_category !== 'all') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cat = (booking as any).vehicle_category
                || booking.booking_details?.vehicle?.category
                || booking.booking_details?.vehicleCategory
                || ''
            if (String(cat).toLowerCase() !== String(tpl.target_category).toLowerCase()) continue
        }

        // 4. Dedup: gia' inviato?
        const { data: existing } = await supabase
            .from('system_message_send_log')
            .select('id')
            .eq('system_message_id', tpl.id)
            .eq('booking_id', booking.id)
            .maybeSingle()
        if (existing?.id) { skipped++; continue }

        // 5. Invia via send-whatsapp-notification
        try {
            const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ booking, messageKey: tpl.message_key }),
            })
            const ok = res.ok
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let resp: any = null
            try { resp = await res.json() } catch { /* ignore */ }

            await supabase.from('system_message_send_log').insert({
                system_message_id: tpl.id,
                booking_id: booking.id,
                customer_phone: booking.customer_phone,
                status: ok ? (resp?.skipped ? 'skipped' : 'sent') : 'error',
                error: ok ? null : `HTTP ${res.status}`,
            })

            if (ok) {
                if (resp?.skipped) skipped++
                else sent++
            } else {
                errors++
            }
        } catch (e: unknown) {
            errors++
            const msg = e instanceof Error ? e.message : String(e)
            try {
                await supabase.from('system_message_send_log').insert({
                    system_message_id: tpl.id,
                    booking_id: booking.id,
                    customer_phone: booking.customer_phone,
                    status: 'error',
                    error: msg.slice(0, 500),
                })
            } catch { /* dedup race ok */ }
        }
    }

    return { sent, skipped, errors }
}
