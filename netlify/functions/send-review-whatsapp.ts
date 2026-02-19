import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const DEFAULT_REVIEW_MESSAGE = `Ciao {nome} 👋🏻

Grazie per aver scelto DR7 Empire!

La tua opinione è fondamentale per noi. Se ti fa piacere, lasciaci una recensione a 5 stelle raccontando la tua esperienza ⭐

In segno di gratitudine, inviandoci uno screenshot della recensione riceverai un buono sconto da €100 sul tuo prossimo noleggio e uno da €10 sul tuo prossimo lavaggio 🎁

Clicca qui per lasciare la recensione 👇🏻
https://g.page/r/CQwgJt7OYpsfEBM/review

Grazie mille!
Dubai Rent 7.0 S.p.A.`;

const reviewHandler: Handler = async (event) => {
  console.log('[Review WhatsApp] Starting automatic review message sender...');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Review WhatsApp] Missing Supabase credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase config' }) };
  }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('[Review WhatsApp] Missing Green API credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Green API config' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    // Load custom message template from database (fallback to default)
    let reviewMessage = DEFAULT_REVIEW_MESSAGE;
    const { data: settingData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'review_whatsapp_template')
      .single();

    if (settingData?.value) {
      reviewMessage = settingData.value;
      console.log('[Review WhatsApp] Using custom message template from database');
    } else {
      console.log('[Review WhatsApp] Using default message template');
    }

    // Find bookings where dropoff_date is between 60 and 120 minutes ago
    const now = new Date();
    const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneHundredTwentyMinAgo = new Date(now.getTime() - 120 * 60 * 1000);

    console.log(`[Review WhatsApp] Looking for bookings with dropoff between ${oneHundredTwentyMinAgo.toISOString()} and ${sixtyMinAgo.toISOString()}`);

    // Query eligible bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, customer_id, customer_name, customer_phone, dropoff_date, service_type')
      .neq('status', 'cancelled')
      .not('customer_phone', 'is', null)
      .not('customer_id', 'is', null)
      .lte('dropoff_date', sixtyMinAgo.toISOString())
      .gte('dropoff_date', oneHundredTwentyMinAgo.toISOString());

    if (bookingsError) {
      console.error('[Review WhatsApp] Error fetching bookings:', bookingsError);
      throw bookingsError;
    }

    // Filter: only rentals (service_type NULL) and car_wash, skip "Lavaggio Rientro"
    const eligibleBookings = (bookings || []).filter(b => {
      if (b.service_type && b.service_type !== 'car_wash') return false;
      if (b.customer_name === 'Lavaggio Rientro') return false;
      return true;
    });

    console.log(`[Review WhatsApp] Found ${eligibleBookings.length} eligible bookings (from ${bookings?.length || 0} total in window)`);

    if (eligibleBookings.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No eligible bookings found', sent: 0, errors: 0 })
      };
    }

    // Get customer IDs that already received a review WhatsApp (forever)
    const customerIds = eligibleBookings.map(b => b.customer_id).filter(Boolean);
    const { data: alreadySent, error: sentError } = await supabase
      .from('review_whatsapp_sent')
      .select('customer_id')
      .in('customer_id', customerIds);

    if (sentError) {
      console.warn('[Review WhatsApp] Error fetching sent records:', sentError);
    }

    const alreadySentIds = new Set((alreadySent || []).map(r => r.customer_id));

    // Filter out customers who already received a review message
    const bookingsToSend = eligibleBookings.filter(b => !alreadySentIds.has(b.customer_id));

    console.log(`[Review WhatsApp] ${bookingsToSend.length} bookings to send (${alreadySentIds.size} customers already received)`);

    let sent = 0;
    let errors = 0;

    for (const booking of bookingsToSend) {
      try {
        if (!booking.customer_phone || booking.customer_phone.trim() === '') {
          console.log(`[Review WhatsApp] Skipping ${booking.customer_name}: empty phone`);
          continue;
        }

        // Get first name (split on space, take first part)
        const firstName = (booking.customer_name || 'Cliente').split(' ')[0];

        // Personalize message
        const personalizedMessage = reviewMessage.replace(/\{nome\}/g, firstName);

        // Clean phone number — strip all non-digit chars, normalize Italian prefix
        let cleanPhone = booking.customer_phone.replace(/[^\d]/g, '');
        if (cleanPhone.startsWith('0')) {
          cleanPhone = '39' + cleanPhone.substring(1);
        }
        if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) {
          cleanPhone = '39' + cleanPhone;
        }
        if (cleanPhone.length < 10) {
          console.log(`[Review WhatsApp] Skipping ${booking.customer_name}: invalid phone ${booking.customer_phone}`);
          continue;
        }

        // Send via Green API
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

        const response = await fetch(greenApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: `${cleanPhone}@c.us`,
            message: personalizedMessage
          })
        });

        const result = await response.json();

        if (!response.ok || result.error) {
          console.error(`[Review WhatsApp] Failed to send to ${booking.customer_name}:`, result);
          errors++;
          continue;
        }

        console.log(`[Review WhatsApp] ✅ Sent to ${booking.customer_name} (${cleanPhone})`);

        // Record in review_whatsapp_sent (UNIQUE on customer_id prevents duplicates)
        await supabase
          .from('review_whatsapp_sent')
          .insert({
            customer_id: booking.customer_id,
            booking_id: booking.id,
            customer_phone: booking.customer_phone,
            message_text: personalizedMessage
          });

        // Also update bookings.review_sent_at for tracking in ReviewsTab
        await supabase
          .from('bookings')
          .update({ review_sent_at: new Date().toISOString() })
          .eq('id', booking.id);

        sent++;

        // Delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`[Review WhatsApp] Error sending to ${booking.customer_name}:`, err);
        errors++;
      }
    }

    const summary = {
      date: new Date().toISOString(),
      window: `${oneHundredTwentyMinAgo.toISOString()} to ${sixtyMinAgo.toISOString()}`,
      eligibleBookings: eligibleBookings.length,
      alreadySent: alreadySentIds.size,
      sent,
      errors
    };

    console.log('[Review WhatsApp] Completed:', summary);

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };

  } catch (error: any) {
    console.error('[Review WhatsApp] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Run every 30 minutes
export const handler = schedule('0,30 * * * *', reviewHandler);
