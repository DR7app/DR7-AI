import { getCorsOrigin } from './cors-headers'
import type { Handler } from "@netlify/functions";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a vehicle classification assistant for a car wash business in Italy.
Classify vehicles into exactly one of two categories:

URBAN = Small and medium cars (segments A, B, C). Includes: city cars, supermini, compact cars, sedans up to ~4.5m, small crossovers.
Examples: Fiat Panda, VW Golf, Ford Focus, Opel Astra, BMW Serie 1/2/3, Mercedes Classe A/B/C, Audi A1-A5, Toyota Yaris/Corolla, Honda Civic.
IMPORTANT: Borderline segment C cars (Golf, Focus, Astra, Leon, Megane, etc.) are URBAN, not MAXI.

MAXI = Large cars, SUVs, vans, luxury sedans (segments D+, SUV, van). Includes: large sedans >4.7m, all SUVs, crossovers with SUV body, minivans, vans, pickup trucks.
Examples: BMW X3/X5, Mercedes GLE/GLC, Audi Q5/Q7, Range Rover, Toyota RAV4, VW Tiguan, Fiat Ducato, any van or pickup.

Sports cars / supercars are MAXI (due to delicate handling and width).

Respond with ONLY a JSON object: {"category":"urban"} or {"category":"maxi"}`;

const handler: Handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": getCorsOrigin(event.headers.origin),
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

  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, defaulting to maxi");
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        category: "maxi",
        confidence: "low",
        model: "fallback",
      }),
    };
  }

  try {
    const { makeModel } = JSON.parse(event.body || "{}");

    if (!makeModel || typeof makeModel !== "string") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "makeModel is required" }),
      };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Classify this vehicle: "${makeModel}"`,
          },
        ],
        temperature: 0,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          category: "maxi",
          confidence: "low",
          model: "fallback",
        }),
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON response
    let category = "maxi";
    try {
      const parsed = JSON.parse(content);
      if (parsed.category === "urban" || parsed.category === "maxi") {
        category = parsed.category;
      }
    } catch {
      // Try to extract from text
      if (content.toLowerCase().includes("urban")) {
        category = "urban";
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        category,
        confidence: "medium",
        model: "gpt-4o-mini",
      }),
    };
  } catch (error: any) {
    console.error("classify-vehicle error:", error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        category: "maxi",
        confidence: "low",
        model: "fallback",
      }),
    };
  }
};

export { handler };
