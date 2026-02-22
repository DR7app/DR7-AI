import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const URBAN_MESSAGE = `Buongiorno {nome},

la contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.

In caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.

Qualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.

Restiamo in attesa di un suo cortese riscontro.
Grazie.

Cordiali saluti,
DR7`;

const EXOTIC_MESSAGE = `Buongiorno {nome},

La contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a Sua completa disposizione per verificarne la disponibilità.

In caso di estensione, saremo lieti di riservarLe una promozione dedicata e particolarmente vantaggiosa sul periodo aggiuntivo.

Restiamo in attesa di un Suo gentile riscontro.

Grazie.

Cordiali saluti,
Team DR7`;

// Map all vehicle category variants to the two message types
function getCategoryType(category: string | null | undefined): 'urban' | 'exotic' | null {
  if (!category) return null;
  const lower = category.toLowerCase();
  if (lower === 'urban') return 'urban';
  if (lower === 'exotic' || lower === 'supercar') return 'exotic';
  return null;
}

function cleanPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '39' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('39') && cleaned.length === 10) {
    cleaned = '39' + cleaned;
  }
  return cleaned;
}

// Get today/tomorrow date string in Rome timezone (YYYY-MM-DD)
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

const preRentalOfferHandler: Handler = async () => {
  console.log('[Pre-Rental Offer] Starting automatic pre-rental offer sender...');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Pre-Rental Offer] Missing Supabase credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase config' }) };
  }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('[Pre-Rental Offer] Missing Green API credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Green API config' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    // Calculate tomorrow's date in Rome timezone (24h before dropoff)
    const tomorrowRome = getRomeDateString(1);
    const tomorrowStart = `${tomorrowRome}T00:00:00`;
    const tomorrowEnd = `${tomorrowRome}T23:59:59`;

    console.log(`[Pre-Rental Offer] Looking for bookings with dropoff_date on ${tomorrowRome} (Rome time)`);

    // Query bookings with dropoff_date tomorrow (rental ending), confirmed/active, car_rental or null service_type
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, dropoff_date, vehicle_id, booking_details, service_type, status')
      .gte('dropoff_date', tomorrowStart)
      .lte('dropoff_date', tomorrowEnd)
      .in('status', ['confirmed', 'active', 'pending', 'confermata', 'in_corso'])
      .in('service_type', ['car_rental']);

    if (bookingsError) {
      console.error('[Pre-Rental Offer] Error fetching bookings:', bookingsError);
      throw bookingsError;
    }

    // Also fetch bookings with null service_type (legacy car rentals)
    const { data: nullServiceBookings, error: nullError } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, dropoff_date, vehicle_id, booking_details, service_type, status')
      .gte('dropoff_date', tomorrowStart)
      .lte('dropoff_date', tomorrowEnd)
      .in('status', ['confirmed', 'active', 'pending', 'confermata', 'in_corso'])
      .is('service_type', null);

    if (nullError) {
      console.error('[Pre-Rental Offer] Error fetching null service_type bookings:', nullError);
      throw nullError;
    }

    const allBookings = [...(bookings || []), ...(nullServiceBookings || [])];
    console.log(`[Pre-Rental Offer] Found ${allBookings.length} car rental bookings with pickup tomorrow`);

    if (allBookings.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No bookings found for tomorrow', sent: 0 }) };
    }

    // Get unique vehicle IDs
    const vehicleIds = [...new Set(allBookings.map(b => b.vehicle_id).filter(Boolean))];

    // Fetch vehicles to get categories
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, category')
      .in('id', vehicleIds);

    if (vehiclesError) {
      console.error('[Pre-Rental Offer] Error fetching vehicles:', vehiclesError);
      throw vehiclesError;
    }

    const vehicleMap = new Map((vehicles || []).map(v => [v.id, v.category]));

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const booking of allBookings) {
      try {
        // Skip if already sent
        if (booking.booking_details?.pre_rental_offer_sent) {
          console.log(`[Pre-Rental Offer] Skipping ${booking.id} - already sent`);
          skipped++;
          continue;
        }

        // Skip if no phone — check both fields
        const phone = booking.customer_phone || booking.booking_details?.customer?.phone;
        if (!phone) {
          console.log(`[Pre-Rental Offer] Skipping ${booking.id} - no phone number`);
          skipped++;
          continue;
        }

        // Get vehicle category type (urban or exotic/supercar)
        const rawCategory = vehicleMap.get(booking.vehicle_id);
        const categoryType = getCategoryType(rawCategory);
        if (!categoryType) {
          console.log(`[Pre-Rental Offer] Skipping ${booking.id} - category "${rawCategory}" not urban/exotic/supercar`);
          skipped++;
          continue;
        }

        // Get customer first name
        const firstName = booking.customer_name?.split(' ')[0] || booking.booking_details?.customer?.fullName?.split(' ')[0] || 'Cliente';

        // Pick message template
        const template = categoryType === 'urban' ? URBAN_MESSAGE : EXOTIC_MESSAGE;
        const message = template.replace('{nome}', firstName);

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
          console.error(`[Pre-Rental Offer] Failed to send to booking ${booking.id}:`, result);
          errors++;
          continue;
        }

        console.log(`[Pre-Rental Offer] Sent ${categoryType} offer to ${firstName} (${cleanedPhone}) for booking ${booking.id}`);

        // Mark as sent in booking_details
        const updatedDetails = { ...(booking.booking_details || {}), pre_rental_offer_sent: true };
        await supabase
          .from('bookings')
          .update({ booking_details: updatedDetails })
          .eq('id', booking.id);

        sent++;

        // Delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`[Pre-Rental Offer] Error processing booking ${booking.id}:`, err);
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

    console.log('[Pre-Rental Offer] Completed:', summary);

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };

  } catch (error: any) {
    console.error('[Pre-Rental Offer] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Run every day at 9:00 AM UTC (10:00 AM Rome time)
export const handler = schedule('0 9 * * *', preRentalOfferHandler);
