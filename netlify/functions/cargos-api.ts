import { Handler } from '@netlify/functions'

/**
 * CARGOS API Proxy — Polizia di Stato
 * Proxies calls to https://cargos.poliziadistato.it/CARGOS_API/
 * Handles Basic Auth, token management, and CORS.
 *
 * Actions:
 *   - getToken: authenticate and get bearer token
 *   - getTabella: fetch reference table by ID
 *   - check: validate records without sending
 *   - send: send records to Polizia di Stato
 */

const CARGOS_BASE_URL = 'https://cargos.poliziadistato.it/CARGOS_API'

// Agency defaults (can be overridden per-request)
const AGENCY = {
    id: 'RENTORA',
    name: 'RENTORA',
    locationCode: '092009', // ISTAT code for Cagliari
    address: 'VIALE MARCONI 229 - CAGLIARI (CA)',
    phone: '3472817258',
}

// CARGOS credentials from env
const CARGOS_USERNAME = process.env.CARGOS_USERNAME || 'C00006117'
const CARGOS_PASSWORD = process.env.CARGOS_PASSWORD || ''

interface CargosRequest {
    action: 'getToken' | 'getTabella' | 'check' | 'send' | 'buildRecords'
    tabellaId?: number
    records?: string[]
    bookingIds?: string[]
    password?: string // Allow override from frontend during setup
}

function getBasicAuth(password?: string): string {
    const pass = password || CARGOS_PASSWORD
    return 'Basic ' + Buffer.from(`${CARGOS_USERNAME}:${pass}`).toString('base64')
}

async function getToken(password?: string): Promise<{ token?: string; error?: string }> {
    try {
        const res = await fetch(`${CARGOS_BASE_URL}/api/Token`, {
            method: 'GET',
            headers: {
                'Authorization': getBasicAuth(password),
                'Accept': 'application/json',
            },
        })

        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            return { error: body.error_description || `HTTP ${res.status}: ${res.statusText}` }
        }

        const data = await res.json()
        // The token endpoint returns a token string or object
        const token = typeof data === 'string' ? data : data.access_token || data.token || JSON.stringify(data)
        return { token }
    } catch (err: any) {
        return { error: `Connessione fallita: ${err.message}` }
    }
}

async function callCargosApi(
    method: 'GET' | 'POST',
    endpoint: string,
    token: string,
    body?: any
): Promise<{ data?: any; error?: string }> {
    try {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        }
        const opts: RequestInit = { method, headers }

        if (body) {
            headers['Content-Type'] = 'application/json'
            opts.body = JSON.stringify(body)
        }

        const res = await fetch(`${CARGOS_BASE_URL}/${endpoint}`, opts)

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}))
            return { error: errBody.error_description || `HTTP ${res.status}: ${res.statusText}` }
        }

        const data = await res.json()
        return { data }
    } catch (err: any) {
        return { error: `Errore: ${err.message}` }
    }
}

/**
 * Build a CARGOS fixed-width record (1505 chars) from structured data.
 * Each field is right-padded with spaces to its max length.
 */
interface CargosRecordData {
    // Contract
    contractId: string
    contractDate: string          // DD/MM/YYYY HH:MM
    paymentType: string           // Reference table code (1 char)
    checkoutDate: string          // DD/MM/YYYY HH:MM
    checkoutLocationCode: string  // ISTAT code
    checkoutAddress: string
    checkinDate: string           // DD/MM/YYYY HH:MM
    checkinLocationCode: string   // ISTAT code
    checkinAddress: string
    // Operator
    operatorId: string
    // Agency (defaults from AGENCY constant)
    agencyId?: string
    agencyName?: string
    agencyLocationCode?: string
    agencyAddress?: string
    agencyPhone?: string
    // Vehicle
    vehicleType: string           // Reference table code (1 char)
    vehicleBrand: string
    vehicleModel: string
    vehiclePlate: string
    vehicleColor?: string
    vehicleGps?: number           // 0 or 1
    vehicleEngineLock?: number    // 0 or 1
    // Primary driver
    driverSurname: string
    driverName: string
    driverBirthDate: string       // DD/MM/YYYY
    driverBirthPlaceCode: string  // ISTAT code
    driverNationalityCode: string // ISTAT code
    driverResidenceCode?: string
    driverResidenceAddress?: string
    driverIdType: string          // Reference table code
    driverIdNumber: string
    driverIdIssuePlaceCode: string
    driverLicenseNumber: string
    driverLicenseIssuePlaceCode: string
    driverPhone?: string
    // Second driver (optional)
    driver2Surname?: string
    driver2Name?: string
    driver2BirthDate?: string
    driver2BirthPlaceCode?: string
    driver2NationalityCode?: string
    driver2IdType?: string
    driver2IdNumber?: string
    driver2IdIssuePlaceCode?: string
    driver2LicenseNumber?: string
    driver2LicenseIssuePlaceCode?: string
    driver2Phone?: string
}

// Field definitions: [maxLength]
const FIELD_SIZES = [
    50,  // 0  CONTRATTO_ID
    16,  // 1  CONTRATTO_DATA
    1,   // 2  CONTRATTO_TIPOP
    16,  // 3  CONTRATTO_CHECKOUT_DATA
    9,   // 4  CONTRATTO_CHECKOUT_LUOGO_COD
    150, // 5  CONTRATTO_CHECKOUT_INDIRIZZO
    16,  // 6  CONTRATTO_CHECKIN_DATA
    9,   // 7  CONTRATTO_CHECKIN_LUOGO_COD
    150, // 8  CONTRATTO_CHECKIN_INDIRIZZO
    50,  // 9  OPERATORE_ID
    30,  // 10 AGENZIA_ID
    70,  // 11 AGENZIA_NOME
    9,   // 12 AGENZIA_LUOGO_COD
    150, // 13 AGENZIA_INDIRIZZO
    20,  // 14 AGENZIA_RECAPITO_TEL
    1,   // 15 VEICOLO_TIPO
    50,  // 16 VEICOLO_MARCA
    100, // 17 VEICOLO_MODELLO
    15,  // 18 VEICOLO_TARGA
    50,  // 19 VEICOLO_COLORE
    1,   // 20 VEICOLO_GPS
    1,   // 21 VEICOLO_BLOCCOM
    50,  // 22 CONDUCENTE_CONTRAENTE_COGNOME
    30,  // 23 CONDUCENTE_CONTRAENTE_NOME
    10,  // 24 CONDUCENTE_CONTRAENTE_NASCITA_DATA
    9,   // 25 CONDUCENTE_CONTRAENTE_NASCITA_LUOGO_COD
    9,   // 26 CONDUCENTE_CONTRAENTE_CITTADINANZA_COD
    9,   // 27 CONDUCENTE_CONTRAENTE_RESIDENZA_LUOGO_COD
    150, // 28 CONDUCENTE_CONTRAENTE_RESIDENZA_INDIRIZZO
    5,   // 29 CONDUCENTE_CONTRAENTE_DOCIDE_TIPO_COD
    20,  // 30 CONDUCENTE_CONTRAENTE_DOCIDE_NUMERO
    9,   // 31 CONDUCENTE_CONTRAENTE_DOCIDE_LUOGORIL_COD
    20,  // 32 CONDUCENTE_CONTRAENTE_PATENTE_NUMERO
    9,   // 33 CONDUCENTE_CONTRAENTE_PATENTE_LUOGORIL_COD
    20,  // 34 CONDUCENTE_CONTRAENTE_RECAPITO
    50,  // 35 CONDUCENTE2_COGNOME
    30,  // 36 CONDUCENTE2_NOME
    10,  // 37 CONDUCENTE2_NASCITA_DATA
    9,   // 38 CONDUCENTE2_NASCITA_LUOGO_COD
    9,   // 39 CONDUCENTE2_CITTADINANZA_COD
    5,   // 40 CONDUCENTE2_DOCIDE_TIPO_COD
    20,  // 41 CONDUCENTE2_DOCIDE_NUMERO
    9,   // 42 CONDUCENTE2_DOCIDE_LUOGORIL_COD
    20,  // 43 CONDUCENTE2_PATENTE_NUMERO
    9,   // 44 CONDUCENTE2_PATENTE_LUOGORIL_COD
    20,  // 45 CONDUCENTE2_RECAPITO
]

function padField(value: string, maxLen: number): string {
    const clean = (value || '').substring(0, maxLen)
    return clean.padEnd(maxLen, ' ')
}

function buildRecord(d: CargosRecordData): string {
    const fields = [
        d.contractId,
        d.contractDate,
        d.paymentType,
        d.checkoutDate,
        d.checkoutLocationCode,
        d.checkoutAddress,
        d.checkinDate,
        d.checkinLocationCode,
        d.checkinAddress,
        d.operatorId,
        d.agencyId || AGENCY.id,
        d.agencyName || AGENCY.name,
        d.agencyLocationCode || AGENCY.locationCode,
        d.agencyAddress || AGENCY.address,
        d.agencyPhone || AGENCY.phone,
        d.vehicleType,
        d.vehicleBrand,
        d.vehicleModel,
        d.vehiclePlate,
        d.vehicleColor || '',
        String(d.vehicleGps ?? ''),
        String(d.vehicleEngineLock ?? ''),
        d.driverSurname,
        d.driverName,
        d.driverBirthDate,
        d.driverBirthPlaceCode,
        d.driverNationalityCode,
        d.driverResidenceCode || '',
        d.driverResidenceAddress || '',
        d.driverIdType,
        d.driverIdNumber,
        d.driverIdIssuePlaceCode,
        d.driverLicenseNumber,
        d.driverLicenseIssuePlaceCode,
        d.driverPhone || '',
        d.driver2Surname || '',
        d.driver2Name || '',
        d.driver2BirthDate || '',
        d.driver2BirthPlaceCode || '',
        d.driver2NationalityCode || '',
        d.driver2IdType || '',
        d.driver2IdNumber || '',
        d.driver2IdIssuePlaceCode || '',
        d.driver2LicenseNumber || '',
        d.driver2LicenseIssuePlaceCode || '',
        d.driver2Phone || '',
    ]

    return fields.map((val, i) => padField(val, FIELD_SIZES[i])).join('')
}

export { buildRecord, AGENCY, FIELD_SIZES, CargosRecordData }

const handler: Handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const req: CargosRequest = JSON.parse(event.body || '{}')
        const password = req.password || CARGOS_PASSWORD

        if (!password) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Password CARGOS non configurata. Inseriscila nelle impostazioni.' }),
            }
        }

        switch (req.action) {
            case 'getToken': {
                const result = await getToken(password)
                return {
                    statusCode: result.error ? 401 : 200,
                    headers: corsHeaders,
                    body: JSON.stringify(result),
                }
            }

            case 'getTabella': {
                if (req.tabellaId === undefined) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'tabellaId richiesto' }) }
                }
                const tokenResult = await getToken(password)
                if (tokenResult.error) {
                    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: tokenResult.error }) }
                }
                const result = await callCargosApi('GET', `api/Tabella?TabellaIdentificativo=${req.tabellaId}`, tokenResult.token!)
                return {
                    statusCode: result.error ? 400 : 200,
                    headers: corsHeaders,
                    body: JSON.stringify(result),
                }
            }

            case 'check': {
                if (!req.records || req.records.length === 0) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Nessun record da validare' }) }
                }
                const tokenResult = await getToken(password)
                if (tokenResult.error) {
                    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: tokenResult.error }) }
                }
                const result = await callCargosApi('POST', 'api/Check', tokenResult.token!, req.records)
                return {
                    statusCode: result.error ? 400 : 200,
                    headers: corsHeaders,
                    body: JSON.stringify(result),
                }
            }

            case 'send': {
                if (!req.records || req.records.length === 0) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Nessun record da inviare' }) }
                }
                if (req.records.length > 100) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Massimo 100 record per invio' }) }
                }
                const tokenResult = await getToken(password)
                if (tokenResult.error) {
                    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: tokenResult.error }) }
                }
                const result = await callCargosApi('POST', 'api/Send', tokenResult.token!, req.records)
                return {
                    statusCode: result.error ? 400 : 200,
                    headers: corsHeaders,
                    body: JSON.stringify(result),
                }
            }

            default:
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Azione sconosciuta: ${req.action}` }) }
        }
    } catch (err: any) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Errore interno: ' + err.message }),
        }
    }
}

export { handler }
