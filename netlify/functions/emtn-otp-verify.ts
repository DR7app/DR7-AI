/**
 * EMTN — POST /emtn-otp-verify
 *
 * Confronta hash(code) con emtn_otp_requests.otp_code_hash. Se match
 * e non scaduto e non gia' verified, marca verified=true.
 *
 * Anti-bruteforce: contatore attempts; oltre 5 tentativi falliti su una
 * singola riga, l'OTP viene invalidato (expires_at = now()).
 *
 * Body: { otpRequestId, code }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit, clientIp, getServiceSupabase, hashOtpCode, jsonResponse,
} from './utils/emtn'

const MAX_ATTEMPTS = 5

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

    const otpRequestId = String(body.otpRequestId || '').trim()
    const code = String(body.code || '').trim()
    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    if (!otpRequestId || !code) {
        return jsonResponse(400, { error: 'otpRequestId e code obbligatori' }, origin)
    }

    const { data: req } = await sb
        .from('emtn_otp_requests')
        .select('id, client_id, operator_id, booking_id, otp_code_hash, expires_at, verified, attempts')
        .eq('id', otpRequestId)
        .maybeSingle()

    if (!req) {
        await audit(sb, { operatorId, operatorEmail, action: 'VERIFY_OTP', success: false, ip, userAgent: ua, metadata: { reason: 'not_found' } })
        return jsonResponse(404, { error: 'OTP request non trovato' }, origin)
    }

    // Solo l'operatore che ha originato la richiesta puo' verificarla.
    if (req.operator_id !== operatorId) {
        await audit(sb, { operatorId, operatorEmail, action: 'VERIFY_OTP', success: false, ip, userAgent: ua, metadata: { reason: 'operator_mismatch' } })
        return jsonResponse(403, { error: 'Non autorizzato a verificare questo OTP' }, origin)
    }

    if (req.verified) {
        // Idempotenza: gia' verificato precedentemente -> ok ma non riemettiamo.
        return jsonResponse(200, { ok: true, alreadyVerified: true, clientId: req.client_id }, origin)
    }

    if (new Date(req.expires_at).getTime() <= Date.now()) {
        await audit(sb, { operatorId, operatorEmail, clientId: req.client_id, bookingId: req.booking_id, action: 'VERIFY_OTP', success: false, ip, userAgent: ua, metadata: { reason: 'expired' } })
        return jsonResponse(410, { error: 'OTP scaduto' }, origin)
    }

    if ((req.attempts || 0) >= MAX_ATTEMPTS) {
        // Invalida l'OTP e blocca.
        await sb.from('emtn_otp_requests').update({ expires_at: new Date().toISOString() }).eq('id', req.id)
        await audit(sb, { operatorId, operatorEmail, clientId: req.client_id, bookingId: req.booking_id, action: 'VERIFY_OTP', success: false, ip, userAgent: ua, metadata: { reason: 'max_attempts' } })
        return jsonResponse(429, { error: 'Troppi tentativi. Richiedi un nuovo OTP.' }, origin)
    }

    const hash = hashOtpCode(code)
    if (hash !== req.otp_code_hash) {
        await sb.from('emtn_otp_requests')
            .update({ attempts: (req.attempts || 0) + 1 })
            .eq('id', req.id)
        await audit(sb, { operatorId, operatorEmail, clientId: req.client_id, bookingId: req.booking_id, action: 'VERIFY_OTP', success: false, ip, userAgent: ua, metadata: { reason: 'wrong_code', attempts: (req.attempts || 0) + 1 } })
        return jsonResponse(401, { error: 'Codice non valido' }, origin)
    }

    // OK
    await sb.from('emtn_otp_requests')
        .update({ verified: true, verified_at: new Date().toISOString() })
        .eq('id', req.id)

    await audit(sb, {
        operatorId, operatorEmail, clientId: req.client_id, bookingId: req.booking_id,
        action: 'VERIFY_OTP', success: true, ip, userAgent: ua,
    })

    return jsonResponse(200, { ok: true, clientId: req.client_id }, origin)
}
