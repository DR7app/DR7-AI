import type { Handler } from "@netlify/functions";

const API_KEY = process.env.OPENAPI_API_KEY || process.env.OPENAPI_AUTOMOTIVE_TOKEN || "";

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
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Set OPENAPI_AUTOMOTIVE_TOKEN in Netlify env vars" }),
    };
  }

  try {
    const { targa } = JSON.parse(event.body || "{}");

    if (!targa || typeof targa !== "string" || targa.length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Targa non valida" }) };
    }

    const cleanTarga = targa.toUpperCase().replace(/[\s\-]/g, "");

    const response = await fetch(`https://automotive.openapi.com/IT-car/${encodeURIComponent(cleanTarga)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (response.status === 404) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Targa non trovata" }) };
    }

    if (!response.ok) {
      console.error("[lookup-targa] API error:", response.status);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Errore nella ricerca. Riprova tra qualche istante." }),
      };
    }

    const data = await response.json();

    const result = {
      targa: cleanTarga,
      brand: data.CarMake || "",
      model: data.CarModel || "",
      makeModel: `${data.CarMake || ""} ${data.CarModel || ""}`.trim(),
      description: data.Description || "",
      year: data.RegistrationYear || "",
      fuel: data.FuelType || "",
      powerCV: data.PowerCV || "",
      displacement: data.EngineDisplacement || "",
      doors: data.Doors || "",
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (error: any) {
    console.error("[lookup-targa] error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Errore nella ricerca targa" }),
    };
  }
};

export { handler };
