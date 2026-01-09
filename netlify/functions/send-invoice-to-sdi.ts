import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateInvoicetronicPayload } from './invoicetronic-utils'
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

        console.log('[SDI] Sending invoice to Invoicetronic:', {
            invoiceId: invoice.id,
            numero_fattura: invoice.numero_fattura,
            customer: invoice.customer_name,
            endpoint: `${INVOICETRONIC_BASE_URL}/invoices`,
            apiKey: INVOICETRONIC_API_KEY ? `${INVOICETRONIC_API_KEY.substring(0, 10)}...` : 'MISSING',
            payload: JSON.stringify(invoicePayload, null, 2)
        })

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

        console.log('[SDI] Response status:', sdiResponse.status, sdiResponse.statusText)
        console.log('[SDI] Response headers:', Object.fromEntries(sdiResponse.headers.entries()))
        console.log('[SDI] Response body:', responseText)

        if (responseText && responseText.trim()) {
            try {
                responseData = JSON.parse(responseText)
            } catch (parseError) {
                console.error('[SDI] Failed to parse response JSON:', parseError)
                console.error('[SDI] Raw Response:', responseText)
                responseData = { error: 'Invalid JSON response', raw: responseText }
            }
        } else {
            console.log('[SDI] Received empty response from API')
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

        // Success - Update invoice with SDI info
        await supabase
            .from('fatture')
            .update({
                sdi_status: 'sent',
                sdi_id: responseData.id || responseData.uuid,
                sdi_sent_at: new Date().toISOString(),
                sdi_response: responseData
            })
            .eq('id', invoiceId)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Invoice sent to SDI successfully',
                sdi_id: responseData.id || responseData.uuid,
                details: responseData
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
