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
