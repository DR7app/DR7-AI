import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import nodemailer from 'nodemailer'

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
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { ticketNumber, email, fullName, phone, customerData } = JSON.parse(event.body || '{}')

        if (!ticketNumber || !email) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) }
        }

        console.log(`[send-manual-ticket-pdf] Processing ticket #${ticketNumber} for ${email}`)

        // 1. Generate PDF
        const pdfDoc = await PDFDocument.create()
        const page = pdfDoc.addPage([595.28, 841.89]) // A4 size
        const { width, height } = page.getSize()

        // Load Fonts
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

        // Load Logo (Dr7 Logo)
        let logoImage
        try {
            const logoUrl = 'https://dr7empire.com/DR7logo1.png'
            const logoBytes = await fetch(logoUrl).then(res => res.arrayBuffer())
            logoImage = await pdfDoc.embedPng(logoBytes)
        } catch (e) {
            console.error('Failed to load logo:', e)
        }

        // Draw Logo
        if (logoImage) {
            const logoDims = logoImage.scale(0.2)
            page.drawImage(logoImage, {
                x: width / 2 - logoDims.width / 2,
                y: height - 120,
                width: logoDims.width,
                height: logoDims.height,
            })
        }

        // Title
        page.drawText('BIGLIETTO LOTTERIA', {
            x: width / 2 - 100,
            y: height - 160,
            size: 24,
            font: fontBold,
            color: rgb(0, 0, 0),
        })

        // Ticket Number Box
        const ticketStr = `#${String(ticketNumber).padStart(4, '0')}`
        const ticketWidth = fontBold.widthOfTextAtSize(ticketStr, 48)

        // Draw gold box
        page.drawRectangle({
            x: width / 2 - 150,
            y: height - 300,
            width: 300,
            height: 100,
            color: rgb(0.85, 0.65, 0.13), // Goldish
        })

        page.drawText(ticketStr, {
            x: width / 2 - ticketWidth / 2,
            y: height - 240,
            size: 48,
            font: fontBold,
            color: rgb(1, 1, 1),
        })

        // Draw Date
        const dateStr = 'Estrazione: 24 Gennaio 2026'
        const dateWidth = fontBold.widthOfTextAtSize(dateStr, 16)
        page.drawText(dateStr, {
            x: width / 2 - dateWidth / 2,
            y: height - 315, // Below the gold box (which ends at y: height - 300 + 100 = height - 200?? No, y is bottom-left. Box y is height-300, height 100. So top is height-200. Text is inside. Let's put this text below the box.)
            // Box is from y=height-300 to y=height-200. 
            // So y=height-315 is slightly below the box.
            size: 16,
            font: fontBold,
            color: rgb(0.8, 0.1, 0.1), // Red for visibility
        })

        // Customer Details
        const startY = height - 350
        const lineHeight = 20

        page.drawText('Dettagli Cliente:', { x: 50, y: startY, size: 14, font: fontBold })
        page.drawText(`Nome: ${fullName}`, { x: 50, y: startY - lineHeight, size: 12, font: font })
        page.drawText(`Email: ${email}`, { x: 50, y: startY - lineHeight * 2, size: 12, font: font })
        page.drawText(`Telefono: ${phone}`, { x: 50, y: startY - lineHeight * 3, size: 12, font: font })
        page.drawText(`Data Acquisto: ${new Date().toLocaleDateString('it-IT')}`, { x: 50, y: startY - lineHeight * 4, size: 12, font: font })

        // Generate QR Code (using public API for simplicity as no local library)
        try {
            const qrData = JSON.stringify({ ticket: ticketNumber, uuid: `manual-${Date.now()}` })
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`
            const qrBytes = await fetch(qrUrl).then(res => res.arrayBuffer())
            const qrImage = await pdfDoc.embedPng(qrBytes)

            page.drawImage(qrImage, {
                x: width / 2 - 75,
                y: 100,
                width: 150,
                height: 150,
            })
        } catch (e) {
            console.error('Failed to generate QR:', e)
        }

        const pdfBytes = await pdfDoc.save()
        const pdfBuffer = Buffer.from(pdfBytes)

        // 2. Send Email to Customer
        console.log(`[send-manual-ticket-pdf] Sending email to customer: ${email}`)

        await transporter.sendMail({
            from: '"DR7 Empire" <info@dr7.app>',
            to: email,
            subject: `Il Tuo Biglietto - LOTTERIA DR7 (#${String(ticketNumber).padStart(4, '0')})`,
            text: `Grazie per l'acquisto!\n\nIn allegato trovi il tuo biglietto della lotteria DR7 Empire.\n\nNumero Biglietto: #${String(ticketNumber).padStart(4, '0')}\n\nIn bocca al lupo!\nDR7 Empire`,
            attachments: [{
                filename: `Biglietto_Lotteria_${ticketNumber}.pdf`,
                content: pdfBuffer
            }]
        })

        // 3. Send Notification to Admin at info@dr7.app
        const adminEmail = 'info@dr7.app' // Explicitly requested by user
        console.log(`[send-manual-ticket-pdf] Sending notification to admin: ${adminEmail}`)

        await transporter.sendMail({
            from: '"DR7 System" <info@dr7.app>',
            to: adminEmail,
            subject: `🎯 Vendita Manuale Biglietto #${String(ticketNumber).padStart(4, '0')}`,
            text: `È stato venduto un biglietto della lotteria manualmente.\n\nN. Biglietto: #${String(ticketNumber).padStart(4, '0')}\nCliente: ${fullName}\nEmail: ${email}\nTelefono: ${phone}\n\nIl PDF del biglietto è in allegato.`,
            attachments: [{
                filename: `Copia_Biglietto_${ticketNumber}.pdf`,
                content: pdfBuffer
            }]
        })

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Emails sent successfully' })
        }

    } catch (error: any) {
        console.error('[send-manual-ticket-pdf] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
