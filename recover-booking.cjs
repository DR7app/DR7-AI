const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  const bookingId = '27ebdf3b-98a1-40a4-98e4-651f70235481';

  // Download the latest contract PDF to read details
  const contractUrl = s.storage.from('contracts').getPublicUrl('filled/contratto_27ebdf3b-98a1-40a4-98e4-651f70235481_1772800543289.pdf');
  console.log('Latest contract PDF URL:', contractUrl.data.publicUrl);

  // List ALL files for this booking
  console.log('\n=== ALL FILES FOR BOOKING 27ebdf3b ===');
  const dirs = ['', 'filled', 'signed', 'extensions'];
  for (const dir of dirs) {
    const { data: files } = await s.storage.from('contracts').list(dir, { limit: 1000 });
    if (files) {
      const matching = files.filter(f => f.name.includes(bookingId));
      matching.forEach(f => {
        console.log(dir ? dir + '/' : '', f.name, '| Created:', f.created_at);
      });
    }
  }

  // Check fatture for this booking
  console.log('\n=== FATTURE FOR THIS BOOKING ===');
  const { data: fatture } = await s.from('fatture')
    .select('*')
    .eq('booking_id', bookingId);
  if (fatture && fatture.length > 0) {
    fatture.forEach(f => console.log(JSON.stringify(f, null, 2)));
  } else {
    console.log('No fatture found');
  }

  // Check if there's any data in other tables
  console.log('\n=== CHECKING OTHER TABLES ===');

  // notifications
  const { data: notifs } = await s.from('notifications')
    .select('*')
    .eq('booking_id', bookingId);
  console.log('Notifications:', notifs ? notifs.length : 0);
  if (notifs && notifs.length > 0) {
    notifs.forEach(n => console.log('  Type:', n.type, '| Created:', n.created_at, '| Data:', JSON.stringify(n.data || {}).substring(0, 200)));
  }
})();
