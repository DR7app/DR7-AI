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

        // Get the latest extension from history
        const extensionHistory = booking.booking_details?.extension_history || []
        const latestExtension = extensionHistory[extensionHistory.length - 1] || extensionData

        if (!latestExtension) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No extension data found' }) }
        }

        // Create a simple PDF for the extension
        const pdfDoc = await PDFDocument.create()
        const page = pdfDoc.addPage([595.28, 841.89]) // A4 size
        const { width, height } = page.getSize()

        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)

        const black = rgb(0, 0, 0)
        const gold = rgb(0.85, 0.65, 0.13)
        const gray = rgb(0.3, 0.3, 0.3)

        let y = height - 50

        // Header
        page.drawText('DR7 AUTONOLEGGIO', { x: 50, y, size: 24, font: fontBold, color: gold })
        y -= 30
        page.drawText('ADDENDUM DI ESTENSIONE NOLEGGIO', { x: 50, y, size: 16, font: fontBold, color: black })
        y -= 40

        // Contract reference
        const contractNumber = `EXT-${bookingId.substring(0, 8).toUpperCase()}`
        page.drawText(`Numero Addendum: ${contractNumber}`, { x: 50, y, size: 11, font: fontRegular, color: gray })
        y -= 20
        page.drawText(`Data: ${new Date().toLocaleDateString('it-IT')}`, { x: 50, y, size: 11, font: fontRegular, color: gray })
        y -= 20
        page.drawText(`Riferimento Prenotazione: DR7-${bookingId.substring(0, 8).toUpperCase()}`, { x: 50, y, size: 11, font: fontRegular, color: gray })
        y -= 40

        // Divider line
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: gold })
        y -= 30

        // Customer Info
        page.drawText('DATI CLIENTE', { x: 50, y, size: 12, font: fontBold, color: black })
        y -= 25
        const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'
        page.drawText(`Cliente: ${customerName}`, { x: 50, y, size: 11, font: fontRegular, color: black })
        y -= 40

        // Vehicle Info
        page.drawText('VEICOLO', { x: 50, y, size: 12, font: fontBold, color: black })
        y -= 25
        page.drawText(`Veicolo: ${booking.vehicle_name || 'N/A'}`, { x: 50, y, size: 11, font: fontRegular, color: black })
        y -= 18
        page.drawText(`Targa: ${booking.vehicle_plate || 'N/A'}`, { x: 50, y, size: 11, font: fontRegular, color: black })
        y -= 40

        // Extension Details Section
        page.drawText('DETTAGLI ESTENSIONE', { x: 50, y, size: 12, font: fontBold, color: black })
        y -= 25

        // Original dates
        const originalPickup = new Date(booking.pickup_date).toLocaleDateString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
        })
        const previousDropoff = latestExtension.previous_dropoff
            ? new Date(latestExtension.previous_dropoff).toLocaleDateString('it-IT', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
            })
            : 'N/A'
        const newDropoff = new Date(booking.dropoff_date).toLocaleDateString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
        })

        page.drawText(`Data Ritiro Originale: ${originalPickup}`, { x: 50, y, size: 11, font: fontRegular, color: black })
        y -= 20
        page.drawText(`Data Riconsegna Precedente: ${previousDropoff}`, { x: 50, y, size: 11, font: fontRegular, color: black })
        y -= 20
        page.drawText(`NUOVA Data Riconsegna: ${newDropoff}`, { x: 50, y, size: 11, font: fontBold, color: gold })
        y -= 35

        // Calculate extension days
        if (latestExtension.previous_dropoff) {
            const prevDate = new Date(latestExtension.previous_dropoff)
            const newDate = new Date(booking.dropoff_date)
            const extensionDays = Math.ceil((newDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
            page.drawText(`Giorni di Estensione: ${extensionDays}`, { x: 50, y, size: 11, font: fontRegular, color: black })
            y -= 25
        }

        // Financial
        y -= 15
        page.drawText('IMPORTO ESTENSIONE', { x: 50, y, size: 12, font: fontBold, color: black })
        y -= 25

        const additionalAmount = latestExtension.additional_amount || 0
        page.drawText(`Importo Aggiuntivo: €${additionalAmount.toFixed(2)}`, { x: 50, y, size: 14, font: fontBold, color: gold })
        y -= 25

        const newTotal = (booking.price_total / 100)
        page.drawText(`Nuovo Totale Noleggio: €${newTotal.toFixed(2)}`, { x: 50, y, size: 11, font: fontRegular, color: black })
        y -= 40

        // Notes if present
        if (latestExtension.notes) {
            page.drawText('NOTE', { x: 50, y, size: 12, font: fontBold, color: black })
            y -= 25
            page.drawText(latestExtension.notes, { x: 50, y, size: 10, font: fontRegular, color: gray })
            y -= 40
        }

        // Divider
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: gold })
        y -= 30

        // Terms
        page.drawText('CONDIZIONI', { x: 50, y, size: 12, font: fontBold, color: black })
        y -= 25
        const terms = [
            'Il presente addendum modifica esclusivamente la data di riconsegna del veicolo.',
            'Tutte le altre condizioni del contratto originale rimangono invariate.',
            'Le coperture assicurative esistenti sono estese fino alla nuova data di riconsegna.',
            'Il cliente si impegna a riconsegnare il veicolo entro la nuova data stabilita.',
            'Eventuali ulteriori estensioni dovranno essere concordate preventivamente.'
        ]

        for (const term of terms) {
            page.drawText(`• ${term}`, { x: 50, y, size: 9, font: fontRegular, color: gray, maxWidth: width - 100 })
            y -= 18
        }

        y -= 30

        // Signature section
        page.drawText('FIRME', { x: 50, y, size: 12, font: fontBold, color: black })
        y -= 40

        // Two columns for signatures
        page.drawText('Il Locatore (DR7)', { x: 50, y, size: 10, font: fontRegular, color: black })
        page.drawText('Il Locatario', { x: 350, y, size: 10, font: fontRegular, color: black })
        y -= 50
        page.drawLine({ start: { x: 50, y }, end: { x: 200, y }, thickness: 0.5, color: black })
        page.drawLine({ start: { x: 350, y }, end: { x: 500, y }, thickness: 0.5, color: black })

        // Footer
        y = 50
        page.drawText('DR7 Autonoleggio - Viale Marconi 229, 09131 Cagliari - P.IVA: 03837550922',
            { x: 50, y, size: 8, font: fontRegular, color: gray })
        page.drawText(`Documento generato il ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`,
            { x: 50, y: y - 12, size: 8, font: fontRegular, color: gray })

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
