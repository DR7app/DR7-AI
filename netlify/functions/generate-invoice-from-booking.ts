import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

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

        // Fetch customer data
        const customerId = booking.user_id || booking.customer_id
        console.log('=== INVOICE GENERATION DEBUG ===')
        console.log('Booking ID:', bookingId)
        console.log('Booking customer_name:', booking.customer_name)
        console.log('Booking user_id:', booking.user_id)
        console.log('Booking customer_id:', booking.customer_id)
        console.log('Using customer ID:', customerId)

        let customerData = null

        // Only fetch customer data if we have a valid customer ID
        if (customerId && customerId !== 'undefined') {
            const { data, error: customerError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', customerId)
                .single()

            if (customerError) {
                console.error('Customer fetch error:', customerError)
            } else {
                customerData = data
                console.log('Customer data fetched:', {
                    id: customerData?.id,
                    fullName: customerData?.fullName,
                    nome: customerData?.nome,
                    email: customerData?.email,
                    telefono: customerData?.telefono,
                    indirizzo: customerData?.indirizzo,
                    hasData: !!(customerData?.email || customerData?.telefono || customerData?.indirizzo)
                })
            }
        } else {
            console.log('No valid customer ID - will use booking data only')
        }
        console.log('=== END DEBUG ===')

        // Build complete customer address
        let fullAddress = ''
        if (customerData) {
            const addressParts = []

            // Build street address with civic number
            if (customerData.indirizzo) {
                let streetAddress = customerData.indirizzo
                if (customerData.numero_civico) {
                    streetAddress += ` ${customerData.numero_civico}`
                }
                addressParts.push(streetAddress)
            }

            // Build city line with postal code
            if (customerData.citta_residenza || customerData.codice_postale) {
                let cityLine = ''
                if (customerData.codice_postale) {
                    cityLine += customerData.codice_postale
                }
                if (customerData.citta_residenza) {
                    cityLine += (cityLine ? ' ' : '') + customerData.citta_residenza
                }
                if (customerData.provincia_residenza) {
                    cityLine += ` (${customerData.provincia_residenza})`
                }
                if (cityLine) {
                    addressParts.push(cityLine)
                }
            }

            fullAddress = addressParts.join(', ')
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
                const match = lastInvoice.numero_fattura.match(/^(\d+)\//)
                if (match) {
                    nextNumber = parseInt(match[1]) + 1
                }
            }

            invoiceNumber = `${nextNumber}/${currentYear}`
        }


        // Parse booking dates
        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)
        const rentalDays = Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24))

        // Create invoice items
        const items = []

        // Main rental item
        const dailyRate = (booking.price_total || 0) / rentalDays / 100 // Convert from cents
        items.push({
            description: `Noleggio ${booking.vehicle_name} - ${rentalDays} giorni`,
            unit_price: dailyRate,
            quantity: rentalDays,
            vat_rate: 22,
            total: dailyRate * rentalDays
        })

        // Add insurance if present in booking details
        const bookingDetails = booking.booking_details || {}
        if (bookingDetails.insurance) {
            const insuranceName = bookingDetails.insurance.replace(/_/g, ' ')
            items.push({
                description: `Assicurazione ${insuranceName}`,
                unit_price: bookingDetails.insurancePrice || 0,
                quantity: rentalDays,
                vat_rate: 22,
                total: (bookingDetails.insurancePrice || 0) * rentalDays
            })
        }

        // Add KM overage fee if present
        if (booking.km_overage_fee && booking.km_overage_fee > 0) {
            items.push({
                description: 'Penale chilometraggio extra',
                unit_price: booking.km_overage_fee / 100,
                quantity: 1,
                vat_rate: 0, // Penalties are usually VAT exempt
                total: booking.km_overage_fee / 100
            })
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
        const invoiceData = {
            numero_fattura: invoiceNumber,
            data_emissione: new Date().toISOString().split('T')[0],
            importo_totale: total,
            stato: booking.payment_status === 'paid' || booking.payment_status === 'completed' ? 'paid' :
                booking.payment_status === 'pending' ? 'pending' : 'unpaid',
            customer_name: booking.customer_name || customerData?.fullName || customerData?.nome || 'Cliente',
            customer_address: fullAddress || customerData?.indirizzo || '',
            customer_phone: customerData?.telefono || customerData?.phone || booking.customer_phone || '',
            customer_email: customerData?.email || booking.customer_email || '',
            customer_tax_code: customerData?.codiceFiscale || customerData?.codice_fiscale || '',
            customer_vat: customerData?.partitaIva || customerData?.partita_iva || '',
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
