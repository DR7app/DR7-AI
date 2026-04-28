import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { renderTemplate } from './utils/messageTemplates'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

const OTP_EXPIRY_MINUTES = 10
const MAX_OTP_ATTEMPTS = 5

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { token } = JSON.parse(event.body || '{}')

        if (!token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token richiesto' }) }
        }

        // Fetch signature request
        const { data: sigRequest, error } = await supabase
            .from('signature_requests')
            .select('*')
            .eq('token', token)
            .single()

        if (error || !sigRequest) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Richiesta di firma non trovata' }) }
        }

        // Check token expiry
        if (new Date(sigRequest.token_expires_at) < new Date()) {
            await supabase
                .from('signature_requests')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', sigRequest.id)
            return { statusCode: 410, body: JSON.stringify({ error: 'Il link di firma e scaduto' }) }
        }

        if (sigRequest.status === 'signed') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Il documento e gia stato firmato' }) }
        }

        if (sigRequest.status === 'cancelled') {
            return { statusCode: 400, body: JSON.stringify({ error: 'La richiesta di firma e stata annullata' }) }
        }

        if (sigRequest.status === 'otp_verified') {
            return { statusCode: 400, body: JSON.stringify({ error: 'OTP gia verificato. Procedi con la firma.' }) }
        }

        if (sigRequest.otp_attempts >= MAX_OTP_ATTEMPTS) {
            return { statusCode: 429, body: JSON.stringify({ error: 'Troppi tentativi. Richiedi un nuovo link di firma.' }) }
        }

        // Generate 6-digit OTP
        const otp = String(Math.floor(100000 + Math.random() * 900000))
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

        // Save OTP
        await supabase
            .from('signature_requests')
            .update({
                otp_code: otp,
                otp_expires_at: otpExpiresAt.toISOString(),
                status: 'otp_sent',
                updated_at: new Date().toISOString()
            })
            .eq('id', sigRequest.id)

        // Try to get customer phone from booking
        let customerPhone = ''
        if (sigRequest.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('customer_phone, booking_details')
                .eq('id', sigRequest.booking_id)
                .single()
            if (booking) {
                customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone || ''
                console.log(`[signature-send-otp] Booking phone: customer_phone="${booking.customer_phone}", details.phone="${booking.booking_details?.customer?.phone}"`)
            } else {
                console.log(`[signature-send-otp] No booking found for booking_id=${sigRequest.booking_id}`)
            }
        } else {
            console.log(`[signature-send-otp] No booking_id on signature request`)
        }

        // If no phone from booking, try contract
        if (!customerPhone && sigRequest.contract_id) {
            const { data: contract } = await supabase
                .from('contracts')
                .select('customer_phone')
                .eq('id', sigRequest.contract_id)
                .single()
            if (contract) {
                customerPhone = contract.customer_phone || ''
                console.log(`[signature-send-otp] Contract phone: "${contract.customer_phone}"`)
            } else {
                console.log(`[signature-send-otp] No contract found for contract_id=${sigRequest.contract_id}`)
            }
        }

        // If still no phone, try customers_extended by email (for standalone documents)
        if (!customerPhone && sigRequest.signer_email) {
            const { data: customer } = await supabase
                .from('customers_extended')
                .select('telefono')
                .eq('email', sigRequest.signer_email)
                .maybeSingle()
            if (customer?.telefono) {
                customerPhone = customer.telefono
                console.log(`[signature-send-otp] Customer phone from email lookup: "${customerPhone}"`)
            }
        }

        console.log(`[signature-send-otp] Final customerPhone="${customerPhone}", GREEN_API_INSTANCE_ID=${GREEN_API_INSTANCE_ID ? 'set' : 'NOT SET'}, GREEN_API_TOKEN=${GREEN_API_TOKEN ? 'set' : 'NOT SET'}`)

        // WhatsApp ONLY — no email fallback. If WhatsApp can't deliver, the
        // request fails outright and the admin can fix the phone number.
        // Customers must never receive contract OTPs by email.
        if (!customerPhone) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Numero di telefono cliente mancante. Impossibile inviare il codice OTP via WhatsApp.' }) }
        }
        if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Green API non configurata. Impossibile inviare il codice OTP.' }) }
        }

        const channel: 'whatsapp' = 'whatsapp'
        let cleanPhone = customerPhone.replace(/[\s\-\+\(\)]/g, '')
        if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
        if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

        // Body comes ONLY from Messaggi di Sistema Pro (pro_richiesta_otp).
        // No hardcoded fallback — admin edits to the template MUST always
        // reach the customer. Available variables: {otp},
        // {expiryMinutes}.
        const otpMessage = await renderTemplate('signature_otp_whatsapp', {
            otp,
            expiryMinutes: String(OTP_EXPIRY_MINUTES),
        })
        if (!otpMessage) {
            console.error('[signature-send-otp] Template "signature_otp_whatsapp" (pro_richiesta_otp) missing or disabled')
            return { statusCode: 500, body: JSON.stringify({ error: 'Template OTP non configurato in Messaggi di Sistema Pro (pro_richiesta_otp).' }) }
        }

        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`
        const waResponse = await fetch(greenApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: `${cleanPhone}@c.us`,
                message: otpMessage,
            })
        })

        const waResult = await waResponse.json()
        if (!waResponse.ok || !waResult.idMessage) {
            console.error('[signature-send-otp] WhatsApp send failed:', waResult)
            return { statusCode: 502, body: JSON.stringify({ error: 'Invio OTP via WhatsApp fallito. Verifica il numero di telefono e riprova.', details: waResult }) }
        }
        console.log(`[signature-send-otp] OTP sent via WhatsApp to ${cleanPhone}:`, waResult.idMessage)

        // Log to sent_messages_log
        try {
            await supabase.from('sent_messages_log').insert({
                customer_name: sigRequest.signer_name || 'N/A',
                customer_phone: cleanPhone,
                message_text: otpMessage,
                template_label: 'Signature OTP',
                status: 'sent',
            })
        } catch (logErr) {
            console.error('Failed to log message:', logErr)
        }

        // Log audit
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'otp_sent',
            event_description: `Codice OTP inviato via WhatsApp`,
            ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
            user_agent: event.headers['user-agent'] || 'unknown',
            metadata: { otp_expires_at: otpExpiresAt.toISOString(), channel }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                channel,
                message: 'Codice OTP inviato via WhatsApp',
                expiresInMinutes: OTP_EXPIRY_MINUTES
            })
        }
    } catch (error: any) {
        console.error('Error in signature-send-otp:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nell\'invio del codice OTP', details: error.message })
        }
    }
}
