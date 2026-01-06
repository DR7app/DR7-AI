const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function inspectAllPdfTemplates() {
    const templates = [
        'public/contract_templates/contract_template.pdf',
        'public/contract_templates/master_contract.pdf',
        'public/contract_templates/ducato_contract.pdf',
    ];

    for (const templatePath of templates) {
        const fullPath = path.join(__dirname, templatePath);

        if (!fs.existsSync(fullPath)) {
            console.log(`⚠️  File not found: ${templatePath}\n`);
            continue;
        }

        console.log('='.repeat(80));
        console.log(`📄 INSPECTING: ${templatePath}`);
        console.log('='.repeat(80));

        try {
            const pdfBytes = fs.readFileSync(fullPath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const form = pdfDoc.getForm();
            const fields = form.getFields();

            console.log(`\nTotal fields found: ${fields.length}\n`);

            if (fields.length === 0) {
                console.log('⚠️  No form fields found in this PDF!\n');
                continue;
            }

            // Group fields by category
            const secondDriverFields = [];
            const otherFields = [];

            fields.forEach(field => {
                const name = field.getName();
                const lowerName = name.toLowerCase();

                if (lowerName.includes('second') ||
                    lowerName.includes('driver') ||
                    lowerName.includes('guidatore') ||
                    lowerName.includes('secondo')) {
                    secondDriverFields.push(name);
                } else {
                    otherFields.push(name);
                }
            });

            if (secondDriverFields.length > 0) {
                console.log('🎯 SECOND DRIVER FIELDS:');
                console.log('='.repeat(80));
                secondDriverFields.forEach(name => console.log(`  - ${name}`));
                console.log('');
            } else {
                console.log('⚠️  No second driver fields found!\n');
            }

            console.log(`📋 ALL OTHER FIELDS (${otherFields.length} total):`);
            console.log('='.repeat(80));
            otherFields.slice(0, 20).forEach(name => console.log(`  - ${name}`));
            if (otherFields.length > 20) {
                console.log(`  ... and ${otherFields.length - 20} more fields`);
            }
            console.log('\n');

        } catch (error) {
            console.error(`❌ Error parsing PDF: ${error.message}\n`);
        }
    }
}

inspectAllPdfTemplates();
