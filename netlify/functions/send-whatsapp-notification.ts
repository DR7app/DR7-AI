import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { getMessageTemplate, resolveKeyForContext } from './utils/messageTemplates';

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || "393457905205";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Sends WhatsApp notification using Green API
 * Used for admin panel notifications
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  const body = JSON.parse(event.body || '{}');
  const { booking, type, customPhone, skipHeader, templateKey, templateVars } = body;
  // Accept both 'message' and 'customMessage' for flexibility
  const customMessage = body.customMessage || body.message;

  // Check if Green API is configured
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('Green API not configured. Set GREEN_API_INSTANCE_ID and GREEN_API_TOKEN in environment variables.');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Green API not configured' }),
    };
  }

  let message = '';
  let targetPhone = customPhone || NOTIFICATION_PHONE;

  // Template key support: load template from system_messages and apply variables
  if (templateKey && !customMessage) {
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: tpl } = await sb
        .from('system_messages')
        .select('message_body, include_header, is_enabled')
        .eq('message_key', templateKey)
        .maybeSingle();

      // If template explicitly disabled → don't send
      if (tpl && tpl.is_enabled === false) {
        console.log(`[send-whatsapp] Template "${templateKey}" is disabled — skipping send`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Template "${templateKey}" is disabled — notification skipped`,
            success: true,
            skipped: true,
            reason: 'template_disabled'
          }),
        };
      }

      if (tpl?.message_body) {
        let rendered = tpl.message_body;
        if (templateVars && typeof templateVars === 'object') {
          for (const [key, val] of Object.entries(templateVars)) {
            rendered = rendered.split(key).join(String(val));
          }
        }
        if (tpl.include_header && !skipHeader) {
          const HEADER = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora, Tecnologia Proprietaria DR7_\n\n`;
          const FOOTER = `\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`;
          rendered = HEADER + rendered + FOOTER;
        }
        message = rendered;
      }
    } catch (e) {
      console.warn('[send-whatsapp] Template key lookup failed:', e);
    }
  }

  // Clean phone number - Green API format: 393457905205 (no + or spaces)
  targetPhone = targetPhone.replace(/[\s\-\+\(\)]/g, '');
  // Handle 00 international prefix (e.g., 00393921900763)
  if (targetPhone.startsWith('00')) {
    targetPhone = targetPhone.substring(2);
  }
  // 10-digit local Italian number → always prepend country code 39
  // (covers numbers starting with 39X like 392, 393, 394 mobile prefixes)
  if (targetPhone.length === 10) {
    targetPhone = '39' + targetPhone;
  }

  // Handle custom message (from admin lottery ticket sales, birthdays, etc.)
  if (message) {
    // Already set from templateKey — skip other branches
  } else if (customMessage) {
    message = customMessage;
  }
  // Handle booking notifications
  else if (booking) {
    const serviceType = booking.service_type;
    const isCustomerMessage = !!customPhone;
    const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
    const customerEmail = booking.customer_email || booking.booking_details?.customer?.email;
    const customerPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
    const bookingId = booking.id.substring(0, 8).toUpperCase();
    const totalPrice = (booking.price_total / 100).toFixed(2);

    if (serviceType === 'car_wash') {
      const appointmentDate = new Date(booking.appointment_date);
      // Get service name from multiple possible sources
      const serviceName = booking.service_name ||
        booking.booking_details?.serviceName ||
        booking.booking_details?.service_name ||
        'Lavaggio';
      const additionalService = booking.booking_details?.additionalService;
      const notes = booking.booking_details?.notes;

      const formattedDate = appointmentDate.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Rome'
      });
      const formattedTime = appointmentDate.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Rome'
      });

      // Calculate payment info
      const amountPaid = booking.booking_details?.amountPaid || 0;
      const totalCents = booking.price_total || 0;
      const amountPaidEuros = (amountPaid / 100).toFixed(2);
      const amountRemainingEuros = ((totalCents - amountPaid) / 100).toFixed(2);

      let paymentInfo = '';
      if (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded') {
        paymentInfo = `Pagato`;
      } else if (amountPaid > 0) {
        paymentInfo = `${amountPaidEuros}€ pagati - ${amountRemainingEuros}€ da pagare`;
      } else {
        paymentInfo = `Da saldare`;
      }

      const isEditCarWash = booking.isEdit;
      const firstName = customerName.split(' ')[0];
      const vehiclePlate = booking.vehicle_plate || booking.booking_details?.vehicle?.targa || booking.booking_details?.vehicle?.plate || '';

      message = `Salve ${firstName},\n\n`;
      message += `Confermiamo il suo appuntamento.\n\n`;
      message += isEditCarWash ? `*MODIFICA PRENOTAZIONE AUTOLAVAGGIO*\n\n` : `*NUOVA PRENOTAZIONE AUTOLAVAGGIO*\n\n`;
      message += `*ID:* DR7-${bookingId}\n`;
      message += `*Servizio:* ${serviceName}\n`;
      if (vehiclePlate) {
        message += `*Targa:* ${vehiclePlate}\n`;
      }
      message += `*Data e Ora:* ${formattedDate} alle ${formattedTime}\n`;
      if (additionalService) {
        message += `*Servizio Aggiuntivo:* ${additionalService}\n`;
      }
      const paymentMethod = booking.payment_method || booking.booking_details?.paymentMethod || '';
      message += `*Totale:* €${totalPrice}\n`;
      message += `*Pagamento:* ${paymentInfo}${paymentMethod ? ` (${paymentMethod})` : ''}\n`;
      if (notes) {
        message += `*Note:* ${notes}\n`;
      }
      message += `\nCordiali Saluti,\nDR7`;
    } else if (serviceType === 'mechanical') {
      const appointmentDate = new Date(booking.appointment_date);
      const serviceName = booking.service_name || 'Servizio Meccanica';
      const vehicleInfo = booking.booking_details?.vehicle || {};
      const notes = booking.booking_details?.notes;

      const formattedDate = appointmentDate.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Rome'
      });
      const formattedTime = appointmentDate.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Rome'
      });

      // Calculate payment info
      const amountPaid = booking.booking_details?.amountPaid || 0;
      const totalCents = booking.price_total || 0;
      const amountPaidEuros = (amountPaid / 100).toFixed(2);
      const amountRemainingEuros = ((totalCents - amountPaid) / 100).toFixed(2);

      let paymentInfo = '';
      if (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded') {
        paymentInfo = `Pagato`;
      } else if (amountPaid > 0) {
        paymentInfo = `${amountPaidEuros}€ pagati - ${amountRemainingEuros}€ da pagare`;
      } else {
        paymentInfo = `Da saldare`;
      }

      const firstName = customerName.split(' ')[0];
      const isEditMech = booking.isEdit;
      message = `Salve ${firstName},\n\n`;
      message += `Confermiamo il suo appuntamento.\n\n`;
      message += isEditMech ? `*MODIFICA PRENOTAZIONE MECCANICA*\n\n` : `*NUOVA PRENOTAZIONE MECCANICA*\n\n`;
      message += `*ID:* DR7-${bookingId}\n`;
      message += `*Servizio:* ${serviceName}\n`;
      message += `*Data e Ora:* ${formattedDate} alle ${formattedTime}\n`;
      const paymentMethod = booking.payment_method || booking.booking_details?.paymentMethod || '';
      message += `*Totale:* €${totalPrice}\n`;
      message += `*Pagamento:* ${paymentInfo}${paymentMethod ? ` (${paymentMethod})` : ''}\n`;
      if (notes) {
        message += `*Note:* ${notes}\n`;
      }
      message += `\nCordiali Saluti,\nDR7`;
    } else {
      // Car Rental Booking
      const vehicleName = booking.vehicle_name;
      const pickupDate = new Date(booking.pickup_date);
      const dropoffDate = new Date(booking.dropoff_date);
      const pickupLocation = booking.pickup_location;
      // Map insurance option to display name - default to Kasko instead of Nessuna
      const insuranceRaw = booking.insurance_option || booking.booking_details?.insuranceOption || 'KASKO_BASE';
      const insuranceMap: Record<string, string> = {
        'RCA': 'Kasko',
        'KASKO_BASE': 'Kasko',
        'KASKO': 'Kasko',
        'KASKO_BLACK': 'Kasko Black',
        'KASKO_SIGNATURE': 'Kasko Signature',
        'DR7': 'Kasko DR7'
      };
      const insuranceOption = insuranceMap[insuranceRaw] || 'Kasko';

      const pickupDateFormatted = pickupDate.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
      const pickupTimeFormatted = pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
      const dropoffDateFormatted = dropoffDate.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
      const dropoffTimeFormatted = dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });

      // Calculate payment info
      const amountPaid = booking.booking_details?.amountPaid || 0;
      const totalCents = booking.price_total || 0;
      const amountPaidEuros = (amountPaid / 100).toFixed(2);
      const amountRemainingEuros = ((totalCents - amountPaid) / 100).toFixed(2);

      const isNexiPayByLink = (booking.payment_method || '').includes('Nexi Pay by Link');
      let paymentInfo = '';
      if (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded') {
        paymentInfo = `Pagato`;
      } else if (isNexiPayByLink) {
        paymentInfo = `In attesa di pagamento (Nexi Pay by Link) - se non pagato entro 1 ora, la prenotazione verrà annullata`;
      } else if (amountPaid > 0) {
        paymentInfo = `${amountPaidEuros}€ pagati - ${amountRemainingEuros}€ da pagare`;
      } else {
        paymentInfo = `Da saldare`;
      }

      const isEdit = booking.isEdit;
      const headerLabel = isNexiPayByLink ? `*PRENOTAZIONE IN ATTESA DI PAGAMENTO*` : (isEdit ? `*MODIFICA PRENOTAZIONE NOLEGGIO*` : `*NUOVA PRENOTAZIONE NOLEGGIO*`);
      message = `${headerLabel}\n\n`;
      message += `*ID:* DR7-${bookingId}\n`;
      message += `*Cliente:* ${customerName}\n`;
      message += `*Email:* ${customerEmail}\n`;
      message += `*Telefono:* ${customerPhone}\n`;
      const vehiclePlate = booking.vehicle_plate || booking.booking_details?.vehicle?.plate || '';
      message += `*Veicolo:* ${vehicleName}${vehiclePlate ? ` (${vehiclePlate})` : ''}\n`;
      message += `*Ritiro:* ${pickupDateFormatted} alle ${pickupTimeFormatted}\n`;
      message += `*Riconsegna:* ${dropoffDateFormatted} alle ${dropoffTimeFormatted}\n`;

      // Show delivery address if enabled, otherwise show standard pickup location
      const deliveryEnabled = booking.booking_details?.delivery_enabled;
      const deliveryAddress = booking.booking_details?.delivery_address;
      const pickupEnabled = booking.booking_details?.pickup_enabled;
      const pickupAddress = booking.booking_details?.pickup_address;

      if (deliveryEnabled && deliveryAddress) {
        const addr = [deliveryAddress.street, deliveryAddress.zip, deliveryAddress.city, deliveryAddress.province].filter(Boolean).join(', ');
        const deliveryFee = booking.booking_details?.delivery_fee || '0';
        message += `*Consegna a domicilio:* ${addr}`;
        if (parseFloat(deliveryFee) > 0) message += ` (+€${deliveryFee})`;
        message += `\n`;
      } else {
        message += `*Luogo Ritiro:* ${pickupLocation}\n`;
      }

      if (pickupEnabled && pickupAddress) {
        const addr = [pickupAddress.street, pickupAddress.zip, pickupAddress.city, pickupAddress.province].filter(Boolean).join(', ');
        const pickupFee = booking.booking_details?.pickup_fee || '0';
        message += `*Ritiro a domicilio:* ${addr}`;
        if (parseFloat(pickupFee) > 0) message += ` (+€${pickupFee})`;
        message += `\n`;
      }

      message += `*Assicurazione:* ${insuranceOption}\n`;
      message += `*Totale:* €${totalPrice}\n`;

      // Cauzione (deposit) info with status — always show, default to €0
      const depositAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0);
      const depositOption = booking.booking_details?.depositOption;
      const depositStatus = booking.booking_details?.deposit_status;
      if (depositOption === 'no_deposit') {
        const surcharge = Number(booking.booking_details?.noDepositSurcharge ?? 0);
        message += `*Cauzione:* Senza cauzione (+30% = €${surcharge.toFixed(2)})\n`;
      } else if (depositAmount > 0) {
        const statusLabel = depositStatus === 'incassata' ? 'Pagata' : 'Da saldare';
        message += `*Cauzione:* €${depositAmount.toFixed(2)} - ${statusLabel}\n`;
      } else {
        message += `*Cauzione:* €0\n`;
      }

      // KM limit info
      const unlimitedKm = booking.booking_details?.unlimited_km;
      const kmLimit = booking.booking_details?.km_limit;
      if (unlimitedKm || kmLimit === 'Illimitati') {
        message += `*KM:* Illimitati\n`;
      } else if (kmLimit && kmLimit !== '0') {
        message += `*KM:* ${kmLimit} km\n`;
      }

      const paymentMethod = booking.payment_method || booking.booking_details?.paymentMethod || '';
      // Don't append payment method again if already included in paymentInfo (e.g. Nexi Pay by Link)
      message += `*Pagamento:* ${paymentInfo}${!isNexiPayByLink && paymentMethod ? ` (${paymentMethod})` : ''}`;
    }
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'No valid data provided for notification' }),
    };
  }

  // ── Try to load edited template from DB ──
  // Determine the message key based on booking type
  // When customPhone is set, this is a CUSTOMER message — use _customer variant if available
  const isCustomerMessage = !!customPhone;
  let messageKey = '';
  if (booking) {
    const serviceType = booking.service_type;
    const isEdit = booking.isEdit;
    if (serviceType === 'car_wash') {
      messageKey = isEdit ? 'carwash_modified' : (isCustomerMessage ? 'carwash_new_customer' : 'carwash_new');
    } else if (serviceType === 'mechanical') {
      messageKey = isEdit ? 'mechanical_modified' : (isCustomerMessage ? 'mechanical_new_customer' : 'mechanical_new');
    } else {
      messageKey = isEdit ? 'rental_modified' : (isCustomerMessage ? 'rental_new_customer' : 'rental_new');
    }
  }

  // If a template exists in DB, use it (admin may have edited it)
  let finalMessage = message;
  let useHeader = !skipHeader; // Default: use header unless skipHeader passed

  // For custom messages (no template), check global header setting
  if (!messageKey && customMessage) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: globalSetting } = await supabase
        .from('system_messages')
        .select('include_header')
        .eq('message_key', 'global_header_footer')
        .single();
      if (globalSetting) {
        useHeader = globalSetting.include_header !== false && !skipHeader;
      }
    } catch { /* use default */ }
  }

  if (messageKey) {
    try {
      // Pro-template A/B gate: if booking is on the test vehicle (plate TEST002)
      // AND a pro_* mapping exists + is enabled, swap to the Pro key.
      const plateForGate = booking?.vehicle_plate || booking?.booking_details?.vehicle?.plate
      messageKey = await resolveKeyForContext(messageKey, { vehiclePlate: plateForGate });

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      let { data: tpl } = await supabase
        .from('system_messages')
        .select('message_body, include_header, is_enabled')
        .eq('message_key', messageKey)
        .maybeSingle();

      // Fallback: if _customer variant not found, try base key
      if (!tpl && isCustomerMessage && messageKey.endsWith('_customer')) {
        const baseKey = messageKey.replace('_customer', '');
        const { data: baseTpl } = await supabase
          .from('system_messages')
          .select('message_body, include_header, is_enabled')
          .eq('message_key', baseKey)
          .maybeSingle();
        tpl = baseTpl;
      }

      // If template exists and is explicitly disabled → DO NOT SEND
      if (tpl && tpl.is_enabled === false) {
        console.log(`[send-whatsapp] Template "${messageKey}" is disabled in Messaggi di Sistema — skipping send`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Template "${messageKey}" is disabled — notification skipped`,
            success: true,
            skipped: true,
            reason: 'template_disabled'
          }),
        };
      }

      if (tpl && tpl.message_body) {
        // Use the DB template — it's the source of truth
        finalMessage = tpl.message_body;
        useHeader = tpl.include_header !== false;

        // Substitute all known variables
        const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
        const vars: Record<string, string> = {
          nome: customerName.split(' ')[0],
          customer_name: customerName,
          customer_email: booking.customer_email || booking.booking_details?.customer?.email || '',
          customer_phone: booking.customer_phone || booking.booking_details?.customer?.phone || '',
          booking_id: booking.id.substring(0, 8).toUpperCase(),
          total: (booking.price_total / 100).toFixed(2),
          vehicle_name: booking.vehicle_name || '',
          plate: booking.vehicle_plate || booking.booking_details?.vehicle?.plate || '',
          pickup_location: booking.pickup_location || '',
          insurance: booking.insurance_option || '',
          payment_status: (() => {
            const ps = booking.payment_status;
            if (ps === 'paid' || ps === 'succeeded' || ps === 'completed') return 'Pagato';
            if (ps === 'pending' || ps === 'unpaid') return 'Da saldare';
            return ps || 'Da saldare';
          })(),
          service_name: booking.service_name || booking.booking_details?.serviceName || booking.booking_details?.service_name || '',
          notes: booking.booking_details?.notes || '',
        };

        // Format dates if available
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
          vars.date = ad.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
          vars.time = ad.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
        }

        // Cauzione (deposit) for template
        const depAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0);
        const depOption = booking.booking_details?.depositOption;
        const depStatus = booking.booking_details?.deposit_status;
        if (depOption === 'no_deposit') {
          const surcharge = Number(booking.booking_details?.noDepositSurcharge ?? 0);
          vars.deposit = `Senza cauzione (+30% = €${surcharge.toFixed(2)})`;
        } else if (depAmount > 0) {
          const statusLbl = depStatus === 'incassata' ? 'Pagata' : 'Da saldare';
          vars.deposit = `€${depAmount.toFixed(2)} - ${statusLbl}`;
        } else {
          vars.deposit = '€0';
        }

        // KM info for template — same logic as contract
        const tplUnlimitedKm = booking.booking_details?.unlimited_km;
        const tplKmLimit = booking.booking_details?.km_limit;
        if (tplUnlimitedKm === true || tplKmLimit === 'Illimitati' || Number(tplKmLimit) >= 9999) {
          vars.km_info = 'Illimitati';
        } else if (tplKmLimit && tplKmLimit !== '0') {
          const isNum = !isNaN(Number(tplKmLimit)) && !String(tplKmLimit).toLowerCase().includes('km');
          vars.km_info = isNum ? `${tplKmLimit} Km` : String(tplKmLimit);
        } else {
          vars.km_info = booking.booking_details?.total_km ? `${booking.booking_details.total_km} Km` : 'Illimitati';
        }

        // Replace all {variable} placeholders
        for (const [k, v] of Object.entries(vars)) {
          finalMessage = finalMessage.replace(new RegExp(`\\{${k}\\}`, 'g'), v || '');
        }
      }
    } catch {
      // Fallback to hardcoded message
    }
  }

  // Add wrapper from DB (or fallback)
  let wrappedMessage = finalMessage;
  if (useHeader) {
    try {
      const supabaseWrap = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: wrappers } = await supabaseWrap
        .from('system_messages')
        .select('message_key, message_body')
        .in('message_key', ['message_wrapper_header', 'message_wrapper_footer']);
      const headerTpl = wrappers?.find((w: any) => w.message_key === 'message_wrapper_header');
      const footerTpl = wrappers?.find((w: any) => w.message_key === 'message_wrapper_footer');
      const header = headerTpl?.message_body || '*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora, Tecnologia Proprietaria DR7_';
      const footer = footerTpl?.message_body || '_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._';
      wrappedMessage = header + '\n\n' + finalMessage + '\n\n' + footer;
    } catch {
      const defaultHeader = '*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora, Tecnologia Proprietaria DR7_';
      const defaultFooter = '_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._';
      wrappedMessage = defaultHeader + '\n\n' + finalMessage + '\n\n' + defaultFooter;
    }
  }

  try {
    // Send via Green API
    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    const response = await fetch(greenApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId: `${targetPhone}@c.us`,
        message: finalMessage,
      }),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error('Green API error:', result);
      throw new Error(result.error || 'Green API error');
    }

    console.log('✅ WhatsApp notification sent via Green API:', result.idMessage);

    // Log to sent_messages_log — fire and forget, never blocks the response
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const fullMessage = wrappedMessage;
      const customerName = booking?.customer_name || booking?.booking_details?.customer?.fullName || body.customerName || 'N/A';
      const templateLabel = body.type || (customMessage ? 'Messaggio Manuale' : booking?.service_type || 'Notifica');
      createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        .from('sent_messages_log')
        .insert({ customer_name: customerName, customer_phone: targetPhone, message_text: fullMessage, template_label: templateLabel, status: 'sent' })
        .then(() => {})
        .catch((e: unknown) => console.error('Log failed:', e));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'WhatsApp notification sent via Green API',
        success: true,
        messageId: result.idMessage
      }),
    };
  } catch (error: any) {
    console.error('Error sending WhatsApp notification:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error sending WhatsApp notification', error: error.message }),
    };
  }
};

export { handler };
