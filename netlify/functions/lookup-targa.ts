import type { Handler } from "@netlify/functions";

const OPENAPI_AUTOMOTIVE_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN;

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

  if (!OPENAPI_AUTOMOTIVE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "OPENAPI_AUTOMOTIVE_TOKEN not configured" }),
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

    const response = await fetch(
      `https://test.automotive.openapi.com/IT-car/${encodeURIComponent(cleanTarga)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${OPENAPI_AUTOMOTIVE_TOKEN}`,
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
        body: JSON.stringify({ error: "Errore nella ricerca targa" }),
      };
    }

    const data = await response.json();

    // Extract relevant fields
    const result = {
      targa: cleanTarga,
      brand: data.CarMake || data.carMake || data.brand || data.Brand || "",
      model:
        data.Description ||
        data.description ||
        data.Model ||
        data.model ||
        "",
      year:
        data.RegistrationYear ||
        data.registrationYear ||
        data.Year ||
        data.year ||
        "",
      fuel:
        data.FuelType ||
        data.fuelType ||
        data.Fuel ||
        data.fuel ||
        "",
      displacement:
        data.EngineDisplacement ||
        data.engineDisplacement ||
        data.Displacement ||
        "",
      powerCV: data.PowerCV || data.powerCV || data.Power || "",
      doors: data.Doors || data.doors || "",
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
      body: JSON.stringify({ error: "Errore interno nella ricerca targa" }),
    };
  }
};

export { handler };
