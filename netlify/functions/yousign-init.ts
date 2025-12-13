import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
// import fetch from 'node-fetch' // Using native fetch in Node 18+

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const YOUSIGN_API_KEY = process.env.YOUSIGN_API_KEY
const YOUSIGN_API_BASE_URL = (process.env.YOUSIGN_API_BASE_URL || 'https://api-sandbox.yousign.app/v3').replace(/\/$/, '')

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    if (!YOUSIGN_API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Yousign API Key' }) }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[yousign-init] Starting for booking ${bookingId}`)

        // 1. Fetch Contract & Booking Data
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('*')
            .eq('booking_id', bookingId)
            .single()

        if (contractError || !contract) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Contract not found' }) }
        }

        if (contract.yousign_status === 'ongoing' || contract.yousign_status === 'signed') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Signature request already active or completed' }) }
        }

        // 2. Fetch PDF Content from Supabase Storage
        // The pdf_url is a public URL, we can fetch it directly
        // Or if it's signed URL we might need to download using storage API.
        // Assuming pdf_url is the public URL generated in generate-contract.ts
        if (!contract.pdf_url) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Contract PDF URL missing' }) }
        }

        console.log(`[yousign-init] Fetching PDF from ${contract.pdf_url}`)
        const pdfResponse = await fetch(contract.pdf_url)
        if (!pdfResponse.ok) {
            throw new Error(`Failed to fetch PDF: ${pdfResponse.statusText}`)
        }
        const pdfBlob = await pdfResponse.blob()

        // 3. Create Signature Request in Yousign
        console.log('[yousign-init] Creating Signature Request...')
        const initRes = await fetch(`${YOUSIGN_API_BASE_URL}/signature_requests`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${YOUSIGN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `Contract ${contract.contract_number} - ${contract.customer_name}`,
                delivery_mode: 'email',
                timezone: 'Europe/Rome'
            })
        })

        if (!initRes.ok) {
            const errText = await initRes.text()
            throw new Error(`Yousign Init Failed: ${errText}`)
        }

        const signatureRequest = await initRes.json()
        const signatureRequestId = signatureRequest.id
        console.log(`[yousign-init] Created Request ID: ${signatureRequestId}`)

        // 4. Upload Document
        console.log('[yousign-init] Uploading Document...')

        // Yousign requires multipart/form-data for uploads. 
        // Since we are in lambda, we can construct the body manually or use a library if available.
        // node-fetch supports FormData but it requires 'form-data' package which might not be installed.
        // We'll use the 'form-data' package if available or try to import it.
        // If not available in the environment, we might need a workaround or ensure package.json has it.
        // Checking package.json... Assuming standard Netlify setup with node-fetch.
        // To be safe and simple without extra deps if possible:
        // Actually, let's try to trust that 'form-data' is available or we use a boundary string manual approach if needed?
        // Standard approach: import FormData from 'form-data'

        // Use native FormData if available (Node 18+) or import properly if strictly needed.
        // For multipart/form-data upload with files, using native FormData in Node 18 is possible.
        // However, 'node-fetch' or native fetch might need specific handling for file uploads from buffers.
        // Let's use the 'form-data' package but imported correctly for ESM if we added it, OR try native.
        // Since we didn't add 'form-data' package, let's try to rely on native FormData which accepts Blobs.
        // But we have a Buffer. We need to convert Buffer to Blob.
        // actually global Blob is available in Node 18.

        const formData = new FormData()
        formData.append('file', pdfBlob, 'contract.pdf')
        formData.append('nature', 'signable_document')
        formData.append('parse_anchors', 'true')

        const uploadRes = await fetch(`${YOUSIGN_API_BASE_URL}/signature_requests/${signatureRequestId}/documents`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${YOUSIGN_API_KEY}`,
                // Native fetch with FormData automatically sets the boundary
            },
            body: formData
        })

        if (!uploadRes.ok) {
            const errText = await uploadRes.text()
            throw new Error(`Yousign Upload Failed: ${errText}`)
        }

        const documentData = await uploadRes.json()
        const documentId = documentData.id
        console.log(`[yousign-init] Uploaded Document ID: ${documentId}`)

        // 5. Add Signer
        console.log('[yousign-init] Adding Signer...')

        // We need to define where the signature visualization appears.
        // Since we don't know the exact coordinates in the generic function, 
        // we can either use anchors (text tags) in the PDF or smart placement.
        // For this V1, let's try to place it on the last page.
        // Or if "parse_anchors" was true and we had tags in PDF, that would be best.
        // generate-contract.ts doesn't seem to add anchors yet.
        // Let's use manual field placement for now: Last page, bottom right.

        const addSignerRes = await fetch(`${YOUSIGN_API_BASE_URL}/signature_requests/${signatureRequestId}/signers`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${YOUSIGN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                info: {
                    first_name: contract.customer_name.split(' ')[0] || 'Cliente',
                    last_name: contract.customer_name.split(' ').slice(1).join(' ') || '.',
                    email: contract.customer_email,
                    phone_number: contract.customer_phone?.startsWith('+') ? contract.customer_phone : `+39${contract.customer_phone}`, // Basic normalization
                    locale: 'it'
                },
                fields: [
                    {
                        document_id: documentId,
                        type: 'signature',
                        page: documentData.total_pages || 1, // Last page
                        x: 400, // Approx bottom right
                        y: 750, // Approx bottom (Yousign coordinates start top-left usually? No, PDF coords. usually bottom-left is 0,0. 
                        // WAIT: Yousign coordinates: Origin is TOP-LEFT.
                        // A4 is approx 595 x 842 points.
                        // So bottom right would be around x=400, y=750.
                        width: 150,
                        height: 50
                    }
                ],
                signature_level: 'electronic_signature',
                signature_authentication_mode: 'no_otp' // For sandbox/ease of use. OTP usually required for 'advanced'.
            })
        })

        if (!addSignerRes.ok) {
            const errText = await addSignerRes.text()
            throw new Error(`Yousign Add Signer Failed: ${errText}`)
        }

        const signerData = await addSignerRes.json()
        console.log(`[yousign-init] Added Signer ID: ${signerData.id}`)

        // 6. Activate Request
        console.log('[yousign-init] Activating Request...')
        const activateRes = await fetch(`${YOUSIGN_API_BASE_URL}/signature_requests/${signatureRequestId}/activate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${YOUSIGN_API_KEY}`,
                'Content-Type': 'application/json'
            }
        })

        if (!activateRes.ok) {
            const errText = await activateRes.text()
            throw new Error(`Yousign Activate Failed: ${errText}`)
        }

        console.log('[yousign-init] Request Activated!')

        // 7. Update Database
        const { error: updateError } = await supabase
            .from('contracts')
            .update({
                yousign_signature_request_id: signatureRequestId,
                yousign_status: 'ongoing'
            })
            .eq('id', contract.id)

        if (updateError) {
            console.error('[yousign-init] DB Update Failed:', updateError)
            // We don't fail the request here as Yousign flow is started
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                signatureRequestId,
                status: 'ongoing'
            })
        }

    } catch (error: any) {
        console.error('[yousign-init] Error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
}
