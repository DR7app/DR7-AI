import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

function cleanPhone(phone: string): string | null {
  if (!phone) return null;
  let clean = phone.replace(/[\s\-\+\(\)]/g, '');
  if (clean.startsWith('00')) clean = clean.substring(2);
  if (clean.length === 10) clean = '39' + clean;
  return clean;
}

async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  const cleanNum = cleanPhone(phone);
  if (!cleanNum) return false;

  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${cleanNum}@c.us`, message }),
  });

  const responseBody = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(responseBody); } catch {}

  if (!response.ok) { console.error(`WhatsApp HTTP ${response.status} for ${cleanNum}:`, responseBody); return false; }
  if (parsed?.error) { console.error(`WhatsApp API error for ${cleanNum}:`, JSON.stringify(parsed)); return false; }
  if (!parsed?.idMessage) { console.error(`WhatsApp no idMessage for ${cleanNum}:`, responseBody); return false; }

  console.log(`WhatsApp sent to ${cleanNum}, idMessage: ${parsed.idMessage}`);
  return true;
}

function getRomeDateString(offsetDays: number): string {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(target);
}

export const handler: Handler = async () => {
  console.log('=== Manual Trigger: Booking Reminders ===');

  if (!supabaseUrl || !supabaseServiceKey || !GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    const msg = 'Missing env vars';
    console.error(msg);
    return { statusCode: 500, body: msg };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let sent = 0;
  let failed = 0;

  // Load message templates
  const messageTemplates: Record<string, string> = {};
  const { data: templates } = await supabase.from('system_messages').select('message_key, message_body');
  if (templates) templates.forEach((t: any) => { messageTemplates[t.message_key] = t.message_body; });

  const getTemplate = (key: string, fallback: string) => messageTemplates[key] || fallback;

  // Load vehicles
  const { data: allVehicles } = await supabase.from('vehicles').select('id, plate, category');
  const vehicleMap = new Map<string, string>();
  const plateMap = new Map<string, string>();
  if (allVehicles) {
    allVehicles.forEach((v: any) => {
      vehicleMap.set(v.id, v.category || 'urban');
      if (v.plate) plateMap.set(v.plate.replace(/\s/g, '').toUpperCase(), v.category || 'urban');
    });
  }

  function getVehicleCategory(booking: any): string {
    if (booking.vehicle_id && vehicleMap.has(booking.vehicle_id)) return vehicleMap.get(booking.vehicle_id)!;
    if (booking.vehicle_plate) {
      const np = booking.vehicle_plate.replace(/\s/g, '').toUpperCase();
      if (plateMap.has(np)) return plateMap.get(np)!;
    }
    return 'urban';
  }

  function buildExtensionMessage(category: string, firstName: string): string {
    if (category === 'exotic') {
      const t = getTemplate('supercar_day_before',
        `Salve,\n\nla contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nRestiamo in attesa di un suo cortese riscontro.\nGrazie.\n\nCordiali saluti,\nDR7`);
      return t.replace(/\{nome\}/g, firstName);
    } else {
      const t = getTemplate('utilitaria_day_before',
        `Salve {nome},\n\nLa contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nCordiali saluti,\nDR7`);
      return t.replace(/\{nome\}/g, firstName);
    }
  }

  async function resolvePhone(booking: any): Promise<string | null> {
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

  // Extension >24h — bookings ending TOMORROW
  const tomorrowRome = getRomeDateString(1);
  console.log(`[Extension >24h] Looking for bookings ending tomorrow: ${tomorrowRome}`);

  const { data: endingTomorrow, error: qErr } = await supabase
    .from('bookings')
    .select('*')
    .gte('dropoff_date', `${tomorrowRome}T00:00:00`)
    .lt('dropoff_date', `${tomorrowRome}T23:59:59`)
    .in('status', ['confirmed', 'active'])
    .is('service_type', null);

  if (qErr) {
    console.error('[Extension >24h] Query error:', qErr);
  } else if (endingTomorrow && endingTomorrow.length > 0) {
    console.log(`[Extension >24h] Found ${endingTomorrow.length} booking(s) ending tomorrow`);

    for (const booking of endingTomorrow) {
      try {
        if (booking.booking_details?.day_before_reminder_sent || booking.booking_details?.pre_rental_offer_sent) {
          console.log(`[Extension >24h] Skipping ${booking.id} — already sent`);
          continue;
        }

        if (booking.pickup_date && booking.dropoff_date) {
          const durationHours = (new Date(booking.dropoff_date).getTime() - new Date(booking.pickup_date).getTime()) / (1000 * 60 * 60);
          if (durationHours <= 24) {
            console.log(`[Extension >24h] Skipping ${booking.id} — short rental (${durationHours.toFixed(1)}h)`);
            continue;
          }
        }

        const phone = await resolvePhone(booking);
        if (!phone) { console.log(`[Extension >24h] Skipping ${booking.id} — no phone`); continue; }

        const firstName = booking.booking_details?.customer?.firstName || booking.customer_name?.split(' ')[0] || 'Cliente';
        const category = getVehicleCategory(booking);
        const message = buildExtensionMessage(category, firstName);

        console.log(`[Extension >24h] Sending to ${booking.id} (${category}), phone: ${phone}`);
        const success = await sendWhatsApp(phone, message);

        if (success) {
          await supabase.from('bookings').update({
            booking_details: {
              ...(booking.booking_details || {}),
              day_before_reminder_sent: true,
              day_before_reminder_sent_at: new Date().toISOString(),
              pre_rental_offer_sent: true,
            }
          }).eq('id', booking.id);
          console.log(`[Extension >24h] Sent for ${booking.id}`);
          sent++;

          // Log to sent_messages_log
          try {
            const fullMessage = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\n${message}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`;
            await supabase.from('sent_messages_log').insert({
              customer_name: firstName,
              customer_phone: phone,
              message_text: fullMessage,
              template_label: 'Booking Extension Offer (Triggered)',
              status: 'sent',
            });
          } catch (logErr) {
            console.error('Failed to log message:', logErr);
          }
        } else {
          console.error(`[Extension >24h] FAILED for ${booking.id}`);
          failed++;
        }

        await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        console.error(`[Extension >24h] Error for ${booking.id}:`, err.message);
        failed++;
      }
    }
  } else {
    console.log('[Extension >24h] No bookings ending tomorrow');
  }

  const result = `Manual trigger complete: ${sent} sent, ${failed} failed`;
  console.log(result);
  return { statusCode: 200, body: result };
};
