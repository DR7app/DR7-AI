import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RS3_BOOKING_ID = '895175f3-68d0-4729-bc36-5ef72b21545f';
const CLIO_BOOKING_ID = 'afdfa616-61a1-4e8d-b553-0e1163c876f1';

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
    // Auth check
    const authHeader = event.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) };
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) };
    }

    // 1. Get current danni from Clio booking
    const { data: clioBooking, error: clioErr } = await supabase
      .from('bookings')
      .select('id, booking_details, vehicle_name')
      .eq('id', CLIO_BOOKING_ID)
      .single();

    if (clioErr || !clioBooking) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Clio booking not found', detail: clioErr }) };
    }

    const danniData = clioBooking.booking_details?.danni || [];
    if (danniData.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No danni found on Clio booking' }) };
    }

    // 2. Get RS3 booking
    const { data: rs3Booking, error: rs3Err } = await supabase
      .from('bookings')
      .select('id, booking_details, vehicle_name')
      .eq('id', RS3_BOOKING_ID)
      .single();

    if (rs3Err || !rs3Booking) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'RS3 booking not found', detail: rs3Err }) };
    }

    // 3. Move danni to RS3 booking
    const rs3Details = rs3Booking.booking_details || {};
    rs3Details.danni = danniData;

    const { error: updateRs3Err } = await supabase
      .from('bookings')
      .update({ booking_details: rs3Details })
      .eq('id', RS3_BOOKING_ID);

    if (updateRs3Err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update RS3 booking', detail: updateRs3Err }) };
    }

    // 4. Clear danni from Clio booking
    const clioDetails = clioBooking.booking_details || {};
    clioDetails.danni = [];

    const { error: updateClioErr } = await supabase
      .from('bookings')
      .update({ booking_details: clioDetails })
      .eq('id', CLIO_BOOKING_ID);

    if (updateClioErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to clear Clio danni', detail: updateClioErr }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Moved ${danniData.length} danni from ${clioBooking.vehicle_name} to ${rs3Booking.vehicle_name}`,
        danni_moved: danniData,
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
