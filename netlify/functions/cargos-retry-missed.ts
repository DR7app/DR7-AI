import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { sendToCargos, avvisaDirezione } from './cargos-auto-send'
import { conSystemControl } from './utils/systemControl'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const retryHandler: Handler = async () => {
    try {
        console.log('[cargos-retry-missed] Checking for unsent CARGOS bookings...')
        const falliti: string[] = []

        // Find signed contracts where CARGOS was never sent
        const { data: missedBookings, error } = await supabase
            .from('bookings')
            .select(`
                id, customer_name, vehicle_name, vehicle_plate, pickup_date, status, service_type,
                booking_details
            `)
            .or('service_type.is.null,service_type.eq.car_rental')
            .neq('status', 'cancelled')
            .or('booking_details->cargos_sent.is.null,booking_details->>cargos_sent.eq.false')

        if (error) {
            console.error('[cargos-retry-missed] Query error:', error)
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
        }

        if (!missedBookings || missedBookings.length === 0) {
            console.log('[cargos-retry-missed] No missed bookings found')
            return { statusCode: 200, body: JSON.stringify({ sent: 0 }) }
        }

        // Filter: only bookings with signed contracts
        const bookingIds = missedBookings.map(b => b.id)
        const { data: signedContracts } = await supabase
            .from('contracts')
            .select('booking_id')
            .in('booking_id', bookingIds)

        const { data: signedRequests } = await supabase
            .from('signature_requests')
            .select('contract_id')
            .eq('status', 'signed')

        const signedContractBookingIds = new Set<string>()
        if (signedContracts && signedRequests) {
            const signedContractIds = new Set(signedRequests.map(sr => sr.contract_id))
            for (const c of signedContracts) {
                // Check if this contract has a signed signature request
                // We need to cross-reference
            }
        }

        // Simpler approach: check each booking individually
        let sent = 0
        let skipped = 0
        let failed = 0

        for (const booking of missedBookings) {
            // Skip test vehicles and Hummer experiences
            const vn = (booking.vehicle_name || '').toLowerCase()
            if (vn === 'test' || /test00\d/.test(vn) || vn.includes('hummer')) {
                skipped++
                continue
            }

            // Skip if already sent
            if (booking.booking_details?.cargos_sent) {
                skipped++
                continue
            }

            // Check if contract is signed
            const { data: contract } = await supabase
                .from('contracts')
                .select('id')
                .eq('booking_id', booking.id)
                .single()

            if (!contract) {
                skipped++
                continue
            }

            const { data: sigReq } = await supabase
                .from('signature_requests')
                .select('status')
                .eq('contract_id', contract.id)
                .eq('status', 'signed')
                .maybeSingle()

            if (!sigReq) {
                skipped++
                continue
            }

            // Send to CARGOS
            console.log(`[cargos-retry-missed] Sending ${booking.id} (${booking.customer_name}) to CARGOS...`)
            // silent: il cron NON avvisa a ogni errore — girando ogni 30 minuti
            // manderebbe decine di messaggi per lo stesso problema. Gli errori si
            // raccolgono e diventano UN riepilogo, secondo la frequenza scelta.
            const result = await sendToCargos(booking.id, { silent: true })

            if (result.success) {
                sent++
                console.log(`[cargos-retry-missed] ✅ ${booking.customer_name} sent successfully`)
            } else {
                failed++
                falliti.push(`• ${booking.customer_name || 'ND'} (${booking.vehicle_plate || booking.vehicle_name || 'ND'}): ${result.error || 'errore'}`)
                console.warn(`[cargos-retry-missed] ❌ ${booking.customer_name} failed: ${result.error}`)
            }
        }

        // ── Riepilogo giornaliero ────────────────────────────────────────────
        // Un solo messaggio al giorno, non uno ogni mezz'ora. La data dell'ultimo
        // invio sta in config: finche' e' quella di oggi, non si manda altro.
        if (falliti.length > 0) {
            try {
                const { data: cfgRow } = await supabase
                    .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
                const cfg = (cfgRow?.config || {}) as Record<string, unknown>
                const cargosCfg = { ...((cfg.cargos as Record<string, unknown>) || {}) }
                const frequenza = String(cargosCfg.alert_frequency || 'immediato')
                const oggi = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
                if (frequenza === 'giornaliero' && cargosCfg.last_alert_date !== oggi) {
                    await avvisaDirezione(
                        `riepilogo giornaliero — ${falliti.length} da sistemare`,
                        falliti.slice(0, 15).join('\n') + (falliti.length > 15 ? `\n… e altre ${falliti.length - 15}` : ''),
                    )
                    cargosCfg.last_alert_date = oggi
                    await supabase.from('centralina_pro_config')
                        .upsert({ id: 'main', config: { ...cfg, cargos: cargosCfg } }, { onConflict: 'id' })
                }
            } catch (e) {
                console.error('[cargos-retry-missed] riepilogo non inviato:', e)
            }
        }

        console.log(`[cargos-retry-missed] Done: ${sent} sent, ${skipped} skipped, ${failed} failed`)
        return { statusCode: 200, body: JSON.stringify({ sent, skipped, failed }) }

    } catch (err: any) {
        console.error('[cargos-retry-missed] Error:', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}

// Run every 30 minutes
export const handler = schedule('*/30 * * * *', conSystemControl('cargos-retry-missed', retryHandler, { cron: true }))
