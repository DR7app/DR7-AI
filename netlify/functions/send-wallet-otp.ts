import { Handler } from '@netlify/functions'
import { Resend } from 'resend'

const OTP_RECIPIENT = 'valesaja91@icloud.com'

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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

  try {
    const { code, action, customerName, amount, description } = JSON.parse(event.body || '{}')

    if (!code || !action || !customerName || !amount) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) }
    }

    const resend = new Resend(apiKey)
    const actionLabel = action === 'credit' ? 'CREDITO' : 'ADDEBITO'

    const { error: emailError } = await resend.emails.send({
      from: 'DR7 Empire <info@dr7.app>',
      to: OTP_RECIPIENT,
      subject: `Codice Verifica Wallet - ${actionLabel} €${parseFloat(amount).toFixed(2)}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" style="height: 60px;" />
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
          <p style="color: #999; font-size: 11px; text-align: center;">Dubai rent 7.0 S.p.A. - www.dr7empire.com</p>
        </div>
      `
    })

    if (emailError) {
      console.error('[send-wallet-otp] Resend error:', emailError)
      return { statusCode: 500, headers, body: JSON.stringify({ error: emailError.message }) }
    }

    console.log(`[send-wallet-otp] OTP sent to ${OTP_RECIPIENT} for ${actionLabel} €${amount} - ${customerName}`)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (err: any) {
    console.error('[send-wallet-otp] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
