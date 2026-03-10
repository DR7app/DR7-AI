const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://ahpmzjgkfxrrgxyirasa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocG16amdrZnhycmd4eWlyYXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4Mjc3OTgsImV4cCI6MjA2OTQwMzc5OH0.XkjoVheKCqmgL0Ce-OqNAbItnW7L3GlXIxb8_R7f_FU');

(async () => {
  // Recreate the deleted Davide Fanni booking with original ID
  // From contract: Start 08/01/2026 16:30, End 07/03/2026, Renault Clio GS017XL
  // 7 extensions over 2 months, last contract regenerated March 6

  const booking = {
    id: '27ebdf3b-98a1-40a4-98e4-651f70235481',
    customer_name: 'Davide Fanni',
    customer_email: 'Fannid429@gmail.com',
    customer_phone: '+39 377 335 5451',
    vehicle_name: 'Renault Clio Blue',
    vehicle_plate: 'GS017XL',
    vehicle_id: '4dc428c2-1baf-47fc-9b27-9d76b83b6163',
    pickup_date: '2026-01-08T16:30:00+01:00',
    dropoff_date: '2026-03-07T11:30:00+01:00',
    status: 'confirmed',
    payment_status: 'pending', // will be adjusted if needed
    price_total: 0, // user needs to confirm price
    service_type: null,
    booking_details: {
      source: 'admin_manual',
      deposit: '0',
      customer: {
        id: 'c3703610-ced8-4a65-a129-2162885c23bb',
        email: 'Fannid429@gmail.com',
        phone: '+39 377 335 5451',
        fullName: 'Davide Fanni',
        customerId: 'c3703610-ced8-4a65-a129-2162885c23bb'
      },
      km_limit: 'Illimitati',
      unlimited_km: true,
      vehicle_id: '4dc428c2-1baf-47fc-9b27-9d76b83b6163',
      second_driver: null,
      pickupLocation: 'dr7_office',
      dropoffLocation: 'dr7_office',
      insuranceOption: 'KASKO_BASE',
      contract_generated_at: '2026-03-06T12:35:44.924Z',
      extension_history: [
        {
          extended_at: '2026-01-31T08:26:56.090Z',
          payment_status: 'paid',
          notes: 'Extension 1'
        },
        {
          extended_at: '2026-02-06T09:40:49.375Z',
          payment_status: 'paid',
          notes: 'Extension 2'
        },
        {
          extended_at: '2026-02-13T09:15:04.918Z',
          payment_status: 'paid',
          notes: 'Extension 3'
        },
        {
          extended_at: '2026-02-19T15:52:28.400Z',
          payment_status: 'paid',
          notes: 'Extension 4'
        },
        {
          extended_at: '2026-02-20T17:15:24.680Z',
          payment_status: 'paid',
          notes: 'Extension 5'
        },
        {
          extended_at: '2026-02-27T11:25:23.350Z',
          payment_status: 'paid',
          notes: 'Extension 6'
        },
        {
          extended_at: '2026-03-06T10:36:14.928Z',
          payment_status: 'paid',
          notes: 'Extension 7'
        }
      ],
      extension_contracts: [
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1769848015643.pdf',
          generated_at: '2026-01-31T08:26:56.090Z',
          extension_index: 0,
          contract_number: 'EXT-27EBDF3B-1'
        },
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1770370848928.pdf',
          generated_at: '2026-02-06T09:40:49.375Z',
          extension_index: 1,
          contract_number: 'EXT-27EBDF3B-2'
        },
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1770974104644.pdf',
          generated_at: '2026-02-13T09:15:04.918Z',
          extension_index: 2,
          contract_number: 'EXT-27EBDF3B-3'
        },
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1771516347590.pdf',
          generated_at: '2026-02-19T15:52:28.400Z',
          extension_index: 3,
          contract_number: 'EXT-27EBDF3B-4'
        },
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1771607724264.pdf',
          generated_at: '2026-02-20T17:15:24.680Z',
          extension_index: 4,
          contract_number: 'EXT-27EBDF3B-5'
        },
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1772191523125.pdf',
          generated_at: '2026-02-27T11:25:23.350Z',
          extension_index: 5,
          contract_number: 'EXT-27EBDF3B-6'
        },
        {
          url: 'https://ahpmzjgkfxrrgxyirasa.supabase.co/storage/v1/object/public/contracts/extensions/contratto_estensione_27ebdf3b-98a1-40a4-98e4-651f70235481_1772793374718.pdf',
          generated_at: '2026-03-06T10:36:14.928Z',
          extension_index: 6,
          contract_number: 'EXT-27EBDF3B-7'
        }
      ]
    }
  };

  const { data, error } = await s.from('bookings').insert(booking).select();
  if (error) {
    console.error('ERROR recreating booking:', error);
  } else {
    console.log('SUCCESS! Booking recreated:', data[0].id);
    console.log('Customer:', data[0].customer_name);
    console.log('Vehicle:', data[0].vehicle_name, data[0].vehicle_plate);
    console.log('Dates:', data[0].pickup_date, 'to', data[0].dropoff_date);
  }
})();
