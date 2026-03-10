const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // 1. ALL bookings modified this morning (before 13:00)
  const { data: morning } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at,updated_at')
    .gte('updated_at', '2026-03-09T00:00:00')
    .lte('updated_at', '2026-03-09T13:00:00')
    .order('updated_at', { ascending: true });

  console.log('=== BOOKINGS MODIFIED THIS MORNING (before 13:00) ===');
  morning.forEach(b => {
    const createdToday = b.created_at.startsWith('2026-03-09');
    const modified = b.created_at !== b.updated_at;
    console.log(
      'Updated:', b.updated_at.substring(11,19),
      '| Status:', (b.status||'').padEnd(12),
      '| Payment:', (b.payment_status||'').padEnd(10),
      '| Customer:', (b.customer_name||'N/A').padEnd(25),
      '| Plate:', (b.vehicle_plate||'').padEnd(10),
      '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
      '| EUR', ((b.price_total||0)/100).toFixed(2),
      '|', createdToday ? 'NEW TODAY' : (modified ? 'MODIFIED' : 'same'),
      '| ID:', b.id.substring(0,8)
    );
  });

  // 2. ALL cancelled bookings (not Lavaggio) updated in last 7 days
  console.log('\n=== CANCELLED REAL BOOKINGS (last 7 days) ===');
  const { data: cancelled } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at,updated_at')
    .in('status', ['cancelled', 'annullata'])
    .gte('updated_at', '2026-03-03T00:00:00')
    .neq('customer_name', 'Lavaggio Rientro')
    .order('updated_at', { ascending: false });

  if (cancelled.length === 0) {
    console.log('  (none)');
  } else {
    cancelled.forEach(b => {
      console.log(
        'Updated:', b.updated_at.substring(0,19),
        '| Customer:', (b.customer_name||'N/A').padEnd(25),
        '| Plate:', (b.vehicle_plate||'').padEnd(10),
        '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
        '| EUR', ((b.price_total||0)/100).toFixed(2),
        '| Created:', b.created_at.substring(0,19),
        '| ID:', b.id.substring(0,8)
      );
    });
  }

  // 3. March bookings where created_at != updated_at (something changed)
  console.log('\n=== MARCH BOOKINGS THAT WERE MODIFIED (created != updated) ===');
  const { data: march } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at,updated_at')
    .gte('pickup_date', '2026-03-01')
    .lte('pickup_date', '2026-03-31')
    .neq('customer_name', 'Lavaggio Rientro')
    .order('updated_at', { ascending: false });

  march.forEach(b => {
    if (b.created_at !== b.updated_at) {
      console.log(
        'Created:', b.created_at.substring(0,19),
        '| Updated:', b.updated_at.substring(0,19),
        '| Status:', (b.status||'').padEnd(12),
        '| Customer:', (b.customer_name||'N/A').padEnd(25),
        '| Plate:', (b.vehicle_plate||'').padEnd(10),
        '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
        '| EUR', ((b.price_total||0)/100).toFixed(2),
        '| ID:', b.id.substring(0,8)
      );
    }
  });
})();
