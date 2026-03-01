import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

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
  // Handle 00 international prefix (e.g., 00393921900763)
  if (clean.startsWith('00')) {
    clean = clean.substring(2);
  }
  // 10-digit local Italian number → always prepend country code 39
  // (covers numbers starting with 39X like 392, 393, 394 mobile prefixes)
  if (clean.length === 10) {
    clean = '39' + clean;
  }
  return clean;
}

/**
 * Send WhatsApp message via Green API
 */
async function sendWhatsApp(instanceId: string, token: string, phone: string, message: string): Promise<boolean> {
  const cleanNum = cleanPhone(phone);
  if (!cleanNum) {
    console.warn('Invalid phone number:', phone);
    return false;
  }

  try {
    const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${cleanNum}@c.us`,
        message: message,
      }),
    });

    if (response.ok) {
      return true;
    } else {
      const text = await response.text();
      console.error(`WhatsApp send failed for ${cleanNum}:`, text);
      return false;
    }
  } catch (err: any) {
    console.error(`WhatsApp error for ${cleanNum}:`, err.message);
    return false;
  }
}

/**
 * Scheduled function — runs every 5 minutes
 * Sends 3 types of WhatsApp reminders:
 *
 * 1. SUPERCAR day-before: promo continuation offer
 * 2. UTILITARIA day-before: extension offer with discount
 * 3. DEPOSIT return (exactly 1h after rental ends): IBAN request for refund
 */
const reminderHandler: Handler = async (event) => {
  console.log('=== Booking Reminders Started ===');

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

  // ──────────────────────────────────────────────
  // Load message templates from system_messages table
  // (editable from Admin CRM → Marketing → Messaggi di Sistema)
  // ──────────────────────────────────────────────
  const messageTemplates: Record<string, string> = {};
  try {
    const { data: templates } = await supabase
      .from('system_messages')
      .select('message_key, message_body');

    if (templates) {
      templates.forEach((t: any) => { messageTemplates[t.message_key] = t.message_body; });
      console.log(`Loaded ${templates.length} message template(s) from database`);
    }
  } catch (err: any) {
    console.warn('Could not load system_messages, using defaults:', err.message);
  }

  // Fallback defaults if table doesn't exist yet
  const getTemplate = (key: string, fallback: string) => messageTemplates[key] || fallback;

  // ──────────────────────────────────────────────
  // 1 & 2. DAY-BEFORE REMINDERS (supercar + utilitaria)
  // Find bookings where dropoff_date is tomorrow (Italy time)
  // ──────────────────────────────────────────────
  try {
    const italyFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayItaly = italyFormatter.format(now);
    const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowItaly = italyFormatter.format(tomorrowDate);

    console.log(`Italy today: ${todayItaly}, tomorrow: ${tomorrowItaly}`);

    // Load vehicles to determine category (exotic vs urban/aziendali)
    const { data: allVehicles } = await supabase
      .from('vehicles')
      .select('id, plate, category')

    const vehicleMap = new Map<string, string>()
    const plateMap = new Map<string, string>()
    if (allVehicles) {
      allVehicles.forEach((v: any) => {
        vehicleMap.set(v.id, v.category || 'urban')
        if (v.plate) plateMap.set(v.plate.replace(/\s/g, '').toUpperCase(), v.category || 'urban')
      })
    }

    const { data: endingTomorrow, error: dayBeforeError } = await supabase
      .from('bookings')
      .select('*')
      .gte('dropoff_date', `${tomorrowItaly}T00:00:00`)
      .lt('dropoff_date', `${tomorrowItaly}T23:59:59`)
      .in('status', ['confirmed', 'active'])
      .is('service_type', null);

    if (dayBeforeError) {
      console.error('Error querying day-before bookings:', dayBeforeError);
    } else if (endingTomorrow && endingTomorrow.length > 0) {
      console.log(`Found ${endingTomorrow.length} booking(s) ending tomorrow`);

      for (const booking of endingTomorrow) {
        try {
          if (booking.booking_details?.day_before_reminder_sent) {
            console.log(`Skipping booking ${booking.id} — day-before already sent`);
            continue;
          }

          // Skip short rentals (< 24h) — handled by 4h-after-pickup logic
          if (booking.pickup_date && booking.dropoff_date) {
            const durationHours = (new Date(booking.dropoff_date).getTime() - new Date(booking.pickup_date).getTime()) / (1000 * 60 * 60);
            if (durationHours < 24) {
              console.log(`Skipping booking ${booking.id} — short rental (${durationHours.toFixed(1)}h), handled by 4h-after-pickup`);
              continue;
            }
          }

          const firstName = booking.booking_details?.customer?.firstName
            || booking.customer_name?.split(' ')[0]
            || 'Cliente';

          // Resolve phone: booking column → booking_details → customers_extended
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

          if (!phone) {
            console.log(`Skipping booking ${booking.id} (${booking.customer_name}) — no phone number`);
            continue;
          }

          // Determine vehicle category from vehicles table
          let category = 'urban';
          if (booking.vehicle_id && vehicleMap.has(booking.vehicle_id)) {
            category = vehicleMap.get(booking.vehicle_id)!;
          } else if (booking.vehicle_plate) {
            const normPlate = booking.vehicle_plate.replace(/\s/g, '').toUpperCase();
            if (plateMap.has(normPlate)) category = plateMap.get(normPlate)!;
          }

          let message = '';
          if (category === 'exotic') {
            const template = getTemplate('supercar_day_before',
              `Salve,\n\nla contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nRestiamo in attesa di un suo cortese riscontro.\nGrazie.\n\nCordiali saluti,\nDR7`);
            message = template.replace(/\{nome\}/g, firstName);
          } else {
            const template = getTemplate('utilitaria_day_before',
              `Salve {nome},\n\nLa contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nCordiali saluti,\nDR7`);
            message = template.replace(/\{nome\}/g, firstName);
          }

          const success = await sendWhatsApp(GREEN_API_INSTANCE_ID, GREEN_API_TOKEN, phone, message);

          if (success) {
            const updatedDetails = {
              ...(booking.booking_details || {}),
              day_before_reminder_sent: true,
              day_before_reminder_sent_at: now.toISOString(),
            };

            await supabase
              .from('bookings')
              .update({ booking_details: updatedDetails })
              .eq('id', booking.id);

            console.log(`Day-before reminder sent for booking ${booking.id} (${category})`);
            sent++;
          } else {
            failed++;
          }
        } catch (err: any) {
          console.error(`Error processing day-before for booking ${booking.id}:`, err.message);
          failed++;
        }
      }
    } else {
      console.log('No bookings ending tomorrow');
    }
  } catch (err: any) {
    console.error('Day-before reminders error:', err.message);
  }

  // ──────────────────────────────────────────────
  // 2b. SHORT RENTAL EXTENSION OFFER (< 1 day bookings)
  // Send 4 hours after pickup_date instead of day-before
  // ──────────────────────────────────────────────
  try {
    // Find bookings where pickup was ~4 hours ago (±5 min window)
    const fourHoursMinusFive = new Date(now.getTime() - (4 * 60 + 5) * 60 * 1000);
    const fourHoursPlusFive = new Date(now.getTime() - (4 * 60 - 5) * 60 * 1000);

    const { data: recentPickups, error: shortRentalError } = await supabase
      .from('bookings')
      .select('*')
      .gte('pickup_date', fourHoursMinusFive.toISOString())
      .lte('pickup_date', fourHoursPlusFive.toISOString())
      .in('status', ['confirmed', 'active'])
      .is('service_type', null);

    if (shortRentalError) {
      console.error('Error querying short rental bookings:', shortRentalError);
    } else if (recentPickups && recentPickups.length > 0) {
      // Filter to only short rentals (< 24 hours)
      const shortRentals = recentPickups.filter(b => {
        if (!b.pickup_date || !b.dropoff_date) return false;
        const pickup = new Date(b.pickup_date).getTime();
        const dropoff = new Date(b.dropoff_date).getTime();
        const durationHours = (dropoff - pickup) / (1000 * 60 * 60);
        return durationHours < 24;
      });

      console.log(`Found ${shortRentals.length} short rental(s) eligible for 4h extension offer (from ${recentPickups.length} recent pickups)`);

      // Load vehicles for category
      const { data: allVehiclesShort } = await supabase.from('vehicles').select('id, plate, category');
      const vehicleMapShort = new Map<string, string>();
      const plateMapShort = new Map<string, string>();
      if (allVehiclesShort) {
        allVehiclesShort.forEach((v: any) => {
          vehicleMapShort.set(v.id, v.category || 'urban');
          if (v.plate) plateMapShort.set(v.plate.replace(/\s/g, '').toUpperCase(), v.category || 'urban');
        });
      }

      for (const booking of shortRentals) {
        try {
          if (booking.booking_details?.day_before_reminder_sent) {
            console.log(`Skipping short rental ${booking.id} — extension offer already sent`);
            continue;
          }

          const firstName = booking.booking_details?.customer?.firstName
            || booking.customer_name?.split(' ')[0]
            || 'Cliente';

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

          if (!phone) {
            console.log(`Skipping short rental ${booking.id} (${booking.customer_name}) — no phone number`);
            continue;
          }

          let category = 'urban';
          if (booking.vehicle_id && vehicleMapShort.has(booking.vehicle_id)) {
            category = vehicleMapShort.get(booking.vehicle_id)!;
          } else if (booking.vehicle_plate) {
            const normPlate = booking.vehicle_plate.replace(/\s/g, '').toUpperCase();
            if (plateMapShort.has(normPlate)) category = plateMapShort.get(normPlate)!;
          }

          let message = '';
          if (category === 'exotic') {
            const template = getTemplate('supercar_day_before',
              `Salve,\n\nla contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nRestiamo in attesa di un suo cortese riscontro.\nGrazie.\n\nCordiali saluti,\nDR7`);
            message = template.replace(/\{nome\}/g, firstName);
          } else {
            const template = getTemplate('utilitaria_day_before',
              `Salve {nome},\n\nLa contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nCordiali saluti,\nDR7`);
            message = template.replace(/\{nome\}/g, firstName);
          }

          const success = await sendWhatsApp(GREEN_API_INSTANCE_ID, GREEN_API_TOKEN, phone, message);

          if (success) {
            const updatedDetails = {
              ...(booking.booking_details || {}),
              day_before_reminder_sent: true,
              day_before_reminder_sent_at: now.toISOString(),
            };

            await supabase
              .from('bookings')
              .update({ booking_details: updatedDetails })
              .eq('id', booking.id);

            console.log(`Short rental extension offer sent for booking ${booking.id} (4h after pickup, ${category})`);
            sent++;
          } else {
            failed++;
          }
        } catch (err: any) {
          console.error(`Error processing short rental extension for booking ${booking.id}:`, err.message);
          failed++;
        }
      }
    } else {
      console.log('No short rentals eligible for 4h extension offer');
    }
  } catch (err: any) {
    console.error('Short rental extension error:', err.message);
  }

  // ──────────────────────────────────────────────
  // 3. DEPOSIT RETURN REMINDER (24 hours after rental ends)
  // Only for customers who left a deposit (cauzione)
  // Runs every 5 min → window is 24h ±5 min after dropoff
  // ──────────────────────────────────────────────
  try {
    const twentyFourHoursMinusFive = new Date(now.getTime() - (24 * 60 + 5) * 60 * 1000);
    const twentyFourHoursPlusFive = new Date(now.getTime() - (24 * 60 - 5) * 60 * 1000);

    // Fetch bookings that ended ~24h ago (±5 min precision)
    const { data: recentEndedBookings, error: depositError } = await supabase
      .from('bookings')
      .select('*')
      .gte('dropoff_date', twentyFourHoursMinusFive.toISOString())
      .lte('dropoff_date', twentyFourHoursPlusFive.toISOString())
      .in('status', ['confirmed', 'active', 'completed'])
      .is('service_type', null);

    if (depositError) {
      console.error('Error querying deposit bookings:', depositError);
    } else if (recentEndedBookings && recentEndedBookings.length > 0) {
      // Check cauzioni table for deposits not tracked on booking itself
      const bookingIds = recentEndedBookings.map(b => b.id);
      const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('riferimento_contratto_id, importo, stato')
        .in('riferimento_contratto_id', bookingIds)
        .in('stato', ['Attiva', 'In scadenza', 'Incassata']);
      const cauzioneMap = new Map(
        (cauzioni || []).map(c => [c.riferimento_contratto_id, c])
      );

      // Filter to only bookings that have a deposit
      const depositBookings = recentEndedBookings.filter(b => {
        const fromAmount = Number(b.deposit_amount ?? 0) > 0;
        const fromDetails = Number(b.booking_details?.deposit ?? 0) > 0;
        const fromCauzioni = cauzioneMap.has(b.id) && Number(cauzioneMap.get(b.id)!.importo) > 0;
        return fromAmount || fromDetails || fromCauzioni;
      });

      console.log(`Found ${depositBookings.length} deposit booking(s) eligible for IBAN reminder (from ${recentEndedBookings.length} ended bookings)`);

      for (const booking of depositBookings) {
        try {
          if (booking.booking_details?.deposit_reminder_sent) {
            console.log(`Skipping booking ${booking.id} — deposit reminder already sent`);
            continue;
          }

          const firstName = booking.booking_details?.customer?.firstName
            || booking.customer_name?.split(' ')[0]
            || 'Cliente';

          // Resolve phone: booking column → booking_details → customers_extended
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

          if (!phone) {
            console.log(`Skipping booking ${booking.id} (${booking.customer_name}) — no phone number`);
            continue;
          }

          const template = getTemplate('deposit_return_iban',
            `Salve {nome},\n\nLa ringraziamo per aver scelto i nostri servizi.\n\nAl fine di procedere con la restituzione della cauzione, Le chiediamo cortesemente di comunicarci il Suo IBAN completo e il nominativo dell'intestatario del conto.\n\nIl rimborso verrà effettuato tramite bonifico ordinario entro il quattordicesimo giorno lavorativo, come da condizioni contrattuali.\n\nCordiali saluti,\nDR7`);
          const message = template.replace(/\{nome\}/g, firstName);

          const success = await sendWhatsApp(GREEN_API_INSTANCE_ID, GREEN_API_TOKEN, phone, message);

          if (success) {
            const updatedDetails = {
              ...(booking.booking_details || {}),
              deposit_reminder_sent: true,
              deposit_reminder_sent_at: now.toISOString(),
            };

            await supabase
              .from('bookings')
              .update({ booking_details: updatedDetails })
              .eq('id', booking.id);

            console.log(`Deposit IBAN reminder sent for booking ${booking.id}`);
            sent++;
          } else {
            failed++;
          }
        } catch (err: any) {
          console.error(`Error processing deposit reminder for booking ${booking.id}:`, err.message);
          failed++;
        }
      }
    } else {
      console.log('No deposit bookings eligible for IBAN reminder');
    }
  } catch (err: any) {
    console.error('Deposit reminders error:', err.message);
  }

  console.log(`=== Booking Reminders Complete: ${sent} sent, ${failed} failed ===`);
  return { statusCode: 200, body: `Reminders sent: ${sent}, failed: ${failed}` };
};

// Run every 5 minutes for precise 1-hour-after-dropoff IBAN delivery
export const handler = schedule('*/5 * * * *', reminderHandler);
