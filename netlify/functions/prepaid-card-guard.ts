import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205'

export interface CardCheckResult {
    isPrepaid: boolean
    cardType: string  // 'credit' | 'debit' | 'prepaid' | 'unknown'
    cardCircuit: string  // 'VISA' | 'MC' | 'AMEX' etc
    maskedPan: string
    detectionMethod: string  // 'nexi_api' | 'bin_lookup' | 'keyword' | 'none'
    rawData: any
}

/**
 * Detect card type from Nexi operation details + BIN lookup.
 * Uses Nexi API data as primary source (as required).
 * BIN lookup as secondary confirmation only.
 */
export async function detectCardType(operationId: string, callbackData?: any): Promise<CardCheckResult> {
    const result: CardCheckResult = {
        isPrepaid: false,
        cardType: 'unknown',
        cardCircuit: '',
        maskedPan: '',
        detectionMethod: 'none',
        rawData: {}
    }

    // 1. PRIMARY: Check Nexi operation details (server-side, authoritative)
    if (operationId) {
        try {
            const controller = new AbortController()
            const timeout = globalThis.setTimeout(() => controller.abort(), 5000)
            const opRes = await fetch(`${NEXI_BASE_URL}/operations/${operationId}`, {
                headers: {
                    'X-Api-Key': NEXI_API_KEY,
                    'Correlation-Id': `${Date.now()}`
                },
                signal: controller.signal
            })
            clearTimeout(timeout)

            if (opRes.ok) {
                const opData = await opRes.json()
                result.rawData.nexi_operation = opData

                // Extract card info from Nexi response
                const op = opData.operation || opData
                const additionalData = op.additionalData || {}

                result.cardCircuit = op.paymentCircuit || additionalData.brand || ''
                result.maskedPan = op.paymentInstrumentInfo || additionalData.maskedPan || ''

                // Check Nexi's prepagata flag
                const prepagata = additionalData.prepagata || additionalData.prepaid || op.prepagata
                if (prepagata === 'S' || prepagata === true || prepagata === 'true' || prepagata === 'Y') {
                    result.isPrepaid = true
                    result.cardType = 'prepaid'
                    result.detectionMethod = 'nexi_api'
                    return result
                }

                // Check tipoProdotto from Nexi
                const tipoProdotto = (additionalData.tipoProdotto || additionalData.productType || '').toLowerCase()
                if (tipoProdotto.includes('prepag') || tipoProdotto.includes('prepaid') || tipoProdotto.includes('ricaricabil')) {
                    result.isPrepaid = true
                    result.cardType = 'prepaid'
                    result.detectionMethod = 'nexi_api'
                    return result
                }

                // Determine credit/debit from Nexi data
                if (tipoProdotto.includes('credit') || tipoProdotto.includes('credito')) {
                    result.cardType = 'credit'
                    result.detectionMethod = 'nexi_api'
                } else if (tipoProdotto.includes('debit') || tipoProdotto.includes('debito')) {
                    result.cardType = 'debit'
                    result.detectionMethod = 'nexi_api'
                }
            }
        } catch (e) {
            console.warn('[prepaid-card-guard] Nexi operation fetch error:', e)
        }
    }

    // 2. SECONDARY: BIN lookup for confirmation (if Nexi didn't give clear type)
    if (result.cardType === 'unknown' && result.maskedPan) {
        const binMatch = result.maskedPan.match(/^(\d{6,8})/)
        if (binMatch) {
            try {
                const controller = new AbortController()
                const timeout = globalThis.setTimeout(() => controller.abort(), 3000)
                const binRes = await fetch(`https://lookup.binlist.net/${binMatch[1]}`, {
                    headers: { 'Accept-Version': '3' },
                    signal: controller.signal
                })
                clearTimeout(timeout)

                if (binRes.ok) {
                    const binData = await binRes.json()
                    result.rawData.bin_lookup = binData
                    const binType = (binData.type || '').toLowerCase()

                    if (binType === 'prepaid') {
                        result.isPrepaid = true
                        result.cardType = 'prepaid'
                        result.detectionMethod = 'bin_lookup'
                    } else if (binType === 'credit') {
                        result.cardType = 'credit'
                        result.detectionMethod = 'bin_lookup'
                    } else if (binType === 'debit') {
                        result.cardType = 'debit'
                        result.detectionMethod = 'bin_lookup'
                    }
                }
            } catch (e) {
                console.warn('[prepaid-card-guard] BIN lookup error:', e)
            }
        }
    }

    // 3. TERTIARY: Keyword search in callback data
    if (result.cardType === 'unknown' && callbackData) {
        const raw = JSON.stringify(callbackData).toLowerCase()
        if (raw.includes('prepagat') || raw.includes('prepaid') || raw.includes('ricaricabil')) {
            result.isPrepaid = true
            result.cardType = 'prepaid'
            result.detectionMethod = 'keyword'
        } else if (raw.includes('credito') || raw.includes('credit card')) {
            result.cardType = 'credit'
            result.detectionMethod = 'keyword'
        } else if (raw.includes('debito') || raw.includes('debit')) {
            result.cardType = 'debit'
            result.detectionMethod = 'keyword'
        }
    }

    return result
}

/**
 * Log card check attempt to database
 */
export async function logCardAttempt(params: {
    bookingId?: string
    customerId?: string
    customerName?: string
    customerEmail?: string
    cardCheck: CardCheckResult
    operationType: string
    nexiOrderId?: string
    nexiOperationId?: string
}) {
    try {
        await supabase.from('blocked_card_attempts').insert({
            booking_id: params.bookingId || null,
            customer_id: params.customerId || null,
            customer_name: params.customerName || null,
            customer_email: params.customerEmail || null,
            card_type: params.cardCheck.cardType,
            card_circuit: params.cardCheck.cardCircuit,
            masked_pan: params.cardCheck.maskedPan,
            bin_type: params.cardCheck.detectionMethod,
            operation_type: params.operationType,
            result: params.cardCheck.isPrepaid ? 'BLOCKED' : 'ALLOWED',
            nexi_order_id: params.nexiOrderId || null,
            nexi_operation_id: params.nexiOperationId || null,
            details: params.cardCheck.rawData
        })
    } catch (e) {
        console.error('[prepaid-card-guard] Failed to log attempt:', e)
    }
}

/**
 * Void/refund a Nexi transaction
 */
export async function voidNexiTransaction(operationId: string): Promise<boolean> {
    try {
        const res = await fetch(`${NEXI_BASE_URL}/operations/${operationId}/cancels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': `${Date.now()}`
            },
            body: JSON.stringify({
                description: 'Carta prepagata non accettata — rimborso automatico'
            })
        })
        console.log(`[prepaid-card-guard] Void result: ${res.status}`)
        return res.ok
    } catch (e) {
        console.error('[prepaid-card-guard] Void error:', e)
        return false
    }
}

/**
 * Cancel booking in database
 */
export async function cancelBooking(bookingId: string, reason: string) {
    const { data: booking } = await supabase
        .from('bookings')
        .select('booking_details')
        .eq('id', bookingId)
        .single()

    await supabase.from('bookings').update({
        status: 'cancelled',
        payment_status: 'unpaid',
        booking_details: {
            ...(booking?.booking_details || {}),
            cancelled_reason: reason,
            cancelled_at: new Date().toISOString()
        }
    }).eq('id', bookingId)
}

/**
 * Notify customer and admin about blocked prepaid card
 */
export async function notifyPrepaidBlocked(params: {
    customerPhone?: string
    customerName?: string
    bookingRef?: string
    amount?: string
}) {
    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'

    // Notify customer
    if (params.customerPhone) {
        await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customPhone: params.customerPhone,
                customMessage: `⚠️ *Pagamento rifiutato*\n\nGentile ${params.customerName || 'Cliente'},\n\nNon accettiamo carte prepagate. Utilizzare una carta di credito o debito.\n\n${params.bookingRef ? `La prenotazione #${params.bookingRef} è stata annullata e il pagamento verrà rimborsato.\n\n` : ''}Per assistenza contattaci.\n\nDR7`
            })
        })
    }

    // Notify admin
    if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
        await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: `${NOTIFICATION_PHONE}@c.us`,
                message: `🚫 *CARTA PREPAGATA BLOCCATA*\n\n*Cliente:* ${params.customerName || '-'}\n${params.amount ? `*Importo:* €${params.amount}\n` : ''}${params.bookingRef ? `*Prenotazione:* #${params.bookingRef}\n` : ''}\nOperazione rifiutata e rimborso avviato.`
            })
        })
    }
}
