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

        // Check if invoice already exists for this booking
        const { data: existingInvoice } = await supabase
            .from('fatture')
            .select('id, numero_fattura')
            .eq('booking_id', bookingId)
            .single()

        if (existingInvoice) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invoice already exists for this booking',
                    invoiceNumber: existingInvoice.numero_fattura
                })
            }
        }

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

        const invoiceNumber = `${nextNumber}/${currentYear}`

        // Extract customer info from booking
        const bookingDetails = booking.booking_details || {}
        const customerData = bookingDetails.customer || {}

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
            stato: 'paid',
            customer_name: booking.customer_name || customerData.fullName || 'Cliente',
            customer_address: customerData.address || '',
            customer_tax_code: customerData.codiceFiscale || '',
            customer_vat: customerData.partitaIva || '',
            booking_id: bookingId,
            items,
            subtotal,
            vat_amount: vatAmount,
            exempt_amount: exemptAmount,
            invoice_date: new Date().toISOString().split('T')[0],
            payment_method: booking.payment_method || 'Carta di credito / bancomat',
            payment_date: new Date().toISOString().split('T')[0],
            sdi_status: 'draft'
        }

        const { data: invoice, error: insertError } = await supabase
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
