import { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
})

interface Customer {
    id: string
    nome: string
    cognome: string
    email: string | null
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    try {

        const { customers, subject, message, imageBase64, imageName, images } = JSON.parse(event.body || '{}')

        if (!customers || !Array.isArray(customers) || customers.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No customers provided' }) }
        }

        if (!subject || !message) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields (subject or message)' }) }
        }

        // Handle Images (Multiple or Legacy Single)
        const attachments: any[] = []
        let imagesHtml = ''

        if (images && Array.isArray(images) && images.length > 0) {
            // New Multi-Image Logic
            images.forEach((img: { filename: string; content: string }, index: number) => {
                const cid = `voucher-image-${index}`
                const contentBuffer = Buffer.from(img.content.split(',')[1], 'base64')

                attachments.push({
                    filename: img.filename,
                    content: contentBuffer,
                    cid: cid
                })

                imagesHtml += `<img src="cid:${cid}" alt="${img.filename}" style="max-width: 100%; height: auto; margin-top: 10px; display: block;"/><br/>`
            })
        } else if (imageBase64) {
            // Legacy Single Image Logic
            const contentBuffer = Buffer.from(imageBase64.split(',')[1], 'base64')
            const cid = 'voucher-image'

            attachments.push({
                filename: imageName || 'buono-regalo.jpg',
                content: contentBuffer,
                cid: cid
            })

            imagesHtml = `<img src="cid:${cid}" alt="Buono Regalo" style="max-width: 100%; height: auto; display: block;"/>`
        } else {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing image (required for marketing email)' }) }
        }

        // Verify SMTP credentials
        const smtpUser = process.env.GMAIL_USER
        const smtpPass = process.env.GMAIL_APP_PASSWORD

        if (!smtpUser || !smtpPass) {
            console.error('[send-gift-voucher] Missing SMTP credentials')
            return { statusCode: 500, body: JSON.stringify({ error: 'SMTP credentials not configured' }) }
        }

        let sentCount = 0
        const errors: string[] = []

        // Send email to each customer
        for (const customer of customers as Customer[]) {
            if (!customer.email) {
                errors.push(`${customer.nome} ${customer.cognome}: no email address`)
                continue
            }

            try {
                // Personalize message
                const personalizedMessage = message
                    .replace(/{nome}/g, customer.nome || '')
                    .replace(/{cognome}/g, customer.cognome || '')

                const mailOptions = {
                    from: `"DR7 Empire" <${smtpUser}>`,
                    to: customer.email,
                    subject: subject,
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
              <div style="white-space: pre-wrap; font-size: 16px; line-height: 1.5;">${personalizedMessage}</div>
              <br/>
              <div style="text-align: center;">
                ${imagesHtml}
              </div>
            </div>
          `,
                    attachments: attachments
                }

                await transporter.sendMail(mailOptions)
                sentCount++
                console.log(`[send-gift-voucher] Email sent to: ${customer.email}`)
            } catch (error: any) {
                console.error(`[send-gift-voucher] Error sending to ${customer.email}:`, error)
                errors.push(`${customer.nome} ${customer.cognome}: ${error.message}`)
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                sent: sentCount,
                total: customers.length,
                errors: errors.length > 0 ? errors : undefined
            })
        }

    } catch (error: any) {
        console.error('[send-gift-voucher] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Unknown error occurred',
                details: error.toString()
            })
        }
    }
}
