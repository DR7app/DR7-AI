import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { richiediStaff } from './utils/firmaStaff'
import { leggiSicurezzaFirma } from './utils/firmaSicurezza'

/**
 * Sicurezza Firma (gestionale, 25/09/2026).
 *
 * GET  ?contractId= | ?requestId=   → stato di sicurezza di ogni richiesta
 *      (stesso modello dell'audit trail: utils/firmaSicurezza.ts)
 * POST { azione: 'revoca_link', requestId, motivo? }
 *      → il link non si apre piu' (ne' contratto, ne' OTP, ne' firma) e la
 *        sessione del dispositivo legata al link decade con lui.
 *
 * "Genera nuovo link" non passa di qui: e' il rinvio che il gestionale gia'
 * usa (signature-init / document-sign-init), che annulla i link precedenti.
 * Il cambio di dispositivo non si autorizza: per un altro dispositivo si
 * manda un link nuovo (scelta della direzione, 25/09/2026).
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
        if (azione !== 'revoca_link' || !requestId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Azione non valida' }) }
        }
        const motivoPulito = typeof motivo === 'string' ? motivo.trim().slice(0, 300) : ''

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
