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

        if (bookingError || !booking) throw new Error(`Booking not found: ${bookingError?.message}`)

        // 2. Fetch Vehicle Data (for Plate/Model if missing in booking)
        let vehicle = null
        if (booking.vehicle_name) {
            const { data: vData } = await supabase.from('vehicles').select('*').eq('display_name', booking.vehicle_name).single()
            vehicle = vData
        }

        // 3. Fetch Customer Data
        const customerId = booking.user_id || booking.booking_details?.customer?.customerId
        let customer = null

        // Try by ID in extended table
        if (customerId) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            customer = cData
        }

        // Fallback: Try by Email
        if (!customer && booking.customer_email) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).single()
            customer = cData
        }

        // Fallback: Legacy customers table
        if (!customer && booking.customer_email) {
            const { data: cData } = await supabase.from('customers').select('*').eq('email', booking.customer_email).single()
            // Map legacy to extended format if needed
            if (cData) {
                customer = { ...cData, tipo_cliente: 'persona_fisica', nome: cData.full_name, indirizzo: cData.notes } // best effort
            }
        }

        // Prepare Data Objects
        const clientName = customer?.tipo_cliente === 'azienda' ? customer.denominazione : await (async () => {
            return customer?.nome ? `${customer.nome} ${customer.cognome}` : booking.customer_name
        })()

        const clientAddress = customer?.indirizzo
            ? `${customer.indirizzo}, ${customer.citta_residenza || ''} (${customer.provincia_residenza || ''})`
            : booking.booking_details?.customer?.address || ''

        const clientVat = customer?.tipo_cliente === 'azienda' ? customer.partita_iva : customer?.codice_fiscale

        const driverLicense = customer?.patente || customer?.driver_license_number || ''
        const driverLicenseExpiry = customer?.metadata?.patente?.scadenza || ''

        const vehiclePlate = booking.vehicle_plate || vehicle?.plate || 'TBD'
        const vehicleModel = booking.vehicle_name

        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)

        // 4. Create PDF
        const pdfDoc = await PDFDocument.create()
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

        // 5. Load Pages
        const siteUrl = process.env.URL || 'http://localhost:5173'
        const pageUrls = [
            `${siteUrl}/contract_templates/ducato/page_1.png`,
            `${siteUrl}/contract_templates/ducato/page_2.png`,
            `${siteUrl}/contract_templates/ducato/page_3.png`,
            `${siteUrl}/contract_templates/ducato/page_4.png`
        ]

        for (let i = 0; i < pageUrls.length; i++) {
            const imgBuffer = await fetchImage(pageUrls[i])
            const img = await pdfDoc.embedPng(imgBuffer)
            const page = pdfDoc.addPage([img.width, img.height])
            const { height } = page.getSize()

            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })

            const drawField = (text: string, x: number, y: number, fontSize = 10, isBold = false) => {
                page.drawText(String(text || ''), { x, y, size: fontSize, font: isBold ? boldFont : font })
            }

            // PAGE 1 MAPPING
            if (i === 0) {
                // --- CLIENT SECTION (Guestimated Top Left) ---
                drawField(clientName, 120, height - 165, 11, true)
                drawField(clientAddress, 120, height - 185)
                drawField(clientVat, 120, height - 205)
                drawField(booking.customer_phone || '', 120, height - 225)
                drawField(booking.customer_email || '', 300, height - 225)

                // --- DRIVER INFO ---
                drawField(driverLicense, 150, height - 260)
                drawField(driverLicenseExpiry, 350, height - 260)

                // --- VEHICLE SECTION ---
                drawField(vehicleModel, 120, height - 320, 11, true)
                drawField(vehiclePlate, 350, height - 320, 11, true)

                // --- RENTAL DETAILS ---
                // Pickup
                drawField(pickupDate.toLocaleDateString('it-IT'), 100, height - 400)
                drawField(pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), 200, height - 400)
                drawField(booking.pickup_location, 300, height - 400)

                // Dropoff
                drawField(dropoffDate.toLocaleDateString('it-IT'), 100, height - 430)
                drawField(dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), 200, height - 430)
                drawField(booking.dropoff_location, 300, height - 430)

                // --- FINANCIALS ---
                drawField(`€ ${(booking.price_total / 100).toFixed(2)}`, 450, height - 550, 12, true)

                // --- SECOND DRIVER (if applicable) ---
                if (booking.booking_details?.second_driver) {
                    const sd = booking.booking_details.second_driver
                    drawField(`${sd.name} ${sd.surname}`, 120, height - 600)
                    drawField(`Patente: ${sd.license_number}`, 120, height - 615)
                }
            }
        }

        // 6. Save and Upload
        const pdfBytes = await pdfDoc.save()
        const fileName = `contratto_${bookingId}_${Date.now()}.pdf`

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) throw uploadError

        // 6. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        // 7. Save to Contracts Table (Sync with Admin Panel)
        const contractNumber = `CNT-${bookingId.substring(0, 8).toUpperCase()}`
        const { error: dbError } = await supabase
            .from('contracts')
            .upsert({
                booking_id: bookingId,
                contract_number: contractNumber,
                contract_date: new Date().toISOString(),
                customer_name: clientName,
                customer_email: booking.customer_email || customer?.email,
                customer_phone: booking.customer_phone || customer?.telefono,
                customer_address: clientAddress,
                customer_tax_code: clientVat,
                customer_license_number: driverLicense,
                vehicle_name: vehicleModel,
                rental_start_date: booking.pickup_date,
                rental_end_date: booking.dropoff_date,
                daily_rate: 0, // Calculate if possible or leave 0
                total_days: Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)),
                total_amount: booking.price_total / 100,
                status: 'active',
                pdf_url: publicUrl,
                created_at: new Date().toISOString()
            }, { onConflict: 'booking_id' })

        if (dbError) {
            console.error('[generate-ducato-contract] Failed to sync with contracts table:', dbError)
            // Don't fail the request, just log it. The PDF is still valid.
        }

        console.log('[generate-ducato-contract] PDF generated and synced:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl })
        }

    } catch (error: any) {
        console.error('[generate-ducato-contract] Error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
}
