import type { Handler } from "@netlify/functions"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function generateCode(): string {
  let code = "DR7-"
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += "-"
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)]
  }
  return code
}

async function generateUniqueCode(maxRetries = 5): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateCode()
    const { data } = await supabase
      .from("discount_codes")
      .select("id")
      .eq("code", code)
      .maybeSingle()
    if (!data) return code
  }
  return generateCode() + "-" + Date.now().toString(36).toUpperCase()
}

// Preset review/birthday code rules — keep in one place so admin can change later.
const SUPERCAR_CODE = {
  value_amount: 100,
  scope: ["supercar"],
  minimum_spend: 400,
  validity_days: 10,
}

const LAVAGGIO_CODE = {
  value_amount: 10,
  scope: ["lavaggi"],
  minimum_spend: 40,
  validity_days: 10,
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) }
  }

  try {
    const body = JSON.parse(event.body || "{}")
    const { customerEmail, customerPhone, customerName, source } = body

    if (!customerEmail && !customerPhone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "customerEmail or customerPhone is required" }),
      }
    }

    const now = new Date()
    const buildExpiry = (days: number) => {
      const d = new Date(now)
      d.setDate(d.getDate() + days)
      d.setHours(23, 59, 59, 999)
      return d.toISOString()
    }

    const supercarCode = await generateUniqueCode()
    const lavaggioCode = await generateUniqueCode()

    // Codici review: NON sono legati al destinatario. Single-use globale
    // (validate-discount-code conta in discount_code_usages — la prima
     // redemption deattiva il codice). Il nome del cliente viene salvato
    // solo nei campi message/usage_conditions per tracciabilità in
    // CodiciScontoTab, NON in customer_email/customer_phone (che
    // attiverebbero la restrizione "Limita a cliente specifico").
    const traceLine = source === "review"
      ? `Codice recensione${customerName ? ` — generato per ${customerName}` : ""}${customerEmail ? ` (${customerEmail})` : ""}`
      : "Codice generato automaticamente"
    const baseRow = {
      code_type: "codice_sconto" as const,
      value_type: "fixed" as const,
      single_use: true,
      status: "active",
      customer_email: null,
      customer_phone: null,
      valid_from: now.toISOString(),
      message: traceLine,
      usage_conditions: source === "review"
        ? "Utilizzabile una sola volta. Valido 10 giorni."
        : null,
      qr_url: null,
    }

    const supercarRow = {
      ...baseRow,
      code: supercarCode,
      value_amount: SUPERCAR_CODE.value_amount,
      scope: SUPERCAR_CODE.scope,
      minimum_spend: SUPERCAR_CODE.minimum_spend,
      valid_until: buildExpiry(SUPERCAR_CODE.validity_days),
      qr_url: `https://dr7.app/promo/${supercarCode}`,
    }

    const lavaggioRow = {
      ...baseRow,
      code: lavaggioCode,
      value_amount: LAVAGGIO_CODE.value_amount,
      scope: LAVAGGIO_CODE.scope,
      minimum_spend: LAVAGGIO_CODE.minimum_spend,
      valid_until: buildExpiry(LAVAGGIO_CODE.validity_days),
      qr_url: `https://dr7.app/promo/${lavaggioCode}`,
    }

    const { error: insertErr } = await supabase
      .from("discount_codes")
      .insert([supercarRow, lavaggioRow])

    if (insertErr) {
      console.error("[generate-review-codes] insert failed:", insertErr)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Database insert failed", details: insertErr.message }),
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        rentalCode: supercarCode,
        carwashCode: lavaggioCode,
        rental: {
          code: supercarCode,
          amount: SUPERCAR_CODE.value_amount,
          scope: SUPERCAR_CODE.scope,
          minimum_spend: SUPERCAR_CODE.minimum_spend,
          valid_days: SUPERCAR_CODE.validity_days,
        },
        carwash: {
          code: lavaggioCode,
          amount: LAVAGGIO_CODE.value_amount,
          scope: LAVAGGIO_CODE.scope,
          minimum_spend: LAVAGGIO_CODE.minimum_spend,
          valid_days: LAVAGGIO_CODE.validity_days,
        },
      }),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[generate-review-codes] error:", err)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
