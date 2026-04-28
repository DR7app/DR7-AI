import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { renderTemplate } from './utils/messageTemplates'

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

        const sigMessage = await renderTemplate('signature_request_link', { signerName, contractNumber, signingUrl })
        if (sigMessage === null) {
            console.log('[signature-init] Template "signature_request_link" missing/disabled — skipping send')
            return false
        }

        const waResponse = await fetch(greenApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId,
                message: sigMessage
            })
        })

        const waResult = await waResponse.json()
        if (waResponse.ok && waResult.idMessage) {
            console.log(`[signature-init] Signing link sent via WhatsApp to ${cleanedPhone} for ${signerName}`)

            // Log to sent_messages_log
            try {
                const sb = createClient(supabaseUrl, supabaseServiceKey)
                await sb.from('sent_messages_log').insert({
                    customer_name: signerName,
                    customer_phone: phone,
                    message_text: sigMessage,
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

        console.log(`[signature-init] Lookup — contractId="${contractId ?? 'none'}" bookingId="${bookingId ?? 'none'}"`)

        // Fetch contract
        let contract: any = null

        if (contractId) {
            const { data, error } = await supabase
                .from('contracts')
                .select('*')
                .eq('id', contractId)
                .maybeSingle()
            if (error) {
                console.warn(`[signature-init] contractId lookup error (id=${contractId}):`, error.message)
            } else if (data) {
                console.log(`[signature-init] Contract found by id: ${contractId}`)
                contract = data
            } else {
                console.warn(`[signature-init] No contract found by id=${contractId} — will fall back to bookingId lookup`)
            }
        }

        // Fall back to booking_id lookup when: no contractId provided, or contractId lookup returned nothing (e.g. RLS edge case)
        if (!contract && bookingId) {
            const { data, error, count } = await supabase
                .from('contracts')
                .select('*', { count: 'exact' })
                .eq('booking_id', bookingId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            if (error) {
                console.warn(`[signature-init] bookingId lookup error (booking_id=${bookingId}):`, error.message)
            } else if (data) {
                console.log(`[signature-init] Contract found by booking_id=${bookingId} (total rows for this booking: ${count ?? 'unknown'}, using most recent)`)
                contract = data
            } else {
                console.warn(`[signature-init] No contract found by booking_id=${bookingId}`)
            }
        }

        if (!contract) {
            const detail = contractId && bookingId
                ? `nessun contratto per id=${contractId} o booking_id=${bookingId}`
                : contractId
                    ? `nessun contratto per id=${contractId}`
                    : `nessun contratto per booking_id=${bookingId}`
            console.error(`[signature-init] Contract not found — ${detail}`)
            return { statusCode: 404, body: JSON.stringify({ error: `Contratto non trovato (${detail})` }) }
        }

        console.log(`[signature-init] Using contract id=${contract.id} number="${contract.contract_number}" booking_id="${contract.booking_id}"`)

        // Refuse to send a signing link for a cancelled booking. Otherwise the
        // customer keeps receiving "Firma il contratto" WhatsApp messages for a
        // rental that no longer exists. This is the single bottleneck — every
        // signing send (manual resend, auto-trigger from payment callback,
        // post-booking webhook) flows through here.
        const guardBookingId = bookingId || contract.booking_id
        if (guardBookingId) {
            const { data: bookingRow } = await supabase
                .from('bookings')
                .select('status')
                .eq('id', guardBookingId)
                .maybeSingle()
            const status = String(bookingRow?.status || '').toLowerCase()
            if (status === 'cancelled' || status === 'annullata') {
                console.log(`[signature-init] Booking ${guardBookingId} is ${status} — refusing to send signing link`)
                // Also cancel any pending signature_requests for this booking so the
                // 30-min reminder cron doesn't pick them up later.
                await supabase
                    .from('signature_requests')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq('booking_id', guardBookingId)
                    .in('status', ['pending', 'otp_sent', 'otp_verified'])
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: 'Prenotazione annullata — il link di firma non viene inviato.' })
                }
            }
        }

        if (!contract.pdf_url) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Il contratto non ha un PDF generato' }) }
        }

        // Cancel any existing active signature requests for this contract OR booking.
        // Matching by booking_id as well guarantees stale links get killed even when
        // legacy duplicate contract rows point multiple sig requests at the same
        // booking (which used to happen when the old upsert silently inserted dupes).
        const activeStatuses = ['pending', 'otp_sent', 'otp_verified']
        const effBookingIdForCancel = bookingId || contract.booking_id
        const { data: byContract } = await supabase
            .from('signature_requests')
            .select('id, status')
            .eq('contract_id', contract.id)
            .in('status', activeStatuses)
        const { data: byBooking } = effBookingIdForCancel
            ? await supabase
                .from('signature_requests')
                .select('id, status')
                .eq('booking_id', effBookingIdForCancel)
                .in('status', activeStatuses)
            : { data: null }
        const seen = new Set<string>()
        const existingRequests = [...(byContract || []), ...(byBooking || [])].filter(r => {
            if (seen.has(r.id)) return false
            seen.add(r.id)
            return true
        })

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

        if (!customerPhone && contract.customer_email) {
            const { data: customer } = await supabase
                .from('customers_extended')
                .select('telefono')
                .eq('email', contract.customer_email)
                .maybeSingle()
            if (customer?.telefono) customerPhone = customer.telefono
        }

        // Contracts are delivered exclusively via WhatsApp — phone is the
        // channel that matters. If we have no phone AND no email there is
        // literally nowhere to send the link, so we reject. But missing
        // ONLY the email is fine: synthesize a placeholder so the
        // signer_email NOT-NULL constraint is satisfied.
        if (!contract.customer_email && !customerPhone) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Cliente senza email né telefono — impossibile inviare il contratto' }) }
        }
        const signerEmail = contract.customer_email
            || `noemail.${(customerPhone || effectiveBookingId || 'unknown').replace(/[^0-9a-zA-Z]/g, '')}@dr7-empire.local`

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
