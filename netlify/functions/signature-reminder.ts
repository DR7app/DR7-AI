import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { renderTemplate } from './utils/messageTemplates'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

const SIGNING_BASE_URL = process.env.SIGNING_BASE_URL || 'https://trustera360.app'

function cleanPhone(phone: string): string | null {
    if (!phone) return null
    let clean = phone.replace(/[\s\-\+\(\)]/g, '')
    if (clean.startsWith('00')) clean = clean.substring(2)
    if (clean.length === 10 && clean.startsWith('3')) clean = '39' + clean
    if (clean.length < 10) return null
    return clean
}

const reminderHandler: Handler = async () => {
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[signature-reminder] Missing Supabase config')
        return { statusCode: 500, body: 'Missing config' }
    }

    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        console.error('[signature-reminder] Missing Green API config')
        return { statusCode: 500, body: 'Missing Green API config' }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    try {
        // Find signature requests created 5.5 to 6.5 hours ago that are still pending
        const now = new Date()
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)
        const fiveAndHalfHoursAgo = new Date(now.getTime() - 5.5 * 60 * 60 * 1000)

        const { data: pendingRequests, error } = await supabase
            .from('signature_requests')
            .select('id, token, contract_id, booking_id, signer_name, signer_email, created_at')
            .in('status', ['pending', 'otp_sent'])
            .gte('created_at', sixHoursAgo.toISOString())
            .lte('created_at', fiveAndHalfHoursAgo.toISOString())

        if (error) {
            console.error('[signature-reminder] Query error:', error)
            return { statusCode: 500, body: error.message }
        }

        if (!pendingRequests || pendingRequests.length === 0) {
            console.log('[signature-reminder] No pending signature requests to remind')
            return { statusCode: 200, body: 'No reminders needed' }
        }

        console.log(`[signature-reminder] Found ${pendingRequests.length} pending signature requests`)

        let sent = 0

        for (const req of pendingRequests) {
            // Check if reminder was already sent (via audit trail)
            const { data: existingReminder } = await supabase
                .from('signature_audit_trail')
                .select('id')
                .eq('signature_request_id', req.id)
                .eq('event_type', 'reminder_sent')
                .limit(1)
                .maybeSingle()

            if (existingReminder) {
                console.log(`[signature-reminder] Reminder already sent for request ${req.id}, skipping`)
                continue
            }

            // Get contract number
            let contractNumber = ''
            if (req.contract_id) {
                const { data: contract } = await supabase
                    .from('contracts')
                    .select('contract_number')
                    .eq('id', req.contract_id)
                    .single()
                if (contract) contractNumber = contract.contract_number || ''
            }

            // Get customer phone: booking → contract → customers_extended
            let customerPhone = ''

            if (req.booking_id) {
                const { data: booking } = await supabase
                    .from('bookings')
                    .select('customer_phone, booking_details')
                    .eq('id', req.booking_id)
                    .single()
                if (booking) {
                    customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone || ''
                }
            }

            if (!customerPhone && req.contract_id) {
                const { data: contract } = await supabase
                    .from('contracts')
                    .select('customer_phone')
                    .eq('id', req.contract_id)
                    .single()
                if (contract) customerPhone = contract.customer_phone || ''
            }

            if (!customerPhone && req.signer_email) {
                const { data: customer } = await supabase
                    .from('customers_extended')
                    .select('telefono')
                    .eq('email', req.signer_email)
                    .maybeSingle()
                if (customer?.telefono) customerPhone = customer.telefono
            }

            const cleanedPhone = cleanPhone(customerPhone)
            if (!cleanedPhone) {
                console.warn(`[signature-reminder] No phone for request ${req.id}, skipping`)
                continue
            }

            const signingUrl = `${SIGNING_BASE_URL}/firma/${req.token}`
            const signerName = req.signer_name || 'Cliente'

            const fallbackReminder = `Gentile *${signerName}*,\n\nle ricordiamo che il contratto di noleggio n. *${contractNumber}* è ancora in attesa di firma.\n\n${signingUrl}\n\nIl link resterà valido per le prossime 6 ore.\nLa invitiamo a completare la firma quanto prima per confermare la prenotazione, altrimenti potrà decadere automaticamente allo scadere del termine, come da policy.\n\nSe ha già firmato il contratto o ricevuto questa comunicazione, può ignorare il presente messaggio.\n\nCordiali Saluti,\nDR7`
            const message = await renderTemplate('signature_reminder_whatsapp', { signerName, contractNumber, signingUrl }, fallbackReminder)

            try {
                const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`
                const waResponse = await fetch(greenApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: `${cleanedPhone}@c.us`,
                        message: `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\n${message}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
                    })
                })

                const waResult = await waResponse.json()
                if (waResponse.ok && waResult.idMessage) {
                    console.log(`[signature-reminder] Reminder sent to ${cleanedPhone} for request ${req.id}`)
                    sent++

                    // Log audit
                    await supabase.from('signature_audit_trail').insert({
                        signature_request_id: req.id,
                        event_type: 'reminder_sent',
                        event_description: `Promemoria firma inviato via WhatsApp a ${cleanedPhone}`,
                        metadata: { signing_url: signingUrl, channel: 'whatsapp', contract_number: contractNumber }
                    })

                    // Log to sent_messages_log
                    try {
                        const fullMessage = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\n${message}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`
                        await supabase.from('sent_messages_log').insert({
                            customer_name: signerName,
                            customer_phone: cleanedPhone,
                            message_text: fullMessage,
                            template_label: 'Signature Reminder',
                            status: 'sent',
                        })
                    } catch (logErr) {
                        console.error('Failed to log message:', logErr)
                    }
                } else {
                    console.warn(`[signature-reminder] WhatsApp failed for ${cleanedPhone}:`, waResult)
                }
            } catch (waErr: any) {
                console.error(`[signature-reminder] WhatsApp error for ${cleanedPhone}:`, waErr.message)
            }
        }

        console.log(`[signature-reminder] Done. Sent ${sent} reminders out of ${pendingRequests.length} pending`)
        return { statusCode: 200, body: JSON.stringify({ sent, total: pendingRequests.length }) }
    } catch (err: any) {
        console.error('[signature-reminder] Error:', err)
        return { statusCode: 500, body: err.message }
    }
}

// Run every 30 minutes
export const handler = schedule('*/30 * * * *', reminderHandler)
