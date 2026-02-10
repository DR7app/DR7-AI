import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Helper function to sanitize text for WinAnsi encoding
function sanitizeForPDF(text: string): string {
    if (!text) return ''

    const cyrillicToLatin: Record<string, string> = {
        'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
        'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
        'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
        'Б': 'B', 'Г': 'G', 'Д': 'D', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y',
        'Л': 'L', 'П': 'P', 'Ф': 'F', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
        'Ы': 'Y', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
        'б': 'b', 'г': 'g', 'д': 'd', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
        'л': 'l', 'п': 'p', 'ф': 'f', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
        'ы': 'y', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'Ё': 'Yo', 'ё': 'yo', 'Ъ': '', 'ъ': '', 'Ь': '', 'ь': ''
    }

    let result = text
    for (const [cyrillic, latin] of Object.entries(cyrillicToLatin)) {
        result = result.replace(new RegExp(cyrillic, 'g'), latin)
    }

    result = result.replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    return result.replace(/\s+/g, ' ').trim()
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { bookingId, extensionData } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[generate-extension-contract] Starting for booking ${bookingId}`)

        // 1. Fetch Booking Data
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, booking_details')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) }
        }

        // Get extension info
        const extensionHistory = booking.booking_details?.extension_history || []
        const latestExtension = extensionHistory[extensionHistory.length - 1] || extensionData

        if (!latestExtension) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No extension data found' }) }
        }

        // 2. Fetch Customer Data (same logic as main contract)
        const customerId = booking.booking_details?.customer?.customerId || booking.user_id
        let customer: any = null

        if (customerId) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            if (cData) customer = cData
        }

        const resolvedEmail = booking.customer_email || booking.booking_details?.customer?.email
        const resolvedPhone = booking.customer_phone || booking.booking_details?.customer?.phone
        const resolvedName = booking.customer_name || booking.booking_details?.customer?.fullName

        if (!customer && resolvedEmail) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('email', resolvedEmail).single()
            if (cData) customer = cData
        }

        if (!customer) {
            const nameParts = (resolvedName || '').split(' ')
            customer = {
                tipo_cliente: 'persona_fisica',
                nome: nameParts[0] || '',
                cognome: nameParts.slice(1).join(' ') || '',
                email: resolvedEmail || '',
                telefono: resolvedPhone || '',
                indirizzo: booking.booking_details?.customer?.address || '',
                codice_fiscale: booking.booking_details?.customer?.taxCode || '',
            }
        }

        // 3. Fetch Vehicle Data
        let vehicleData: any = null
        if (booking.vehicle_name) {
            const { data: vData } = await supabase.from('vehicles').select('*').eq('display_name', booking.vehicle_name).maybeSingle()
            vehicleData = vData
        }

        // 4. Prepare Data
        const clientName = customer?.tipo_cliente === 'azienda' ? customer.denominazione :
            (customer?.nome ? `${customer.nome} ${customer.cognome}` : resolvedName)
        const clientAddress = customer?.indirizzo || booking.booking_details?.customer?.address || ''
        const clientVat = customer?.tipo_cliente === 'azienda' ? customer.partita_iva : customer?.codice_fiscale
        const driverLicense = customer?.numero_patente || customer?.patente || ''

        const vehicleName = vehicleData?.display_name || booking.vehicle_name || ''
        const vehiclePlate = vehicleData?.plate || booking.vehicle_plate || ''

        // Parse vehicle details
        let parsedColor = vehicleData?.metadata?.color || ''
        let parsedFuel = vehicleData?.metadata?.fuel || 'Benzina'
        let parsedSeats = vehicleData?.metadata?.seats || '5'
        let parsedBrand = vehicleData?.make || vehicleName.split(' ')[0] || ''
        let parsedModel = vehicleData?.model || vehicleName.replace(parsedBrand, '').trim() || ''

        // EXTENSION DATES - Use the extension period dates
        const previousDropoffDate = new Date(latestExtension.previous_dropoff)
        const newDropoffDate = new Date(booking.dropoff_date)
        const contractNumber = `EXT-${bookingId.substring(0, 8).toUpperCase()}-${extensionHistory.length}`

        // Calculate extension days
        const extensionDays = Math.ceil((newDropoffDate.getTime() - previousDropoffDate.getTime()) / (1000 * 60 * 60 * 24))

        // Helper to format date/time in Rome timezone
        const formatDateRome = (date: Date) => {
            return date.toLocaleDateString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: 'Europe/Rome'
            })
        }
        const formatTimeRome = (date: Date) => {
            return date.toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: 'Europe/Rome'
            })
        }

        // 5. Fetch Template from Supabase Storage (same template as main contract)
        console.log(`[generate-extension-contract] Fetching template from storage`)

        const templatePath = `master_contract.pdf?t=${Date.now()}`
        const { data: templateData, error: templateError } = await supabase.storage
            .from('templates')
            .download(templatePath)

        if (templateError || !templateData) {
            console.error(`[generate-extension-contract] Template fetch failed:`, templateError)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: `Failed to load contract template: ${templateError?.message}` })
            }
        }

        let pdfDoc: PDFDocument
        try {
            const templateBytes = await templateData.arrayBuffer()
            pdfDoc = await PDFDocument.load(templateBytes)
        } catch (loadError) {
            console.error(`[generate-extension-contract] PDF Load failed:`, loadError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Invalid PDF template file.' }) }
        }

        // 6. Fill Form Fields
        const form = pdfDoc.getForm()

        // Insurance mapping
        const insuranceOptionId = booking.booking_details?.insuranceOption || 'KASKO_BASE'
        const insuranceLabels: Record<string, string> = {
            'RCA': 'Kasko',
            'KASKO': 'Kasko',
            'KASKO_BASE': 'Kasko',
            'KASKO_BLACK': 'Kasko Black',
            'KASKO_SIGNATURE': 'Kasko Signature',
            'DR7': 'Kasko DR7'
        }
        const insuranceLabel = insuranceLabels[insuranceOptionId] || insuranceOptionId

        // Additional amount for extension
        const additionalAmount = latestExtension.additional_amount || 0

        // Data map - SAME as main contract but with EXTENSION dates
        const dataMap: Record<string, string> = {
            // Contract Info - Mark as EXTENSION
            'ContractNumber': contractNumber,
            'NumeroContratto': contractNumber,
            'Date': new Date().toLocaleDateString('it-IT'),
            'Data': new Date().toLocaleDateString('it-IT'),
            'PlaceOfIssue': 'Cagliari',
            'LuogoStipula': 'Cagliari',
            'TimeOfIssue': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'OrarioStipula': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),

            // Customer Info
            'CustomerName': clientName || '',
            'NomeCognome': clientName || '',
            'CustomerVAT': clientVat || '',
            'CodiceFiscale': clientVat || '',
            'PartitaIVA': clientVat || '',
            'CustomerPhone': resolvedPhone || '',
            'Telefono': resolvedPhone || '',
            'CustomerEmail': resolvedEmail || '',
            'Email': resolvedEmail || '',
            'CustomerAddress': clientAddress || '',
            'Indirizzo': clientAddress || '',
            'CustomerCity': customer?.citta_residenza || '',
            'Citta': customer?.citta_residenza || '',
            'CustomerProvince': customer?.provincia_residenza || '',
            'Provincia': customer?.provincia_residenza || '',
            'CustomerZipCode': customer?.codice_postale || '',
            'CAP': customer?.codice_postale || '',
            'DriverZipCode': customer?.codice_postale || '',

            // Personal Details
            'CustomerBirthDate': customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : '',
            'DataNascita': customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : '',
            'CustomerBirthPlace': customer?.luogo_nascita || '',
            'LuogoNascita': customer?.luogo_nascita || '',
            'CittaNascita': customer?.luogo_nascita || '',
            'CustomerBirthProvince': customer?.provincia_nascita || '',
            'ProvinciaNascita': customer?.provincia_nascita || '',
            'CustomerSex': customer?.sesso || customer?.metadata?.sesso || '',
            'Sesso': customer?.sesso || customer?.metadata?.sesso || '',
            'DriverSex': customer?.sesso || customer?.metadata?.sesso || '',

            // License Details
            'DriverLicense': customer?.numero_patente || driverLicense || '',
            'NumeroPatente': customer?.numero_patente || driverLicense || '',
            'DriverLicenseType': customer?.tipo_patente || customer?.metadata?.patente?.tipo || 'B',
            'TipoPatente': customer?.tipo_patente || customer?.metadata?.patente?.tipo || 'B',
            'DriverLicenseIssuedBy': customer?.emessa_da || customer?.metadata?.patente?.ente || '',
            'PatenteEmessaDa': customer?.emessa_da || customer?.metadata?.patente?.ente || '',
            'EmessaDa': customer?.emessa_da || customer?.metadata?.patente?.ente || '',
            'DriverLicenseIssueDate': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : '',
            'DataRilascioPatente': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : '',
            'DataRilascio': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : '',
            'DriverLicenseExpiryDate': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : '',
            'DataScadenzaPatente': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : '',
            'ScadenzaPatente': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : '',
            'Scadenza': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : '',

            // Vehicle Fields
            'VehicleBrand': parsedBrand,
            'Marca': parsedBrand,
            'VehicleModel': parsedModel,
            'Modello': parsedModel,
            'VehiclePlate': vehiclePlate,
            'Targa': vehiclePlate,
            'VehicleColor': parsedColor,
            'Colore': parsedColor,
            'VehicleFuel': parsedFuel,
            'Alimentazione': parsedFuel,
            'VehicleSeats': parsedSeats,
            'Posti': parsedSeats,

            // EXTENSION DATES - Use delivery address when domicilio is enabled
            'PickupLocation': (() => {
                const deliveryEnabled = booking.delivery_enabled || booking.booking_details?.delivery_enabled
                const deliveryAddr = booking.delivery_address || booking.booking_details?.delivery_address
                if (deliveryEnabled && deliveryAddr) {
                    return [deliveryAddr.street, deliveryAddr.zip, deliveryAddr.city, deliveryAddr.province].filter(Boolean).join(', ')
                }
                return booking.pickup_location || 'Viale Marconi 229, Cagliari, CA, 09100'
            })(),
            'SedeRitiro': (() => {
                const deliveryEnabled = booking.delivery_enabled || booking.booking_details?.delivery_enabled
                const deliveryAddr = booking.delivery_address || booking.booking_details?.delivery_address
                if (deliveryEnabled && deliveryAddr) {
                    return [deliveryAddr.street, deliveryAddr.zip, deliveryAddr.city, deliveryAddr.province].filter(Boolean).join(', ')
                }
                return booking.pickup_location || 'Viale Marconi 229, Cagliari, CA, 09100'
            })(),
            'DropoffLocation': (() => {
                const pickupEnabled = booking.pickup_enabled || booking.booking_details?.pickup_enabled
                const pickupAddr = booking.pickup_address || booking.booking_details?.pickup_address
                if (pickupEnabled && pickupAddr) {
                    return [pickupAddr.street, pickupAddr.zip, pickupAddr.city, pickupAddr.province].filter(Boolean).join(', ')
                }
                return booking.dropoff_location || 'Viale Marconi 229, Cagliari, CA, 09100'
            })(),
            'SedeRiconsegna': (() => {
                const pickupEnabled = booking.pickup_enabled || booking.booking_details?.pickup_enabled
                const pickupAddr = booking.pickup_address || booking.booking_details?.pickup_address
                if (pickupEnabled && pickupAddr) {
                    return [pickupAddr.street, pickupAddr.zip, pickupAddr.city, pickupAddr.province].filter(Boolean).join(', ')
                }
                return booking.dropoff_location || 'Viale Marconi 229, Cagliari, CA, 09100'
            })(),
            // Start date = previous return date (extension starts where original ended)
            'PickupDate': formatDateRome(previousDropoffDate),
            'DataInizio': formatDateRome(previousDropoffDate),
            'PickupTime': formatTimeRome(previousDropoffDate),
            'OraInizio': formatTimeRome(previousDropoffDate),
            // End date = new return date
            'DropoffDate': formatDateRome(newDropoffDate),
            'DataFine': formatDateRome(newDropoffDate),
            'DropoffTime': formatTimeRome(newDropoffDate),
            'OraFine': formatTimeRome(newDropoffDate),
            'TotalDays': extensionDays.toString(),
            'Giorni': extensionDays.toString(),
            'TotalHours': (extensionDays * 24).toString(),
            'Ore': (extensionDays * 24).toString(),

            // Insurance and Financial - EXTENSION AMOUNT ONLY
            'Insurance': insuranceLabel,
            'Assicurazione': insuranceLabel,
            'Deposit': booking.booking_details?.deposit || '0',
            'Cauzione': booking.booking_details?.deposit || '0',
            'TotalKM': booking.booking_details?.km_limit || 'Illimitati',
            'KMTotaliNoleggio': booking.booking_details?.km_limit || 'Illimitati',

            // Company Data (for business clients)
            'CompanyName': customer?.tipo_cliente === 'azienda' ? customer.denominazione : '',
            'CompanyEmail': customer?.tipo_cliente === 'azienda' ? customer.email : '',
            'CompanyAddress': customer?.tipo_cliente === 'azienda' ? customer.indirizzo : '',
            'CompanyPhone': customer?.tipo_cliente === 'azienda' ? customer.telefono : '',
            'CompanyVAT': customer?.tipo_cliente === 'azienda' ? customer.partita_iva : '',
            'CompanyFiscalCode': customer?.tipo_cliente === 'azienda' ? customer.codice_fiscale : '',
        }

        // Fill form fields
        let filledFields = 0
        for (const [key, value] of Object.entries(dataMap)) {
            try {
                const field = form.getTextField(key)
                if (field) {
                    const sanitizedValue = sanitizeForPDF(value)
                    field.setText(sanitizedValue)
                    filledFields++
                }
            } catch (e) {
                // Field not found or type mismatch, skip
            }
        }

        console.log(`[generate-extension-contract] Filled ${filledFields} fields`)

        // Flatten if fields were filled
        if (filledFields > 0) {
            try { form.flatten() } catch (e) { }
        }

        // 7. Save and Upload
        const pdfBytes = await pdfDoc.save()
        const fileName = `extensions/contratto_estensione_${bookingId}_${Date.now()}.pdf`

        console.log(`[generate-extension-contract] Uploading to storage: ${fileName}`)

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) {
            console.error('[generate-extension-contract] Upload error:', uploadError)
            return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) }
        }

        // 8. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        // 9. Update booking with extension contract info
        const existingExtensionContracts = booking.booking_details?.extension_contracts || []
        await supabase
            .from('bookings')
            .update({
                booking_details: {
                    ...booking.booking_details,
                    extension_contracts: [
                        ...existingExtensionContracts,
                        {
                            url: publicUrl,
                            contract_number: contractNumber,
                            generated_at: new Date().toISOString(),
                            extension_index: extensionHistory.length - 1,
                            extension_days: extensionDays,
                            additional_amount: additionalAmount
                        }
                    ]
                }
            })
            .eq('id', bookingId)

        console.log('[generate-extension-contract] Success:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl, contractNumber })
        }

    } catch (error: any) {
        console.error('[generate-extension-contract] Error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
}
