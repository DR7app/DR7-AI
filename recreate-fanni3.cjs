const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // Get the other Fanni booking to see all its fields
  const { data: existing } = await s.from('bookings')
    .select('*')
    .eq('id', 'a6c0fea6-744a-4c3a-b19f-5ab53fee5f25')
    .single();

  console.log('Full Fanni booking (Panda one) - all fields:');
  const keys = Object.keys(existing);
  keys.forEach(k => {
    if (existing[k] !== null && existing[k] !== undefined) {
      console.log(' ', k, '=', typeof existing[k] === 'object' ? JSON.stringify(existing[k]).substring(0, 100) : existing[k]);
    }
  });
})();
