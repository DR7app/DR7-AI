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
            <td style="padding: 8px 6px; border-bottom: 1px solid #e5e7eb;">
                <div style="font-weight: 500; color: #111827; font-size: 13px;">${item.description}</div>
            </td>
            <td style="padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 13px;">€${item.unit_price.toFixed(2)}</td>
            <td style="padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 13px;">${item.quantity}</td>
            <td style="padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 13px;">${item.vat_rate}%</td>
            <td style="padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; font-size: 13px;">€${(item.unit_price * item.quantity).toFixed(2)}</td>
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
            padding: 25px;
            color: #111827;
            background: #fff;
            line-height: 1.4;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
        }
        .logo img {
            height: 60px;
            width: auto;
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
            margin-bottom: 15px;
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
            padding: 12px 15px;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
        }
        .company-details p, .customer-details p {
            margin: 2px 0;
            color: #374151;
            font-size: 13px;
        }
        .company-name {
            font-weight: 700;
            font-size: 14px;
            color: #111827;
            margin-bottom: 6px;
        }
        .two-column {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 15px;
        }
        .invoice-meta {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 12px;
            align-items: center;
            margin-bottom: 15px;
            padding: 10px 12px;
            background: #f9fafb;
            border-radius: 6px;
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
            margin-bottom: 15px;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            overflow: hidden;
        }
        thead {
            background: #f3f4f6;
        }
        th {
            padding: 8px 6px;
            text-align: left;
            font-size: 10px;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .summary {
            background: #f9fafb;
            padding: 15px;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            margin-bottom: 15px;
        }
        .summary-title {
            font-weight: 700;
            font-size: 14px;
            margin-bottom: 10px;
        }
        .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 13px;
        }
        .summary-row.total {
            border-top: 2px solid #111827;
            margin-top: 8px;
            padding-top: 10px;
            font-weight: 700;
            font-size: 15px;
        }
        .payment-info {
            background: #f0fdf4;
            border: 1px solid #86efac;
            padding: 10px 15px;
            border-radius: 6px;
            margin-bottom: 15px;
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
            padding-top: 12px;
            text-align: center;
            color: #6b7280;
            font-size: 11px;
            line-height: 1.6;
        }
        .footer strong {
            color: #111827;
        }
        @media print {
            body { padding: 15px; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="logo"><img src="https://dr7empire.com/DR7logo1.png" alt="DR7 Logo"></div>
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
                </div>
            </div>
            <div class="section">
                <div class="section-title">DESTINATARIO</div>
                <div class="customer-details">
                    <div class="company-name">${invoice.customer_name}</div>
                    ${invoice.customer_address ? `<p>${invoice.customer_address}</p>` : ''}
                    ${invoice.customer_phone ? `<p>Tel: ${invoice.customer_phone}</p>` : ''}
                    ${invoice.customer_email ? `<p>Email: ${invoice.customer_email}</p>` : ''}
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
            <p>Tel: 3457905205 &nbsp;|&nbsp; Email: Info@dr7.app &nbsp;|&nbsp; PEC: dubai.rent7.0srl@legalmail.it &nbsp;|&nbsp; Website: www.dr7empire.com</p>
            <p>Socio unico - Cap. soc. 50.000,00 €</p>
            <p>Regime Fiscale: Ordinario</p>
        </div>
    </div>
</body>
</html>
    `.trim()
}
