const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

async function main() {
  const { data, error } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,service_type')
    .order('created_at', { ascending: false });

  if (error) { console.error(error); return; }

  console.log('TOTAL BOOKINGS IN DATABASE:', data.length);

  const rentals = data.filter(b =>
    b.service_type !== 'car_wash' &&
    b.service_type !== 'mechanical_service' &&
    b.service_type !== 'mechanical'
  );
  console.log('RENTAL BOOKINGS:', rentals.length);

  const active = rentals.filter(b => b.status !== 'cancelled' && b.status !== 'annullata');
  console.log('ACTIVE (non-cancelled):', active.length);

  console.log('\n=== MARCH 2026 BOOKINGS ===');
  active.filter(b => b.pickup_date && b.pickup_date.includes('2026-03')).forEach(b => {
    console.log(
      (b.customer_name || 'N/A').padEnd(25),
      '|', (b.vehicle_name || '').padEnd(22),
      '|', (b.vehicle_plate || '').padEnd(8),
      '|', b.pickup_date.substring(0, 10), 'to', (b.dropoff_date || '').substring(0, 10),
      '|', b.status.padEnd(10),
      '|', b.payment_status.padEnd(10),
      '| EUR', ((b.price_total || 0) / 100).toFixed(2)
    );
  });

  console.log('\n=== FEBRUARY 2026 BOOKINGS ===');
  active.filter(b => b.pickup_date && b.pickup_date.includes('2026-02')).forEach(b => {
    console.log(
      (b.customer_name || 'N/A').padEnd(25),
      '|', (b.vehicle_name || '').padEnd(22),
      '|', (b.vehicle_plate || '').padEnd(8),
      '|', b.pickup_date.substring(0, 10), 'to', (b.dropoff_date || '').substring(0, 10),
      '|', b.status.padEnd(10),
      '|', b.payment_status.padEnd(10),
      '| EUR', ((b.price_total || 0) / 100).toFixed(2)
    );
  });

  // Check vehicles
  const { data: vehicles } = await s.from('vehicles').select('id,display_name,plate,status').order('display_name');
  console.log('\n=== ALL VEHICLES ===');
  vehicles.forEach(v => {
    const bookingCount = active.filter(b => b.vehicle_plate === v.plate || b.vehicle_name === v.display_name).length;
    console.log(v.display_name.padEnd(25), '|', (v.plate || '').padEnd(10), '|', v.status.padEnd(12), '| Bookings:', bookingCount);
  });
}
main();
