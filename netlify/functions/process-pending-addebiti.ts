import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.secureserver.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
})

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

// Direct MIT charge via Nexi API (avoids HTTP roundtrip to nexi-charge-mit function)
async function chargeMit(params: {
    contractId: string
    amount: number
    description: string
    bookingId?: string | null
    customerEmail?: string
    customerName?: string
}): Promise<{ success: boolean; error?: string; orderId?: string; operationResult?: string }> {
    const orderId = `MIT-${Date.now()}-${Math.floor(Math.random() * 10000)}`.slice(0, 18)
    const amountCents = Math.round(params.amount * 100)
    const correlationId = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()

    const payload: any = {
        order: {
            orderId,
            amount: amountCents.toString(),
            currency: 'EUR',
            description: params.description || 'Addebito DR7 Empire',
        },
        contractId: params.contractId,
        captureType: 'IMPLICIT',
    }

    if (params.customerEmail || params.customerName) {
        payload.order.customerInfo = {
            cardHolderEmail: params.customerEmail || '',
            cardHolderName: params.customerName || '',
        }
    }

    const response = await fetch(`${NEXI_BASE_URL}/orders/mit`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': NEXI_API_KEY,
            'Correlation-Id': correlationId,
            'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    let responseData: any
    try { responseData = JSON.parse(responseText) } catch { responseData = {} }

    const operationResult = responseData.operation?.operationResult || responseData.operationResult
    const isSuccess = operationResult === 'AUTHORIZED' || operationResult === 'EXECUTED'

    // Store transaction in DB
    await supabase.from('nexi_transactions').insert({
        order_id: orderId,
        booking_id: params.bookingId || null,
        amount_cents: amountCents,
        status: isSuccess ? 'completed' : 'failed',
        description: params.description || 'Addebito MIT',
        customer_email: params.customerEmail || null,
        metadata: {
            type: 'mit_charge',
            contract_id: params.contractId,
            customer_name: params.customerName,
            correlation_id: correlationId,
            operation_result: operationResult,
            nexi_response: responseData,
        },
        created_at: new Date().toISOString(),
    })

    if (!response.ok || !isSuccess) {
        return {
            success: false,
            error: responseData.errors?.[0]?.description || operationResult || 'DECLINED',
            orderId,
            operationResult,
        }
    }

    return { success: true, orderId, operationResult }
}

const processHandler: Handler = async () => {
    const now = new Date().toISOString()

    // 1. Find addebiti ready for second email (24h passed, status = email_sent)
    const { data: readyForSecondEmail } = await supabase
        .from('pending_addebiti')
        .select('*')
        .eq('status', 'email_sent')
        .lte('charge_after', now)

    for (const addebito of (readyForSecondEmail || [])) {
        try {
            const amountFormatted = (addebito.amount_cents / 100).toFixed(2)

            // Send second formal email with MIT authorization clause
            const emailBody = `Spett.le ${addebito.customer_name || 'Cliente'},

con la presente Le comunichiamo formalmente che, in relazione al contratto di noleggio n. ${addebito.contract_number}, è stato rilevato un importo a Suo carico derivante da obbligazioni contrattuali maturate nel corso o al termine del periodo di utilizzo del veicolo.

L'importo complessivo oggetto di addebito è pari a € ${amountFormatted}, con la seguente causale:
• ${addebito.causale}

Tale importo è determinato in conformità:
• alle condizioni generali di contratto sottoscritte e accettate;
• alla documentazione contrattuale e/o tecnica disponibile (ove applicabile);
• alle disposizioni normative vigenti.

Ai sensi dell'art. 1218 c.c., il debitore che non esegue esattamente la prestazione dovuta è tenuto al risarcimento del danno.
Ai sensi dell'art. 1372 c.c., il contratto ha forza di legge tra le parti.
Ai sensi dell'art. 1588 c.c., il conduttore risponde della perdita e del deterioramento del bene locato.

Si richiama inoltre quanto espressamente previsto nel contratto di noleggio in merito:
• alla responsabilità del cliente per costi, danni, penali e oneri accessori;
• all'autorizzazione preventiva all'addebito di importi ulteriori rispetto al corrispettivo iniziale;
• all'utilizzo del metodo di pagamento fornito per operazioni successive (MIT – Merchant Initiated Transactions).

Pertanto, in conformità alle suddette disposizioni contrattuali e normative, si sta procedendo all'addebito dell'importo sopra indicato mediante il metodo di pagamento da Lei utilizzato in fase di noleggio.

Resta a disposizione, su richiesta, la documentazione a supporto dell'addebito (contratto, report, documentazione fotografica, verbali, ecc.).

La presente costituisce comunicazione formale dell'addebito in corso.

Cordiali saluti,
Dubai Rent 7.0 S.p.A.`

            // Build attachments from photo_urls if present
            const attachments: { filename: string; path: string }[] = []
            if (addebito.photo_urls && Array.isArray(addebito.photo_urls)) {
                for (let i = 0; i < addebito.photo_urls.length; i++) {
                    attachments.push({
                        filename: `danno_${i + 1}.jpg`,
                        path: addebito.photo_urls[i],
                    })
                }
            }

            let emailHtml = ''
            if (attachments.length > 0) {
                emailHtml = `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${emailBody}</pre>`
                emailHtml += `<br/><p style="font-family: Arial, sans-serif;"><strong>Documentazione fotografica danni allegata:</strong></p>`
                for (let i = 0; i < addebito.photo_urls.length; i++) {
                    emailHtml += `<p><img src="${addebito.photo_urls[i]}" alt="Danno ${i + 1}" style="max-width: 600px; border: 1px solid #ccc; margin: 8px 0;" /></p>`
                }
            }

            await transporter.sendMail({
                from: `"DR7 Empire" <${process.env.SMTP_USER || 'info@dr7.app'}>`,
                to: addebito.customer_email,
                subject: `Comunicazione formale addebito in corso - Contratto ${addebito.contract_number}`,
                text: emailBody,
                ...(emailHtml ? { html: emailHtml } : {}),
                attachments,
            })

            console.log(`[process-pending-addebiti] Second email sent to ${addebito.customer_email} (${attachments.length} photos attached)`)

            // Update status and schedule MIT charge for 2 min later
            await supabase.from('pending_addebiti').update({
                status: 'second_email_sent',
                second_email_sent_at: new Date().toISOString(),
                mit_charge_after: new Date(Date.now() + 1 * 60 * 1000).toISOString(), // TEST: 1 min (prod: 2 min)
            }).eq('id', addebito.id)

        } catch (err: any) {
            console.error(`[process-pending-addebiti] Error processing addebito ${addebito.id}:`, err.message)
            await supabase.from('pending_addebiti').update({
                status: 'error',
                error_message: err.message,
            }).eq('id', addebito.id)
        }
    }

    // 2. Find addebiti ready for MIT charge (2 min after second email)
    const { data: readyForCharge } = await supabase
        .from('pending_addebiti')
        .select('*')
        .eq('status', 'second_email_sent')
        .lte('mit_charge_after', now)

    for (const addebito of (readyForCharge || [])) {
        if (!addebito.contract_id) {
            console.warn(`[process-pending-addebiti] No contractId for addebito ${addebito.id}, skipping charge`)
            await supabase.from('pending_addebiti').update({
                status: 'no_contract_id',
                error_message: 'Nessun contractId Nexi disponibile per addebito MIT',
            }).eq('id', addebito.id)
            continue
        }

        try {
            let currentAmountCents = addebito.amount_cents
            const minAmountCents = 50 // €0.50 minimum
            let charged = false
            let lastError = ''
            let attempts = 0

            // Auto-retry with -10% each attempt, 1 second delay between
            while (currentAmountCents >= minAmountCents) {
                const amountEur = currentAmountCents / 100
                attempts++
                console.log(`[process-pending-addebiti] Attempt #${attempts} — €${amountEur.toFixed(2)} for addebito ${addebito.id}`)

                try {
                    const result = await chargeMit({
                        contractId: addebito.contract_id,
                        amount: amountEur,
                        description: `Addebito: ${addebito.causale} - Contratto ${addebito.contract_number}`,
                        bookingId: addebito.booking_id || null,
                        customerEmail: addebito.customer_email,
                        customerName: addebito.customer_name,
                    })

                    if (result.success) {
                        console.log(`[process-pending-addebiti] ✅ Charged €${amountEur.toFixed(2)} (attempt #${attempts}) for addebito ${addebito.id}`)
                        await supabase.from('pending_addebiti').update({
                            status: 'charged',
                            charged_at: new Date().toISOString(),
                            charge_count: (addebito.charge_count || 0) + attempts,
                            charged_amount_cents: currentAmountCents,
                            error_message: attempts > 1 ? `Addebitato €${amountEur.toFixed(2)} dopo ${attempts} tentativi (importo originale: €${(addebito.amount_cents / 100).toFixed(2)})` : null,
                        }).eq('id', addebito.id)
                        charged = true
                        break
                    } else {
                        lastError = result.error || 'DECLINED'
                        console.log(`[process-pending-addebiti] ❌ €${amountEur.toFixed(2)} rifiutato: ${lastError}`)
                    }
                } catch (fetchErr: any) {
                    lastError = fetchErr.message
                    console.log(`[process-pending-addebiti] ❌ €${amountEur.toFixed(2)} errore: ${lastError}`)
                }

                // Reduce by 10% and wait 1 second
                currentAmountCents = Math.round(currentAmountCents * 0.9)
                if (currentAmountCents >= minAmountCents) {
                    await new Promise(r => setTimeout(r, 1000))
                }
            }

            if (!charged) {
                console.error(`[process-pending-addebiti] All ${attempts} attempts failed for addebito ${addebito.id}`)

                if (addebito.recurring && addebito.interval_hours) {
                    const nextRetry = new Date(Date.now() + addebito.interval_hours * 60 * 60 * 1000).toISOString()
                    await supabase.from('pending_addebiti').update({
                        status: 'second_email_sent',
                        error_message: `${attempts} tentativi falliti (min €${(minAmountCents / 100).toFixed(2)}) — ${lastError}. Prossimo ciclo: ${nextRetry}`,
                        mit_charge_after: nextRetry,
                        charge_count: (addebito.charge_count || 0) + attempts,
                    }).eq('id', addebito.id)
                } else {
                    await supabase.from('pending_addebiti').update({
                        status: 'charge_failed',
                        error_message: `${attempts} tentativi falliti (da €${(addebito.amount_cents / 100).toFixed(2)} a €${(minAmountCents / 100).toFixed(2)}) — ${lastError}`,
                        charge_count: (addebito.charge_count || 0) + attempts,
                    }).eq('id', addebito.id)
                }
            }
        } catch (err: any) {
            console.error(`[process-pending-addebiti] Error charging addebito ${addebito.id}:`, err.message)
            await supabase.from('pending_addebiti').update({
                status: 'charge_failed',
                error_message: err.message,
            }).eq('id', addebito.id)
        }
    }

    const processed = (readyForSecondEmail?.length || 0) + (readyForCharge?.length || 0)
    console.log(`[process-pending-addebiti] Processed ${processed} addebiti`)

    return { statusCode: 200, body: JSON.stringify({ processed }) }
}

// TEST: Run every minute (prod: '0 * * * *' = every hour)
export const handler = schedule('* * * * *', processHandler)
