import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateFatturaXML, generateInvoiceFilename } from './xml-utils'
import { uploadInvoiceToAruba } from './aruba-utils'
import { generateInvoicePDF } from './invoice-pdf-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const body = JSON.parse(event.body || '{}')
        const { bookingId, customerId, note, type, paymentStatus } = body

        // Validation
        if (!bookingId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Booking ID is required' })
            }
        }

        // Support both new cart format (items[]) and legacy single-item format (amount + motivo)
        interface CartItem { label: string; amount: number; quantity: number }
        let cartItems: CartItem[] = []

        if (body.items && Array.isArray(body.items) && body.items.length > 0) {
            cartItems = body.items.filter((item: any) => item.amount > 0 && item.quantity > 0)
        } else if (body.amount && body.amount > 0) {
            cartItems = [{ label: body.motivo || '', amount: body.amount, quantity: 1 }]
        }

        if (cartItems.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Almeno una penale con importo valido richiesta' })
            }
        }

        const totalAmount = cartItems.reduce((sum, item) => sum + item.amount * item.quantity, 0)

        if (totalAmount <= 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Importo totale deve essere maggiore di zero' })
            }
        }

        // Fetch booking details
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Booking not found' })
            }
        }

        // Fetch customer data
        const bookingDetails = booking.booking_details || {}
        const finalCustomerId = customerId || bookingDetails.customer?.customerId || booking.user_id || booking.customer_id

        let customerData: any = null

        if (finalCustomerId && finalCustomerId !== 'undefined') {
            const { data, error: customerError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', finalCustomerId)
                .single()

            if (data) {
                customerData = data
            } else if (customerError) {
                console.warn('Customer fetch error by ID:', customerError.message)
            }
        }

        // Resolve customer info from booking or booking_details fallback
        const resolvedEmail = booking.customer_email || booking.booking_details?.customer?.email
        const resolvedPhone = booking.customer_phone || booking.booking_details?.customer?.phone

        // Fallback: Try by email
        if (!customerData && resolvedEmail) {
            const { data } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', resolvedEmail)
                .single()

            if (data) {
                customerData = data
            }
        }

        const bookingCustomer = bookingDetails.customer || {}

        // Build customer address
        let fullAddress = ''
        if (customerData) {
            const addressParts = []
            const street = customerData.indirizzo || customerData.address || ''
            const num = customerData.numero_civico || ''
            const zip = customerData.codice_postale || customerData.zipCode || ''
            const city = customerData.citta_residenza || customerData.city || ''
            const prov = customerData.provincia_residenza || customerData.province || ''

            if (street) {
                let streetAddress = street
                if (num) streetAddress += ` ${num}`
                addressParts.push(streetAddress)
            }

            if (city || zip) {
                let cityLine = ''
                if (zip) cityLine += zip
                if (city) cityLine += (cityLine ? ' ' : '') + city
                if (prov) cityLine += ` (${prov})`
                if (cityLine) addressParts.push(cityLine)
            }

            fullAddress = addressParts.join(', ')
        }

        if (!fullAddress || fullAddress.trim() === '') {
            fullAddress = bookingCustomer.address || ''
            if (bookingCustomer.city) fullAddress += `, ${bookingCustomer.city}`
            if (bookingCustomer.zip) fullAddress += ` ${bookingCustomer.zip}`
        }

        const taxCode = customerData?.codiceFiscale || customerData?.codice_fiscale || bookingCustomer.taxCode || ''
        const vatNumber = customerData?.partitaIva || customerData?.partita_iva || bookingCustomer.vatNumber || ''

        // Validation: Mandatory fields
        if (!fullAddress || fullAddress.trim() === '') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Client data incomplete',
                    message: 'Indirizzo cliente obbligatorio. Aggiorna il profilo cliente.',
                    details: 'Address is missing'
                })
            }
        }

        if (!taxCode || taxCode.trim() === '') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Client data incomplete',
                    message: 'Codice Fiscale cliente obbligatorio. Aggiorna il profilo cliente.',
                    details: 'Tax Code is missing'
                })
            }
        }

        // Atomic invoice numbering via DB sequence (prevents race-condition duplicates)
        const currentYear = new Date().getFullYear()
        const { data: seqResult, error: seqError } = await supabase.rpc('next_invoice_number', { p_year: currentYear })

        if (seqError || seqResult == null) {
            console.error('[Penalty Invoice] Sequence error:', seqError)
            throw new Error('Failed to generate invoice number: ' + (seqError?.message || 'sequence returned null'))
        }

        const invoiceNumber = `DR7-${currentYear}-${String(seqResult).padStart(4, '0')}`

        // Create invoice items from cart
        // IMPORTANT: Amount is NET (without IVA), VAT rate is 0
        const isDanni = type === 'danni'
        const bookingPrefix = `${isDanni ? 'Danno' : 'Penale'} prenotazione ${booking.id.substring(0, 8).toUpperCase()}`

        const items = cartItems.map(item => {
            const description = item.label
                ? `${bookingPrefix} - ${item.label}`
                : bookingPrefix
            return {
                description,
                unit_price: item.amount,
                quantity: item.quantity,
                vat_rate: 0,
                total: Math.round(item.amount * item.quantity * 100) / 100
            }
        })

        // Calculate totals (penalties are exempt from VAT)
        const subtotal = 0
        const vatAmount = 0
        const exemptAmount = totalAmount
        const total = totalAmount

        // Create invoice
        const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
        const invoiceData = {
            numero_fattura: invoiceNumber,
            data_emissione: italyDate,
            importo_totale: total,
            stato: paymentStatus === 'paid' ? 'paid' : 'pending',
            customer_name: booking.customer_name || booking.booking_details?.customer?.fullName || customerData?.fullName || customerData?.nome || 'Cliente',
            customer_address: fullAddress,
            customer_phone: customerData?.telefono || customerData?.phone || bookingCustomer.phone || resolvedPhone || '',
            customer_email: customerData?.email || bookingCustomer.email || resolvedEmail || '',
            customer_tax_code: taxCode,
            customer_vat: vatNumber,
            booking_id: bookingId,
            items,
            subtotal,
            vat_amount: vatAmount,
            exempt_amount: exemptAmount,
            sdi_status: 'draft',
            note: note || undefined
            // tipo_fattura: 'penale' // Commented out to prevent errors if column is missing. Use description to identify.
        }

        const { data: invoice, error: insertError } = await supabase
            .from('fatture')
            .insert([invoiceData])
            .select()
            .single()

        if (insertError) {
            console.error('Insert error:', insertError)
            throw insertError
        }

        // Auto-send to SDI via Aruba if paid and customer has tax code
        if (paymentStatus === 'paid' && invoice.customer_tax_code) {
            try {
                const xmlContent = generateFatturaXML(invoice as any)
                const filename = generateInvoiceFilename(invoice as any)
                const arubaResult = await uploadInvoiceToAruba(xmlContent, filename)

                await supabase.from('fatture').update({
                    sdi_status: 'sending',
                    aruba_invoice_id: arubaResult.id,
                    xml_filename: filename,
                    aruba_upload_filename: arubaResult.filename,
                    sdi_sent_at: new Date().toISOString()
                }).eq('id', invoice.id)

                console.log('[Penalty Invoice] Auto-sent to SDI via Aruba:', arubaResult.id)
            } catch (sdiError: any) {
                console.error('[Penalty Invoice] Auto-SDI failed (invoice still saved as draft):', sdiError.message)
            }
        }

        // --- Generate PDF, upload to storage, send via WhatsApp ---
        let pdfUrl: string | null = null
        try {
            const pdfBytes = await generateInvoicePDF(invoice as any)
            const pdfFileName = `fattura_${invoice.numero_fattura.replace(/\//g, '-')}_${Date.now()}.pdf`

            const { error: uploadError } = await supabase.storage
                .from('invoices')
                .upload(pdfFileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

            if (uploadError) {
                console.error('[Penalty Invoice] PDF storage upload failed:', uploadError.message)
            } else {
                const { data: { publicUrl } } = supabase.storage
                    .from('invoices')
                    .getPublicUrl(pdfFileName)

                pdfUrl = publicUrl
                console.log('[Penalty Invoice] PDF uploaded to storage:', pdfUrl)

                await supabase.from('fatture').update({ pdf_url: pdfUrl }).eq('id', invoice.id)

                const customerPhone = invoice.customer_phone || resolvedPhone || ''
                if (customerPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    let cleanPhone = customerPhone.replace(/[\s\-\+\(\)]/g, '')
                    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
                    if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

                    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`
                    const waResponse = await fetch(greenApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${cleanPhone}@c.us`,
                            urlFile: pdfUrl,
                            fileName: `Fattura_${invoice.numero_fattura}.pdf`,
                            caption: `Fattura ${invoice.numero_fattura} - DR7 Empire`
                        })
                    })

                    const waResult = await waResponse.json()
                    if (waResponse.ok && !waResult.error) {
                        console.log('[Penalty Invoice] Fattura PDF sent via WhatsApp:', waResult.idMessage)
                    } else {
                        console.error('[Penalty Invoice] WhatsApp send failed:', waResult)
                    }
                } else {
                    if (!customerPhone) console.log('[Penalty Invoice] No customer phone — skipping WhatsApp PDF send')
                    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) console.log('[Penalty Invoice] Green API not configured — skipping WhatsApp PDF send')
                }
            }
        } catch (pdfError: any) {
            console.error('[Penalty Invoice] PDF generation/send failed (invoice still saved):', pdfError.message)
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                invoice: invoice,
                invoiceId: invoice.id,
                pdfUrl,
                message: 'Penalty invoice generated successfully'
            })
        }
    } catch (error: any) {
        console.error('Error generating penalty invoice:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to generate penalty invoice',
                message: error.message || 'Errore durante la generazione della fattura. Riprova.'
            })
        }
    }
}
