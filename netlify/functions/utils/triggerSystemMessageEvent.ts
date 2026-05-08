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

interface TriggerArgs {
    bookingId: string
    event: 'on_booking' | 'on_payment' | 'on_signature' | 'on_extension'
    /** Massimo offset_hours da considerare "immediato" (default: 1) */
    maxOffsetHours?: number
}

export async function triggerSystemMessageEvent({ bookingId, event, maxOffsetHours = 1 }: TriggerArgs): Promise<{ sent: number; skipped: number; errors: number }> {
    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'

    // 1. Carica la booking
    const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .maybeSingle()
    if (!booking) return { sent: 0, skipped: 0, errors: 0 }

    // 2. Carica i template attivi per questo evento, con offset basso (<= 1h
    //    di default). Templates con offset alto (es. 24h prima del pickup)
    //    saranno gestiti dal cron, non qui.
    const { data: templates } = await supabase
        .from('system_messages')
        .select('id, message_key, label, trigger_offset_hours, target_status, target_category')
        .eq('is_automatic', true)
        .eq('is_enabled', true)
        .eq('trigger_event', event)
        .lte('trigger_offset_hours', maxOffsetHours)
    if (!templates?.length) return { sent: 0, skipped: 0, errors: 0 }

    let sent = 0, skipped = 0, errors = 0

    for (const tpl of templates) {
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
