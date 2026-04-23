import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
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
            .select('id, contract_id, signer_name, signer_email, status, token_expires_at, signed_pdf_url, signed_at, document_url, document_name')
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

        // Reject superseded/cancelled requests so the customer cannot sign a
        // pre-modification contract version.
        if (sigRequest.status === 'superseded' || sigRequest.status === 'cancelled') {
            return {
                statusCode: 410,
                body: JSON.stringify({
                    error: 'Questo link di firma non e piu valido — e stato generato un nuovo contratto. Attendi il nuovo link.',
                    status: sigRequest.status,
                })
            }
        }

        // Fetch contract for PDF URL and details (only if contract_id exists)
        let contract: any = null
        let secondDriverName: string | null = null
        let existingMarketingConsent: boolean | null = null

        if (sigRequest.contract_id) {
            const { data: contractData } = await supabase
                .from('contracts')
                .select('contract_number, pdf_url, customer_name, vehicle_name, rental_start_date, rental_end_date, booking_id')
                .eq('id', sigRequest.contract_id)
                .single()
            contract = contractData

            // Check if booking has a second driver, and fetch existing marketing consent
            if (contract?.booking_id) {
                const { data: booking } = await supabase
                    .from('bookings')
                    .select('booking_details, customer_email')
                    .eq('id', contract.booking_id)
                    .single()

                if (booking?.booking_details?.second_driver) {
                    const sd = booking.booking_details.second_driver
                    secondDriverName = sd.fullName || sd.full_name || sd.name ||
                        [sd.nome, sd.cognome].filter(Boolean).join(' ') || null
                }

                // Look up existing marketing consent from customers_extended
                const customerEmail = booking?.customer_email || booking?.booking_details?.customer?.email
                if (customerEmail) {
                    const { data: extCustomer } = await supabase
                        .from('customers_extended')
                        .select('marketing_consent')
                        .ilike('email', customerEmail)
                        .maybeSingle()

                    if (extCustomer) {
                        existingMarketingConsent = extCustomer.marketing_consent ?? null
                    }
                }
            }
        }

        // Fallback: always try signer_email if consent still unknown
        if (existingMarketingConsent === null && sigRequest.signer_email) {
            const { data: extCustomer } = await supabase
                .from('customers_extended')
                .select('marketing_consent')
                .ilike('email', sigRequest.signer_email)
                .maybeSingle()
            if (extCustomer) {
                existingMarketingConsent = extCustomer.marketing_consent ?? null
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
                existingMarketingConsent,
                contract: contract ? {
                    contractNumber: contract.contract_number,
                    pdfUrl: contract.pdf_url,
                    customerName: contract.customer_name,
                    vehicleName: contract.vehicle_name,
                    rentalStartDate: contract.rental_start_date,
                    rentalEndDate: contract.rental_end_date
                } : sigRequest.document_url ? {
                    contractNumber: sigRequest.document_name || 'Documento',
                    pdfUrl: sigRequest.document_url,
                    customerName: sigRequest.signer_name,
                    vehicleName: null,
                    rentalStartDate: null,
                    rentalEndDate: null
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
