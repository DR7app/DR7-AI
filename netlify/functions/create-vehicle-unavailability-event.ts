import type { Handler } from "@netlify/functions";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

interface VehicleUnavailability {
  vehicleName: string;
  vehiclePlate?: string;
  unavailableFrom: string; // YYYY-MM-DD
  unavailableUntil: string; // YYYY-MM-DD
  reason?: string;
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

async function createVehicleUnavailabilityEvent(
  accessToken: string,
  unavailability: VehicleUnavailability
) {
  // Calculate end date (add one day to make it inclusive in calendar)
  const endDate = new Date(unavailability.unavailableUntil);
  endDate.setDate(endDate.getDate() + 1);
  const endDateStr = endDate.toISOString().split('T')[0];

  const vehicleDisplay = unavailability.vehiclePlate
    ? `${unavailability.vehicleName} (${unavailability.vehiclePlate})`
    : unavailability.vehicleName;

  const event = {
    summary: `❌ NON DISPONIBILE - ${vehicleDisplay}`,
    description: `
🚫 VEICOLO NON DISPONIBILE
━━━━━━━━━━━━━━━
Veicolo: ${unavailability.vehicleName}
${unavailability.vehiclePlate ? `Targa: ${unavailability.vehiclePlate}` : ''}
${unavailability.reason ? `Motivo: ${unavailability.reason}` : ''}

Periodo: ${unavailability.unavailableFrom} - ${unavailability.unavailableUntil}

━━━━━━━━━━━━━━━
Impostato da DR7 Admin
    `.trim(),
    start: {
      date: unavailability.unavailableFrom, // All-day event
    },
    end: {
      date: endDateStr, // Google Calendar end date is exclusive
    },
    colorId: "11", // Red color for unavailability
    transparency: "opaque", // Show as busy
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
    const unavailability: VehicleUnavailability = JSON.parse(event.body || "{}");

    // Validate required fields
    if (
      !unavailability.vehicleName ||
      !unavailability.unavailableFrom ||
      !unavailability.unavailableUntil
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Create calendar event
    const calendarEvent = await createVehicleUnavailabilityEvent(
      accessToken,
      unavailability
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        eventId: calendarEvent.id,
        eventLink: calendarEvent.htmlLink,
        message: "Vehicle unavailability event created successfully",
      }),
    };
  } catch (error) {
    console.error("Error creating vehicle unavailability event:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create calendar event",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
