/**
 * EMTN — POST /emtn-otp-request
 *
 * Genera OTP a 6 cifre, lo invia al cliente via email (Resend) o
 * WhatsApp (Green API), salva HASH (mai chiaro) in emtn_otp_requests.
 * TTL: 10 minuti.
 *
 * Body: { clientId, bookingId, email?, phone? }   (almeno uno dei due)
 * Returns: { id, expiresAt }
 */
import { Handler } from '@netlify/functions'
import { Resend } from 'resend'
import { requireAuth } from './require-auth'
import {
    audit,
    clientIp,
    generateOtpCode,
    getServiceSupabase,
    hashOtpCode,
    jsonResponse,
} from './utils/emtn'

const OTP_TTL_MINUTES = 10

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)

    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorId = user!.id
    const operatorEmail = user!.email

    const sb = getServiceSupabase()
    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return null } })()
    if (!body) return jsonResponse(400, { error: 'JSON body invalido' }, origin)

    const clientId = String(body.clientId || '').trim()
    const email = body.email ? String(body.email).trim() : null
    const phone = body.phone ? String(body.phone).trim() : null

    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    if (!clientId) {
        return jsonResponse(400, { error: 'clientId obbligatorio' }, origin)
    }
    if (!email && !phone) {
        return jsonResponse(400, { error: 'Almeno uno tra email e phone richiesto' }, origin)
    }

    // Genera codice + hash.
    const code = generateOtpCode()
    const codeHash = hashOtpCode(code)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)

    const { data: row, error: insErr } = await sb
        .from('emtn_otp_requests')
        .insert({
            client_id: clientId,
            operator_id: operatorId,
            email,
            phone,
            otp_code_hash: codeHash,
            expires_at: expiresAt.toISOString(),
        })
        .select('id, expires_at')
        .single()

    if (insErr || !row) {
        await audit(sb, { operatorId, operatorEmail, clientId, action: 'REQUEST_OTP', success: false, ip, userAgent: ua, metadata: { reason: 'insert_failed' } })
        return jsonResponse(500, { error: 'OTP request fallita' }, origin)
    }

    // Invia. Best-effort: se uno dei due canali fallisce ma l'altro
    // riesce, consideriamo il request OK.
    let sentVia: string[] = []
    const errors: string[] = []

    if (email) {
        try {
            const apiKey = process.env.RESEND_API_KEY
            if (!apiKey) throw new Error('RESEND_API_KEY mancante')
            const resend = new Resend(apiKey)
            await resend.emails.send({
                from: 'DR7 <info@dr7.app>',
                to: email,
                subject: 'EMTN — Codice di autorizzazione consultazione',
                html: `
                    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                      <div style="background: #000; border-radius: 12px; padding: 24px 16px; text-align: center; margin-bottom: 30px;">
                        <img src="https://admin.dr7empire.com/og-image.png" alt="DR7" style="height: 50px; display: block; margin: 0 auto;" />
                      </div>
                      <h2 style="color: #111; text-align: center;">Autorizzazione richiesta</h2>
                      <p style="color: #444; text-align: center;">
                        Un operatore DR7 sta richiedendo la tua autorizzazione per consultare lo
                        storico EMTN (European Mobility Trust Network). Comunica questo codice
                        all'operatore se sei d'accordo.
                      </p>
                      <div style="text-align: center; margin: 24px 0;">
                        <div style="display: inline-block; background: #f5f5f5; padding: 16px 32px; border-radius: 12px; letter-spacing: 6px; font-size: 28px; font-weight: 700; color: #111; border: 2px solid #19C2D6;">
                          ${code}
                        </div>
                      </div>
                      <p style="color: #888; font-size: 12px; text-align: center;">Codice valido ${OTP_TTL_MINUTES} minuti.</p>
                    </div>
                `,
            })
            sentVia.push('email')
        } catch (err) {
            errors.push(`email: ${(err as Error).message}`)
        }
    }

    if (phone) {
        try {
            const greenInstance = process.env.GREEN_API_INSTANCE_ID
            const greenToken = process.env.GREEN_API_TOKEN
            if (!greenInstance || !greenToken) throw new Error('Green API non configurata')
            const normPhone = phone.replace(/\D/g, '').replace(/^00/, '')
            const chatId = `${normPhone.length === 10 ? '39' + normPhone : normPhone}@c.us`
            const url = `https://api.green-api.com/waInstance${greenInstance}/sendMessage/${greenToken}`
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId,
                    message: `DR7 EMTN — Codice autorizzazione: *${code}*\n\nValido ${OTP_TTL_MINUTES} minuti. Comunicalo all'operatore se autorizzi la consultazione del tuo storico.`,
                }),
            })
            if (!res.ok) throw new Error(`Green API ${res.status}`)
            sentVia.push('whatsapp')
        } catch (err) {
            errors.push(`whatsapp: ${(err as Error).message}`)
        }
    }

    if (sentVia.length === 0) {
        // Soft fail: il record OTP esiste ma nessun canale ha funzionato.
        // Lo marchiamo come fallito invalidando expires_at, e segnaliamo errore.
        await sb.from('emtn_otp_requests').update({ expires_at: new Date().toISOString() }).eq('id', row.id)
        await audit(sb, { operatorId, operatorEmail, clientId, action: 'REQUEST_OTP', success: false, ip, userAgent: ua, metadata: { errors } })
        return jsonResponse(502, { error: 'Invio OTP fallito su tutti i canali', details: errors }, origin)
    }

    await audit(sb, {
        operatorId, operatorEmail, clientId, action: 'REQUEST_OTP',
        success: true, ip, userAgent: ua,
        metadata: { otp_request_id: row.id, sent_via: sentVia, soft_errors: errors },
    })

    return jsonResponse(200, {
        id: row.id,
        expiresAt: row.expires_at,
        sentVia,
    }, origin)
}
