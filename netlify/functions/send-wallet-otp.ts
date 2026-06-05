import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'

// OTP recipient — direzione's working channel. Config chain matches
// limitation-override-otp.ts:
//   1) centralina_pro_config.config.notifications.otp_recipient
//   2) process.env.OTP_RECIPIENT
//   3) hardcoded fallback
// Any superadmin who triggers an OTP-required action self-approves
// without an email (handled below).
const OTP_RECIPIENT_FALLBACK = 'valesaja91@icloud.com'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getOtpRecipient(): Promise<string> {
  try {
    const { data } = await supabase
      .from('centralina_pro_config')
      .select('config')
      .eq('id', 'main')
      .maybeSingle()
    const cfg = (data?.config || {}) as Record<string, unknown>
    const notif = (cfg.notifications || {}) as Record<string, unknown>
    const v = notif.otp_recipient
    if (typeof v === 'string' && v.includes('@')) return v
  } catch (e) {
    console.warn('[send-wallet-otp] OTP recipient lookup failed, using fallback', e)
  }
  return process.env.OTP_RECIPIENT || OTP_RECIPIENT_FALLBACK
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // Identify the requesting admin so we can bypass for self-approval
  const { user: authUser, error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    const { code, action, customerName, amount, description } = JSON.parse(event.body || '{}')

    if (!code || !action || !customerName || !amount) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
    }

    // BYPASS — role-tag check via admins.permissions[] (failsafe in
    // utils/adminRoles.ROLE_FAILSAFE keeps valerio/ilenia safe).
    if (authUser?.email && await userHasRole(authUser.email, 'direzione')) {
      console.log(`[send-wallet-otp] AUTO-APPROVED for ${authUser.email} (role:direzione)`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, autoApproved: true }) }
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) }
    }

    const resend = new Resend(apiKey)
    const actionLabel = action === 'credit' ? 'CREDITO' : 'ADDEBITO'

    const { error: emailError } = await resend.emails.send({
      from: 'DR7 <info@dr7.app>',
      to: await getOtpRecipient(),
      subject: `Codice Verifica Wallet - ${actionLabel} €${parseFloat(amount).toFixed(2)}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #000; border-radius: 12px; padding: 24px 16px; text-align: center; margin-bottom: 30px;">
            <img src="https://dr7.app/DR7logo1.png" alt="DR7" style="height: 60px; display: block; margin: 0 auto;" />
          </div>
          <h2 style="color: #111; text-align: center;">Codice Verifica Wallet</h2>
          <table style="width: 100%; margin: 20px 0; font-size: 14px; color: #333;">
            <tr><td style="padding: 6px 0; font-weight: 600;">Operazione:</td><td>${actionLabel}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: 600;">Cliente:</td><td>${customerName}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: 600;">Importo:</td><td>&euro;${parseFloat(amount).toFixed(2)}</td></tr>
            ${description ? `<tr><td style="padding: 6px 0; font-weight: 600;">Descrizione:</td><td>${description}</td></tr>` : ''}
          </table>
          <div style="text-align: center; margin: 30px 0;">
            <div style="display: inline-block; background: #f5f5f5; padding: 20px 40px; border-radius: 12px; letter-spacing: 8px; font-size: 32px; font-weight: 700; color: #111; border: 2px solid #d4af37;">
              ${code}
            </div>
          </div>
          <p style="text-align: center; color: #666; font-size: 13px;">Comunica questo codice all'operatore per autorizzare l'operazione.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 11px; text-align: center;">Dubai rent 7.0 S.p.A. - www.dr7.app</p>
        </div>
      `
    })

    if (emailError) {
      console.error('[send-wallet-otp] Resend error:', emailError)
      return { statusCode: 500, headers, body: JSON.stringify({ error: emailError.message }) }
    }

    console.log(`[send-wallet-otp] OTP sent for ${actionLabel} €${amount} - ${customerName}`)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (err: any) {
    console.error('[send-wallet-otp] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
