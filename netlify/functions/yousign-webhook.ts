import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
// import fetch from 'node-fetch' // Using native fetch in Node 18+

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const YOUSIGN_API_KEY = process.env.YOUSIGN_API_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const payload = JSON.parse(event.body || '{}')
        const eventName = payload.eventName
        const data = payload.data

        if (!eventName || !data) {
            return { statusCode: 400, body: 'Invalid Payload' }
        }

        console.log(`[yousign-webhook] Received event: ${eventName}`)
        console.log(`[yousign-webhook] Signature Request ID: ${data.id}`)

        // Only handle specific events
        // Relevant events:
        // signature_request.ongoing
        // signature_request.done
        // signature_request.declined
        // signer.done (contracts/documents signed by one signer)

        let status = 'draft'
        const signatureRequestId = data.id || data.signature_request_id // signer.done has signature_request_id

        if (eventName === 'signature_request.ongoing') {
            status = 'ongoing'
        } else if (eventName === 'signature_request.done') {
            status = 'signed'
        } else if (eventName === 'signature_request.declined') {
            status = 'declined'
        } else {
            // Ignore other events for now (like signer.done unless we want partial updates)
            console.log(`[yousign-webhook] Ignoring event ${eventName}`)
            return { statusCode: 200, body: 'Event Ignored' }
        }

        // 1. Update Status in DB
        // We use the signatureRequestId to identify the contract
        // Note: data.id comes from signature_request events.

        let contractId: string | null = null

        // Find contract
        const { data: contract, error: findError } = await supabase
            .from('contracts')
            .select('id, contract_number, yousign_status')
            .eq('yousign_signature_request_id', signatureRequestId)
            .single()

        if (findError || !contract) {
            console.error('[yousign-webhook] Contract not found for request ID:', signatureRequestId)
            return { statusCode: 404, body: 'Contract not found' }
        }

        contractId = contract.id
        console.log(`[yousign-webhook] Updating contract ${contract.contract_number} to status: ${status}`)

        const updateData: any = { yousign_status: status }

        // 2. If Signed, Download PDF
        if (status === 'signed') {
            try {
                // Fetch the signature request details to get the documents
                // or use the list of documents provided in the webhook payload if available.
                // It's safer to fetch fresh data.

                // Ensure Base URL is correct
                let baseUrl = process.env.YOUSIGN_API_BASE_URL || 'https://api-sandbox.yousign.app/v3'
                baseUrl = baseUrl.replace(/\/$/, '')
                if (!baseUrl.endsWith('/v3')) {
                    baseUrl += '/v3'
                }

                const detailsRes = await fetch(`${baseUrl}/signature_requests/${signatureRequestId}/documents`, {
                    headers: { 'Authorization': `Bearer ${YOUSIGN_API_KEY}` }
                })

                if (detailsRes.ok) {
                    const documents = await detailsRes.json()
                    // Assume the first signable document is the contract
                    const signableDoc = documents.find((d: any) => d.nature === 'signable_document')

                    if (signableDoc) {
                        const documentId = signableDoc.id
                        console.log(`[yousign-webhook] Downloading Signed PDF (Doc ID: ${documentId})...`)

                        // Download PDF
                        const downloadRes = await fetch(`${baseUrl}/documents/${documentId}/download`, {
                            headers: { 'Authorization': `Bearer ${YOUSIGN_API_KEY}` }
                        })

                        if (downloadRes.ok) {
                            const pdfArrayBuffer = await downloadRes.arrayBuffer()
                            const pdfBuffer = Buffer.from(pdfArrayBuffer)

                            // Upload to Supabase
                            const fileName = `signed/${contract.contract_number}_signed_${Date.now()}.pdf`
                            console.log(`[yousign-webhook] Uploading to Supabase: ${fileName}`)

                            const { error: uploadError } = await supabase.storage
                                .from('contracts')
                                .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })

                            if (!uploadError) {
                                // Get Public URL
                                const { data: { publicUrl } } = supabase.storage
                                    .from('contracts')
                                    .getPublicUrl(fileName)

                                updateData.signed_pdf_url = publicUrl
                                console.log(`[yousign-webhook] Signed PDF saved: ${publicUrl}`)
                            } else {
                                console.error('[yousign-webhook] Storage Upload Error:', uploadError)
                            }
                        } else {
                            console.error('[yousign-webhook] PDF Download Failed:', downloadRes.statusText)
                        }
                    }
                }

            } catch (err) {
                console.error('[yousign-webhook] Error processing signed PDF:', err)
            }
        }

        // Apply Update
        const { error: updateError } = await supabase
            .from('contracts')
            .update(updateData)
            .eq('id', contractId)

        if (updateError) {
            console.error('[yousign-webhook] DB Update Failed:', updateError)
            return { statusCode: 500, body: 'DB Update Failed' }
        }

        return { statusCode: 200, body: 'OK' }

    } catch (error: any) {
        console.error('[yousign-webhook] Unexpected Error:', error)
        return { statusCode: 500, body: error.message }
    }
}
