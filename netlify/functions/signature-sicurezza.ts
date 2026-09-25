import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { richiediStaff } from './utils/firmaStaff'
import { leggiSicurezzaFirma } from './utils/firmaSicurezza'

/**
 * Sicurezza Firma (gestionale, 25/09/2026).
 *
 * GET  ?contractId= | ?requestId=   → stato di sicurezza di ogni richiesta
 *      (stesso modello dell'audit trail: utils/firmaSicurezza.ts)
 * POST { azione: 'autorizza_cambio', requestId, motivo? }
 *      → per 30 minuti un nuovo dispositivo puo' legarsi al link, ma solo
 *        dopo il codice inviato al recapito registrato del firmatario
 *        (dr7trust.com utils/dispositivo.ts). Il vecchio decade quando il
 *        nuovo supera la verifica.
 * POST { azione: 'revoca_link', requestId, motivo? }
 *      → il link non si apre piu' (ne' contratto, ne' OTP, ne' firma) e la
 *        sessione del dispositivo legata al link decade con lui.
 *
 * "Genera nuovo link" non passa di qui: e' il rinvio che il gestionale gia'
 * usa (signature-init / document-sign-init), che annulla i link precedenti.
 */

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
    const staff = await richiediStaff(event as any)
    if (staff.risposta) return staff.risposta

    try {
        if (event.httpMethod === 'GET') {
            const { contractId, requestId } = event.queryStringParameters || {}
            if (!contractId && !requestId) {
                return { statusCode: 400, body: JSON.stringify({ error: 'contractId o requestId richiesto' }) }
            }
            const dati = await leggiSicurezzaFirma(supabase, { contractId, requestId }, { verificaFile: false })
            if (!dati) return { statusCode: 404, body: JSON.stringify({ error: 'Nessuna richiesta di firma trovata' }) }
            return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(dati) }
        }

        if (event.httpMethod !== 'POST') {
            return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
        }

        const { azione, requestId, motivo } = JSON.parse(event.body || '{}')
        if ((azione !== 'revoca_link' && azione !== 'autorizza_cambio') || !requestId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Azione non valida' }) }
        }
        const motivoPulito = typeof motivo === 'string' ? motivo.trim().slice(0, 300) : ''

        if (azione === 'autorizza_cambio') {
            const ora = new Date().toISOString()
            const { data: aggiornate, error } = await supabase
                .from('signature_requests')
                .update({ rebind_authorized_at: ora, rebind_authorized_by: staff.email, updated_at: ora })
                .eq('id', requestId)
                .is('revoked_at', null)
                .not('status', 'in', '(signed,cancelled,superseded,expired)')
                .select('id, device_label, device_id, device_session_hash')
            if (error) throw error
            if (!aggiornate || !aggiornate.length) {
                return { statusCode: 409, body: JSON.stringify({ error: 'Link gia\' firmato, scaduto, annullato o revocato' }) }
            }
            const r = aggiornate[0]
            if (!r.device_label && !r.device_id && !r.device_session_hash) {
                // Nessun dispositivo legato: non c'e' niente da cambiare.
                await supabase.from('signature_requests')
                    .update({ rebind_authorized_at: null, rebind_authorized_by: null })
                    .eq('id', requestId)
                return { statusCode: 409, body: JSON.stringify({ error: 'Nessun dispositivo ancora associato: il cliente puo\' aprire il link e verificarsi con il codice.' }) }
            }
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: requestId,
                event_type: 'device_rebind_authorized',
                event_description: `Cambio dispositivo autorizzato dallo staff DR7 (${staff.email})${motivoPulito ? `: ${motivoPulito}` : ''}. ` +
                    `Per 30 minuti un nuovo dispositivo puo' associarsi solo dopo il codice inviato al recapito registrato; la sessione ${r.device_label || 'precedente'} resta valida fino ad allora.`,
                device_label: r.device_label || null,
                metadata: { staff: staff.email, motivo: motivoPulito || null, intervento_manuale: true, previous_device_label: r.device_label || null, valido_minuti: 30 },
            })
            return { statusCode: 200, body: JSON.stringify({ success: true }) }
        }

        const ora = new Date().toISOString()
        const { data: revocate, error } = await supabase
            .from('signature_requests')
            .update({
                revoked_at: ora,
                revoked_by: staff.email,
                revoke_reason: motivoPulito || null,
                status: 'cancelled',
                updated_at: ora,
            })
            .eq('id', requestId)
            .is('revoked_at', null)
            .not('status', 'in', '(signed,cancelled,superseded)')
            .select('id, device_label, device_id')
        if (error) throw error
        if (!revocate || !revocate.length) {
            return { statusCode: 409, body: JSON.stringify({ error: 'Link gia\' firmato, annullato o revocato' }) }
        }

        const r = revocate[0]
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: requestId,
            event_type: 'link_revoked',
            event_description: `Link di firma revocato dallo staff DR7 (${staff.email})${motivoPulito ? `: ${motivoPulito}` : ''}`,
            device_label: r.device_label || null,
            metadata: { staff: staff.email, motivo: motivoPulito || null, intervento_manuale: true },
        })
        if (r.device_label || r.device_id) {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: requestId,
                event_type: 'session_revoked',
                event_description: `Sessione ${r.device_label || 'del dispositivo'} revocata insieme al link`,
                device_label: r.device_label || null,
                metadata: { staff: staff.email, intervento_manuale: true },
            })
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) }
    } catch (error: any) {
        console.error('Error in signature-sicurezza:', error)
        return { statusCode: 500, body: JSON.stringify({ error: 'Errore sicurezza firma', details: error.message }) }
    }
}
