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
        const { bookingId, customerId, vehicleId, returnDate, depositAmount, paymentMethod, depositPaid, depositStatus } = request

        console.log('🔄 Syncing cauzione for booking:', bookingId)

        // Validate required fields
        if (!bookingId || !customerId || !vehicleId || !returnDate) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' })
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
        const { data: existingCauzione, error: fetchError } = await supabase
            .from('cauzioni')
            .select('*')
            .eq('riferimento_contratto_id', bookingId)
            .maybeSingle()

        if (fetchError) {
            console.error('Error fetching existing cauzione:', fetchError)
            throw new Error(`Failed to fetch existing cauzione: ${fetchError.message}`)
        }

        // Determine payment method based on booking payment method
        let cauzioneMetodo: 'bonifico' | 'carta' | 'preautorizzazione' = paymentMethod || 'carta'

        // Map common payment methods
        if (paymentMethod === 'carta' || paymentMethod === 'card') {
            cauzioneMetodo = 'preautorizzazione' // Card payments typically use pre-authorization
        } else if (paymentMethod === 'bonifico' || paymentMethod === 'bank_transfer') {
            cauzioneMetodo = 'bonifico'
        }

        const cauzioneData: Record<string, any> = {
            cliente_id: customerId,
            veicolo_id: vehicleId,
            riferimento_contratto_id: bookingId,
            data_restituzione_veicolo: returnDate,
            importo: depositAmount,
            metodo: cauzioneMetodo,
            // scadenza_cauzione will be auto-calculated by database trigger
            // stato will be auto-calculated by database trigger
            // Set data_incasso when deposit is marked as collected
            data_incasso: depositStatus === 'incassata' ? new Date().toISOString() : null,
        }

        if (existingCauzione) {
            // Update existing cauzione
            console.log('📝 Updating existing cauzione:', existingCauzione.id)

            const { data: updatedCauzione, error: updateError } = await supabase
                .from('cauzioni')
                .update(cauzioneData)
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
            // Create new cauzione
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
