import { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.GMAIL_USER || process.env.SMTP_USER,
        pass: process.env.GMAIL_PASS || process.env.SMTP_PASS,
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

        const recipientEmail = emailOverride || booking.customer_email
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
        const smtpUser = process.env.GMAIL_USER || process.env.SMTP_USER
        const smtpPass = process.env.GMAIL_PASS || process.env.SMTP_PASS

        if (!smtpUser || !smtpPass) {
            console.error('[send-contract-email] Missing SMTP credentials')
            return { statusCode: 500, body: JSON.stringify({ error: 'SMTP credentials not configured' }) }
        }

        console.log('[send-contract-email] SMTP user configured:', smtpUser)

        // 5. Send Email
        const mailOptions = {
            from: `"DR7 Empire" <${smtpUser}>`,
            to: recipientEmail,
            subject: `Contratto Noleggio DR7 - ${booking.vehicle_name}`,
            text: `Gentile ${booking.customer_name},\n\nIn allegato trovi il contratto di noleggio per il veicolo ${booking.vehicle_name}.\n\nGrazie per aver scelto DR7 Empire.\n\nCordiali saluti,\nDR7 Empire Team`,
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
