import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { randomInt } from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const OTP_RECIPIENT = 'valesaja91@icloud.com'
const OTP_TTL_MINUTES = 10

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ── SEND OTP ──
    if (action === 'send') {
      const { limitationCode, limitationMessage, actionContext } = body

      if (!limitationCode || !limitationMessage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing limitationCode or limitationMessage' }) }
      }

      const code = String(randomInt(100000, 999999))
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

      // Store OTP server-side
      const { data: override, error: insertErr } = await supabase
        .from('limitation_overrides')
        .insert({
          limitation_code: limitationCode,
          action_context: actionContext || null,
          otp_code: code,
          otp_expires_at: expiresAt,
          approved_by_user_id: null,
          metadata: { limitation_message: limitationMessage, requested_by: 'Operatore' }
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error('[limitation-override-otp] Insert error:', insertErr)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create override request' }) }
      }

      // Send email via Resend (same channel as wallet OTP)
      const apiKey = process.env.RESEND_API_KEY
      if (!apiKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) }
      }

      const resend = new Resend(apiKey)
      const { error: emailError } = await resend.emails.send({
        from: 'DR7 Empire <info@dr7.app>',
        to: OTP_RECIPIENT,
        subject: `Autorizzazione Direzionale - ${limitationCode}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" style="height: 60px;" />
            </div>
            <h2 style="color: #111; text-align: center;">Autorizzazione Direzionale</h2>
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0; color: #856404; font-weight: 600;">Limitazione:</p>
              <p style="margin: 8px 0 0; color: #856404;">${limitationMessage}</p>
            </div>
            <table style="width: 100%; margin: 20px 0; font-size: 14px; color: #333;">
              <tr><td style="padding: 6px 0; font-weight: 600;">Codice:</td><td>${limitationCode}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">Richiesto da:</td><td>Operatore</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">Scadenza:</td><td>${OTP_TTL_MINUTES} minuti</td></tr>
            </table>
            <div style="text-align: center; margin: 30px 0;">
              <div style="display: inline-block; background: #f5f5f5; padding: 20px 40px; border-radius: 12px; letter-spacing: 8px; font-size: 32px; font-weight: 700; color: #111; border: 2px solid #d4af37;">
                ${code}
              </div>
            </div>
            <p style="text-align: center; color: #666; font-size: 13px;">Comunica questo codice all'operatore per autorizzare l'eccezione.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #999; font-size: 11px; text-align: center;">Dubai rent 7.0 S.p.A. - www.dr7empire.com</p>
          </div>
        `
      })

      if (emailError) {
        console.error('[limitation-override-otp] Email error:', emailError)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to send OTP email' }) }
      }

      console.log(`[limitation-override-otp] OTP sent for ${limitationCode}, override ${override.id}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, overrideId: override.id }) }
    }

    // ── VERIFY OTP ──
    if (action === 'verify') {
      const { overrideId, code } = body

      if (!overrideId || !code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId or code' }) }
      }

      // Fetch the override record
      const { data: override, error: fetchErr } = await supabase
        .from('limitation_overrides')
        .select('*')
        .eq('id', overrideId)
        .single()

      if (fetchErr || !override) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Override request not found' }) }
      }

      // Check if already verified
      if (override.otp_verified) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, already_verified: true }) }
      }

      // Check expiry
      if (new Date(override.otp_expires_at) < new Date()) {
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Codice scaduto. Richiedi un nuovo codice.' }) }
      }

      // Check max attempts (5)
      if (override.otp_attempts >= 5) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Troppi tentativi. Richiedi un nuovo codice.' }) }
      }

      // Increment attempts
      await supabase
        .from('limitation_overrides')
        .update({ otp_attempts: override.otp_attempts + 1 })
        .eq('id', overrideId)

      // Verify code
      if (code !== override.otp_code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Codice non valido' }) }
      }

      // Mark as verified
      await supabase
        .from('limitation_overrides')
        .update({
          otp_verified: true,
          approved_at: new Date().toISOString()
        })
        .eq('id', overrideId)

      console.log(`[limitation-override-otp] Override ${overrideId} verified for ${override.limitation_code}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    // ── CHECK OVERRIDE ──
    if (action === 'check') {
      const { overrideId } = body

      if (!overrideId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId' }) }
      }

      const { data: override } = await supabase
        .from('limitation_overrides')
        .select('otp_verified, consumed_at, otp_expires_at, limitation_code')
        .eq('id', overrideId)
        .single()

      if (!override) {
        return { statusCode: 404, headers, body: JSON.stringify({ valid: false }) }
      }

      const valid = override.otp_verified
        && !override.consumed_at
        && new Date(override.otp_expires_at) > new Date()

      return { statusCode: 200, headers, body: JSON.stringify({ valid, limitationCode: override.limitation_code }) }
    }

    // ── CONSUME OVERRIDE ──
    if (action === 'consume') {
      const { overrideId } = body

      if (!overrideId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId' }) }
      }

      await supabase
        .from('limitation_overrides')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', overrideId)
        .eq('otp_verified', true)
        .is('consumed_at', null)

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[limitation-override-otp] Error:', message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: message }) }
  }
}
