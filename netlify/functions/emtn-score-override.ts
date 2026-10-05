/**
 * EMTN — POST /emtn-score-override
 *
 * 01/10/2026 (direzione): intervento manuale sull'EMTN Score. Solo la
 * direzione. Motivo obbligatorio (min 10 caratteri), mai cancellato: si
 * revoca e la riga resta. Il ricalcolo successivo (emtn-search) salva in
 * emtn_score_storico il prima/dopo con il riferimento all'override.
 *
 * Body:
 *   { azione: 'crea', clientId, tipo: 'limite_massimo'|'score_fisso'|'flag_critico', valore?, motivo, scadeIl? }
 *   { azione: 'revoca', overrideId }
 *   { azione: 'lista', clientId }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { getServiceSupabase, jsonResponse } from './utils/emtn'
import { userHasRole } from './utils/adminRoles'
import { copiaDellaRete } from './utils/emtnRete'

const TIPI = new Set(['limite_massimo', 'score_fisso', 'flag_critico'])

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)
    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorEmail = user!.email || null
    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return null } })() as Record<string, unknown> | null
    if (!body) return jsonResponse(400, { error: 'JSON body invalido' }, origin)
    const sb = getServiceSupabase()

    if (body.azione === 'lista') {
        const clientId = String(body.clientId || '')
        if (!clientId) return jsonResponse(400, { error: 'clientId mancante' }, origin)
        const { data, error } = await sb.from('emtn_score_override')
            .select('id, tipo, valore, motivo, operatore_email, attivo, scade_il, revocato_il, revocato_da, created_at')
            .eq('client_id', clientId).order('created_at', { ascending: false }).limit(20)
        if (error) return jsonResponse(500, { error: error.message }, origin)
        return jsonResponse(200, { override: data || [] }, origin)
    }

    if (copiaDellaRete()) {
        return jsonResponse(403, { error: 'EMTN in sola consultazione: lo score non si modifica a mano' }, origin)
    }
    if (!(await userHasRole(operatorEmail || '', 'direzione'))) {
        return jsonResponse(403, { error: 'Solo la direzione puo\' modificare l\'EMTN Score' }, origin)
    }

    if (body.azione === 'crea') {
        const clientId = String(body.clientId || '')
        const tipo = String(body.tipo || '')
        const motivo = String(body.motivo || '').trim()
        const valore = body.valore == null || body.valore === '' ? null : Math.round(Number(body.valore))
        if (!clientId) return jsonResponse(400, { error: 'clientId mancante' }, origin)
        if (!TIPI.has(tipo)) return jsonResponse(400, { error: 'Tipo di intervento non valido' }, origin)
        if (motivo.length < 10) return jsonResponse(400, { error: 'Motivo obbligatorio (almeno 10 caratteri)' }, origin)
        // Anche per il flag critico: il valore e' il tetto dello score (0 = azzerato).
        if (valore == null || !Number.isFinite(valore)) return jsonResponse(400, { error: 'Valore obbligatorio (0-100)' }, origin)
        if (valore != null && (valore < 0 || valore > 100)) return jsonResponse(400, { error: 'Valore tra 0 e 100' }, origin)
        const scadeIl = typeof body.scadeIl === 'string' && body.scadeIl ? body.scadeIl : null
        // Prima si inserisce il nuovo, poi si revocano gli altri: se
        // l'inserimento fallisce il precedente resta attivo.
        const { data, error } = await sb.from('emtn_score_override').insert({
            client_id: clientId, tipo, valore, motivo,
            operatore_id: user!.id, operatore_email: operatorEmail, scade_il: scadeIl,
        }).select('id').maybeSingle()
        if (error || !data) return jsonResponse(500, { error: error?.message || 'Intervento non salvato' }, origin)
        await sb.from('emtn_score_override')
            .update({ attivo: false, revocato_il: new Date().toISOString(), revocato_da: operatorEmail })
            .eq('client_id', clientId).eq('attivo', true).neq('id', data.id)
        return jsonResponse(200, { ok: true, id: data.id }, origin)
    }

    if (body.azione === 'revoca') {
        const id = String(body.overrideId || '')
        if (!id) return jsonResponse(400, { error: 'overrideId mancante' }, origin)
        // Solo un intervento ancora attivo: la prima revoca resta nella traccia.
        const { data, error } = await sb.from('emtn_score_override')
            .update({ attivo: false, revocato_il: new Date().toISOString(), revocato_da: operatorEmail })
            .eq('id', id).eq('attivo', true)
            .select('id')
        if (error) return jsonResponse(500, { error: error.message }, origin)
        if (!data || data.length === 0) return jsonResponse(404, { error: 'Intervento non trovato o gia\' revocato' }, origin)
        return jsonResponse(200, { ok: true }, origin)
    }

    return jsonResponse(400, { error: 'Azione non valida' }, origin)
}
