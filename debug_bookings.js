
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Try to get keys from process.env, with fallbacks if running locally with .env not loaded 
// (assuming the user environment might not passed perfectly to this script)
// BUT since we can't easily read the .env file if it's not standard:
// I'll grab the ANON KEY from the file I just read? No, that was import.meta.
// I'll assume the environment variables are available in the shell or I'll try to find them.
// Let's try to cat the .env file first? No, security.
// I'll use the hardcoded URL I saw and try to use the VITE_ key if available in env.

const supabaseUrl = 'https://ahpmzjgkfxrrgxyirasa.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
    console.error("❌ ERROR: VITE_SUPABASE_ANON_KEY is missing from environment. Cannot run debug script.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugBookings() {
    console.log("🔍 Querying bookings for 'Panda' or 'Fiat'...");

    const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .or('vehicle_name.ilike.%Panda%,vehicle_name.ilike.%Fiat%')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("❌ Error fetching bookings:", error);
        return;
    }

    console.log(`✅ Found ${data.length} bookings.`);
    data.forEach(b => {
        console.log("---------------------------------------------------");
        console.log(`ID: ${b.id}`);
        console.log(`Vehicle Name: '${b.vehicle_name}'`);
        console.log(`Vehicle Plate: '${b.vehicle_plate}'`);
        console.log(`Service Type: '${b.service_type}'`);
        console.log(`Status: '${b.status}'`);
        console.log(`Dates: ${b.pickup_date} -> ${b.dropoff_date}`);
        console.log(`Customer: ${b.customer_name}`);
    });
}

debugBookings();
