const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

async function main() {
  const { data, error } = await s.from('bookings').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  const filtered = data.filter(b =>
    b.service_type !== 'car_wash' &&
    b.service_type !== 'mechanical_service' &&
    b.service_type !== 'mechanical'
  );

  const fanni = filtered.find(b => b.id === 'c0834e27-2819-452f-b35b-d2394e673e64');
  console.log('Total raw:', data.length, '| Filtered:', filtered.length);
  console.log('Fanni in results:', fanni ? 'YES' : 'NO');
  if (fanni) console.log('Position:', filtered.indexOf(fanni), '| service_type:', fanni.service_type);

  // Also check: does anon key even return this booking?
  const { data: direct, error: directErr } = await s.from('bookings').select('id').eq('id', 'c0834e27-2819-452f-b35b-d2394e673e64');
  console.log('Direct query result:', direct ? direct.length + ' rows' : 'ERROR: ' + directErr.message);
}
main();
