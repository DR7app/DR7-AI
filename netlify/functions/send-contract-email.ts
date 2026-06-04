import { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import { renderTemplate } from './utils/messageTemplates'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// SMTP configuration - uses info@dr7.app
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.secureserver.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
})

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    try {
        const { bookingId, emailOverride } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            console.error('[send-contract-email] Missing bookingId')
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log('[send-contract-email] Processing email for booking:', bookingId)

        // 1. Fetch Booking
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, contracts(*)')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            console.error('[send-contract-email] Booking not found:', bookingError)
            return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found: ' + bookingError?.message }) }
        }

        const recipientEmail = emailOverride || booking.customer_email || booking.booking_details?.customer?.email
        if (!recipientEmail) {
            console.error('[send-contract-email] No customer email found for booking:', bookingId)
            return { statusCode: 400, body: JSON.stringify({ error: 'No customer email found' }) }
        }

        console.log('[send-contract-email] Recipient email:', recipientEmail)

        // 2. Get PDF URL from contract
        const contractUrl = booking.contract_url || booking.contracts?.[0]?.pdf_url

        if (!contractUrl) {
            console.error('[send-contract-email] Contract PDF not available for booking:', bookingId)
            return { statusCode: 400, body: JSON.stringify({ error: 'Contract PDF not available. Please generate it first.' }) }
        }

        console.log('[send-contract-email] Contract URL:', contractUrl)

        // 3. Download PDF content to attach
        let pdfBuffer: Buffer | undefined

        try {
            console.log('[send-contract-email] Downloading PDF from:', contractUrl)
            const response = await fetch(contractUrl)
            if (!response.ok) {
                throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            pdfBuffer = Buffer.from(arrayBuffer)
            console.log('[send-contract-email] PDF downloaded, size:', pdfBuffer.length, 'bytes')
        } catch (e: any) {
            console.error('[send-contract-email] Failed to download PDF:', e)
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to retrieve PDF for attachment: ' + e.message }) }
        }

        // 4. Verify SMTP credentials
        const smtpUser = process.env.SMTP_USER
        const smtpPass = process.env.SMTP_PASSWORD

        if (!smtpUser || !smtpPass) {
            console.error('[send-contract-email] Missing SMTP credentials')
            console.error('[send-contract-email] SMTP_USER:', smtpUser ? 'SET' : 'NOT SET')
            console.error('[send-contract-email] SMTP_PASSWORD:', smtpPass ? 'SET' : 'NOT SET')
            return { statusCode: 500, body: JSON.stringify({ error: 'SMTP credentials not configured. Please set SMTP_USER and SMTP_PASSWORD in Netlify environment variables.' }) }
        }

        console.log('[send-contract-email] SMTP user configured:', smtpUser)

        // 5. Send Email
        // 2026-05-19: body+subject letti da Messaggi di Sistema Pro
        // (chiave: pro_email_contratto). Niente piu' hardcoded.
        const customerName = booking.customer_name
            || booking.booking_details?.customer?.fullName
            || 'Cliente'
        const templateVars = {
            customer_name: customerName,
            nome: customerName,
            vehicle_name: booking.vehicle_name || '',
            booking_id: String(booking.id || '').substring(0, 8).toUpperCase(),
        }
        const bodyText = await renderTemplate('pro_email_contratto', templateVars)
        const subjectFromTpl = await renderTemplate('pro_email_contratto_subject', templateVars)
        if (!bodyText) {
            console.error('[send-contract-email] template pro_email_contratto mancante')
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'Template "pro_email_contratto" non configurato in Messaggi di Sistema Pro',
                }),
            }
        }
        const mailOptions = {
            from: '"DR7" <info@dr7.app>',
            to: recipientEmail,
            subject: subjectFromTpl || `Contratto Noleggio DR7 — ${booking.vehicle_name}`,
            text: bodyText,
            attachments: [
                {
                    filename: `Contratto_${booking.vehicle_name.replace(/\s+/g, '_')}.pdf`,
                    content: pdfBuffer
                }
            ]
        }

        console.log('[send-contract-email] Sending email to:', recipientEmail)
        await transporter.sendMail(mailOptions)
        console.log('[send-contract-email] Email sent successfully')

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Email sent successfully' })
        }

    } catch (error: any) {
        console.error('[send-contract-email] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Unknown error occurred',
                details: error.toString()
            })
        }
    }
}
