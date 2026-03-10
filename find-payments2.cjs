const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // The other Fanni booking (Panda) has amountPaid in booking_details
  // Let's check what the similar booking structure looked like
  const { data: pandaBooking } = await s.from('bookings')
    .select('price_total,payment_status,payment_method,amount_paid,booking_details')
    .eq('id', 'a6c0fea6-744a-4c3a-b19f-5ab53fee5f25')
    .single();

  console.log('=== PANDA BOOKING (for reference) ===');
  console.log('price_total:', pandaBooking.price_total, '(EUR', (pandaBooking.price_total/100).toFixed(2), ')');
  console.log('payment_status:', pandaBooking.payment_status);
  console.log('payment_method:', pandaBooking.payment_method);
  console.log('amount_paid:', pandaBooking.amount_paid);
  console.log('booking_details.amountPaid:', pandaBooking.booking_details.amountPaid);

  // Check the 6-day Fanni booking for reference
  const { data: clioBooking } = await s.from('bookings')
    .select('price_total,payment_status,payment_method,amount_paid,booking_details')
    .eq('id', 'c0834e27-2819-452f-b35b-d2394e673e64')
    .single();

  console.log('\n=== CLIO 6-DAY BOOKING (for reference) ===');
  console.log('price_total:', clioBooking.price_total, '(EUR', (clioBooking.price_total/100).toFixed(2), ')');
  console.log('payment_status:', clioBooking.payment_status);
  console.log('payment_method:', clioBooking.payment_method);
  console.log('amount_paid:', clioBooking.amount_paid);
  console.log('booking_details.amountPaid:', clioBooking.booking_details?.amountPaid);

  // Check fatture that were deleted - search all fatture with DR7-2026 numbers from Jan-Mar
  console.log('\n=== RECENT FATTURE (looking for Fanni-related) ===');
  const { data: fatture } = await s.from('fatture')
    .select('id,numero_fattura,booking_id,cliente_nome,importo_totale,data_emissione,stato')
    .order('data_emissione', { ascending: false })
    .limit(30);

  fatture.forEach(f => {
    // Check if booking_id matches any deleted booking
    const isDeleted = f.booking_id === '27ebdf3b-98a1-40a4-98e4-651f70235481';
    console.log(
      (f.data_emissione||'').substring(0,10),
      '|', (f.numero_fattura||'').padEnd(18),
      '|', (f.cliente_nome||'').padEnd(25),
      '| EUR', (f.importo_totale||0).toFixed(2),
      '|', f.stato,
      isDeleted ? '<<< FANNI' : '',
      '| booking:', (f.booking_id||'').substring(0,8)
    );
  });

  // Also look at fatture XML/storage for traces
  console.log('\n=== SEARCH FATTURE STORAGE ===');
  const { data: fattureStorage } = await s.storage.from('fatture').list('', { limit: 10, sortBy: { column: 'created_at', order: 'desc' } });
  if (fattureStorage) {
    const fanniF = fattureStorage.filter(f => f.name.includes('27ebdf3b') || f.name.toLowerCase().includes('fanni'));
    console.log('Fanni fatture files:', fanniF.length);
    fanniF.forEach(f => console.log(' ', f.name));
  }
})();
