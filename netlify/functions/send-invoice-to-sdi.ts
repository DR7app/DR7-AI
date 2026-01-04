import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Invoicetronic SDI Configuration
const INVOICETRONIC_API_KEY = process.env.INVOICETRONIC_API_KEY || 'ik_test_34pBxEz0zsb2qPP1w5I6NBnT7GZi8i5R'
const INVOICETRONIC_BASE_URL = process.env.INVOICETRONIC_BASE_URL || 'https://api.invoicetronic.com/v1'

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

        // Generate XML Content (We assume XML is either stored or we generate it on the fly)
        // Note: The previous implementation was generating JSON for "Fattura Elettronica API", but Invoicetronic takes XML or JSON.
        // If we want consistency with the main generator, we should ideally use the XML generator if available.
        // However, Invoicetronic also builds XML from JSON payload if sent to /send/json endpoint.
        // Let's stick to the JSON payload since that's what we have logic for here, but send to Invoicetronic.

        const invoicePayload = generateInvoicetronicPayload(invoice)

        // Send to Invoicetronic SDI
        const sdiResponse = await fetch(`${INVOICETRONIC_BASE_URL}/invoices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(INVOICETRONIC_API_KEY + ':').toString('base64')}`
            },
            body: JSON.stringify(invoicePayload)
        })

        const responseText = await sdiResponse.text()
        let responseData: any = {}

        if (responseText && responseText.trim()) {
            try {
                responseData = JSON.parse(responseText)
            } catch (parseError) {
                console.error('[SDI] Failed to parse response JSON:', parseError)
                responseData = { error: 'Invalid JSON response', raw: responseText }
            }
        }

        if (!sdiResponse.ok) {
            // Update status to 'error'
            await supabase
                .from('fatture')
                .update({
                    sdi_status: 'error',
                    sdi_response: responseData
                })
                .eq('id', invoiceId)

            return {
                statusCode: sdiResponse.status,
                body: JSON.stringify({
                    error: 'Failed to send invoice to Invoicetronic',
                    details: responseData
                })
            }
        }

        // Update invoice with SDI response
        await supabase
            .from('fatture')
            .update({
                sdi_status: 'sent',
                sdi_id: responseData.id,
                sdi_sent_at: new Date().toISOString(),
                sdi_response: responseData
                // xml_fattura_pa: ... we don't have the XML here unless we generate it
            })
            .eq('id', invoiceId)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Invoice sent to Invoicetronic successfully',
                sdi_id: responseData.id,
                response: responseData
            })
        }
    } catch (error: any) {
        console.error('Error sending invoice to SDI:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}

function generateInvoicetronicPayload(invoice: any) {
    // Basic mapping to Invoicetronic JSON model
    // This is a simplified version. Ideally we should use the same XML generation logic as the other function.
    // But for now, let's map what we have.

    return {
        // Invoicetronic specific fields if needed
        external_id: invoice.id,
        print_template: true, // Auto-generate PDF

        // FatturaPA core data
        header: {
            date: invoice.data_emissione, // YYYY-MM-DD
            number: invoice.numero_fattura,
            currency: 'EUR'
        },
        company: {
            vat: invoice.customer_vat || '',
            fiscal_code: invoice.customer_tax_code || '',
            name: invoice.customer_name,
            address: {
                street: invoice.customer_address || '',
                city: '', // would need parsing
                province: '',
                zip: '',
                country: 'IT'
            }
        },
        items: (invoice.items || []).map((item: any) => ({
            name: item.description,
            price: item.unit_price,
            quantity: item.quantity,
            vat: item.vat_rate
        }))
    }
}
