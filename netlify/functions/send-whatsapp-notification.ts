import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || "393457905205";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Sends WhatsApp notification using Green API.
 *
 * SOURCE OF TRUTH for every automated message is the `system_messages` table,
 * editable from Admin → Messaggi di Sistema.
 *
 * - If the matching template is DISABLED → message is NOT sent.
 * - If the matching template is MISSING → message is NOT sent.
 * - NO hardcoded message bodies exist in this function.
 *
 * The only exception is `customMessage` / `body.message` — those are free-text
 * messages explicitly provided by an admin (manual send UI). They are passed
 * through unchanged because the admin is typing them directly.
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const body = JSON.parse(event.body || '{}');
  const { booking, customPhone, skipHeader, templateKey, templateVars } = body;
  const customMessage: string | undefined = body.customMessage || body.message;

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('Green API not configured');
    return { statusCode: 500, body: JSON.stringify({ message: 'Green API not configured' }) };
  }

  // ── Phone normalization ──────────────────────────────────────────────
  let targetPhone = (customPhone || NOTIFICATION_PHONE).replace(/[\s\-\+\(\)]/g, '');
  if (targetPhone.startsWith('00')) targetPhone = targetPhone.substring(2);
  if (targetPhone.length === 10) targetPhone = '39' + targetPhone;

  const isCustomerMessage = !!customPhone;

  // ── Determine which template key applies ─────────────────────────────
  let messageKey: string = templateKey || '';
  if (!messageKey && booking) {
    const serviceType = booking.service_type;
    const isEdit = !!booking.isEdit;
    if (serviceType === 'car_wash') {
      messageKey = isEdit
        ? (isCustomerMessage ? 'carwash_modified_customer' : 'carwash_modified')
        : (isCustomerMessage ? 'carwash_new_customer' : 'carwash_new');
    } else if (serviceType === 'mechanical') {
      messageKey = isEdit
        ? (isCustomerMessage ? 'mechanical_modified_customer' : 'mechanical_modified')
        : (isCustomerMessage ? 'mechanical_new_customer' : 'mechanical_new');
    } else {
      messageKey = isEdit
        ? (isCustomerMessage ? 'rental_modified_customer' : 'rental_modified')
        : (isCustomerMessage ? 'rental_new_customer' : 'rental_new');
    }
  }

  // ── Build the message body ───────────────────────────────────────────
  let messageBody = '';
  let useHeader = !skipHeader;
  let templateLabelForLog = '';

  const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

  if (customMessage) {
    // Free-text admin message — passed through as-is (not "hardcoded", it's user-typed)
    messageBody = customMessage;
    templateLabelForLog = 'Messaggio Manuale';

    // Honor global header preference if set
    if (supabase) {
      try {
        const { data: g } = await supabase
          .from('system_messages')
          .select('include_header')
          .eq('message_key', 'global_header_footer')
          .maybeSingle();
        if (g && typeof (g as any).include_header === 'boolean') {
          useHeader = (g as any).include_header && !skipHeader;
        }
      } catch { /* ignore */ }
    }

    // Apply templateVars tokens if the caller provided them
    if (templateVars && typeof templateVars === 'object') {
      for (const [k, v] of Object.entries(templateVars)) {
        messageBody = messageBody.split(k).join(String(v ?? ''));
      }
    }
  } else if (messageKey && supabase) {
    // Load template from Messaggi di Sistema
    let { data: tpl } = await supabase
      .from('system_messages')
      .select('message_body, include_header, is_enabled, label')
      .eq('message_key', messageKey)
      .maybeSingle();

    // If a _customer variant is missing, fall back to the base admin variant
    if (!tpl && isCustomerMessage && messageKey.endsWith('_customer')) {
      const baseKey = messageKey.replace('_customer', '');
      const { data: baseTpl } = await supabase
        .from('system_messages')
        .select('message_body, include_header, is_enabled, label')
        .eq('message_key', baseKey)
        .maybeSingle();
      tpl = baseTpl;
    }

    // Template is explicitly disabled → do not send
    if (tpl && (tpl as any).is_enabled === false) {
      console.log(`[send-whatsapp] Template "${messageKey}" is disabled — skipping send`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          skipped: true,
          reason: 'template_disabled',
          message: `Template "${messageKey}" is disabled in Messaggi di Sistema`,
        }),
      };
    }

    // Template is missing → do not send (no hardcoded fallback)
    if (!tpl || !(tpl as any).message_body) {
      console.log(`[send-whatsapp] Template "${messageKey}" not found in Messaggi di Sistema — skipping send`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          skipped: true,
          reason: 'template_missing',
          message: `Template "${messageKey}" not found in Messaggi di Sistema — create it there to enable this notification`,
        }),
      };
    }

    messageBody = (tpl as any).message_body;
    useHeader = (tpl as any).include_header !== false && !skipHeader;
    templateLabelForLog = (tpl as any).label || messageKey;

    // Build variable map from booking (if provided)
    const vars: Record<string, string> = {};

    if (booking) {
      const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
      const amountPaid = Number(booking.booking_details?.amountPaid || 0);
      const totalCents = Number(booking.price_total || 0);
      const amountPaidEuros = (amountPaid / 100).toFixed(2);
      const amountRemainingEuros = ((totalCents - amountPaid) / 100).toFixed(2);
      const totalPrice = (totalCents / 100).toFixed(2);
      const paymentMethod = booking.payment_method || booking.booking_details?.paymentMethod || '';
      const isNexiPayByLink = (booking.payment_method || '').includes('Nexi Pay by Link');

      let paymentInfo = '';
      if (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded') {
        paymentInfo = 'Pagato';
      } else if (isNexiPayByLink) {
        paymentInfo = 'In attesa di pagamento (Nexi Pay by Link) - se non pagato entro 1 ora, la prenotazione verrà annullata';
      } else if (amountPaid > 0) {
        paymentInfo = `${amountPaidEuros}€ pagati - ${amountRemainingEuros}€ da pagare`;
      } else {
        paymentInfo = 'Da saldare';
      }

      // Insurance display name map
      const insuranceRaw = booking.insurance_option || booking.booking_details?.insuranceOption || '';
      const insuranceMap: Record<string, string> = {
        RCA: 'Kasko',
        KASKO_BASE: 'Kasko',
        KASKO: 'Kasko',
        KASKO_BLACK: 'Kasko Black',
        KASKO_SIGNATURE: 'Kasko Signature',
        DR7: 'Kasko DR7',
      };
      const insuranceOption = insuranceMap[insuranceRaw] || insuranceRaw || '';

      // Cauzione
      const depAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0);
      const depOption = booking.booking_details?.depositOption;
      const depStatus = booking.booking_details?.deposit_status;
      let depositLabel = '€0';
      if (depOption === 'no_deposit') {
        const surcharge = Number(booking.booking_details?.noDepositSurcharge ?? 0);
        depositLabel = `Senza cauzione (+30% = €${surcharge.toFixed(2)})`;
      } else if (depAmount > 0) {
        const statusLbl = depStatus === 'incassata' ? 'Pagata' : 'Da saldare';
        depositLabel = `€${depAmount.toFixed(2)} - ${statusLbl}`;
      }

      // KM
      const tplUnlimitedKm = booking.booking_details?.unlimited_km;
      const tplKmLimit = booking.booking_details?.km_limit;
      let kmInfo = 'Illimitati';
      if (tplUnlimitedKm === true || tplKmLimit === 'Illimitati' || Number(tplKmLimit) >= 9999) {
        kmInfo = 'Illimitati';
      } else if (tplKmLimit && tplKmLimit !== '0') {
        const isNum = !isNaN(Number(tplKmLimit)) && !String(tplKmLimit).toLowerCase().includes('km');
        kmInfo = isNum ? `${tplKmLimit} Km` : String(tplKmLimit);
      } else if (booking.booking_details?.total_km) {
        kmInfo = `${booking.booking_details.total_km} Km`;
      }

      // Flex membership flag (Prime Flex for carwash, DR7 Flex for rental)
      const primeFlex = booking.booking_details?.prime_flex === true || booking.booking_details?.prime_flex === 'true';
      const dr7Flex = booking.booking_details?.dr7_flex === true || booking.booking_details?.dr7_flex === 'true';
      let flexLabel = '';
      if (primeFlex) flexLabel = 'Prime Flex';
      else if (dr7Flex) flexLabel = 'DR7 Flex';

      Object.assign(vars, {
        nome: customerName.split(' ')[0],
        customer_name: customerName,
        customer_email: booking.customer_email || booking.booking_details?.customer?.email || '',
        customer_phone: booking.customer_phone || booking.booking_details?.customer?.phone || '',
        booking_id: `DR7-${String(booking.id).substring(0, 8).toUpperCase()}`,
        total: totalPrice,
        vehicle_name: booking.vehicle_name || '',
        plate: booking.vehicle_plate || booking.booking_details?.vehicle?.plate || booking.booking_details?.vehicle?.targa || '',
        pickup_location: booking.pickup_location || '',
        insurance: insuranceOption,
        payment_status: paymentInfo, // Use the friendly label (Pagato, Da saldare, etc.) instead of raw status
        payment_method: paymentMethod,
        payment_info: paymentInfo,
        service_name: booking.service_name || booking.booking_details?.serviceName || booking.booking_details?.service_name || '',
        notes: booking.booking_details?.notes || '',
        deposit: depositLabel,
        km_info: kmInfo,
        flex: flexLabel,
      });

      // Dates
      if (booking.pickup_date) {
        const pd = new Date(booking.pickup_date);
        vars.pickup_date = pd.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
        vars.pickup_time = pd.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
      }
      if (booking.dropoff_date) {
        const dd = new Date(booking.dropoff_date);
        vars.dropoff_date = dd.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
        vars.dropoff_time = dd.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
      }
      if (booking.appointment_date) {
        const ad = new Date(booking.appointment_date);
        vars.date = ad.toLocaleDateString('it-IT', {
          weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome',
        });
        vars.time = ad.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
      }
    }

    // Caller-supplied overrides win
    if (templateVars && typeof templateVars === 'object') {
      for (const [k, v] of Object.entries(templateVars)) {
        vars[k] = String(v ?? '');
      }
    }

    // Substitute {variable} placeholders
    for (const [k, v] of Object.entries(vars)) {
      messageBody = messageBody.replace(new RegExp(`\\{${k}\\}`, 'g'), v ?? '');
      // Also support raw token substitution (legacy)
      messageBody = messageBody.split(k).join(v ?? '');
    }
  } else {
    // customMessage is null/empty AND no messageKey AND no booking → caller likely tried
    // to render a template that doesn't exist / is disabled. Skip silently instead of
    // erroring, since there's nothing to send (and we NEVER substitute a hardcoded fallback).
    console.log('[send-whatsapp] No message source (template missing/disabled or no data) — skipping send');
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        skipped: true,
        reason: 'no_message_source',
        message: 'No templateKey, customMessage, or booking provided (or template missing/disabled)',
      }),
    };
  }

  // ── Wrap with header / footer from DB (no hardcoded defaults) ────────
  let finalMessage = messageBody;
  if (useHeader && supabase) {
    try {
      const { data: wrappers } = await supabase
        .from('system_messages')
        .select('message_key, message_body, is_enabled')
        .in('message_key', ['message_wrapper_header', 'message_wrapper_footer']);
      const headerTpl = wrappers?.find((w: any) => w.message_key === 'message_wrapper_header' && w.is_enabled !== false);
      const footerTpl = wrappers?.find((w: any) => w.message_key === 'message_wrapper_footer' && w.is_enabled !== false);
      if (headerTpl?.message_body) finalMessage = headerTpl.message_body + '\n\n' + finalMessage;
      if (footerTpl?.message_body) finalMessage = finalMessage + '\n\n' + footerTpl.message_body;
    } catch {
      // Wrapper lookup failed — send body without wrapper (no hardcoded fallback)
    }
  }

  // ── Send via Green API ───────────────────────────────────────────────
  try {
    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
    const response = await fetch(greenApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${targetPhone}@c.us`, message: finalMessage }),
    });

    const result = await response.json();
    if (!response.ok || result.error) {
      console.error('Green API error:', result);
      throw new Error(result.error || 'Green API error');
    }
    console.log('✅ WhatsApp sent via Green API:', result.idMessage);

    // Log (fire and forget)
    if (supabase) {
      const customerName = booking?.customer_name || booking?.booking_details?.customer?.fullName || body.customerName || 'N/A';
      const templateLabel = body.type || templateLabelForLog || booking?.service_type || 'Notifica';
      supabase.from('sent_messages_log')
        .insert({
          customer_name: customerName,
          customer_phone: targetPhone,
          message_text: finalMessage,
          template_label: templateLabel,
          status: 'sent',
        })
        .then(() => {})
        .catch((e: unknown) => console.error('Log failed:', e));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'WhatsApp sent', success: true, messageId: result.idMessage }),
    };
  } catch (error: any) {
    console.error('Error sending WhatsApp:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error sending WhatsApp', error: error.message }),
    };
  }
};

export { handler };
