import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { randomUUID } from 'crypto'

/**
 * Autisti registry for the "Uscita Straordinaria" module.
 *
 * Autisti are stored in `customers_extended` tagged `metadata.role = 'autista'`
 * (so they live in the Clienti/Lead anagrafica with the "Autista" specificity)
 * and mirrored into the basic `customers` table (full_name, phone) so they show
 * in the standard client list. This function bypasses RLS with the service role
 * — same pattern the Lead/Clienti tab uses to read `customers_extended`.
 *
 * POST { action: 'list' }                                   → { autisti: [...] }
 * POST { action: 'create', nome, cognome, telefono }        → { autista: {...} }
 */
export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration Error: missing backend env vars.' }) }
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapRow = (r: any) => {
        const name = [r.nome, r.cognome].filter(Boolean).join(' ').trim()
            || r.denominazione || r.ragione_sociale || '—'
        return { id: r.id as string, full_name: name, phone: (r.telefono as string) || '' }
    }

    try {
        const body = JSON.parse(event.body || '{}')
        const action = body.action || 'list'

        if (action === 'list') {
            const { data, error } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, denominazione, ragione_sociale, telefono, metadata')
                .eq('metadata->>role', 'autista')
            if (error) {
                console.error('[autisti] list error:', error)
                return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
            }
            const autisti = (data || []).map(mapRow).sort((a, b) => a.full_name.localeCompare(b.full_name))
            return { statusCode: 200, headers, body: JSON.stringify({ autisti }) }
        }

        if (action === 'create') {
            const nome = String(body.nome || '').trim()
            const cognome = String(body.cognome || '').trim()
            const telefono = String(body.telefono || '').trim()
            const full_name = [nome, cognome].filter(Boolean).join(' ').trim()
            if (!full_name) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome autista mancante' }) }
            }

            const id = randomUUID()
            const nowIso = new Date().toISOString()

            // 1) Clienti/Lead anagrafica (customers_extended) tagged 'autista'
            const { error: extErr } = await supabase.from('customers_extended').insert([{
                id,
                tipo_cliente: 'persona_fisica',
                nome: nome || full_name,
                cognome: cognome || null,
                telefono: telefono || null,
                source: 'admin',
                metadata: { role: 'autista' },
            }])
            if (extErr) {
                console.error('[autisti] create customers_extended error:', extErr)
                return { statusCode: 500, headers, body: JSON.stringify({ error: extErr.message }) }
            }

            // 2) Basic mirror so the autista shows in the standard customers list
            const { error: basicErr } = await supabase.from('customers').insert([{
                id,
                full_name,
                phone: telefono || null,
                created_at: nowIso,
            }])
            if (basicErr) console.warn('[autisti] customers mirror warning:', basicErr.message)

            return { statusCode: 200, headers, body: JSON.stringify({ autista: { id, full_name, phone: telefono } }) }
        }

        if (action === 'set_role') {
            // Tagga / de-tagga un cliente esistente come autista (metadata.role).
            const customerId = String(body.customerId || '').trim()
            const isAutista = body.isAutista !== false // default true
            if (!customerId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'customerId mancante' }) }
            }
            const { data: row, error: getErr } = await supabase
                .from('customers_extended')
                .select('metadata')
                .eq('id', customerId)
                .maybeSingle()
            if (getErr) {
                return { statusCode: 500, headers, body: JSON.stringify({ error: getErr.message }) }
            }
            const meta = (row?.metadata && typeof row.metadata === 'object') ? { ...row.metadata } : {}
            if (isAutista) meta.role = 'autista'
            else if (meta.role === 'autista') delete meta.role
            const { error: updErr } = await supabase
                .from('customers_extended')
                .update({ metadata: meta })
                .eq('id', customerId)
            if (updErr) {
                return { statusCode: 500, headers, body: JSON.stringify({ error: updErr.message }) }
            }
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, isAutista }) }
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) }
    } catch (e) {
        console.error('[autisti] handler error:', e)
        return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : 'Errore interno' }) }
    }
}
