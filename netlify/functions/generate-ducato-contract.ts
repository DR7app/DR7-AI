import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

        // Check environment variables
        if (!supabaseUrl || !supabaseServiceKey) {
            const error = 'Missing Supabase environment variables'
            console.error(`[generate-ducato-contract] ${error}`)
            return { statusCode: 500, body: JSON.stringify({ error }) }
        }

        // 1. Fetch Booking Data
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, booking_details')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            const error = `Booking not found: ${bookingError?.message || 'No booking data'}`
            console.error(`[generate-ducato-contract] ${error}`)
            return { statusCode: 404, body: JSON.stringify({ error }) }
        }

        console.log(`[generate-ducato-contract] Booking found:`, booking.vehicle_name)

        // 2. Fetch Vehicle Data (for Plate/Model if missing in booking)
        let vehicle = null
        if (booking.vehicle_name) {
            const { data: vData, error: vError } = await supabase.from('vehicles').select('*').eq('display_name', booking.vehicle_name).single()
            if (vError) {
                console.warn(`[generate-ducato-contract] Vehicle not found: ${vError.message}`)
            }
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

        console.log(`[generate-ducato-contract] Customer found:`, customer ? 'Yes' : 'No')

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

        console.log(`[generate-ducato-contract] Creating PDF for ${clientName}, vehicle ${vehicleModel}`)

        // 4. Create PDF
        const pdfDoc = await PDFDocument.create()
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)


        // Create contract page
        const page = pdfDoc.addPage([595, 842]) // A4 size
        const { width, height } = page.getSize()

        let yPosition = height - 50

        // Helper to draw text
        const drawText = (text: string, x: number, size: number = 10, isBold: boolean = false) => {
            page.drawText(text, {
                x,
                y: yPosition,
                size,
                font: isBold ? boldFont : font,
                color: rgb(0, 0, 0)
            })
            yPosition -= size + 5
        }

        // Header
        drawText('CONTRATTO DI NOLEGGIO VEICOLO', 50, 20, true)
        drawText(`Contratto N°: CNT-${bookingId.substring(0, 8).toUpperCase()}`, 50, 12, true)
        drawText(`Data: ${new Date().toLocaleDateString('it-IT')}`, 50, 10)
        yPosition -= 10

        // Company Info
        drawText('DR7 EMPIRE SRL', 50, 14, true)
        drawText('Via Esempio, 123 - 09100 Cagliari (CA)', 50, 10)
        drawText('P.IVA: IT12345678901', 50, 10)
        yPosition -= 15

        // Customer Info
        drawText('DATI CLIENTE', 50, 12, true)
        drawText(`Nome: ${clientName}`, 50, 10)
        drawText(`Indirizzo: ${clientAddress}`, 50, 10)
        if (clientVat) drawText(`Codice Fiscale/P.IVA: ${clientVat}`, 50, 10)
        drawText(`Telefono: ${booking.customer_phone || 'N/A'}`, 50, 10)
        drawText(`Email: ${booking.customer_email || 'N/A'}`, 50, 10)
        if (driverLicense) drawText(`Patente: ${driverLicense}`, 50, 10)
        yPosition -= 15

        // Vehicle Info
        drawText('DATI VEICOLO', 50, 12, true)
        drawText(`Veicolo: ${vehicleModel}`, 50, 10)
        drawText(`Targa: ${vehiclePlate}`, 50, 10)
        yPosition -= 15

        // Rental Details
        drawText('DETTAGLI NOLEGGIO', 50, 12, true)
        drawText(`Data/Ora Ritiro: ${pickupDate.toLocaleDateString('it-IT')} ${pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`, 50, 10)
        drawText(`Luogo Ritiro: ${booking.pickup_location}`, 50, 10)
        drawText(`Data/Ora Riconsegna: ${dropoffDate.toLocaleDateString('it-IT')} ${dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`, 50, 10)
        drawText(`Luogo Riconsegna: ${booking.dropoff_location}`, 50, 10)
        yPosition -= 15

        // Pricing
        drawText('IMPORTO', 50, 12, true)
        const totalDays = Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24))
        drawText(`Giorni: ${totalDays}`, 50, 10)
        drawText(`Totale: € ${(booking.price_total / 100).toFixed(2)}`, 50, 12, true)
        yPosition -= 15

        // Second Driver
        if (booking.booking_details?.second_driver) {
            const sd = booking.booking_details.second_driver
            drawText('SECONDO CONDUCENTE', 50, 12, true)
            drawText(`Nome: ${sd.name} ${sd.surname}`, 50, 10)
            drawText(`Patente: ${sd.license_number}`, 50, 10)
            if (sd.phone) drawText(`Telefono: ${sd.phone}`, 50, 10)
            yPosition -= 15
        }

        // Terms
        drawText('CONDIZIONI GENERALI', 50, 12, true)
        drawText('Il cliente dichiara di aver ricevuto il veicolo in perfette condizioni.', 50, 9)
        drawText('Il cliente si impegna a restituire il veicolo nelle stesse condizioni.', 50, 9)
        drawText('Eventuali danni saranno addebitati al cliente.', 50, 9)
        yPosition -= 20

        // Signatures
        drawText('FIRME', 50, 12, true)
        yPosition -= 30
        drawText('Firma Cliente: _____________________', 50, 10)
        drawText('Firma DR7 Empire: _____________________', 300, 10)

        // 6. Save and Upload
        const pdfBytes = await pdfDoc.save()
        const fileName = `contratto_${bookingId}_${Date.now()}.pdf`

        console.log(`[generate-ducato-contract] Uploading PDF to storage: ${fileName}`)

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) {
            const error = `Storage upload failed: ${uploadError.message}`
            console.error(`[generate-ducato-contract] ${error}`)
            return { statusCode: 500, body: JSON.stringify({ error }) }
        }

        // 6. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        console.log(`[generate-ducato-contract] PDF uploaded successfully: ${publicUrl}`)

        // 7. Save to Contracts Table (Sync with Admin Panel)
        const contractNumber = `CNT-${bookingId.substring(0, 8).toUpperCase()}`
        const { error: dbError } = await supabase
            .from('contracts')
            .upsert({
                booking_id: bookingId,
                contract_number: contractNumber,
                contract_date: new Date().toISOString().split('T')[0], // Date only (YYYY-MM-DD)
                customer_name: clientName,
                customer_email: booking.customer_email || customer?.email,
                customer_phone: booking.customer_phone || customer?.telefono,
                customer_address: clientAddress,
                customer_tax_code: clientVat,
                customer_license_number: driverLicense,
                vehicle_name: vehicleModel,
                rental_start_date: pickupDate.toISOString().split('T')[0], // Date only (YYYY-MM-DD)
                rental_end_date: dropoffDate.toISOString().split('T')[0], // Date only (YYYY-MM-DD)
                daily_rate: 0, // Calculate if possible or leave 0
                total_days: Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)),
                total_amount: booking.price_total / 100,
                status: 'active',
                pdf_url: publicUrl
                // created_at has database default, no need to override
            }, { onConflict: 'booking_id' })

        if (dbError) {
            const error = `Database insert failed: ${dbError.message} (Code: ${dbError.code})`
            console.error('[generate-ducato-contract] Failed to sync with contracts table:', dbError)
            console.error('[generate-ducato-contract] Error details:', JSON.stringify(dbError, null, 2))
            return { statusCode: 500, body: JSON.stringify({ error, details: dbError }) }
        }

        console.log('[generate-ducato-contract] PDF generated and synced:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl })
        }

    } catch (error: any) {
        console.error('[generate-ducato-contract] Unexpected error:', error)
        console.error('[generate-ducato-contract] Error stack:', error.stack)
        return { statusCode: 500, body: JSON.stringify({ error: error.message, stack: error.stack }) }
    }
}
