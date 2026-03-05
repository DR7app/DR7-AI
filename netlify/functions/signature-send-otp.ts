import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

        const apiKey = process.env.RESEND_API_KEY
        if (!apiKey) {
            return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY non configurata' }) }
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

        // Send OTP via Resend
        const resend = new Resend(apiKey)

        const { error: emailError } = await resend.emails.send({
            from: 'DR7 Empire <info@dr7.app>',
            to: sigRequest.signer_email,
            subject: 'Codice di Verifica - Firma Contratto DR7',
            html: `
                <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" style="height: 60px;" />
                    </div>
                    <h2 style="color: #111; text-align: center;">Codice di Verifica</h2>
                    <p style="text-align: center;">Usa questo codice per confermare la tua firma:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <div style="display: inline-block; background: #f5f5f5; padding: 20px 40px; border-radius: 12px; letter-spacing: 8px; font-size: 32px; font-weight: 700; color: #111; border: 2px solid #d4af37;">
                            ${otp}
                        </div>
                    </div>
                    <p style="text-align: center; color: #666; font-size: 13px;">Il codice scade tra ${OTP_EXPIRY_MINUTES} minuti.</p>
                    <p style="text-align: center; color: #666; font-size: 13px;">Se non hai richiesto questo codice, ignora questa email.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                    <p style="color: #999; font-size: 11px; text-align: center;">
                        Dubai rent 7.0 S.p.A. - www.dr7empire.com
                    </p>
                </div>
            `
        })

        if (emailError) {
            console.error('Resend OTP error:', emailError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Errore nell\'invio del codice OTP', details: emailError.message }) }
        }

        // Log audit
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'otp_sent',
            event_description: `Codice OTP inviato a ${sigRequest.signer_email}`,
            ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
            user_agent: event.headers['user-agent'] || 'unknown',
            metadata: { otp_expires_at: otpExpiresAt.toISOString() }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Codice OTP inviato via email',
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
