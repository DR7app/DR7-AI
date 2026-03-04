import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateFatturaXML, generateInvoiceFilename } from './xml-utils'
import { uploadInvoiceToAruba } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invoice ID is required' }) }
        }

        // Fetch invoice from database
        const { data: invoice, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !invoice) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) }
        }

        // Skip if already sent/processing (prevent duplicate uploads to Aruba)
        if (['sending', 'sent', 'accepted'].includes(invoice.sdi_status)) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: `Invoice already in status: ${invoice.sdi_status}`,
                    skipped: true
                })
            }
        }

        // If invoice was previously sent (rejected/scartata/error), ALWAYS assign a NEW number
        // This prevents SDI error 00404 (fattura duplicata) when retrying
        const needsNewNumber = invoice.sdi_status === 'rejected' ||
            invoice.sdi_status === 'scartata' ||
            invoice.sdi_status === 'error' ||
            invoice.aruba_invoice_id // was already uploaded before

        if (needsNewNumber) {
            const currentYear = new Date().getFullYear()
            let newNumber = ''

            // Retry loop: ensure the new number doesn't already exist in DB
            for (let attempt = 0; attempt < 5; attempt++) {
                const { data: seqResult, error: seqError } = await supabase.rpc('next_invoice_number', { p_year: currentYear })

                if (seqError || seqResult == null) {
                    console.error('[SDI] Sequence error on retry:', seqError)
                    return {
                        statusCode: 500,
                        body: JSON.stringify({ error: 'Failed to generate new invoice number for retry', details: seqError?.message })
                    }
                }

                const candidate = `DR7-${currentYear}-${String(seqResult).padStart(4, '0')}`
                const { data: existing } = await supabase.from('fatture').select('id').eq('numero_fattura', candidate).maybeSingle()
                if (!existing) {
                    newNumber = candidate
                    break
                }
                console.warn(`[SDI] Number ${candidate} already exists, retrying...`)
            }

            if (!newNumber) {
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: 'Failed to generate unique invoice number after 5 attempts' })
                }
            }

            console.log(`[SDI] Re-send: ${invoice.numero_fattura} → new number ${newNumber}`)

            await supabase.from('fatture').update({
                numero_fattura: newNumber,
                sdi_status: 'draft'
            }).eq('id', invoiceId)

            invoice.numero_fattura = newNumber
        }

        // 1. Generate XML
        // Ensure invoice object matches InvoiceData interface if needed, or cast it
        // The DB columns largely match standard naming
        const xmlContent = generateFatturaXML(invoice as any)
        const filename = generateInvoiceFilename(invoice as any)

        console.log('[Aruba] Generated XML:', filename)

        // 2. Upload to Aruba
        let arubaResult
        try {
            arubaResult = await uploadInvoiceToAruba(xmlContent, filename)
            console.log('[Aruba] Upload success:', arubaResult)
        } catch (apiError: any) {
            console.error('[Aruba] API Error:', apiError)

            // Log error to new status table
            await supabase.from('invoice_status_logs').insert({
                invoice_id: invoiceId,
                status: 'error',
                message: apiError.message,
                raw_response: { error: apiError.toString() }
            })

            // Update main table
            await supabase.from('fatture').update({ sdi_status: 'error' }).eq('id', invoiceId)

            return {
                statusCode: 502,
                body: JSON.stringify({ error: 'Failed to send to Aruba', details: apiError.message })
            }
        }

        // 3. Success - Update Database
        await supabase
            .from('fatture')
            .update({
                sdi_status: 'sending', // Waiting for Aruba to process/SdI to accept
                aruba_invoice_id: arubaResult.id,
                xml_filename: filename,
                aruba_upload_filename: arubaResult.filename,
                sdi_sent_at: new Date().toISOString()
            })
            .eq('id', invoiceId)

        // 4. Log success
        await supabase.from('invoice_status_logs').insert({
            invoice_id: invoiceId,
            status: 'sending',
            message: 'Uploaded to Aruba',
            raw_response: arubaResult
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Invoice sent to Aruba successfully',
                aruba_id: arubaResult.id,
                filename: filename
            })
        }
    } catch (error: any) {
        console.error('Error in send-invoice-to-sdi:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}
