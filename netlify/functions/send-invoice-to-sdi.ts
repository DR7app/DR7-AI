import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { indirizzoUtilizzabile, cercaIndirizzoAltrove, riparaIndirizzo } from './utils/indirizzoCliente'
import { generateFatturaXML, generateInvoiceFilename } from './xml-utils'
import { uploadInvoiceToAruba } from './aruba-utils'
// System Control: la fattura non trasmessa diventa un'operazione visibile e
// ripetibile dal pannello. VOLUTAMENTE `automatica: false` — un ritentativo
// automatico rinumererebbe la fattura e potrebbe mandarne una seconda allo
// SDI. La ripresa la decide una persona.
import { registraEvento, accodaOperazione, chiudiOperazione, segnaChiamata } from './utils/systemControl'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invoice ID is required' }) }
        }

        // Fetch invoice from database
        const { data: invoice, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !invoice) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) }
        }

        // Test-vehicle guard: if the linked booking is on a test vehicle
        // (vehicle_name 'test' OR plate starting with 'TEST', e.g. TEST000,
        // TEST002), refuse to push to SDI — danni/penali fatture for test
        // bookings must stay local (PDF-only via WhatsApp). Mirrors the
        // auto-skip already in generate-invoice-from-booking.ts and
        // generate-penalty-invoice.ts.
        if (invoice.booking_id) {
            const { data: testBooking } = await supabase
                .from('bookings')
                .select('vehicle_name, vehicle_plate, booking_details')
                .eq('id', invoice.booking_id)
                .maybeSingle()
            if (testBooking) {
                const tName = String(testBooking.vehicle_name || testBooking.booking_details?.vehicle?.name || '').toLowerCase()
                const tPlate = String(testBooking.vehicle_plate || testBooking.booking_details?.vehicle_plate || testBooking.booking_details?.vehicle?.plate || '').toUpperCase()
                if (tName === 'test' || tPlate.startsWith('TEST')) {
                    console.log(`[SDI] Test vehicle (plate=${tPlate}) — refusing manual SDI dispatch for invoice ${invoice.numero_fattura}`)
                    return {
                        statusCode: 200,
                        body: JSON.stringify({
                            success: false,
                            skipped: true,
                            reason: 'test_vehicle',
                            message: 'Veicolo di test: invio SDI bloccato. La fattura resta in bozza locale.'
                        })
                    }
                }
            }
        }

        // If invoice was previously sent/uploaded, ALWAYS assign a NEW number
        // This prevents SDI error 00404 (fattura duplicata) when retrying
        const needsNewNumber = invoice.sdi_status === 'rejected' ||
            invoice.sdi_status === 'scartata' ||
            invoice.sdi_status === 'error' ||
            invoice.sdi_status === 'sending' ||
            invoice.sdi_status === 'sent' ||
            invoice.sdi_status === 'accepted' ||
            invoice.aruba_invoice_id // was already uploaded before

        if (needsNewNumber) {
            const currentYear = new Date().getFullYear()
            let newNumber = ''

            // Retry loop: ensure the new number doesn't already exist in DB
            for (let attempt = 0; attempt < 5; attempt++) {
                const { data: seqResult, error: seqError } = await supabase.rpc('next_invoice_number', { p_year: currentYear })

                if (seqError || seqResult == null) {
                    console.error('[SDI] Sequence error on retry:', seqError)
                    return {
                        statusCode: 500,
                        body: JSON.stringify({ error: 'Failed to generate new invoice number for retry', details: seqError?.message })
                    }
                }

                const candidate = `DR7-${currentYear}-${String(seqResult).padStart(4, '0')}`
                const { data: existing } = await supabase.from('fatture').select('id').eq('numero_fattura', candidate).maybeSingle()
                if (!existing) {
                    newNumber = candidate
                    break
                }
                console.warn(`[SDI] Number ${candidate} already exists, retrying...`)
            }

            if (!newNumber) {
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: 'Failed to generate unique invoice number after 5 attempts' })
                }
            }

            console.log(`[SDI] Re-send: ${invoice.numero_fattura} → new number ${newNumber}`)

            await supabase.from('fatture').update({
                numero_fattura: newNumber,
                sdi_status: 'draft'
            }).eq('id', invoiceId)

            invoice.numero_fattura = newNumber
        }

        // Re-fetch fresh customer data from customers_extended via booking
        // This ensures that if admin updated the customer profile, the fattura uses the latest info
        if (invoice.booking_id) {
            const { data: booking } = await supabase
                .from('bookings')
                .select('user_id, customer_name, customer_email, customer_phone, booking_details')
                .eq('id', invoice.booking_id)
                .single()

            if (booking) {
                const custId = booking.booking_details?.customer?.customerId || booking.user_id
                const custEmail = booking.customer_email || booking.booking_details?.customer?.email

                let customerData: any = null

                // Try by ID first
                if (custId) {
                    const { data } = await supabase.from('customers_extended').select('*').eq('id', custId).maybeSingle()
                    if (data) customerData = data
                    if (!customerData) {
                        const { data: byUserId } = await supabase.from('customers_extended').select('*').eq('user_id', custId).maybeSingle()
                        if (byUserId) customerData = byUserId
                    }
                }

                // Fallback by email
                if (!customerData && custEmail) {
                    const { data } = await supabase.from('customers_extended').select('*').eq('email', custEmail).maybeSingle()
                    if (data) customerData = data
                }

                if (customerData) {
                    // Build fresh address
                    // 2026-08-17: qui l'ordine era `indirizzo || sede_legale`, cioe'
                    // l'esatto contrario della regola applicata in
                    // generate-invoice-from-booking dal 20/06. Su un record azienda
                    // `indirizzo` e i campi *_residenza sono della PERSONA FISICA
                    // (rappresentante o vecchio merge): il reinvio manuale "Invia
                    // SDI" riscriveva quindi l'indirizzo dell'azienda con quello
                    // personale, annullando la correzione appena fatta in anagrafica.
                    // Azienda -> SEMPRE sede legale (o operativa), e nient'altro.
                    const isBusiness = customerData.tipo_cliente === 'azienda'
                    const sedeAzienda = isBusiness
                        ? (customerData.sede_legale || customerData.sede_operativa || '')
                        : ''
                    // Rete di sicurezza per i record azienda storici senza sede
                    // legale: meglio l'unico indirizzo presente che nessuna fattura.
                    const usaAnagrafica = !isBusiness || !sedeAzienda
                    const street = isBusiness
                        ? (sedeAzienda || customerData.indirizzo || '')
                        : (customerData.indirizzo || customerData.sede_legale || '')
                    const num = usaAnagrafica ? (customerData.numero_civico || '') : ''
                    const zip = usaAnagrafica ? (customerData.codice_postale || customerData.cap || '') : ''
                    const city = usaAnagrafica ? (customerData.citta_residenza || customerData.citta || '') : ''
                    const prov = usaAnagrafica ? (customerData.provincia_residenza || customerData.provincia || '').toUpperCase().trim() : ''

                    const addressParts: string[] = []
                    if (street) addressParts.push(num ? `${street} ${num}` : street)
                    if (city || zip) {
                        let cityLine = ''
                        if (zip) cityLine += zip
                        if (city) cityLine += (cityLine ? ' ' : '') + city
                        if (prov) cityLine += ` (${prov})`
                        if (cityLine) addressParts.push(cityLine)
                    }
                    const freshAddress = addressParts.join(', ')

                    // Anche la PA si intesta con la denominazione dell'ente, non
                    // col nome di una persona fisica (stessa regola gia' scritta
                    // in generate-invoice-from-booking).
                    const freshName = (customerData.tipo_cliente === 'azienda' || customerData.tipo_cliente === 'pubblica_amministrazione')
                        ? (customerData.ragione_sociale || customerData.denominazione || invoice.customer_name)
                        : `${customerData.nome || ''} ${customerData.cognome || ''}`.trim() || invoice.customer_name
                    const freshTaxCode = (customerData.codice_fiscale || '').toUpperCase().trim()
                    const freshVat = (customerData.partita_iva || '').toUpperCase().trim()
                    const freshEmail = customerData.email || invoice.customer_email || ''
                    const freshPhone = customerData.telefono || invoice.customer_phone || ''

                    // Update fatture row with fresh customer data
                    const updates: Record<string, any> = {}
                    if (freshName && freshName !== invoice.customer_name) updates.customer_name = freshName
                    if (freshAddress && freshAddress !== invoice.customer_address) updates.customer_address = freshAddress
                    if (freshTaxCode && freshTaxCode !== (invoice.customer_tax_code || '').toUpperCase().trim()) updates.customer_tax_code = freshTaxCode
                    if (freshVat && freshVat !== (invoice.customer_vat || '').toUpperCase().trim()) updates.customer_vat = freshVat
                    if (freshEmail && freshEmail !== invoice.customer_email) updates.customer_email = freshEmail
                    if (freshPhone && freshPhone !== invoice.customer_phone) updates.customer_phone = freshPhone

                    if (Object.keys(updates).length > 0) {
                        console.log('[SDI] Refreshing customer data on fattura:', updates)
                        await supabase.from('fatture').update(updates).eq('id', invoiceId)
                        // Apply to in-memory invoice for XML generation
                        Object.assign(invoice, updates)
                    }
                }
            }
        }

        // Normalize customer data (fix lowercase CF/P.IVA/provincia that SDI rejects)
        const normalizedTaxCode = (invoice.customer_tax_code || '').toUpperCase().trim()
        const normalizedVat = (invoice.customer_vat || '').toUpperCase().trim()
        // Fix provincia in address: (Ss) → (SS), (ca) → (CA)
        const normalizedAddress = (invoice.customer_address || '').replace(/\(([A-Za-z]{2})\)/, (_: string, prov: string) => `(${prov.toUpperCase()})`)
        const needsUpdate = normalizedTaxCode !== invoice.customer_tax_code || normalizedVat !== invoice.customer_vat || normalizedAddress !== invoice.customer_address
        if (needsUpdate) {
            await supabase.from('fatture').update({
                customer_tax_code: normalizedTaxCode,
                customer_vat: normalizedVat,
                customer_address: normalizedAddress
            }).eq('id', invoiceId)
            invoice.customer_tax_code = normalizedTaxCode
            invoice.customer_vat = normalizedVat
            invoice.customer_address = normalizedAddress
        }

        // ─── Recupero intelligente dell'indirizzo ──────────────────────────
        // 2026-08-28: se l'indirizzo sulla fattura non basta per l'XML, prima
        // di bloccare tutto si cerca un indirizzo REALE dello stesso cliente
        // altrove (fattura gia' accettata dal SDI, doppione in anagrafica,
        // dati della prenotazione). Niente indirizzi inventati: se non esiste
        // da nessuna parte, la fattura resta ferma col motivo.
        if (!indirizzoUtilizzabile(invoice.customer_address || '')) {
            // Prima di andare a cercare altrove: l'indirizzo che c'e' e' quasi
            // sempre giusto e gli manca solo il CAP ("QUARTU SANT' ELENA VIA
            // SERRA PERDOSA 25"). Se il comune si riconosce, si ricompone.
            const riparato = riparaIndirizzo(invoice.customer_address || '')
            if (riparato.cambiato) {
                console.log(`[SDI] Indirizzo ricomposto dal comune ${riparato.comune}: ${riparato.indirizzo}`)
                await supabase.from('fatture').update({ customer_address: riparato.indirizzo }).eq('id', invoiceId)
                invoice.customer_address = riparato.indirizzo
            }
        }

        if (!indirizzoUtilizzabile(invoice.customer_address || '')) {
            let bookingCustomer: any = null
            if (invoice.booking_id) {
                const { data: b } = await supabase
                    .from('bookings')
                    .select('booking_details')
                    .eq('id', invoice.booking_id)
                    .maybeSingle()
                bookingCustomer = b?.booking_details?.customer || null
            }
            const trovato = await cercaIndirizzoAltrove(supabase, {
                invoiceId: invoiceId,
                codiceFiscale: invoice.customer_tax_code || '',
                partitaIva: invoice.customer_vat || '',
                email: (invoice.customer_email || '').toLowerCase().trim(),
            }, bookingCustomer)

            if (trovato) {
                // Anche l'indirizzo trovato altrove puo' essere senza CAP.
                const sistemato = riparaIndirizzo(trovato.indirizzo)
                const finale = sistemato.cambiato ? sistemato.indirizzo : trovato.indirizzo
                console.log(`[SDI] Indirizzo recuperato da ${trovato.fonte}: ${finale}`)
                await supabase.from('fatture').update({ customer_address: finale }).eq('id', invoiceId)
                invoice.customer_address = finale
            }
        }

        // For nota di credito, add TD04 fields and fetch the original invoice reference
        if (invoice.tipo_fattura === 'nota_di_credito' && invoice.related_invoice_id) {
            const { data: originalInvoice } = await supabase
                .from('fatture')
                .select('numero_fattura, data_emissione')
                .eq('id', invoice.related_invoice_id)
                .single()

            if (originalInvoice) {
                invoice.tipo_documento = 'TD04'
                invoice.riferimento_fattura_numero = originalInvoice.numero_fattura
                invoice.riferimento_fattura_data = originalInvoice.data_emissione
            }
        }

        // 1. Generate XML
        // 2026-08-28: prima un XML non generabile (tipico: sede legale del
        // cliente incompleta) finiva nel catch generico -> 500 "Internal
        // server error" e la fattura restava Bozza senza spiegazione. Ora il
        // motivo torna al chiamante E finisce su sdi_response.auto_send_error,
        // lo stesso campo che il tab Fatture mostra sotto il badge.
        let xmlContent: string
        let filename: string
        try {
            xmlContent = generateFatturaXML(invoice as any)
            filename = generateInvoiceFilename(invoice as any)
        } catch (xmlError: any) {
            const motivo = String(xmlError?.message || xmlError)
            console.error('[SDI] XML non generabile:', motivo)
            // sdi_status resta 'draft': la fattura non e' mai uscita, quindi
            // NON deve prendere un nuovo numero al reinvio.
            await supabase.from('fatture').update({
                sdi_response: { auto_send_error: motivo, at: new Date().toISOString() }
            }).eq('id', invoiceId)
            await supabase.from('invoice_status_logs').insert({
                invoice_id: invoiceId,
                status: 'draft',
                message: motivo,
                raw_response: { xml_error: motivo }
            })
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'XML non generabile', message: motivo })
            }
        }

        console.log('[Aruba] Generated XML:', filename)

        // 2. Upload to Aruba
        let arubaResult
        try {
            arubaResult = await uploadInvoiceToAruba(xmlContent, filename)
            console.log('[Aruba] Upload success:', arubaResult)
        } catch (apiError: any) {
            console.error('[Aruba] API Error:', apiError)

            // ── System Control ────────────────────────────────────────────
            await segnaChiamata('aruba_sdi', false, { errore: String(apiError?.message || apiError) })
            const gruppo = await registraEvento({
                messaggio: `Fattura ${invoice.numero_fattura} non trasmessa allo SDI: ${apiError?.message || apiError}`,
                categoria: 'fatturazione', modulo: 'Fatture', funzione: 'send-invoice-to-sdi',
                integrazione: 'aruba_sdi', severita: 'alto',
                contesto: { invoiceId, numero: invoice.numero_fattura },
            })
            await accodaOperazione({
                tipo: 'fattura_sdi',
                chiaveIdempotenza: `sdi:${invoiceId}`,
                descrizione: `Fattura ${invoice.numero_fattura} da trasmettere allo SDI`,
                integrazione: 'aruba_sdi', entitaTipo: 'fattura', entitaId: String(invoiceId),
                endpoint: 'send-invoice-to-sdi', payload: { invoiceId },
                errore: String(apiError?.message || apiError),
                gruppoId: gruppo.gruppoId, automatica: false,
            })

            // Log error to new status table
            await supabase.from('invoice_status_logs').insert({
                invoice_id: invoiceId,
                status: 'error',
                message: apiError.message,
                raw_response: { error: apiError.toString() }
            })

            // Update main table
            await supabase.from('fatture').update({
                sdi_status: 'error',
                sdi_response: { auto_send_error: String(apiError?.message || apiError), at: new Date().toISOString() }
            }).eq('id', invoiceId)

            return {
                statusCode: 502,
                body: JSON.stringify({ error: 'Failed to send to Aruba', details: apiError.message })
            }
        }

        // 3. Success - Update Database
        await segnaChiamata('aruba_sdi', true)
        await chiudiOperazione(`sdi:${invoiceId}`)
        await supabase
            .from('fatture')
            .update({
                sdi_status: 'sending', // Waiting for Aruba to process/SdI to accept
                aruba_invoice_id: arubaResult.id,
                xml_filename: filename,
                aruba_upload_filename: arubaResult.filename,
                sdi_sent_at: new Date().toISOString(),
                sdi_response: null // il motivo di blocco precedente non vale piu'
            })
            .eq('id', invoiceId)

        // 4. Log success
        await supabase.from('invoice_status_logs').insert({
            invoice_id: invoiceId,
            status: 'sending',
            message: 'Uploaded to Aruba',
            raw_response: arubaResult
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Invoice sent to Aruba successfully',
                aruba_id: arubaResult.id,
                filename: filename
            })
        }
    } catch (error: any) {
        console.error('Error in send-invoice-to-sdi:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}
