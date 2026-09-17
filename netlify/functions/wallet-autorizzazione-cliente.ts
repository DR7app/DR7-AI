import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { randomInt } from 'crypto'
import { requireAuth } from './require-auth'
import { getEmailFrom } from './utils/emailFrom'

// 17/09/2026 (direzione): pagare una prenotazione col Credit Wallet richiede
// l'autorizzazione del CLIENTE, non della direzione. Il codice parte per email
// all'indirizzo della scheda cliente (customers_extended) e il cliente lo
// detta all'operatore. Nessun bypass: il consenso e' del titolare del wallet.
//
// Si appoggia alla tabella limitation_overrides, come gli altri OTP del
// gestionale (limitation_code = 'wallet_autorizzazione_cliente').
//
// action 'send'   { customerId? | userId? | email?, importo, draftSessionId }
//                 -> { overrideId, email, customerId } | 422 { emailMancante, customerId }
//                 Il cliente si cerca per id scheda, poi per account sito, poi
//                 per email: non tutte le schermate hanno l'id della scheda.
// action 'verify' { overrideId, code } -> { success, customerId, importo }
// action 'residuo' { overrideId } -> { valido, customerId, residuo }
//                 Quanto resta di un codice gia' confermato: il database lo
//                 scala a ogni prelievo (dr7_wallet_consuma_autorizzazione).

const LIMITATION_CODE = 'wallet_autorizzazione_cliente'
const OTP_TTL_MINUTES = 10
const MAX_TENTATIVI = 5
const MAX_INVII_PER_FINESTRA = 3

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function mascheraEmail(email: string): string {
  const [nome, dominio] = email.split('@')
  if (!dominio) return email
  const visibile = nome.slice(0, 2)
  return `${visibile}${'*'.repeat(Math.max(1, nome.length - 2))}@${dominio}`
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const { user: authUser, error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    const body = JSON.parse(event.body || '{}')

    if (body.action === 'send') {
      const { draftSessionId } = body
      const importo = Math.round((Number(body.importo) || 0) * 100) / 100
      if (!(body.customerId || body.userId || body.email) || !draftSessionId || importo <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Dati mancanti: cliente, sessione o importo' }) }
      }

      // L'indirizzo si legge qui dalla scheda, mai dal browser: il codice deve
      // arrivare al titolare del wallet, non a un indirizzo digitato a caso.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cliente: any = null
      if (body.customerId) {
        const { data } = await supabase.from('customers_extended').select('*').eq('id', body.customerId).maybeSingle()
        cliente = data
      }
      if (!cliente && body.userId) {
        const { data } = await supabase.from('customers_extended').select('*').eq('user_id', body.userId).limit(1)
        cliente = data?.[0] || null
      }
      if (!cliente && typeof body.email === 'string' && body.email.includes('@')) {
        const { data } = await supabase.from('customers_extended').select('*').ilike('email', body.email.trim()).limit(1)
        cliente = data?.[0] || null
      }

      if (!cliente) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cliente non trovato in Lead' }) }
      }
      const customerId = cliente.id as string
      const email = String(cliente.email || '').trim()
      if (!email || !email.includes('@')) {
        return { statusCode: 422, headers, body: JSON.stringify({ emailMancante: true, customerId, error: 'Email del cliente mancante' }) }
      }

      const finestra = new Date(Date.now() - OTP_TTL_MINUTES * 60 * 1000).toISOString()
      const { count } = await supabase
        .from('limitation_overrides')
        .select('id', { count: 'exact', head: true })
        .eq('limitation_code', LIMITATION_CODE)
        .eq('action_context', customerId)
        .gte('created_at', finestra)
      if ((count || 0) >= MAX_INVII_PER_FINESTRA) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: `Troppi codici inviati. Riprova tra ${OTP_TTL_MINUTES} minuti.` }) }
      }

      const nomeCliente = cliente.tipo_cliente === 'azienda' && cliente.denominazione
        ? cliente.denominazione
        : [cliente.nome, cliente.cognome].filter(Boolean).join(' ')

      const code = String(randomInt(100000, 999999))
      const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

      const { data: riga, error: insertErr } = await supabase
        .from('limitation_overrides')
        .insert({
          limitation_code: LIMITATION_CODE,
          action_context: customerId,
          draft_session_id: draftSessionId,
          flow_type: 'wallet_cliente',
          status: 'pending',
          otp_code: code,
          otp_verified: false,
          otp_expires_at: otpExpiresAt,
          expires_at: otpExpiresAt,
          approved_by_user_id: authUser!.id !== 'admin' ? authUser!.id : null,
          metadata: {
            customer_id: customerId,
            importo,
            email,
            requested_by: authUser!.email,
          }
        })
        .select('id')
        .single()

      if (insertErr || !riga) {
        console.error('[wallet-autorizzazione-cliente] insert error:', insertErr)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Impossibile creare la richiesta di autorizzazione' }) }
      }

      const apiKey = process.env.RESEND_API_KEY
      if (!apiKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY non configurata' }) }
      }
      const resend = new Resend(apiKey)
      const { error: emailError } = await resend.emails.send({
        from: await getEmailFrom('DR7 <info@dr7.app>'),
        to: email,
        subject: `DR7 — Codice di autorizzazione Credit Wallet ${euro(importo)}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #000; border-radius: 12px; padding: 24px 16px; text-align: center; margin-bottom: 30px;">
              <img src="https://dr7.app/DR7logo1.png" alt="DR7" style="height: 60px; display: block; margin: 0 auto;" />
            </div>
            <h2 style="color: #111; text-align: center;">Autorizzazione pagamento con Credit Wallet</h2>
            <p style="color: #444; text-align: center;">
              ${nomeCliente ? `Gentile ${nomeCliente}, un` : 'Un'} operatore DR7 sta per addebitare
              <strong>${euro(importo)}</strong> sul tuo Credit Wallet.
              Se sei d'accordo, comunica questo codice all'operatore.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <div style="display: inline-block; background: #f5f5f5; padding: 16px 32px; border-radius: 12px; letter-spacing: 6px; font-size: 28px; font-weight: 700; color: #111; border: 2px solid #19C2D6;">
                ${code}
              </div>
            </div>
            <p style="color: #888; font-size: 12px; text-align: center;">
              Codice valido ${OTP_TTL_MINUTES} minuti. Se non hai richiesto nulla, ignora questa email: senza il codice non viene addebitato niente.
            </p>
          </div>
        `,
      })

      if (emailError) {
        console.error('[wallet-autorizzazione-cliente] Resend error:', emailError)
        await supabase.from('limitation_overrides').update({ status: 'expired' }).eq('id', riga.id)
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Invio email non riuscito: ${emailError.message}` }) }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, overrideId: riga.id, email: mascheraEmail(email), customerId }) }
    }

    if (body.action === 'verify') {
      const { overrideId } = body
      const code = String(body.code || '').trim()
      if (!overrideId || !code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Codice mancante' }) }
      }

      const { data: riga } = await supabase
        .from('limitation_overrides')
        .select('*')
        .eq('id', overrideId)
        .eq('limitation_code', LIMITATION_CODE)
        .maybeSingle()

      if (!riga) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Richiesta non trovata. Invia un nuovo codice.' }) }
      }
      const meta = (riga.metadata || {}) as { customer_id?: string; importo?: number }
      const risposta = { success: true, customerId: meta.customer_id, importo: meta.importo }

      if (riga.otp_verified) {
        return { statusCode: 200, headers, body: JSON.stringify(risposta) }
      }
      if (riga.status !== 'pending') {
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Codice non piu\' valido. Invia un nuovo codice.' }) }
      }
      if (new Date(riga.otp_expires_at) < new Date()) {
        await supabase.from('limitation_overrides').update({ status: 'expired' }).eq('id', overrideId)
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Codice scaduto. Invia un nuovo codice.' }) }
      }
      if ((riga.otp_attempts || 0) >= MAX_TENTATIVI) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Troppi tentativi. Invia un nuovo codice.' }) }
      }

      await supabase
        .from('limitation_overrides')
        .update({ otp_attempts: (riga.otp_attempts || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', overrideId)

      if (code !== riga.otp_code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Codice non valido' }) }
      }

      const ora = new Date().toISOString()
      await supabase
        .from('limitation_overrides')
        .update({ otp_verified: true, status: 'active', approved_at: ora, updated_at: ora })
        .eq('id', overrideId)

      return { statusCode: 200, headers, body: JSON.stringify(risposta) }
    }

    if (body.action === 'residuo') {
      const { data: riga } = await supabase
        .from('limitation_overrides')
        .select('otp_verified, status, metadata')
        .eq('id', body.overrideId || '00000000-0000-0000-0000-000000000000')
        .eq('limitation_code', LIMITATION_CODE)
        .maybeSingle()
      const meta = (riga?.metadata || {}) as { customer_id?: string; importo?: number; residuo?: number }
      const residuo = Number(meta.residuo ?? meta.importo ?? 0) || 0
      const valido = !!riga?.otp_verified && riga.status !== 'consumed' && riga.status !== 'revoked' && residuo > 0
      return { statusCode: 200, headers, body: JSON.stringify({ valido, customerId: meta.customer_id || null, residuo }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Azione non valida' }) }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[wallet-autorizzazione-cliente] error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
  }
}
