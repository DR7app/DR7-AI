import fetch from 'node-fetch'

// Production URLs (from official Aruba API docs)
const ARUBA_AUTH_URL = process.env.ARUBA_AUTH_URL || 'https://auth.fatturazioneelettronica.aruba.it'
const ARUBA_API_URL = process.env.ARUBA_API_URL || 'https://ws.fatturazioneelettronica.aruba.it'

const USERNAME = process.env.ARUBA_USERNAME || ''
const PASSWORD = process.env.ARUBA_PASSWORD || ''

interface ArubaToken {
    access_token: string
    token_type: string
    expires_in: number
    refresh_token: string
    userName: string
}

let cachedToken: ArubaToken | null = null
let tokenExpiry: number = 0

/**
 * Get authentication token from Aruba
 * Based on official docs: POST /auth/signin
 */
export async function getArubaToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry) {
        return cachedToken.access_token
    }

    if (!USERNAME || !PASSWORD) {
        throw new Error('ARUBA_USERNAME and ARUBA_PASSWORD are required')
    }

    // Official Aruba auth format: application/x-www-form-urlencoded
    const params = new URLSearchParams()
    params.append('grant_type', 'password')
    params.append('username', USERNAME)
    params.append('password', PASSWORD)

    try {
        const response = await fetch(`${ARUBA_AUTH_URL}/auth/signin`, {
            method: 'POST',
            body: params,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            }
        })

        if (!response.ok) {
            const text = await response.text()
            throw new Error(`Aruba Auth Failed: ${response.status} ${text}`)
        }

        const data = (await response.json()) as ArubaToken
        cachedToken = data
        // Set expiry with 60s buffer
        tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000

        console.log('[Aruba] Authentication successful for user:', data.userName)
        return data.access_token
    } catch (error) {
        console.error('Aruba Token Error:', error)
        throw error
    }
}

/**
 * Upload invoice XML to Aruba
 * Based on official docs: POST /services/invoice/upload
 */
export async function uploadInvoiceToAruba(xmlContent: string, filename: string): Promise<{ id: string, filename: string }> {
    const token = await getArubaToken()

    // senderPIVA is OPTIONAL and only used for TD26 invoices (asset disposal)
    // Per official docs: "If the invoice to be sent has code TD26... the senderPIVA field can be used"
    // For normal invoices, leave it empty
    const senderPIVA = ''
    console.log('[Aruba] Using empty senderPIVA (not TD26 invoice)')

    // Official Aruba format: JSON with base64-encoded XML
    const payload = {
        dataFile: Buffer.from(xmlContent).toString('base64'),
        credential: '',
        domain: '',
        senderPIVA: senderPIVA,
        skipExtraSchema: false
    }

    console.log('[Aruba] Upload payload (without dataFile):', { ...payload, dataFile: '[BASE64_OMITTED]' })

    const response = await fetch(`${ARUBA_API_URL}/services/invoice/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json;charset=UTF-8',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Aruba Upload Failed: ${response.status} ${text}`)
    }

    const result = await response.json()

    // Check for Aruba error codes
    if (result.errorCode && result.errorCode !== '0000') {
        throw new Error(`Aruba Error ${result.errorCode}: ${result.errorDescription}`)
    }

    console.log('[Aruba] Upload successful:', result.uploadFileName)

    return {
        id: result.uploadFileName, // Aruba returns uploadFileName as the ID
        filename: result.uploadFileName
    }
}

/**
 * Check invoice status from Aruba
 * Based on official docs: GET /services/invoice/out/getByFilename
 */
export async function checkArubaStatus(filename: string): Promise<any> {
    const token = await getArubaToken()

    const response = await fetch(`${ARUBA_API_URL}/services/invoice/out/getByFilename?filename=${encodeURIComponent(filename)}&includePdf=false&includeFile=false`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        }
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Aruba Status Check Failed: ${response.status} ${text}`)
    }

    const result = await response.json()

    // Check for errors (0000 = success)
    if (result.errorCode && result.errorCode !== '0000') {
        throw new Error(`Aruba Error ${result.errorCode}: ${result.errorDescription}`)
    }

    console.log('[Aruba] Status check result:', JSON.stringify(result).substring(0, 500))
    return result
}

/**
 * Search OUTGOING (active) invoices from Aruba — same pattern as the
 * incoming search but on /services/invoice/out/findByUsername. Returns
 * a paginated list with each invoice's current SDI status. Used by the
 * bulk reconciler so we don't have to poll fattura-by-fattura when
 * Aruba already exposes the whole list in one call.
 */
export async function searchOutgoingInvoices(params: {
    startDate?: string
    endDate?: string
    page?: number
    pageSize?: number
}): Promise<any> {
    const token = await getArubaToken()

    const queryParams = new URLSearchParams()
    queryParams.set('username', USERNAME)
    if (params.page != null) queryParams.set('page', String(params.page))
    if (params.pageSize != null) {
        queryParams.set('pageSize', String(params.pageSize))
        queryParams.set('size', String(params.pageSize))
    }
    if (params.startDate) queryParams.set('startDate', params.startDate)
    if (params.endDate) queryParams.set('endDate', params.endDate)

    let response: Response | null = null
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        response = await fetch(`${ARUBA_API_URL}/services/invoice/out/findByUsername?${queryParams}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        })
        if (response.status !== 429) break
        const wait = Math.min(2000 * Math.pow(2, attempt), 8000) + Math.floor(Math.random() * 500)
        console.warn(`[Aruba] 429 on out/findByUsername, retry in ${wait}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`)
        await new Promise(r => setTimeout(r, wait))
    }
    if (!response) throw new Error('Aruba out/findByUsername: no response')
    if (response.status === 429) {
        throw new Error('Aruba ha limitato le richieste (429). Riprova tra qualche minuto.')
    }
    if (!response.ok) {
        const text = await response.text()
        const cleanText = text
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        const snippet = cleanText.length > 200 ? cleanText.slice(0, 200) + '...' : cleanText
        throw new Error(`Aruba Outgoing Search Failed: ${response.status}${snippet ? ' — ' + snippet : ''}`)
    }
    return response.json()
}

/**
 * Search incoming (passive) invoices from Aruba
 * Based on official docs: POST /services/invoice/in/findByUsername
 */
export async function searchIncomingInvoices(params: {
    startDate?: string  // ISO 8601: yyyy-MM-ddTHH:mm:ss.fffzzz
    endDate?: string    // ISO 8601: yyyy-MM-ddTHH:mm:ss.fffzzz
    page?: number
    pageSize?: number
    senderDescription?: string
}): Promise<any> {
    const token = await getArubaToken()

    const payload: Record<string, any> = {
        username: USERNAME,
        page: params.page ?? 0,
        pageSize: params.pageSize ?? 100,
        startDate: params.startDate || undefined,
        endDate: params.endDate || undefined,
    }
    if (params.senderDescription) {
        payload.senderDescription = params.senderDescription
    }

    console.log('[Aruba] Searching incoming invoices:', payload)

    // Build query string — Aruba incoming search uses GET with query params
    const queryParams = new URLSearchParams()
    queryParams.set('username', USERNAME)
    // countryReceiver is required by Aruba — recipient country (IT for Italian VAT IDs)
    queryParams.set('countryReceiver', process.env.ARUBA_COUNTRY_RECEIVER || 'IT')
    // vatcodeReceiver is required by Aruba — our own P.IVA (digits only, no IT prefix).
    // Falls back to ARUBA_USERNAME (many Aruba SDI accounts use the P.IVA as username).
    const rawReceiver = process.env.ARUBA_VATCODE_RECEIVER || USERNAME || ''
    const vatReceiver = rawReceiver.replace(/\D/g, '')
    console.log('[Aruba] vatcodeReceiver source:', {
        from_env: !!process.env.ARUBA_VATCODE_RECEIVER,
        raw_length: rawReceiver.length,
        digits_length: vatReceiver.length,
        digits_preview: vatReceiver ? `${vatReceiver.slice(0, 2)}***${vatReceiver.slice(-2)}` : '(empty)',
    })
    if (!vatReceiver) {
        throw new Error('Aruba vatcodeReceiver mancante: settare ARUBA_VATCODE_RECEIVER (P.IVA della societa, solo cifre) in Netlify env')
    }
    queryParams.set('vatcodeReceiver', vatReceiver)
    if (params.page != null) queryParams.set('page', String(params.page))
    // Send both common pageSize names — different Aruba accounts honor different ones
    if (params.pageSize != null) {
        queryParams.set('pageSize', String(params.pageSize))
        queryParams.set('size', String(params.pageSize))
    }
    if (params.startDate) queryParams.set('startDate', params.startDate)
    if (params.endDate) queryParams.set('endDate', params.endDate)
    if (params.senderDescription) queryParams.set('senderDescription', params.senderDescription)

    // Backoff esponenziale 2s/4s/8s + jitter. Aruba puo' tenere il
    // rate limit per ~30s — 5 tentativi danno fino a ~30s totali prima
    // di mollare, dentro la finestra di 26s del Netlify background.
    let response: Response | null = null
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        response = await fetch(`${ARUBA_API_URL}/services/invoice/in/findByUsername?${queryParams}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
        })
        if (response.status !== 429) break
        const base = 2000 * Math.pow(2, attempt) // 2s, 4s, 8s, 16s, 32s
        const wait = Math.min(base, 8000) + Math.floor(Math.random() * 500)
        console.warn(`[Aruba] 429 on findByUsername, retry in ${wait}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`)
        await new Promise(r => setTimeout(r, wait))
    }
    if (!response) throw new Error('Aruba findByUsername: no response')

    // Errore 429 dopo tutti i retry → messaggio pulito senza HTML/CSS.
    if (response.status === 429) {
        throw new Error('Aruba ha limitato le richieste (429). Riprova tra qualche minuto.')
    }

    if (!response.ok) {
        const text = await response.text()
        // Rimuovi blocchi <style>...</style> e <script>...</script> PRIMA
        // di togliere i tag, altrimenti il loro contenuto (CSS/JS) finisce
        // nel messaggio mostrato all'admin come testo grezzo.
        const cleanText = text
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        const snippet = cleanText.length > 200 ? cleanText.slice(0, 200) + '...' : cleanText
        throw new Error(`Aruba Incoming Search Failed: ${response.status}${snippet ? ' — ' + snippet : ''}`)
    }

    const result = await response.json()

    if (result.errorCode && result.errorCode !== '0000') {
        throw new Error(`Aruba Error ${result.errorCode}: ${result.errorDescription}`)
    }

    console.log('[Aruba] Incoming invoices found:', result.totalItems ?? result.invoices?.length ?? 0)
    return result
}

/**
 * Get a single incoming invoice with full details (XML/PDF)
 * Based on official docs: GET /services/invoice/in/getByFilename
 * Retries once with backoff on 429 (rate limit).
 */
export async function getIncomingInvoice(filename: string, includePdf = true): Promise<any> {
    const token = await getArubaToken()

    let response: Response | null = null
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        response = await fetch(
            `${ARUBA_API_URL}/services/invoice/in/getByFilename?filename=${encodeURIComponent(filename)}&includePdf=${includePdf}&includeFile=true`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                },
            }
        )
        if (response.status !== 429) break
        const base = 2000 * Math.pow(2, attempt)
        const wait = Math.min(base, 8000) + Math.floor(Math.random() * 500)
        console.warn(`[Aruba] 429 rate limit on ${filename}, retry in ${wait}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`)
        await new Promise(r => setTimeout(r, wait))
    }
    if (!response) throw new Error('Aruba getByFilename: no response')
    if (response.status === 429) {
        throw new Error(`Aruba 429 rate limit (filename ${filename})`)
    }

    if (!response.ok) {
        const text = await response.text()
        const cleanText = text
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        const snippet = cleanText.length > 200 ? cleanText.slice(0, 200) + '...' : cleanText
        throw new Error(`Aruba Incoming Invoice Fetch Failed: ${response.status}${snippet ? ' — ' + snippet : ''}`)
    }

    const result = await response.json()
    if (result.errorCode && result.errorCode !== '0000') {
        throw new Error(`Aruba Error ${result.errorCode}: ${result.errorDescription}`)
    }

    return result
}
