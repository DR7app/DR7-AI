
const fs = require('fs');
const path = require('path');

const templatesDir = path.join(__dirname, '../public/contract_templates/ducato');
const outputFile = path.join(__dirname, '../netlify/functions/contract-assets.ts');

const pages = ['page_1.png', 'page_2.png', 'page_3.png', 'page_4.png'];

let fileContent = `// Auto-generated file. Do not edit manually.
export const contractPages = [\n`;

pages.forEach(page => {
    const filePath = path.join(templatesDir, page);
    if (fs.existsSync(filePath)) {
        const base64 = fs.readFileSync(filePath, 'base64');
        fileContent += `  "data:image/png;base64,${base64}",\n`;
        console.log(`Processed ${page}`);
    } else {
        console.error(`Missing ${page}`);
    }
});

fileContent += `];\n`;

fs.writeFileSync(outputFile, fileContent);
console.log(`Assets written to ${outputFile}`);
