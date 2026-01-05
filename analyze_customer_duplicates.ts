import { createClient } from '@supabase/supabase-js';

// Load environment variables - use same pattern as other scripts in the project
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
    console.error('❌ Error: Supabase key not found in environment variables');
    console.error('Please set VITE_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeCustomerDuplicates() {
    console.log('🔍 Analyzing duplicate customers in customers_extended table...\n');

    try {
        // 1. Find duplicates by email (excluding placeholder emails)
        console.log('📧 Checking for duplicate emails...');
        const { data: customers, error: fetchError } = await supabase
            .from('customers_extended')
            .select('id, email, nome, cognome, ragione_sociale, denominazione, created_at');

        if (fetchError) throw fetchError;

        // Group by email
        const emailGroups = new Map<string, any[]>();
        customers?.forEach(customer => {
            if (customer.email &&
                customer.email !== '' &&
                !customer.email.includes('placeholder') &&
                !customer.email.includes('noemail') &&
                !customer.email.includes('@example.com')) {
                const group = emailGroups.get(customer.email) || [];
                group.push(customer);
                emailGroups.set(customer.email, group);
            }
        });

        const duplicateEmails = Array.from(emailGroups.entries())
            .filter(([_, group]) => group.length > 1)
            .sort((a, b) => b[1].length - a[1].length);

        console.log(`   Found ${duplicateEmails.length} duplicate email groups`);
        duplicateEmails.slice(0, 10).forEach(([email, group]) => {
            const names = group.map(c => c.nome ? `${c.nome} ${c.cognome}` : c.ragione_sociale || c.denominazione).join(', ');
            console.log(`   - ${email} (${group.length} records): ${names}`);
        });
        if (duplicateEmails.length > 10) {
            console.log(`   ... and ${duplicateEmails.length - 10} more`);
        }
        console.log('');

        // 2. Find duplicates by phone
        console.log('📱 Checking for duplicate phone numbers...');
        const { data: customers2, error: fetchError2 } = await supabase
            .from('customers_extended')
            .select('id, telefono, nome, cognome, ragione_sociale, denominazione, created_at');

        if (fetchError2) throw fetchError2;

        const phoneGroups = new Map<string, any[]>();
        customers2?.forEach(customer => {
            if (customer.telefono &&
                customer.telefono !== '' &&
                !customer.telefono.includes('placeholder') &&
                !customer.telefono.includes('000000')) {
                const group = phoneGroups.get(customer.telefono) || [];
                group.push(customer);
                phoneGroups.set(customer.telefono, group);
            }
        });

        const duplicatePhones = Array.from(phoneGroups.entries())
            .filter(([_, group]) => group.length > 1)
            .sort((a, b) => b[1].length - a[1].length);

        console.log(`   Found ${duplicatePhones.length} duplicate phone groups`);
        duplicatePhones.slice(0, 10).forEach(([phone, group]) => {
            const names = group.map(c => c.nome ? `${c.nome} ${c.cognome}` : c.ragione_sociale || c.denominazione).join(', ');
            console.log(`   - ${phone} (${group.length} records): ${names}`);
        });
        if (duplicatePhones.length > 10) {
            console.log(`   ... and ${duplicatePhones.length - 10} more`);
        }
        console.log('');

        // 3. Find duplicates by codice_fiscale
        console.log('🆔 Checking for duplicate Codice Fiscale...');
        const { data: customers3, error: fetchError3 } = await supabase
            .from('customers_extended')
            .select('id, codice_fiscale, nome, cognome, created_at')
            .eq('tipo_cliente', 'persona_fisica')
            .not('codice_fiscale', 'is', null)
            .neq('codice_fiscale', '');

        if (fetchError3) throw fetchError3;

        const cfGroups = new Map<string, any[]>();
        customers3?.forEach(customer => {
            const group = cfGroups.get(customer.codice_fiscale!) || [];
            group.push(customer);
            cfGroups.set(customer.codice_fiscale!, group);
        });

        const duplicateCF = Array.from(cfGroups.entries())
            .filter(([_, group]) => group.length > 1)
            .sort((a, b) => b[1].length - a[1].length);

        console.log(`   Found ${duplicateCF.length} duplicate Codice Fiscale groups`);
        duplicateCF.slice(0, 10).forEach(([cf, group]) => {
            const names = group.map(c => `${c.nome} ${c.cognome}`).join(', ');
            console.log(`   - ${cf} (${group.length} records): ${names}`);
        });
        if (duplicateCF.length > 10) {
            console.log(`   ... and ${duplicateCF.length - 10} more`);
        }
        console.log('');

        // 4. Find duplicates by partita_iva
        console.log('🏢 Checking for duplicate Partita IVA...');
        const { data: customers4, error: fetchError4 } = await supabase
            .from('customers_extended')
            .select('id, partita_iva, ragione_sociale, created_at')
            .eq('tipo_cliente', 'azienda')
            .not('partita_iva', 'is', null)
            .neq('partita_iva', '');

        if (fetchError4) throw fetchError4;

        const pivaGroups = new Map<string, any[]>();
        customers4?.forEach(customer => {
            const group = pivaGroups.get(customer.partita_iva!) || [];
            group.push(customer);
            pivaGroups.set(customer.partita_iva!, group);
        });

        const duplicatePIVA = Array.from(pivaGroups.entries())
            .filter(([_, group]) => group.length > 1)
            .sort((a, b) => b[1].length - a[1].length);

        console.log(`   Found ${duplicatePIVA.length} duplicate Partita IVA groups`);
        duplicatePIVA.slice(0, 10).forEach(([piva, group]) => {
            const names = group.map(c => c.ragione_sociale).join(', ');
            console.log(`   - ${piva} (${group.length} records): ${names}`);
        });
        if (duplicatePIVA.length > 10) {
            console.log(`   ... and ${duplicatePIVA.length - 10} more`);
        }
        console.log('');

        // 5. Summary statistics
        console.log('📊 Summary Statistics:');
        const { count: totalCustomers } = await supabase
            .from('customers_extended')
            .select('*', { count: 'exact', head: true });

        console.log(`   Total customers: ${totalCustomers}`);

        const totalDuplicateRecords =
            duplicateEmails.reduce((sum, [_, group]) => sum + (group.length - 1), 0) +
            duplicatePhones.reduce((sum, [_, group]) => sum + (group.length - 1), 0) +
            duplicateCF.reduce((sum, [_, group]) => sum + (group.length - 1), 0) +
            duplicatePIVA.reduce((sum, [_, group]) => sum + (group.length - 1), 0);

        console.log(`   Estimated duplicate records to merge: ~${totalDuplicateRecords}`);
        console.log(`   Estimated unique customers after merge: ~${totalCustomers! - totalDuplicateRecords}`);
        console.log('');

        console.log('✅ Analysis complete!');
        console.log('');
        console.log('📝 Next steps:');
        console.log('   1. Review the duplicate groups above');
        console.log('   2. If everything looks correct, run the merge script');
        console.log('');

    } catch (error) {
        console.error('❌ Error analyzing duplicates:', error);
        process.exit(1);
    }
}

analyzeCustomerDuplicates();
