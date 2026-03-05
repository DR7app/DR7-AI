import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import nodemailer from 'nodemailer'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const SIGNING_BASE_URL = process.env.SIGNING_BASE_URL || 'https://admin.dr7empire.com'
const TOKEN_EXPIRY_HOURS = 48

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { contractId, bookingId } = JSON.parse(event.body || '{}')

        if (!contractId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Contract ID is required' }) }
        }

        // Fetch contract
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('*')
            .eq('id', contractId)
            .single()

        if (contractError || !contract) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Contratto non trovato' }) }
        }

        if (!contract.pdf_url) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Il contratto non ha un PDF generato' }) }
        }

        // Check if there's already an active signature request
        const { data: existingRequest } = await supabase
            .from('signature_requests')
            .select('id, status, token_expires_at')
            .eq('contract_id', contractId)
            .in('status', ['pending', 'otp_sent', 'otp_verified'])
            .single()

        if (existingRequest) {
            const isExpired = new Date(existingRequest.token_expires_at) < new Date()
            if (!isExpired) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: 'Esiste gia una richiesta di firma attiva per questo contratto' })
                }
            }
            // Expire the old request
            await supabase
                .from('signature_requests')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', existingRequest.id)
        }

        // Generate unique token
        const token = crypto.randomBytes(32).toString('hex')
        const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)

        // Hash the original PDF
        const pdfResponse = await fetch(contract.pdf_url)
        if (!pdfResponse.ok) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Impossibile scaricare il PDF del contratto' }) }
        }
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
        const originalPdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

        const signerName = contract.customer_name || 'Cliente'
        const signerEmail = contract.customer_email

        if (!signerEmail) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email cliente mancante nel contratto' }) }
        }

        // Create signature request
        const { data: sigRequest, error: insertError } = await supabase
            .from('signature_requests')
            .insert({
                contract_id: contractId,
                booking_id: bookingId || contract.booking_id,
                token,
                signer_name: signerName,
                signer_email: signerEmail,
                status: 'pending',
                token_expires_at: tokenExpiresAt.toISOString(),
                original_pdf_hash: originalPdfHash
            })
            .select()
            .single()

        if (insertError) {
            throw insertError
        }

        // Log audit event
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'request_created',
            event_description: `Richiesta di firma creata per ${signerName} (${signerEmail})`,
            ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
            user_agent: event.headers['user-agent'] || 'unknown',
            metadata: {
                contract_id: contractId,
                contract_number: contract.contract_number,
                token_expires_at: tokenExpiresAt.toISOString(),
                original_pdf_hash: originalPdfHash
            }
        })

        // Send signing link via email
        const signingUrl = `${SIGNING_BASE_URL}/firma/${token}`

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtps.aruba.it',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: true,
            auth: {
                user: process.env.SMTP_USER || 'info@dr7.app',
                pass: process.env.SMTP_PASS
            }
        })

        await transporter.sendMail({
            from: `"DR7 Empire" <${process.env.SMTP_USER || 'info@dr7.app'}>`,
            to: signerEmail,
            subject: `Firma Contratto - DR7 Empire - ${contract.contract_number || ''}`,
            html: `
                <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" style="height: 80px;" />
                    </div>
                    <h2 style="color: #111; margin-bottom: 10px;">Firma del Contratto</h2>
                    <p>Gentile <strong>${signerName}</strong>,</p>
                    <p>Ti chiediamo di firmare il contratto di noleggio <strong>${contract.contract_number || ''}</strong>.</p>
                    <p>Clicca sul pulsante qui sotto per visualizzare e firmare il documento:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${signingUrl}" style="background: #d4af37; color: #000; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block;">
                            Firma il Contratto
                        </a>
                    </div>
                    <p style="color: #666; font-size: 13px;">Questo link scade tra ${TOKEN_EXPIRY_HOURS} ore.</p>
                    <p style="color: #666; font-size: 13px;">Se non hai richiesto la firma di questo documento, ignora questa email.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                    <p style="color: #999; font-size: 11px; text-align: center;">
                        Dubai rent 7.0 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA)<br>
                        P.IVA 04104640927 | www.dr7empire.com
                    </p>
                </div>
            `
        })

        // Log email sent
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'email_sent',
            event_description: `Email con link di firma inviata a ${signerEmail}`,
            metadata: { signing_url: signingUrl }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Richiesta di firma creata e email inviata',
                requestId: sigRequest.id,
                signingUrl
            })
        }
    } catch (error: any) {
        console.error('Error in signature-init:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nella creazione della richiesta di firma', details: error.message })
        }
    }
}
