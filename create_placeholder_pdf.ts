
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'fs'

async function createPlaceholder() {
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    for (let i = 0; i < 9; i++) {
        const page = pdfDoc.addPage([595, 842])
        const { width, height } = page.getSize()
        page.drawText(`Contratto Placeholder - Pagina ${i + 1}`, {
            x: 50,
            y: height - 50,
            size: 24,
            font: font,
            color: rgb(0, 0, 0),
        })
        page.drawText(`(Sostituisci questo file con il tuo contratto reale)`, {
            x: 50,
            y: height - 80,
            size: 12,
            font: font,
            color: rgb(1, 0, 0),
        })
    }

    const pdfBytes = await pdfDoc.save()
    fs.writeFileSync('public/contract_templates/contract_template.pdf', pdfBytes)
    console.log('Placeholder PDF created at public/contract_templates/contract_template.pdf')
}

createPlaceholder()
