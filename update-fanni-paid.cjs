const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  const bookingId = '27ebdf3b-98a1-40a4-98e4-651f70235481';

  // Update booking to paid status
  // Price TBD - user needs to confirm exact amount
  const { data, error } = await s.from('bookings')
    .update({
      payment_status: 'paid',
      status: 'confirmed'
    })
    .eq('id', bookingId)
    .select('id,customer_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status');

  if (error) {
    console.error('ERROR:', error);
  } else {
    console.log('Updated to PAID:');
    console.log(JSON.stringify(data[0], null, 2));
    console.log('\nNOTE: Price still needs to be set in admin panel');
  }
})();
