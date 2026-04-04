import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
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

interface SignerInfo {
    name: string
    email: string
    phone: string
    role: string // '1_guidatore', '2_guidatore', 'garante'
}

async function sendWhatsAppSigningLink(
    phone: string,
    signerName: string,
    contractNumber: string,
    signingUrl: string
): Promise<boolean> {
    if (!phone || !GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) return false

    try {
        const cleanedPhone = cleanPhone(phone)
        const chatId = `${cleanedPhone}@c.us`
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

        const waResponse = await fetch(greenApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId,
                message: `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\nGentile *${signerName}*,\n\ndi seguito trova il contratto di noleggio n. *${contractNumber}* da visionare e firmare digitalmente.\n\n${signingUrl}\n\nLa firma richiede meno di 1 minuto.\nIl link è valido per ${TOKEN_EXPIRY_HOURS} ore: trascorso questo termine, la prenotazione potrà decadere automaticamente come da policy.\n\nLa invitiamo quindi a completare la firma ora per confermare il noleggio.\n\nCordiali Saluti,\nDR7\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
            })
        })

        const waResult = await waResponse.json()
        if (waResponse.ok && waResult.idMessage) {
            console.log(`[signature-init] Signing link sent via WhatsApp to ${cleanedPhone} for ${signerName}`)

            // Log to sent_messages_log
            try {
                const sb = createClient(supabaseUrl, supabaseServiceKey)
                const fullMessage = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\nGentile *${signerName}*,\n\ndi seguito trova il contratto di noleggio n. *${contractNumber}* da visionare e firmare digitalmente.\n\n${signingUrl}\n\nLa firma richiede meno di 1 minuto.\nIl link è valido per ${TOKEN_EXPIRY_HOURS} ore: trascorso questo termine, la prenotazione potrà decadere automaticamente come da policy.\n\nLa invitiamo quindi a completare la firma ora per confermare il noleggio.\n\nCordiali Saluti,\nDR7\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
                await sb.from('sent_messages_log').insert({
                    customer_name: signerName,
                    customer_phone: phone,
                    message_text: fullMessage,
                    template_label: 'Signature Request Link',
                    status: 'sent',
                })
            } catch (logErr) {
                console.error('Failed to log message:', logErr)
            }

            return true
        } else {
            console.warn(`[signature-init] WhatsApp failed for ${signerName}:`, waResult)
            return false
        }
    } catch (waErr: any) {
        console.warn(`[signature-init] WhatsApp error for ${signerName}:`, waErr.message)
        return false
    }
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { contractId, bookingId } = JSON.parse(event.body || '{}')

        if (!contractId && !bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Contract ID or Booking ID is required' }) }
        }

        // Fetch contract
        let contract: any = null
        if (contractId) {
            const result = await supabase.from('contracts').select('*').eq('id', contractId).single()
            contract = result.data
        }
        if (!contract && bookingId) {
            const result = await supabase.from('contracts').select('*').eq('booking_id', bookingId).single()
            contract = result.data
        }

        if (!contract) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Contratto non trovato' }) }
        }

        if (!contract.pdf_url) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Il contratto non ha un PDF generato' }) }
        }

        // Cancel any existing active signature requests for this contract
        const { data: existingRequests } = await supabase
            .from('signature_requests')
            .select('id, status')
            .eq('contract_id', contract.id)
            .in('status', ['pending', 'otp_sent', 'otp_verified'])

        if (existingRequests && existingRequests.length > 0) {
            for (const req of existingRequests) {
                await supabase
                    .from('signature_requests')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq('id', req.id)

                await supabase.from('signature_audit_trail').insert({
                    signature_request_id: req.id,
                    event_type: 'request_cancelled',
                    event_description: 'Richiesta precedente annullata per creazione di una nuova',
                    metadata: { replaced_by: 'new_request' }
                })
            }
            console.log(`[signature-init] Cancelled ${existingRequests.length} existing requests`)
        }

        // Hash the original PDF
        const pdfResponse = await fetch(contract.pdf_url)
        if (!pdfResponse.ok) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Impossibile scaricare il PDF del contratto' }) }
        }
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
        const originalPdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

        // Build list of all signers
        const signers: SignerInfo[] = []
        const effectiveBookingId = bookingId || contract.booking_id

        // 1st driver (main customer) — always present
        const signerName = contract.customer_name || 'Cliente'
        const signerEmail = contract.customer_email
        if (!signerEmail) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email cliente mancante nel contratto' }) }
        }

        let customerPhone = contract.customer_phone || ''

        // Fetch booking for additional signers + phone
        let booking: any = null
        if (effectiveBookingId) {
            const { data: bookingData } = await supabase
                .from('bookings')
                .select('customer_phone, booking_details')
                .eq('id', effectiveBookingId)
                .single()
            booking = bookingData
            if (booking && !customerPhone) {
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

        signers.push({ name: signerName, email: signerEmail, phone: customerPhone, role: '1_guidatore' })

        // 2nd driver (if exists)
        if (booking?.booking_details?.second_driver) {
            const sd = booking.booking_details.second_driver
            const sdName = (sd.name && sd.surname)
                ? `${sd.name} ${sd.surname}`
                : sd.fullName || sd.full_name || [sd.nome, sd.cognome].filter(Boolean).join(' ') || ''
            const sdEmail = sd.email || ''
            const sdPhone = sd.phone || sd.telefono || ''

            if (sdName && (sdEmail || sdPhone)) {
                signers.push({ name: sdName, email: sdEmail, phone: sdPhone, role: '2_guidatore' })
                console.log(`[signature-init] 2nd driver found: ${sdName}`)
            }
        }

        // Garante (if exists)
        const garanteData = booking?.booking_details?.garante_veicolo
        console.log(`[signature-init] garante_veicolo data:`, JSON.stringify(garanteData || null))
        console.log(`[signature-init] cauzione_auto:`, booking?.booking_details?.cauzione_auto)

        if (garanteData) {
            if (garanteData.tipo === 'guidatore') {
                // Garante is the main driver — skip (already signing as 1st guidatore)
                console.log('[signature-init] Garante is the main driver — skipping separate request')
            } else {
                const gName = `${garanteData.nome || ''} ${garanteData.cognome || ''}`.trim()
                const gEmail = garanteData.email || ''
                const gPhone = garanteData.telefono || garanteData.phone || ''

                console.log(`[signature-init] Garante parsed: name="${gName}" email="${gEmail}" phone="${gPhone}" tipo="${garanteData.tipo}"`)

                if (gName && (gEmail || gPhone)) {
                    signers.push({ name: gName, email: gEmail, phone: gPhone, role: 'garante' })
                    console.log(`[signature-init] Garante added to signers: ${gName}`)
                } else {
                    console.warn(`[signature-init] Garante skipped — missing name or contact: name="${gName}" email="${gEmail}" phone="${gPhone}"`)
                }
            }
        } else {
            console.log('[signature-init] No garante_veicolo in booking_details')
        }

        console.log(`[signature-init] Creating ${signers.length} signing request(s) for contract ${contract.contract_number}`)

        const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)
        const ipAddress = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown'
        const userAgent = event.headers['user-agent'] || 'unknown'
        const results: { name: string; role: string; sent: boolean }[] = []

        for (const signer of signers) {
            const token = crypto.randomBytes(32).toString('hex')

            // Create signature request
            const { data: sigRequest, error: insertError } = await supabase
                .from('signature_requests')
                .insert({
                    contract_id: contract.id,
                    booking_id: effectiveBookingId,
                    token,
                    signer_name: signer.name,
                    signer_email: signer.email || signerEmail, // Fallback to main customer email
                    signer_phone: signer.phone,
                    status: 'pending',
                    token_expires_at: tokenExpiresAt.toISOString(),
                    original_pdf_hash: originalPdfHash
                })
                .select()
                .single()

            if (insertError) {
                console.error(`[signature-init] Failed to create request for ${signer.name}:`, insertError.message)
                results.push({ name: signer.name, role: signer.role, sent: false })
                continue
            }

            // Log audit
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'request_created',
                event_description: `Richiesta di firma creata per ${signer.name} (${signer.role})`,
                ip_address: ipAddress,
                user_agent: userAgent,
                metadata: {
                    contract_id: contract.id,
                    contract_number: contract.contract_number,
                    signer_role: signer.role,
                    token_expires_at: tokenExpiresAt.toISOString(),
                    original_pdf_hash: originalPdfHash
                }
            })

            // Send WhatsApp signing link
            const signingUrl = `${SIGNING_BASE_URL}/firma/${token}`
            const sent = await sendWhatsAppSigningLink(
                signer.phone,
                signer.name,
                contract.contract_number || '',
                signingUrl
            )

            if (sent) {
                await supabase.from('signature_audit_trail').insert({
                    signature_request_id: sigRequest.id,
                    event_type: 'link_sent',
                    event_description: `Link di firma inviato via WhatsApp a ${signer.name} (${signer.role})`,
                    metadata: { signing_url: signingUrl, channel: 'whatsapp', signer_role: signer.role }
                })
            }

            results.push({ name: signer.name, role: signer.role, sent })
        }

        const allSent = results.every(r => r.sent)
        const sentCount = results.filter(r => r.sent).length
        const failedNames = results.filter(r => !r.sent).map(r => r.name)

        if (sentCount === 0) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Impossibile inviare i link via WhatsApp. Verifica i numeri di telefono.' })
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: allSent
                    ? `Link di firma inviato a ${sentCount} firmatari via WhatsApp`
                    : `Link inviato a ${sentCount}/${results.length} firmatari. Non inviato a: ${failedNames.join(', ')}`,
                signers: results
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
