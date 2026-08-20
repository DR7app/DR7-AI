import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * CARGOS Auto-Send — called after contract is signed
 * Builds the 1505-char fixed-width record and sends to Polizia di Stato.
 */

const CARGOS_BASE_URL = 'https://cargos.poliziadistato.it/CARGOS_API'
const CARGOS_USERNAME = process.env.CARGOS_USERNAME || 'C00006117'
const CARGOS_PASSWORD = process.env.CARGOS_PASSWORD || ''
const CARGOS_APIKEY = process.env.CARGOS_APIKEY || ''

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const AGENCY = {
    id: 'RENTORA',
    name: 'RENTORA',
    locationCode: '420092009',
    address: 'VIALE MARCONI 229, CAGLIARI CA',
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
    'CAGLIARI': '420092009', 'SASSARI': '420090064', 'NUORO': '420091051',
    'ORISTANO': '420092555', 'QUARTU SANT\'ELENA': '420092051', 'OLBIA': '420090047',
    'ALGHERO': '420090003', 'CARBONIA': '420092012', 'IGLESIAS': '420092033',
    'SELARGIUS': '420092068', 'MONSERRATO': '420092109',
    'ROMA': '412058091', 'MILANO': '403015146', 'TORINO': '401001272',
    'NAPOLI': '415063049', 'FIRENZE': '409048017', 'BOLOGNA': '408037006',
    'PALERMO': '419082053', 'GENOVA': '407010025', 'BARI': '416072006',
    'CATANIA': '419087015', 'VENEZIA': '405027042',
    'ITALIA': '100000100', 'ITALY': '100000100',
    'FRANCIA': '100000215', 'FRANCE': '100000215',
    'GERMANIA': '100000216', 'GERMANY': '100000216',
}

// CARGOS TIPO_PAGAMENTO codes (from reference table 0)
// 0=Carta di Credito, 1=Contanti, 2=Carta di Debito, 3=Bonifico, 4=RID, 9=Altro
const PAYMENT_TYPE_MAP: Record<string, string> = {
    'cash': '1', 'contanti': '1',
    'card': '0', 'carta': '0', 'credit_card': '0', 'nexi': '0',
    'nexi pay by link': '0', 'carta di credito / bancomat': '0', 'carta di credito': '0',
    'transfer': '3', 'bonifico': '3',
    'wallet': '9', 'credits': '9', 'credit wallet': '9',
    'paypal': '9',
}

// CARGOS TIPO_DOCUMENTO codes (from reference table 3)
// IDENT=Carta di Identità, IDELE=CIE, PASOR=Passaporto, PATEN=Patente
const DOC_TYPE_MAP: Record<string, string> = {
    'carta_identita': 'IDENT', 'CI': 'IDENT',
    'carta_identita_elettronica': 'IDELE', 'CIE': 'IDELE',
    'passaporto': 'PASOR', 'PA': 'PASOR',
    'patente': 'PATEN', 'PT': 'PATEN',
}

function padField(value: string, maxLen: number): string {
    return (value || '').substring(0, maxLen).padEnd(maxLen, ' ')
}

// Sanitize strings for CARGOS: only allow letters, accented chars, numbers, space, . , '
function sanitizeCargos(value: string): string {
    return (value || '').replace(/[^a-zA-Z0-9àèìòùäöüßÀÈÌÒÙÄÖÜ .,'/]/g, ' ').replace(/\s+/g, ' ').trim()
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

// CARGOS TIPO_VEICOLO codes (from reference table 2)
// 0=Autovetture, 1=Furgoni, 9=Autocaravan
function guessVehicleType(name: string): string {
    const lower = (name || '').toLowerCase()
    if (lower.includes('vito') || lower.includes('ducato') || lower.includes('furgon')) return '1'
    return '0'
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

// 2026-08-20 (richiesta direzione): NIENTE ripiego silenzioso su Cagliari.
// Questa e' una dichiarazione alla Polizia di Stato: un luogo di nascita
// inventato e' un'informazione FALSA trasmessa a un'autorita'. Se il comune
// non c'e' o non e' in tabella, la riga non parte e si chiede il dato.
function lookupIstatCode(cityName: string): string | null {
    if (!cityName) return null
    const upper = cityName.toUpperCase().trim()
    return ISTAT_CODES[upper] || null
}

/** Codice per il record: se il comune non e' noto si lascia VUOTO.
 *  Un campo vuoto dice "non lo so"; il vecchio ripiego su Cagliari diceva una
 *  cosa precisa e sbagliata. Il luogo di NASCITA non passa mai di qui: e'
 *  bloccante a monte (vedi validazione), perche' e' identita' della persona. */
function istatOrEmpty(cityName: string | null | undefined): string {
    return lookupIstatCode(cityName || '') || ''
}

/**
 * Auto-send a signed contract to CARGOS.
 * Called from signature-complete after WhatsApp delivery.
 * Returns { success, error? } — never throws.
 */
/**
 * 2026-08-20 (richiesta direzione): avviso WhatsApp quando una trasmissione
 * CARGOS non riesce, o quando mancano i dati del cliente per farla.
 *
 * Destinatari e attivazione stanno in centralina_pro_config.config.cargos
 * (numeri multipli, modificabili dalla tab Cargos). Se non e' configurato
 * niente, non parte niente: nessun numero hardcoded.
 *
 * Non blocca mai l'invio: se l'avviso fallisce, si logga e si prosegue.
 */
async function avvisaDirezione(motivo: string, dettagli: string): Promise<void> {
    try {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config || {}) as Record<string, unknown>
        const cargosCfg = (cfg.cargos || {}) as Record<string, unknown>
        if (cargosCfg.alerts_enabled !== true) return
        const numeri = Array.isArray(cargosCfg.alert_numbers)
            ? (cargosCfg.alert_numbers as unknown[]).map(n => String(n).replace(/\D/g, '')).filter(n => n.length >= 9)
            : []
        if (numeri.length === 0) return

        const testo = `*CARGOS — ${motivo}*\n\n${dettagli}\n\nControlla la tab Cargos del gestionale.`
        for (const numero of numeri) {
            try {
                await fetch(`${process.env.URL || 'https://platform.dr7ai.com'}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customPhone: numero, customMessage: testo }),
                })
            } catch (e) {
                console.error('[cargos-auto-send] avviso non inviato a', numero, e)
            }
        }
    } catch (e) {
        console.error('[cargos-auto-send] avvisaDirezione fallito:', e)
    }
}

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
        if (booking.service_type && booking.service_type !== 'car_rental') {
            console.log(`[cargos-auto-send] Service booking (${booking.service_type}) — skipping CARGOS`)
            return { success: true }
        }

        // Skip test vehicles and Hummer experience bookings
        const vehName = (booking.vehicle_name || '').toLowerCase()
        if (vehName === 'test' || /test00\d/.test(vehName) || vehName.includes('test000') || vehName.includes('test002')) {
            console.log(`[cargos-auto-send] Test vehicle (${booking.vehicle_name}) — skipping CARGOS`)
            return { success: true }
        }
        if (vehName.includes('hummer')) {
            console.log('[cargos-auto-send] Hummer experience — skipping CARGOS')
            return { success: true }
        }

        // Fetch customer extended data
        let customerData: any = null
        if (booking.user_id) {
            const { data: cust } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('user_id', booking.user_id)
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

        // Resolve plate from vehicles table if missing
        let resolvedPlate = booking.vehicle_plate || bd.vehicle_plate || bd.vehicle?.plate || ''
        if (!resolvedPlate) {
            const vId = booking.vehicle_id || bd.vehicle_id
            if (vId) {
                const { data: veh } = await supabase.from('vehicles').select('plate').eq('id', vId).maybeSingle()
                if (veh?.plate) resolvedPlate = veh.plate
            } else if (booking.vehicle_name) {
                const { data: veh } = await supabase.from('vehicles').select('plate').eq('display_name', booking.vehicle_name).maybeSingle()
                if (veh?.plate) resolvedPlate = veh.plate
            }
        }

        // Validate minimum required fields — only block on targa and surname
        const plate = resolvedPlate.toUpperCase()
        const licenseNumber = (isAzienda ? rapp.patente : '') || c?.numero_patente || c?.patente_numero || bd.customer?.driverLicense || (isAzienda ? 'ND000000000' : '')
        const docNumber = c?.documento_numero || c?.numero_documento_rappresentante || rapp.documento?.numero || bd.customer?.documentNumber || licenseNumber || ''

        const missing = []
        if (!plate) missing.push('targa')
        if (!surname) missing.push('cognome/denominazione')
        if (!isAzienda && !licenseNumber) missing.push('patente')
        if (!isAzienda && !docNumber) missing.push('documento')
        if (!isAzienda) {
            const luogo = c?.luogo_nascita || bd.customer?.birthPlace || ''
            if (!luogo) missing.push('luogo di nascita')
            else if (!lookupIstatCode(luogo)) missing.push(`luogo di nascita non riconosciuto ("${luogo}")`)
        }
        if (missing.length > 0) {
            await avvisaDirezione(
                'dati cliente mancanti',
                `Cliente: ${booking.customer_name || 'ND'}\nVeicolo: ${booking.vehicle_plate || booking.vehicle_name || 'ND'}\nManca: ${missing.join(', ')}`
            )
            return { success: false, error: `Dati mancanti per CARGOS: ${missing.join(', ')}` }
        }

        // Payment type
        const payMethod = bd.payment_method || bd.paymentMethod || ''
        const paymentType = PAYMENT_TYPE_MAP[payMethod.toLowerCase()] || '0'
        console.log(`[cargos-auto-send] Payment method: "${payMethod}" → type: "${paymentType}"`)

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
            /* 25 */ istatOrEmpty(c?.luogo_nascita || bd.customer?.birthPlace || ''),
            /* 26 */ istatOrEmpty(c?.nazionalita || 'ITALIA'),
            /* 27 */ istatOrEmpty(c?.citta || ''),
            /* 28 */ sanitizeCargos(`${c?.indirizzo || ''} ${c?.citta || ''} ${c?.provincia || ''}`),
            /* 29 */ DOC_TYPE_MAP[c?.documento_tipo || 'CI'] || 'IDENT',
            /* 30 */ docNumber,
            /* 31 */ istatOrEmpty(c?.citta || ''),
            /* 32 */ licenseNumber,
            /* 33 */ istatOrEmpty(c?.patente_rilasciata_da || c?.citta || ''),
            /* 34 */ c?.telefono || booking.customer_phone || '',
            /* 35 */ driver2?.cognome || driver2?.surname || '',
            /* 36 */ driver2?.nome || driver2?.name || '',
            /* 37 */ formatDateOnlyCargos(driver2?.data_nascita || driver2?.birthDate || ''),
            /* 38 */ istatOrEmpty(driver2?.luogo_nascita || driver2?.birthPlace || ''),
            /* 39 */ istatOrEmpty(driver2?.nazionalita || ''),
            /* 40 */ '',
            /* 41 */ '',
            /* 42 */ '',
            /* 43 */ driver2?.numero_patente || driver2?.patente_numero || driver2?.licenseNumber || '',
            /* 44 */ istatOrEmpty(driver2?.luogo_nascita || ''),
            /* 45 */ driver2?.telefono || driver2?.phone || '',
        ]

        // Sanitize all text fields (skip date fields 1,3,6,24,37 and code fields 2,4,7,12,15,20,21,25,26,27,29,31,33,38,39,42,44)
        const codeFields = new Set([1,2,3,4,6,7,12,15,20,21,24,25,26,27,29,31,33,37,38,39,42,44])
        const record = fields.map((val, i) => {
            const s = String(val)
            const clean = codeFields.has(i) ? s : sanitizeCargos(s)
            return padField(clean, FIELD_SIZES[i])
        }).join('')
        console.log(`[cargos-auto-send] Record length: ${record.length} (expected 1505), first 100: ${record.substring(0, 100)}`)

        // Validate APIKEY
        if (!CARGOS_APIKEY || CARGOS_APIKEY.length < 48) {
            return { success: false, error: 'CARGOS_APIKEY non configurata o troppo corta' }
        }

        // Authenticate with CARGOS
        const basicAuth = 'Basic ' + Buffer.from(`${CARGOS_USERNAME}:${CARGOS_PASSWORD}`).toString('base64')
        const tokenRes = await fetch(`${CARGOS_BASE_URL}/api/Token`, {
            method: 'GET',
            headers: { 'Authorization': basicAuth, 'Accept': 'application/json' },
        })

        console.log(`[cargos-auto-send] Auth response: status=${tokenRes.status}`)

        if (!tokenRes.ok) {
            const body = await tokenRes.text().catch(() => '')
            console.error(`[cargos-auto-send] Auth failed: ${body.substring(0, 200)}`)
            return { success: false, error: `CARGOS auth fallita (${tokenRes.status}): ${body.substring(0, 100)}` }
        }

        const rawText = await tokenRes.text()
        let tokenData: any
        try { tokenData = JSON.parse(rawText) } catch { tokenData = rawText }

        let rawToken: string | undefined
        if (typeof tokenData === 'string') {
            rawToken = tokenData.replace(/^"|"$/g, '')
        } else if (tokenData && typeof tokenData === 'object') {
            rawToken = tokenData.access_token || tokenData.token || tokenData.Token || tokenData.AccessToken
        }

        if (!rawToken) {
            return { success: false, error: 'CARGOS token non ricevuto' }
        }

        // AES-encrypt token with APIKEY (required by CARGOS API)
        const aesKey = Buffer.from(CARGOS_APIKEY.substring(0, 32), 'utf8')
        const aesIv = Buffer.from(CARGOS_APIKEY.substring(32, 48), 'utf8')
        const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesIv)
        let encrypted = cipher.update(rawToken, 'utf8')
        encrypted = Buffer.concat([encrypted, cipher.final()])
        const bearerToken = encrypted.toString('base64')

        // Send to CARGOS
        const sendRes = await fetch(`${CARGOS_BASE_URL}/api/Send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Organization': CARGOS_USERNAME,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify([record]),
        })

        const sendResText = await sendRes.text()
        console.log(`[cargos-auto-send] CARGOS Send response: status=${sendRes.status}, body=${sendResText.substring(0, 500)}`)

        if (!sendRes.ok) {
            await avvisaDirezione(
                'invio rifiutato',
                `Cliente: ${booking.customer_name || 'ND'}\nVeicolo: ${booking.vehicle_plate || booking.vehicle_name || 'ND'}\nErrore HTTP ${sendRes.status}: ${sendResText.substring(0, 150)}`
            )
            return { success: false, error: `CARGOS invio fallito (${sendRes.status}): ${sendResText.substring(0, 200)}` }
        }

        let sendResult: any
        try { sendResult = JSON.parse(sendResText) } catch { sendResult = sendResText }
        console.log(`[cargos-auto-send] Booking ${bookingId} CARGOS response:`, JSON.stringify(sendResult).substring(0, 300))

        // Check per-record result — CARGOS returns array of {esito, errore, transactionid}
        const results = Array.isArray(sendResult) ? sendResult : []
        const rejected = results.filter((r: any) => r.esito === false)
        if (rejected.length > 0) {
            const errMsg = rejected.map((r: any) => r.errore?.error_description || r.errore?.error || JSON.stringify(r.errore)).join('; ')
            console.error(`[cargos-auto-send] ❌ Booking ${bookingId} REJECTED by CARGOS: ${errMsg}`)
            await avvisaDirezione(
                'record rifiutato',
                `Cliente: ${booking.customer_name || 'ND'}\nVeicolo: ${booking.vehicle_plate || booking.vehicle_name || 'ND'}\nMotivo: ${errMsg}`
            )
            return { success: false, error: `CARGOS ha rifiutato il record: ${errMsg}` }
        }

        const txId = results[0]?.transactionid || ''
        console.log(`[cargos-auto-send] ✅ Booking ${bookingId} sent successfully, TX: ${txId}`)

        // Mark booking as sent to CARGOS only after confirmed success
        await supabase
            .from('bookings')
            .update({
                booking_details: {
                    ...bd,
                    cargos_sent: true,
                    cargos_sent_at: new Date().toISOString(),
                    cargos_tx_id: txId,
                }
            })
            .eq('id', bookingId)

        return { success: true }
    } catch (err: any) {
        console.error('[cargos-auto-send] Error:', err)
        return { success: false, error: err.message }
    }
}
