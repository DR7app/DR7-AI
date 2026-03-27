const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // List all contract PDFs in storage
  console.log('=== CONTRACT FILES IN STORAGE ===');
  const { data: files, error } = await s.storage.from('contracts').list('', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) console.log('Error:', error.message);

  // Filter for any that mention fanni or GS017XL
  if (files) {
    const fanniFiles = files.filter(f => f.name.toLowerCase().includes('fanni') || f.name.includes('GS017XL'));
    console.log('Files matching fanni/GS017XL:', fanniFiles.length);
    fanniFiles.forEach(f => console.log(' ', f.name, '| Created:', f.created_at));

    // Show all files created in January (when the booking would have been)
    console.log('\n=== CONTRACT FILES FROM JANUARY 2026 ===');
    const janFiles = files.filter(f => f.created_at && f.created_at.startsWith('2026-01'));
    janFiles.forEach(f => console.log(' ', f.name, '| Created:', f.created_at));

    // Also check subdirectories
    const { data: dirs } = await s.storage.from('contracts').list('', { limit: 100 });
    const subdirs = dirs.filter(d => d.id === null); // directories have null id
    console.log('\n=== SUBDIRECTORIES IN CONTRACTS BUCKET ===');
    subdirs.forEach(d => console.log(' ', d.name));
  }

  // Check contracts table more broadly
  console.log('\n=== ALL CONTRACTS TABLE (last 20) ===');
  const { data: contracts, error: cErr } = await s.from('contracts')
    .select('id,booking_id,customer_name,vehicle_plate,contract_number,created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (cErr) {
    console.log('Contracts table error:', cErr.message);
  } else if (contracts) {
    contracts.forEach(c => {
      console.log(
        'Created:', (c.created_at||'').substring(0,19),
        '| Customer:', (c.customer_name||'N/A').padEnd(25),
        '| Plate:', (c.vehicle_plate||'').padEnd(10),
        '| Contract:', c.contract_number,
        '| Booking:', (c.booking_id||'').substring(0,8)
      );
    });
  }

  // Check if there's a booking_details with contract_generated_at that references a deleted booking
  // by looking at ALL bookings that have GS017XL in their booking_details
  console.log('\n=== BOOKINGS WITH contract_generated_at REFERENCING GS017XL ===');
  const { data: allBookings } = await s.from('bookings')
    .select('id,customer_name,vehicle_plate,pickup_date,dropoff_date,booking_details')
    .ilike('customer_name', '%fanni%');
  allBookings.forEach(b => {
    const cga = b.booking_details && b.booking_details.contract_generated_at;
    if (cga) {
      console.log('ID:', b.id.substring(0,8), '| Customer:', b.customer_name, '| Plate:', b.vehicle_plate, '| Contract at:', cga);
    }
  });
})();
