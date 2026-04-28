import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface SyncCauzioneRequest {
    bookingId: string
    customerId: string
    vehicleId: string
    returnDate: string // dropoff_date
    depositAmount: number
    paymentMethod: 'bonifico' | 'carta' | 'preautorizzazione'
    depositPaid: boolean
    depositStatus?: 'da_incassare' | 'incassata'
    // Optional guest fallbacks: when admin creates a booking without
    // picking a registered customer, customerId is null. We resolve
    // cliente_id from these instead so the cauzione still lands.
    guestEmail?: string
    guestPhone?: string
    guestName?: string
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const request: SyncCauzioneRequest = JSON.parse(event.body || '{}')
        const { bookingId, vehicleId: rawVehicleId, returnDate, depositAmount, paymentMethod, depositPaid, depositStatus } = request
        let { customerId } = request
        let vehicleId = rawVehicleId

        console.log('🔄 Syncing cauzione for booking:', bookingId)

        // Validate required fields (customerId and vehicleId only required for new cauzioni)
        if (!bookingId || !returnDate) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: bookingId and returnDate are required' })
            }
        }

        // Self-heal: if the caller couldn't supply customerId / vehicleId
        // (e.g. booking saved without picking a registered customer), pull
        // them from the booking row itself, then fall back to a customers
        // lookup by email/phone. cliente_id is NOT NULL in cauzioni so we
        // need SOME id to insert; only error out if every avenue fails.
        if (!customerId || !vehicleId) {
            const { data: bookingRow } = await supabase
                .from('bookings')
                .select('user_id, vehicle_id, customer_email, customer_phone, booking_details')
                .eq('id', bookingId)
                .maybeSingle()
            if (bookingRow) {
                if (!customerId) {
                    customerId = bookingRow.user_id
                        || bookingRow.booking_details?.customer?.id
                        || bookingRow.booking_details?.customer_id
                        || ''
                }
                if (!vehicleId) {
                    vehicleId = bookingRow.vehicle_id || ''
                }
                // Final fallback: resolve customer from email/phone in
                // customers_extended. Handles guest bookings where the
                // admin removed the email from the lead but the row still
                // exists under a different identifier.
                if (!customerId) {
                    const email = (bookingRow.customer_email || '').trim().toLowerCase()
                    const phone = (bookingRow.customer_phone || '').trim()
                    if (email) {
                        const { data: byEmail } = await supabase
                            .from('customers_extended')
                            .select('id')
                            .ilike('email', email)
                            .maybeSingle()
                        if (byEmail?.id) customerId = byEmail.id
                    }
                    if (!customerId && phone) {
                        const { data: byPhone } = await supabase
                            .from('customers_extended')
                            .select('id')
                            .eq('telefono', phone)
                            .maybeSingle()
                        if (byPhone?.id) customerId = byPhone.id
                    }
                }
            }
        }

        // If deposit amount is 0 or not provided, delete any existing cauzione
        if (!depositAmount || depositAmount <= 0) {
            console.log('💰 No deposit required, deleting any existing cauzione')

            const { error: deleteError } = await supabase
                .from('cauzioni')
                .delete()
                .eq('riferimento_contratto_id', bookingId)

            if (deleteError) {
                console.error('Error deleting cauzione:', deleteError)
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'No deposit required',
                    action: 'deleted'
                })
            }
        }

        // Check if cauzione already exists for this booking
        let existingCauzione: any = null
        let fetchError: any = null

        // First try matching by booking ID
        const { data: byBooking, error: byBookingErr } = await supabase
            .from('cauzioni')
            .select('*')
            .eq('riferimento_contratto_id', bookingId)
            .maybeSingle()

        if (byBookingErr && byBookingErr.code !== 'PGRST116') {
            console.error('Error fetching cauzione by booking:', byBookingErr)
        }

        existingCauzione = byBooking

        // If not found by booking, try matching by customer ID (cauzioni follow the client)
        if (!existingCauzione && customerId) {
            const { data: byCustomer, error: byCustomerErr } = await supabase
                .from('cauzioni')
                .select('*')
                .eq('cliente_id', customerId)
                .not('stato', 'in', '("Restituita","Sbloccata")')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (byCustomerErr && byCustomerErr.code !== 'PGRST116') {
                console.error('Error fetching cauzione by customer:', byCustomerErr)
            }

            if (byCustomer) {
                existingCauzione = byCustomer
                console.log(`📌 Found cauzione by cliente_id instead of bookingId: ${byCustomer.id}`)
            }
        }

        fetchError = null // handled above

        // Map booking payment_method (free-form admin label) → cauzioni.metodo
        // (DB CHECK constraint: only 'bonifico' | 'carta' | 'preautorizzazione').
        // Anything not recognized falls through to 'preautorizzazione', which
        // is the default for card-based deposits.
        function mapToCauzioneMetodo(raw: string | undefined): 'bonifico' | 'carta' | 'preautorizzazione' {
            const s = (raw || '').toLowerCase().trim()
            if (!s) return 'preautorizzazione'
            if (s === 'preautorizzazione' || s === 'preauth' || s === 'pre-auth') return 'preautorizzazione'
            if (s.includes('bonifico') || s.includes('bank_transfer') || s.includes('bank transfer')) return 'bonifico'
            // Cash, wallet, paypal, nexi pay-by-link, "carta di credito", etc.
            // all map to 'carta' — the row is recoverable; admin can change
            // metodo from CauzioniTab if it matters.
            return 'carta'
        }
        const cauzioneMetodo = mapToCauzioneMetodo(paymentMethod)

        // Calculate scadenza: 14 business days starting the day after return
        function calcScadenza(returnDateStr: string): string {
            const returnD = new Date(returnDateStr)
            let current = new Date(returnD)
            current.setDate(current.getDate() + 1) // start day after return
            let businessDays = 0
            // skip to first weekday if starting on weekend
            while (current.getDay() === 0 || current.getDay() === 6) {
                current.setDate(current.getDate() + 1)
            }
            businessDays = 1
            while (businessDays < 14) {
                current.setDate(current.getDate() + 1)
                if (current.getDay() !== 0 && current.getDay() !== 6) {
                    businessDays++
                }
            }
            return current.toISOString().split('T')[0]
        }

        const scadenzaDate = calcScadenza(returnDate)
        console.log(`📅 Calculated scadenza: ${scadenzaDate} (14 business days after ${returnDate})`)

        const cauzioneData: Record<string, any> = {
            cliente_id: customerId,
            veicolo_id: vehicleId,
            riferimento_contratto_id: bookingId,
            data_restituzione_veicolo: returnDate,
            importo: depositAmount,
            metodo: cauzioneMetodo,
            scadenza_cauzione: scadenzaDate,
            // Set data_incasso when deposit is marked as collected
            data_incasso: depositStatus === 'incassata' ? new Date().toISOString() : null,
        }

        if (existingCauzione) {
            // Update existing cauzione — only update return date and amount, don't reset incasso status
            console.log('📝 Updating existing cauzione:', existingCauzione.id)

            const updateData: Record<string, any> = {
                data_restituzione_veicolo: returnDate,
                scadenza_cauzione: scadenzaDate,
                riferimento_contratto_id: bookingId,
                updated_at: new Date().toISOString(),
            }
            // Only update these if explicitly provided
            if (customerId) updateData.cliente_id = customerId
            if (vehicleId) updateData.veicolo_id = vehicleId
            if (depositAmount > 0) updateData.importo = depositAmount
            if (paymentMethod) updateData.metodo = cauzioneMetodo
            // Only update data_incasso if explicitly setting to incassata, never reset an existing incasso
            if (depositStatus === 'incassata' && !existingCauzione.data_incasso) {
                updateData.data_incasso = new Date().toISOString()
            }

            const { data: updatedCauzione, error: updateError } = await supabase
                .from('cauzioni')
                .update(updateData)
                .eq('id', existingCauzione.id)
                .select()
                .single()

            if (updateError) {
                console.error('Error updating cauzione:', updateError)
                throw new Error(`Failed to update cauzione: ${updateError.message}`)
            }

            console.log('✅ Cauzione updated successfully:', updatedCauzione.id)

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Cauzione updated successfully',
                    action: 'updated',
                    cauzione: updatedCauzione
                })
            }
        } else {
            // Create new cauzione — customerId and vehicleId are required
            if (!customerId || !vehicleId) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        error: !customerId && !vehicleId
                            ? 'Cliente e veicolo non identificati per la cauzione (controlla che la prenotazione abbia customer_id e vehicle_id)'
                            : !customerId
                                ? 'Cliente non identificato per la cauzione (lead senza customer_id; aggiungi email o telefono al cliente)'
                                : 'Veicolo non identificato per la cauzione',
                        debug: { customerId, vehicleId, bookingId }
                    })
                }
            }
            console.log('➕ Creating new cauzione for booking:', bookingId)

            const { data: newCauzione, error: insertError } = await supabase
                .from('cauzioni')
                .insert([cauzioneData])
                .select()
                .single()

            if (insertError) {
                console.error('Error creating cauzione:', insertError)
                throw new Error(`Failed to create cauzione: ${insertError.message}`)
            }

            console.log('✅ Cauzione created successfully:', newCauzione.id)

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Cauzione created successfully',
                    action: 'created',
                    cauzione: newCauzione
                })
            }
        }

    } catch (error: any) {
        console.error('❌ Error in sync-booking-cauzione:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Internal server error',
                details: error.toString()
            })
        }
    }
}
