import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { token } = JSON.parse(event.body || '{}')

        if (!token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token richiesto' }) }
        }

        // Fetch signature request
        const { data: sigRequest, error } = await supabase
            .from('signature_requests')
            .select('id, contract_id, signer_name, signer_email, status, token_expires_at, signed_pdf_url, signed_at')
            .eq('token', token)
            .single()

        if (error || !sigRequest) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Richiesta di firma non trovata' }) }
        }

        // Check expiry
        if (new Date(sigRequest.token_expires_at) < new Date() && sigRequest.status !== 'signed') {
            await supabase
                .from('signature_requests')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', sigRequest.id)
            return { statusCode: 410, body: JSON.stringify({ error: 'Il link di firma e scaduto', status: 'expired' }) }
        }

        // Fetch contract for PDF URL and details
        const { data: contract } = await supabase
            .from('contracts')
            .select('contract_number, pdf_url, customer_name, vehicle_name, rental_start_date, rental_end_date, booking_id')
            .eq('id', sigRequest.contract_id)
            .single()

        // Check if booking has a second driver
        let secondDriverName: string | null = null
        if (contract?.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('booking_details')
                .eq('id', contract.booking_id)
                .single()

            if (booking?.booking_details?.second_driver) {
                const sd = booking.booking_details.second_driver
                secondDriverName = sd.fullName || sd.full_name || sd.name ||
                    [sd.nome, sd.cognome].filter(Boolean).join(' ') || null
            }
        }

        // Log document view
        if (sigRequest.status !== 'signed') {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'document_viewed',
                event_description: `Documento visualizzato da ${sigRequest.signer_name}`,
                ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
                user_agent: event.headers['user-agent'] || 'unknown'
            })
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: sigRequest.status,
                signerName: sigRequest.signer_name,
                signerEmail: sigRequest.signer_email,
                signedPdfUrl: sigRequest.signed_pdf_url,
                signedAt: sigRequest.signed_at,
                secondDriverName,
                contract: contract ? {
                    contractNumber: contract.contract_number,
                    pdfUrl: contract.pdf_url,
                    customerName: contract.customer_name,
                    vehicleName: contract.vehicle_name,
                    rentalStartDate: contract.rental_start_date,
                    rentalEndDate: contract.rental_end_date
                } : null
            })
        }
    } catch (error: any) {
        console.error('Error in signature-get:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nel recupero dei dati', details: error.message })
        }
    }
}
