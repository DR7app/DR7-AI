require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co';
let supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey || supabaseServiceKey.startsWith('your_')) {
    supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY;
}

if (!supabaseServiceKey) {
    console.error('Error: Missing Supabase Key. Please provide SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkLatestInvoice() {
    console.log('Fetching latest invoice...');

    const { data, error } = await supabase
        .from('fatture')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error fetching invoice:', error);
        return;
    }

    if (!data) {
        console.log('No invoices found.');
        return;
    }

    console.log('--- LATEST INVOICE ---');
    console.log('ID:', data.id);
    console.log('Number:', data.numero_fattura);
    console.log('Created At:', data.created_at);
    console.log('SDI Status:', data.sdi_status);
    console.log('SDI ID:', data.sdi_id);
    console.log('SDI Response:', JSON.stringify(data.sdi_response, null, 2));
    console.log('----------------------');
}

checkLatestInvoice();
