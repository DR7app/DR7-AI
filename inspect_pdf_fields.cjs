
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function inspectPdf() {
    const pdfPath = path.join(__dirname, 'public/contract_templates/contract_template.pdf');

    if (!fs.existsSync(pdfPath)) {
        console.error(`File not found: ${pdfPath}`);
        return;
    }

    try {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const form = pdfDoc.getForm();
        const fields = form.getFields().map(f => f.getName());

        console.log('--- FORM FIELDS FOUND IN PDF ---');
        fields.forEach(f => console.log(f));
        console.log('--------------------------------');

        // Specific checks for Second Driver
        const secondDriverFields = fields.filter(f => f.toLowerCase().includes('second') || f.toLowerCase().includes('driver') || f.toLowerCase().includes('guidatore'));
        console.log('Potential Second Driver Fields:', secondDriverFields);

    } catch (error) {
        console.error('Error parsing PDF:', error);
    }
}

inspectPdf();
