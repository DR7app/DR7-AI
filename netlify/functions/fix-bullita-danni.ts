import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RS3_BOOKING_ID = '895175f3-68d0-4729-bc36-5ef72b21545f';
const CLIO_BOOKING_ID = 'afdfa616-61a1-4e8d-b553-0e1163c876f1';

const DANNI_DATA = [{
  date: '2026-03-23',
  note: '',
  label: 'Fermo veicolo + Danno carrozzeria',
  total: 425,
  amount: 425,
  photos: [],
  quantity: 1,
  amountPaid: 425,
  paymentStatus: 'paid'
}];

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { secret, action } = JSON.parse(event.body || '{}');
    if (secret !== 'move-bullita-danni-2026') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid secret' }) };
    }

    // Diagnostic mode: show what's in both bookings
    if (action === 'diagnose') {
      const { data: clio } = await supabase
        .from('bookings')
        .select('id, booking_details, vehicle_name, vehicle_plate')
        .eq('id', CLIO_BOOKING_ID)
        .single();

      const { data: rs3 } = await supabase
        .from('bookings')
        .select('id, booking_details, vehicle_name, vehicle_plate')
        .eq('id', RS3_BOOKING_ID)
        .single();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          clio: {
            id: clio?.id,
            vehicle_name: clio?.vehicle_name,
            vehicle_plate: clio?.vehicle_plate,
            has_danni: !!clio?.booking_details?.danni?.length,
            danni: clio?.booking_details?.danni || [],
            booking_details_keys: clio?.booking_details ? Object.keys(clio.booking_details) : [],
          },
          rs3: {
            id: rs3?.id,
            vehicle_name: rs3?.vehicle_name,
            vehicle_plate: rs3?.vehicle_plate,
            has_danni: !!rs3?.booking_details?.danni?.length,
            danni: rs3?.booking_details?.danni || [],
            booking_details_keys: rs3?.booking_details ? Object.keys(rs3.booking_details) : [],
          },
        }, null, 2),
      };
    }

    // Execute mode: force-set danni on RS3, clear from Clio
    // 1. Get RS3 booking
    const { data: rs3Booking, error: rs3Err } = await supabase
      .from('bookings')
      .select('id, booking_details, vehicle_name')
      .eq('id', RS3_BOOKING_ID)
      .single();

    if (rs3Err || !rs3Booking) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'RS3 booking not found', detail: rs3Err }) };
    }

    // 2. Set danni on RS3
    const rs3Details = rs3Booking.booking_details || {};
    rs3Details.danni = DANNI_DATA;

    const { error: updateRs3Err } = await supabase
      .from('bookings')
      .update({ booking_details: rs3Details })
      .eq('id', RS3_BOOKING_ID);

    if (updateRs3Err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update RS3', detail: updateRs3Err }) };
    }

    // 3. Clear danni from Clio
    const { data: clioBooking } = await supabase
      .from('bookings')
      .select('id, booking_details, vehicle_name')
      .eq('id', CLIO_BOOKING_ID)
      .single();

    if (clioBooking) {
      const clioDetails = clioBooking.booking_details || {};
      clioDetails.danni = [];
      await supabase
        .from('bookings')
        .update({ booking_details: clioDetails })
        .eq('id', CLIO_BOOKING_ID);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Set danni on RS3 (${rs3Booking.vehicle_name}) and cleared from Clio`,
        danni_set: DANNI_DATA,
      }),
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
