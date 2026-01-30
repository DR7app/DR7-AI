import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Validate and apply birthday discount codes
 *
 * Actions:
 * - validate: Check if code is valid and return discount info
 * - apply_rental: Mark the rental credit as used
 * - apply_car_wash: Mark the car wash discount as used
 */
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

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server configuration error" }),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { action, code, booking_id, service_type } = JSON.parse(event.body || "{}");

    if (!code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing discount code" }),
      };
    }

    // Normalize code (uppercase, trim)
    const normalizedCode = code.trim().toUpperCase();

    // Fetch the discount code
    const { data: discountCode, error: fetchError } = await supabase
      .from("birthday_discount_codes")
      .select("*")
      .eq("code", normalizedCode)
      .single();

    if (fetchError || !discountCode) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          valid: false,
          error: "Codice sconto non valido"
        }),
      };
    }

    // Check if expired
    if (new Date(discountCode.expires_at) < new Date()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          valid: false,
          error: "Codice sconto scaduto"
        }),
      };
    }

    // VALIDATE action - just check and return info
    if (action === "validate" || !action) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          valid: true,
          code: discountCode.code,
          customer_name: discountCode.customer_name,
          rental_credit: discountCode.rental_credit,
          rental_used: discountCode.rental_used,
          car_wash_discount: discountCode.car_wash_discount,
          car_wash_used: discountCode.car_wash_used,
          expires_at: discountCode.expires_at,
          message: discountCode.rental_used && discountCode.car_wash_used
            ? "Codice già completamente utilizzato"
            : "Codice valido"
        }),
      };
    }

    // APPLY RENTAL action
    if (action === "apply_rental") {
      if (discountCode.rental_used) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: "Il credito noleggio di questo codice è già stato utilizzato"
          }),
        };
      }

      const { error: updateError } = await supabase
        .from("birthday_discount_codes")
        .update({
          rental_used: true,
          rental_used_at: new Date().toISOString(),
          rental_booking_id: booking_id || null,
        })
        .eq("code", normalizedCode);

      if (updateError) {
        console.error("Error updating discount code:", updateError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Errore nell'applicazione del codice" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          discount_applied: discountCode.rental_credit,
          message: `Credito di €${discountCode.rental_credit} applicato al noleggio`
        }),
      };
    }

    // APPLY CAR WASH action
    if (action === "apply_car_wash") {
      if (discountCode.car_wash_used) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: "Lo sconto lavaggio di questo codice è già stato utilizzato"
          }),
        };
      }

      const { error: updateError } = await supabase
        .from("birthday_discount_codes")
        .update({
          car_wash_used: true,
          car_wash_used_at: new Date().toISOString(),
          car_wash_booking_id: booking_id || null,
        })
        .eq("code", normalizedCode);

      if (updateError) {
        console.error("Error updating discount code:", updateError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Errore nell'applicazione del codice" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          discount_applied: discountCode.car_wash_discount,
          message: `Sconto di €${discountCode.car_wash_discount} applicato al lavaggio`
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid action" }),
    };

  } catch (error: any) {
    console.error("[validate-discount-code] Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Internal server error" }),
    };
  }
};

export { handler };
