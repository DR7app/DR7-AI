import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth } from './require-auth'
import { renderTemplate } from './utils/messageTemplates'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const {
            transactionId,
            bookingId,
            customerName,
            customerEmail,
            contractNumber,
            amount,
            causale,
            contractId,
            contractIds,
            recurring,
            intervalHours,
            photoUrls,
            sendEmail,
        } = JSON.parse(event.body || '{}')

        // NESSUNA email per default: l'addebito va diretto alla fase di charge.
        // L'email parte SOLO se il chiamante passa esplicitamente sendEmail=true.
        const wantEmail = sendEmail === true

        if (!amount || !causale) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Importo e causale sono obbligatori' }),
            }
        }
        if (wantEmail && !customerEmail) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email cliente richiesta per inviare l\'avviso (oppure disattiva l\'invio email)' }),
            }
        }

        const amountFormatted = parseFloat(amount).toFixed(2)
        const contractRef = contractNumber || bookingId?.substring(0, 8)?.toUpperCase() || 'N/A'

        if (wantEmail) {
            const resend = new Resend(process.env.RESEND_API_KEY)
            // Body + subject provengono esclusivamente da Messaggi di Sistema Pro.
            const templateVars = {
                customer_name: customerName || 'Cliente',
                contract_ref: contractRef,
                amount: amountFormatted,
                causale,
            }
            const emailBody = await renderTemplate('pro_email_addebito', templateVars)
            const emailSubject = await renderTemplate('pro_email_addebito_subject', templateVars)
            if (!emailBody || !emailSubject) {
                console.error('[nexi-nuovo-addebito] Pro email template missing/disabled')
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Template email addebito non configurato in Messaggi di Sistema Pro' }),
                }
            }
            const emailHtml = `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${emailBody}</pre>`
            const { error: emailError } = await resend.emails.send({
                from: 'DR7 <info@dr7.app>',
                to: customerEmail,
                subject: emailSubject,
                html: emailHtml,
            })
            if (emailError) throw new Error(emailError.message)
            console.log(`[nexi-nuovo-addebito] Initial email sent to ${customerEmail}`)
        } else {
            console.log('[nexi-nuovo-addebito] sendEmail=false — nessuna email, addebito diretto alla fase di charge')
        }

        const chargeAt = new Date(Date.now() + 1 * 60 * 1000).toISOString() // ~1 min
        await supabase.from('pending_addebiti').insert({
            transaction_id: transactionId || null,
            booking_id: bookingId || null,
            customer_name: customerName || '',
            customer_email: customerEmail || '',
            contract_number: contractRef,
            contract_id: contractId || (Array.isArray(contractIds) ? contractIds[0] : null) || null,
            // Cascata multi-carta: lista ordinata di carte da provare (la prima
            // che accetta vince). Inclusa SOLO con 2+ carte: cosi' gli addebiti
            // a carta singola funzionano anche se la colonna non esiste ancora.
            ...((Array.isArray(contractIds) && contractIds.filter(Boolean).length > 1) ? { cascade_contract_ids: contractIds.filter(Boolean) } : {}),
            amount_cents: Math.round(parseFloat(amount) * 100),
            causale: causale,
            // Con email: parte dal flusso email. Senza email (default): salta
            // direttamente alla fase di addebito (second_email_sent + mit_charge_after)
            // cosi' il cron process-pending-addebiti lo addebita senza inviare nulla.
            status: wantEmail ? 'email_sent' : 'second_email_sent',
            email_sent_at: wantEmail ? new Date().toISOString() : null,
            second_email_sent_at: wantEmail ? null : new Date().toISOString(),
            charge_after: chargeAt,
            ...(wantEmail ? {} : { mit_charge_after: chargeAt }),
            recurring: !!recurring,
            interval_hours: recurring ? (parseInt(intervalHours) || 24) : null,
            photo_urls: photoUrls && photoUrls.length > 0 ? photoUrls : null,
        })

        console.log(`[nexi-nuovo-addebito] Pending addebito created (${wantEmail ? 'con email' : 'senza email'}), charge scheduled`)

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: wantEmail
                    ? `Email inviata a ${customerEmail}. Addebito programmato.`
                    : 'Addebito programmato (senza email).',
            }),
        }
    } catch (error: any) {
        console.error('[nexi-nuovo-addebito] Error:', error.message)
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message }),
        }
    }
}
