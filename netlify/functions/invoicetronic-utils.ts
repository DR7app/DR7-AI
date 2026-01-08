
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
                street: address.street,
                city: address.comune,
                province: address.provincia,
                zip: address.cap,
                country: 'IT'
            }
        },
        items: (invoice.items || []).map((item: any) => ({
            name: item.description,
            price: item.unit_price,
            quantity: item.quantity,
            vat: item.vat_rate
        }))
    }
}
