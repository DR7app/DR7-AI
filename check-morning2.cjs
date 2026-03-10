const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // ALL non-Lavaggio bookings updated today
  const { data } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at,updated_at')
    .gte('updated_at', '2026-03-09T00:00:00')
    .neq('customer_name', 'Lavaggio Rientro')
    .order('updated_at', { ascending: true });

  console.log('=== ALL NON-LAVAGGIO BOOKINGS UPDATED TODAY ===');
  data.forEach(b => {
    const modified = (b.created_at !== b.updated_at);
    console.log(
      'Updated:', b.updated_at.substring(11,19),
      '| Customer:', (b.customer_name||'N/A').padEnd(25),
      '| Plate:', (b.vehicle_plate||'').padEnd(10),
      '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
      '| EUR', ((b.price_total||0)/100).toFixed(2),
      '| Status:', (b.status||'').padEnd(12),
      '| Payment:', (b.payment_status||'').padEnd(10),
      '|', modified ? '*** MODIFIED ***' : 'new/same',
      '| ID:', b.id.substring(0,8)
    );
  });

  // Check if Marianna Aramu booking was modified - it appeared in earlier check
  console.log('\n=== MARIANNA ARAMU BOOKING (modified today at 16:46) ===');
  const { data: aramu } = await s.from('bookings')
    .select('*')
    .ilike('customer_name', '%aramu%');
  aramu.forEach(b => {
    console.log('ID:', b.id);
    console.log('Customer:', b.customer_name);
    console.log('Vehicle:', b.vehicle_name, b.vehicle_plate);
    console.log('Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10));
    console.log('Status:', b.status, '| Payment:', b.payment_status);
    console.log('Price:', ((b.price_total||0)/100).toFixed(2));
    console.log('Created:', b.created_at);
    console.log('Updated:', b.updated_at);
    console.log('Details:', JSON.stringify(b.booking_details, null, 2));
  });

  // Check Salvatore Caria (TEST000 plate but real name - suspicious)
  console.log('\n=== SALVATORE CARIA BOOKING ===');
  const { data: caria } = await s.from('bookings')
    .select('*')
    .ilike('customer_name', '%caria%')
    .order('updated_at', { ascending: false })
    .limit(5);
  caria.forEach(b => {
    console.log(
      'ID:', b.id.substring(0,8),
      '| Customer:', b.customer_name,
      '| Plate:', b.vehicle_plate,
      '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
      '| Status:', b.status,
      '| Payment:', b.payment_status,
      '| EUR', ((b.price_total||0)/100).toFixed(2),
      '| Created:', b.created_at.substring(0,19),
      '| Updated:', b.updated_at.substring(0,19)
    );
  });
})();
