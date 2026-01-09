
/**
 * Utility functions for Invoicetronic JSON API
 */

export interface InvoiceData {
    id: string
    numero_fattura: string
    data_emissione: string
    customer_name: string
    customer_address: string
    customer_tax_code?: string
    customer_vat?: string
    items: any[]
    subtotal: number
    vat_amount: number
    exempt_amount?: number
    importo_totale: number
}

interface AddressParts {
    street: string
    cap: string
    comune: string
    provincia: string
}

/**
 * Parse address string into components
 * Expected format: "Via Roma 123, 09100 Cagliari (CA)"
 */
export function parseAddress(address: string): AddressParts {
    if (!address) return { street: '', cap: '', comune: '', provincia: '' }

    const parts = address.split(',').map(p => p.trim())

    if (parts.length >= 2) {
        const street = parts[0]
        const cityPart = parts[1]

        const capMatch = cityPart.match(/\b(\d{5})\b/)
        const cap = capMatch ? capMatch[1] : ''

        const provinciaMatch = cityPart.match(/\(([A-Z]{2})\)/)
        const provincia = provinciaMatch ? provinciaMatch[1] : ''

        let comune = cityPart

        if (cap) comune = comune.replace(cap, '').trim()
        if (provincia) comune = comune.replace(`(${provincia})`, '').trim()

        // Remove parentheses if they remain
        comune = comune.replace(/[()]/g, '').trim()

        return { street, cap, comune, provincia }
    }

    // Fallback: try to guess if it's just one string
    return { street: address, cap: '', comune: '', provincia: '' }
}

export function generateInvoicetronicPayload(invoice: any) {
    // Parse address to get structured data for Invoicetronic
    const address = parseAddress(invoice.customer_address || '')

    // Ensure we have required fields
    if (!invoice.numero_fattura) {
        throw new Error('Invoice number (numero_fattura) is required')
    }
    if (!invoice.data_emissione) {
        throw new Error('Invoice date (data_emissione) is required')
    }
    if (!invoice.customer_name) {
        throw new Error('Customer name is required')
    }
    if (!invoice.customer_tax_code && !invoice.customer_vat) {
        throw new Error('Either customer tax code or VAT number is required')
    }

    return {
        // Invoicetronic specific fields
        external_id: invoice.id,
        print_template: true, // Auto-generate PDF

        // FatturaPA core data
        header: {
            date: invoice.data_emissione, // YYYY-MM-DD
            number: invoice.numero_fattura,
            currency: 'EUR'
        },
        company: {
            vat: invoice.customer_vat || '',
            fiscal_code: invoice.customer_tax_code || '',
            name: invoice.customer_name,
            recipient_code: invoice.customer_sdi_code || '0000000',
            pec: invoice.customer_pec || '',
            address: {
                street: address.street || invoice.customer_address || 'N/A',
                city: address.comune || 'N/A',
                province: address.provincia || 'CA',
                zip: address.cap || '00000',
                country: 'IT'
            }
        },
        items: (invoice.items || []).map((item: any) => ({
            name: item.description || 'Servizio',
            price: item.unit_price || 0,
            quantity: item.quantity || 1,
            vat: item.vat_rate || 0
        }))
    }
}
