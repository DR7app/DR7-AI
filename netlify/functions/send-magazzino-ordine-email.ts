import type { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'

/**
 * Ordine di magazzino via EMAIL (24/08/2026).
 *
 * Il magazzino sapeva ordinare solo via WhatsApp (o aprendo un sito
 * e-commerce): un fornitore che lavora via email non era raggiungibile dal
 * gestionale. Stesso SMTP delle altre funzioni (info@dr7.app).
 */

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.secureserver.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
})

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers?.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const auth = await requireAuth(event as unknown as { headers: Record<string, string> })
  if (auth.error) return auth.error

  try {
    const { to, oggetto, testo } = JSON.parse(event.body || '{}') as { to?: string; oggetto?: string; testo?: string }
    const dest = String(to || '').trim()
    if (!/\S+@\S+\.\S+/.test(dest)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email destinatario non valida' }) }
    }
    if (!testo?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Testo ordine mancante' }) }
    }

    await transporter.sendMail({
      from: '"DR7 Magazzino" <info@dr7.app>',
      to: dest,
      subject: oggetto?.trim() || 'Ordine DR7 — Magazzino',
      text: testo,
      html: `<pre style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;white-space:pre-wrap">${
        testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      }</pre>`,
    })

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, to: dest }) }
  } catch (e) {
    console.error('[send-magazzino-ordine-email]', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore invio' }) }
  }
}

export { handler }
