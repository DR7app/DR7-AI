import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from 'pdf-lib'
import { requireAuth } from './require-auth'
import { computeRentalBillingDays } from './utils/computeRentalBillingDays'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabaseKeyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon'
console.log('[generate-contract] supabase keyType:', supabaseKeyType)

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Helper function to sanitize text for WinAnsi encoding
// Transliterates Cyrillic and other non-Latin characters to Latin equivalents
function sanitizeForPDF(text: string): string {
    if (!text) return ''

    // Cyrillic to Latin transliteration map (for characters that look similar)
    const cyrillicToLatin: Record<string, string> = {
        // Uppercase
        'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
        'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
        // Lowercase
        'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
        // Other common Cyrillic
        'Б': 'B', 'Г': 'G', 'Д': 'D', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y',
        'Л': 'L', 'П': 'P', 'Ф': 'F', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
        'Ы': 'Y', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
        'б': 'b', 'г': 'g', 'д': 'd', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
        'л': 'l', 'п': 'p', 'ф': 'f', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
        'ы': 'y', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'Ё': 'Yo', 'ё': 'yo', 'Ъ': '', 'ъ': '', 'Ь': '', 'ь': ''
    }

    // Replace Cyrillic characters with Latin equivalents
    let result = text
    for (const [cyrillic, latin] of Object.entries(cyrillicToLatin)) {
        result = result.replace(new RegExp(cyrillic, 'g'), latin)
    }

    // Remove any remaining non-WinAnsi characters
    result = result.replace(/[^\x20-\x7E\xA0-\xFF]/g, '')

    // Normalize whitespace
    return result.replace(/\s+/g, ' ').trim()
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }

    // Require authentication
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr
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

        // Block contract generation for non-rental bookings (car wash, mechanical, etc.)
        const svcType = booking.service_type || booking.booking_details?.service_type || ''
        if (svcType === 'car_wash' || svcType === 'mechanical_service' || svcType === 'mechanical') {
            console.log(`[generate-contract] Skipping — service_type=${svcType} is not a car rental`)
            return { statusCode: 200, body: JSON.stringify({ success: false, skipped: true, reason: `Contratto non necessario per ${svcType}` }) }
        }

        // 2. Fetch Customer Data
        // Priority order:
        // 1. booking.booking_details.customer.customerId (admin-created bookings)
        // 2. booking.user_id (website bookings)
        // 3. Fallback to booking data directly if no customer record found
        const customerId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer?.id || booking.user_id
        let customer = null
        let matchedBy = 'none'

        // Resolve email/phone from booking or booking_details.customer (fallback for older bookings missing top-level fields)
        const resolvedEmail = booking.customer_email || booking.booking_details?.customer?.email
        const resolvedPhone = booking.customer_phone || booking.booking_details?.customer?.phone
        const resolvedName = booking.customer_name || booking.booking_details?.customer?.fullName

        console.log(`[generate-contract] Fetching customer. booking_details.customer.customerId: ${booking.booking_details?.customer?.customerId}, booking_details.customer.id: ${booking.booking_details?.customer?.id}, user_id: ${booking.user_id}, resolved ID: ${customerId}, Email: ${resolvedEmail}, Phone: ${resolvedPhone}`)

        // 1. Try by customer ID (most reliable)
        if (customerId) {
            const { data: cData, error: cError } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            if (cError) console.error('[generate-contract] Error fetching by ID:', cError)
            if (cData) {
                console.log('[generate-contract] Found customer by ID:', cData.id, cData.nome, cData.cognome)
                customer = cData
                matchedBy = 'id'
            }
        }

        // 2. Fallback: Try by email (case-insensitive, use maybeSingle to handle duplicates)
        if (!customer && resolvedEmail) {
            console.log('[generate-contract] Fallback: Fetching by email from customers_extended...', resolvedEmail)
            const { data: cData, error: cError } = await supabase.from('customers_extended').select('*').ilike('email', resolvedEmail).order('updated_at', { ascending: false }).limit(1).maybeSingle()
            if (cError) console.error('[generate-contract] Error fetching by email:', cError)
            if (cData) {
                console.log('[generate-contract] Found customer by Email:', cData.id, cData.nome, cData.cognome)
                customer = cData
                matchedBy = 'email'
            }
        }

        // 3. Fallback: Try by phone number (multiple format variations)
        if (!customer && resolvedPhone) {
            console.log('[generate-contract] Fallback: Fetching by phone from customers_extended...', resolvedPhone)
            let phone = resolvedPhone.replace(/[\s\-\+\(\)]/g, '')
            if (phone.startsWith('00')) phone = phone.substring(2)
            if (phone.length === 10 && phone.startsWith('3')) phone = '39' + phone
            // Try exact match, with prefix, and without prefix
            const phoneVariants = [phone]
            if (phone.startsWith('39') && phone.length === 12) phoneVariants.push(phone.substring(2)) // without 39
            if (!phone.startsWith('39') && phone.length === 10) phoneVariants.push('39' + phone) // with 39
            phoneVariants.push('+' + phone) // with +

            for (const pv of phoneVariants) {
                const { data: cData } = await supabase.from('customers_extended').select('*').eq('telefono', pv).order('updated_at', { ascending: false }).limit(1).maybeSingle()
                if (cData) {
                    console.log('[generate-contract] Found customer by Phone:', cData.id, cData.nome, cData.cognome, 'variant:', pv)
                    customer = cData
                    matchedBy = 'phone'
                    break
                }
            }
        }

        // 4. Fallback: Try by customer name in customers_extended
        if (!customer && resolvedName) {
            console.log('[generate-contract] Fallback: Fetching by name from customers_extended...')
            const nameParts = resolvedName.trim().split(/\s+/)
            if (nameParts.length >= 2) {
                const { data: cData } = await supabase.from('customers_extended').select('*')
                    .or(`and(nome.ilike.%${nameParts[0]}%,cognome.ilike.%${nameParts[nameParts.length - 1]}%),and(nome.ilike.%${nameParts[nameParts.length - 1]}%,cognome.ilike.%${nameParts[0]}%)`)
                    .order('updated_at', { ascending: false }).limit(1).maybeSingle()
                if (cData) {
                    console.log('[generate-contract] Found customer by Name:', cData.id, cData.nome, cData.cognome)
                    customer = cData
                    matchedBy = 'name'
                }
            }
        }

        // 5. Last resort: Try basic customers table
        if (!customer && resolvedEmail) {
            console.log('[generate-contract] Fallback: Fetching by email from basic customers...')
            const { data: cData } = await supabase.from('customers').select('*').eq('email', resolvedEmail).limit(1).maybeSingle()
            if (cData) {
                console.log('[generate-contract] Found customer by Email (basic):', cData.id, cData.full_name)
                customer = { ...cData, tipo_cliente: 'persona_fisica', nome: cData.full_name?.split(' ')[0] || '', cognome: cData.full_name?.split(' ').slice(1).join(' ') || '', indirizzo: cData.notes }
                matchedBy = 'basic_customers'
            }
        }

        console.log(`[generate-contract] Customer resolution: matched by "${matchedBy}", customer ID: ${customer?.id || 'NONE'}`)

        // AUTO-LINKING: If we found a customer but the booking wasn't linked, link it now!
        if (customer && !customerId) {
            console.log(`[generate-contract] Auto-linking booking ${bookingId} to customer ${customer.id}`)
            const { error: linkError } = await supabase
                .from('bookings')
                .update({ user_id: customer.id })
                .eq('id', bookingId)

            if (linkError) {
                console.error('[generate-contract] Failed to auto-link booking:', linkError)
            } else {
                console.log('[generate-contract] Booking successfully auto-linked to customer')
            }
        }

        // Final fallback: Use booking data directly if no customer record exists
        if (!customer) {
            console.warn('[generate-contract] WARNING: No customer record found by any method! Using booking data as fallback.')
            const bd = booking.booking_details?.customer || {}
            const nameParts = (resolvedName || '').split(' ')
            customer = {
                tipo_cliente: 'persona_fisica',
                nome: bd.firstName || nameParts[0] || '',
                cognome: bd.lastName || nameParts.slice(1).join(' ') || '',
                email: resolvedEmail || '',
                telefono: resolvedPhone || '',
                indirizzo: bd.address || '',
                codice_fiscale: bd.taxCode || bd.codiceFiscale || '',
                numero_patente: bd.licenseNumber || bd.driverLicense || '',
                patente: bd.licenseNumber || bd.driverLicense || '',
                data_nascita: bd.birthDate || null,
                luogo_nascita: bd.birthPlace || null,
                citta_residenza: bd.city || null,
                provincia_residenza: bd.province || null,
                codice_postale: bd.zipCode || null,
                data_rilascio_patente: bd.licenseIssueDate || null,
            }
            console.log('[generate-contract] Using fallback customer data:', JSON.stringify(customer))
        }

        // 2b. Fetch Vehicle Data (to get plate and other details if missing in booking)
        let vehicleData = null
        if (booking.vehicle_name) {
            const { data: vData } = await supabase.from('vehicles').select('*').eq('display_name', booking.vehicle_name).maybeSingle()
            vehicleData = vData
        }

        // 3. Prepare Data
        console.log('[generate-contract] Customer data summary:', {
            id: customer?.id,
            nome: customer?.nome,
            cognome: customer?.cognome,
            codice_fiscale: customer?.codice_fiscale,
            indirizzo: customer?.indirizzo,
            citta_residenza: customer?.citta_residenza,
            provincia_residenza: customer?.provincia_residenza,
            codice_postale: customer?.codice_postale,
            data_nascita: customer?.data_nascita,
            luogo_nascita: customer?.luogo_nascita,
            patente: customer?.patente,
            numero_patente: customer?.numero_patente,
            tipo_cliente: customer?.tipo_cliente,
        })

        // CRITICAL: Always prefer customers_extended data over booking snapshot data
        // The booking stores a snapshot (customer_name, customer_email) at creation time,
        // but the customers_extended record has the authoritative/corrected data.
        const clientName = customer?.tipo_cliente === 'azienda'
            ? (customer.denominazione || booking.customer_name || '')
            : (customer?.nome || customer?.cognome)
                ? `${customer.nome || ''} ${customer.cognome || ''}`.trim()
                : (customer?.full_name || booking.customer_name || '')
        const rawAddress = customer?.indirizzo || booking.booking_details?.customer?.address || ''
        const civico = customer?.numero_civico || ''
        const clientAddress = civico ? `${rawAddress} ${civico}`.trim() : rawAddress
        const clientVat = customer?.tipo_cliente === 'azienda' ? customer.partita_iva : customer?.codice_fiscale
        const driverLicense = customer?.numero_patente || customer?.patente || customer?.driver_license_number || ''

        console.log('[generate-contract] Resolved contract data:', { clientName, clientAddress, clientVat, driverLicense })

        // Vehicle Data Prep
        const vehicleName = vehicleData?.display_name || booking.vehicle_name || ''
        const vehiclePlate = vehicleData?.plate || booking.vehicle_plate || ''

        // Smart parse vehicle details
        let parsedColor = vehicleData?.metadata?.color || booking.vehicle_color || ''
        let parsedFuel = vehicleData?.metadata?.fuel || booking.vehicle_fuel || ''
        let parsedSeats = vehicleData?.metadata?.seats || booking.booking_details?.vehicle?.seats || ''
        let parsedBrand = vehicleData?.make || ''
        let parsedModel = vehicleData?.model || ''

        // 1. Extract Color if missing
        if (!parsedColor) {
            const colors = ['White', 'Black', 'Blue', 'Red', 'Silver', 'Grey', 'Gray', 'Orange', 'Green', 'Yellow', 'Bianca', 'Nera', 'Blu', 'Rossa', 'Grigia', 'Arancione', 'Verde', 'Gialla', 'Anthracite', 'Beige', 'Gold', 'Oro'];
            for (const color of colors) {
                if (vehicleName.toLowerCase().includes(color.toLowerCase())) {
                    parsedColor = color;
                    break;
                }
            }
        }

        // 2. Extract Brand & Model if missing
        let nameForModel = vehicleName;
        // Remove color from name for cleaner model extraction
        if (parsedColor) {
            const regex = new RegExp(`\\b${parsedColor}\\b`, 'i');
            nameForModel = nameForModel.replace(regex, '').trim().replace(/\s+/g, ' ');
        }

        if (!parsedBrand) {
            parsedBrand = vehicleName.split(' ')[0]; // Assume first word is brand
        }
        if (!parsedModel) {
            const brandRegex = new RegExp(`^${parsedBrand}`, 'i');
            parsedModel = nameForModel.replace(brandRegex, '').trim().replace(/^[-–]\s*/, '');
        }

        // 3. Default Fuel if missing
        if (!parsedFuel) {
            const lowerName = vehicleName.toLowerCase();
            if (lowerName.includes('ducato') || lowerName.includes('vito') || lowerName.includes('scudo') || lowerName.includes('talento') || lowerName.includes('trafic') || lowerName.includes('transit') || lowerName.includes('diesel')) {
                parsedFuel = 'Diesel';
            } else if (lowerName.includes('hybrid') || lowerName.includes('ibrid')) {
                parsedFuel = 'Ibrida';
            } else if (lowerName.includes('electric') || lowerName.includes('elettric')) {
                parsedFuel = 'Elettrica';
            } else {
                parsedFuel = 'Benzina';
            }
        }

        // 4. Default Seats if missing
        if (!parsedSeats) {
            const lowerName = vehicleName.toLowerCase();
            if (lowerName.includes('panda') || lowerName.includes('500') || lowerName.includes('smart') || lowerName.includes('twizy') || lowerName.includes('mx-5') || lowerName.includes('124')) {
                parsedSeats = '4'; // Small cars / roadsters (MX-5 is 2 actually, but let's stick to simple logic or refine)
                if (lowerName.includes('mx-5') || lowerName.includes('124')) parsedSeats = '2';
            } else if (lowerName.includes('ducato') || lowerName.includes('vito') || lowerName.includes('van') || lowerName.includes('scudo')) {
                parsedSeats = '3';
                if (lowerName.includes('9 posti') || lowerName.includes('passenger') || lowerName.includes('combi')) parsedSeats = '9';
            } else {
                parsedSeats = '5'; // Standard
            }
        }


        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)
        // Generate sequential contract number: DR71000, DR71001, ...
        const { count: contractCount } = await supabase
            .from('contracts')
            .select('id', { count: 'exact', head: true })
        const contractNumber = `DR7${1000 + (contractCount || 0)}`

        // KM limit: recognize BOTH shapes.
        //   admin shape:   booking_details.unlimited_km=true  + km_limit='Illimitati'
        //   website shape: booking_details.kmPackage.type='unlimited' + includedKm>=9999
        const bdKmPkg = booking.booking_details?.kmPackage || {}
        const isUnlimitedKm =
            booking.booking_details?.unlimited_km === true
            || booking.booking_details?.km_limit === 'Illimitati'
            || bdKmPkg.type === 'unlimited'
            || bdKmPkg.distance === 'unlimited'
            || Number(bdKmPkg.includedKm) >= 9999
        const rawKmLimit = booking.booking_details?.km_limit
        const includedKmNum = Number(bdKmPkg.includedKm)
        const websiteIncludedKm = Number.isFinite(includedKmNum) && includedKmNum > 0 && includedKmNum < 9999
            ? String(includedKmNum)
            : null
        // 2026-05-17: coercion a stringa per evitare TypeError su .includes()
        // se km_limit e' stato salvato come numero.
        const rawKmLimitStr = rawKmLimit == null ? null : String(rawKmLimit)
        const rawKmLimitNum = Number(rawKmLimitStr)
        const baseKmFromRaw = Number.isFinite(rawKmLimitNum) && rawKmLimitNum > 0 ? rawKmLimitNum : 0

        // Admin shape (NUOVO 2026-05-16): booking_details.km_packages e' una
        // LISTA di pacchetti, ciascuno con { km, quantity, total_km, ... }.
        // Sommiamo total_km di tutti i pacchetti acquistati. Questo va
        // AGGIUNTO al km base (km_limit raw) — al contrario del website
        // shape dove includedKm gia' include tutto.
        const adminKmPackages = Array.isArray(booking.booking_details?.km_packages)
            ? booking.booking_details?.km_packages as Array<{ total_km?: number | string }>
            : []
        const adminPackageKmTotal = adminKmPackages.reduce((acc, p) => {
            const t = Number(p?.total_km)
            return acc + (Number.isFinite(t) && t > 0 ? t : 0)
        }, 0)

        // Website shape: kmPackage.includedKm gia' INCLUDE base + pacchetto.
        const totalFromWebsitePackage = Number.isFinite(includedKmNum) && includedKmNum > 0 && includedKmNum < 9999 ? includedKmNum : 0

        // Calcolo del km totale che andra' sul contratto:
        //  - Se admin shape (km_packages array > 0): base raw + somma pacchetti
        //  - Else if website shape (kmPackage.includedKm > 0): usa direttamente quello
        //  - Else: usa km_limit raw
        let computedTotalKm = 0
        if (adminPackageKmTotal > 0) {
            computedTotalKm = baseKmFromRaw + adminPackageKmTotal
        } else if (totalFromWebsitePackage > 0) {
            computedTotalKm = totalFromWebsitePackage
        } else {
            computedTotalKm = baseKmFromRaw
        }
        const kmLimitRaw = isUnlimitedKm
            ? 'Illimitati'
            : (computedTotalKm > 0
                ? String(computedTotalKm)
                : (rawKmLimitStr && rawKmLimitStr !== '0' && rawKmLimitStr !== 'Illimitati'
                    ? rawKmLimitStr
                    : (websiteIncludedKm
                        || booking.booking_details?.total_km
                        || 'Illimitati')))
        // Format KM limit for contract display
        let kmLimitValue: string
        if (kmLimitRaw === '50/giorno') {
            const rentalDays = await computeRentalBillingDays(pickupDate, dropoffDate, supabase)
            const totalKm = 50 * rentalDays
            kmLimitValue = `${totalKm} Km (50 Km/Giorno x ${rentalDays} gg)`
        } else if (kmLimitRaw === '100/giorno') {
            // Legacy format — calculate total from days
            const rentalDays = await computeRentalBillingDays(pickupDate, dropoffDate, supabase)
            const table: Record<number, number> = { 1: 100, 2: 180, 3: 240, 4: 280, 5: 300 }
            const totalKm = rentalDays <= 5 ? (table[rentalDays] || 300) : 300 + ((rentalDays - 5) * 60)
            kmLimitValue = `${totalKm} Km`
        } else if (kmLimitRaw === 'Illimitati') {
            kmLimitValue = 'Illimitati'
        } else if (kmLimitRaw && !isNaN(Number(kmLimitRaw)) && !kmLimitRaw.includes('Km') && !kmLimitRaw.includes('km')) {
            // Pure number from auto-calculation — add "Km" suffix
            kmLimitValue = `${kmLimitRaw} Km`
        } else {
            kmLimitValue = kmLimitRaw
        }
        console.log(`[generate-contract] KM DEBUG: unlimited_km=${booking.booking_details?.unlimited_km} (type: ${typeof booking.booking_details?.unlimited_km}), km_limit=${rawKmLimit}, resolved=${kmLimitValue}`)

        // Helper to format date/time in Rome timezone correctly
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

        console.log('[generate-contract] Date debug:', {
            pickup_raw: booking.pickup_date,
            dropoff_raw: booking.dropoff_date,
            pickup_formatted: formatDateRome(pickupDate) + ' ' + formatTimeRome(pickupDate),
            dropoff_formatted: formatDateRome(dropoffDate) + ' ' + formatTimeRome(dropoffDate)
        })

        // 3.5. Fetch Second Driver Data from customers_extended if customer_id is present
        let secondDriverCustomer = null
        const secondDriverId = booking.booking_details?.second_driver?.customer_id

        if (secondDriverId) {
            console.log(`[generate-contract] Fetching second driver data for customer_id: ${secondDriverId}`)
            const { data: sdData, error: sdError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', secondDriverId)
                .single()

            if (sdError) {
                console.error('[generate-contract] Error fetching second driver customer:', sdError)
            } else if (sdData) {
                console.log('[generate-contract] ✅ Found second driver customer data')
                secondDriverCustomer = sdData
            }
        }

        // Fallback: Try by email if ID didn't work
        const secondDriverEmail = booking.booking_details?.second_driver?.email
        if (!secondDriverCustomer && secondDriverEmail) {
            console.log(`[generate-contract] Fallback: Fetching second driver by email: ${secondDriverEmail}`)
            const { data: sdData, error: sdError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', secondDriverEmail)
                .maybeSingle()

            if (sdData) {
                console.log('[generate-contract] ✅ Found second driver customer data by email')
                secondDriverCustomer = sdData
            }
        }

        // Fallback: Try by codice fiscale if email didn't work
        const secondDriverCF = booking.booking_details?.second_driver?.codice_fiscale || booking.booking_details?.second_driver?.tax_code
        if (!secondDriverCustomer && secondDriverCF) {
            console.log(`[generate-contract] Fallback: Fetching second driver by codice_fiscale: ${secondDriverCF}`)
            const { data: sdData, error: sdError } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('codice_fiscale', secondDriverCF)
                .maybeSingle()

            if (sdData) {
                console.log('[generate-contract] ✅ Found second driver customer data by codice_fiscale')
                secondDriverCustomer = sdData
            }

            // Last resort fallback: Try by name + surname
            const secondDriverName = booking.booking_details?.second_driver?.name
            const secondDriverSurname = booking.booking_details?.second_driver?.surname
            if (!secondDriverCustomer && secondDriverName && secondDriverSurname) {
                console.log(`[generate-contract] Last resort: Fetching second driver by name: ${secondDriverName} ${secondDriverSurname}`)
                const { data: sdData, error: sdError } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .eq('nome', secondDriverName)
                    .eq('cognome', secondDriverSurname)
                    .maybeSingle()

                if (sdData) {
                    console.log('[generate-contract] ✅ Found second driver customer data by name+surname')
                    secondDriverCustomer = sdData
                }
            }
        }

        // DEBUG: Log what we found for second driver
        if (secondDriverCustomer) {
            console.log('[generate-contract] 🔍 SECOND DRIVER DATA FOUND:')
            console.log('[generate-contract]   - nome:', secondDriverCustomer.nome)
            console.log('[generate-contract]   - cognome:', secondDriverCustomer.cognome)
            console.log('[generate-contract]   - tipo_patente:', secondDriverCustomer.tipo_patente)
            console.log('[generate-contract]   - numero_patente:', secondDriverCustomer.numero_patente)
            console.log('[generate-contract]   - emessa_da:', secondDriverCustomer.emessa_da)
            console.log('[generate-contract]   - data_rilascio_patente:', secondDriverCustomer.data_rilascio_patente)
            console.log('[generate-contract]   - scadenza_patente:', secondDriverCustomer.scadenza_patente)
            console.log('[generate-contract]   - metadata:', JSON.stringify((secondDriverCustomer as any).metadata))
        } else {
            console.log('[generate-contract] ⚠️  NO SECOND DRIVER CUSTOMER DATA FOUND')
        }

        // 4. Fetch Template from Supabase Storage
        // Based on user URL: .../public/templates/master_contract.pdf -> Bucket: 'templates', File: 'master_contract.pdf'
        // IMPORTANT: Add timestamp to bust cache and ensure we always get the latest template version
        console.log(`[generate-contract] Fetching template from storage: bucket 'templates', file 'master_contract.pdf'`)

        // Use timestamp-based cache busting by appending it to the file path
        const templatePath = `master_contract.pdf?t=${Date.now()}`
        const { data: templateData, error: templateError } = await supabase.storage
            .from('templates')
            .download(templatePath)

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

        // --- DEBUGGING: LOG ALL AVAILABLE FIELDS IN PDF ---
        console.log('--- [DEBUG] PDF FORM FIELDS FOUND ---')
        try {
            const fields = form.getFields()
            const fieldNames = fields.map(f => f.getName())
            console.log('Total fields found:', fieldNames.length)
            console.log('Field Names List:', JSON.stringify(fieldNames, null, 2))
        } catch (err) {
            console.error('Error logging fields:', err)
        }
        // --------------------------------------------------

        // 5a. Generate Dynamic Insurance Responsibility Text based on Vehicle Category
        const vehicleCategory = vehicleData?.category || 'standard'

        // Resolve the category id to its admin-facing label from Centralina Pro
        // (single source of truth for category names). Also read per-category
        // contract clauses (contract_clauses[<catId>]) so direzione puo'
        // gestire un testo Responsabilita' + Penali dedicato per OGNI categoria
        // (Hypercar e' Hypercar, non si lumpa con Supercar).
        let vehicleCategoryLabel: string = vehicleCategory
        let proInsuranceText: string | null = null
        let proPenaltyText: string | null = null
        try {
            const { data: cpCfg } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            const cfg = (cpCfg?.config || {}) as {
                categories?: { id: string; label: string }[]
                contract_clauses?: Record<string, { insurance_text?: string; penalty_text?: string }>
            }
            if (Array.isArray(cfg.categories)) {
                const match = cfg.categories.find(c => c.id.toLowerCase() === vehicleCategory.toLowerCase())
                if (match?.label) vehicleCategoryLabel = match.label
            }
            if (cfg.contract_clauses) {
                // Case-insensitive lookup: lo slug salvato dall'EditableList e'
                // gia' normalizzato, ma proteggiamo da differenze legacy.
                const key = Object.keys(cfg.contract_clauses).find(
                    k => k.toLowerCase() === vehicleCategory.toLowerCase()
                )
                if (key) {
                    const c = cfg.contract_clauses[key]
                    if (c?.insurance_text && c.insurance_text.trim()) proInsuranceText = c.insurance_text
                    if (c?.penalty_text && c.penalty_text.trim()) proPenaltyText = c.penalty_text
                }
            }
        } catch (_e) { /* fallthrough to id + hardcoded defaults */ }

        // Legacy bucketing (fallback). Usato SOLO se Centralina Pro non ha
        // una clausola specifica per questa categoria. La direzione vede
        // questo testo finche' non sovrascrive in Centralina Pro > Contratti.
        const isSupercarLegacy = vehicleCategory === 'supercar' || vehicleCategory === 'luxury'
        const isUrbanLegacy = vehicleCategory === 'urban' || vehicleCategory === 'economy'

        let insuranceResponsibilityText = ''

        // Priorita': testo custom da Centralina Pro per QUESTA categoria.
        // Se direzione ha riempito centralina_pro_config.contract_clauses[<cat>].insurance_text
        // vince sempre sul testo hardcoded di fallback (cosi' "Hypercar e' Hypercar").
        if (proInsuranceText) {
            insuranceResponsibilityText = proInsuranceText
        } else if (isSupercarLegacy) {
            insuranceResponsibilityText = `RESPONSABILITÀ PENALE DEI CLIENTI - SUPERCAR:

KASKO: Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale: da risarcire €5.000 + 30% del danno.

KASKO BLACK: Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale: da risarcire €5.000 + 10% del danno.

KASKO SIGNATURE: Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale: da risarcire €5.000.

LA KASKO NON È ATTIVABILE SE AL MOMENTO DEL DANNO IL CLIENTE ERA SOTTO EFFETTO DI STUPEFACENTI O IN STATO DI EBREZZA.`
        } else if (isUrbanLegacy) {
            insuranceResponsibilityText = `RESPONSABILITÀ PENALE DEI CLIENTI - UTILITARIE E AZIENDALI:

Copertura assicurativa KASKO: Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - distruzione totale: da risarcire €2.000 + 30% del valore del danno è attivabile per qualsiasi danno recato alla vettura anche con oggetti non identificabili per mezzo di targa, previo preventivo in officina ufficiale.

LA KASKO NON È ATTIVABILE SE AL MOMENTO DEL DANNO IL CLIENTE ERA SOTTO EFFETTO DI STUPEFACENTI O IN STATO DI EBREZZA.`
        } else {
            // Default for standard vehicles
            insuranceResponsibilityText = `RESPONSABILITÀ PENALE DEI CLIENTI - VEICOLI STANDARD:

Il locatario è pienamente responsabile del veicolo durante il periodo di noleggio e si impegna a:

1. UTILIZZO DEL VEICOLO: Utilizzare il veicolo con cura e diligenza, rispettando tutte le norme del codice della strada.

2. DANNI E FRANCHIGIE:
   - Senza Kasko: Franchigia di €2.000 per danni alla carrozzeria
   - Con Kasko: Franchigia ridotta a €750
   - Il cliente è responsabile del pagamento della franchigia in caso di danni

3. FURTO E INCENDIO:
   - Senza Kasko: Franchigia di €5.000
   - Con Kasko: Franchigia ridotta a €1.500
   - Obbligo di denuncia immediata alle autorità competenti

4. PENALITÀ:
   - Ritardo nella riconsegna: €100 per ogni ora
   - Pulizia straordinaria: €150
   - Rifornimento mancante: €4/litro + €40 servizio
   - Guida non autorizzata: €1.500 + risoluzione immediata del contratto
   - Violazione limiti velocità: Multa + €150 penale
   - Mancata restituzione chiavi/documenti: €300 per elemento

5. RESPONSABILITÀ: Il cliente è responsabile di tutti i danni fino al massimale della franchigia. Eventuali danni superiori saranno a carico del cliente.`
        }

        console.log(`[generate-contract] Using insurance responsibility text for category: ${vehicleCategory}`)

        // 5b. Generate Additional Penalty/Legal Terms (for second large text area)
        let additionalTermsText = ''

        // Stessa priorita' del testo Responsabilita': se direzione ha
        // riempito centralina_pro_config.contract_clauses[<cat>].penalty_text
        // per QUESTA categoria, sovrascrive il default hardcoded.
        if (proPenaltyText) {
            additionalTermsText = proPenaltyText
        } else if (isSupercarLegacy) {
            additionalTermsText = `PENALI - SUPERCAR:

Penale fermo del veicolo in caso di incidente o danni 350,00€ al giorno.

Penale per chi fuma dentro l'auto: minima 200€ senza danni solo con odore o residui di cenere, massima di 1500,00€ se oltre all'odore e cenere l'auto presenta danni alla tappezzeria o altro riconducibili ad una sigaretta, costi per la riparazione sempre a carico del cliente.

Penale per guidatore non citato nel contratto 1000,00€ possono guidare solo le persone citate nel contratto.

Penale per benzina mancante pari a 40,00€ x tacca.

Penale per danni a tappezzeria, sedili o interni dell'auto 1000,00€ + costo della riparazione a carico del cliente + fermo del veicolo a carico del cliente.

L'utilizzo della bomboletta sigillante 'gonfia e ripara' in dotazione comporta l'addebito di una penale di €100,00 per pneumatico, salvo maggior danno.

Penale per veicolo riportato in condizioni pessime con sporco su interni (terra/sabbia/ghiaia o altro) o immondizia lasciata in giro nell'auto (esempio tasche delle portiere, vano portaoggetti, vano poggiagomito, tasche dei sedili, tappezzeria, bagagliaio) 30,00€, igienizzazione 100,00€.

Non sono tollerati cani o pelo di cane dentro l'auto: penale 100€.

Penale per chi disattiva completamente i controlli elettronici dell'auto 500,00€.

Per quanto concerne a Multe o sanzioni sono a carico del cliente al 100%.

L'intestatario del contratto dovrà essere presente al momento della consegna e del ritiro dell'auto (in caso di consegna e ritiro a domicilio) penale di 500,00€ + eventuali costi aggiuntivi per ulteriore fermi o per ritardi.

In caso di utilizzo del veicolo su pista o in contesti assimilabili a competizioni, verrà applicata una penale di €5.000, oltre al risarcimento di eventuali danni totali in quanto la kasko non è attivabile.

Dopo 10 minuti di ritardo al check-out scatta la penale minima di 50€ e aumenta di 0,50€ per minuto di ritardo.

Il veicolo non può in alcun modo essere guidato da soggetti neopatentati o comunque non abilitati secondo le restrizioni dell'art. 117 CdS. In caso di violazione, il Cliente risponde integralmente di ogni sanzione, fermo amministrativo e danno derivante.

In caso di Subnoleggio non autorizzato la penale è di €10.000.

Al momento del ritiro dell'auto il cliente deve avere con sé la patente fisica ed è obbligato a consegnarla all'operatore che consegna la vettura.

Non sono accettate denunce di smarrimento della patente. In caso di impossibilità a mostrare la patente fisica al momento del ritiro, il cliente perde la prenotazione e l'importo pagato.`
        } else if (isUrbanLegacy) {
            additionalTermsText = `PENALI - UTILITARIE E AZIENDALI:

Penale fermo del veicolo in caso di incidente o danni 40,00€ al giorno.

Penale per chi fuma dentro l'auto: minima 200€ senza danni solo con odore o residui di cenere, massima di 1500,00€ se oltre all'odore e cenere l'auto presenta danni alla tappezzeria o altro riconducibili ad una sigaretta, costi per la riparazione sempre a carico del cliente.

Penale per guidatore non citato nel contratto 500,00€ possono guidare solo le persone citate nel contratto.

Penale per benzina mancante pari a 25,00€ x tacca.

Penale per danni a tappezzeria, sedili o interni dell'auto 1000,00€ + costo della riparazione a carico del cliente + fermo del veicolo a carico del cliente.

L'utilizzo della bomboletta sigillante 'gonfia e ripara' in dotazione comporta l'addebito di una penale di €100,00 per pneumatico, salvo maggior danno.

Penale per veicolo riportato in condizioni pessime con sporco su interni (terra/sabbia/ghiaia o altro) o immondizia lasciata in giro nell'auto (esempio tasche delle portiere, vano portaoggetti, vano poggiagomito, tasche dei sedili, tappezzeria, bagagliaio) 30,00€, igienizzazione 100,00€.

Penale per chi disattiva completamente i controlli elettronici dell'auto 500,00€.

Per quanto concerne a Multe o sanzioni sono a carico del cliente al 100%.

L'intestatario del contratto dovrà essere presente al momento della consegna e del ritiro dell'auto (in caso di consegna e ritiro a domicilio) penale di 500,00€ + eventuali costi aggiuntivi per ulteriore fermi o per ritardi da parte dell'intestatario del contratto.

Dopo 10 minuti di ritardo al check-out scatta la penale minima di 20€ e aumenta di 0,50€ per minuto di ritardo.

Il veicolo non può in alcun modo essere guidato da soggetti neopatentati o comunque non abilitati secondo le restrizioni dell'art. 117 CdS. In caso di violazione, il Cliente risponde integralmente di ogni sanzione, fermo amministrativo e danno derivante.

Non sono tollerati cani o pelo di cane dentro l'auto: penale 100€.

In caso di Subnoleggio non autorizzato la penale è di €10.000.

Non sono accettate denunce di smarrimento della patente. In caso di impossibilità a mostrare la patente fisica al momento del ritiro, il cliente perde la prenotazione e l'importo pagato.`
        } else {
            // Default for standard vehicles
            additionalTermsText = `CONDIZIONI AGGIUNTIVE - VEICOLI STANDARD:

OBBLIGHI DEL LOCATARIO:
- Riconsegnare il veicolo nelle stesse condizioni in cui è stato ritirato
- Effettuare il pieno di carburante prima della riconsegna
- Rispettare i limiti di velocità e le norme del codice della strada
- Non fumare all'interno del veicolo
- Non trasportare animali senza autorizzazione scritta

LIMITAZIONI D'USO:
- Vietato l'uso per competizioni o gare
- Vietato il traino di rimorchi senza autorizzazione
- Vietato il subaffitto o la cessione a terzi
- Numero massimo di conducenti: 2 (titolare + eventuale secondo guidatore autorizzato)

DEPOSITO CAUZIONALE:
- Deposito richiesto: €1.000 (senza Kasko) / €500 (con Kasko)
- Restituito entro 7 giorni dalla riconsegna se nessun danno
- Trattenuto in caso di danni, multe o violazioni

ASSICURAZIONE:
Il veicolo è coperto da assicurazione Kasko. Il cliente è responsabile per tutti i danni fino alla franchigia indicata.`
        }

        // Resolve location ID or label to a printable address for the contract
        function resolveLocation(loc: string | undefined, details: any, type: 'pickup' | 'return' = 'pickup'): string {
            const DR7_OFFICE = 'Viale Marconi 229, Cagliari, CA, 09100'
            const AIRPORT = 'Aeroporto di Cagliari Elmas'
            if (!loc) return DR7_OFFICE
            const locLower = loc.toLowerCase()
            // Handle location IDs stored by edit flow
            if (loc === 'dr7_office' || locLower.includes('viale marconi')) return DR7_OFFICE
            if (loc === 'cagliari_airport' || (locLower.includes('aeroporto') && locLower.includes('cagliari'))) return AIRPORT
            if (loc === 'alghero_airport' || (locLower.includes('aeroporto') && locLower.includes('alghero'))) return 'Aeroporto di Alghero Fertilia'
            if (locLower.includes('aeroporto')) return loc // Other airports — use as-is
            if (loc === 'domicilio' || locLower.includes('domicilio') || locLower.includes('inserisci indirizzo')) {
                // Use delivery/pickup address from booking_details
                const addr = type === 'pickup'
                    ? details?.delivery_address
                    : details?.pickup_address  // pickup_address = where vehicle is picked up (return)
                if (addr) {
                    const parts = [addr.street, addr.city, addr.province, addr.zip].filter(Boolean)
                    return parts.join(', ') || DR7_OFFICE
                }
                return DR7_OFFICE
            }
            // Already a full address string (from new booking flow)
            return loc
        }

        console.log(`[generate-contract] Using additional terms for category: ${vehicleCategory}`)

        // Map insurance option ID to readable label.
        // 1st: legacy hardcoded map (old bookings). 2nd: lookup in centralina_pro_config (new bookings).
        const insuranceOptionId = booking.booking_details?.insuranceOption || booking.booking_details?.insurance || booking.booking_details?.kasko || 'KASKO_BASE'
        const legacyInsuranceLabels: Record<string, string> = {
            'RCA': 'RCA Compresa',
            'KASKO': 'Base',
            'KASKO_BASE': 'Base',
            'KASKO_BLACK': 'Black',
            'KASKO_SIGNATURE': 'Signature',
            'DR7': 'DR7'
        }
        let insuranceLabel = legacyInsuranceLabels[insuranceOptionId] || ''
        if (!insuranceLabel) {
            // New bookings: resolve name from centralina_pro_config
            try {
                const { data: cfg } = await supabase
                    .from('centralina_pro_config')
                    .select('config')
                    .eq('id', 'main')
                    .maybeSingle()
                const proInsurance: any[] = (cfg as any)?.config?.insurance || []
                console.log(`[generate-contract] Loaded ${proInsurance.length} insurance categories from centralina for id="${insuranceOptionId}"`)
                outer: for (const catIns of proInsurance) {
                    const pools: any[][] = []
                    if (Array.isArray(catIns?.all)) pools.push(catIns.all)
                    if (catIns?.byFascia && typeof catIns.byFascia === 'object') {
                        for (const key of Object.keys(catIns.byFascia)) {
                            const arr = catIns.byFascia[key]
                            if (Array.isArray(arr)) pools.push(arr)
                        }
                    }
                    for (const pool of pools) {
                        for (const opt of pool) {
                            if (opt?.id === insuranceOptionId && opt?.name) {
                                insuranceLabel = opt.name
                                break outer
                            }
                        }
                    }
                }
            } catch (cfgErr: any) {
                console.warn('[generate-contract] Insurance label lookup failed:', cfgErr.message)
            }
        }
        if (!insuranceLabel) insuranceLabel = insuranceOptionId
        console.log(`[generate-contract] Insurance resolution: id="${insuranceOptionId}" → label="${insuranceLabel}"`)

        // Standardized Data Field Map
        // We map to BOTH potential English and Italian field names to be safe, as we don't see the PDF structure directly.
        // The loop below will try to set each key; if the field doesn't exist in the PDF, it will just skip it.
        // vehicleModel is now calculated earlier as parsedModel

        const dataMap = {
            // Contract Info
            'ContractNumber': contractNumber,
            'NumeroContratto': contractNumber,
            'Date': new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }),
            'Data': new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }),
            'PlaceOfIssue': 'Cagliari',
            'LuogoStipula': 'Cagliari',
            'TimeOfIssue': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }),
            'OrarioStipula': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }),

            // Customer Info — use resolved values (booking top-level can be null for credit wallet bookings)
            'CustomerName': clientName || '',
            'NomeCognome': clientName || '',
            'CustomerVAT': clientVat || '',
            'CodiceFiscale': clientVat || '',
            'PartitaIVA': clientVat || '',
            'CustomerPhone': customer?.telefono || resolvedPhone || '',
            'Telefono': customer?.telefono || resolvedPhone || '',
            'CustomerEmail': customer?.email || resolvedEmail || '',
            'Email': customer?.email || resolvedEmail || '',
            'CustomerAddress': clientAddress || '',
            'Indirizzo': clientAddress || '',
            'CustomerCity': customer?.citta_residenza || '',
            'Citta': customer?.citta_residenza || '',
            'CustomerProvince': customer?.provincia_residenza || '',
            'Provincia': customer?.provincia_residenza || '',
            'CustomerZipCode': customer?.codice_postale || '',
            'CAP': customer?.codice_postale || '',
            'DriverZipCode': customer?.codice_postale || '',

            // Personal Details (New)
            'CustomerBirthDate': customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : '',
            'DataNascita': customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : '',
            'CustomerBirthPlace': customer?.luogo_nascita || '',
            'LuogoNascita': customer?.luogo_nascita || '',
            'CittaNascita': customer?.luogo_nascita || '', // Variance
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
            'DriverLicenseIssueDate': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.rilascio || ''),
            'DataRilascioPatente': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.rilascio || ''),
            'DataRilascio': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.rilascio || ''),
            'DriverLicenseExpiryDate': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),
            'DataScadenzaPatente': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),
            'ScadenzaPatente': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),
            'Scadenza': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),

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
            // Category placeholder (resolved from centralina_pro_config so it
            // shows the admin-facing label like "Supercars", not the raw id).
            // Multiple spellings supported: English, French (Vehicule), Italian.
            'VehicleCategory': vehicleCategoryLabel,
            'VehiculeCategory': vehicleCategoryLabel,
            'Categoria': vehicleCategoryLabel,
            'Gruppo': vehicleCategoryLabel,
            'VehicleFuelLevel': '',
            'LivelloCarburante': '',
            'VehicleKMRange': '',
            'KMRange': '',
            'KMOverageFee': booking.km_overage_fee ? `€${(booking.km_overage_fee).toFixed(2)}` : '',
            'SforoPerKM': booking.km_overage_fee ? `€${(booking.km_overage_fee).toFixed(2)}` : '',


            // Rental Specifics — resolve location IDs to addresses
            'PickupLocation': resolveLocation(booking.pickup_location, booking.booking_details),
            'SedeRitiro': resolveLocation(booking.pickup_location, booking.booking_details),
            'DropoffLocation': resolveLocation(booking.dropoff_location, booking.booking_details, 'return'),
            'SedeRiconsegna': resolveLocation(booking.dropoff_location, booking.booking_details, 'return'),
            'PickupDate': formatDateRome(pickupDate),
            'DataInizio': formatDateRome(pickupDate),
            'PickupTime': formatTimeRome(pickupDate),
            'OraInizio': formatTimeRome(pickupDate),
            'DropoffDate': formatDateRome(dropoffDate),
            'DataFine': formatDateRome(dropoffDate),
            'DropoffTime': formatTimeRome(dropoffDate),
            'OraFine': formatTimeRome(dropoffDate),
            'TotalDays': (await computeRentalBillingDays(pickupDate, dropoffDate, supabase)).toString(),
            'Giorni': (await computeRentalBillingDays(pickupDate, dropoffDate, supabase)).toString(),
            'TotalHours': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60)).toString(),
            'Ore': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60)).toString(),

            // Insurance and Financial
            'Insurance': insuranceLabel,
            'Assicurazione': insuranceLabel,
            'Deposit': booking.booking_details?.cauzione_auto ? (booking.booking_details?.cauzione_targa || '') : (booking.booking_details?.deposit || booking.booking_details?.cauzione || '0'),
            'Cauzione': booking.booking_details?.cauzione_auto ? (booking.booking_details?.cauzione_targa || '') : (booking.booking_details?.deposit || booking.booking_details?.cauzione || '0'),
            'TotalKM': kmLimitValue,
            'KMTotaliNoleggio': kmLimitValue,

            // Second Driver Fields (Only if second driver exists)
            'SecondDriverName': (booking.booking_details?.second_driver?.name && booking.booking_details?.second_driver?.surname)
                ? `${booking.booking_details.second_driver.name} ${booking.booking_details.second_driver.surname}`
                : '',
            'SecondoGuidatore': (booking.booking_details?.second_driver?.name && booking.booking_details?.second_driver?.surname)
                ? `${booking.booking_details.second_driver.name} ${booking.booking_details.second_driver.surname}`
                : '',
            'SecondDriverBirthDate': (booking.booking_details?.second_driver?.birth_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.birth_date).toLocaleDateString('it-IT')
                : (secondDriverCustomer?.data_nascita ? new Date(secondDriverCustomer.data_nascita).toLocaleDateString('it-IT') : ''),
            'SecondDriverPlaceOfBirth': (booking.booking_details?.second_driver?.birth_place) ? booking.booking_details?.second_driver?.birth_place : (secondDriverCustomer?.luogo_nascita || ''),
            'SecondDriverBirthProvince': (booking.booking_details?.second_driver?.birth_provincia) ? booking.booking_details?.second_driver?.birth_provincia : (booking.booking_details?.second_driver?.birth_province || secondDriverCustomer?.provincia_nascita || ''),
            'SecondDriverStatsCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || secondDriverCustomer?.codice_fiscale || '') : '',
            'SecondDriverTaxCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || secondDriverCustomer?.codice_fiscale || '') : '',
            'SecondDriverCity': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.city || booking.booking_details?.second_driver?.citta || secondDriverCustomer?.citta_residenza || secondDriverCustomer?.citta || '') : '',
            'SecondDriverProvince': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.province || booking.booking_details?.second_driver?.provincia || secondDriverCustomer?.provincia_residenza || secondDriverCustomer?.provincia || '') : '',
            'SecondDriverGender': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || booking.booking_details?.second_driver?.sesso || secondDriverCustomer?.sesso || '') : '',
            'SecondDriverLicenseType': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.license_type || secondDriverCustomer?.tipo_patente || (secondDriverCustomer as any)?.metadata?.patente?.tipo || '') : '',
            'SecondDriverLicenseNumber': (booking.booking_details?.second_driver?.license_number && booking.booking_details?.second_driver?.name)
                ? booking.booking_details.second_driver.license_number
                : (secondDriverCustomer?.numero_patente || ''),
            'SecondDriverLicenseIssuedBy': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.license_issued_by || secondDriverCustomer?.emessa_da || '') : '',
            'SecondDriverLicenseIssueDate': (booking.booking_details?.second_driver?.license_issue_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.license_issue_date).toLocaleDateString('it-IT')
                : (secondDriverCustomer?.data_rilascio_patente ? new Date(secondDriverCustomer.data_rilascio_patente).toLocaleDateString('it-IT') : ''),
            'SecondDriverLicenseExpiryDate': (booking.booking_details?.second_driver?.license_expiry && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.license_expiry).toLocaleDateString('it-IT')
                : (booking.booking_details?.second_driver?.license_expiry_date ? new Date(booking.booking_details.second_driver.license_expiry_date).toLocaleDateString('it-IT') : (secondDriverCustomer?.scadenza_patente ? new Date(secondDriverCustomer.scadenza_patente).toLocaleDateString('it-IT') : '')),
            'SecondDriverVAT': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || booking.booking_details?.second_driver?.codice_fiscale || secondDriverCustomer?.codice_fiscale || '') : '',
            'SecondDriverSex': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || booking.booking_details?.second_driver?.sesso || secondDriverCustomer?.sesso || '') : '',
            'SecondDriverAddress': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.address || booking.booking_details?.second_driver?.indirizzo || secondDriverCustomer?.indirizzo || '') : '',
            'SecondDriverZipCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.zip_code || booking.booking_details?.second_driver?.cap || secondDriverCustomer?.codice_postale || secondDriverCustomer?.cap || '') : '',
            'SecondDriverBirthPlace': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.birth_city || booking.booking_details?.second_driver?.birth_place || secondDriverCustomer?.luogo_nascita || '') : '',
            // 'SecondDriverBirthProvince' handled above
            'SecondDriverPhone': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.phone || secondDriverCustomer?.telefono || '') : '',
            'SecondDriverEmail': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.email || secondDriverCustomer?.email || '') : '',

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

            // Company Data (for business clients)
            'CompanyName': customer?.tipo_cliente === 'azienda' ? customer.denominazione : '',
            'Denominazione': customer?.tipo_cliente === 'azienda' ? customer.denominazione : '',
            'RagioneSociale': customer?.tipo_cliente === 'azienda' ? customer.denominazione : '',
            'CompanyEmail': customer?.tipo_cliente === 'azienda' ? customer.email : '',
            'EmailAzienda': customer?.tipo_cliente === 'azienda' ? customer.email : '',
            'CompanyAddress': customer?.tipo_cliente === 'azienda' ? customer.indirizzo : '',
            'IndirizzoAzienda': customer?.tipo_cliente === 'azienda' ? customer.indirizzo : '',
            'SedeLegale': customer?.tipo_cliente === 'azienda' ? customer.indirizzo : '',
            'CompanyPhone': customer?.tipo_cliente === 'azienda' ? customer.telefono : '',
            'TelefonoAzienda': customer?.tipo_cliente === 'azienda' ? customer.telefono : '',
            'CompanyVAT': customer?.tipo_cliente === 'azienda' ? customer.partita_iva : '',
            'PartitaIVAAzienda': customer?.tipo_cliente === 'azienda' ? customer.partita_iva : '',
            'CompanyFiscalCode': customer?.tipo_cliente === 'azienda' ? customer.codice_fiscale : '',
            'CodiceFiscaleAzienda': customer?.tipo_cliente === 'azienda' ? customer.codice_fiscale : '',
            'CompanyCity': customer?.tipo_cliente === 'azienda' ? (customer.citta_residenza || customer.citta || '') : '',
            'CittaAzienda': customer?.tipo_cliente === 'azienda' ? (customer.citta_residenza || customer.citta || '') : '',
            'CompanyProvince': customer?.tipo_cliente === 'azienda' ? (customer.provincia_residenza || customer.provincia || '') : '',
            'ProvinciaAzienda': customer?.tipo_cliente === 'azienda' ? (customer.provincia_residenza || customer.provincia || '') : '',
            'CompanyZipCode': customer?.tipo_cliente === 'azienda' ? (customer.codice_postale || customer.cap || '') : '',
            'CAPAzienda': customer?.tipo_cliente === 'azienda' ? (customer.codice_postale || customer.cap || '') : '',
            'CompanyPEC': customer?.tipo_cliente === 'azienda' ? (customer.pec || '') : '',
            'PECAzienda': customer?.tipo_cliente === 'azienda' ? (customer.pec || '') : '',
            'CompanySDI': customer?.tipo_cliente === 'azienda' ? (customer.codice_sdi || customer.sdi || '') : '',
            'CodiceSDI': customer?.tipo_cliente === 'azienda' ? (customer.codice_sdi || customer.sdi || '') : '',
            'CompanyRepresentativeName': customer?.tipo_cliente === 'azienda' ? (customer.rappresentante_legale || `${customer?.metadata?.rappresentante?.nome || ''} ${customer?.metadata?.rappresentante?.cognome || ''}`.trim()) : '',
            'RappresentanteLegale': customer?.tipo_cliente === 'azienda' ? (customer.rappresentante_legale || `${customer?.metadata?.rappresentante?.nome || ''} ${customer?.metadata?.rappresentante?.cognome || ''}`.trim()) : '',
            'CompanyRepresentativeID': customer?.metadata?.rappresentante?.documento?.tipo || customer?.metadata?.rappresentante?.tipo_documento || '',
            'TipoDocumentoRappresentante': customer?.metadata?.rappresentante?.documento?.tipo || customer?.metadata?.rappresentante?.tipo_documento || '',
            'CompanyRepresentativeIDNumber': customer?.metadata?.rappresentante?.documento?.numero || customer?.metadata?.rappresentante?.numero_documento || '',
            'NumeroDocumentoRappresentante': customer?.metadata?.rappresentante?.documento?.numero || customer?.metadata?.rappresentante?.numero_documento || '',
            'CompanyRepresentativeIDIssueDate': customer?.metadata?.rappresentante?.documento?.rilascio || customer?.metadata?.rappresentante?.data_rilascio || '',
            'DataRilascioDocumentoRappresentante': customer?.metadata?.rappresentante?.documento?.rilascio || customer?.metadata?.rappresentante?.data_rilascio || '',
            'CompanyRepresentativeIDIssuePlace': customer?.metadata?.rappresentante?.documento?.luogo || customer?.metadata?.rappresentante?.luogo_rilascio || '',
            'LuogoRilascioDocumentoRappresentante': customer?.metadata?.rappresentante?.documento?.luogo || customer?.metadata?.rappresentante?.luogo_rilascio || '',
            'CompanyRepresentativeIDExpiryDate': customer?.metadata?.rappresentante?.documento?.scadenza || customer?.metadata?.rappresentante?.data_scadenza || '',
            'DataScadenzaDocumentoRappresentante': customer?.metadata?.rappresentante?.documento?.scadenza || customer?.metadata?.rappresentante?.data_scadenza || '',
            // Combined fields for single text boxes
            'CompanyRepresentativeDocCombined': `${customer?.metadata?.rappresentante?.documento?.tipo || customer?.metadata?.rappresentante?.tipo_documento || ''} ${customer?.metadata?.rappresentante?.documento?.numero || customer?.metadata?.rappresentante?.numero_documento || ''}`.trim(),
            'DocumentoRappresentante': `${customer?.metadata?.rappresentante?.documento?.tipo || customer?.metadata?.rappresentante?.tipo_documento || ''} ${customer?.metadata?.rappresentante?.documento?.numero || customer?.metadata?.rappresentante?.numero_documento || ''}`.trim(),
            'CompanyRepresentativeIssueCombined': `${customer?.metadata?.rappresentante?.documento?.rilascio || customer?.metadata?.rappresentante?.data_rilascio || ''} ${(customer?.metadata?.rappresentante?.documento?.luogo || customer?.metadata?.rappresentante?.luogo_rilascio) ? '- ' + (customer.metadata.rappresentante.documento?.luogo || customer.metadata.rappresentante.luogo_rilascio) : ''}`.trim(),
            'RilascioDocumentoRappresentante': `${customer?.metadata?.rappresentante?.documento?.rilascio || customer?.metadata?.rappresentante?.data_rilascio || ''} ${(customer?.metadata?.rappresentante?.documento?.luogo || customer?.metadata?.rappresentante?.luogo_rilascio) ? '- ' + (customer.metadata.rappresentante.documento?.luogo || customer.metadata.rappresentante.luogo_rilascio) : ''}`.trim(),

            // Garante / Proprietario Veicolo Cauzione
            'GaranteNomeCognome': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return `${customer?.nome || ''} ${customer?.cognome || ''}`.trim()
              return `${g.nome || ''} ${g.cognome || ''}`.trim()
            })(),
            'GaranteCodiceFiscale': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.codice_fiscale || ''
              return g.codice_fiscale || ''
            })(),
            'GaranteSesso': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.sesso || ''
              return g.sesso || ''
            })(),
            'GaranteIndirizzo': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return `${customer?.indirizzo || ''} ${customer?.codice_postale || ''}`.trim()
              return `${g.indirizzo || ''} ${g.cap || ''}`.trim()
            })(),
            'GaranteCitta': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.citta_residenza || ''
              return g.citta || ''
            })(),
            'GaranteProvincia': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.provincia_residenza || ''
              return g.provincia || ''
            })(),
            'GaranteDataNascita': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : ''
              return g.birth_date ? new Date(g.birth_date).toLocaleDateString('it-IT') : ''
            })(),
            'GaranteLuogoNascita': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.luogo_nascita || ''
              return g.birth_place || ''
            })(),
            'GaranteProvinciaNascita': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.provincia_nascita || ''
              return g.birth_provincia || ''
            })(),
            'GaranteTelefono': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.telefono || ''
              return g.phone || ''
            })(),
            'GaranteEmail': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.email || ''
              return g.email || ''
            })(),
            'GaranteCAP': (() => {
              const g = booking.booking_details?.garante_veicolo
              if (!g || !booking.booking_details?.cauzione_auto) return ''
              if (g.tipo === 'guidatore') return customer?.codice_postale || ''
              return g.cap || ''
            })(),
            'CauzioneVeicolo': booking.booking_details?.cauzione_auto ? `${booking.booking_details?.cauzione_veicolo?.brand || ''} ${booking.booking_details?.cauzione_veicolo?.model || ''} (${booking.booking_details?.cauzione_veicolo?.year || ''}) - ${booking.booking_details?.cauzione_targa || ''}` : '',
            'TargaCauzione': booking.booking_details?.cauzione_targa || '',

            // Penalty Clause (Dynamic based on vehicle category)
            'PenaltyClause': insuranceResponsibilityText,

            // Additional Terms/Penalties (Second large text area)
            'AdditionalTerms': additionalTermsText,
        }

        // Pre-compute the exact set of text field names actually present in
        // the PDF template. pdf-lib's getTextField() THROWS NoSuchFieldError
        // when the name isn't found — it doesn't return null. Looking the
        // name up in this set first lets us skip absent fields silently
        // instead of flooding the logs with stack traces for azienda-only
        // fields (CodiceSDI, RappresentanteLegale, Company*ID…) that don't
        // exist in the standard template.
        const existingFieldNames = new Set<string>()
        try {
            for (const f of form.getFields()) existingFieldNames.add(f.getName())
        } catch (e) {
            console.warn('[generate-contract] Unable to enumerate form fields:', e)
        }
        const skippedAbsentFields: string[] = []

        let filledFields = 0
        for (const [key, value] of Object.entries(dataMap)) {
            if (!existingFieldNames.has(key)) {
                if (value) skippedAbsentFields.push(key)
                continue
            }
            try {
                const field = form.getTextField(key)
                if (field) {
                    const sanitizedValue = sanitizeForPDF(value)
                    field.setFontSize(7)
                    field.setText(sanitizedValue)
                    filledFields++

                    if (sanitizedValue !== value && value) {
                        console.log(`[generate-contract] Sanitized field '${key}': "${value}" -> "${sanitizedValue}"`)
                    }
                }
            } catch (e) {
                // Field exists but isn't a text field (checkbox, radio, etc.) — skip quietly.
                console.warn(`[generate-contract] Could not fill '${key}' (wrong field type?):`, (e as Error).message)
            }
        }

        console.log(`[generate-contract] Filled ${filledFields} fields.`)
        if (skippedAbsentFields.length > 0) {
            console.log(`[generate-contract] Skipped ${skippedAbsentFields.length} fields absent from PDF template:`, skippedAbsentFields.join(', '))
        }

        // If no fields were filled, it means field names didn't match or there are no fields.
        if (filledFields === 0) {
            const page = pdfDoc.getPages()[0]
            const { height } = page.getSize()
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
            const red = rgb(1, 0, 0)

            const availableFields = form.getFields().map(f => f.getName()).join(', ') || 'None (The PDF has no form fields)'

            page.drawText(sanitizeForPDF(`ERROR: No data filled. Check your PDF form field names.`), { x: 50, y: height - 50, size: 12, font, color: red })
            page.drawText(sanitizeForPDF(`Found fields in PDF: ${availableFields}`), { x: 50, y: height - 70, size: 10, font, color: red })
            page.drawText(sanitizeForPDF(`Expected fields: ${Object.keys(dataMap).join(', ')}`), { x: 50, y: height - 90, size: 8, font, color: red })
        } else {
            // Fix missing page references (P entry) on form field widgets before flattening.
            // The PDF template has merged field/widget dicts where pdf-lib creates new objects
            // that don't match the page's Annots refs. We match by field name (T entry) to find
            // which page each field belongs to, then set the P reference.
            const allPages = pdfDoc.getPages()
            const allFields = form.getFields()

            // Build map: field name -> page ref from each page's Annots
            const fieldNameToPageRef = new Map<string, any>()
            for (const page of allPages) {
                const annotsRaw = page.node.get(PDFName.of('Annots'))
                if (!annotsRaw) continue
                const annots = pdfDoc.context.lookup(annotsRaw)
                if (!(annots instanceof PDFArray)) continue
                for (let i = 0; i < annots.size(); i++) {
                    const annotDict = pdfDoc.context.lookup(annots.get(i))
                    if (annotDict instanceof PDFDict) {
                        const tRaw = annotDict.get(PDFName.of('T'))
                        if (tRaw) {
                            let fieldName = ''
                            if (tRaw instanceof PDFString) fieldName = tRaw.decodeText()
                            else if (tRaw instanceof PDFHexString) fieldName = tRaw.decodeText()
                            else fieldName = tRaw.toString()
                            if (!fieldNameToPageRef.has(fieldName)) {
                                fieldNameToPageRef.set(fieldName, page.ref)
                            }
                        }
                    }
                }
            }

            // Set P on each widget (fallback to page 1 for any unmatched fields)
            const firstPageRef = allPages[0].ref
            for (const field of allFields) {
                const pageRef = fieldNameToPageRef.get(field.getName()) || firstPageRef
                for (const widget of field.acroField.getWidgets()) {
                    widget.dict.set(PDFName.of('P'), pageRef)
                }
            }

            try {
                form.flatten()
                console.log('[generate-contract] Form flattened successfully — PDF is now read-only')
            } catch (flattenErr: any) {
                console.error('[generate-contract] Flatten failed:', flattenErr.message)
                // Fallback: mark all fields read-only so they can't be edited
                for (const field of allFields) {
                    try { field.enableReadOnly() } catch (_) { }
                }
                console.log('[generate-contract] Fields marked read-only as fallback')
            }
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
        //
        // We intentionally avoid .upsert({onConflict:'booking_id'}): contracts.booking_id
        // has an index but NO unique constraint, so PostgREST rejects the upsert and the
        // code used to log-and-continue, leaving contracts.pdf_url stale. Result: after
        // an admin edited a paid booking, the next signing flow delivered the OLD PDF.
        // Do explicit "update latest-if-exists else insert" so it works regardless of
        // DB constraints, and also clear signed_pdf_url so a regenerated row never
        // serves its previous signed copy.
        const contractFields = {
            contract_number: contractNumber,
            contract_date: new Date().toISOString().split('T')[0],
            customer_name: clientName || resolvedName || '',
            customer_email: customer?.email || resolvedEmail || '',
            customer_phone: customer?.telefono || resolvedPhone || '',
            customer_address: clientAddress,
            customer_tax_code: clientVat,
            customer_license_number: driverLicense,
            vehicle_name: vehicleName,
            rental_start_date: pickupDate.toISOString().split('T')[0],
            rental_end_date: dropoffDate.toISOString().split('T')[0],
            daily_rate: 0, // We rely on total amount mostly
            total_days: await computeRentalBillingDays(pickupDate, dropoffDate, supabase),
            total_amount: booking.price_total / 100,
            status: 'active',
            pdf_url: publicUrl,
            signed_pdf_url: null,
            updated_at: new Date().toISOString()
        }

        const { data: existingContracts } = await supabase
            .from('contracts')
            .select('id')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: false })

        let dbError: any = null
        if (existingContracts && existingContracts.length > 0) {
            const latestId = existingContracts[0].id
            const res = await supabase
                .from('contracts')
                .update(contractFields)
                .eq('id', latestId)
            dbError = res.error
        } else {
            const res = await supabase
                .from('contracts')
                .insert({ booking_id: bookingId, ...contractFields })
            dbError = res.error
        }

        if (dbError) {
            console.error('[generate-contract] Failed to sync with contracts table:', dbError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to persist contract: ' + dbError.message }) }
        }

        // 8a. Mark any previous signature_requests for this booking as superseded
        // so the customer can't open a stale signing link and sign an outdated PDF.
        // Match by booking_id to cover legacy duplicate contract rows too.
        try {
            await supabase
                .from('signature_requests')
                .update({ status: 'superseded', updated_at: new Date().toISOString() })
                .eq('booking_id', bookingId)
                .in('status', ['pending', 'otp_sent', 'otp_verified', 'signed'])
        } catch (cleanupErr) {
            console.warn('[generate-contract] Failed to supersede old signature_requests:', cleanupErr)
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
