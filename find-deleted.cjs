const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // List ALL contract PDFs from storage (all subdirs)
  const dirs = ['', 'filled', 'signed', 'extensions'];
  const allFiles = [];

  for (const dir of dirs) {
    let offset = 0;
    while (true) {
      const { data: files } = await s.storage.from('contracts').list(dir, { limit: 1000, offset });
      if (!files || files.length === 0) break;
      const pdfFiles = files.filter(f => f.name.endsWith('.pdf'));
      pdfFiles.forEach(f => allFiles.push({ dir, name: f.name, created_at: f.created_at }));
      if (files.length < 1000) break;
      offset += 1000;
    }
  }

  console.log('Total contract PDFs found:', allFiles.length);

  // Extract booking IDs from filenames (contratto_BOOKING-ID_TIMESTAMP.pdf)
  const bookingIds = new Set();
  allFiles.forEach(f => {
    const match = f.name.match(/contratto_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    if (match) bookingIds.add(match[1]);
    // Also check extension format
    const extMatch = f.name.match(/estensione_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    if (extMatch) bookingIds.add(extMatch[1]);
  });

  console.log('Unique booking IDs in contracts:', bookingIds.size);

  // Check which booking IDs still exist in the database
  const missingBookings = [];
  for (const id of bookingIds) {
    const { data } = await s.from('bookings').select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date').eq('id', id).single();
    if (!data) {
      // This booking was DELETED!
      const relatedFiles = allFiles.filter(f => f.name.includes(id));
      missingBookings.push({ id, files: relatedFiles });
    }
  }

  console.log('\n=== DELETED BOOKINGS (have contract but no DB row) ===');
  if (missingBookings.length === 0) {
    console.log('  (none found)');
  } else {
    missingBookings.forEach(mb => {
      console.log('DELETED BOOKING ID:', mb.id);
      mb.files.forEach(f => {
        console.log('  File:', f.dir ? f.dir + '/' : '', f.name, '| Created:', f.created_at);
      });
    });
  }
})();
