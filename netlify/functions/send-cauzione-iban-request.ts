import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const IBAN_REQUEST_MESSAGE = `Salve {nome},

La ringraziamo per aver scelto i nostri servizi.

Al fine di procedere con la restituzione della cauzione, Le chiediamo cortesemente di comunicarci il Suo IBAN completo e il nominativo dell'intestatario del conto.

Il rimborso verrà effettuato tramite bonifico ordinario entro il quattordicesimo giorno lavorativo, come da condizioni contrattuali.

Cordiali saluti,
DR7`;

function cleanPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  // Handle 00 international prefix (e.g., 00393921900763)
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  // 10-digit local Italian number → always prepend country code 39
  // (covers numbers starting with 39X like 392, 393, 394 mobile prefixes)
  if (cleaned.length === 10) {
    cleaned = '39' + cleaned;
  }
  return cleaned;
}

// Get a date string in Rome timezone (YYYY-MM-DD)
function getRomeDateString(offsetDays: number): string {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(target);
}

const cauzioneIbanHandler: Handler = async () => {
  console.log('[Cauzione IBAN] Starting automatic IBAN request sender...');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Cauzione IBAN] Missing Supabase credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase config' }) };
  }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('[Cauzione IBAN] Missing Green API credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Green API config' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    // Calculate yesterday's date in Rome timezone (24h after dropoff)
    const yesterdayRome = getRomeDateString(-1);
    const yesterdayStart = `${yesterdayRome}T00:00:00`;
    const yesterdayEnd = `${yesterdayRome}T23:59:59`;

    console.log(`[Cauzione IBAN] Looking for bookings with dropoff_date on ${yesterdayRome} (Rome time)`);

    // Query car rental bookings where dropoff was yesterday, not cancelled
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, dropoff_date, deposit_amount, booking_details, service_type, status')
      .gte('dropoff_date', yesterdayStart)
      .lte('dropoff_date', yesterdayEnd)
      .not('status', 'eq', 'cancelled')
      .in('service_type', ['car_rental']);

    if (bookingsError) {
      console.error('[Cauzione IBAN] Error fetching bookings:', bookingsError);
      throw bookingsError;
    }

    // Also fetch bookings with null service_type (legacy car rentals)
    const { data: nullServiceBookings, error: nullError } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, dropoff_date, deposit_amount, booking_details, service_type, status')
      .gte('dropoff_date', yesterdayStart)
      .lte('dropoff_date', yesterdayEnd)
      .not('status', 'eq', 'cancelled')
      .is('service_type', null);

    if (nullError) {
      console.error('[Cauzione IBAN] Error fetching null service_type bookings:', nullError);
      throw nullError;
    }

    const allBookings = [...(bookings || []), ...(nullServiceBookings || [])];
    console.log(`[Cauzione IBAN] Found ${allBookings.length} car rental bookings with dropoff yesterday`);

    if (allBookings.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No bookings with dropoff yesterday', sent: 0 }) };
    }

    // Pre-fetch cauzioni for all bookings to catch deposits not tracked on booking itself
    const bookingIds = allBookings.map(b => b.id);
    const { data: cauzioni } = await supabase
      .from('cauzioni')
      .select('riferimento_contratto_id, importo, stato')
      .in('riferimento_contratto_id', bookingIds)
      .in('stato', ['Attiva', 'In scadenza', 'Incassata']);

    const cauzioneMap = new Map(
      (cauzioni || []).map(c => [c.riferimento_contratto_id, c])
    );

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const booking of allBookings) {
      try {
        // Skip if already sent
        if (booking.booking_details?.iban_request_sent) {
          console.log(`[Cauzione IBAN] Skipping ${booking.id} - already sent`);
          skipped++;
          continue;
        }

        // Skip if explicitly "no_deposit" option
        if (booking.booking_details?.depositOption === 'no_deposit') {
          console.log(`[Cauzione IBAN] Skipping ${booking.id} - no_deposit option`);
          skipped++;
          continue;
        }

        // Check deposit: first from booking fields, then from cauzioni table
        let hasDeposit = false;
        const depositFromBooking = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0);
        if (depositFromBooking > 0) {
          hasDeposit = true;
        } else {
          // Fallback: check cauzioni table for this booking
          const cauzione = cauzioneMap.get(booking.id);
          if (cauzione && Number(cauzione.importo) > 0) {
            hasDeposit = true;
            console.log(`[Cauzione IBAN] Booking ${booking.id} - deposit found in cauzioni table (€${cauzione.importo})`);
          }
        }

        if (!hasDeposit) {
          console.log(`[Cauzione IBAN] Skipping ${booking.id} - no deposit`);
          skipped++;
          continue;
        }

        // Get phone number — check both fields
        const phone = booking.customer_phone || booking.booking_details?.customer?.phone;
        if (!phone) {
          console.log(`[Cauzione IBAN] Skipping ${booking.id} - no phone number`);
          skipped++;
          continue;
        }

        // Get customer first name
        const firstName = booking.customer_name?.split(' ')[0] || booking.booking_details?.customer?.fullName?.split(' ')[0] || 'Cliente';

        // Build message
        const message = IBAN_REQUEST_MESSAGE.replace('{nome}', firstName);

        // Clean phone number
        const cleanedPhone = cleanPhone(phone);

        // Send via Green API
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

        const response = await fetch(greenApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: `${cleanedPhone}@c.us`,
            message
          })
        });

        const result = await response.json();

        if (!response.ok || result.error) {
          console.error(`[Cauzione IBAN] Failed to send to booking ${booking.id}:`, result);
          errors++;
          continue;
        }

        console.log(`[Cauzione IBAN] Sent IBAN request to ${firstName} (${cleanedPhone}) for booking ${booking.id}`);

        // Mark as sent in booking_details
        const updatedDetails = { ...(booking.booking_details || {}), iban_request_sent: true };
        await supabase
          .from('bookings')
          .update({ booking_details: updatedDetails })
          .eq('id', booking.id);

        sent++;

        // Delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`[Cauzione IBAN] Error processing booking ${booking.id}:`, err);
        errors++;
      }
    }

    const summary = {
      date: new Date().toISOString(),
      bookingsFound: allBookings.length,
      sent,
      skipped,
      errors
    };

    console.log('[Cauzione IBAN] Completed:', summary);

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };

  } catch (error: any) {
    console.error('[Cauzione IBAN] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Run every day at 10:00 AM UTC (11:00 AM Rome time)
export const handler = schedule('0 10 * * *', cauzioneIbanHandler);
