const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // Check the existing Fanni booking to see what fields are set
  const { data: existing } = await s.from('bookings')
    .select('id,user_id,guest_name,guest_email,guest_phone,source,customer_name,customer_email,customer_phone')
    .eq('id', 'c0834e27-2819-452f-b35b-d2394e673e64')
    .single();

  console.log('Existing Fanni booking fields:');
  console.log(JSON.stringify(existing, null, 2));

  // Check customers table
  const { data: customer } = await s.from('customers')
    .select('*')
    .ilike('full_name', '%fanni%');
  console.log('\nCustomer record:');
  console.log(JSON.stringify(customer, null, 2));
})();
