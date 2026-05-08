import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { renderTemplate } from './utils/messageTemplates';
import { getGoogleReviewLink } from './utils/loadMarketing';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// NO hardcoded message body — Messaggi di Sistema Pro is the only source.
// If the Pro template for review_request_whatsapp is missing/disabled, the
// send is skipped per-customer (see below).

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
    // Find bookings where dropoff_date is between 60 and 120 minutes ago
    const now = new Date();
    const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneHundredTwentyMinAgo = new Date(now.getTime() - 120 * 60 * 1000);

    console.log(`[Review WhatsApp] Looking for bookings with dropoff between ${oneHundredTwentyMinAgo.toISOString()} and ${sixtyMinAgo.toISOString()}`);

    // Query eligible bookings — also skip any with review_sent_at already set
    // (secondary dedupe in case review_whatsapp_sent table lookup fails).
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, customer_id, customer_name, customer_phone, dropoff_date, service_type, review_sent_at')
      .neq('status', 'cancelled')
      .is('review_sent_at', null)
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
      // If we can't read the dedupe table, DO NOT send — we risk spamming.
      console.error('[Review WhatsApp] Error fetching sent records — aborting to prevent duplicate sends:', sentError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'review_whatsapp_sent lookup failed, aborting', details: sentError.message })
      };
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

        // Check blacklist status
        if (booking.customer_id) {
          const { data: custCheck } = await supabase.from('customers_extended').select('status').eq('id', booking.customer_id).maybeSingle();
          if (custCheck?.status === 'blacklist') {
            console.log(`[Review WhatsApp] Skipping ${booking.customer_name} — customer is blacklisted`);
            continue;
          }
        }

        // Get first name (split on space, take first part)
        const firstName = (booking.customer_name || 'Cliente').split(' ')[0];

        // Body from Messaggi di Sistema Pro — no hardcoded fallback.
        // Pro template uses {customer_name} + {review_link}; pass legacy {nome} too
        // for older templates that still reference it.
        // Letto da centralina_pro_config.config.marketing.google_review_link
        // (modificabile direttamente in DB; fallback hardcoded per safety).
        const reviewLink = await getGoogleReviewLink();
        const personalizedMessage = await renderTemplate('review_request_whatsapp', {
          nome: firstName,
          customer_name: booking.customer_name || 'Cliente',
          first_name: firstName,
          review_link: reviewLink,
        });
        if (!personalizedMessage) {
          console.log(`[Review WhatsApp] Skipping ${booking.customer_name}: no Pro template for review_request_whatsapp`);
          continue;
        }

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

        // Record in review_whatsapp_sent (UNIQUE on customer_id prevents duplicates).
        // If this insert fails, the bookings.review_sent_at update below is the
        // secondary dedupe that still protects against the next cron run.
        const { error: insertErr } = await supabase
          .from('review_whatsapp_sent')
          .insert({
            customer_id: booking.customer_id,
            booking_id: booking.id,
            customer_phone: booking.customer_phone,
            message_text: personalizedMessage
          });
        if (insertErr) {
          console.error(`[Review WhatsApp] review_whatsapp_sent insert FAILED for ${booking.customer_name}:`, insertErr);
        }

        // Also update bookings.review_sent_at for tracking in ReviewsTab
        await supabase
          .from('bookings')
          .update({ review_sent_at: new Date().toISOString() })
          .eq('id', booking.id);

        // Log to sent_messages_log
        try {
          const fullMessage = personalizedMessage;
          await supabase.from('sent_messages_log').insert({
            customer_name: booking.customer_name || 'N/A',
            customer_phone: booking.customer_phone,
            message_text: fullMessage,
            template_label: 'Review Request',
            status: 'sent',
          });
        } catch (logErr) {
          console.error('Failed to log message:', logErr);
        }

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
