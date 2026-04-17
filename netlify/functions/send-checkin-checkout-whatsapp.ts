import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { resolveKeyForContext } from "./utils/messageTemplates";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const supabaseUrl = process.env.VITE_SUPABASE_URL! || process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Sends WhatsApp check-in or check-out messages to customers
 * type: 'checkin' | 'checkout'
 * Includes cauzione (deposit) info from the cauzioni table
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error("[checkin-checkout] Green API not configured");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Green API not configured" }),
    };
  }

  const body = JSON.parse(event.body || "{}");
  const { bookings, type } = body;

  if (!bookings || !Array.isArray(bookings) || bookings.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "No bookings provided" }),
    };
  }

  if (type !== "checkin" && type !== "checkout") {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Type must be checkin or checkout" }),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch cauzioni for all bookings
  let cauzioniMap = new Map<string, any>();
  try {
    const bookingIds = bookings.map((b: any) => b.id);
    const { data: cauzioni } = await supabase
      .from("cauzioni")
      .select("importo, metodo, stato, riferimento_contratto_id")
      .in("riferimento_contratto_id", bookingIds);

    if (cauzioni) {
      cauzioni.forEach((c: any) => {
        cauzioniMap.set(c.riferimento_contratto_id, c);
      });
    }
  } catch (err) {
    console.error("[checkin-checkout] Failed to fetch cauzioni:", err);
  }
  // Route old keys → Pro keys. If nothing maps, we'll skip those sends below.
  const checkinResolved = await resolveKeyForContext('checkin_reminder');
  const checkoutResolved = await resolveKeyForContext('checkout_reminder');
  const keysToLoad = [checkinResolved, checkoutResolved].filter((k): k is string => !!k);

  const templateMap = new Map<string, string>();
  if (keysToLoad.length > 0) {
    const { data: sysTemplates } = await supabase
      .from('system_messages')
      .select('message_key, message_body, is_enabled')
      .in('message_key', keysToLoad)
      .eq('is_enabled', true);
    (sysTemplates || []).forEach((t: any) => {
      if (checkinResolved && t.message_key === checkinResolved) templateMap.set('checkin_reminder', t.message_body);
      if (checkoutResolved && t.message_key === checkoutResolved) templateMap.set('checkout_reminder', t.message_body);
    });
  }

  let successCount = 0;
  const errors: string[] = [];

  for (const booking of bookings) {
    const customerPhone =
      booking.customer_phone || booking.booking_details?.customer?.phone;
    if (!customerPhone) {
      errors.push(`${booking.id}: Nessun numero di telefono`);
      continue;
    }

    // Clean phone number for Green API
    let cleanPhone = customerPhone.replace(/[\s\-\+]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "39" + cleanPhone.substring(1);
    }
    if (!cleanPhone.startsWith("39") && cleanPhone.length === 10) {
      cleanPhone = "39" + cleanPhone;
    }

    const customerName =
      booking.customer_name ||
      booking.booking_details?.customer?.fullName ||
      "Cliente";
    const firstName = customerName.split(" ")[0];
    const vehicleName = booking.vehicle_name || "Veicolo";
    const targa =
      booking.vehicle_plate ||
      booking.booking_details?.vehicle?.targa ||
      "";

    // Build cauzione info
    const cauzione = cauzioniMap.get(booking.id);
    const depositOption = booking.booking_details?.depositOption;
    let cauzioneText = "";
    if (depositOption === "no_deposit") {
      cauzioneText = "Senza cauzione (supplemento 30% applicato)";
    } else if (cauzione) {
      const metodoLabels: Record<string, string> = {
        bonifico: "bonifico",
        carta: "carta",
        preautorizzazione: "pre-autorizzazione",
      };
      cauzioneText = `${Number(cauzione.importo).toFixed(2)} (${metodoLabels[cauzione.metodo] || cauzione.metodo})`;
    } else {
      const depositAmount =
        booking.deposit_amount || booking.booking_details?.deposit;
      if (depositAmount && Number(depositAmount) > 0) {
        cauzioneText = `${Number(depositAmount).toFixed(2)}`;
      }
    }

    // Resolve dates/times for variable substitution
    const pickupDate = new Date(booking.pickup_date);
    const dropoffDate = new Date(booking.dropoff_date);
    const pickupTime =
      booking.booking_details?.pickupTime ||
      pickupDate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Rome" });
    const returnTime =
      booking.booking_details?.returnTime ||
      dropoffDate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Rome" });
    const pickupLocation = booking.pickup_location || "Da definire";
    const dropoffLocation = booking.dropoff_location || booking.pickup_location || "Da definire";
    const pickupDateStr = pickupDate.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
    const dropoffDateStr = dropoffDate.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
    const totalPrice = booking.price_total ? (Number(booking.price_total) / 100).toFixed(2) : '0';

    // Variable map for template substitution
    const vars: Record<string, string> = {
      '{nome}': firstName,
      '{customer_name}': customerName,
      '{vehicle_name}': vehicleName,
      '{targa}': targa,
      '{pickup_date}': pickupDateStr,
      '{pickup_time}': pickupTime,
      '{dropoff_date}': dropoffDateStr,
      '{dropoff_time}': returnTime,
      '{pickup_location}': pickupLocation,
      '{dropoff_location}': dropoffLocation,
      '{deposit}': cauzioneText || 'N/A',
      '{total}': totalPrice,
    };

    const applyVars = (tpl: string) => {
      let result = tpl;
      for (const [key, val] of Object.entries(vars)) {
        result = result.split(key).join(val);
      }
      return result;
    };

    const templateKey = type === "checkin" ? "checkin_reminder" : "checkout_reminder";
    const dbTemplate = templateMap.get(templateKey);

    // Pro is the only source — if no DB template, skip this booking's send (no hardcoded fallback)
    if (!dbTemplate) {
      errors.push(`${booking.id}: nessun template Pro per "${templateKey}"`);
      continue;
    }
    const message = applyVars(dbTemplate);

    try {
      const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

      // Add wrapper from Messaggi di Sistema Pro — no hardcoded fallback.
      let wrappedMsg = message;
      try {
        const { data: wrappers } = await supabase
          .from('system_messages')
          .select('message_key, message_body, is_enabled')
          .in('message_key', ['pro_wrapper_header', 'pro_wrapper_footer']);
        const hdr = wrappers?.find((w: any) => w.message_key === 'pro_wrapper_header' && w.is_enabled !== false)?.message_body || '';
        const ftr = wrappers?.find((w: any) => w.message_key === 'pro_wrapper_footer' && w.is_enabled !== false)?.message_body || '';
        wrappedMsg = [hdr, message, ftr].filter(Boolean).join('\n\n');
      } catch { /* no wrapper if DB query fails */ }

      const response = await fetch(greenApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: `${cleanPhone}@c.us`,
          message: wrappedMsg,
        }),
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || "Green API error");
      }

      console.log(
        `[checkin-checkout] Sent ${type} to ${cleanPhone}:`,
        result.idMessage
      );

      // Log to sent_messages_log
      try {
        const fullMsg = message;
        await supabase.from('sent_messages_log').insert({
          customer_name: booking.customer_name || 'N/A',
          customer_phone: cleanPhone,
          message_text: fullMsg,
          template_label: type === 'checkin' ? 'Check-in Reminder' : 'Check-out Reminder',
          status: 'sent',
        });
      } catch (logErr) {
        console.error('Failed to log message:', logErr);
      }

      successCount++;

      // Rate limit: 1s between messages
      if (bookings.length > 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err: any) {
      console.error(`[checkin-checkout] Error for ${booking.id}:`, err);
      errors.push(`${booking.id}: ${err.message}`);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      sent: successCount,
      total: bookings.length,
      errors: errors.length > 0 ? errors : undefined,
    }),
  };
};

export { handler };
