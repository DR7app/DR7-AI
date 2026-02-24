const OPENAPI_AUTOMOTIVE_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN || "";

exports.handler = async (event) => {
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

  try {
    const { targa } = JSON.parse(event.body || "{}");

    if (!targa || typeof targa !== "string" || targa.length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Targa non valida" }) };
    }

    const cleanTarga = targa.toUpperCase().replace(/[\s\-]/g, "");

    const url = "https://automotive.openapi.com/IT-car/" + encodeURIComponent(cleanTarga);
    console.log("[lookup-targa] Calling:", url);

    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + OPENAPI_AUTOMOTIVE_TOKEN },
    });

    console.log("[lookup-targa] API status:", response.status);

    if (response.status === 404) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Targa non trovata" }) };
    }

    if (!response.ok) {
      const errBody = await response.text().catch(function() { return ""; });
      console.error("[lookup-targa] API error:", response.status, errBody);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Errore API (" + response.status + "). Riprova." }),
      };
    }

    const json = await response.json();
    const car = json.data || json;

    console.log("[lookup-targa] Success:", car.CarMake, car.CarModel);

    var result = {
      targa: cleanTarga,
      brand: car.CarMake || "",
      model: car.CarModel || "",
      makeModel: ((car.CarMake || "") + " " + (car.CarModel || "")).trim(),
      description: car.Description || "",
      year: car.RegistrationYear || "",
      fuel: car.FuelType || "",
      powerCV: car.PowerCV || "",
      displacement: car.EngineSize || "",
      doors: car.NumberOfDoors || "",
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (error) {
    console.error("[lookup-targa] error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Errore: " + error.message }),
    };
  }
};
