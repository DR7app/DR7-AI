import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateFatturaXML, generateInvoiceFilename } from './xml-utils'
import { uploadInvoiceToAruba } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
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

        // If invoice was previously sent/uploaded, ALWAYS assign a NEW number
        // This prevents SDI error 00404 (fattura duplicata) when retrying
        const needsNewNumber = invoice.sdi_status === 'rejected' ||
            invoice.sdi_status === 'scartata' ||
            invoice.sdi_status === 'error' ||
            invoice.sdi_status === 'sending' ||
            invoice.sdi_status === 'sent' ||
            invoice.sdi_status === 'accepted' ||
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

        // Re-fetch fresh customer data from customers_extended via booking
        // This ensures that if admin updated the customer profile, the fattura uses the latest info
        if (invoice.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('user_id, customer_name, customer_email, customer_phone, booking_details')
                .eq('id', invoice.booking_id)
                .single()

            if (booking) {
                const custId = booking.booking_details?.customer?.customerId || booking.user_id
                const custEmail = booking.customer_email || booking.booking_details?.customer?.email

                let customerData: any = null

                // Try by ID first
                if (custId) {
                    const { data } = await supabase.from('customers_extended').select('*').eq('id', custId).maybeSingle()
                    if (data) customerData = data
                    if (!customerData) {
                        const { data: byUserId } = await supabase.from('customers_extended').select('*').eq('user_id', custId).maybeSingle()
                        if (byUserId) customerData = byUserId
                    }
                }

                // Fallback by email
                if (!customerData && custEmail) {
                    const { data } = await supabase.from('customers_extended').select('*').eq('email', custEmail).maybeSingle()
                    if (data) customerData = data
                }

                if (customerData) {
                    // Build fresh address
                    const street = customerData.indirizzo || customerData.sede_legale || ''
                    const num = customerData.numero_civico || ''
                    const zip = customerData.codice_postale || customerData.cap || ''
                    const city = customerData.citta_residenza || customerData.citta || ''
                    const prov = (customerData.provincia_residenza || customerData.provincia || '').toUpperCase().trim()

                    const addressParts: string[] = []
                    if (street) addressParts.push(num ? `${street} ${num}` : street)
                    if (city || zip) {
                        let cityLine = ''
                        if (zip) cityLine += zip
                        if (city) cityLine += (cityLine ? ' ' : '') + city
                        if (prov) cityLine += ` (${prov})`
                        if (cityLine) addressParts.push(cityLine)
                    }
                    const freshAddress = addressParts.join(', ')

                    const freshName = customerData.tipo_cliente === 'azienda'
                        ? (customerData.ragione_sociale || customerData.denominazione || invoice.customer_name)
                        : `${customerData.nome || ''} ${customerData.cognome || ''}`.trim() || invoice.customer_name
                    const freshTaxCode = (customerData.codice_fiscale || '').toUpperCase().trim()
                    const freshVat = (customerData.partita_iva || '').toUpperCase().trim()
                    const freshEmail = customerData.email || invoice.customer_email || ''
                    const freshPhone = customerData.telefono || invoice.customer_phone || ''

                    // Update fatture row with fresh customer data
                    const updates: Record<string, any> = {}
                    if (freshName && freshName !== invoice.customer_name) updates.customer_name = freshName
                    if (freshAddress && freshAddress !== invoice.customer_address) updates.customer_address = freshAddress
                    if (freshTaxCode && freshTaxCode !== (invoice.customer_tax_code || '').toUpperCase().trim()) updates.customer_tax_code = freshTaxCode
                    if (freshVat && freshVat !== (invoice.customer_vat || '').toUpperCase().trim()) updates.customer_vat = freshVat
                    if (freshEmail && freshEmail !== invoice.customer_email) updates.customer_email = freshEmail
                    if (freshPhone && freshPhone !== invoice.customer_phone) updates.customer_phone = freshPhone

                    if (Object.keys(updates).length > 0) {
                        console.log('[SDI] Refreshing customer data on fattura:', updates)
                        await supabase.from('fatture').update(updates).eq('id', invoiceId)
                        // Apply to in-memory invoice for XML generation
                        Object.assign(invoice, updates)
                    }
                }
            }
        }

        // Normalize customer data (fix lowercase CF/P.IVA/provincia that SDI rejects)
        const normalizedTaxCode = (invoice.customer_tax_code || '').toUpperCase().trim()
        const normalizedVat = (invoice.customer_vat || '').toUpperCase().trim()
        // Fix provincia in address: (Ss) → (SS), (ca) → (CA)
        const normalizedAddress = (invoice.customer_address || '').replace(/\(([A-Za-z]{2})\)/, (_: string, prov: string) => `(${prov.toUpperCase()})`)
        const needsUpdate = normalizedTaxCode !== invoice.customer_tax_code || normalizedVat !== invoice.customer_vat || normalizedAddress !== invoice.customer_address
        if (needsUpdate) {
            await supabase.from('fatture').update({
                customer_tax_code: normalizedTaxCode,
                customer_vat: normalizedVat,
                customer_address: normalizedAddress
            }).eq('id', invoiceId)
            invoice.customer_tax_code = normalizedTaxCode
            invoice.customer_vat = normalizedVat
            invoice.customer_address = normalizedAddress
        }

        // 1. Generate XML
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
