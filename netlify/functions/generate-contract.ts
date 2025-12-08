import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

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

        console.log(`[generate-contract] Starting for booking ${bookingId}`)

        // Check environment variables
        if (!supabaseUrl || !supabaseServiceKey) {
            const error = 'Missing Supabase environment variables'
            console.error(`[generate-contract] ${error}`)
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
            console.error(`[generate-contract] ${error}`)
            return { statusCode: 404, body: JSON.stringify({ error }) }
        }

        // 2. Fetch Customer Data
        const customerId = booking.user_id || booking.booking_details?.customer?.customerId
        let customer = null

        console.log(`[generate-contract] Fetching customer. ID: ${customerId}, Email: ${booking.customer_email}`)

        if (customerId) {
            const { data: cData, error: cError } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            if (cError) console.error('[generate-contract] Error fetching by ID:', cError)
            if (cData) {
                console.log('[generate-contract] Found customer by ID:', JSON.stringify(cData))
                customer = cData
            }
        }
        // Fallbacks
        if (!customer && booking.customer_email) {
            console.log('[generate-contract] Fallback: Fetching by email...')
            const { data: cData, error: cError } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).single()
            if (cError) console.error('[generate-contract] Error fetching by email (customers_extended):', cError)
            if (cData) {
                console.log('[generate-contract] Found customer by Email (extended):', JSON.stringify(cData))
                customer = cData
            }
        }
        if (!customer && booking.customer_email) {
            console.log('[generate-contract] Fallback: Fetching by email (basic customers)...')
            const { data: cData } = await supabase.from('customers').select('*').eq('email', booking.customer_email).single()
            if (cData) {
                console.log('[generate-contract] Found customer by Email (basic):', JSON.stringify(cData))
                customer = { ...cData, tipo_cliente: 'persona_fisica', nome: cData.full_name, indirizzo: cData.notes }
            }
        }

        if (!customer) {
            console.warn('[generate-contract] WARNING: No customer record found. Contract will be empty.')
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

        // 4. Fetch Template from Supabase Storage
        // Based on user URL: .../public/templates/master_contract.pdf -> Bucket: 'templates', File: 'master_contract.pdf'
        console.log(`[generate-contract] Fetching template from storage: bucket 'templates', file 'master_contract.pdf'`)

        const { data: templateData, error: templateError } = await supabase.storage
            .from('templates')
            .download('master_contract.pdf')

        if (templateError || !templateData) {
            console.error(`[generate-contract] Template fetch failed:`, templateError)

            // Debug: List files in 'templates' bucket
            const { data: fileList } = await supabase.storage
                .from('templates')
                .list()

            const filesFound = fileList ? fileList.map(f => f.name).join(', ') : 'None'
            console.log(`[generate-contract] Files found in 'templates' bucket: ${filesFound}`)

            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: `Failed to load contract template 'master_contract.pdf' from 'templates' bucket. Files found in bucket: ${filesFound}. Supabase Error: ${templateError?.message}`
                })
            }
        }

        let pdfDoc: PDFDocument
        try {
            const templateBytes = await templateData.arrayBuffer()
            pdfDoc = await PDFDocument.load(templateBytes)
        } catch (loadError) {
            console.error(`[generate-contract] PDF Load failed:`, loadError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Invalid PDF template file.' }) }
        }

        // 5. Fill Data
        const form = pdfDoc.getForm()

        // Standardized Data Field Map
        const dataMap: Record<string, string> = {
            'ContractNumber': contractNumber,
            'Date': new Date().toLocaleDateString('it-IT'),
            'CustomerName': clientName || '',
            'CustomerVAT': clientVat || '',
            'CustomerPhone': booking.customer_phone || '',
            'CustomerEmail': booking.customer_email || '',
            'DriverLicense': customer?.numero_patente || driverLicense || '', // "numero_patente" is correct column

            // Vehicle Fields
            'VehicleBrand': booking.vehicle_make || '', // Assuming vehicle_make exists or needs fetch
            'VehicleColor': booking.vehicle_color || '',
            'VehicleFuel': booking.vehicle_fuel || '',
            'VehicleSeats': booking.booking_details?.vehicle?.seats || '',
            'VehicleFuelLevel': '', // Tacche autonomia - usually filled by hand or at pickup
            'VehicleKMRange': '',   // KM autonomia

            // Rental Specifics
            'PickupLocation': booking.pickup_location || 'Sede',
            'DropoffLocation': booking.dropoff_location || 'Sede',
            'TotalDays': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)).toString(),
            'TotalHours': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60)).toString(),
            'PlaceOfIssue': 'Cagliari',
            'TimeOfIssue': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),

            // Second Driver Fields (Placeholder or from booking_details)
            'SecondDriverName': booking.booking_details?.second_driver?.name || '',
            'SecondDriverBirthDate': booking.booking_details?.second_driver?.birth_date ? new Date(booking.booking_details.second_driver.birth_date).toLocaleDateString('it-IT') : '',
            'SecondDriverBirthCity': booking.booking_details?.second_driver?.birth_city || '',
            'SecondDriverBirthProvince': booking.booking_details?.second_driver?.birth_province || '',
            'SecondDriverStatsCode': booking.booking_details?.second_driver?.tax_code || '',
            'SecondDriverCity': booking.booking_details?.second_driver?.city || '',
            'SecondDriverProvince': booking.booking_details?.second_driver?.province || '',
            'SecondDriverGender': booking.booking_details?.second_driver?.gender || '',
            'SecondDriverLicenseType': booking.booking_details?.second_driver?.license_type || '',
            'SecondDriverLicenseNumber': booking.booking_details?.second_driver?.license_number || '',
            'SecondDriverLicenseIssuedBy': booking.booking_details?.second_driver?.license_issued_by || '',
            'SecondDriverLicenseIssueDate': booking.booking_details?.second_driver?.license_issue_date ? new Date(booking.booking_details.second_driver.license_issue_date).toLocaleDateString('it-IT') : '',
            'SecondDriverLicenseExpiryDate': booking.booking_details?.second_driver?.license_expiry_date ? new Date(booking.booking_details.second_driver.license_expiry_date).toLocaleDateString('it-IT') : '',
        }

        let filledFields = 0
        for (const [key, value] of Object.entries(dataMap)) {
            try {
                // Try to find exact match
                let field = form.getTextField(key)
                if (!field) {
                    // Try lowercase or other variations if needed, but let's stick to exact for now
                }

                if (field) {
                    field.setText(value)
                    filledFields++
                }
            } catch (e) {
                // Field matches might fail if types differ (e.g. checkbox vs text), ignore
            }
        }

        console.log(`[generate-contract] Filled ${filledFields} fields.`)

        // If no fields were filled, it means field names didn't match or there are no fields.
        if (filledFields === 0) {
            const page = pdfDoc.getPages()[0]
            const { height } = page.getSize()
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
            const red = rgb(1, 0, 0)

            const availableFields = form.getFields().map(f => f.getName()).join(', ') || 'None (The PDF has no form fields)'

            page.drawText(`ERROR: No data filled. Check your PDF form field names.`, { x: 50, y: height - 50, size: 12, font, color: red })
            page.drawText(`Found fields in PDF: ${availableFields}`, { x: 50, y: height - 70, size: 10, font, color: red })
            page.drawText(`Expected fields: ${Object.keys(dataMap).join(', ')}`, { x: 50, y: height - 90, size: 8, font, color: red })
        } else {
            // Flatten if we filled fields
            try { form.flatten() } catch (e) { }
        }

        // 6. Save and Upload
        const pdfBytes = await pdfDoc.save()
        // Save to 'filled' folder to keep things organized
        const fileName = `filled/contratto_${bookingId}_${Date.now()}.pdf`

        console.log(`[generate-contract] Uploading filled PDF to storage: ${fileName}`)

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) {
            const error = `Storage upload failed: ${uploadError.message}`
            console.error(`[generate-contract] ${error}`)
            return { statusCode: 500, body: JSON.stringify({ error }) }
        }

        // 7. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        // 8. Save/Update Contracts Table
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
                daily_rate: 0, // We rely on total amount mostly
                total_days: Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)),
                total_amount: booking.price_total / 100,
                status: 'active',
                pdf_url: publicUrl
            }, { onConflict: 'booking_id' })

        if (dbError) {
            console.error('[generate-contract] Failed to sync with contracts table:', dbError)
        }

        // 8b. Update Booking with contract URL (optional but good for direct access)
        await supabase
            .from('bookings')
            .update({
                contract_url: publicUrl,
                booking_details: {
                    ...booking.booking_details,
                    contract_generated_at: new Date().toISOString()
                }
            })
            .eq('id', bookingId)

        console.log('[generate-contract] Success:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl })
        }

    } catch (error: any) {
        console.error('[generate-contract] Unexpected error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message, stack: error.stack }) }
    }
}
