import type { Handler } from "@netlify/functions";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || "393457905205";

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
  const { booking, ticket, type, ticketNumbers, customerInfo, customPhone } = body;
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

  // Clean phone number - Green API format: 393457905205 (no + or spaces)
  targetPhone = targetPhone.replace(/[\s\-\+]/g, '');
  if (targetPhone.startsWith('0')) {
    targetPhone = '39' + targetPhone.substring(1);
  }
  if (!targetPhone.startsWith('39') && targetPhone.length === 10) {
    targetPhone = '39' + targetPhone;
  }

  // Handle custom message (from admin lottery ticket sales, birthdays, etc.)
  if (customMessage) {
    message = customMessage;
  }
  // Handle lottery ticket notifications
  else if (type === 'lottery_ticket' && ticketNumbers && customerInfo) {
    const ticketList = ticketNumbers.map((n: number) => `#${String(n).padStart(4, '0')}`).join(', ');
    message = `🎰 *NUOVA VENDITA BIGLIETTO LOTTERIA!*\n\n`;
    message += `*Biglietto${ticketNumbers.length > 1 ? 'i' : ''}:* ${ticketList}\n`;
    message += `*Cliente:* ${customerInfo.fullName}\n`;
    message += `*Email:* ${customerInfo.email}\n`;
    message += `*Telefono:* ${customerInfo.phone}\n`;
    message += `*Tipo:* Vendita Manuale (Admin)\n`;
    message += `*Data:* ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`;
  }
  // Handle ticket purchase notifications (from website)
  else if (ticket || type === 'ticket') {
    const ticketData = ticket || {};
    const customerName = ticketData.customer_name || ticketData.name || 'Cliente';
    const customerEmail = ticketData.customer_email || ticketData.email;
    const ticketQuantity = ticketData.quantity || 1;
    const totalPrice = ticketData.total_price ? (ticketData.total_price / 100).toFixed(2) : 'N/A';
    const ticketNumbersList = ticketData.ticket_numbers || [];

    message = `🎟️ *NUOVA VENDITA BIGLIETTI*\n\n`;
    message += `*Cliente:* ${customerName}\n`;
    message += `*Email:* ${customerEmail}\n`;
    message += `*Quantità:* ${ticketQuantity} bigliett${ticketQuantity > 1 ? 'i' : 'o'}\n`;
    message += `*Totale:* €${totalPrice}\n`;
    if (ticketNumbersList.length > 0) {
      message += `*Numeri:* ${ticketNumbersList.join(', ')}\n`;
    }
    message += `*Data:* ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })}`;
  }
  // Handle booking notifications
  else if (booking) {
    const serviceType = booking.service_type;
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
        paymentInfo = `NON pagato`;
      }

      message = `*NUOVA PRENOTAZIONE AUTOLAVAGGIO*\n\n`;
      message += `*ID:* DR7-${bookingId}\n`;
      message += `*Cliente:* ${customerName}\n`;
      message += `*Email:* ${customerEmail}\n`;
      message += `*Telefono:* ${customerPhone}\n`;
      message += `*Servizio:* ${serviceName}\n`;
      message += `*Data e Ora:* ${formattedDate} alle ${formattedTime}\n`;
      if (additionalService) {
        message += `*Servizio Aggiuntivo:* ${additionalService}\n`;
      }
      if (notes) {
        message += `*Note:* ${notes}\n`;
      }
      message += `*Totale:* €${totalPrice}\n`;
      message += `*Pagamento:* ${paymentInfo}`;
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
        paymentInfo = `NON pagato`;
      }

      message = `*NUOVA PRENOTAZIONE MECCANICA*\n\n`;
      message += `*ID:* DR7-${bookingId}\n`;
      message += `*Cliente:* ${customerName}\n`;
      message += `*Email:* ${customerEmail}\n`;
      message += `*Telefono:* ${customerPhone}\n`;
      message += `*Servizio:* ${serviceName}\n`;
      if (vehicleInfo.brand || vehicleInfo.model) {
        message += `*Veicolo:* ${vehicleInfo.brand || ''} ${vehicleInfo.model || ''}\n`;
      }
      message += `*Data e Ora:* ${formattedDate} alle ${formattedTime}\n`;
      if (notes) {
        message += `*Note:* ${notes}\n`;
      }
      message += `*Pagamento:* ${paymentInfo}`;
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

      let paymentInfo = '';
      if (booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded') {
        paymentInfo = `Pagato`;
      } else if (amountPaid > 0) {
        paymentInfo = `${amountPaidEuros}€ pagati - ${amountRemainingEuros}€ da pagare`;
      } else {
        paymentInfo = `NON pagato`;
      }

      message = `*NUOVA PRENOTAZIONE NOLEGGIO*\n\n`;
      message += `*ID:* DR7-${bookingId}\n`;
      message += `*Cliente:* ${customerName}\n`;
      message += `*Email:* ${customerEmail}\n`;
      message += `*Telefono:* ${customerPhone}\n`;
      message += `*Veicolo:* ${vehicleName}\n`;
      message += `*Ritiro:* ${pickupDateFormatted} alle ${pickupTimeFormatted}\n`;
      message += `*Riconsegna:* ${dropoffDateFormatted} alle ${dropoffTimeFormatted}\n`;
      message += `*Luogo Ritiro:* ${pickupLocation}\n`;
      message += `*Assicurazione:* ${insuranceOption}\n`;
      message += `*Totale:* €${totalPrice}\n`;

      // Cauzione (deposit) info — always show, default to €0
      const depositAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0);
      const depositOption = booking.booking_details?.depositOption;
      if (depositOption === 'no_deposit') {
        const surcharge = booking.booking_details?.noDepositSurcharge || 0;
        message += `*Cauzione:* Senza cauzione (+30% = €${Number(surcharge).toFixed(2)})\n`;
      } else if (depositAmount > 0) {
        message += `*Cauzione:* €${depositAmount}\n`;
      } else {
        message += `*Cauzione:* €0\n`;
      }

      message += `*Pagamento:* ${paymentInfo}`;
    }
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'No valid data provided for notification' }),
    };
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
        message: message,
      }),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error('Green API error:', result);
      throw new Error(result.error || 'Green API error');
    }

    console.log('✅ WhatsApp notification sent via Green API:', result.idMessage);

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
