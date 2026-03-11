import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

const SIGNING_BASE_URL = process.env.SIGNING_BASE_URL || 'https://trustera360.app'
const TOKEN_EXPIRY_HOURS = 12

function cleanPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\+\(\)]/g, '')
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2)
    if (cleaned.length === 10 && cleaned.startsWith('3')) cleaned = '39' + cleaned
    return cleaned
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { documentUrl, documentName, signerName, signerEmail, signerPhone } = JSON.parse(event.body || '{}')

        if (!documentUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: 'URL del documento richiesto' }) }
        }
        if (!signerName || !signerEmail) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Nome e email del firmatario richiesti' }) }
        }
        if (!signerPhone) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Telefono del firmatario richiesto per invio WhatsApp' }) }
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
            event_description: `Richiesta di firma documento "${docName}" creata per ${signerName} (${signerEmail})`,
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

        // Send signing link via WhatsApp
        let sentVia = ''

        if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
            try {
                const cleanedPhone = cleanPhone(signerPhone)
                const chatId = `${cleanedPhone}@c.us`
                const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

                const waResponse = await fetch(greenApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId,
                        message: `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\nGentile *${signerName}*,\n\ndi seguito trova il documento "${docName}" da visionare e firmare digitalmente.\n\n${signingUrl}\n\nLa firma richiede meno di 1 minuto.\nIl link è valido per ${TOKEN_EXPIRY_HOURS} ore.\n\nCordiali Saluti,\nDR7\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
                    })
                })

                const waResult = await waResponse.json()
                if (waResponse.ok && waResult.idMessage) {
                    sentVia = 'whatsapp'
                    console.log(`[document-sign-init] Signing link sent via WhatsApp to ${cleanedPhone}`)
                } else {
                    console.warn('[document-sign-init] WhatsApp failed:', waResult)
                }
            } catch (waErr: any) {
                console.warn('[document-sign-init] WhatsApp error:', waErr.message)
            }
        }

        if (!sentVia) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Impossibile inviare il link via WhatsApp. Verifica il numero di telefono.' })
            }
        }

        // Log sent
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'link_sent',
            event_description: `Link di firma documento inviato via WhatsApp`,
            metadata: { signing_url: signingUrl, channel: 'whatsapp', document_name: docName }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `Link di firma per "${docName}" inviato via WhatsApp`,
                requestId: sigRequest.id
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
