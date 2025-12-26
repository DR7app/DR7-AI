import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Fattura Elettronica API credentials
const FATTURA_API_USERNAME = process.env.FATTURA_API_USERNAME || ''
const FATTURA_API_PASSWORD = process.env.FATTURA_API_PASSWORD || ''
const FATTURA_API_BASE_URL = process.env.FATTURA_API_BASE_URL || 'https://fattura-elettronica-api.it/ws2.0/test'

interface Invoice {
    id: string
    invoice_number: string
    invoice_date: string
    customer_name: string
    customer_address?: string
    customer_tax_code?: string
    customer_vat?: string
    items: InvoiceItem[]
    subtotal?: number
    vat_amount?: number
    exempt_amount?: number
    total?: number
}

interface InvoiceItem {
    description: string
    unit_price: number
    quantity: number
    vat_rate: number
    total?: number
}

export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invoice ID is required' })
            }
        }

        // Fetch invoice from database
        const { data: invoice, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !invoice) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Invoice not found' })
            }
        }

        // Update status to 'sending'
        await supabase
            .from('fatture')
            .update({ sdi_status: 'sending' })
            .eq('id', invoiceId)

        // Generate FatturaPA JSON payload
        const fatturaPayload = generateFatturaPayload(invoice)

        // Send to Fattura Elettronica API
        const authString = Buffer.from(`${FATTURA_API_USERNAME}:${FATTURA_API_PASSWORD}`).toString('base64')

        const response = await fetch(`${FATTURA_API_BASE_URL}/fatture`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authString}`
            },
            body: JSON.stringify(fatturaPayload)
        })

        const responseData = await response.json()

        if (!response.ok) {
            // Update status to 'error'
            await supabase
                .from('fatture')
                .update({
                    sdi_status: 'error',
                    sdi_response: responseData
                })
                .eq('id', invoiceId)

            return {
                statusCode: response.status,
                body: JSON.stringify({
                    error: 'Failed to send invoice to SDI',
                    details: responseData
                })
            }
        }

        // Update invoice with SDI response
        await supabase
            .from('fatture')
            .update({
                sdi_status: 'sent',
                sdi_id: responseData.id || responseData.IdFattura,
                sdi_sent_at: new Date().toISOString(),
                sdi_response: responseData,
                xml_fattura_pa: JSON.stringify(fatturaPayload, null, 2)
            })
            .eq('id', invoiceId)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Invoice sent to SDI successfully',
                sdi_id: responseData.id || responseData.IdFattura,
                response: responseData
            })
        }
    } catch (error: any) {
        console.error('Error sending invoice to SDI:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        }
    }
}

function generateFatturaPayload(invoice: Invoice) {
    // Parse customer address (format: "Via Roma 123, 09100 Cagliari (CA)")
    const addressParts = parseAddress(invoice.customer_address || '')

    // Generate line items (righe)
    const righe = (invoice.items || []).map(item => ({
        Descrizione: item.description,
        PrezzoUnitario: item.unit_price.toFixed(2),
        Quantita: item.quantity.toString(),
        AliquotaIVA: item.vat_rate
    }))

    return {
        destinatario: {
            CodiceFiscale: invoice.customer_tax_code || '',
            PartitaIVA: invoice.customer_vat || '',
            Denominazione: invoice.customer_name,
            Indirizzo: addressParts.street || invoice.customer_address,
            CAP: addressParts.cap || '09100',
            Comune: addressParts.comune || 'Cagliari',
            Provincia: addressParts.provincia || 'CA',
            Nazione: 'IT'
        },
        documento: {
            Data: invoice.invoice_date,
            Numero: invoice.invoice_number,
            TipoDocumento: 'TD01' // Standard invoice
        },
        righe
    }
}

function parseAddress(address: string) {
    // Try to parse address format: "Via Roma 123, 09100 Cagliari (CA)"
    const parts = address.split(',').map(p => p.trim())

    if (parts.length >= 2) {
        const street = parts[0]
        const cityPart = parts[1]

        // Extract CAP (postal code - 5 digits)
        const capMatch = cityPart.match(/\b(\d{5})\b/)
        const cap = capMatch ? capMatch[1] : ''

        // Extract Provincia (province code in parentheses)
        const provinciaMatch = cityPart.match(/\(([A-Z]{2})\)/)
        const provincia = provinciaMatch ? provinciaMatch[1] : ''

        // Extract Comune (city name - everything between CAP and provincia)
        let comune = cityPart
            .replace(cap, '')
            .replace(`(${provincia})`, '')
            .trim()

        return { street, cap, comune, provincia }
    }

    return { street: address, cap: '', comune: '', provincia: '' }
}
