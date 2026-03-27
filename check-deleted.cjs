const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // 1. Check ALL bookings on GS017XL - any status
  console.log('=== ALL GS017XL BOOKINGS (any status) ===');
  const { data: gs } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at,updated_at')
    .eq('vehicle_plate', 'GS017XL')
    .order('pickup_date', { ascending: true });
  gs.forEach(b => {
    console.log(
      'Customer:', (b.customer_name||'N/A').padEnd(25),
      '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
      '| Status:', (b.status||'').padEnd(12),
      '| Payment:', (b.payment_status||'').padEnd(10),
      '| EUR', ((b.price_total||0)/100).toFixed(2),
      '| Created:', b.created_at.substring(0,19),
      '| ID:', b.id.substring(0,8)
    );
  });

  // 2. Look for ANY booking from Jan 8 to March 7 (the dates user mentioned)
  console.log('\n=== ALL BOOKINGS WITH PICKUP AROUND JAN 8 ===');
  const { data: jan } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at')
    .gte('pickup_date', '2026-01-06')
    .lte('pickup_date', '2026-01-10')
    .order('pickup_date', { ascending: true });
  jan.forEach(b => {
    console.log(
      'Customer:', (b.customer_name||'N/A').padEnd(25),
      '| Plate:', (b.vehicle_plate||'').padEnd(10),
      '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
      '| Status:', (b.status||'').padEnd(12),
      '| EUR', ((b.price_total||0)/100).toFixed(2),
      '| ID:', b.id.substring(0,8)
    );
  });

  // 3. Check the Clio Blue vehicle_id for ALL bookings
  const clioId = '4dc428c2-1baf-47fc-9b27-9d76b83b6163';
  console.log('\n=== ALL BOOKINGS BY CLIO BLUE VEHICLE_ID ===');
  const { data: byId } = await s.from('bookings')
    .select('id,customer_name,vehicle_name,vehicle_plate,pickup_date,dropoff_date,status,payment_status,price_total,created_at')
    .eq('vehicle_id', clioId)
    .order('pickup_date', { ascending: true });
  byId.forEach(b => {
    console.log(
      'Customer:', (b.customer_name||'N/A').padEnd(25),
      '| Dates:', (b.pickup_date||'').substring(0,10), 'to', (b.dropoff_date||'').substring(0,10),
      '| Status:', (b.status||'').padEnd(12),
      '| EUR', ((b.price_total||0)/100).toFixed(2),
      '| ID:', b.id.substring(0,8)
    );
  });

  // 4. Check contracts table - maybe a contract was generated for this booking before it was deleted
  console.log('\n=== ALL CONTRACTS FOR GS017XL OR CLIO BLUE ===');
  const { data: contracts } = await s.from('contracts')
    .select('id,booking_id,customer_name,vehicle_plate,created_at')
    .or('vehicle_plate.eq.GS017XL,vehicle_name.ilike.%clio blue%')
    .order('created_at', { ascending: false });
  if (contracts && contracts.length > 0) {
    contracts.forEach(c => {
      console.log('Contract:', c.id.substring(0,8), '| Booking:', c.booking_id.substring(0,8), '| Customer:', c.customer_name, '| Plate:', c.vehicle_plate, '| Created:', c.created_at);
    });
  } else {
    console.log('  (no contracts found)');
  }

  // 5. Check fatture table for any invoice referencing GS017XL or Fanni
  console.log('\n=== FATTURE FOR GS017XL OR FANNI ===');
  const { data: fatture1 } = await s.from('fatture')
    .select('id,numero_fattura,booking_id,cliente_nome,importo_totale,created_at,data_emissione')
    .ilike('cliente_nome', '%fanni%');
  const { data: fatture2 } = await s.from('fatture')
    .select('id,numero_fattura,booking_id,cliente_nome,importo_totale,created_at,data_emissione')
    .eq('booking_id', 'c0834e27-2819-452f-b35b-d2394e673e64');
  const allFatture = [...(fatture1 || []), ...(fatture2 || [])];
  if (allFatture.length > 0) {
    allFatture.forEach(f => {
      console.log('Fattura:', f.numero_fattura, '| Booking:', (f.booking_id||'').substring(0,8), '| Cliente:', f.cliente_nome, '| EUR', f.importo_totale, '| Created:', f.created_at);
    });
  } else {
    console.log('  (no fatture found)');
  }

  // 6. Check what was on GS017XL between Jan 8 and March 7 - is there a GAP?
  console.log('\n=== TIMELINE FOR GS017XL ===');
  console.log('Daniel incandela: Dec 18 - Dec 27');
  console.log('Lavaggio Rientro: Dec 27');
  console.log('>>> GAP: Dec 27 to Mar 7 <<<  (this is where the Fanni booking should be!)');
  console.log('Davide Fanni: Mar 7 - Mar 13');
  console.log('Lavaggio Rientro (cancelled): Mar 7');

  // 7. Check storage for any contract PDFs mentioning this booking
  console.log('\n=== CHECK STORAGE FOR FANNI CONTRACTS ===');
  const { data: storageFiles } = await s.storage.from('contracts').list('', { search: 'fanni' });
  console.log('Storage search for fanni:', storageFiles);

  const { data: storageFiles2 } = await s.storage.from('contracts').list('', { search: 'c0834e27' });
  console.log('Storage search for c0834e27:', storageFiles2);
})();
