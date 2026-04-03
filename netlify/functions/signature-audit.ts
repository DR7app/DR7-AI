import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const params = event.httpMethod === 'GET'
            ? event.queryStringParameters || {}
            : JSON.parse(event.body || '{}')

        const { contractId, requestId, format } = params

        if (!contractId && !requestId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'contractId o requestId richiesto' }) }
        }

        // Find signature request(s)
        let query = supabase
            .from('signature_requests')
            .select('*')

        if (requestId) {
            query = query.eq('id', requestId)
        } else {
            query = query.eq('contract_id', contractId)
        }

        const { data: sigRequests, error: reqError } = await query.order('created_at', { ascending: false })

        if (reqError || !sigRequests || sigRequests.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Nessuna richiesta di firma trovata' }) }
        }

        // Fetch audit trail for all requests
        const requestIds = sigRequests.map(r => r.id)
        const { data: auditTrail, error: auditError } = await supabase
            .from('signature_audit_trail')
            .select('*')
            .in('signature_request_id', requestIds)
            .order('created_at', { ascending: true })

        if (auditError) {
            throw auditError
        }

        // Fetch contract info
        const { data: contract } = await supabase
            .from('contracts')
            .select('contract_number, customer_name, customer_email, customer_phone, vehicle_name, rental_start_date, rental_end_date, booking_id')
            .eq('id', sigRequests[0].contract_id)
            .single()

        // Fetch customer phone from booking if not on contract
        let customerPhone = contract?.customer_phone || ''
        let customerEmail = contract?.customer_email || ''
        if (contract?.booking_id && (!customerPhone || !customerEmail)) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('customer_phone, customer_email, booking_details')
                .eq('id', contract.booking_id)
                .single()
            if (booking) {
                if (!customerPhone) customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone || ''
                if (!customerEmail) customerEmail = booking.customer_email || booking.booking_details?.customer?.email || ''
            }
        }

        // Build response
        const result = {
            contract: contract || {},
            signatureRequests: sigRequests.map(req => ({
                id: req.id,
                status: req.status,
                signerName: req.signer_name,
                signerEmail: req.signer_email,
                signerIp: req.signer_ip,
                signerUserAgent: req.signer_user_agent,
                originalPdfHash: req.original_pdf_hash,
                signedPdfHash: req.signed_pdf_hash,
                signedPdfUrl: req.signed_pdf_url,
                signedAt: req.signed_at,
                tokenExpiresAt: req.token_expires_at,
                createdAt: req.created_at
            })),
            auditTrail: (auditTrail || []).map(entry => ({
                id: entry.id,
                requestId: entry.signature_request_id,
                eventType: entry.event_type,
                description: entry.event_description,
                ipAddress: entry.ip_address,
                userAgent: entry.user_agent,
                metadata: entry.metadata,
                timestamp: entry.created_at
            }))
        }

        // If format=html, return a printable audit trail document
        if (format === 'html') {
            const latestSigned = sigRequests.find(r => r.status === 'signed')
            const html = generateAuditHTML(result, latestSigned, { customerPhone, customerEmail })
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
                body: html
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        }
    } catch (error: any) {
        console.error('Error in signature-audit:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nel recupero dell\'audit trail', details: error.message })
        }
    }
}

function generateAuditHTML(data: any, signedRequest: any, extra?: { customerPhone?: string; customerEmail?: string }): string {
    const contract = data.contract
    const trail = data.auditTrail

    const eventTypeLabels: Record<string, string> = {
        request_created: 'Richiesta Creata',
        email_sent: 'Email Inviata',
        document_viewed: 'Documento Visualizzato',
        otp_sent: 'OTP Inviato',
        otp_verified: 'OTP Verificato',
        otp_failed: 'OTP Non Valido',
        otp_expired: 'OTP Scaduto',
        otp_max_attempts: 'Max Tentativi OTP',
        integrity_check_failed: 'Verifica Integrita Fallita',
        document_signed: 'Documento Firmato',
    }

    const trailRows = trail.map((entry: any) => `
        <tr>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;white-space:nowrap;">
                ${new Date(entry.timestamp).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
            </td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;">
                <strong>${eventTypeLabels[entry.eventType] || entry.eventType}</strong>
            </td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${entry.description || ''}</td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${entry.ipAddress || ''}</td>
        </tr>
    `).join('')

    return `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Audit Trail - ${contract.contract_number || 'Contratto'}</title>
    <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: system-ui, sans-serif; color: #111; max-width: 210mm; margin: 0 auto; padding: 20px; font-size: 13px; }
        h1 { font-size: 20px; margin-bottom: 5px; }
        .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
        .section { margin-bottom: 20px; }
        .section-title { font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 8px; border-bottom: 2px solid #d4af37; padding-bottom: 4px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .info-item label { display: block; font-size: 10px; text-transform: uppercase; color: #888; }
        .info-item span { font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { text-align: left; padding: 8px; background: #f5f5f5; font-size: 10px; text-transform: uppercase; color: #666; border-bottom: 2px solid #e5e7eb; }
        .hash-box { background: #fffbeb; border: 1px solid #d4af37; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; word-break: break-all; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e5e7eb; text-align: center; color: #999; font-size: 10px; }
        @media print { body { padding: 0; } }
    </style>
</head>
<body>
    <h1>Audit Trail - Firma Elettronica</h1>
    <div class="subtitle">Contratto ${contract.contract_number || 'N/A'} - ${contract.customer_name || 'N/A'}</div>

    <div class="section">
        <div class="section-title">Informazioni Contratto</div>
        <div class="info-grid">
            <div class="info-item"><label>Contratto</label><span>${contract.contract_number || 'N/A'}</span></div>
            <div class="info-item"><label>Cliente</label><span>${contract.customer_name || 'N/A'}</span></div>
            <div class="info-item"><label>Email</label><span>${extra?.customerEmail || contract.customer_email || 'N/A'}</span></div>
            <div class="info-item"><label>Telefono</label><span>${extra?.customerPhone || 'N/A'}</span></div>
            <div class="info-item"><label>Veicolo</label><span>${contract.vehicle_name || 'N/A'}</span></div>
            <div class="info-item"><label>Periodo</label><span>${contract.rental_start_date ? new Date(contract.rental_start_date).toLocaleDateString('it-IT') : 'N/A'} - ${contract.rental_end_date ? new Date(contract.rental_end_date).toLocaleDateString('it-IT') : 'N/A'}</span></div>
        </div>
    </div>

    ${signedRequest ? `
    <div class="section">
        <div class="section-title">Informazioni Firmatario</div>
        <div class="info-grid">
            <div class="info-item"><label>Nome e Cognome</label><span>${signedRequest.signer_name}</span></div>
            <div class="info-item"><label>Email</label><span>${signedRequest.signer_email}</span></div>
            <div class="info-item"><label>Telefono</label><span>${extra?.customerPhone || 'N/A'}</span></div>
            <div class="info-item"><label>Data Firma</label><span>${signedRequest.signed_at ? new Date(signedRequest.signed_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'N/A'}</span></div>
            <div class="info-item"><label>IP</label><span>${signedRequest.signer_ip || 'N/A'}</span></div>
            <div class="info-item"><label>User Agent</label><span style="font-size:10px;word-break:break-all;">${signedRequest.signer_user_agent || 'N/A'}</span></div>
        </div>
    </div>

    ${(() => {
        const signedEvent = trail.find((e: any) => e.eventType === 'document_signed')
        const mc = signedEvent?.metadata?.marketing_consent
        if (mc !== undefined) {
            return `<div class="section">
                <div class="section-title">Consenso Marketing (Trustera)</div>
                <div class="info-grid">
                    <div class="info-item"><label>Consenso</label><span style="color:${mc ? '#16a34a' : '#dc2626'};font-weight:700;">${mc ? 'SI' : 'NO'}</span></div>
                    <div class="info-item"><label>Data</label><span>${signedEvent?.timestamp ? new Date(signedEvent.timestamp).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'N/A'}</span></div>
                </div>
            </div>`
        }
        return ''
    })()}

    <div class="section">
        <div class="section-title">Verifica Integrita</div>
        <div class="hash-box">
            <strong>Hash SHA-256 Documento Originale:</strong><br>${signedRequest.original_pdf_hash || 'N/A'}
        </div>
        <div class="hash-box" style="margin-top:8px;">
            <strong>Hash SHA-256 Documento Firmato:</strong><br>${signedRequest.signed_pdf_hash || 'N/A'}
        </div>
    </div>
    ` : ''}

    <div class="section">
        <div class="section-title">Registro Eventi</div>
        <table>
            <thead>
                <tr>
                    <th>Data/Ora</th>
                    <th>Evento</th>
                    <th>Descrizione</th>
                    <th>IP</th>
                </tr>
            </thead>
            <tbody>${trailRows}</tbody>
        </table>
    </div>

    <div class="footer">
        Dubai rent 7.0 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927<br>
        Documento generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
    </div>
</body>
</html>
    `.trim()
}
