import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { token, otp } = JSON.parse(event.body || '{}')

        if (!token || !otp) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token e codice OTP richiesti' }) }
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

        if (sigRequest.status !== 'otp_sent') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Nessun codice OTP attivo. Richiedi un nuovo codice.' }) }
        }

        // Increment attempt counter
        await supabase
            .from('signature_requests')
            .update({ otp_attempts: (sigRequest.otp_attempts || 0) + 1, updated_at: new Date().toISOString() })
            .eq('id', sigRequest.id)

        // Check max attempts
        if ((sigRequest.otp_attempts || 0) >= 5) {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'otp_max_attempts',
                event_description: 'Raggiunto il numero massimo di tentativi OTP',
                ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
                user_agent: event.headers['user-agent'] || 'unknown'
            })
            return { statusCode: 429, body: JSON.stringify({ error: 'Troppi tentativi. Richiedi un nuovo link di firma.' }) }
        }

        // Check OTP expiry
        if (!sigRequest.otp_expires_at || new Date(sigRequest.otp_expires_at) < new Date()) {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'otp_expired',
                event_description: 'Codice OTP scaduto',
                ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
                user_agent: event.headers['user-agent'] || 'unknown'
            })
            return { statusCode: 410, body: JSON.stringify({ error: 'Il codice OTP e scaduto. Richiedi un nuovo codice.' }) }
        }

        // Verify OTP
        if (sigRequest.otp_code !== otp.trim()) {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'otp_failed',
                event_description: 'Codice OTP non valido',
                ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
                user_agent: event.headers['user-agent'] || 'unknown',
                metadata: { attempts: (sigRequest.otp_attempts || 0) + 1 }
            })
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: 'Codice OTP non valido',
                    remainingAttempts: 5 - ((sigRequest.otp_attempts || 0) + 1)
                })
            }
        }

        // OTP verified successfully
        const ipAddress = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown'
        const userAgent = event.headers['user-agent'] || 'unknown'

        await supabase
            .from('signature_requests')
            .update({
                status: 'otp_verified',
                signer_ip: ipAddress,
                signer_user_agent: userAgent,
                otp_code: null, // Clear OTP for security
                updated_at: new Date().toISOString()
            })
            .eq('id', sigRequest.id)

        // Log audit
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'otp_verified',
            event_description: `Codice OTP verificato con successo da ${sigRequest.signer_email}`,
            ip_address: ipAddress,
            user_agent: userAgent,
            metadata: { verified_at: new Date().toISOString() }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Codice OTP verificato. Puoi procedere con la firma.'
            })
        }
    } catch (error: any) {
        console.error('Error in signature-verify-otp:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nella verifica del codice OTP', details: error.message })
        }
    }
}
