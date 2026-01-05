// Merge duplicate customers in customers_extended table
import { createClient } from '@supabase/supabase-js';

// Hardcoded credentials from project pattern
const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
    console.error('❌ Missing Supabase key');
    console.error('This script needs to run with service role key for RPC functions');
    console.log('\nPlease run the SQL script directly in Supabase SQL Editor:');
    console.log('File: merge_duplicate_customers.sql');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function mergeDuplicateCustomers() {
    console.log('🔄 Starting customer merge process...\n');

    try {
        // Execute the merge SQL script via RPC or direct SQL
        console.log('📝 Please run the merge_duplicate_customers.sql script in your Supabase SQL Editor');
        console.log('   Location: merge_duplicate_customers.sql');
        console.log('\nThe script will:');
        console.log('   1. Identify all duplicates by email, phone, codice_fiscale, and partita_iva');
        console.log('   2. Keep the oldest record as primary');
        console.log('   3. Merge data from duplicates into primary records');
        console.log('   4. Update all foreign key references');
        console.log('   5. Delete duplicate records');
        console.log('\n✅ All operations are wrapped in a transaction for safety\n');

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

mergeDuplicateCustomers().catch(console.error);
