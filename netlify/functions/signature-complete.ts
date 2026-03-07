import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { token, signatureImage, signatureImage2, marketingConsent } = JSON.parse(event.body || '{}')

        if (!token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token richiesto' }) }
        }

        const ipAddress = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown'
        const userAgent = event.headers['user-agent'] || 'unknown'

        // Fetch signature request
        const { data: sigRequest, error } = await supabase
            .from('signature_requests')
            .select('*')
            .eq('token', token)
            .single()

        if (error || !sigRequest) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Richiesta di firma non trovata' }) }
        }

        // Validate state
        if (sigRequest.status === 'signed') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Il documento e gia stato firmato' }) }
        }

        if (sigRequest.status !== 'otp_verified') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Verifica OTP richiesta prima della firma' }) }
        }

        if (new Date(sigRequest.token_expires_at) < new Date()) {
            await supabase
                .from('signature_requests')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', sigRequest.id)
            return { statusCode: 410, body: JSON.stringify({ error: 'Il link di firma e scaduto' }) }
        }

        // Fetch original contract
        const { data: contract } = await supabase
            .from('contracts')
            .select('*')
            .eq('id', sigRequest.contract_id)
            .single()

        if (!contract || !contract.pdf_url) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Contratto o PDF non trovato' }) }
        }

        // Download original PDF
        const pdfResponse = await fetch(contract.pdf_url)
        if (!pdfResponse.ok) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Impossibile scaricare il PDF' }) }
        }
        const originalPdfBytes = new Uint8Array(await pdfResponse.arrayBuffer())

        // Verify PDF integrity (hash must match what was stored at init)
        const currentHash = crypto.createHash('sha256').update(Buffer.from(originalPdfBytes)).digest('hex')
        if (sigRequest.original_pdf_hash && currentHash !== sigRequest.original_pdf_hash) {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'integrity_check_failed',
                event_description: 'Hash del PDF non corrisponde. Il documento potrebbe essere stato modificato.',
                ip_address: ipAddress,
                user_agent: userAgent,
                metadata: { expected_hash: sigRequest.original_pdf_hash, actual_hash: currentHash }
            })
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'Il documento e stato modificato dopo la creazione della richiesta di firma. Genera una nuova richiesta.' })
            }
        }

        // Load and modify PDF — add attestation page
        const pdfDoc = await PDFDocument.load(originalPdfBytes)
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

        const signedAt = new Date()
        const signedAtRome = signedAt.toLocaleString('it-IT', { timeZone: 'Europe/Rome' })

        // Embed handwritten signature on the last page of the original contract
        if (signatureImage && signatureImage.startsWith('data:image/png;base64,')) {
            try {
                const base64Data = signatureImage.replace('data:image/png;base64,', '')
                const sigBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
                const sigImage = await pdfDoc.embedPng(sigBytes)

                const pages = pdfDoc.getPages()
                const lastPage = pages[pages.length - 1]
                const { width: pageWidth, height: pageHeight } = lastPage.getSize()

                // Place signature in the "Firma del 1 guidatore" box area
                // Typically the signature boxes are at the bottom of the last page
                // Position: center-right area (second column), near the bottom
                const sigMaxWidth = 160
                const sigMaxHeight = 50
                const sigDims = sigImage.scale(Math.min(sigMaxWidth / sigImage.width, sigMaxHeight / sigImage.height))

                // "Firma del 1 guidatore" box is roughly in the middle third of the page width, near the bottom
                const sigX = pageWidth * 0.35 + (sigMaxWidth - sigDims.width) / 2
                const sigY = 45 // Near the very bottom of the page, inside the signature box

                lastPage.drawImage(sigImage, {
                    x: sigX,
                    y: sigY,
                    width: sigDims.width,
                    height: sigDims.height,
                })

                console.log(`[signature-complete] Handwritten signature 1 embedded at (${sigX}, ${sigY}) size ${sigDims.width}x${sigDims.height}`)
            } catch (sigErr: any) {
                console.error('[signature-complete] Failed to embed signature image:', sigErr.message)
                // Continue without signature image — OTP alone is still valid
            }
        }

        // Embed 2nd driver signature if provided
        if (signatureImage2 && signatureImage2.startsWith('data:image/png;base64,')) {
            try {
                const base64Data2 = signatureImage2.replace('data:image/png;base64,', '')
                const sigBytes2 = Uint8Array.from(atob(base64Data2), c => c.charCodeAt(0))
                const sigImage2 = await pdfDoc.embedPng(sigBytes2)

                const pages = pdfDoc.getPages()
                const lastPage = pages[pages.length - 1]
                const { width: pageWidth } = lastPage.getSize()

                const sigMaxWidth = 160
                const sigMaxHeight = 50
                const sigDims2 = sigImage2.scale(Math.min(sigMaxWidth / sigImage2.width, sigMaxHeight / sigImage2.height))

                // "Firma del 2 guidatore" box is in the right third of the page
                const sigX2 = pageWidth * 0.67 + (sigMaxWidth - sigDims2.width) / 2
                const sigY2 = 45

                lastPage.drawImage(sigImage2, {
                    x: sigX2,
                    y: sigY2,
                    width: sigDims2.width,
                    height: sigDims2.height,
                })

                console.log(`[signature-complete] Handwritten signature 2 embedded at (${sigX2}, ${sigY2})`)
            } catch (sigErr: any) {
                console.error('[signature-complete] Failed to embed 2nd driver signature:', sigErr.message)
            }
        }

        // Add attestation page
        const page = pdfDoc.addPage([595.28, 841.89]) // A4
        const { width, height } = page.getSize()

        const black = rgb(0, 0, 0)
        const gray = rgb(0.4, 0.4, 0.4)
        const gold = rgb(0.83, 0.69, 0.22) // DR7 gold
        const lightGray = rgb(0.95, 0.95, 0.95)

        let y = height - 60

        // Header
        page.drawText('ATTESTAZIONE DI FIRMA ELETTRONICA', {
            x: 50, y, size: 18, font: fontBold, color: black
        })
        y -= 8
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 2, color: gold })
        y -= 30

        // Document info section
        page.drawRectangle({ x: 45, y: y - 100, width: width - 90, height: 110, color: lightGray, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 })

        page.drawText('INFORMAZIONI DOCUMENTO', { x: 55, y, size: 10, font: fontBold, color: gray })
        y -= 20

        const infoLines = [
            ['Contratto:', contract.contract_number || 'N/A'],
            ['Cliente:', sigRequest.signer_name],
            ['Email:', sigRequest.signer_email],
            ['Data firma:', signedAtRome],
        ]

        for (const [label, value] of infoLines) {
            page.drawText(label, { x: 55, y, size: 10, font: fontBold, color: black })
            page.drawText(value, { x: 170, y, size: 10, font, color: black })
            y -= 18
        }
        y -= 25

        // Signature verification section
        page.drawRectangle({ x: 45, y: y - 120, width: width - 90, height: 130, color: lightGray, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 })

        page.drawText('VERIFICA FIRMA', { x: 55, y, size: 10, font: fontBold, color: gray })
        y -= 20

        const verifyLines = [
            ['Metodo:', signatureImage ? 'Firma Elettronica Avanzata via OTP Email + Firma Autografa' : 'Firma Elettronica Avanzata via OTP Email'],
            ['Email OTP:', sigRequest.signer_email],
            ['IP firmatario:', ipAddress],
            ['User Agent:', (userAgent || '').substring(0, 70)],
            ['Hash SHA-256:', currentHash.substring(0, 32) + '...'],
        ]

        for (const [label, value] of verifyLines) {
            page.drawText(label, { x: 55, y, size: 9, font: fontBold, color: black })
            page.drawText(value, { x: 170, y, size: 9, font, color: black })
            y -= 18
        }
        y -= 30

        // Legal text
        page.drawText('DICHIARAZIONE', { x: 55, y, size: 10, font: fontBold, color: gray })
        y -= 18

        const legalLines = [
            `Il sottoscritto ${sigRequest.signer_name} dichiara di aver preso visione del`,
            `contratto sopra indicato e di approvarne integralmente il contenuto.`,
            ``,
            `La firma e stata apposta tramite verifica dell'identita via codice OTP`,
            `inviato all'indirizzo email ${sigRequest.signer_email}, in conformita`,
            `con il Regolamento eIDAS (UE) n. 910/2014 e il CAD (D.Lgs. 82/2005).`,
            ``,
            `Il presente documento e stato firmato elettronicamente e qualsiasi`,
            `modifica successiva ne invalida l'autenticita. L'integrita del`,
            `documento e garantita dall'hash SHA-256 sopra riportato.`,
        ]

        for (const line of legalLines) {
            page.drawText(line, { x: 55, y, size: 10, font, color: black })
            y -= 16
        }
        y -= 25

        // Hash box
        page.drawRectangle({ x: 45, y: y - 35, width: width - 90, height: 45, color: rgb(0.98, 0.96, 0.88), borderColor: gold, borderWidth: 1 })
        page.drawText('HASH SHA-256 DOCUMENTO ORIGINALE', { x: 55, y, size: 8, font: fontBold, color: gray })
        y -= 15
        page.drawText(currentHash, { x: 55, y, size: 8, font, color: black })
        y -= 40

        // Footer
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) })
        y -= 15
        page.drawText('Dubai rent 7.0 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927', {
            x: 55, y, size: 8, font, color: gray
        })
        y -= 12
        page.drawText(`Documento generato automaticamente il ${signedAtRome} - Non modificabile`, {
            x: 55, y, size: 8, font, color: gray
        })

        // Serialize final PDF
        const signedPdfBytes = await pdfDoc.save()
        const signedPdfHash = crypto.createHash('sha256').update(Buffer.from(signedPdfBytes)).digest('hex')

        // Upload signed PDF to Supabase storage
        const fileName = `signed/${contract.contract_number || sigRequest.contract_id}_firmato_${Date.now()}.pdf`
        const { error: uploadError } = await supabase
            .storage
            .from('contracts')
            .upload(fileName, signedPdfBytes, {
                contentType: 'application/pdf',
                upsert: false
            })

        if (uploadError) {
            throw new Error(`Upload failed: ${uploadError.message}`)
        }

        const { data: publicUrl } = supabase.storage.from('contracts').getPublicUrl(fileName)
        const signedPdfUrl = publicUrl.publicUrl

        // Update signature request as signed
        await supabase
            .from('signature_requests')
            .update({
                status: 'signed',
                signed_pdf_url: signedPdfUrl,
                signed_pdf_hash: signedPdfHash,
                signer_ip: ipAddress,
                signer_user_agent: userAgent,
                signed_at: signedAt.toISOString(),
                updated_at: signedAt.toISOString()
            })
            .eq('id', sigRequest.id)

        // Update contract record
        await supabase
            .from('contracts')
            .update({
                signed_pdf_url: signedPdfUrl,
                updated_at: signedAt.toISOString()
            })
            .eq('id', sigRequest.contract_id)

        // Log final audit event
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'document_signed',
            event_description: `Documento firmato da ${sigRequest.signer_name} (${sigRequest.signer_email})`,
            ip_address: ipAddress,
            user_agent: userAgent,
            metadata: {
                signed_at: signedAt.toISOString(),
                signed_at_rome: signedAtRome,
                original_pdf_hash: currentHash,
                signed_pdf_hash: signedPdfHash,
                signed_pdf_url: signedPdfUrl,
                contract_number: contract.contract_number,
                marketing_consent: !!marketingConsent
            }
        })

        // Save marketing consent on customer record if provided
        if (marketingConsent !== undefined && contract.booking_id) {
            try {
                const { data: booking } = await supabase
                    .from('bookings')
                    .select('customer_email, booking_details')
                    .eq('id', contract.booking_id)
                    .single()

                const customerEmail = booking?.customer_email || booking?.booking_details?.customer?.email
                if (customerEmail) {
                    await supabase
                        .from('customers_extended')
                        .update({
                            marketing_consent: !!marketingConsent,
                            marketing_consent_date: signedAt.toISOString()
                        })
                        .eq('email', customerEmail)
                    console.log(`[signature-complete] Marketing consent (${marketingConsent}) saved for ${customerEmail}`)
                }
            } catch (mcErr: any) {
                console.error('[signature-complete] Failed to save marketing consent:', mcErr.message)
            }
        }

        // Send signed contract via WhatsApp
        const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
        const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
        if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN && signedPdfUrl) {
            try {
                const { data: booking } = await supabase
                    .from('bookings')
                    .select('customer_phone, booking_details')
                    .eq('id', contract.booking_id)
                    .single()

                const customerPhone = booking?.customer_phone || booking?.booking_details?.customer?.phone || ''
                if (customerPhone) {
                    let cleanPhone = customerPhone.replace(/[\s\-\+\(\)]/g, '')
                    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
                    if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

                    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`
                    const waResponse = await fetch(greenApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${cleanPhone}@c.us`,
                            urlFile: signedPdfUrl,
                            fileName: `Contratto_Firmato_${contract.contract_number || ''}.pdf`,
                            caption: `Contratto ${contract.contract_number || ''} firmato - DR7 Empire`
                        })
                    })

                    const waResult = await waResponse.json()
                    if (waResponse.ok && !waResult.error) {
                        console.log('[signature-complete] Signed contract sent via WhatsApp:', waResult.idMessage)
                    } else {
                        console.error('[signature-complete] WhatsApp send failed:', waResult)
                    }
                } else {
                    console.log('[signature-complete] No customer phone — skipping WhatsApp send')
                }
            } catch (waErr: any) {
                console.error('[signature-complete] WhatsApp send failed:', waErr.message)
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Documento firmato con successo',
                signedPdfUrl,
                signedAt: signedAtRome
            })
        }
    } catch (error: any) {
        console.error('Error in signature-complete:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nella firma del documento', details: error.message })
        }
    }
}
