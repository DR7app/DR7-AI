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
        const { token } = JSON.parse(event.body || '{}')

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
            ['Metodo:', 'Firma Elettronica Avanzata via OTP Email'],
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
                contract_number: contract.contract_number
            }
        })

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
