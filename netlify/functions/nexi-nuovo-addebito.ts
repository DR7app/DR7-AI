import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

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
            recurring,
            intervalHours,
            photoUrls,
        } = JSON.parse(event.body || '{}')

        if (!customerEmail || !amount || !causale) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email, importo e causale sono obbligatori' }),
            }
        }

        const resend = new Resend(process.env.RESEND_API_KEY)
        const amountFormatted = parseFloat(amount).toFixed(2)
        const contractRef = contractNumber || bookingId?.substring(0, 8)?.toUpperCase() || 'N/A'

        const emailBody = `Spett.le ${customerName || 'Cliente'},

con la presente Le comunichiamo formalmente che, in relazione al contratto di noleggio n. ${contractRef}, è stato rilevato un importo a Suo carico derivante da obbligazioni contrattuali maturate nel corso o al termine del periodo di utilizzo del veicolo.

L'importo complessivo oggetto di addebito è pari a € ${amountFormatted}, con la seguente causale:
• ${causale}

Tale importo è determinato in conformità:
• alle condizioni generali di contratto sottoscritte e accettate;
• alla documentazione contrattuale e/o tecnica disponibile (ove applicabile);
• alle disposizioni normative vigenti.

Ai sensi dell'art. 1218 c.c., il debitore che non esegue esattamente la prestazione dovuta è tenuto al risarcimento del danno.
Ai sensi dell'art. 1372 c.c., il contratto ha forza di legge tra le parti.
Ai sensi dell'art. 1588 c.c., il conduttore risponde della perdita e del deterioramento del bene locato.

Si richiama inoltre quanto espressamente previsto nel contratto di noleggio in merito.

Resta a disposizione, su richiesta, la documentazione a supporto dell'addebito (contratto, report, documentazione fotografica, verbali, ecc.).

Cordiali saluti,
Dubai Rent 7.0 S.p.A.`

        const emailHtml = `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${emailBody}</pre>`

        const { error: emailError } = await resend.emails.send({
            from: 'DR7 Empire <info@dr7.app>',
            to: customerEmail,
            subject: `Comunicazione addebito - Contratto ${contractRef}`,
            html: emailHtml,
        })

        if (emailError) throw new Error(emailError.message)

        console.log(`[nexi-nuovo-addebito] Initial email sent to ${customerEmail}`)

        await supabase.from('pending_addebiti').insert({
            transaction_id: transactionId || null,
            booking_id: bookingId || null,
            customer_name: customerName || '',
            customer_email: customerEmail,
            contract_number: contractRef,
            contract_id: contractId || null,
            amount_cents: Math.round(parseFloat(amount) * 100),
            causale: causale,
            status: 'email_sent',
            email_sent_at: new Date().toISOString(),
            charge_after: new Date(Date.now() + 1 * 60 * 1000).toISOString(), // TEST: 1 min (prod: 24h)
            recurring: !!recurring,
            interval_hours: recurring ? (parseInt(intervalHours) || 24) : null,
            photo_urls: photoUrls && photoUrls.length > 0 ? photoUrls : null,
        })

        console.log(`[nexi-nuovo-addebito] Pending addebito created, charge scheduled`)

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `Email inviata a ${customerEmail}. Addebito programmato.`,
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
