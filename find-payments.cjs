const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  const bookingId = '27ebdf3b-98a1-40a4-98e4-651f70235481';

  // Check payments table
  console.log('=== PAYMENTS TABLE ===');
  const { data: payments, error: pErr } = await s.from('payments').select('*').eq('booking_id', bookingId);
  if (pErr) console.log('payments error:', pErr.message);
  else if (payments && payments.length > 0) {
    payments.forEach(p => console.log(JSON.stringify(p, null, 2)));
  } else {
    console.log('No payments found for this booking ID');
    // Search by customer
    const { data: allPayments } = await s.from('payments').select('*').ilike('customer_name', '%fanni%');
    if (allPayments && allPayments.length > 0) {
      console.log('\nPayments for Fanni (any booking):');
      allPayments.forEach(p => console.log(JSON.stringify(p, null, 2)));
    }
  }

  // Check transactions table
  console.log('\n=== TRANSACTIONS TABLE ===');
  const { data: transactions, error: tErr } = await s.from('transactions').select('*').eq('booking_id', bookingId);
  if (tErr) console.log('transactions error:', tErr.message);
  else if (transactions && transactions.length > 0) {
    transactions.forEach(t => console.log(JSON.stringify(t, null, 2)));
  } else {
    console.log('No transactions for this booking ID');
    const { data: allTx } = await s.from('transactions').select('*').ilike('description', '%fanni%');
    if (allTx && allTx.length > 0) {
      console.log('\nTransactions mentioning Fanni:');
      allTx.forEach(t => console.log(JSON.stringify(t, null, 2)));
    }
  }

  // Check fatture table for Fanni
  console.log('\n=== FATTURE FOR FANNI ===');
  const { data: fatture } = await s.from('fatture').select('*').ilike('cliente_nome', '%fanni%');
  if (fatture && fatture.length > 0) {
    fatture.forEach(f => console.log(JSON.stringify(f, null, 2)));
  } else {
    console.log('No fatture for Fanni');
  }

  // Check cauzioni table
  console.log('\n=== CAUZIONI FOR THIS BOOKING ===');
  const { data: cauzioni, error: cErr } = await s.from('cauzioni').select('*').eq('riferimento_contratto_id', bookingId);
  if (cErr) console.log('cauzioni error:', cErr.message);
  else if (cauzioni && cauzioni.length > 0) {
    cauzioni.forEach(c => console.log(JSON.stringify(c, null, 2)));
  } else {
    console.log('No cauzioni found');
  }

  // Try to list all tables to find payment-related ones
  console.log('\n=== CHECKING OTHER POSSIBLE TABLES ===');
  const tables = ['payment_history', 'payment_logs', 'nexi_payments', 'stripe_payments', 'cash_payments', 'incassi'];
  for (const table of tables) {
    const { data, error } = await s.from(table).select('*').limit(1);
    if (!error) {
      console.log('Table ' + table + ' exists! Checking for Fanni...');
      const { data: d2 } = await s.from(table).select('*').eq('booking_id', bookingId);
      if (d2 && d2.length > 0) console.log('  Found:', JSON.stringify(d2));
    }
  }
})();
