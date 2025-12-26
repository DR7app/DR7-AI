import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Webhook handler for Supabase Database Webhooks
 * Automatically generates invoice when booking status changes to 'completed'
 */
export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const payload = JSON.parse(event.body || '{}')

        // Supabase webhook sends: { type: 'UPDATE', table: 'bookings', record: {...}, old_record: {...} }
        const { type, record, old_record } = payload

        // Only process UPDATE events
        if (type !== 'UPDATE') {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Ignored - not an UPDATE event' })
            }
        }

        // Check if status changed to 'completed'
        const statusChanged = old_record?.status !== record?.status
        const isCompleted = record?.status === 'completed'

        if (!statusChanged || !isCompleted) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Ignored - status not changed to completed' })
            }
        }

        // Check if invoice already exists
        const { data: existingInvoice } = await supabase
            .from('fatture')
            .select('id')
            .eq('booking_id', record.id)
            .single()

        if (existingInvoice) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Invoice already exists for this booking' })
            }
        }

        // Generate invoice by calling our existing function
        const generateResponse = await fetch(`${event.headers.origin || 'https://dr7empire.com'}/.netlify/functions/generate-invoice-from-booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: record.id })
        })

        const generateResult = await generateResponse.json()

        if (!generateResponse.ok) {
            throw new Error(generateResult.error || 'Failed to generate invoice')
        }

        // Automatically send to SDI
        const sdiResponse = await fetch(`${event.headers.origin || 'https://dr7empire.com'}/.netlify/functions/send-invoice-to-sdi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: generateResult.invoice.id })
        })

        const sdiResult = await sdiResponse.json()

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Invoice generated and sent to SDI automatically',
                invoice: generateResult.invoice,
                sdi: sdiResult
            })
        }
    } catch (error: any) {
        console.error('Error in auto-invoice webhook:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}
