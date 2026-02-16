import type { Handler } from "@netlify/functions";

// Accepts any of these env vars — tries each auth method in order
const API_KEY = process.env.OPENAPI_API_KEY || process.env.OPENAPI_AUTOMOTIVE_TOKEN || "";
const OPENAPI_EMAIL = process.env.OPENAPI_EMAIL || "";

// Use sandbox for testing, production for live
const USE_SANDBOX = process.env.OPENAPI_USE_SANDBOX !== "false";
const AUTOMOTIVE_BASE = USE_SANDBOX
  ? "https://test.automotive.openapi.com"
  : "https://automotive.openapi.com";

/**
 * Try to call the IT-car endpoint with multiple auth strategies
 */
async function callITCar(targa: string): Promise<Response> {
  const url = `${AUTOMOTIVE_BASE}/IT-car/${encodeURIComponent(targa)}`;

  // Strategy 1: Bearer token with API key
  console.log("Trying auth: Bearer token...");
  let response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });
  if (response.ok) return response;
  console.log("Bearer failed:", response.status);

  // Strategy 2: Basic auth with email:apikey
  if (OPENAPI_EMAIL && API_KEY) {
    console.log("Trying auth: Basic...");
    const basicAuth = Buffer.from(`${OPENAPI_EMAIL}:${API_KEY}`).toString("base64");
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
    });
    if (response.ok) return response;
    console.log("Basic failed:", response.status);
  }

  // Strategy 3: API key as query parameter
  console.log("Trying auth: query param...");
  response = await fetch(`${url}?token=${API_KEY}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (response.ok) return response;
  console.log("Query param failed:", response.status);

  // Strategy 4: OAuth token exchange, then Bearer
  if (OPENAPI_EMAIL && API_KEY) {
    console.log("Trying auth: OAuth token exchange...");
    try {
      const scope = USE_SANDBOX
        ? "GET:test.automotive.openapi.com/IT-car"
        : "GET:automotive.openapi.com/IT-car";
      const basicAuth = Buffer.from(`${OPENAPI_EMAIL}:${API_KEY}`).toString("base64");

      const tokenResponse = await fetch("https://oauth.openapi.it/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope, ttl: 3600 }),
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        const token = tokenData.token || tokenData.access_token;
        if (token) {
          response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          });
          if (response.ok) return response;
          console.log("OAuth Bearer failed:", response.status);
        }
      } else {
        console.log("OAuth token exchange failed:", tokenResponse.status);
      }
    } catch (oauthErr) {
      console.log("OAuth error:", oauthErr);
    }
  }

  // Strategy 5: x-api-key header
  console.log("Trying auth: x-api-key header...");
  response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": API_KEY,
      Accept: "application/json",
    },
  });
  if (response.ok) return response;
  console.log("x-api-key failed:", response.status);

  // All strategies failed — return last response for error handling
  return response;
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

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Set OPENAPI_API_KEY or OPENAPI_AUTOMOTIVE_TOKEN in Netlify env vars",
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

    const cleanTarga = targa.toUpperCase().replace(/[\s\-]/g, "");

    const response = await callITCar(cleanTarga);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("All auth strategies failed. Last error:", response.status, errorText);

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
          error: `Autenticazione fallita (${response.status}). Verifica le credenziali OpenAPI.`,
          details: errorText.substring(0, 200),
        }),
      };
    }

    const data = await response.json();
    console.log("OpenAPI response keys:", Object.keys(data));
    console.log("OpenAPI response sample:", JSON.stringify(data).substring(0, 500));

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
