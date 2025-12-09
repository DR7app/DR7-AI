import type { Handler } from "@netlify/functions";

const CALLMEBOT_PHONE = process.env.CALLMEBOT_ADMIN_PHONE; // Your phone number for CallMeBot
const CALLMEBOT_API_KEY = "6526748";

/**
 * Sends WhatsApp notification for new bookings, tickets, and other events from admin panel
 * Uses CallMeBot API
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  const { booking, ticket, type, message: customMessage, ticketNumbers, customerInfo } = JSON.parse(event.body || '{}');

  // Check if CallMeBot is configured
  if (!CALLMEBOT_PHONE) {
    console.error('CallMeBot admin phone number not configured - CALLMEBOT_ADMIN_PHONE env var missing');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'CALLMEBOT_ADMIN_PHONE environment variable not configured' }),
    };
  }

  let message = '';

  // Handle custom message (from admin lottery ticket sales)
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
    const customerName = booking.customer_name || 'Cliente';
    const customerEmail = booking.customer_email;
    const customerPhone = booking.customer_phone;
    const bookingId = booking.id.substring(0, 8).toUpperCase();
    const totalPrice = (booking.price_total / 100).toFixed(2);

    if (serviceType === 'car_wash') {
      // Car Wash Booking
      const appointmentDate = new Date(booking.appointment_date);
      const serviceName = booking.service_name;
      const additionalService = booking.booking_details?.additionalService;
      const notes = booking.booking_details?.notes;

      // Format date and time in Europe/Rome timezone
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

      message = `🚗 *NUOVA PRENOTAZIONE AUTOLAVAGGIO*\n\n`;
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
      message += `*Stato Pagamento:* ${booking.payment_status === 'paid' || booking.payment_status === 'completed' ? '✅ Pagato' : '⏳ In attesa'}`;
    } else {
      // Car Rental Booking
      const vehicleName = booking.vehicle_name;
      const pickupDate = new Date(booking.pickup_date);
      const dropoffDate = new Date(booking.dropoff_date);
      const pickupLocation = booking.pickup_location;
      const insuranceOption = booking.insurance_option || booking.booking_details?.insuranceOption || 'Nessuna';

      // Format dates and times in Europe/Rome timezone
      const pickupDateFormatted = pickupDate.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
      const pickupTimeFormatted = pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
      const dropoffDateFormatted = dropoffDate.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
      const dropoffTimeFormatted = dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });

      message = `🚘 *NUOVA PRENOTAZIONE NOLEGGIO*\n\n`;
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
      message += `*Stato Pagamento:* ${booking.payment_status === 'paid' || booking.payment_status === 'completed' ? '✅ Pagato' : '⏳ In attesa'}`;
    }
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'No valid data provided for notification' }),
    };
  }

  try {
    // Send via CallMeBot
    const encodedMessage = encodeURIComponent(message);
    const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${CALLMEBOT_PHONE}&text=${encodedMessage}&apikey=${CALLMEBOT_API_KEY}`;

    const response = await fetch(callmebotUrl);

    if (!response.ok) {
      const error = await response.text();
      console.error('CallMeBot API error:', error);
      throw new Error(`CallMeBot API error: ${error}`);
    }

    console.log('✅ WhatsApp notification sent via CallMeBot');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'WhatsApp notification sent via CallMeBot', success: true }),
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
