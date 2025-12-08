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
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { bookingId, emailOverride } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        // 1. Fetch Booking
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, contracts(*)')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) }
        }

        const recipientEmail = emailOverride || booking.customer_email
        if (!recipientEmail) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No customer email found' }) }
        }

        // 2. Get PDF URL from contract or generate logic? 
        // Usually contract is already generated. Let's get the URL from the contract record.
        const contractUrl = booking.contract_url || booking.contracts?.[0]?.pdf_url

        if (!contractUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Contract PDF not available. Please generate it first.' }) }
        }

        // 3. Download PDF content to attach
        // contractUrl might be a signed URL or public URL.
        // Ideally we download it from storage to attach it pure bytes.
        // Parse filename from URL or contract record.
        let pdfBuffer: Buffer | undefined

        try {
            // If we have the storage path in contracts table, better.
            // But let's try to fetch the URL directly if public
            const response = await fetch(contractUrl)
            const arrayBuffer = await response.arrayBuffer()
            pdfBuffer = Buffer.from(arrayBuffer)
        } catch (e) {
            console.error('Failed to download PDF for attachment:', e)
            // Fallback: send just link? User wants attachment.
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to retrieve PDF for attachment' }) };
        }

        // 4. Send Email
        const mailOptions = {
            from: '"DR7 Empire" <' + (process.env.GMAIL_USER || process.env.SMTP_USER) + '>',
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

        await transporter.sendMail(mailOptions)

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Email sent successfully' })
        }

    } catch (error: any) {
        console.error('Email send error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
}
