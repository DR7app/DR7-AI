import type { Handler } from "@netlify/functions";

const OPENAPI_EMAIL = process.env.OPENAPI_EMAIL;
const OPENAPI_API_KEY = process.env.OPENAPI_API_KEY;
// Fallback: direct token (if user generated one from the console)
const OPENAPI_DIRECT_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN;

// Use sandbox for testing, production for live
const USE_SANDBOX = process.env.OPENAPI_USE_SANDBOX !== "false";
const AUTOMOTIVE_BASE = USE_SANDBOX
  ? "https://test.automotive.openapi.com"
  : "https://automotive.openapi.com";

/**
 * Generate a Bearer token via OpenAPI.com OAuth (email + API key → token)
 */
async function getOAuthToken(): Promise<string> {
  const scope = USE_SANDBOX
    ? "GET:test.automotive.openapi.com/IT-car"
    : "GET:automotive.openapi.com/IT-car";

  const basicAuth = Buffer.from(`${OPENAPI_EMAIL}:${OPENAPI_API_KEY}`).toString(
    "base64"
  );

  const response = await fetch("https://oauth.openapi.it/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope,
      ttl: 3600,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OAuth token error:", response.status, errorText);
    throw new Error(`OAuth token generation failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const token = data.token || data.access_token;
  if (!token) {
    console.error("OAuth response (no token field):", JSON.stringify(data));
    throw new Error("OAuth response missing token field");
  }
  return token;
}

/**
 * Get a Bearer token — try direct token first, then OAuth exchange
 */
async function getBearerToken(): Promise<string> {
  // If user set a direct token from the console, use it
  if (OPENAPI_DIRECT_TOKEN) {
    return OPENAPI_DIRECT_TOKEN;
  }
  // Otherwise, exchange email+apikey for a token via OAuth
  if (OPENAPI_EMAIL && OPENAPI_API_KEY) {
    return getOAuthToken();
  }
  throw new Error("No OpenAPI credentials configured");
}

const handler: Handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!OPENAPI_DIRECT_TOKEN && (!OPENAPI_EMAIL || !OPENAPI_API_KEY)) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Configure OPENAPI_AUTOMOTIVE_TOKEN (direct token) or OPENAPI_EMAIL + OPENAPI_API_KEY",
      }),
    };
  }

  try {
    const { targa } = JSON.parse(event.body || "{}");

    if (!targa || typeof targa !== "string" || targa.length < 5) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Targa non valida" }),
      };
    }

    // Clean targa: uppercase, remove spaces/dashes
    const cleanTarga = targa.toUpperCase().replace(/[\s\-]/g, "");

    // Step 1: Get Bearer token (direct or via OAuth)
    const bearerToken = await getBearerToken();

    // Step 2: Call the IT-car endpoint
    const response = await fetch(
      `${AUTOMOTIVE_BASE}/IT-car/${encodeURIComponent(cleanTarga)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAPI automotive error:", response.status, errorText);

      if (response.status === 404) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Targa non trovata" }),
        };
      }

      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: "Errore nella ricerca targa",
          details: errorText,
        }),
      };
    }

    const data = await response.json();
    console.log(
      "OpenAPI automotive raw response keys:",
      Object.keys(data)
    );
    console.log(
      "OpenAPI automotive raw response:",
      JSON.stringify(data).substring(0, 500)
    );

    // Extract relevant fields — try multiple possible key names
    const result = {
      targa: cleanTarga,
      brand: data.CarMake || data.carMake || data.brand || data.Brand || data.make || data.Make || "",
      model:
        data.Description ||
        data.description ||
        data.CarModel ||
        data.carModel ||
        data.Model ||
        data.model ||
        "",
      year:
        data.RegistrationYear ||
        data.registrationYear ||
        data.Year ||
        data.year ||
        data.FirstRegistrationDate ||
        "",
      fuel:
        data.FuelType ||
        data.fuelType ||
        data.Fuel ||
        data.fuel ||
        data.PowerSupply ||
        "",
      displacement:
        data.EngineDisplacement ||
        data.engineDisplacement ||
        data.Displacement ||
        data.displacement ||
        "",
      powerCV:
        data.PowerCV ||
        data.powerCV ||
        data.Power ||
        data.power ||
        data.HorsePower ||
        "",
      doors: data.Doors || data.doors || data.NumberOfDoors || "",
      makeModel: "",
    };

    // Build makeModel string
    if (result.brand && result.model) {
      result.makeModel = `${result.brand} ${result.model}`;
    } else if (result.brand) {
      result.makeModel = result.brand;
    } else if (result.model) {
      result.makeModel = result.model;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error: any) {
    console.error("lookup-targa error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || "Errore interno nella ricerca targa",
      }),
    };
  }
};

export { handler };
