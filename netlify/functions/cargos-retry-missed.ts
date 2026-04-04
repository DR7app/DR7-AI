import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { sendToCargos } from './cargos-auto-send'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const retryHandler: Handler = async () => {
    try {
        console.log('[cargos-retry-missed] Checking for unsent CARGOS bookings...')

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
            if ((booking.vehicle_name || '').toLowerCase() === 'test' || (booking.vehicle_name || '').toLowerCase().includes('hummer')) {
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
            const result = await sendToCargos(booking.id)

            if (result.success) {
                sent++
                console.log(`[cargos-retry-missed] ✅ ${booking.customer_name} sent successfully`)
            } else {
                failed++
                console.warn(`[cargos-retry-missed] ❌ ${booking.customer_name} failed: ${result.error}`)
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
export const handler = schedule('*/30 * * * *', retryHandler)
