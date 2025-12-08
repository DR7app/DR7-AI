import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Helper to fetch image buffer
async function fetchImage(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch image: ${url}`)
    return await response.arrayBuffer()
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[generate-ducato-contract] Starting for booking ${bookingId}`)

        // 1. Fetch Booking Data
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, booking_details')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            throw new Error(`Booking not found: ${bookingError?.message}`)
        }

        // 2. Fetch Customer Data
        // Check if customer is in customers_extended
        const customerId = booking.user_id
        // Try to find extended data first using email/phone match if user_id not reliable or simply query by known ID
        // We'll use the logic from the app: check customers_extended by ID or Email
        let customer = null

        // Try by ID first
        if (customerId) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            customer = cData
        }

        // If not found, try by email from booking
        if (!customer && booking.customer_email) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).single()
            customer = cData
        }

        // If still not found, try basic customers table
        if (!customer) {
            const { data: cData } = await supabase.from('customers').select('*').eq('email', booking.customer_email).single()
            customer = cData
        }

        // Default to booking data if no customer record found
        const customerData = customer || {
            full_name: booking.customer_name,
            email: booking.customer_email,
            phone: booking.customer_phone,
            address: booking.booking_details?.customer?.address || '',
            // Add other fields defaults
        }

        console.log('[generate-ducato-contract] fetched customer data')

        // 3. Create PDF
        const pdfDoc = await PDFDocument.create()
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

        // 4. Load & Embed Pages
        // We assume the site URL is available. If running locally, we might need localhost.
        // In Netlify, process.env.URL is the deploy URL. In dev, usually http://localhost:8888 or 5173
        const siteUrl = process.env.URL || 'http://localhost:5173' // Adjust default for local testing if needed

        const pageUrls = [
            `${siteUrl}/contract_templates/ducato/page_1.png`,
            `${siteUrl}/contract_templates/ducato/page_2.png`,
            `${siteUrl}/contract_templates/ducato/page_3.png`,
            `${siteUrl}/contract_templates/ducato/page_4.png`
            // Add more pages when available
        ]

        for (let i = 0; i < pageUrls.length; i++) {
            try {
                const imgBuffer = await fetchImage(pageUrls[i])
                const img = await pdfDoc.embedPng(imgBuffer)

                const page = pdfDoc.addPage([img.width, img.height])
                page.drawImage(img, {
                    x: 0,
                    y: 0,
                    width: img.width,
                    height: img.height,
                })

                // DRAW TEXT ON PAGE 1
                if (i === 0) {
                    const fontSize = 12
                    const { height } = page.getSize()

                    // Example coordinates - NEED CALIBRATION
                    // Customer Name
                    page.drawText(customerData.full_name || booking.customer_name || '', {
                        x: 100,
                        y: height - 150, // Approximate Y
                        size: fontSize,
                        font: boldFont,
                        color: rgb(0, 0, 0),
                    })

                    // Booking Dates
                    const start = new Date(booking.start_date || booking.pickup_date || new Date())
                    const end = new Date(booking.end_date || booking.return_date || new Date())

                    page.drawText(`${start.toLocaleDateString('it-IT')} - ${end.toLocaleDateString('it-IT')}`, {
                        x: 100,
                        y: height - 180,
                        size: fontSize,
                        font,
                    })
                }
            } catch (e: any) {
                console.error(`Error processing page ${i + 1}:`, e)
                // Continue or throw?
                // If page 1 fails, we probably should abort.
                if (i === 0) throw e
            }
        }

        // 5. Save and Upload
        const pdfBytes = await pdfDoc.save()

        const fileName = `contratto_${bookingId}_${Date.now()}.pdf`
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, {
                contentType: 'application/pdf',
                upsert: true
            })

        if (uploadError) throw uploadError

        // 6. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        console.log('[generate-ducato-contract] PDF generated:', publicUrl)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                url: publicUrl,
                message: 'Contratto generato con successo'
            })
        }

    } catch (error: any) {
        console.error('[generate-ducato-contract] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
