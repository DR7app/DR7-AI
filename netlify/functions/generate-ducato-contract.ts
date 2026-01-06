import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
// import fetch from 'node-fetch' - Removed: Native fetch available in Node 18+

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!

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

        // 2. Fetch Customer Data
        const customerId = booking.user_id || booking.booking_details?.customer?.customerId
        let customer = null
        if (customerId) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            customer = cData
        }
        // Fallbacks
        if (!customer && booking.customer_email) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).single()
            customer = cData
        }
        if (!customer && booking.customer_email) {
            const { data: cData } = await supabase.from('customers').select('*').eq('email', booking.customer_email).single()
            if (cData) {
                customer = { ...cData, tipo_cliente: 'persona_fisica', nome: cData.full_name, indirizzo: cData.notes }
            }
        }

        // 3. Prepare Data
        const clientName = customer?.tipo_cliente === 'azienda' ? customer.denominazione : await (async () => {
            return customer?.nome ? `${customer.nome} ${customer.cognome}` : booking.customer_name
        })()
        const clientAddress = customer?.indirizzo || booking.booking_details?.customer?.address || ''
        const clientVat = customer?.tipo_cliente === 'azienda' ? customer.partita_iva : customer?.codice_fiscale
        const driverLicense = customer?.patente || customer?.driver_license_number || ''
        const vehicleModel = booking.vehicle_name
        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)
        const contractNumber = `CNT-${bookingId.substring(0, 8).toUpperCase()}`

        // 4. Fetch Template
        // In Netlify functions, we might need to rely on the deployed URL to fetch public assets 
        // if they are not bundled into the function via specific config.
        const protocol = event.headers['x-forwarded-proto'] || 'http'
        const host = event.headers.host
        const baseUrl = `${protocol}://${host}`
        const templateUrl = `${baseUrl}/contract_templates/contract_template.pdf`

        console.log(`[generate-ducato-contract] Fetching template from ${templateUrl}`)

        let pdfDoc: PDFDocument
        try {
            const templateRes = await fetch(templateUrl)
            if (!templateRes.ok) {
                // If template is missing, we could fallback to blank, but better to error so user knows to upload it.
                throw new Error(`Failed to fetch template: ${templateRes.status} ${templateRes.statusText}`)
            }
            const templateBytes = await templateRes.arrayBuffer()
            pdfDoc = await PDFDocument.load(templateBytes)
        } catch (templateError) {
            console.error(`[generate-ducato-contract] Template fetch/load failed:`, templateError)
            return { statusCode: 500, body: JSON.stringify({ error: `Failed to load contract template. Please ensure public/contract_templates/contract_template.pdf exists. Detail: ${templateError.message}` }) }
        }

        // 5. Fill Data
        const form = pdfDoc.getForm()
        let fields: string[] = []
        try {
            fields = form.getFields().map(f => f.getName())
            console.log(`[generate-ducato-contract] Found fields in PDF:`, fields)
        } catch (e) {
            console.log(`[generate-ducato-contract] No form fields found or error reading fields.`)
        }

        // Standardized Data Field Map
        const dataMap: Record<string, string> = {
            'ContractNumber': contractNumber,
            'Date': new Date().toLocaleDateString('it-IT'),
            'CustomerName': clientName || '',
            'CustomerAddress': clientAddress || '',
            'CustomerVAT': clientVat || '',
            'CustomerPhone': booking.customer_phone || '',
            'CustomerEmail': booking.customer_email || '',
            'DriverLicense': driverLicense || '',
            'VehicleModel': vehicleModel || '',
            'LicensePlate': booking.vehicle_plate || 'TBD',
            'PickupDate': pickupDate.toLocaleDateString('it-IT'),
            'PickupTime': pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'DropoffDate': dropoffDate.toLocaleDateString('it-IT'),
            'DropoffTime': dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'TotalAmount': `${(booking.price_total / 100).toFixed(2)}`,

            // Second Driver Fields (Only if second driver exists)
            'SecondDriverName': (booking.booking_details?.second_driver?.name && booking.booking_details?.second_driver?.surname)
                ? `${booking.booking_details.second_driver.name} ${booking.booking_details.second_driver.surname}`
                : '',
            'SecondoGuidatore': (booking.booking_details?.second_driver?.name && booking.booking_details?.second_driver?.surname)
                ? `${booking.booking_details.second_driver.name} ${booking.booking_details.second_driver.surname}`
                : '',
            'SecondDriverBirthDate': (booking.booking_details?.second_driver?.birth_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.birth_date).toLocaleDateString('it-IT')
                : '',
            'SecondDriverPlaceOfBirth': (booking.booking_details?.second_driver?.birth_place) ? booking.booking_details?.second_driver?.birth_place : '',
            'SecondDriverBirthProvince': (booking.booking_details?.second_driver?.birth_provincia) ? booking.booking_details?.second_driver?.birth_provincia : (booking.booking_details?.second_driver?.birth_province || ''),
            'SecondDriverStatsCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || '') : '',
            'SecondDriverTaxCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || '') : '',
            'SecondDriverCity': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.city || booking.booking_details?.second_driver?.citta || '') : '',
            'SecondDriverProvince': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.province || booking.booking_details?.second_driver?.provincia || '') : '',
            'SecondDriverGender': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || booking.booking_details?.second_driver?.sesso || '') : '',
            'SecondDriverLicenseType': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.license_type || '') : '',
            'SecondDriverLicenseNumber': (booking.booking_details?.second_driver?.license_number && booking.booking_details?.second_driver?.name)
                ? booking.booking_details.second_driver.license_number
                : '',
            'SecondDriverLicenseIssuedBy': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.license_issued_by || '') : '',
            'SecondDriverLicenseIssueDate': (booking.booking_details?.second_driver?.license_issue_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.license_issue_date).toLocaleDateString('it-IT')
                : '',
            'SecondDriverLicenseExpiryDate': (booking.booking_details?.second_driver?.license_expiry && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.license_expiry).toLocaleDateString('it-IT')
                : (booking.booking_details?.second_driver?.license_expiry_date ? new Date(booking.booking_details.second_driver.license_expiry_date).toLocaleDateString('it-IT') : ''),
            'SecondDriverVAT': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || '') : '',
            'SecondDriverSex': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || booking.booking_details?.second_driver?.sesso || '') : '',
            'SecondDriverAddress': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.address || booking.booking_details?.second_driver?.indirizzo || '') : '',
            'SecondDriverZipCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.zip_code || booking.booking_details?.second_driver?.cap || '') : '',
            'SecondDriverBirthPlace': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.birth_city || booking.booking_details?.second_driver?.birth_place || '') : '',
            // 'SecondDriverBirthProvince' handled above
            'SecondDriverPhone': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.phone || '') : '',
            'SecondDriverEmail': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.email || '') : '',

            // Italian Aliases for Second Driver (Robustness)
            'CodiceFiscaleSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || '') : '',
            'IndirizzoSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.address || booking.booking_details?.second_driver?.indirizzo || '') : '',
            'CittaSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.city || booking.booking_details?.second_driver?.citta || '') : '',
            'ProvinciaSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.province || booking.booking_details?.second_driver?.provincia || '') : '',
            'CapSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.zip_code || booking.booking_details?.second_driver?.cap || '') : '',
            'DataNascitaSecondoGuidatore': (booking.booking_details?.second_driver?.birth_date && booking.booking_details?.second_driver?.name) ? new Date(booking.booking_details.second_driver.birth_date).toLocaleDateString('it-IT') : '',
            'LuogoNascitaSecondoGuidatore': (booking.booking_details?.second_driver?.birth_place) ? booking.booking_details?.second_driver?.birth_place : '',
            'SessoSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || booking.booking_details?.second_driver?.sesso || '') : '',
            'PatenteSecondoGuidatore': (booking.booking_details?.second_driver?.license_number && booking.booking_details?.second_driver?.name) ? booking.booking_details.second_driver.license_number : '',
            'ScadenzaPatenteSecondoGuidatore': (booking.booking_details?.second_driver?.license_expiry && booking.booking_details?.second_driver?.name) ? new Date(booking.booking_details.second_driver.license_expiry).toLocaleDateString('it-IT') : (booking.booking_details?.second_driver?.license_expiry_date ? new Date(booking.booking_details.second_driver.license_expiry_date).toLocaleDateString('it-IT') : ''),
            'TelefonoSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.phone || '') : '',
            'EmailSecondoGuidatore': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.email || '') : '',
        }

        // 5a. Attempt to fill fields
        let filledFields = 0
        for (const [key, value] of Object.entries(dataMap)) {
            try {
                const field = form.getTextField(key)
                if (field) {
                    field.setText(value)
                    filledFields++
                }
            } catch (e) {
                // Field not found in PDF
            }
        }

        // 5b. Fallback: If no fields matched (or user hasn't added form fields yet),
        // we write text on the first page as a visual confirmation/fallback.
        if (filledFields === 0) {
            const page = pdfDoc.getPages()[0]
            const { height } = page.getSize()
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
            const drawText = (text: string, x: number, y: number) => {
                page.drawText(text, { x, y, size: 10, font, color: rgb(0, 0, 0) })
            }

            // Simple overlay for the placeholder
            let y = height - 100
            drawText(`Contract: ${contractNumber}`, 50, y); y -= 15
            drawText(`Date: ${new Date().toLocaleDateString('it-IT')}`, 50, y); y -= 15
            drawText(`Customer: ${clientName}`, 50, y); y -= 15
            drawText(`Vehicle: ${vehicleModel}`, 50, y); y -= 15
            drawText(`Pickup: ${dataMap.PickupDate} ${dataMap.PickupTime}`, 50, y); y -= 15
            drawText(`Dropoff: ${dataMap.DropoffDate} ${dataMap.DropoffTime}`, 50, y); y -= 15
            drawText(`Total: € ${dataMap.TotalAmount}`, 50, y); y -= 15
            drawText(`(Generated using 9-page template logic)`, 50, y); y -= 15
        } else {
            // Flatten if we filled fields
            try { form.flatten() } catch (e) { }
        }

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

        // 7. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        // 8. Save to Contracts Table
        const { error: dbError } = await supabase
            .from('contracts')
            .upsert({
                booking_id: bookingId,
                contract_number: contractNumber,
                contract_date: new Date().toISOString().split('T')[0],
                customer_name: clientName,
                customer_email: booking.customer_email || customer?.email,
                customer_phone: booking.customer_phone || customer?.telefono,
                customer_address: clientAddress,
                customer_tax_code: clientVat,
                customer_license_number: driverLicense,
                vehicle_name: vehicleModel,
                rental_start_date: pickupDate.toISOString().split('T')[0],
                rental_end_date: dropoffDate.toISOString().split('T')[0],
                daily_rate: 0,
                total_days: Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)),
                total_amount: booking.price_total / 100,
                status: 'active',
                pdf_url: publicUrl
            }, { onConflict: 'booking_id' })

        if (dbError) {
            console.error('[generate-ducato-contract] Failed to sync with contracts table:', dbError)
        }

        console.log('[generate-ducato-contract] Success:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl })
        }

    } catch (error: any) {
        console.error('[generate-ducato-contract] Unexpected error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message, stack: error.stack }) }
    }
}
