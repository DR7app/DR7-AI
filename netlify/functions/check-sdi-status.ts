import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Invoicetronic Configuration
const INVOICETRONIC_API_KEY = process.env.INVOICETRONIC_API_KEY || 'ik_test_34pBxEz0zsb2qPP1w5I6NBnT7GZi8i5R'
const INVOICETRONIC_BASE_URL = process.env.INVOICETRONIC_BASE_URL || 'https://api.invoicetronic.com/v1'

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invoice ID is required' }) }
        }

        // Fetch invoice
        const { data: invoice, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !invoice) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) }
        }

        if (!invoice.sdi_id) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invoice has not been sent to Invoicetronic yet' }) }
        }

        // Check status from Invoicetronic API
        const response = await fetch(`${INVOICETRONIC_BASE_URL}/invoices/${invoice.sdi_id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${Buffer.from(INVOICETRONIC_API_KEY + ':').toString('base64')}`
            }
        })

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({
                    error: 'Failed to check invoice status from Invoicetronic',
                    details: await response.text()
                })
            }
        }

        const remoteInvoice = await response.json()

        // Map Invoicetronic status to our internal status
        // Invoicetronic statuses: Draft, Sent, Rejected, Delivered, etc.
        let sdiStatus = 'sent'
        const remoteStatus = (remoteInvoice.status || '').toLowerCase()

        if (remoteStatus.includes('delivered') || remoteStatus.includes('accettat')) {
            sdiStatus = 'accepted'
        } else if (remoteStatus.includes('rejected') || remoteStatus.includes('scartat') || remoteStatus.includes('rifiutat')) {
            sdiStatus = 'rejected'
        } else if (remoteStatus.includes('error') || remoteStatus.includes('failed')) {
            sdiStatus = 'error'
        }

        // Update DB
        await supabase
            .from('fatture')
            .update({
                sdi_status: sdiStatus,
                sdi_response: remoteInvoice
            })
            .eq('id', invoiceId)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                status: sdiStatus,
                details: remoteInvoice
            })
        }

    } catch (error: any) {
        console.error('Error checking Invoicetronic status:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
