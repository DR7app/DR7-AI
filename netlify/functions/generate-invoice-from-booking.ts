import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateFatturaXML, generateInvoiceFilename } from './xml-utils'
import { uploadInvoiceToAruba } from './aruba-utils'
import { generateInvoicePDF } from './invoice-pdf-utils'
import { renderTemplate } from './utils/messageTemplates'
import { requireAuth } from './require-auth'
import { computeRentalBillingDays } from './utils/computeRentalBillingDays'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Load the IVA rate (%) from Centralina Pro
 * (centralina_pro_config.config.fiscal.vat_rate). Falls back to 22 if the
 * config row is missing, the fiscal section was never saved, or the value
 * is out of the [0, 100] range.
 */
async function loadVatRate(): Promise<number> {
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config ?? null) as Record<string, unknown> | null
        const fiscal = cfg?.fiscal as Record<string, unknown> | undefined
        const rate = fiscal?.vat_rate
        if (typeof rate === 'number' && rate >= 0 && rate <= 100) return rate
        return 22
    } catch {
        return 22
    }
}

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

// Invoicetronic SDI Configuration
const INVOICETRONIC_API_KEY = process.env.INVOICETRONIC_API_KEY || ''
const INVOICETRONIC_BASE_URL = process.env.INVOICETRONIC_BASE_URL || 'https://api.invoicetronic.com/v1'

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    // Parse body FIRST so wallet/membership purchase callbacks (server-to-server
    // from the website after a Nexi success) can take a capability-based path
    // without a Supabase JWT / admin token. Booking flow still requires auth.
    let body: Record<string, any> = {}
    try { body = JSON.parse(event.body || '{}') } catch { /* keep {} */ }
    const {
        bookingId,
        includeIVA = true,
        extensionAmount,
        includePenalties = false,
        includeExtensions,
        purchaseType,
        purchaseId,
        purchaseData,
    } = body

    // ── WALLET / CREDIT RECHARGE FATTURA (no auth required) ───────────────
    // Fired by website/generate-fattura.ts as a proxy from nexi-callback.js
    // when a wallet recharge payment succeeds. The purchaseId uuid + the
    // payment_status='succeeded' row in credit_wallet_purchases act as the
    // capability — no admin token needed (and website doesn't have one set).
    if (purchaseType === 'wallet_purchase' && purchaseId) {
        return handleWalletPurchaseFattura(purchaseId, purchaseData, !!includeIVA)
    }

    // Booking flow — require admin auth UNLESS this is a server-to-server
    // callback from the website's nexi-callback.js. The website doesn't have
    // ADMIN_API_TOKEN set in its Netlify env, so every booking fattura call
    // from there was failing 401 — silently — and no website Nexi booking
    // was getting a fattura. Capability check: a real bookingId whose row
    // has payment_status IN (paid/completed/succeeded) IS a valid caller.
    // The endpoint still rejects unpaid bookings below (line ~57) and is
    // idempotent against existing invoices, so this can't double-charge.
    const hasAuthHeader = !!(event.headers?.authorization || event.headers?.Authorization)
    if (hasAuthHeader) {
        const { error: authErr } = await requireAuth(event)
        if (authErr) return authErr
    } else if (!bookingId) {
        // No auth and no bookingId — reject (no legitimate use case)
        return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization header' }) }
    }
    // else: no auth but has bookingId → proceed; the payment_status guard
    // below (line ~57) is the capability check.

    try {

        if (!bookingId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Booking ID is required' })
            }
        }

        // Aliquota IVA dinamica da Centralina Pro (Fiscale > Aliquota IVA)
        const dynamicVatRate = await loadVatRate()

        // Fetch booking details
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Booking not found' })
            }
        }

        // Guard: never generate fattura for unpaid bookings
        const paymentStatus = booking.payment_status || ''
        if (paymentStatus !== 'paid' && paymentStatus !== 'completed' && paymentStatus !== 'succeeded') {
            console.log(`[Invoice] Skipping — booking ${bookingId} not paid (status: ${paymentStatus})`)
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Booking non pagato. Fattura non generata.' })
            }
        }

        // Guard: never generate fattura for Wallet / Credit / Gift Card payments.
        // Covers every label variant the codebase writes: "Credit Wallet" (admin UI),
        // "credit_wallet" (legacy snake_case), "Wallet", "credit", "Gift Card", etc.
        const paymentMethod = (booking.payment_method || '').toLowerCase().trim()
        const isWalletOrGift =
            paymentMethod === 'wallet'
            || paymentMethod === 'credit'
            || paymentMethod === 'credit wallet'
            || paymentMethod === 'credit_wallet'
            || paymentMethod === 'creditwallet'
            || paymentMethod === 'gift card'
            || paymentMethod === 'gift_card'
            || paymentMethod === 'giftcard'
            || paymentMethod.includes('wallet')
            || paymentMethod.includes('gift')
        if (isWalletOrGift) {
            console.log(`[Invoice] Skipping — booking ${bookingId} paid via "${booking.payment_method}" (no fattura for Wallet/Gift Card/Credit)`)
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Fattura non prevista per pagamenti con Wallet o Gift Card', skipped: true })
            }
        }

        // Test vehicle: generate fattura + WhatsApp PDF, but skip SDI
        const vehicleName = (booking.vehicle_name || booking.booking_details?.vehicle?.name || '').toLowerCase()
        const vehiclePlate = (booking.vehicle_plate || booking.booking_details?.vehicle_plate || booking.booking_details?.vehicle?.plate || '').toUpperCase()
        const isTestVehicle = vehicleName === 'test' || vehiclePlate.startsWith('TEST')

        // Fetch customer data with robust fallback (Logic from generate-contract.ts)
        const bookingDetails = booking.booking_details || {}
        // Priority order:
        // 1. booking.booking_details.customer.customerId (admin-created bookings)
        // 2. booking.user_id (website bookings)
        // 3. booking.customer_id (legacy)
        const customerId = bookingDetails.customer?.customerId || booking.user_id || booking.customer_id

        console.log('=== INVOICE GENERATION DEBUG ===')
        console.log('Booking ID:', bookingId)
        console.log('Looking for Customer ID:', customerId)
        console.log('Booking Email:', booking.customer_email)

        let customerData: any = null

        // 1. Try by all possible IDs (customerId from booking_details, user_id, customer_id)
        const idsToTry = [
            bookingDetails.customer?.customerId,
            booking.user_id,
            booking.customer_id
        ].filter((id: any) => id && id !== 'undefined')
        // Remove duplicates
        const uniqueIds = [...new Set(idsToTry)]

        for (const tryId of uniqueIds) {
            if (customerData) break
            console.log(`[Invoice] Trying customer lookup by ID: ${tryId}`)
            // Try by table PK first
            const { data, error: customerError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', tryId)
                .single()

            if (data) {
                customerData = data
                console.log(`✅ Found customer by ID: ${tryId}`)
            } else {
                if (customerError) console.warn(`Customer fetch error for ID ${tryId}:`, customerError.message)
                // Fallback: try by user_id (auth user ID — for website bookings)
                const { data: dataByUserId } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .eq('user_id', tryId)
                    .maybeSingle()
                if (dataByUserId) {
                    customerData = dataByUserId
                    console.log(`✅ Found customer by user_id: ${tryId}`)
                }
            }
        }

        // Resolve customer info from booking or booking_details fallback
        const resolvedEmail = booking.customer_email || booking.booking_details?.customer?.email
        const resolvedPhone = booking.customer_phone || booking.booking_details?.customer?.phone

        // 2. Fallback: Try by email in customers_extended
        if (!customerData && resolvedEmail) {
            console.log('Fallback: Fetching by email from customers_extended...')
            const { data, error } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', resolvedEmail)
                .single()

            if (data) {
                customerData = data
                console.log('✅ Found customer by Email (extended)')
            }
        }

        // 2b. Fallback: Try by customer_name in customers_extended
        if (!customerData && booking.customer_name) {
            console.log(`Fallback: Fetching by name from customers_extended: ${booking.customer_name}`)
            const nameParts = booking.customer_name.trim().split(/\s+/)
            if (nameParts.length >= 2) {
                const nome = nameParts.slice(0, -1).join(' ')
                const cognome = nameParts[nameParts.length - 1]
                const { data } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .ilike('nome', nome)
                    .ilike('cognome', cognome)
                    .limit(1)
                    .maybeSingle()
                if (data) {
                    customerData = data
                    console.log('✅ Found customer by Name (extended)')
                }
            }
        }

        // 3. Fallback: Try basic customers table
        if (!customerData && resolvedEmail) {
            console.log('Fallback: Fetching by email from basic customers...')
            const { data } = await supabase
                .from('customers')
                .select('*')
                .eq('email', resolvedEmail)
                .single()

            if (data) {
                console.log('✅ Found customer by Email (basic)')
                // Map basic customer to extended format roughly
                customerData = {
                    ...data,
                    fullName: data.full_name,
                    nome: data.full_name,
                    email: data.email,
                    telefono: data.phone,
                    indirizzo: data.notes, // Sometimes notes contain address? Or we just use what we have.
                    // metadata might have info
                    indirizzo_residenza: data.metadata?.address,
                    citta_residenza: data.metadata?.city,
                    codice_postale: data.metadata?.zip,
                    codiceFiscale: data.metadata?.taxCode || data.metadata?.fiscalCode
                }
            }
        }

        console.log('Final Customer Data present:', !!customerData)

        // Ensure customerData is at least an empty object if null, to avoid crashes later? 
        // No, we handle null checks downstream. Except we want to merge booking details if customerData is missing.

        if (!customerData) {
            console.log('⚠️ No customer record found. Will use booking details.')
            // We don't construct a fake object here because the downstream logic
            // explicitly checks "if (customerData) { ... } else { ... use booking details ... }"
            // But wait, my downstream logic in previous step was:
            // "if ((!fullAddress ...) && bookingCustomer.address)"
            // So we are good.
        }
        console.log('=== END DEBUG ===')

        // Build complete customer address
        let fullAddress = ''
        // bookingDetails is already declared above
        const bookingCustomer = bookingDetails.customer || {}

        // 1. Try customerData from database
        if (customerData) {
            const addressParts = []
            // Check various potential address fields
            const street = customerData.indirizzo || customerData.sede_legale || customerData.address || customerData.street || ''
            const num = customerData.numero_civico || customerData.streetNumber || ''
            const zip = customerData.codice_postale || customerData.cap || customerData.zipCode || customerData.zip || ''
            const city = customerData.citta_residenza || customerData.citta || customerData.city || ''
            const prov = (customerData.provincia_residenza || customerData.provincia || customerData.province || '').toUpperCase().trim()

            if (street) {
                let streetAddress = street
                if (num) streetAddress += ` ${num}`
                addressParts.push(streetAddress)
            }

            if (city || zip) {
                let cityLine = ''
                if (zip) cityLine += zip
                if (city) cityLine += (cityLine ? ' ' : '') + city
                if (prov) cityLine += ` (${prov})`
                if (cityLine) addressParts.push(cityLine)
            }

            fullAddress = addressParts.join(', ')
        }

        // 2. Fallback to booking details if address empty
        // This mirrors generate-contract.ts logic: clientAddress = customer?.indirizzo || booking...address
        if (!fullAddress || fullAddress.trim() === '') {
            fullAddress = bookingCustomer.address || ''
            if (bookingCustomer.city) fullAddress += `, ${bookingCustomer.city}`
            if (bookingCustomer.zip) fullAddress += ` ${bookingCustomer.zip}`
        }

        // Ensure tax fields are robustly fetched
        const taxCode = (customerData?.codiceFiscale || customerData?.codice_fiscale || customerData?.tax_code || bookingCustomer.taxCode || bookingCustomer.codiceFiscale || '').toUpperCase().trim()
        const vatNumber = (customerData?.partitaIva || customerData?.partita_iva || customerData?.vat_number || bookingCustomer.vatNumber || bookingCustomer.pIva || '').toUpperCase().trim()

        // Debug: log what was found for diagnostics
        const debugInfo = {
            customerId,
            customerFound: !!customerData,
            customerTable: customerData ? 'customers_extended' : 'none',
            dbFields: customerData ? {
                indirizzo: customerData.indirizzo || null,
                numero_civico: customerData.numero_civico || null,
                codice_postale: customerData.codice_postale || null,
                citta_residenza: customerData.citta_residenza || null,
                provincia_residenza: customerData.provincia_residenza || null,
                codice_fiscale: customerData.codice_fiscale || null,
                partita_iva: customerData.partita_iva || null,
            } : null,
            resolvedAddress: fullAddress,
            resolvedTaxCode: taxCode,
            resolvedVat: vatNumber,
            bookingCustomerKeys: Object.keys(bookingCustomer),
        }
        console.log('[Invoice] Validation debug:', JSON.stringify(debugInfo))

        // VALIDATION: Mandatory fields check
        if (!fullAddress || fullAddress.trim() === '') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Client data incomplete',
                    message: 'Indirizzo cliente obbligatorio. Aggiorna il profilo cliente o la prenotazione.',
                    details: `Address is missing. Debug: customerId=${customerId}, customerFound=${!!customerData}, dbIndirizzo=${customerData?.indirizzo || 'NULL'}, dbCitta=${customerData?.citta_residenza || 'NULL'}`
                })
            }
        }
        if (!taxCode && !vatNumber) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Client data incomplete',
                    message: 'Codice Fiscale o Partita IVA obbligatorio. Aggiorna il profilo cliente.',
                    details: `Tax Code/VAT missing. Debug: customerId=${customerId}, customerFound=${!!customerData}, dbCF=${customerData?.codice_fiscale || 'NULL'}, dbPIVA=${customerData?.partita_iva || 'NULL'}`
                })
            }
        }

        // For extensions, always create a NEW invoice (not update existing)
        // For regular bookings, update if one already exists
        let existingInvoice: any = null
        if (!extensionAmount) {
            const { data } = await supabase
                .from('fatture')
                .select('id, numero_fattura, sdi_status, aruba_invoice_id')
                .eq('booking_id', bookingId)
                .single()
            existingInvoice = data

            // If fattura already exists and was already sent to SDI, return it immediately
            if (existingInvoice && (existingInvoice.sdi_status === 'sending' || existingInvoice.sdi_status === 'sent' || existingInvoice.sdi_status === 'delivered' || existingInvoice.aruba_invoice_id)) {
                console.log(`[Invoice] Fattura ${existingInvoice.numero_fattura} already sent to SDI — returning existing`)
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        error: 'Fattura già inviata a SDI',
                        invoiceNumber: existingInvoice.numero_fattura,
                        message: `Fattura ${existingInvoice.numero_fattura} già esistente e inviata a SDI.`
                    })
                }
            }
        }

        let invoiceNumber: string

        if (existingInvoice) {
            invoiceNumber = existingInvoice.numero_fattura
        } else {
            // Atomic invoice numbering via DB sequence (prevents race-condition duplicates)
            // Retry loop: if the generated number already exists in DB, get the next one
            const currentYear = new Date().getFullYear()
            for (let attempt = 0; attempt < 5; attempt++) {
                const { data: seqResult, error: seqError } = await supabase.rpc('next_invoice_number', { p_year: currentYear })

                if (seqError || seqResult == null) {
                    console.error('[Invoice] Sequence error:', seqError)
                    throw new Error('Failed to generate invoice number: ' + (seqError?.message || 'sequence returned null'))
                }

                const candidate = `DR7-${currentYear}-${String(seqResult).padStart(4, '0')}`
                const { data: existing } = await supabase.from('fatture').select('id').eq('numero_fattura', candidate).maybeSingle()
                if (!existing) {
                    invoiceNumber = candidate
                    break
                }
                console.warn(`[Invoice] Number ${candidate} already exists, retrying...`)
            }
            if (!invoiceNumber) {
                throw new Error('Failed to generate unique invoice number after 5 attempts')
            }
        }


        // Create invoice items
        const items = []
        let rentalDays = 1

        // When includePenalties is true and main booking is already paid,
        // skip main items (they already have their own fattura) — only include penalties/danni
        const mainAlreadyPaid = booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded'
        const skipMainItems = includePenalties && mainAlreadyPaid

        if (skipMainItems) {
            // Main booking already invoiced — penalties/danni will be added below
        } else if (extensionAmount && extensionAmount > 0) {
            // Extension invoice: single line for the additional amount
            const extGross = extensionAmount // Amount in EUR, includes IVA
            const vatRate = includeIVA ? dynamicVatRate : 0
            const vatDivisor = 1 + dynamicVatRate / 100
            items.push({
                description: `Estensione noleggio ${booking.vehicle_name || ''} - ${booking.id.substring(0, 8).toUpperCase()}`,
                unit_price: extGross / vatDivisor,
                quantity: 1,
                vat_rate: vatRate,
                total: extGross / vatDivisor
            })
        } else if (booking.service_type === 'car_wash' || booking.service_type === 'mechanical') {
            // Logic for Services (Car Wash / Mechanical)
            // User confirmed prices INCLUDE IVA (Gross)
            const serviceName = booking.service_name || (booking.service_type === 'car_wash' ? 'Lavaggio Auto' : 'Intervento Meccanico')
            const totalServicePrice = (booking.price_total || 0) / 100

            // Always extract Net Price (the rate comes from Centralina Pro)
            const netPrice = totalServicePrice / (1 + dynamicVatRate / 100)
            const vatRate = includeIVA ? dynamicVatRate : 0

            items.push({
                description: `${serviceName} - Data: ${new Date(booking.appointment_date || booking.pickup_date).toLocaleDateString('it-IT')}`,
                unit_price: netPrice,
                quantity: 1,
                vat_rate: vatRate,
                total: netPrice // Line item logic downstream calculates total based on rate? No, mapped manually below.
                // Wait, the 'total' field in items array is usually (unit * qty). 
                // But generatesInvoiceHTML uses unit_price * quantity.
                // The 'total' property here in the object pushed to 'items' is used for subtotal calculation loop below?
                // Let's check lines 335+ "items.forEach..."
                // It uses "item.unit_price * item.quantity". So keys in object matter.
                // We should push the NET total into 'total' property? No, code doesn't use it.
            })
        } else {
            // Logic for Rentals (Default)
            // Parse booking dates
            const pickupDate = new Date(booking.pickup_date)
            const dropoffDate = new Date(booking.dropoff_date)
            // Allinea i giorni fatturati a quelli mostrati al cliente sul
            // sito (calendar diff + grace late-return da Centralina Pro).
            rentalDays = await computeRentalBillingDays(pickupDate, dropoffDate, supabase)
            if (rentalDays < 1) rentalDays = 1

            // Parse prices (assuming stored as cents)
            const priceTotal = (booking.price_total || 0) / 100
            const insuranceTotal = (bookingDetails.insurancePrice || 0) * rentalDays
            // Note: km_overage_fee is the per-km RATE (e.g. €1.80/km) for the contract,
            // NOT an actual charged penalty. Do not include it as a fattura line item.

            // Calculate Net Prices for components based on IVA inclusion
            const vatRate = includeIVA ? dynamicVatRate : 0
            // Always divide by (1 + IVA%) because prices are Gross (IVA Included).
            // Aliquota IVA letta da Centralina Pro > Fiscale.
            const vatDivisor = 1 + dynamicVatRate / 100

            const insurancePriceGross = insuranceTotal

            // Subtract insurance from total to get vehicle portion
            let rentalGross = priceTotal - insurancePriceGross
            if (rentalGross < 0) rentalGross = 0 // Safety check

            // 1. Vehicle Rental Item
            items.push({
                description: `Noleggio ${booking.vehicle_name} - ${rentalDays} giorni`,
                unit_price: rentalGross / vatDivisor, // Net Price
                quantity: 1,
                vat_rate: vatRate,
                total: (rentalGross / vatDivisor)
            })

            // 2. Insurance Item
            if (bookingDetails.insurance) {
                const insuranceName = bookingDetails.insurance.replace(/_/g, ' ')
                items.push({
                    description: `Assicurazione ${insuranceName} - ${rentalDays} giorni`,
                    unit_price: insurancePriceGross / vatDivisor,
                    quantity: 1,
                    vat_rate: vatRate,
                    total: (insurancePriceGross / vatDivisor)
                })
            }
        }

        // Include pending penalties and danni as line items (for "Segna Pagato Tutto")
        if (includePenalties) {
            const vatRate = includeIVA ? dynamicVatRate : 0
            const vatDivisor = 1 + dynamicVatRate / 100

            // Only include PENDING items (not already-paid ones that have their own fattura)
            const penalties = bookingDetails.penalties || []
            penalties.forEach((p: any) => {
                if (p.paymentStatus === 'pending') {
                    const gross = (p.total || (p.amount || 0) * (p.quantity || 1))
                    if (gross > 0) {
                        items.push({
                            description: `Penale: ${p.label || 'Penale'}`,
                            unit_price: gross / vatDivisor,
                            quantity: 1,
                            vat_rate: vatRate,
                            total: gross / vatDivisor
                        })
                    }
                }
            })

            const danni = bookingDetails.danni || []
            danni.forEach((d: any) => {
                if (d.paymentStatus === 'pending') {
                    const gross = (d.total || (d.amount || 0) * (d.quantity || 1))
                    if (gross > 0) {
                        items.push({
                            description: `Danno: ${d.label || 'Danno'}`,
                            unit_price: gross / vatDivisor,
                            quantity: 1,
                            vat_rate: vatRate,
                            total: gross / vatDivisor
                        })
                    }
                }
            })

            // Only include PENDING extension amounts
            const extensions = bookingDetails.extension_history || []
            extensions.forEach((ext: any) => {
                if (ext.payment_status === 'pending' && ext.additional_amount) {
                    const extGross = ext.additional_amount
                    items.push({
                        description: `Estensione noleggio ${booking.vehicle_name || ''}`,
                        unit_price: extGross / vatDivisor,
                        quantity: 1,
                        vat_rate: vatRate,
                        total: extGross / vatDivisor
                    })
                }
            })
        }

        // Include extensions as line items in the same fattura (all extensions, already marked paid)
        if (includeExtensions) {
            const extensions = bookingDetails.extension_history || []
            const vatRate = includeIVA ? dynamicVatRate : 0
            const vatDivisor = 1 + dynamicVatRate / 100
            extensions.forEach((ext: any) => {
                const extTotal = ext.additional_amount || 0
                if (extTotal > 0) {
                    let days = ext.additional_days
                    if (!days && ext.previous_dropoff && ext.new_dropoff) {
                        const prev = new Date(ext.previous_dropoff)
                        const next = new Date(ext.new_dropoff)
                        days = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
                    }
                    items.push({
                        description: `Estensione +${days || '?'}gg ${booking.vehicle_name || ''} - ${booking.id.substring(0, 8).toUpperCase()}`,
                        unit_price: extTotal / vatDivisor,
                        quantity: 1,
                        vat_rate: vatRate,
                        total: extTotal / vatDivisor
                    })
                }
            })
        }

        // Calculate totals
        let subtotal = 0
        let vatAmount = 0
        let exemptAmount = 0

        items.forEach(item => {
            const itemTotal = item.unit_price * item.quantity
            if (item.vat_rate === 0) {
                exemptAmount += itemTotal
            } else {
                subtotal += itemTotal
                vatAmount += itemTotal * (item.vat_rate / 100)
            }
        })

        const total = subtotal + vatAmount + exemptAmount

        // Skip fattura if total is 0
        if (total <= 0) {
            console.log('[Invoice] Total is €0 — skipping fattura generation')
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Importo totale €0 — fattura non generata', skipped: true })
            }
        }

        // Create invoice
        const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
        const invoiceData = {
            numero_fattura: invoiceNumber,
            data_emissione: italyDate,
            importo_totale: total,
            stato: includePenalties ? 'paid' :
                (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded') ? 'paid' :
                booking.payment_status === 'pending' ? 'pending' : 'unpaid',
            customer_name: booking.customer_name || booking.booking_details?.customer?.fullName || customerData?.ragione_sociale || customerData?.denominazione || customerData?.fullName || bookingCustomer.fullName || (customerData?.nome ? `${customerData.nome} ${customerData.cognome || ''}`.trim() : null) || 'Cliente',
            customer_address: fullAddress || '',
            customer_phone: customerData?.telefono || customerData?.phone || bookingCustomer.phone || resolvedPhone || '',
            customer_email: customerData?.email || bookingCustomer.email || resolvedEmail || '',
            customer_tax_code: taxCode,
            customer_vat: vatNumber,
            booking_id: bookingId,
            items,
            subtotal,
            vat_amount: vatAmount,
            exempt_amount: exemptAmount,
            sdi_status: 'draft',
            updated_at: new Date().toISOString()
        }

        const { data: invoice, error: insertError } = existingInvoice
            ? await supabase
                .from('fatture')
                .update(invoiceData)
                .eq('id', existingInvoice.id)
                .select()
                .single()
            : await supabase
                .from('fatture')
                .insert([invoiceData])
                .select()
                .single()

        if (insertError) {
            throw insertError
        }

        // Auto-send to SDI via Aruba if customer has tax code (skip for test vehicles)
        if (isTestVehicle) {
            console.log('[Invoice] Test vehicle — skipping SDI, will send PDF via WhatsApp only')
        } else if (invoice.customer_tax_code) {
            try {
                const xmlContent = generateFatturaXML(invoice as any)
                const filename = generateInvoiceFilename(invoice as any)
                const arubaResult = await uploadInvoiceToAruba(xmlContent, filename)

                await supabase.from('fatture').update({
                    sdi_status: 'sending',
                    aruba_invoice_id: arubaResult.id,
                    xml_filename: filename,
                    aruba_upload_filename: arubaResult.filename,
                    sdi_sent_at: new Date().toISOString()
                }).eq('id', invoice.id)

                console.log('[Invoice] Auto-sent to SDI via Aruba:', arubaResult.id)
            } catch (sdiError: any) {
                console.error('[Invoice] Auto-SDI failed (invoice still saved as draft):', sdiError.message)
                // Invoice is saved, SDI send failed — user can retry via "Invia SDI" button
            }
        } else {
            console.log('[Invoice] No tax code — saved as draft. Ready for manual Aruba upload.')
        }

        // --- Generate PDF, upload to storage, send via WhatsApp ---
        let pdfUrl: string | null = null
        try {
            const pdfBytes = await generateInvoicePDF(invoice as any)
            const pdfFileName = `fattura_${invoice.numero_fattura.replace(/\//g, '-')}_${Date.now()}.pdf`

            const { error: uploadError } = await supabase.storage
                .from('invoices')
                .upload(pdfFileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

            if (uploadError) {
                console.error('[Invoice] PDF storage upload failed:', uploadError.message)
            } else {
                const { data: { publicUrl } } = supabase.storage
                    .from('invoices')
                    .getPublicUrl(pdfFileName)

                pdfUrl = publicUrl
                console.log('[Invoice] PDF uploaded to storage:', pdfUrl)

                // Save pdf_url to fatture record
                await supabase.from('fatture').update({ pdf_url: pdfUrl }).eq('id', invoice.id)

                // Send PDF via WhatsApp to customer
                const customerPhone = invoice.customer_phone || resolvedPhone || ''
                if (customerPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    // Normalize phone: strip +, spaces, dashes, parens → remove leading 00 → if 10 digits prepend 39
                    let cleanPhone = customerPhone.replace(/[\s\-\+\(\)]/g, '')
                    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
                    if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

                    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`
                    const waResponse = await fetch(greenApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${cleanPhone}@c.us`,
                            urlFile: pdfUrl,
                            fileName: `Fattura_${invoice.numero_fattura}.pdf`,
                            caption: (await renderTemplate('invoice_pdf_whatsapp', { numero_fattura: invoice.numero_fattura })) ?? ''
                        })
                    })

                    const waResult = await waResponse.json()
                    if (waResponse.ok && !waResult.error) {
                        console.log('[Invoice] Fattura PDF sent via WhatsApp:', waResult.idMessage)
                    } else {
                        console.error('[Invoice] WhatsApp send failed:', waResult)
                    }
                } else {
                    if (!customerPhone) console.log('[Invoice] No customer phone — skipping WhatsApp PDF send')
                    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) console.log('[Invoice] Green API not configured — skipping WhatsApp PDF send')
                }
            }
        } catch (pdfError: any) {
            console.error('[Invoice] PDF generation/send failed (invoice still saved):', pdfError.message)
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                invoice: invoice,
                pdfUrl,
                message: 'Invoice generated successfully'
            })
        }
    } catch (error: any) {
        console.error('Error generating invoice:', error)
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        })
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to generate invoice',
                message: error.message,
                details: error.details || 'No additional details',
                hint: error.hint || 'Check Netlify function logs for more info'
            })
        }
    }
}

// Address parsing moved to xml-utils.ts

// ── Wallet recharge fattura ──────────────────────────────────────────────
// Separate code path from the booking flow. Called server-to-server from the
// website's nexi-callback after a successful wallet top-up payment. Validates
// the purchase by uuid + payment_status, idempotent via the 'booking_id'-less
// row match on notes, creates a fattura with a single "Ricarica Credit Wallet"
// line item, then attempts the SDI send.
async function handleWalletPurchaseFattura(
    purchaseId: string,
    purchaseData: Record<string, any> | null | undefined,
    includeIVA: boolean,
): Promise<{ statusCode: number; body: string }> {
    try {
        // Aliquota IVA dinamica da Centralina Pro (Fiscale > Aliquota IVA)
        const dynamicVatRate = await loadVatRate()
        // 1. Validate purchase + succeeded status
        const { data: purchase, error: purchErr } = await supabase
            .from('credit_wallet_purchases')
            .select('*')
            .eq('id', purchaseId)
            .single()

        if (purchErr || !purchase) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Wallet purchase not found', purchaseId })
            }
        }
        if (purchase.payment_status !== 'succeeded') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: `Purchase not paid (status: ${purchase.payment_status})` })
            }
        }

        // 2. Look up customer (fiscal data) — try id, user_id in customers_extended.
        // Moved ABOVE the idempotency check so we can backfill PDF+WhatsApp on an
        // existing fattura that was created before PDF/WhatsApp was wired up.
        const userId = purchase.user_id
        let customerData: any = null
        if (userId) {
            const { data: byId } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', userId)
                .maybeSingle()
            customerData = byId
            if (!customerData) {
                const { data: byUserId } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .eq('user_id', userId)
                    .maybeSingle()
                customerData = byUserId
            }
        }

        // 3. Idempotency: if a fattura already exists for this purchase, skip
        // re-creating it — but backfill PDF + WhatsApp when they are missing.
        const notesMarker = `wallet_purchase:${purchaseId}`
        const { data: existingFattura } = await supabase
            .from('fatture')
            .select('*')
            .eq('note', notesMarker)
            .maybeSingle()
        if (existingFattura) {
            console.log(`[Wallet Fattura] Already generated for ${purchaseId}: ${existingFattura.numero_fattura}`)

            if (!existingFattura.pdf_url) {
                console.log('[Wallet Fattura] Existing fattura has no PDF — backfilling PDF + WhatsApp now')
                const backfilledUrl = await sendWalletFatturaPdfAndWhatsApp(existingFattura, customerData)
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: 'Fattura already existed — PDF and WhatsApp backfilled',
                        invoice: { ...existingFattura, pdf_url: backfilledUrl },
                        backfilled: true
                    })
                }
            }

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Fattura already exists', invoice: existingFattura, skipped: true })
            }
        }

        // 4. Amount — customer paid `recharge_amount` on card (GROSS, IVA included).
        // `received_amount` is the credited total (recharge + package bonus) and is
        // NOT what the customer paid, so it must not be used for the invoice.
        const paidAmount = Number(
            purchase.recharge_amount
            ?? purchaseData?.amount
            ?? purchaseData?.rechargeAmount
            ?? 0
        )
        if (!(paidAmount > 0)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid purchase amount (0 or missing)' })
            }
        }

        // Admin-typed amounts in this project are GROSS (IVA included) per memory
        const vatRate = includeIVA ? dynamicVatRate : 0
        const vatDivisor = includeIVA ? 1 + dynamicVatRate / 100 : 1
        const netUnit = Number((paidAmount / vatDivisor).toFixed(2))
        const packageName = purchase.package_name || purchaseData?.packageName || 'Ricarica'
        const bonusPct = Number(purchase.bonus_percentage ?? purchaseData?.bonusPercentage ?? 0)
        const receivedAmount = Number(purchase.received_amount ?? purchaseData?.receivedAmount ?? paidAmount)

        const descr = bonusPct > 0
            ? `Ricarica Credit Wallet — ${packageName} (bonus ${bonusPct}% → €${receivedAmount.toFixed(2)} accreditati)`
            : `Ricarica Credit Wallet — ${packageName}`

        const items = [{
            description: descr,
            unit_price: netUnit,
            quantity: 1,
            vat_rate: vatRate,
            total: netUnit,
        }]
        const subtotal = netUnit
        // GROSS-inclusive: total MUST equal paidAmount exactly. Computing VAT
        // as `gross - net` absorbs the GROSS→NET rounding error (1 cent) into
        // the VAT field instead of the total, so the customer's €2000 stays €2000.
        const total = paidAmount
        const vatAmount = Number((total - subtotal).toFixed(2))
        const exemptAmount = 0

        // 5. Generate unique invoice number (atomic RPC + retry loop, like booking flow)
        const currentYear = new Date().getFullYear()
        let invoiceNumber = ''
        for (let attempt = 0; attempt < 5; attempt++) {
            const { data: seqResult, error: seqError } = await supabase.rpc('next_invoice_number', { p_year: currentYear })
            if (seqError || seqResult == null) {
                console.error('[Wallet Fattura] Sequence error:', seqError)
                return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate invoice number' }) }
            }
            const candidate = `DR7-${currentYear}-${String(seqResult).padStart(4, '0')}`
            const { data: exist } = await supabase.from('fatture').select('id').eq('numero_fattura', candidate).maybeSingle()
            if (!exist) { invoiceNumber = candidate; break }
        }
        if (!invoiceNumber) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate unique invoice number' }) }
        }

        // 6. Build customer address block
        const addressParts = [
            customerData?.indirizzo,
            customerData?.codice_postale || customerData?.cap,
            customerData?.citta,
            customerData?.provincia,
        ].filter(Boolean)
        const fullAddress = addressParts.join(' ')

        const customerName = customerData?.nome
            ? `${customerData.nome} ${customerData.cognome || ''}`.trim()
            : (customerData?.ragione_sociale || customerData?.denominazione || customerData?.fullName || 'Cliente')

        const italyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
        const invoiceData: Record<string, any> = {
            numero_fattura: invoiceNumber,
            data_emissione: italyDate,
            importo_totale: total,
            stato: 'paid',
            customer_name: customerName,
            customer_address: fullAddress,
            customer_phone: customerData?.telefono || customerData?.phone || '',
            customer_email: customerData?.email || '',
            customer_tax_code: customerData?.codice_fiscale || '',
            customer_vat: customerData?.partita_iva || '',
            booking_id: null,
            items,
            subtotal,
            vat_amount: vatAmount,
            exempt_amount: exemptAmount,
            sdi_status: 'draft',
            note: notesMarker,
            updated_at: new Date().toISOString(),
        }

        const { data: invoice, error: insertError } = await supabase
            .from('fatture')
            .insert([invoiceData])
            .select()
            .single()

        if (insertError || !invoice) {
            console.error('[Wallet Fattura] Insert failed:', insertError)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to insert fattura', details: insertError?.message })
            }
        }

        // 6b. Generate PDF + send WhatsApp (non-blocking — fattura stays saved
        // even if these fail; can be retried by hitting the endpoint again).
        const walletPdfUrl = await sendWalletFatturaPdfAndWhatsApp(invoice as any, customerData)

        // 7. Attempt SDI send (best-effort — fattura stays as draft if it fails)
        if (invoice.customer_tax_code) {
            try {
                const xmlContent = generateFatturaXML(invoice as any)
                const filename = generateInvoiceFilename(invoice as any)
                const arubaResult = await uploadInvoiceToAruba(xmlContent, filename)
                await supabase.from('fatture').update({
                    sdi_status: 'sending',
                    aruba_invoice_id: arubaResult.id,
                    xml_filename: filename,
                    aruba_upload_filename: arubaResult.filename,
                    sdi_sent_at: new Date().toISOString(),
                }).eq('id', invoice.id)
                console.log('[Wallet Fattura] Sent to SDI:', arubaResult.id)
            } catch (sdiErr: any) {
                console.error('[Wallet Fattura] SDI send failed (fattura saved as draft):', sdiErr?.message)
            }
        } else {
            console.log('[Wallet Fattura] No customer tax code — skipping SDI')
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, invoice, pdfUrl: walletPdfUrl, message: 'Wallet purchase fattura generated' })
        }
    } catch (error: any) {
        console.error('[Wallet Fattura] Unexpected error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Unexpected error', stack: error.stack })
        }
    }
}

/**
 * Generate the PDF for a wallet-recharge fattura, store it, and deliver it
 * via WhatsApp to the customer's phone number. Called for both newly-created
 * fatture and for backfills (existing fattura with no pdf_url).
 * Returns the public pdf_url, or null if upload failed.
 */
async function sendWalletFatturaPdfAndWhatsApp(
    invoice: any,
    customerData: any
): Promise<string | null> {
    try {
        const pdfBytes = await generateInvoicePDF(invoice)
        const pdfFileName = `fattura_${invoice.numero_fattura.replace(/\//g, '-')}_${Date.now()}.pdf`

        const { error: uploadError } = await supabase.storage
            .from('invoices')
            .upload(pdfFileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) {
            console.error('[Wallet Fattura PDF] Storage upload failed:', uploadError.message)
            return null
        }

        const { data: { publicUrl } } = supabase.storage
            .from('invoices')
            .getPublicUrl(pdfFileName)

        console.log('[Wallet Fattura PDF] Uploaded:', publicUrl)
        await supabase.from('fatture').update({ pdf_url: publicUrl }).eq('id', invoice.id)

        const customerPhone = invoice.customer_phone || customerData?.telefono || customerData?.phone || ''
        if (!customerPhone) {
            console.log('[Wallet Fattura PDF] No customer phone — skipping WhatsApp send')
            return publicUrl
        }
        if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
            console.log('[Wallet Fattura PDF] Green API not configured — skipping WhatsApp send')
            return publicUrl
        }

        let cleanPhone = String(customerPhone).replace(/[\s\-\+\(\)]/g, '')
        if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
        if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`
        const waResponse = await fetch(greenApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: `${cleanPhone}@c.us`,
                urlFile: publicUrl,
                fileName: `Fattura_${invoice.numero_fattura}.pdf`,
                caption: (await renderTemplate('invoice_pdf_whatsapp', { numero_fattura: invoice.numero_fattura })) ?? ''
            })
        })

        const waResult = await waResponse.json()
        if (waResponse.ok && !waResult.error) {
            console.log('[Wallet Fattura PDF] Sent via WhatsApp:', waResult.idMessage)
        } else {
            console.error('[Wallet Fattura PDF] WhatsApp send failed:', waResult)
        }
        return publicUrl
    } catch (err: any) {
        console.error('[Wallet Fattura PDF] Helper failed (non-blocking):', err.message)
        return null
    }
}
