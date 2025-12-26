import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
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

        // Generate HTML for the invoice
        const html = generateInvoiceHTML(invoice)

        // Update invoice with HTML
        await supabase
            .from('fatture')
            .update({ invoice_html: html })
            .eq('id', invoiceId)

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8'
            },
            body: html
        }
    } catch (error: any) {
        console.error('Error generating invoice PDF:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to generate invoice PDF',
                message: error.message
            })
        }
    }
}

function generateInvoiceHTML(invoice: any): string {
    const items = invoice.items || []
    const itemsHTML = items.map((item: any) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.description}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">€${item.unit_price.toFixed(2)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.vat_rate}%</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">€${(item.unit_price * item.quantity).toFixed(2)}</td>
        </tr>
    `).join('')

    return `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fattura ${invoice.numero_fattura}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        .header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            border-bottom: 2px solid #000;
            padding-bottom: 20px;
        }
        .company-info {
            flex: 1;
        }
        .invoice-info {
            text-align: right;
        }
        .invoice-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .customer-info {
            background-color: #f5f5f5;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        th {
            background-color: #000;
            color: #fff;
            padding: 10px;
            text-align: left;
        }
        .totals {
            text-align: right;
            margin-top: 20px;
        }
        .totals table {
            margin-left: auto;
            width: 300px;
        }
        .totals td {
            padding: 5px 10px;
        }
        .total-row {
            font-weight: bold;
            font-size: 18px;
            border-top: 2px solid #000;
        }
        @media print {
            body {
                padding: 0;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-info">
            <h1 style="margin: 0; font-size: 20px;">DR7 S.p.A</h1>
            <p style="margin: 5px 0;">Viale Marconi, 229</p>
            <p style="margin: 5px 0;">09131 Cagliari (CA)</p>
            <p style="margin: 5px 0;">P.IVA: 04066690923</p>
            <p style="margin: 5px 0;">Email: info@dr7.app</p>
        </div>
        <div class="invoice-info">
            <div class="invoice-title">FATTURA</div>
            <p><strong>N°:</strong> ${invoice.numero_fattura}</p>
            <p><strong>Data:</strong> ${new Date(invoice.data_emissione).toLocaleDateString('it-IT')}</p>
        </div>
    </div>

    <div class="customer-info">
        <h3 style="margin-top: 0;">Cliente</h3>
        <p><strong>${invoice.customer_name}</strong></p>
        ${invoice.customer_address ? `<p>${invoice.customer_address}</p>` : ''}
        ${invoice.customer_tax_code ? `<p>Codice Fiscale: ${invoice.customer_tax_code}</p>` : ''}
        ${invoice.customer_vat ? `<p>P.IVA: ${invoice.customer_vat}</p>` : ''}
    </div>

    <table>
        <thead>
            <tr>
                <th>Descrizione</th>
                <th style="text-align: center;">Quantità</th>
                <th style="text-align: right;">Prezzo Unitario</th>
                <th style="text-align: center;">IVA</th>
                <th style="text-align: right;">Totale</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHTML}
        </tbody>
    </table>

    <div class="totals">
        <table>
            <tr>
                <td>Imponibile:</td>
                <td style="text-align: right;">€${(invoice.subtotal || 0).toFixed(2)}</td>
            </tr>
            <tr>
                <td>IVA (22%):</td>
                <td style="text-align: right;">€${(invoice.vat_amount || 0).toFixed(2)}</td>
            </tr>
            ${invoice.exempt_amount > 0 ? `
            <tr>
                <td>Esente IVA:</td>
                <td style="text-align: right;">€${invoice.exempt_amount.toFixed(2)}</td>
            </tr>
            ` : ''}
            <tr class="total-row">
                <td>TOTALE:</td>
                <td style="text-align: right;">€${(invoice.importo_totale || 0).toFixed(2)}</td>
            </tr>
        </table>
    </div>

    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
        <p>Pagamento: ${invoice.stato === 'paid' ? 'Pagato' : 'Non pagato'}</p>
        <p>Documento emesso in forma elettronica ai sensi del D.Lgs. 127/2015</p>
    </div>
</body>
</html>
    `.trim()
}
