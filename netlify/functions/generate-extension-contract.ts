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
        const { bookingId, extensionData } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[generate-extension-contract] Starting for booking ${bookingId}`)

        // Fetch the booking
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) }
        }

        // Fetch customer data (same logic as main contract)
        const customerId = booking.booking_details?.customer?.customerId || booking.user_id
        let customer: any = null

        if (customerId) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            if (cData) customer = cData
        }

        if (!customer && booking.customer_email) {
            const { data: cData } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).single()
            if (cData) customer = cData
        }

        // Fetch vehicle data
        let vehicleData: any = null
        if (booking.vehicle_name) {
            const { data: vData } = await supabase.from('vehicles').select('*').eq('display_name', booking.vehicle_name).maybeSingle()
            vehicleData = vData
        }

        // Get the latest extension from history
        const extensionHistory = booking.booking_details?.extension_history || []
        const latestExtension = extensionHistory[extensionHistory.length - 1] || extensionData

        if (!latestExtension) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No extension data found' }) }
        }

        // Create PDF
        const pdfDoc = await PDFDocument.create()
        const page = pdfDoc.addPage([595.28, 841.89]) // A4 size
        const { width, height } = page.getSize()

        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)

        const black = rgb(0, 0, 0)
        const gold = rgb(0.85, 0.65, 0.13)
        const gray = rgb(0.4, 0.4, 0.4)

        let y = height - 50

        // Header
        page.drawText('DR7 AUTONOLEGGIO', { x: 50, y, size: 24, font: fontBold, color: gold })
        y -= 30
        page.drawText('ADDENDUM DI ESTENSIONE NOLEGGIO', { x: 50, y, size: 16, font: fontBold, color: black })
        y -= 35

        // Contract reference
        const contractNumber = `EXT-${bookingId.substring(0, 8).toUpperCase()}`
        page.drawText(`Numero Addendum: ${contractNumber}`, { x: 50, y, size: 10, font: fontRegular, color: gray })
        y -= 15
        page.drawText(`Data: ${new Date().toLocaleDateString('it-IT')} - Luogo: Cagliari`, { x: 50, y, size: 10, font: fontRegular, color: gray })
        y -= 15
        page.drawText(`Rif. Prenotazione Originale: DR7-${bookingId.substring(0, 8).toUpperCase()}`, { x: 50, y, size: 10, font: fontRegular, color: gray })
        y -= 25

        // Divider line
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: gold })
        y -= 25

        // ===== CUSTOMER SECTION =====
        page.drawText('DATI LOCATARIO', { x: 50, y, size: 11, font: fontBold, color: black })
        y -= 18

        const customerName = customer?.tipo_cliente === 'azienda'
            ? customer.denominazione
            : (customer?.nome && customer?.cognome ? `${customer.nome} ${customer.cognome}` : booking.customer_name || 'N/A')

        page.drawText(`Nome e Cognome: ${customerName}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 14

        const customerCF = customer?.codice_fiscale || booking.booking_details?.customer?.taxCode || ''
        if (customerCF) {
            page.drawText(`Codice Fiscale: ${customerCF}`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        if (customer?.tipo_cliente === 'azienda' && customer?.partita_iva) {
            page.drawText(`Partita IVA: ${customer.partita_iva}`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        // Birth info
        if (customer?.data_nascita || customer?.luogo_nascita) {
            const birthDate = customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : ''
            const birthPlace = customer?.luogo_nascita || ''
            const birthProv = customer?.provincia_nascita || ''
            page.drawText(`Nato/a il: ${birthDate} a ${birthPlace} (${birthProv})`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        // Address
        const address = customer?.indirizzo || ''
        const city = customer?.citta_residenza || customer?.citta || ''
        const prov = customer?.provincia_residenza || customer?.provincia || ''
        const cap = customer?.codice_postale || customer?.cap || ''
        if (address || city) {
            page.drawText(`Residenza: ${address}, ${cap} ${city} (${prov})`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        // Contact
        const phone = customer?.telefono || booking.customer_phone || ''
        const email = customer?.email || booking.customer_email || ''
        if (phone || email) {
            page.drawText(`Tel: ${phone}  -  Email: ${email}`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        // License
        const licenseNum = customer?.numero_patente || ''
        const licenseType = customer?.tipo_patente || customer?.metadata?.patente?.tipo || ''
        const licenseExpiry = customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : ''
        const licenseIssuedBy = customer?.emessa_da || ''
        if (licenseNum) {
            page.drawText(`Patente: ${licenseNum} (${licenseType}) - Scadenza: ${licenseExpiry} - Emessa da: ${licenseIssuedBy}`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        y -= 15

        // ===== VEHICLE SECTION =====
        page.drawText('VEICOLO', { x: 50, y, size: 11, font: fontBold, color: black })
        y -= 18

        const vehicleName = vehicleData?.display_name || booking.vehicle_name || ''
        const vehiclePlate = vehicleData?.plate || booking.vehicle_plate || ''
        page.drawText(`Veicolo: ${vehicleName}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 14
        page.drawText(`Targa: ${vehiclePlate}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 14

        // Vehicle details
        const vehicleColor = vehicleData?.metadata?.color || ''
        const vehicleFuel = vehicleData?.metadata?.fuel || 'Benzina'
        if (vehicleColor || vehicleFuel) {
            page.drawText(`Colore: ${vehicleColor}  -  Alimentazione: ${vehicleFuel}`, { x: 50, y, size: 10, font: fontRegular, color: black })
            y -= 14
        }

        y -= 15

        // ===== EXTENSION DETAILS =====
        page.drawText('DETTAGLI ESTENSIONE', { x: 50, y, size: 11, font: fontBold, color: gold })
        y -= 20

        const originalPickup = new Date(booking.pickup_date).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
        })
        const previousDropoff = latestExtension.previous_dropoff
            ? new Date(latestExtension.previous_dropoff).toLocaleString('it-IT', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
            })
            : 'N/A'
        const newDropoff = new Date(booking.dropoff_date).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
        })

        page.drawText(`Data Ritiro Originale: ${originalPickup}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 14
        page.drawText(`Data Riconsegna Precedente: ${previousDropoff}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 18
        page.drawText(`NUOVA DATA RICONSEGNA: ${newDropoff}`, { x: 50, y, size: 12, font: fontBold, color: gold })
        y -= 20

        // Extension days
        if (latestExtension.previous_dropoff) {
            const prevDate = new Date(latestExtension.previous_dropoff)
            const newDate = new Date(booking.dropoff_date)
            const extensionDays = Math.ceil((newDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
            page.drawText(`Giorni di Estensione: ${extensionDays}`, { x: 50, y, size: 10, font: fontBold, color: black })
            y -= 20
        }

        // Insurance
        const insuranceOption = booking.booking_details?.insuranceOption || 'RCA'
        const insuranceLabels: Record<string, string> = {
            'RCA': 'RCA',
            'KASKO_BASE': 'Kasko Base',
            'KASKO_BLACK': 'Kasko Black',
            'KASKO_SIGNATURE': 'Kasko Signature',
            'DR7': 'Kasko DR7'
        }
        page.drawText(`Copertura Assicurativa: ${insuranceLabels[insuranceOption] || insuranceOption}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 20

        // ===== FINANCIAL =====
        page.drawText('IMPORTI', { x: 50, y, size: 11, font: fontBold, color: black })
        y -= 18

        const additionalAmount = latestExtension.additional_amount || 0
        page.drawText(`Importo Estensione: €${additionalAmount.toFixed(2)}`, { x: 50, y, size: 12, font: fontBold, color: gold })
        y -= 16

        const newTotal = (booking.price_total / 100)
        page.drawText(`Nuovo Totale Noleggio: €${newTotal.toFixed(2)}`, { x: 50, y, size: 10, font: fontRegular, color: black })
        y -= 20

        // Notes
        if (latestExtension.notes) {
            page.drawText(`Note: ${latestExtension.notes}`, { x: 50, y, size: 9, font: fontRegular, color: gray })
            y -= 20
        }

        // Divider
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: gold })
        y -= 20

        // ===== TERMS =====
        page.drawText('CONDIZIONI', { x: 50, y, size: 11, font: fontBold, color: black })
        y -= 18
        const terms = [
            'Il presente addendum estende il contratto di noleggio originale.',
            'Tutte le condizioni del contratto originale rimangono invariate.',
            'La copertura assicurativa è estesa fino alla nuova data di riconsegna.',
            'Il cliente si impegna a riconsegnare il veicolo entro la nuova data.',
            'Eventuali ulteriori estensioni dovranno essere concordate preventivamente.',
            'Il deposito cauzionale originale rimane valido.'
        ]

        for (const term of terms) {
            page.drawText(`• ${term}`, { x: 50, y, size: 9, font: fontRegular, color: gray })
            y -= 14
        }

        y -= 20

        // ===== SIGNATURES =====
        page.drawText('FIRME', { x: 50, y, size: 11, font: fontBold, color: black })
        y -= 30

        page.drawText('Il Locatore (DR7 Autonoleggio)', { x: 50, y, size: 9, font: fontRegular, color: black })
        page.drawText('Il Locatario', { x: 350, y, size: 9, font: fontRegular, color: black })
        y -= 40
        page.drawLine({ start: { x: 50, y }, end: { x: 200, y }, thickness: 0.5, color: black })
        page.drawLine({ start: { x: 350, y }, end: { x: 500, y }, thickness: 0.5, color: black })
        y -= 15
        page.drawText('Timbro e Firma', { x: 90, y, size: 8, font: fontRegular, color: gray })
        page.drawText(customerName, { x: 380, y, size: 8, font: fontRegular, color: gray })

        // Footer
        page.drawText('DR7 Autonoleggio - Viale Marconi 229, 09131 Cagliari - P.IVA: 03837550922',
            { x: 50, y: 50, size: 8, font: fontRegular, color: gray })
        page.drawText(`Documento generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`,
            { x: 50, y: 38, size: 8, font: fontRegular, color: gray })

        // Save PDF
        const pdfBytes = await pdfDoc.save()
        const fileName = `extensions/addendum_${bookingId}_${Date.now()}.pdf`

        console.log(`[generate-extension-contract] Uploading to storage: ${fileName}`)

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) {
            console.error('[generate-extension-contract] Upload error:', uploadError)
            return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) }
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        // Update booking with extension contract URL
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
                            generated_at: new Date().toISOString(),
                            extension_index: extensionHistory.length - 1
                        }
                    ]
                }
            })
            .eq('id', bookingId)

        console.log('[generate-extension-contract] Success:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl })
        }

    } catch (error: any) {
        console.error('[generate-extension-contract] Error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
}
