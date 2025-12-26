import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Fattura Elettronica API credentials
const FATTURA_API_USERNAME = process.env.FATTURA_API_USERNAME || ''
const FATTURA_API_PASSWORD = process.env.FATTURA_API_PASSWORD || ''
const FATTURA_API_BASE_URL = process.env.FATTURA_API_BASE_URL || 'https://fattura-elettronica-api.it/ws2.0/test'

export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invoice ID is required' })
            }
        }

        // Fetch invoice from database
        const { data: invoice, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !invoice) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Invoice not found' })
            }
        }

        if (!invoice.sdi_id) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invoice has not been sent to SDI yet' })
            }
        }

        // Check status from Fattura Elettronica API
        const authString = Buffer.from(`${FATTURA_API_USERNAME}:${FATTURA_API_PASSWORD}`).toString('base64')

        const response = await fetch(`${FATTURA_API_BASE_URL}/fatture/${invoice.sdi_id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authString}`
            }
        })

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({
                    error: 'Failed to check invoice status',
                    details: await response.text()
                })
            }
        }

        const statusData = await response.json()

        // Map API status to our status
        let sdiStatus = 'sent'
        if (statusData.Stato === 'Accettata' || statusData.status === 'accepted') {
            sdiStatus = 'accepted'
        } else if (statusData.Stato === 'Rifiutata' || statusData.status === 'rejected') {
            sdiStatus = 'rejected'
        }

        // Update invoice with latest status
        await supabase
            .from('fatture')
            .update({
                sdi_status: sdiStatus,
                sdi_response: statusData
            })
            .eq('id', invoiceId)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                status: sdiStatus,
                details: statusData
            })
        }
    } catch (error: any) {
        console.error('Error checking SDI status:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}
