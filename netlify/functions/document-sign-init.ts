import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { renderTemplate } from './utils/messageTemplates'
import { getEmailFromSmtp } from './utils/emailFrom'
import { funzioneFerma } from './utils/systemControl'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

// Stesso SMTP di send-contract-email (info@dr7.app).
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.secureserver.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
})

const SIGNING_BASE_URL = process.env.SIGNING_BASE_URL || 'https://dr7trust.com'
const TOKEN_EXPIRY_HOURS = 12

function cleanPhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '')
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2)
    if (cleaned.length === 10 && cleaned.startsWith('3')) cleaned = '39' + cleaned
    return cleaned
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const body = JSON.parse(event.body || '{}')
        const { documentUrl, documentName, signerName } = body
        // 25/09/2026: DR7 Trust basta UN contatto, telefono (WhatsApp) oppure
        // email. Prima l'email era obbligatoria anche se il link partiva solo
        // su WhatsApp. signer_email e' NOT NULL: senza email si salva ''.
        const signerEmail = String(body.signerEmail || '').trim()
        const signerPhone = String(body.signerPhone || '').trim()

        if (!documentUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: 'URL del documento richiesto' }) }
        }
        if (!signerName) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Nome del firmatario richiesto' }) }
        }
        if (!signerEmail && !signerPhone) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Serve almeno un contatto: telefono (WhatsApp) o email' }) }
        }

        // Interruttore System Control: firma spenta = nessuna richiesta creata.
        const ferma = await funzioneFerma('firma_elettronica')
        if (ferma) {
            return { statusCode: 503, body: JSON.stringify({ error: ferma }) }
        }

        // Generate unique token
        const token = crypto.randomBytes(32).toString('hex')
        const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)

        // Hash the original PDF
        const pdfResponse = await fetch(documentUrl)
        if (!pdfResponse.ok) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Impossibile scaricare il documento PDF' }) }
        }
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
        const originalPdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

        const docName = documentName || 'Documento'

        // Create signature request (no contract_id)
        const { data: sigRequest, error: insertError } = await supabase
            .from('signature_requests')
            .insert({
                contract_id: null,
                booking_id: null,
                token,
                signer_name: signerName,
                signer_email: signerEmail,
                signer_phone: signerPhone || null,
                status: 'pending',
                token_expires_at: tokenExpiresAt.toISOString(),
                original_pdf_hash: originalPdfHash,
                document_url: documentUrl,
                document_name: docName
            })
            .select()
            .single()

        if (insertError) {
            console.error('[document-sign-init] Insert error:', insertError)
            throw insertError
        }

        // Log audit event
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'request_created',
            event_description: `Richiesta di firma documento "${docName}" creata per ${signerName} (${signerEmail || signerPhone})`,
            ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
            user_agent: event.headers['user-agent'] || 'unknown',
            metadata: {
                document_name: docName,
                document_url: documentUrl,
                token_expires_at: tokenExpiresAt.toISOString(),
                original_pdf_hash: originalPdfHash
            }
        })

        // Build signing URL
        const signingUrl = `${SIGNING_BASE_URL}/firma/${token}`

        // Link di firma: WhatsApp se c'e' il telefono; email se non c'e' il
        // telefono o se WhatsApp non e' partito. Il testo e' lo stesso
        // template Pro (document_signature_link) per entrambi i canali.
        let sentVia = ''

        if (signerPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
            try {
                // Body comes EXCLUSIVELY from Messaggi di Sistema Pro.
                // No hardcoded fallback — if no Pro template, we skip the send.
                const resolvedMessage = await renderTemplate('document_signature_link', { signerName, docName, contractNumber: docName, signingUrl })
                if (!resolvedMessage) {
                    console.warn('[document-sign-init] No Pro template for document_signature_link — skipping send')
                } else {
                    const cleanedPhone = cleanPhone(signerPhone)
                    const chatId = `${cleanedPhone}@c.us`
                    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

                    const waResponse = await fetch(greenApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chatId, message: resolvedMessage })
                    })

                    const waResult = await waResponse.json()
                    if (waResponse.ok && waResult.idMessage) {
                        sentVia = 'whatsapp'
                        console.log(`[document-sign-init] Signing link sent via WhatsApp to ${cleanedPhone}`)

                        try {
                            await supabase.from('sent_messages_log').insert({
                                customer_name: signerName,
                                customer_phone: signerPhone,
                                message_text: resolvedMessage,
                                template_label: 'Document Signing Link',
                                status: 'sent',
                            })
                        } catch (logErr) {
                            console.error('Failed to log message:', logErr)
                        }
                    } else {
                        console.warn('[document-sign-init] WhatsApp failed:', waResult)
                    }
                }
            } catch (waErr: any) {
                console.warn('[document-sign-init] WhatsApp error:', waErr.message)
            }
        }

        if (!sentVia && signerEmail) {
            try {
                const resolvedMessage = await renderTemplate('document_signature_link', { signerName, docName, contractNumber: docName, signingUrl })
                if (!resolvedMessage) {
                    console.warn('[document-sign-init] No Pro template for document_signature_link — skipping email')
                } else {
                    await transporter.sendMail({
                        from: await getEmailFromSmtp('"DR7" <info@dr7.app>'),
                        to: signerEmail,
                        subject: `Documento da firmare: ${docName}`,
                        text: resolvedMessage,
                    })
                    sentVia = 'email'
                    console.log(`[document-sign-init] Signing link sent via email to ${signerEmail}`)
                }
            } catch (mailErr: any) {
                console.warn('[document-sign-init] Email error:', mailErr.message)
            }
        }

        if (!sentVia) {
            const motivo = signerPhone && signerEmail
                ? 'Impossibile inviare il link ne\' via WhatsApp ne\' via email. Verifica telefono ed email.'
                : signerPhone
                    ? 'Impossibile inviare il link via WhatsApp. Verifica il numero di telefono.'
                    : 'Impossibile inviare il link via email. Verifica l\'indirizzo email.'
            return { statusCode: 500, body: JSON.stringify({ error: motivo }) }
        }

        const canale = sentVia === 'whatsapp' ? 'WhatsApp' : 'email'

        // Log sent
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'link_sent',
            event_description: `Link di firma documento inviato via ${canale}`,
            metadata: { signing_url: signingUrl, channel: sentVia, document_name: docName }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `Link di firma per "${docName}" inviato via ${canale}`,
                requestId: sigRequest.id,
                sentVia,
            })
        }
    } catch (error: any) {
        console.error('Error in document-sign-init:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nella creazione della richiesta di firma', details: error.message })
        }
    }
}
