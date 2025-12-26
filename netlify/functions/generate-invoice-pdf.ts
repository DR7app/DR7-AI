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

    // Calculate totals
    const imponibile = invoice.subtotal || 0
    const iva = invoice.vat_amount || 0
    const totale = invoice.importo_totale || 0

    const itemsHTML = items.map((item: any, index: number) => `
        <tr>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb;">
                <div style="font-weight: 500; color: #111827; margin-bottom: 4px;">${item.description}</div>
            </td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">€${item.unit_price.toFixed(2)}</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.vat_rate}%</td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">€${(item.unit_price * item.quantity).toFixed(2)}</td>
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
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            padding: 40px;
            color: #111827;
            background: #fff;
            line-height: 1.5;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 40px;
        }
        .logo {
            background: #000;
            color: #FFD700;
            padding: 20px 30px;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 2px;
        }
        .invoice-title {
            text-align: right;
            font-size: 28px;
            font-weight: bold;
        }
        .invoice-date {
            text-align: right;
            color: #6b7280;
            margin-top: 5px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 11px;
            text-transform: uppercase;
            color: #6b7280;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
            font-weight: 600;
        }
        .company-details, .customer-details {
            background: #f9fafb;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
        }
        .company-details p, .customer-details p {
            margin: 4px 0;
            color: #374151;
        }
        .company-name {
            font-weight: 700;
            font-size: 16px;
            color: #111827;
            margin-bottom: 8px;
        }
        .two-column {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 30px;
        }
        .invoice-meta {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 15px;
            align-items: center;
            margin-bottom: 30px;
            padding: 15px;
            background: #f9fafb;
            border-radius: 8px;
        }
        .invoice-meta label {
            font-size: 11px;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
        }
        .invoice-meta .value {
            padding: 8px 12px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 4px;
            font-weight: 600;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
        }
        thead {
            background: #f3f4f6;
        }
        th {
            padding: 12px 8px;
            text-align: left;
            font-size: 11px;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .summary {
            background: #f9fafb;
            padding: 25px;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
            margin-bottom: 30px;
        }
        .summary-title {
            font-weight: 700;
            font-size: 16px;
            margin-bottom: 15px;
        }
        .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 15px;
        }
        .summary-row.total {
            border-top: 2px solid #111827;
            margin-top: 10px;
            padding-top: 15px;
            font-weight: 700;
            font-size: 18px;
        }
        .payment-info {
            background: #f0fdf4;
            border: 1px solid #86efac;
            padding: 15px 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .payment-info .status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            color: #166534;
        }
        .footer {
            border-top: 2px solid #e5e7eb;
            padding-top: 20px;
            text-align: center;
            color: #6b7280;
            font-size: 13px;
            line-height: 1.8;
        }
        .footer strong {
            color: #111827;
        }
        @media print {
            body { padding: 20px; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="logo">DR7</div>
            <div>
                <div class="invoice-title">Fattura ${invoice.numero_fattura}</div>
                <div class="invoice-date">del ${new Date(invoice.data_emissione).toLocaleDateString('it-IT')}</div>
            </div>
        </div>

        <!-- Company and Customer Info -->
        <div class="two-column">
            <div class="section">
                <div class="section-title">DA</div>
                <div class="company-details">
                    <div class="company-name">Dubai rent 7.0 S.p.A.</div>
                    <p>VIA DEL FANGARIO 25, 09122 CAGLIARI (CA)</p>
                    <p>P.IVA 04104640927</p>
                    <p>C.F. 04104640927</p>
                    <p>PEC: dubai.rent7.0srl@legalmail.it</p>
                    <p>Website: www.dr7empire.com</p>
                </div>
            </div>
            <div class="section">
                <div class="section-title">DESTINATARIO</div>
                <div class="customer-details">
                    <div class="company-name">${invoice.customer_name}</div>
                    ${invoice.customer_address ? `<p>${invoice.customer_address}</p>` : ''}
                    ${invoice.customer_tax_code ? `<p>C.F. ${invoice.customer_tax_code}</p>` : ''}
                    ${invoice.customer_vat ? `<p>P.IVA ${invoice.customer_vat}</p>` : ''}
                </div>
            </div>
        </div>

        <!-- Invoice Meta -->
        <div class="invoice-meta">
            <label>TIPO DI DOCUMENTO</label>
            <div class="value">Fattura</div>
            <div></div>
            
            <label>NUMERO</label>
            <div class="value">${invoice.numero_fattura}</div>
            <div></div>
            
            <label>DATA</label>
            <div class="value">${new Date(invoice.data_emissione).toLocaleDateString('it-IT')}</div>
            <div></div>
        </div>

        <!-- Line Items -->
        <table>
            <thead>
                <tr>
                    <th>DESCRIZIONE</th>
                    <th style="text-align: right;">IMPONIBILE</th>
                    <th style="text-align: center;">QUANTITÀ</th>
                    <th style="text-align: center;">IVA</th>
                    <th style="text-align: right;">TOTALE</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHTML}
            </tbody>
        </table>

        <!-- Summary -->
        <div class="summary">
            <div class="summary-title">Riepilogo</div>
            <div class="summary-row">
                <span>Imponibile</span>
                <span>€${imponibile.toFixed(2)}</span>
            </div>
            <div class="summary-row">
                <span>IVA 22%</span>
                <span>€${iva.toFixed(2)}</span>
            </div>
            <div class="summary-row total">
                <span>Totale fattura</span>
                <span>€${totale.toFixed(2)}</span>
            </div>
            <div class="summary-row total">
                <span>Importo dovuto</span>
                <span>€${totale.toFixed(2)}</span>
            </div>
        </div>

        <!-- Payment Info -->
        <div class="payment-info">
            <div class="status">
                <span style="font-size: 18px;">✓</span>
                <span>${invoice.stato === 'paid' ? 'Pagata' : 'Non pagata'}</span>
            </div>
            ${invoice.stato === 'paid' ? '<p style="margin-top: 8px; color: #166534;">Carta di credito / bancomat</p>' : ''}
        </div>

        <!-- Footer -->
        <div class="footer">
            <p><strong>Dubai rent 7.0 S.p.A.</strong> Iscr. reg. imp.: 04104640927</p>
            <p>Tel: 3457905205 &nbsp;|&nbsp; Email: amministrazione@dr7luxuryempire.com &nbsp;|&nbsp; PEC: dubai.rent7.0srl@legalmail.it &nbsp;|&nbsp; Website: www.dr7empire.com</p>
            <p>Socio unico - Cap. soc. 50.000,00 €</p>
            <p>Regime Fiscale: Ordinario</p>
        </div>
    </div>
</body>
</html>
    `.trim()
}
`
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
