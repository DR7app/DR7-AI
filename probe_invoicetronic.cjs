require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const INVOICETRONIC_API_KEY = process.env.INVOICETRONIC_API_KEY;

if (!INVOICETRONIC_API_KEY) {
    console.error('Missing key');
    process.exit(1);
}

const endpoints = [
    'https://api.invoicetronic.com/v1',
    'https://api.invoicetronic.com/v1/company',
    'https://api.invoicetronic.com/v1/companies',
    'https://api.invoicetronic.com/invoices',
    'https://api.invoicetronic.com/company',
    'https://api.invoicetronic.com/v2/invoices',
    'https://api.invoicetronic.com/v1/status'
];

async function probe() {
    console.log('--- PROBING API ENDPOINTS (GET) ---');
    const fetch = (await import('node-fetch')).default;

    for (const url of endpoints) {
        console.log(`\nURL: ${url}`);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(INVOICETRONIC_API_KEY + ':').toString('base64')
                }
            });
            console.log(`Status: ${response.status} ${response.statusText}`);
            const text = await response.text();

            // Check if HTML or JSON
            if (text.trim().startsWith('<')) {
                console.log('Response: HTML Document (Not API)');
            } else {
                console.log(`Response: ${text.substring(0, 300)}`);
            }
        } catch (e) {
            console.log('Error:', e.message);
        }
    }
}

probe();
