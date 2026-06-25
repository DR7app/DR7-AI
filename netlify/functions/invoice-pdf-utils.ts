import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'

// Default invoice footer lines (legal/company info shown on every PDF).
// Admin can override via centralina_pro_config.config.invoice.footer_lines
// — array of strings, one per line. Changes apply to next generated invoice.
const DEFAULT_INVOICE_FOOTER_LINES = [
    'DR7 S.p.A. - Iscr. reg. imp.: 04104640927',
    'Tel: 3457905205 | Email: Info@dr7.app | PEC: dubai.rent7.0srl@legalmail.it | Website: www.dr7.app',
    'Socio unico - Cap. soc. 1.000.000,00 € | Regime Fiscale: Ordinario',
]

async function loadFooterLines(): Promise<string[]> {
    try {
        const url = process.env.VITE_SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) return DEFAULT_INVOICE_FOOTER_LINES
        const supabase = createClient(url, key)
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        const cfg = (data?.config || {}) as Record<string, unknown>
        const inv = (cfg.invoice || {}) as Record<string, unknown>
        const lines = inv.footer_lines
        if (Array.isArray(lines) && lines.length > 0) {
            return lines.map(String).filter(s => s.trim().length > 0)
        }
    } catch (e) {
        console.warn('[invoice-pdf-utils] footer lines lookup failed, using default', e)
    }
    return DEFAULT_INVOICE_FOOTER_LINES
}

interface InvoiceItem {
    description: string
    unit_price: number
    quantity: number
    vat_rate: number
}

interface InvoiceData {
    numero_fattura: string
    data_emissione: string
    customer_name: string
    customer_address?: string
    customer_phone?: string
    customer_email?: string
    customer_tax_code?: string
    customer_vat?: string
    items: InvoiceItem[]
    subtotal: number
    vat_amount: number
    exempt_amount: number
    importo_totale: number
    stato: string
    tipo_fattura?: string
}

const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const BLACK = rgb(0, 0, 0)
const GRAY = rgb(0.4, 0.4, 0.4)
const LIGHT_GRAY = rgb(0.92, 0.93, 0.94)
const GREEN = rgb(0.086, 0.396, 0.204)

function drawLine(page: any, y: number, font: any) {
    page.drawRectangle({
        x: MARGIN,
        y,
        width: CONTENT_WIDTH,
        height: 0.5,
        color: rgb(0.88, 0.88, 0.88),
    })
}

export async function generateInvoicePDF(invoice: InvoiceData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    let y = PAGE_HEIGHT - MARGIN

    // --- Logo ---
    let logoImage: any = null
    try {
        const logoBytes = await fetch('https://dr7.app/DR7logo1.png').then(res => res.arrayBuffer())
        logoImage = await pdfDoc.embedPng(logoBytes)
    } catch (e) {
        console.error('[invoice-pdf] Failed to load logo:', e)
    }

    if (logoImage) {
        const logoDims = logoImage.scale(0.15)
        page.drawImage(logoImage, {
            x: MARGIN,
            y: y - logoDims.height,
            width: logoDims.width,
            height: logoDims.height,
        })
    }

    // --- Invoice Title (right-aligned) ---
    const isNotaCredito = invoice.tipo_fattura === 'nota_di_credito' || invoice.tipo_fattura === 'nota_credito' || invoice.tipo_fattura === 'TD04'
    const titleText = `${isNotaCredito ? 'Nota di Credito' : 'Fattura'} ${invoice.numero_fattura}`
    const titleWidth = fontBold.widthOfTextAtSize(titleText, 18)
    page.drawText(titleText, {
        x: PAGE_WIDTH - MARGIN - titleWidth,
        y: y - 18,
        size: 18,
        font: fontBold,
        color: BLACK,
    })

    const dateText = `del ${new Date(invoice.data_emissione).toLocaleDateString('it-IT')}`
    const dateWidth = font.widthOfTextAtSize(dateText, 11)
    page.drawText(dateText, {
        x: PAGE_WIDTH - MARGIN - dateWidth,
        y: y - 34,
        size: 11,
        font,
        color: GRAY,
    })

    y -= 65

    // --- Company & Customer Info (two columns) ---
    const colWidth = (CONTENT_WIDTH - 20) / 2
    const leftX = MARGIN
    const rightX = MARGIN + colWidth + 20

    // DA header
    page.drawText('DA', { x: leftX, y, size: 9, font: fontBold, color: GRAY })
    y -= 14

    const companyLines = [
        { text: 'DR7 S.p.A.', bold: true, size: 11 },
        { text: 'VIA DEL FANGARIO 25, 09122 CAGLIARI (CA)', bold: false, size: 9 },
        { text: 'P.IVA 04104640927', bold: false, size: 9 },
        { text: 'C.F. 04104640927', bold: false, size: 9 },
        { text: 'PEC: dubai.rent7.0srl@legalmail.it', bold: false, size: 9 },
    ]

    let companyY = y
    for (const line of companyLines) {
        page.drawText(line.text, {
            x: leftX,
            y: companyY,
            size: line.size,
            font: line.bold ? fontBold : font,
            color: BLACK,
        })
        companyY -= line.size + 4
    }

    // DESTINATARIO header
    page.drawText('DESTINATARIO', { x: rightX, y: y + 14, size: 9, font: fontBold, color: GRAY })

    const customerLines: { text: string; bold: boolean; size: number }[] = [
        { text: invoice.customer_name || 'Cliente', bold: true, size: 11 },
    ]
    if (invoice.customer_address) customerLines.push({ text: invoice.customer_address, bold: false, size: 9 })
    if (invoice.customer_phone) customerLines.push({ text: `Tel: ${invoice.customer_phone}`, bold: false, size: 9 })
    if (invoice.customer_email) customerLines.push({ text: `Email: ${invoice.customer_email}`, bold: false, size: 9 })
    // Aziende e PA hanno P.IVA -> mostra solo P.IVA. Il C.F. eventualmente
    // presente sul cliente azienda e' del rappresentante e non va in
    // fattura. I privati invece mostrano solo il C.F.
    if (invoice.customer_vat) {
        customerLines.push({ text: `P.IVA ${invoice.customer_vat}`, bold: false, size: 9 })
    } else if (invoice.customer_tax_code) {
        customerLines.push({ text: `C.F. ${invoice.customer_tax_code}`, bold: false, size: 9 })
    }

    let customerY = y
    for (const line of customerLines) {
        page.drawText(line.text, {
            x: rightX,
            y: customerY,
            size: line.size,
            font: line.bold ? fontBold : font,
            color: BLACK,
        })
        customerY -= line.size + 4
    }

    y = Math.min(companyY, customerY) - 15

    // --- Invoice Meta Bar ---
    page.drawRectangle({
        x: MARGIN,
        y: y - 30,
        width: CONTENT_WIDTH,
        height: 35,
        color: LIGHT_GRAY,
    })

    const metaItems = [
        { label: 'TIPO DI DOCUMENTO', value: isNotaCredito ? 'Nota di Credito (TD04)' : 'Fattura' },
        { label: 'NUMERO', value: invoice.numero_fattura },
        { label: 'DATA', value: new Date(invoice.data_emissione).toLocaleDateString('it-IT') },
    ]

    const metaSpacing = CONTENT_WIDTH / metaItems.length
    metaItems.forEach((item, i) => {
        const metaX = MARGIN + 10 + i * metaSpacing
        page.drawText(item.label, { x: metaX, y: y - 8, size: 7, font: fontBold, color: GRAY })
        page.drawText(item.value, { x: metaX, y: y - 22, size: 11, font: fontBold, color: BLACK })
    })

    y -= 50

    // --- Line Items Table ---
    // Header
    const cols = [
        { label: 'DESCRIZIONE', x: MARGIN, width: 220 },
        { label: 'IMPONIBILE', x: MARGIN + 225, width: 80 },
        { label: 'QTÀ', x: MARGIN + 310, width: 40 },
        { label: 'IVA', x: MARGIN + 355, width: 45 },
        { label: 'TOTALE', x: MARGIN + 405, width: 90 },
    ]

    page.drawRectangle({
        x: MARGIN,
        y: y - 14,
        width: CONTENT_WIDTH,
        height: 18,
        color: LIGHT_GRAY,
    })

    cols.forEach(col => {
        const align = col.label === 'DESCRIZIONE' ? col.x + 4 : col.x + col.width - font.widthOfTextAtSize(col.label, 7) - 4
        page.drawText(col.label, { x: align, y: y - 10, size: 7, font: fontBold, color: GRAY })
    })

    y -= 20

    // Rows
    const items = invoice.items || []
    items.forEach((item) => {
        const lineTotal = item.unit_price * item.quantity

        // Description (left-aligned)
        page.drawText(item.description, {
            x: cols[0].x + 4,
            y: y - 10,
            size: 9,
            font,
            color: BLACK,
            maxWidth: cols[0].width - 8,
        })

        // Imponibile (right-aligned)
        const priceStr = `€ ${item.unit_price.toFixed(2)}`
        const priceWidth = font.widthOfTextAtSize(priceStr, 9)
        page.drawText(priceStr, {
            x: cols[1].x + cols[1].width - priceWidth - 4,
            y: y - 10,
            size: 9,
            font,
            color: BLACK,
        })

        // Quantity (right-aligned)
        const qtyStr = String(item.quantity)
        const qtyWidth = font.widthOfTextAtSize(qtyStr, 9)
        page.drawText(qtyStr, {
            x: cols[2].x + cols[2].width - qtyWidth - 4,
            y: y - 10,
            size: 9,
            font,
            color: BLACK,
        })

        // IVA (right-aligned)
        const vatStr = `${item.vat_rate}%`
        const vatWidth = font.widthOfTextAtSize(vatStr, 9)
        page.drawText(vatStr, {
            x: cols[3].x + cols[3].width - vatWidth - 4,
            y: y - 10,
            size: 9,
            font,
            color: BLACK,
        })

        // Totale (right-aligned, bold)
        const totalStr = `€ ${lineTotal.toFixed(2)}`
        const totalWidth = fontBold.widthOfTextAtSize(totalStr, 9)
        page.drawText(totalStr, {
            x: cols[4].x + cols[4].width - totalWidth - 4,
            y: y - 10,
            size: 9,
            font: fontBold,
            color: BLACK,
        })

        drawLine(page, y - 16, font)
        y -= 22
    })

    y -= 10

    // --- Summary ---
    const summaryX = MARGIN + CONTENT_WIDTH - 200
    const summaryWidth = 200

    page.drawText('Riepilogo', { x: summaryX, y, size: 11, font: fontBold, color: BLACK })
    y -= 18

    const summaryRows: { label: string; value: string; bold?: boolean }[] = [
        { label: 'Imponibile', value: `€ ${invoice.subtotal.toFixed(2)}` },
    ]

    if (invoice.vat_amount > 0) {
        summaryRows.push({ label: 'IVA 22%', value: `€ ${invoice.vat_amount.toFixed(2)}` })
    } else {
        summaryRows.push({ label: 'IVA 0% (Esente)', value: '€ 0.00' })
    }

    summaryRows.push({ label: 'Totale fattura', value: `€ ${invoice.importo_totale.toFixed(2)}`, bold: true })

    if (invoice.stato === 'paid') {
        summaryRows.push({ label: 'Totale da pagare', value: '€ 0.00' })
    } else {
        summaryRows.push({ label: 'Importo dovuto', value: `€ ${invoice.importo_totale.toFixed(2)}` })
    }

    summaryRows.forEach(row => {
        const f = row.bold ? fontBold : font
        const sz = row.bold ? 12 : 10
        page.drawText(row.label, { x: summaryX, y, size: sz, font: f, color: BLACK })
        const valWidth = f.widthOfTextAtSize(row.value, sz)
        page.drawText(row.value, { x: summaryX + summaryWidth - valWidth, y, size: sz, font: f, color: BLACK })
        if (row.bold) {
            drawLine(page, y + 14, font)
        }
        y -= sz + 6
    })

    y -= 10

    // --- Payment Status ---
    const statusText = invoice.stato === 'paid' ? 'Pagata' : 'Non pagata'
    const statusColor = invoice.stato === 'paid' ? GREEN : rgb(0.6, 0.1, 0.1)
    page.drawText(statusText, {
        x: MARGIN,
        y,
        size: 12,
        font: fontBold,
        color: statusColor,
    })

    if (invoice.stato === 'paid') {
        page.drawText('Carta di credito / bancomat', {
            x: MARGIN,
            y: y - 14,
            size: 9,
            font,
            color: GREEN,
        })
    }

    // --- Footer ---
    const footerY = MARGIN + 30
    drawLine(page, footerY + 12, font)

    const footerLines = await loadFooterLines()

    footerLines.forEach((line, i) => {
        const lineWidth = font.widthOfTextAtSize(line, 7)
        page.drawText(line, {
            x: PAGE_WIDTH / 2 - lineWidth / 2,
            y: footerY - i * 10,
            size: 7,
            font,
            color: GRAY,
        })
    })

    return pdfDoc.save()
}
