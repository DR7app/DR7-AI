const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // Get contracts table columns first
  const { data: sample } = await s.from('contracts').select('*').limit(1);
  if (sample && sample.length > 0) {
    console.log('=== CONTRACTS TABLE COLUMNS ===');
    console.log(Object.keys(sample[0]));
  }

  // Get ALL contracts
  const { data: contracts } = await s.from('contracts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log('\n=== LAST 50 CONTRACTS ===');
  contracts.forEach(c => {
    console.log(
      'Created:', (c.created_at||'').substring(0,19),
      '| Customer:', (c.customer_name||'N/A').padEnd(25),
      '| Contract#:', (c.contract_number||'').padEnd(20),
      '| Booking:', (c.booking_id||'').substring(0,8),
      '| ID:', c.id.substring(0,8)
    );
  });

  // Search for Fanni specifically
  console.log('\n=== CONTRACTS WITH FANNI ===');
  const { data: fanniContracts } = await s.from('contracts')
    .select('*')
    .ilike('customer_name', '%fanni%');
  console.log('Found:', fanniContracts ? fanniContracts.length : 0);
  if (fanniContracts) {
    fanniContracts.forEach(c => {
      console.log(JSON.stringify(c, null, 2));
    });
  }

  // Also search contract storage subdirs
  console.log('\n=== CONTRACT STORAGE: filled/ ===');
  const { data: filled } = await s.storage.from('contracts').list('filled', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
  if (filled) {
    const fanniPdfs = filled.filter(f => f.name.toLowerCase().includes('fanni') || f.name.includes('GS017'));
    console.log('Fanni/GS017 files in filled/:', fanniPdfs.length);
    fanniPdfs.forEach(f => console.log(' ', f.name));

    // Show all from January
    const janPdfs = filled.filter(f => f.created_at && f.created_at.startsWith('2026-01'));
    console.log('\nJanuary 2026 files in filled/:', janPdfs.length);
    janPdfs.forEach(f => console.log(' ', f.name, '|', f.created_at));
  }

  console.log('\n=== CONTRACT STORAGE: signed/ ===');
  const { data: signed } = await s.storage.from('contracts').list('signed', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
  if (signed) {
    const fanniSigned = signed.filter(f => f.name.toLowerCase().includes('fanni') || f.name.includes('GS017'));
    console.log('Fanni/GS017 files in signed/:', fanniSigned.length);
    fanniSigned.forEach(f => console.log(' ', f.name));
  }

  // Root level
  console.log('\n=== CONTRACT STORAGE: root ===');
  const { data: root } = await s.storage.from('contracts').list('', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
  if (root) {
    // Show files (not dirs) that contain booking IDs or fanni
    const rootFiles = root.filter(f => f.id !== null && (f.name.toLowerCase().includes('fanni') || f.name.includes('GS017')));
    console.log('Fanni/GS017 files in root:', rootFiles.length);
    rootFiles.forEach(f => console.log(' ', f.name));

    // Show all root PDFs
    console.log('\nAll root PDF files (last 20):');
    const pdfs = root.filter(f => f.name.endsWith('.pdf')).slice(0, 20);
    pdfs.forEach(f => console.log(' ', f.name, '|', f.created_at));
  }
})();
