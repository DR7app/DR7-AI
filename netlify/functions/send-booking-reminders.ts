import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { renderTemplate } from './utils/messageTemplates';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

/**
 * Clean phone number for Green API format: 39XXXXXXXXXX
 */
function cleanPhone(phone: string): string | null {
  if (!phone) return null;
  let clean = phone.replace(/[\s\-\+\(\)]/g, '');
  if (clean.startsWith('00')) {
    clean = clean.substring(2);
  }
  if (clean.length === 10) {
    clean = '39' + clean;
  }
  return clean;
}

/**
 * Send WhatsApp message via Green API
 */
async function loadWrapper(): Promise<{ header: string; footer: string }> {
  // Pulled from Messaggi di Sistema Pro. NO HARDCODED FALLBACK: if the rows are
  // missing or disabled, we send the message without a wrapper.
  try {
    const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!sbUrl || !sbKey) return { header: '', footer: '' };
    const sb = createClient(sbUrl, sbKey);
    const { data } = await sb.from('system_messages').select('message_key, message_body, is_enabled').in('message_key', ['pro_wrapper_header', 'pro_wrapper_footer']);
    return {
      header: data?.find((w: any) => w.message_key === 'pro_wrapper_header' && w.is_enabled !== false)?.message_body || '',
      footer: data?.find((w: any) => w.message_key === 'pro_wrapper_footer' && w.is_enabled !== false)?.message_body || '',
    };
  } catch { return { header: '', footer: '' }; }
}

async function sendWhatsApp(instanceId: string, token: string, phone: string, message: string): Promise<boolean> {
  const cleanNum = cleanPhone(phone);
  if (!cleanNum) {
    console.warn('Invalid phone number:', phone);
    return false;
  }

  try {
    const { header, footer } = await loadWrapper();
    const wrappedMessage = [header, message, footer].filter(Boolean).join('\n\n');
    const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${cleanNum}@c.us`,
        message: wrappedMessage,
      }),
    });

    const responseBody = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(responseBody); } catch { /* not JSON */ }

    if (!response.ok) {
      console.error(`WhatsApp HTTP ${response.status} for ${cleanNum}:`, responseBody);
      return false;
    }

    // Green API can return 200 but with an error in the body
    if (parsed?.error) {
      console.error(`WhatsApp API error for ${cleanNum}:`, JSON.stringify(parsed));
      return false;
    }

    if (!parsed?.idMessage) {
      console.error(`WhatsApp unexpected response for ${cleanNum} (no idMessage):`, responseBody);
      return false;
    }

    console.log(`WhatsApp message sent to ${cleanNum}, idMessage: ${parsed.idMessage}`);
    return true;
  } catch (err: any) {
    console.error(`WhatsApp error for ${cleanNum}:`, err.message);
    return false;
  }
}

/**
 * Resolve phone number from booking → booking_details → customers_extended
 */
async function resolvePhone(booking: any, supabase: any): Promise<string | null> {
  let phone = booking.customer_phone || booking.booking_details?.customer?.phone;
  if (!phone) {
    const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer_id || booking.user_id;
    if (custId) {
      const { data: cust } = await supabase.from('customers_extended').select('telefono').eq('id', custId).maybeSingle();
      if (cust?.telefono) phone = cust.telefono;
    }
    if (!phone && booking.customer_email) {
      const { data: cust } = await supabase.from('customers_extended').select('telefono').eq('email', booking.customer_email).maybeSingle();
      if (cust?.telefono) phone = cust.telefono;
    }
  }
  return phone || null;
}

/**
 * Check if customer is blacklisted
 */
async function isBlacklisted(booking: any, supabase: any): Promise<boolean> {
  const custId = booking.booking_details?.customer?.customerId || booking.booking_details?.customer_id || booking.user_id;
  if (custId) {
    const { data: custCheck } = await supabase.from('customers_extended').select('status').eq('id', custId).maybeSingle();
    if (custCheck?.status === 'blacklist') return true;
  }
  return false;
}

/**
 * Get Rome date string (YYYY-MM-DD) with offset
 */
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

/**
 * Scheduled function — checks every 2 hours for pending messages.
 * Each message is sent ONE TIME only — flags in booking_details prevent re-sending.
 *
 * 1. EXTENSION OFFER (>24h bookings): runs ONLY at 9 AM Rome → bookings ending tomorrow
 * 2. EXTENSION OFFER (≤24h bookings): runs EVERY check → sends 4h after pickup
 * 3. IBAN DEPOSIT REQUEST: runs ONLY at 9 AM Rome → bookings ended yesterday
 */
export const reminderHandler: Handler = async () => {
  console.log('=== Booking Reminders Check Started ===');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('Missing GREEN_API_INSTANCE_ID or GREEN_API_TOKEN');
    return { statusCode: 500, body: 'WhatsApp not configured' };
  }

  const now = new Date();
  let sent = 0;
  let failed = 0;

  // Determine current Rome hour — sections 1 & 3 only run at ~9 AM
  const romeHourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    hour: 'numeric',
    hour12: false,
  });
  const currentRomeHour = parseInt(romeHourFormatter.format(now), 10);
  const isMorningRun = currentRomeHour >= 8 && currentRomeHour <= 12;
  console.log(`Current Rome hour: ${currentRomeHour} — Morning run: ${isMorningRun}`);

  // Load message templates from system_messages table (only enabled ones)
  const messageTemplates: Record<string, string> = {};
  try {
    const { data: templates } = await supabase
      .from('system_messages')
      .select('message_key, message_body, is_enabled');

    if (templates) {
      templates.forEach((t: any) => {
        if (t.is_enabled !== false) messageTemplates[t.message_key] = t.message_body;
      });
      console.log(`Loaded ${Object.keys(messageTemplates).length} enabled message template(s) from database`);
    }
  } catch (err: any) {
    console.warn('Could not load system_messages, using defaults:', err.message);
  }

  // Returns null when template is disabled (no DB entry AND no fallback desired)
  const getTemplate = (key: string, fallback: string | null) => messageTemplates[key] || fallback;

  // Load vehicles to determine category (exotic vs urban) AND display name
  const { data: allVehicles } = await supabase
    .from('vehicles')
    .select('id, plate, category, display_name');

  const vehicleMap = new Map<string, string>();
  const plateMap = new Map<string, string>();
  const vehicleNameById = new Map<string, string>();
  const vehicleNameByPlate = new Map<string, string>();
  if (allVehicles) {
    allVehicles.forEach((v: any) => {
      vehicleMap.set(v.id, v.category || 'urban');
      if (v.display_name) vehicleNameById.set(v.id, v.display_name);
      if (v.plate) {
        const np = v.plate.replace(/\s/g, '').toUpperCase();
        plateMap.set(np, v.category || 'urban');
        if (v.display_name) vehicleNameByPlate.set(np, v.display_name);
      }
    });
  }

  function getVehicleCategory(booking: any): string {
    if (booking.vehicle_id && vehicleMap.has(booking.vehicle_id)) {
      return vehicleMap.get(booking.vehicle_id)!;
    }
    if (booking.vehicle_plate) {
      const normPlate = booking.vehicle_plate.replace(/\s/g, '').toUpperCase();
      if (plateMap.has(normPlate)) return plateMap.get(normPlate)!;
    }
    return 'urban';
  }

  // Risolve il nome display del veicolo dalla fonte più affidabile
  // (vehicles.display_name) con fallback sui dati embed nel booking.
  function getVehicleDisplayName(booking: any): string {
    if (booking.vehicle_id && vehicleNameById.has(booking.vehicle_id)) {
      return vehicleNameById.get(booking.vehicle_id)!;
    }
    if (booking.vehicle_plate) {
      const np = booking.vehicle_plate.replace(/\s/g, '').toUpperCase();
      if (vehicleNameByPlate.has(np)) return vehicleNameByPlate.get(np)!;
    }
    return booking.vehicle_name
      || booking.booking_details?.vehicle?.name
      || booking.booking_details?.vehicle?.display_name
      || '';
  }

  function buildExtensionMessage(category: string, firstName: string): string | null {
    const key = category === 'exotic' ? 'supercar_day_before' : 'utilitaria_day_before';
    const template = getTemplate(key, null);
    if (!template) return null;
    return template.replace(/\{nome\}/g, firstName);
  }

  // ──────────────────────────────────────────────
  // 1. EXTENSION OFFER for bookings > 24h ending TOMORROW
  //    Only runs at 9 AM Rome time — ONE TIME per day
  // ──────────────────────────────────────────────
  if (isMorningRun) try {
    const tomorrowRome = getRomeDateString(1);
    console.log(`[Extension >24h] Looking for bookings ending tomorrow: ${tomorrowRome}`);

    const { data: endingTomorrow, error: dayBeforeError } = await supabase
      .from('bookings')
      .select('*')
      .gte('dropoff_date', `${tomorrowRome}T00:00:00`)
      .lt('dropoff_date', `${tomorrowRome}T23:59:59`)
      .in('status', ['confirmed', 'active'])
      .is('service_type', null);

    if (dayBeforeError) {
      console.error('[Extension >24h] Query error:', dayBeforeError);
    } else if (endingTomorrow && endingTomorrow.length > 0) {
      console.log(`[Extension >24h] Found ${endingTomorrow.length} booking(s) ending tomorrow`);

      for (const booking of endingTomorrow) {
        try {
          if (booking.booking_details?.day_before_reminder_sent || booking.booking_details?.pre_rental_offer_sent) {
            console.log(`[Extension >24h] Skipping ${booking.id} — already sent`);
            continue;
          }

          // Skip short rentals (≤ 24h) — handled by Section 2
          if (booking.pickup_date && booking.dropoff_date) {
            const durationHours = (new Date(booking.dropoff_date).getTime() - new Date(booking.pickup_date).getTime()) / (1000 * 60 * 60);
            if (durationHours <= 24) {
              console.log(`[Extension >24h] Skipping ${booking.id} — short rental (${durationHours.toFixed(1)}h)`);
              continue;
            }
          }

          const phone = await resolvePhone(booking, supabase);
          if (!phone) { console.log(`[Extension >24h] Skipping ${booking.id} — no phone`); continue; }
          if (await isBlacklisted(booking, supabase)) { console.log(`[Extension >24h] Skipping ${booking.id} — blacklisted`); continue; }

          const firstName = booking.booking_details?.customer?.firstName || booking.customer_name?.split(' ')[0] || 'Cliente';
          const category = getVehicleCategory(booking);
          const message = buildExtensionMessage(category, firstName);

          if (!message) { console.log(`[Extension >24h] Skipping ${booking.id} — template disabled`); continue; }

          const success = await sendWhatsApp(GREEN_API_INSTANCE_ID, GREEN_API_TOKEN, phone, message);

          if (success) {
            await supabase.from('bookings').update({
              booking_details: {
                ...(booking.booking_details || {}),
                day_before_reminder_sent: true,
                day_before_reminder_sent_at: now.toISOString(),
                pre_rental_offer_sent: true,
              }
            }).eq('id', booking.id);
            console.log(`[Extension >24h] Sent for ${booking.id} (${category})`);
            sent++;

            // Log to sent_messages_log
            try {
              const fullMessage = message;
              await supabase.from('sent_messages_log').insert({
                customer_name: firstName,
                customer_phone: phone,
                message_text: fullMessage,
                template_label: 'Booking Extension Offer (>24h)',
                status: 'sent',
              });
            } catch (logErr) {
              console.error('Failed to log message:', logErr);
            }
          } else { failed++; }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          console.error(`[Extension >24h] Error for ${booking.id}:`, err.message);
          failed++;
        }
      }
    } else {
      console.log('[Extension >24h] No bookings ending tomorrow');
    }
  } catch (err: any) {
    console.error('[Extension >24h] Fatal error:', err.message);
  } else {
    console.log('[Extension >24h] Skipping — not morning run');
  }

  // ──────────────────────────────────────────────
  // 2. EXTENSION OFFER for short rentals ≤ 24h
  //    Runs EVERY check — sends 4h after pickup, ONE TIME per booking
  // ──────────────────────────────────────────────
  try {
    // Look for short rentals (≤24h) that started in the last 30 hours
    // Send message when pickup + 4h has passed
    const cutoffStart = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();
    console.log(`[Extension ≤24h] Looking for short rentals picked up since ${cutoffStart}`);

    const { data: recentPickups, error: shortError } = await supabase
      .from('bookings')
      .select('*')
      .gte('pickup_date', cutoffStart)
      .lte('pickup_date', now.toISOString())
      .in('status', ['confirmed', 'active'])
      .is('service_type', null);

    if (shortError) {
      console.error('[Extension ≤24h] Query error:', shortError);
    } else if (recentPickups && recentPickups.length > 0) {
      const shortRentals = recentPickups.filter(b => {
        if (!b.pickup_date || !b.dropoff_date) return false;
        const durationHours = (new Date(b.dropoff_date).getTime() - new Date(b.pickup_date).getTime()) / (1000 * 60 * 60);
        return durationHours <= 24;
      });

      console.log(`[Extension ≤24h] Found ${shortRentals.length} short rental(s) (from ${recentPickups.length} recent pickups)`);

      for (const booking of shortRentals) {
        try {
          if (booking.booking_details?.day_before_reminder_sent || booking.booking_details?.pre_rental_offer_sent) {
            console.log(`[Extension ≤24h] Skipping ${booking.id} — already sent`);
            continue;
          }

          // Only send if 4h have passed since pickup
          const pickupTime = new Date(booking.pickup_date).getTime();
          const fourHoursAfterPickup = pickupTime + 4 * 60 * 60 * 1000;
          if (now.getTime() < fourHoursAfterPickup) {
            const minutesLeft = Math.round((fourHoursAfterPickup - now.getTime()) / 60000);
            console.log(`[Extension ≤24h] Skipping ${booking.id} — only ${minutesLeft} min since pickup, waiting for 4h`);
            continue;
          }

          const phone = await resolvePhone(booking, supabase);
          if (!phone) { console.log(`[Extension ≤24h] Skipping ${booking.id} — no phone`); continue; }
          if (await isBlacklisted(booking, supabase)) { console.log(`[Extension ≤24h] Skipping ${booking.id} — blacklisted`); continue; }

          const firstName = booking.booking_details?.customer?.firstName || booking.customer_name?.split(' ')[0] || 'Cliente';
          const category = getVehicleCategory(booking);
          const message = buildExtensionMessage(category, firstName);

          if (!message) { console.log(`[Extension ≤24h] Skipping ${booking.id} — template disabled`); continue; }

          const success = await sendWhatsApp(GREEN_API_INSTANCE_ID, GREEN_API_TOKEN, phone, message);

          if (success) {
            await supabase.from('bookings').update({
              booking_details: {
                ...(booking.booking_details || {}),
                day_before_reminder_sent: true,
                day_before_reminder_sent_at: now.toISOString(),
                pre_rental_offer_sent: true,
              }
            }).eq('id', booking.id);
            console.log(`[Extension ≤24h] Sent for ${booking.id} — 4h after pickup (${category})`);
            sent++;

            // Log to sent_messages_log
            try {
              const fullMessage = message;
              await supabase.from('sent_messages_log').insert({
                customer_name: firstName,
                customer_phone: phone,
                message_text: fullMessage,
                template_label: 'Booking Extension Offer (<=24h)',
                status: 'sent',
              });
            } catch (logErr) {
              console.error('Failed to log message:', logErr);
            }
          } else { failed++; }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          console.error(`[Extension ≤24h] Error for ${booking.id}:`, err.message);
          failed++;
        }
      }
    } else {
      console.log('[Extension ≤24h] No recent short rentals found');
    }
  } catch (err: any) {
    console.error('[Extension ≤24h] Fatal error:', err.message);
  }

  // ──────────────────────────────────────────────
  // 3. IBAN DEPOSIT REQUEST for bookings that ended YESTERDAY
  //    Only runs at 9 AM Rome time — ONE TIME per day
  // ──────────────────────────────────────────────
  if (isMorningRun) try {
    const yesterdayRome = getRomeDateString(-1);
    console.log(`[IBAN Deposit] Looking for bookings ended yesterday: ${yesterdayRome}`);

    const { data: endedYesterday, error: depositError } = await supabase
      .from('bookings')
      .select('*')
      .gte('dropoff_date', `${yesterdayRome}T00:00:00`)
      .lt('dropoff_date', `${yesterdayRome}T23:59:59`)
      .in('status', ['confirmed', 'active', 'completed'])
      .is('service_type', null);

    if (depositError) {
      console.error('[IBAN Deposit] Query error:', depositError);
    } else if (endedYesterday && endedYesterday.length > 0) {
      // Check cauzioni table for deposits
      const bookingIds = endedYesterday.map(b => b.id);
      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('riferimento_contratto_id, importo, stato')
        .in('riferimento_contratto_id', bookingIds)
        .in('stato', ['Attiva', 'In scadenza']);
      const cauzioneMap = new Map(
        (cauzioni || []).map(c => [c.riferimento_contratto_id, c])
      );

      const depositBookings = endedYesterday.filter(b => {
        if (b.booking_details?.depositOption === 'no_deposit') return false;
        const fromAmount = Number(b.deposit_amount ?? 0) > 0;
        const fromDetails = Number(b.booking_details?.deposit ?? 0) > 0;
        const fromCauzioni = cauzioneMap.has(b.id) && Number(cauzioneMap.get(b.id)!.importo) > 0;
        return fromAmount || fromDetails || fromCauzioni;
      });

      console.log(`[IBAN Deposit] Found ${depositBookings.length} deposit booking(s) (from ${endedYesterday.length} ended yesterday)`);

      for (const booking of depositBookings) {
        try {
          if (booking.booking_details?.deposit_reminder_sent || booking.booking_details?.iban_request_sent) {
            console.log(`[IBAN Deposit] Skipping ${booking.id} — already sent`);
            continue;
          }

          // Safety: never send if dropoff_date is more than 3 days ago.
          // Protegge contro dati sporchi (dropoff_date aggiornato per errore)
          // che farebbero matchare vecchie prenotazioni al filtro di ieri.
          const dropoffTime = booking.dropoff_date ? new Date(booking.dropoff_date).getTime() : 0;
          const threeDaysAgoMs = Date.now() - 3 * 24 * 60 * 60 * 1000;
          if (!dropoffTime || dropoffTime < threeDaysAgoMs) {
            console.log(`[IBAN Deposit] Skipping ${booking.id} — dropoff_date ${booking.dropoff_date} fuori finestra sicura (>3 giorni fa)`);
            continue;
          }

          const phone = await resolvePhone(booking, supabase);
          if (!phone) { console.log(`[IBAN Deposit] Skipping ${booking.id} — no phone`); continue; }
          if (await isBlacklisted(booking, supabase)) { console.log(`[IBAN Deposit] Skipping ${booking.id} — blacklisted`); continue; }

          const firstName = booking.booking_details?.customer?.firstName || booking.customer_name?.split(' ')[0] || 'Cliente';
          const fullName = booking.customer_name
            || [booking.booking_details?.customer?.firstName, booking.booking_details?.customer?.lastName].filter(Boolean).join(' ').trim()
            || firstName;
          const vehicleName = getVehicleDisplayName(booking);

          // Routing via resolver: passiamo l'evento legacy `deposit_return_iban`
          // e il service_type del booking — il resolver sceglie il template
          // che ha questo evento in handled_events (o cade su pro_richiesta_iban
          // via OLD_TO_PRO se nessun custom lo claima).
          const vars: Record<string, string> = {
            'nome cliente': fullName,
            nome: firstName,
            customer_name: fullName,
            vehicle_name: vehicleName,
          };
          const bookingSvc = (booking as { service_type?: string })?.service_type || 'rental';
          const message = await renderTemplate('deposit_return_iban', vars, undefined, {
            booking: { service_type: bookingSvc },
          });
          if (!message) {
            console.log(`[IBAN Deposit] Skipping ${booking.id} — nessun template per deposit_return_iban (service_type=${bookingSvc})`);
            continue;
          }

          const success = await sendWhatsApp(GREEN_API_INSTANCE_ID, GREEN_API_TOKEN, phone, message);

          if (success) {
            await supabase.from('bookings').update({
              booking_details: {
                ...(booking.booking_details || {}),
                deposit_reminder_sent: true,
                deposit_reminder_sent_at: now.toISOString(),
                iban_request_sent: true,
              }
            }).eq('id', booking.id);
            console.log(`[IBAN Deposit] Sent for ${booking.id}`);
            sent++;

            // Log to sent_messages_log
            try {
              const fullMessage = message;
              await supabase.from('sent_messages_log').insert({
                customer_name: firstName,
                customer_phone: phone,
                message_text: fullMessage,
                template_label: 'IBAN Deposit Request',
                status: 'sent',
              });
            } catch (logErr) {
              console.error('Failed to log message:', logErr);
            }
          } else { failed++; }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          console.error(`[IBAN Deposit] Error for ${booking.id}:`, err.message);
          failed++;
        }
      }
    } else {
      console.log('[IBAN Deposit] No bookings ended yesterday');
    }
  } catch (err: any) {
    console.error('[IBAN Deposit] Fatal error:', err.message);
  } else {
    console.log('[IBAN Deposit] Skipping — not morning run');
  }

  console.log(`=== Booking Reminders Check Complete: ${sent} sent, ${failed} failed ===`);
  return { statusCode: 200, body: `Sent: ${sent}, failed: ${failed}` };
};

// Run every 2 hours via Netlify scheduled functions.
export const handler = schedule('0 */2 * * *', reminderHandler);
