import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { sendToCargos, avvisaDirezione } from './cargos-auto-send'
import { conSystemControl, funzioneFerma } from './utils/systemControl'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const retryHandler: Handler = async () => {
    // Interruttore System Control: CARGOS spento = il giro salta, niente
    // riepilogo di "falliti" che fallimenti non sono.
    const ferma = await funzioneFerma('cargos', 'terra')
    if (ferma) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: ferma }) }
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

        // 01/10/2026: contratti e firme letti UNA volta per giro, a blocchi,
        // invece di una query `.single()` per prenotazione. Ogni giro (ogni 30
        // minuti) interrogava di nuovo le stesse prenotazioni: quelle senza
        // contratto rispondevano 406 (~4.150 a settimana). La regola resta
        // IDENTICA a prima: si invia solo se la prenotazione ha esattamente UN
        // contratto e quel contratto ha esattamente UNA richiesta di firma
        // 'signed' (con 0 o piu' righe `.single()`/`.maybeSingle()` davano
        // errore e la prenotazione veniva saltata: idem qui).
        const bookingIds = missedBookings.map(b => b.id)
        const BLOCCO = 100
        const contrattiPerPrenotazione = new Map<string, string[]>()
        for (let i = 0; i < bookingIds.length; i += BLOCCO) {
            const { data: righe, error: errContratti } = await supabase
                .from('contracts')
                .select('id, booking_id')
                .in('booking_id', bookingIds.slice(i, i + BLOCCO))
            if (errContratti) {
                console.error('[cargos-retry-missed] Contracts query error:', errContratti)
                return { statusCode: 500, body: JSON.stringify({ error: errContratti.message }) }
            }
            for (const c of righe || []) {
                const lista = contrattiPerPrenotazione.get(c.booking_id) || []
                lista.push(c.id)
                contrattiPerPrenotazione.set(c.booking_id, lista)
            }
        }
        const contractIds = Array.from(contrattiPerPrenotazione.values()).flat()
        const firmePerContratto = new Map<string, number>()
        for (let i = 0; i < contractIds.length; i += BLOCCO) {
            const { data: firme, error: errFirme } = await supabase
                .from('signature_requests')
                .select('contract_id')
                .eq('status', 'signed')
                .in('contract_id', contractIds.slice(i, i + BLOCCO))
            if (errFirme) {
                console.error('[cargos-retry-missed] Signature query error:', errFirme)
                return { statusCode: 500, body: JSON.stringify({ error: errFirme.message }) }
            }
            for (const f of firme || []) {
                firmePerContratto.set(f.contract_id, (firmePerContratto.get(f.contract_id) || 0) + 1)
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

            // Check if contract is signed (01/10/2026: dalle mappe caricate sopra,
            // stessa regola "esattamente uno" delle vecchie .single()/.maybeSingle())
            const contrattiBooking = contrattiPerPrenotazione.get(booking.id) || []
            if (contrattiBooking.length !== 1) {
                skipped++
                continue
            }

            if (firmePerContratto.get(contrattiBooking[0]) !== 1) {
                skipped++
                continue
            }

            // Send to CARGOS
            console.log(`[cargos-retry-missed] Sending ${booking.id} (${booking.customer_name}) to CARGOS...`)
            // silent: il cron NON avvisa a ogni errore — girando ogni 30 minuti
            // manderebbe decine di messaggi per lo stesso problema. Gli errori si
            // raccolgono e diventano UN riepilogo, secondo la frequenza scelta.
            const result = await sendToCargos(booking.id, { silent: true })

            if (result.skipped) {
                // spento a meta' giro dal System Control
                skipped++
            } else if (result.success) {
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
