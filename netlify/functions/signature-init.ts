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
            await supabase
                .from('signature_requests')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('id', existingRequest.id)

            await supabase.from('signature_audit_trail').insert({
                signature_request_id: existingRequest.id,
                event_type: 'request_cancelled',
                event_description: 'Richiesta precedente annullata per creazione di una nuova',
                metadata: { replaced_by: 'new_request' }
            })
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

        // Build signing URL
        const signingUrl = `${SIGNING_BASE_URL}/firma/${token}`

        // Get customer phone: contract -> booking -> customers_extended
        let customerPhone = contract.customer_phone || ''

        if (!customerPhone && (bookingId || contract.booking_id)) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('customer_phone, booking_details')
                .eq('id', bookingId || contract.booking_id)
                .single()
            if (booking) {
                customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone || ''
            }
        }

        if (!customerPhone && signerEmail) {
            const { data: customer } = await supabase
                .from('customers_extended')
                .select('telefono')
                .eq('email', signerEmail)
                .maybeSingle()
            if (customer?.telefono) customerPhone = customer.telefono
        }

        // Send signing link via WhatsApp
        let sentVia = ''

        if (customerPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
            try {
                const cleanedPhone = cleanPhone(customerPhone)
                const chatId = `${cleanedPhone}@c.us`
                const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

                const waResponse = await fetch(greenApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId,
                        message: `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\nQuesto messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora.\n\nGentile *${signerName}*,\n\ndi seguito trova il contratto di noleggio n. *${contract.contract_number || ''}* da visionare e firmare digitalmente.\n\n${signingUrl}\n\nLa firma richiede meno di 1 minuto.\nIl link è valido per ${TOKEN_EXPIRY_HOURS} ore: trascorso questo termine, la prenotazione potrà decadere automaticamente come da policy.\n\nLa invitiamo quindi a completare la firma ora per confermare il noleggio.\n\nCordiali Saluti,\nDR7\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
                    })
                })

                const waResult = await waResponse.json()
                if (waResponse.ok && waResult.idMessage) {
                    sentVia = 'whatsapp'
                    console.log(`[signature-init] Signing link sent via WhatsApp to ${cleanedPhone}`)
                } else {
                    console.warn('[signature-init] WhatsApp failed:', waResult)
                }
            } catch (waErr: any) {
                console.warn('[signature-init] WhatsApp error:', waErr.message)
            }
        }

        if (!sentVia) {
            console.warn(`[signature-init] No WhatsApp sent. Phone="${customerPhone}", GREEN_API=${GREEN_API_INSTANCE_ID ? 'set' : 'NOT SET'}`)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Impossibile inviare il link via WhatsApp. Verifica il numero di telefono del cliente.' })
            }
        }

        // Log sent
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'link_sent',
            event_description: `Link di firma inviato via WhatsApp`,
            metadata: { signing_url: signingUrl, channel: 'whatsapp' }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Link di firma inviato via WhatsApp',
                requestId: sigRequest.id
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
