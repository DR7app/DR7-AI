import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateFatturaXML } from './xml-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Invoicetronic SDI Configuration
const INVOICETRONIC_API_KEY = process.env.INVOICETRONIC_API_KEY || 'ik_live_z7Wzq9ySqSfX5AbNUzlVpRJXJY4AXdGU'
const INVOICETRONIC_BASE_URL = process.env.INVOICETRONIC_BASE_URL || 'https://api.invoicetronic.com/v1'

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const { bookingId, includeIVA = true } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Booking ID is required' })
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

        // Fetch customer data with robust fallback (Logic from generate-contract.ts)
        const bookingDetails = booking.booking_details || {}
        // Priority order:
        // 1. booking.booking_details.customer.customerId (admin-created bookings)
        // 2. booking.user_id (website bookings)
        // 3. booking.customer_id (legacy)
        const customerId = bookingDetails.customer?.customerId || booking.user_id || booking.customer_id

        console.log('=== INVOICE GENERATION DEBUG ===')
        console.log('Booking ID:', bookingId)
        console.log('Looking for Customer ID:', customerId)
        console.log('Booking Email:', booking.customer_email)

        let customerData: any = null

        // 1. Try by ID
        if (customerId && customerId !== 'undefined') {
            const { data, error: customerError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', customerId)
                .single()

            if (data) {
                customerData = data
                console.log('✅ Found customer by ID')
            } else if (customerError) {
                console.warn('Customer fetch error by ID:', customerError.message)
            }
        }

        // 2. Fallback: Try by email in customers_extended
        if (!customerData && booking.customer_email) {
            console.log('Fallback: Fetching by email from customers_extended...')
            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', booking.customer_email)
                .single()

            if (data) {
                customerData = data
                console.log('✅ Found customer by Email (extended)')
            }
        }

        // 3. Fallback: Try basic customers table
        if (!customerData && booking.customer_email) {
            console.log('Fallback: Fetching by email from basic customers...')
            const { data } = await supabase
                .from('customers')
                .select('*')
                .eq('email', booking.customer_email)
                .single()

            if (data) {
                console.log('✅ Found customer by Email (basic)')
                // Map basic customer to extended format roughly
                customerData = {
                    ...data,
                    fullName: data.full_name,
                    nome: data.full_name,
                    email: data.email,
                    telefono: data.phone,
                    indirizzo: data.notes, // Sometimes notes contain address? Or we just use what we have.
                    // metadata might have info
                    indirizzo_residenza: data.metadata?.address,
                    citta_residenza: data.metadata?.city,
                    codice_postale: data.metadata?.zip,
                    codiceFiscale: data.metadata?.taxCode || data.metadata?.fiscalCode
                }
            }
        }

        console.log('Final Customer Data present:', !!customerData)

        // Ensure customerData is at least an empty object if null, to avoid crashes later? 
        // No, we handle null checks downstream. Except we want to merge booking details if customerData is missing.

        if (!customerData) {
            console.log('⚠️ No customer record found. Will use booking details.')
            // We don't construct a fake object here because the downstream logic
            // explicitly checks "if (customerData) { ... } else { ... use booking details ... }"
            // But wait, my downstream logic in previous step was:
            // "if ((!fullAddress ...) && bookingCustomer.address)"
            // So we are good.
        }
        console.log('=== END DEBUG ===')

        // Build complete customer address
        let fullAddress = ''
        // bookingDetails is already declared above
        const bookingCustomer = bookingDetails.customer || {}

        // 1. Try customerData from database
        if (customerData) {
            const addressParts = []
            // Check various potential address fields
            const street = customerData.indirizzo || customerData.address || customerData.street || ''
            const num = customerData.numero_civico || customerData.streetNumber || ''
            const zip = customerData.codice_postale || customerData.zipCode || customerData.zip || ''
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

        // 2. Fallback to booking details if address empty
        // This mirrors generate-contract.ts logic: clientAddress = customer?.indirizzo || booking...address
        if (!fullAddress || fullAddress.trim() === '') {
            fullAddress = bookingCustomer.address || ''
            if (bookingCustomer.city) fullAddress += `, ${bookingCustomer.city}`
            if (bookingCustomer.zip) fullAddress += ` ${bookingCustomer.zip}`
        }

        // Ensure tax fields are robustly fetched
        const taxCode = customerData?.codiceFiscale || customerData?.codice_fiscale || customerData?.tax_code || bookingCustomer.taxCode || bookingCustomer.codiceFiscale || ''
        const vatNumber = customerData?.partitaIva || customerData?.partita_iva || customerData?.vat_number || bookingCustomer.vatNumber || bookingCustomer.pIva || ''

        // VALIDATION: Mandatory fields check
        // User Requirement: "Client data incomplete: address and tax code are required."
        if (!fullAddress || fullAddress.trim() === '') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Client data incomplete',
                    message: 'Indirizzo cliente obbligatorio. Aggiorna il profilo cliente o la prenotazione.',
                    details: 'Address is missing'
                })
            }
        }
        if (!taxCode || taxCode.trim() === '') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Client data incomplete',
                    message: 'Codice Fiscale cliente obbligatorio. Aggiorna il profilo cliente o la prenotazione.',
                    details: 'Tax Code (Codice Fiscale) is missing'
                })
            }
        }

        // Check if invoice already exists for this booking
        const { data: existingInvoice } = await supabase
            .from('fatture')
            .select('id, numero_fattura')
            .eq('booking_id', bookingId)
            .single()

        // If invoice exists, we'll update it instead of creating a new one
        let invoiceNumber: string

        if (existingInvoice) {
            // Reuse existing invoice number
            invoiceNumber = existingInvoice.numero_fattura
        } else {
            // Get next invoice number
            const { data: lastInvoice } = await supabase
                .from('fatture')
                .select('numero_fattura')
                .order('created_at', { ascending: false })
                .limit(1)
                .single()

            let nextNumber = 1
            const currentYear = new Date().getFullYear()

            if (lastInvoice?.numero_fattura) {
                // Parse standard "DR7-2025-0013" or legacy "13/2025"
                const legacyMatch = lastInvoice.numero_fattura.match(/^(\d+)\//)
                const newMatch = lastInvoice.numero_fattura.match(/DR7-\d+-(\d+)/)

                if (newMatch) {
                    nextNumber = parseInt(newMatch[1], 10) + 1
                } else if (legacyMatch) {
                    nextNumber = parseInt(legacyMatch[1], 10) + 1
                }
            }

            const padded = String(nextNumber).padStart(4, '0')
            invoiceNumber = `DR7-${currentYear}-${padded}`
        }


        // Create invoice items
        const items = []
        let rentalDays = 1

        if (booking.service_type === 'car_wash' || booking.service_type === 'mechanical') {
            // Logic for Services (Car Wash / Mechanical)
            // User confirmed prices INCLUDE IVA (Gross)
            const serviceName = booking.service_name || (booking.service_type === 'car_wash' ? 'Lavaggio Auto' : 'Intervento Meccanico')
            const totalServicePrice = (booking.price_total || 0) / 100

            // Always extract Net Price implies dividing Gross by 1.22
            const netPrice = totalServicePrice / 1.22
            const vatRate = includeIVA ? 22 : 0

            items.push({
                description: `${serviceName} - Data: ${new Date(booking.appointment_date || booking.pickup_date).toLocaleDateString('it-IT')}`,
                unit_price: netPrice,
                quantity: 1,
                vat_rate: vatRate,
                total: netPrice // Line item logic downstream calculates total based on rate? No, mapped manually below.
                // Wait, the 'total' field in items array is usually (unit * qty). 
                // But generatesInvoiceHTML uses unit_price * quantity.
                // The 'total' property here in the object pushed to 'items' is used for subtotal calculation loop below?
                // Let's check lines 335+ "items.forEach..."
                // It uses "item.unit_price * item.quantity". So keys in object matter.
                // We should push the NET total into 'total' property? No, code doesn't use it.
            })
        } else {
            // Logic for Rentals (Default)
            // Parse booking dates
            const pickupDate = new Date(booking.pickup_date)
            const dropoffDate = new Date(booking.dropoff_date)
            rentalDays = Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24))
            if (rentalDays < 1) rentalDays = 1

            // Parse prices (assuming stored as cents)
            const priceTotal = (booking.price_total || 0) / 100
            const insuranceTotal = (bookingDetails.insurancePrice || 0) * rentalDays
            const kmFee = (booking.km_overage_fee || 0) / 100

            // Calculate base rental price (Total - Insurance - KM Fee)
            // Note: This logic assumes price_total INCLUDES insurance and fees. 
            // If price_total is JUST the car, verify logic. Usually price_total is final amount to pay.
            let vehiclePriceGross = priceTotal

            // If insurance is priced separately in metadata but included in total, subtract it to isolate vehicle price?
            // Simplified approach: Treat specific line items if we know them.
            // If we add insurance as a separate line item, we must ensure we don't double count it in the total.
            // The user wants clear lines.

            // Re-calculating from components if possible is safer, but we might drift from stored total.
            // Let's stick to: Create line items that SUM up to the booking.price_total.
            // If we have insurance, we split the Pot. If not, everything is Rental.

            // Calculate Net Prices for components based on IVA inclusion
            const vatRate = includeIVA ? 22 : 0
            // Always divide by 1.22 because prices are Gross (IVA Included)
            const vatDivisor = 1.22

            const insurancePriceGross = insuranceTotal
            const kmFeeGross = kmFee // KM fee might be exempt or 22%? Assuming 22% for now unless exempt.

            // Subtract extras from total to get vehicle portion
            let rentalGross = priceTotal - insurancePriceGross - kmFeeGross
            if (rentalGross < 0) rentalGross = 0 // Safety check

            // 1. Vehicle Rental Item
            items.push({
                description: `Noleggio ${booking.vehicle_name} - ${rentalDays} giorni`,
                unit_price: rentalGross / vatDivisor, // Net Price
                quantity: 1,
                vat_rate: vatRate,
                total: (rentalGross / vatDivisor) // Not strictly used by calculation loop
            })

            // 2. Insurance Item
            if (bookingDetails.insurance) {
                const insuranceName = bookingDetails.insurance.replace(/_/g, ' ')
                items.push({
                    description: `Assicurazione ${insuranceName} - ${rentalDays} giorni`,
                    unit_price: insurancePriceGross / vatDivisor,
                    quantity: 1,
                    vat_rate: vatRate,
                    total: (insurancePriceGross / vatDivisor)
                })
            }

            // 3. KM Overage (always 0% VAT for penalties)
            if (kmFeeGross > 0) {
                items.push({ // Penalties usually exempt (Article 15). Keep as is.
                    description: 'Penale chilometraggio extra',
                    unit_price: kmFeeGross,
                    quantity: 1,
                    vat_rate: 0,
                    total: kmFeeGross
                })
            }
        }

        // Calculate totals
        let subtotal = 0
        let vatAmount = 0
        let exemptAmount = 0

        items.forEach(item => {
            const itemTotal = item.unit_price * item.quantity
            if (item.vat_rate === 0) {
                exemptAmount += itemTotal
            } else {
                subtotal += itemTotal
                vatAmount += itemTotal * (item.vat_rate / 100)
            }
        })

        const total = subtotal + vatAmount + exemptAmount

        // Create invoice
        const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
        const invoiceData = {
            numero_fattura: invoiceNumber,
            data_emissione: italyDate,
            importo_totale: total,
            stato: booking.payment_status === 'paid' || booking.payment_status === 'completed' ? 'paid' :
                booking.payment_status === 'pending' ? 'pending' : 'unpaid',
            customer_name: booking.customer_name || customerData?.fullName || bookingCustomer.fullName || customerData?.nome || 'Cliente',
            customer_address: fullAddress || '',
            customer_phone: customerData?.telefono || customerData?.phone || bookingCustomer.phone || booking.customer_phone || '',
            customer_email: customerData?.email || bookingCustomer.email || booking.customer_email || '',
            customer_tax_code: taxCode,
            customer_vat: vatNumber,
            booking_id: bookingId,
            items,
            subtotal,
            vat_amount: vatAmount,
            exempt_amount: exemptAmount,
            sdi_status: 'draft'
        }

        const { data: invoice, error: insertError } = existingInvoice
            ? await supabase
                .from('fatture')
                .update(invoiceData)
                .eq('id', existingInvoice.id)
                .select()
                .single()
            : await supabase
                .from('fatture')
                .insert([invoiceData])
                .select()
                .single()

        if (insertError) {
            throw insertError
        }

        // --- AUTOMATIC SDI SENDING via Invoicetronic ---
        let sdiResult = null
        if (INVOICETRONIC_API_KEY && invoice) {
            try {
                console.log('[SDI] Generating FatturaPA XML...')

                // Generate FatturaPA XML
                const fatturaXML = generateFatturaXML({
                    numero_fattura: invoice.numero_fattura,
                    data_emissione: invoice.data_emissione,
                    customer_name: invoice.customer_name,
                    customer_address: invoice.customer_address,
                    customer_tax_code: invoice.customer_tax_code,
                    customer_vat: invoice.customer_vat,
                    items: items,
                    subtotal: subtotal,
                    vat_amount: vatAmount,
                    exempt_amount: exemptAmount,
                    importo_totale: total
                })

                console.log('[SDI] Sending to Invoicetronic SDI...')

                // Send to Invoicetronic SDI
                const sdiResponse = await fetch(`${INVOICETRONIC_BASE_URL}/send/file`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/xml',
                        'Authorization': `Basic ${Buffer.from(INVOICETRONIC_API_KEY + ':').toString('base64')}`,
                        'Accept': 'application/json'
                    },
                    body: fatturaXML
                })

                const responseData = await sdiResponse.json()
                sdiResult = responseData

                console.log('[SDI] Response:', responseData)

                // Update Invoice Status
                await supabase
                    .from('fatture')
                    .update({
                        sdi_status: sdiResponse.ok ? 'sent' : 'error',
                        sdi_id: responseData.data?.uuid || responseData.uuid,
                        sdi_sent_at: new Date().toISOString(),
                        sdi_response: responseData,
                        xml_fattura_pa: fatturaXML
                    })
                    .eq('id', invoice.id)

                // Update local object for return
                invoice.sdi_status = sdiResponse.ok ? 'sent' : 'error'

                if (!sdiResponse.ok) {
                    console.error('[SDI] Error response:', responseData)
                }
            } catch (sdiError: any) {
                console.error('[SDI] Sending Failed:', sdiError)
                // Don't fail the whole request, just log
                await supabase.from('fatture').update({
                    sdi_status: 'error',
                    sdi_response: { error: sdiError.message, stack: sdiError.stack }
                }).eq('id', invoice.id)
            }
        } else {
            console.warn('[SDI] Token not configured, skipping automatic send')
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                invoice: invoice,
                message: 'Invoice generated successfully'
            })
        }
    } catch (error: any) {
        console.error('Error generating invoice:', error)
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        })
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to generate invoice',
                message: error.message,
                details: error.details || 'No additional details',
                hint: error.hint || 'Check Netlify function logs for more info'
            })
        }
    }
}

// Address parsing moved to xml-utils.ts
