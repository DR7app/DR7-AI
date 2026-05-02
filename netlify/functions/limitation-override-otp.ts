import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth } from './require-auth'
import { randomInt } from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// OTP recipient — the direzione that approves overrides. Valerio at his
// work email. When this admin himself triggers an OTP-required action,
// the bypass below auto-approves without sending him an email.
const OTP_RECIPIENT = 'valerio@dr7.app'
const OTP_TTL_MINUTES = 10
const OVERRIDE_TTL_HOURS = 2

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

  const { user: authUser, error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ── SEND OTP ──
    if (action === 'send') {
      const { limitationCode, limitationMessage, actionContext, draftSessionId, flowType } = body

      if (!limitationCode || !limitationMessage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing limitationCode or limitationMessage' }) }
      }

      if (!draftSessionId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing draftSessionId' }) }
      }

      const code = String(randomInt(100000, 999999))
      const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
      const overrideExpiresAt = new Date(Date.now() + OVERRIDE_TTL_HOURS * 60 * 60 * 1000).toISOString()

      // BYPASS: any superadmin can self-approve their own override.
      // Sending an OTP to the direzione only to type it themselves is
      // theatre — the gate exists to keep regular admins honest.
      const { data: requesterAdmin } = await supabase
        .from('admins')
        .select('role')
        .eq('user_id', authUser!.id)
        .maybeSingle()
      const isSelfApproval = requesterAdmin?.role === 'superadmin'

      // Store OTP server-side
      const { data: override, error: insertErr } = await supabase
        .from('limitation_overrides')
        .insert({
          limitation_code: limitationCode,
          action_context: actionContext || null,
          draft_session_id: draftSessionId,
          flow_type: flowType || 'booking_create',
          status: isSelfApproval ? 'active' : 'pending',
          otp_code: code,
          otp_verified: isSelfApproval,
          otp_expires_at: otpExpiresAt,
          expires_at: overrideExpiresAt,
          approved_by_user_id: authUser!.id !== 'admin' ? authUser!.id : null,
          metadata: {
            limitation_message: limitationMessage,
            requested_by: authUser!.email,
            draft_session_id: draftSessionId,
            flow_type: flowType || 'booking_create',
            ...(isSelfApproval ? { auto_approved: true, reason: 'requestor is OTP recipient' } : {})
          }
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error('[limitation-override-otp] Insert error:', insertErr)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create override request' }) }
      }

      // Self-approval shortcut: skip email, return active override.
      if (isSelfApproval) {
        console.log(`[limitation-override-otp] AUTO-APPROVED for ${authUser!.email} (superadmin) — override ${override.id}`)
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, autoApproved: true, overrideId: override.id })
        }
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
            <div style="background: #000; border-radius: 12px; padding: 24px 16px; text-align: center; margin-bottom: 30px;">
              <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" style="height: 60px; display: block; margin: 0 auto;" />
            </div>
            <h2 style="color: #111; text-align: center;">Autorizzazione Direzionale</h2>
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0; color: #856404; font-weight: 600;">Limitazione:</p>
              <p style="margin: 8px 0 0; color: #856404;">${limitationMessage}</p>
            </div>
            <table style="width: 100%; margin: 20px 0; font-size: 14px; color: #333;">
              <tr><td style="padding: 6px 0; font-weight: 600;">Codice:</td><td>${limitationCode}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">Richiesto da:</td><td>${authUser!.email || 'Operatore'}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">Sessione:</td><td>${draftSessionId.substring(0, 8)}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">Scadenza OTP:</td><td>${OTP_TTL_MINUTES} minuti</td></tr>
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

      console.log(`[limitation-override-otp] OTP sent for ${limitationCode}, override ${override.id}, session ${draftSessionId.substring(0, 8)}`)
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

      // Check if already verified/active
      if (override.status === 'active' || override.otp_verified) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, already_verified: true }) }
      }

      // Check if consumed or expired status
      if (override.status === 'consumed' || override.status === 'expired' || override.status === 'revoked') {
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Override non più valido.' }) }
      }

      // Check OTP expiry
      if (new Date(override.otp_expires_at) < new Date()) {
        await supabase.from('limitation_overrides').update({ status: 'expired' }).eq('id', overrideId)
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Codice scaduto. Richiedi un nuovo codice.' }) }
      }

      // Check max attempts (5)
      if (override.otp_attempts >= 5) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Troppi tentativi. Richiedi un nuovo codice.' }) }
      }

      // Increment attempts
      await supabase
        .from('limitation_overrides')
        .update({ otp_attempts: override.otp_attempts + 1, updated_at: new Date().toISOString() })
        .eq('id', overrideId)

      // Verify code
      if (code !== override.otp_code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Codice non valido' }) }
      }

      // Mark as active (verified + usable)
      const overrideExpiresAt = new Date(Date.now() + OVERRIDE_TTL_HOURS * 60 * 60 * 1000).toISOString()
      await supabase
        .from('limitation_overrides')
        .update({
          otp_verified: true,
          status: 'active',
          approved_at: new Date().toISOString(),
          expires_at: overrideExpiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', overrideId)

      console.log(`[limitation-override-otp] Override ${overrideId} verified for ${override.limitation_code}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    // ── VALIDATE (backend check before booking creation) ──
    if (action === 'validate') {
      const { draftSessionId, flowType, ruleCodes } = body

      if (!draftSessionId || !ruleCodes || !Array.isArray(ruleCodes)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing draftSessionId or ruleCodes' }) }
      }

      // Find all active overrides for this session
      const { data: overrides } = await supabase
        .from('limitation_overrides')
        .select('id, limitation_code, status, expires_at, otp_verified')
        .eq('draft_session_id', draftSessionId)
        .eq('status', 'active')
        .eq('otp_verified', true)

      const now = new Date()
      const validOverrides: Record<string, string> = {} // ruleCode -> overrideId

      for (const o of (overrides || [])) {
        // Check TTL
        if (o.expires_at && new Date(o.expires_at) < now) {
          // Expire it lazily
          await supabase.from('limitation_overrides').update({ status: 'expired', updated_at: now.toISOString() }).eq('id', o.id)
          continue
        }
        if (flowType && o.flow_type && o.flow_type !== flowType) continue
        validOverrides[o.limitation_code] = o.id
      }

      // For each requested ruleCode, check if there's a valid override
      const results: Record<string, { valid: boolean; overrideId?: string }> = {}
      for (const code of ruleCodes) {
        if (validOverrides[code]) {
          results[code] = { valid: true, overrideId: validOverrides[code] }
        } else {
          results[code] = { valid: false }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ results }) }
    }

    // ── CHECK OVERRIDE ──
    if (action === 'check') {
      const { overrideId } = body

      if (!overrideId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId' }) }
      }

      const { data: override } = await supabase
        .from('limitation_overrides')
        .select('otp_verified, consumed_at, otp_expires_at, expires_at, limitation_code, status, draft_session_id')
        .eq('id', overrideId)
        .single()

      if (!override) {
        return { statusCode: 404, headers, body: JSON.stringify({ valid: false }) }
      }

      const now = new Date()
      const valid = override.status === 'active'
        && override.otp_verified
        && !override.consumed_at
        && (!override.expires_at || new Date(override.expires_at) > now)

      return { statusCode: 200, headers, body: JSON.stringify({
        valid,
        limitationCode: override.limitation_code,
        draftSessionId: override.draft_session_id
      })}
    }

    // ── CONSUME OVERRIDE (link to booking) ──
    if (action === 'consume') {
      const { overrideId, bookingId } = body

      if (!overrideId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId' }) }
      }

      const updateData: Record<string, unknown> = {
        status: 'consumed',
        consumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      if (bookingId) {
        updateData.booking_id = bookingId
      }

      await supabase
        .from('limitation_overrides')
        .update(updateData)
        .eq('id', overrideId)
        .eq('otp_verified', true)
        .in('status', ['active', 'pending'])

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[limitation-override-otp] Error:', message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: message }) }
  }
}
