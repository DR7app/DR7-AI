import type { Handler } from "@netlify/functions";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

interface BookingDetails {
  vehicleName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  pickupLocation: string;
  returnLocation: string;
  totalPrice: number;
  bookingId?: string;
}

async function getAccessToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Google credentials not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || "Failed to get access token");
  }

  return data.access_token;
}

async function createCalendarEvent(accessToken: string, booking: BookingDetails) {
  const startDateTime = `${booking.pickupDate}T${booking.pickupTime}:00`;
  const endDateTime = `${booking.returnDate}T${booking.returnTime}:00`;

  const event = {
    summary: `🚗 ${booking.vehicleName} - ${booking.customerName}`,
    description: `
Booking Details:
━━━━━━━━━━━━━━━
Vehicle: ${booking.vehicleName}
Customer: ${booking.customerName}
Email: ${booking.customerEmail}
Phone: ${booking.customerPhone}
Total Price: €${booking.totalPrice}
${booking.bookingId ? `Booking ID: ${booking.bookingId}` : ''}

Pickup: ${booking.pickupLocation}
Return: ${booking.returnLocation}

━━━━━━━━━━━━━━━
DR7 Admin Booking
    `.trim(),
    start: {
      dateTime: startDateTime,
      timeZone: "Europe/Rome",
    },
    end: {
      dateTime: endDateTime,
      timeZone: "Europe/Rome",
    },
    location: booking.pickupLocation,
    attendees: booking.customerEmail ? [
      {
        email: booking.customerEmail,
        displayName: booking.customerName,
      },
    ] : [],
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 }, // 1 day before
        { method: "popup", minutes: 60 }, // 1 hour before
      ],
    },
    colorId: "11", // Red color for visibility
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CALENDAR_ID}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Failed to create calendar event");
  }

  return data;
}

export const handler: Handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const booking: BookingDetails = JSON.parse(event.body || "{}");

    // Validate required fields
    if (!booking.vehicleName || !booking.customerName || !booking.pickupDate || !booking.returnDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required booking details" }),
      };
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Create calendar event
    const calendarEvent = await createCalendarEvent(accessToken, booking);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        eventId: calendarEvent.id,
        eventLink: calendarEvent.htmlLink,
        message: "Calendar event created successfully",
      }),
    };
  } catch (error) {
    console.error("Error creating calendar event:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create calendar event",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
