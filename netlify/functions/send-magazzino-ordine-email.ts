import type { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'

/**
 * Ordine di magazzino via EMAIL (24/08/2026).
 *
 * Il magazzino sapeva ordinare solo via WhatsApp (o aprendo un sito
 * e-commerce): un fornitore che lavora via email non era raggiungibile dal
 * gestionale.
 *
 * 25/08/2026 — L'invio rispondeva "Connect ETIMEDOUT": da una funzione
 * serverless la connessione SMTP in uscita viene spesso bloccata e il tentativo
 * muore in timeout, quindi l'ordine non partiva mai. Adesso si passa da Resend
 * (HTTPS, la stessa strada delle altre email del gestionale) e l'SMTP resta
 * solo come ripiego se la chiave Resend non e' configurata.
 */

/** Invio via Resend (HTTPS): nessuna porta SMTP, nessun timeout in uscita. */
async function inviaConResend(to: string, subject: string, text: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY mancante' }
  const from = process.env.RESEND_FROM || 'DR7 Magazzino <noreply@dr7.app>'
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    })
    if (!resp.ok) return { ok: false, error: `Resend ${resp.status}: ${(await resp.text()).slice(0, 300)}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'errore Resend' }
  }
}

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

    const subject = oggetto?.trim() || 'Ordine DR7 — Magazzino'
    const html = `<pre style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;white-space:pre-wrap">${
      testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }</pre>`

    // 1) Resend. 2) Solo se manca la chiave, si prova l'SMTP storico.
    const viaResend = await inviaConResend(dest, subject, testo, html)
    if (viaResend.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, to: dest, canale: 'resend' }) }
    }
    console.warn('[send-magazzino-ordine-email] Resend non disponibile:', viaResend.error)

    await transporter.sendMail({
      from: '"DR7 Magazzino" <info@dr7.app>',
      to: dest,
      subject,
      text: testo,
      html,
    })

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, to: dest, canale: 'smtp' }) }
  } catch (e) {
    console.error('[send-magazzino-ordine-email]', e)
    const msg = e instanceof Error ? e.message : 'Errore invio'
    // ETIMEDOUT/ECONNREFUSED su SMTP: dire "connessione fallita" non aiuta
    // nessuno, il problema e' che manca la configurazione Resend.
    const chiaro = /ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(msg)
      ? 'Invio email non riuscito: la posta in uscita non risponde. Configura RESEND_API_KEY nelle variabili Netlify.'
      : msg
    return { statusCode: 500, headers, body: JSON.stringify({ error: chiaro }) }
  }
}

export { handler }
