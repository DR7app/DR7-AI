import { createClient } from '@supabase/supabase-js'

/**
 * CARGOS Auto-Send — called after contract is signed
 * Builds the 1505-char fixed-width record and sends to Polizia di Stato.
 */

const CARGOS_BASE_URL = 'https://cargos.poliziadistato.it/CARGOS_API'
const CARGOS_USERNAME = process.env.CARGOS_USERNAME || 'C00006117'
const CARGOS_PASSWORD = process.env.CARGOS_PASSWORD || ''

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const AGENCY = {
    id: 'RENTORA',
    name: 'RENTORA',
    locationCode: '092009',
    address: 'VIALE MARCONI 229 - CAGLIARI (CA)',
    phone: '3472817258',
}

const FIELD_SIZES = [
    50, 16, 1, 16, 9, 150, 16, 9, 150, 50,
    30, 70, 9, 150, 20,
    1, 50, 100, 15, 50, 1, 1,
    50, 30, 10, 9, 9, 9, 150, 5, 20, 9, 20, 9, 20,
    50, 30, 10, 9, 9, 5, 20, 9, 20, 9, 20
]

const ISTAT_CODES: Record<string, string> = {
    'CAGLIARI': '092009', 'SASSARI': '092066', 'NUORO': '091051',
    'ORISTANO': '095032', 'QUARTU SANT\'ELENA': '092051', 'OLBIA': '090044',
    'ALGHERO': '090003', 'CARBONIA': '111006', 'IGLESIAS': '111032',
    'ROMA': '058091', 'MILANO': '015146', 'TORINO': '001272',
    'NAPOLI': '063049', 'FIRENZE': '048017', 'BOLOGNA': '037006',
    'PALERMO': '082053', 'GENOVA': '010025', 'BARI': '072006',
    'CATANIA': '087015', 'VENEZIA': '027042',
}

const PAYMENT_TYPE_MAP: Record<string, string> = {
    'cash': 'C', 'contanti': 'C', 'card': 'K', 'carta': 'K',
    'credit_card': 'K', 'nexi': 'K', 'transfer': 'B', 'bonifico': 'B',
    'wallet': 'K', 'credits': 'K',
}

const DOC_TYPE_MAP: Record<string, string> = {
    'carta_identita': 'CI', 'CI': 'CI', 'passaporto': 'PA',
    'PA': 'PA', 'patente': 'PT', 'PT': 'PT',
}

function padField(value: string, maxLen: number): string {
    return (value || '').substring(0, maxLen).padEnd(maxLen, ' ')
}

function birthDateFromCF(cf: string): string {
    if (!cf || cf.length < 11) return ''
    const monthMap: Record<string, string> = {
        'A': '01', 'B': '02', 'C': '03', 'D': '04', 'E': '05', 'H': '06',
        'L': '07', 'M': '08', 'P': '09', 'R': '10', 'S': '11', 'T': '12'
    }
    const yearPart = parseInt(cf.substring(6, 8), 10)
    const monthLetter = cf.charAt(8).toUpperCase()
    let day = parseInt(cf.substring(9, 11), 10)
    if (day > 40) day -= 40
    const mm = monthMap[monthLetter]
    if (!mm) return ''
    const yyyy = yearPart > 50 ? 1900 + yearPart : 2000 + yearPart
    return `${String(day).padStart(2, '0')}/${mm}/${yyyy}`
}

function formatDateCargos(isoDate: string): string {
    const d = new Date(isoDate)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

function formatDateOnlyCargos(dateStr: string): string {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
}

function guessVehicleType(name: string): string {
    const lower = (name || '').toLowerCase()
    if (lower.includes('vito') || lower.includes('ducato') || lower.includes('furgon')) return 'F'
    return 'A'
}

function guessVehicleBrand(name: string): string {
    const lower = (name || '').toLowerCase()
    if (lower.includes('audi')) return 'AUDI'
    if (lower.includes('fiat')) return 'FIAT'
    if (lower.includes('porsche')) return 'PORSCHE'
    if (lower.includes('bmw')) return 'BMW'
    if (lower.includes('mercedes')) return 'MERCEDES-BENZ'
    if (lower.includes('lamborghini')) return 'LAMBORGHINI'
    if (lower.includes('ferrari')) return 'FERRARI'
    if (lower.includes('maserati')) return 'MASERATI'
    if (lower.includes('alfa')) return 'ALFA ROMEO'
    if (lower.includes('citroen') || lower.includes('citroën')) return 'CITROEN'
    if (lower.includes('peugeot')) return 'PEUGEOT'
    if (lower.includes('renault')) return 'RENAULT'
    if (lower.includes('volkswagen') || lower.includes('vw')) return 'VOLKSWAGEN'
    return name.split(' ')[0]?.toUpperCase() || 'N/D'
}

function guessVehicleModel(name: string): string {
    const parts = name.split(' ')
    return parts.length > 1 ? parts.slice(1).join(' ') : name
}

function lookupIstatCode(cityName: string): string {
    if (!cityName) return '092009'
    const upper = cityName.toUpperCase().trim()
    return ISTAT_CODES[upper] || '092009'
}

/**
 * Auto-send a signed contract to CARGOS.
 * Called from signature-complete after WhatsApp delivery.
 * Returns { success, error? } — never throws.
 */
export async function sendToCargos(bookingId: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!CARGOS_PASSWORD) {
            return { success: false, error: 'CARGOS_PASSWORD non configurata' }
        }

        console.log(`[cargos-auto-send] Sending booking ${bookingId} to CARGOS`)

        // Fetch booking
        const { data: booking, error: bookingErr } = await supabase
            .from('bookings')
            .select('id, pickup_date, dropoff_date, customer_name, customer_phone, vehicle_name, vehicle_plate, vehicle_id, booking_details, user_id, status, service_type')
            .eq('id', bookingId)
            .single()

        if (bookingErr || !booking) {
            return { success: false, error: `Booking non trovato: ${bookingErr?.message || bookingId}` }
        }

        // Skip non-rental bookings (car wash, mechanical, etc.)
        if (booking.service_type) {
            console.log(`[cargos-auto-send] Service booking (${booking.service_type}) — skipping CARGOS`)
            return { success: true }
        }

        // Skip test vehicles
        if ((booking.vehicle_name || '').toLowerCase() === 'test') {
            console.log('[cargos-auto-send] Test vehicle — skipping CARGOS')
            return { success: true }
        }

        // Fetch customer extended data
        let customerData: any = null
        if (booking.user_id) {
            const { data: cust } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('id', booking.user_id)
                .maybeSingle()
            customerData = cust
        }
        // Fallback: by email
        if (!customerData) {
            const custEmail = booking.booking_details?.customer?.email || ''
            if (custEmail) {
                const { data: cust } = await supabase
                    .from('customers_extended')
                    .select('*')
                    .eq('email', custEmail)
                    .maybeSingle()
                customerData = cust
            }
        }

        const c = customerData
        const bd = booking.booking_details || {}
        const meta = c?.metadata || {}
        const rapp = meta?.rappresentante || {}

        // Split customer name — handle azienda vs persona fisica
        let surname = ''
        let firstName = ''
        const isAzienda = c?.tipo_cliente === 'azienda'

        if (isAzienda) {
            surname = c?.denominazione || c?.cognome || booking.customer_name || ''
            // CARGOS requires NOME even for azienda — use legal representative or repeat denominazione
            firstName = c?.nome_rappresentante || rapp.nome || c?.nome || surname
        } else {
            surname = c?.cognome || ''
            firstName = c?.nome || ''
            if (!surname && booking.customer_name) {
                const parts = booking.customer_name.trim().split(/\s+/)
                if (parts.length >= 2) {
                    surname = parts[parts.length - 1]
                    firstName = parts.slice(0, -1).join(' ')
                } else {
                    surname = parts[0] || ''
                }
            }
        }

        // Validate minimum required fields
        const plate = (booking.vehicle_plate || bd.vehicle_plate || bd.vehicle?.plate || '').toUpperCase()
        const licenseNumber = c?.numero_patente || c?.patente_numero || bd.customer?.driverLicense || ''
        const docNumber = c?.numero_documento || bd.customer?.documentNumber || ''

        const missing = []
        if (!plate) missing.push('targa')
        if (!surname) missing.push('cognome/denominazione')
        if (!isAzienda && !licenseNumber) missing.push('patente')
        if (missing.length > 0) {
            return { success: false, error: `Dati mancanti per CARGOS: ${missing.join(', ')}` }
        }

        // Payment type
        const payMethod = bd.payment_method || bd.paymentMethod || ''
        const paymentType = PAYMENT_TYPE_MAP[payMethod.toLowerCase()] || 'K'

        // Second driver
        const driver2 = bd.second_driver || bd.secondDriver || null

        // Build the 1505-char fixed-width record
        const fields = [
            /* 0  */ booking.id.substring(0, 50),
            /* 1  */ formatDateCargos(booking.pickup_date),
            /* 2  */ paymentType,
            /* 3  */ formatDateCargos(booking.pickup_date),
            /* 4  */ AGENCY.locationCode,
            /* 5  */ AGENCY.address,
            /* 6  */ formatDateCargos(booking.dropoff_date),
            /* 7  */ AGENCY.locationCode,
            /* 8  */ AGENCY.address,
            /* 9  */ 'ADMIN',
            /* 10 */ AGENCY.id,
            /* 11 */ AGENCY.name,
            /* 12 */ AGENCY.locationCode,
            /* 13 */ AGENCY.address,
            /* 14 */ AGENCY.phone,
            /* 15 */ guessVehicleType(booking.vehicle_name || ''),
            /* 16 */ guessVehicleBrand(booking.vehicle_name || ''),
            /* 17 */ guessVehicleModel(booking.vehicle_name || ''),
            /* 18 */ plate,
            /* 19 */ '',
            /* 20 */ '0',
            /* 21 */ '0',
            /* 22 */ surname.toUpperCase(),
            /* 23 */ firstName.toUpperCase(),
            /* 24 */ (() => {
                if (isAzienda) {
                    const bd2 = c?.data_nascita_rappresentante || rapp.data_nascita || c?.data_nascita || ''
                    if (bd2) return formatDateOnlyCargos(bd2)
                    const cfToTry = c?.cf_rappresentante || rapp.cf || ''
                    if (cfToTry && cfToTry.length === 16) return birthDateFromCF(cfToTry)
                    return ''
                }
                const bd2 = c?.data_nascita || bd.customer?.birthDate || ''
                return bd2 ? formatDateOnlyCargos(bd2) : ''
            })(),
            /* 25 */ lookupIstatCode(c?.luogo_nascita || bd.customer?.birthPlace || ''),
            /* 26 */ lookupIstatCode(c?.nazionalita || 'CAGLIARI'),
            /* 27 */ lookupIstatCode(c?.citta || ''),
            /* 28 */ `${c?.indirizzo || ''} ${c?.citta || ''} ${c?.provincia || ''}`.trim(),
            /* 29 */ DOC_TYPE_MAP[c?.tipo_documento || 'CI'] || 'CI',
            /* 30 */ docNumber,
            /* 31 */ lookupIstatCode(c?.citta || ''),
            /* 32 */ licenseNumber,
            /* 33 */ lookupIstatCode(c?.patente_rilasciata_da || c?.citta || ''),
            /* 34 */ c?.telefono || booking.customer_phone || '',
            /* 35 */ driver2?.cognome || driver2?.surname || '',
            /* 36 */ driver2?.nome || driver2?.name || '',
            /* 37 */ formatDateOnlyCargos(driver2?.data_nascita || driver2?.birthDate || ''),
            /* 38 */ lookupIstatCode(driver2?.luogo_nascita || driver2?.birthPlace || ''),
            /* 39 */ lookupIstatCode(driver2?.nazionalita || ''),
            /* 40 */ '',
            /* 41 */ '',
            /* 42 */ '',
            /* 43 */ driver2?.numero_patente || driver2?.patente_numero || driver2?.licenseNumber || '',
            /* 44 */ lookupIstatCode(driver2?.luogo_nascita || ''),
            /* 45 */ driver2?.telefono || driver2?.phone || '',
        ]

        const record = fields.map((val, i) => padField(String(val), FIELD_SIZES[i])).join('')

        // Authenticate with CARGOS
        const basicAuth = 'Basic ' + Buffer.from(`${CARGOS_USERNAME}:${CARGOS_PASSWORD}`).toString('base64')
        const tokenRes = await fetch(`${CARGOS_BASE_URL}/api/Token`, {
            method: 'GET',
            headers: { 'Authorization': basicAuth, 'Accept': 'application/json' },
        })

        if (!tokenRes.ok) {
            const body = await tokenRes.json().catch(() => ({}))
            return { success: false, error: `CARGOS auth fallita: ${body.error_description || tokenRes.statusText}` }
        }

        const tokenData = await tokenRes.json()
        const bearerToken = typeof tokenData === 'string' ? tokenData : tokenData.access_token || tokenData.token

        if (!bearerToken) {
            return { success: false, error: 'CARGOS token non ricevuto' }
        }

        // Send to CARGOS
        const sendRes = await fetch(`${CARGOS_BASE_URL}/api/Send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify([record]),
        })

        if (!sendRes.ok) {
            const errBody = await sendRes.json().catch(() => ({}))
            return { success: false, error: `CARGOS invio fallito: ${errBody.error_description || sendRes.statusText}` }
        }

        const sendResult = await sendRes.json()
        console.log(`[cargos-auto-send] ✅ Booking ${bookingId} sent to CARGOS successfully`, sendResult)

        // Mark booking as sent to CARGOS
        await supabase
            .from('bookings')
            .update({
                booking_details: {
                    ...bd,
                    cargos_sent: true,
                    cargos_sent_at: new Date().toISOString(),
                }
            })
            .eq('id', bookingId)

        return { success: true }
    } catch (err: any) {
        console.error('[cargos-auto-send] Error:', err)
        return { success: false, error: err.message }
    }
}
