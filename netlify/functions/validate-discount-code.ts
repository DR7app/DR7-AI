import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Validate and apply discount codes
 * Supports both:
 * - birthday_discount_codes table (birthday codes)
 * - discount_codes table (marketing codes from admin generator)
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
    const { action, code, booking_id, service_type, order_total } = JSON.parse(event.body || "{}");

    if (!code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing discount code" }),
      };
    }

    // Normalize code (uppercase, trim)
    const normalizedCode = code.trim().toUpperCase();

    // First, try birthday_discount_codes table
    const { data: birthdayCode, error: birthdayError } = await supabase
      .from("birthday_discount_codes")
      .select("*")
      .eq("code", normalizedCode)
      .maybeSingle();

    // If found in birthday codes, handle it
    if (birthdayCode) {
      return handleBirthdayCode(supabase, birthdayCode, normalizedCode, action, booking_id, headers);
    }

    // If not found in birthday codes, try discount_codes table (marketing codes)
    const { data: marketingCode, error: marketingError } = await supabase
      .from("discount_codes")
      .select("*")
      .eq("code", normalizedCode)
      .maybeSingle();

    if (marketingCode) {
      return handleMarketingCode(supabase, marketingCode, normalizedCode, action, booking_id, service_type, order_total, headers);
    }

    // Code not found in either table
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        valid: false,
        error: "Codice sconto non valido"
      }),
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

// Handle birthday discount codes
async function handleBirthdayCode(
  supabase: any,
  discountCode: any,
  normalizedCode: string,
  action: string,
  booking_id: string,
  headers: any
) {
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
    // Fetch customer email from customers_extended if we have customer_id
    let customerEmail = null;
    if (discountCode.customer_id) {
      const { data: customer } = await supabase
        .from("customers_extended")
        .select("email")
        .eq("id", discountCode.customer_id)
        .single();
      customerEmail = customer?.email || null;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        code_type: "birthday",
        code: discountCode.code,
        customer_name: discountCode.customer_name,
        customer_phone: discountCode.customer_phone,
        customer_email: customerEmail,
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
}

// Handle marketing discount codes (from discount_codes table)
async function handleMarketingCode(
  supabase: any,
  discountCode: any,
  normalizedCode: string,
  action: string,
  booking_id: string,
  service_type: string,
  order_total: number,
  headers: any
) {
  const now = new Date();
  const validUntil = new Date(discountCode.valid_until);
  const validFrom = new Date(discountCode.valid_from);

  // Check if expired by date
  if (validUntil < now) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        valid: false,
        error: "Codice sconto scaduto",
        message: `Questo codice è scaduto il ${validUntil.toLocaleDateString('it-IT')}`
      }),
    };
  }

  // Check if not yet valid
  if (validFrom > now) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        valid: false,
        error: "Codice non ancora valido",
        message: `Questo codice sarà valido dal ${validFrom.toLocaleDateString('it-IT')}`
      }),
    };
  }

  // Check status
  if (discountCode.status !== 'active') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        valid: false,
        error: `Codice ${discountCode.status}`,
        message: discountCode.status === 'deactivated'
          ? 'Questo codice è stato disattivato'
          : 'Questo codice non è attivo'
      }),
    };
  }

  // Check if single-use and already used
  if (discountCode.single_use) {
    const { count, error: usageError } = await supabase
      .from('discount_code_usages')
      .select('*', { count: 'exact', head: true })
      .eq('discount_code_id', discountCode.id);

    if (!usageError && count && count > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          valid: false,
          error: 'Codice già utilizzato',
          message: 'Questo codice è già stato utilizzato'
        }),
      };
    }
  }

  // Check service scope if service_type provided
  if (service_type && discountCode.scope && Array.isArray(discountCode.scope)) {
    const scope = discountCode.scope;
    const normalizedServiceType = service_type.toLowerCase().replace(/\s+/g, '_');

    const isRentalService = ['noleggio', 'supercar', 'utilitarie', 'urban-cars', 'corporate-fleet'].includes(normalizedServiceType);
    const isCarWashService = normalizedServiceType.includes('lavag') || normalizedServiceType === 'car_wash' || normalizedServiceType === 'car-wash';

    const isValidScope = scope.some((s: string) => {
      const normalizedScope = s.toLowerCase().replace(/\s+/g, '_');
      return normalizedScope === 'tutti' ||
             normalizedScope === 'tutti_i_servizi' ||
             normalizedScope === normalizedServiceType ||
             (isRentalService && normalizedScope === 'noleggio') ||
             (isCarWashService && normalizedScope === 'lavaggi') ||
             (normalizedServiceType.includes('supercar') && normalizedScope === 'supercar') ||
             (normalizedServiceType.includes('utilitari') && normalizedScope === 'utilitarie');
    });

    if (!isValidScope) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          valid: false,
          error: 'Codice non valido per questo servizio',
          message: `Questo codice è valido solo per: ${scope.join(', ')}`
        }),
      };
    }
  }

  // Check minimum spend if required
  if (discountCode.minimum_spend && order_total) {
    const minimumSpendCents = Math.round(discountCode.minimum_spend * 100);
    if (order_total < minimumSpendCents) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          valid: false,
          error: 'Spesa minima non raggiunta',
          message: `Questo codice richiede una spesa minima di €${discountCode.minimum_spend.toFixed(2)}`
        }),
      };
    }
  }

  // VALIDATE action
  if (action === "validate" || !action) {
    // Calculate discount value
    let discountValue = 0;
    let discountDescription = '';

    if (discountCode.value_type === 'fixed') {
      discountValue = Math.round(discountCode.value_amount * 100); // Convert to cents
      discountDescription = `€${discountCode.value_amount.toFixed(2)}`;
    } else if (discountCode.value_type === 'percentage') {
      discountValue = discountCode.value_amount; // percentage value
      discountDescription = `${discountCode.value_amount}%`;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        code_type: discountCode.code_type || "marketing",
        code: discountCode.code,
        value_type: discountCode.value_type,
        value_amount: discountCode.value_amount,
        discount_value: discountValue,
        discount_description: discountDescription,
        scope: discountCode.scope,
        minimum_spend: discountCode.minimum_spend,
        valid_from: discountCode.valid_from,
        valid_until: discountCode.valid_until,
        single_use: discountCode.single_use,
        message: discountCode.message || "Codice valido",
        usage_conditions: discountCode.usage_conditions,
        // For compatibility with existing code expecting rental_credit
        rental_credit: discountCode.value_type === 'fixed' ? discountCode.value_amount : 0,
        rental_used: false
      }),
    };
  }

  // APPLY RENTAL action
  if (action === "apply_rental") {
    // Record usage
    const usageData = {
      discount_code_id: discountCode.id,
      booking_id: booking_id || null,
      service_type: service_type || 'noleggio',
      discount_applied: discountCode.value_amount,
      notes: `Applied via rental booking`
    };

    const { error: insertError } = await supabase
      .from('discount_code_usages')
      .insert(usageData);

    if (insertError) {
      console.error("Error recording discount code usage:", insertError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Errore nell'applicazione del codice" }),
      };
    }

    // If single-use, deactivate the code
    if (discountCode.single_use) {
      await supabase
        .from('discount_codes')
        .update({ status: 'deactivated', updated_at: new Date().toISOString() })
        .eq('id', discountCode.id);
    }

    const discountAmount = discountCode.value_type === 'fixed'
      ? discountCode.value_amount
      : 0; // Percentage would be calculated by the caller

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        discount_applied: discountAmount,
        value_type: discountCode.value_type,
        value_amount: discountCode.value_amount,
        message: discountCode.value_type === 'fixed'
          ? `Sconto di €${discountCode.value_amount} applicato`
          : `Sconto del ${discountCode.value_amount}% applicato`
      }),
    };
  }

  // APPLY CAR WASH action
  if (action === "apply_car_wash") {
    // Record usage
    const usageData = {
      discount_code_id: discountCode.id,
      booking_id: booking_id || null,
      service_type: 'lavaggio',
      discount_applied: discountCode.value_amount,
      notes: `Applied via car wash booking`
    };

    const { error: insertError } = await supabase
      .from('discount_code_usages')
      .insert(usageData);

    if (insertError) {
      console.error("Error recording discount code usage:", insertError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Errore nell'applicazione del codice" }),
      };
    }

    // If single-use, deactivate the code
    if (discountCode.single_use) {
      await supabase
        .from('discount_codes')
        .update({ status: 'deactivated', updated_at: new Date().toISOString() })
        .eq('id', discountCode.id);
    }

    const discountAmount = discountCode.value_type === 'fixed'
      ? discountCode.value_amount
      : 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        discount_applied: discountAmount,
        value_type: discountCode.value_type,
        value_amount: discountCode.value_amount,
        message: discountCode.value_type === 'fixed'
          ? `Sconto di €${discountCode.value_amount} applicato`
          : `Sconto del ${discountCode.value_amount}% applicato`
      }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
}

export { handler };
