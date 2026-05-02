import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Public endpoint — accepts customer self-registration data + the invite token.
 * Validates the token (must be valid, not expired, not used, not revoked),
 * inserts a new customers_extended row, and marks the invite as consumed.
 *
 * Returns the new customer_id so the frontend can chain document uploads
 * (which write into user_documents and route through the existing Verifica
 * Documenti pipeline).
 */
const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    try {
        const body = JSON.parse(event.body || '{}')
        const { token, customer } = body
        if (!token || !customer || typeof customer !== 'object') {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'token e customer obbligatori' }) }
        }

        const { data: invite } = await supabase
            .from('customer_invites')
            .select('id, expires_at, used_at, revoked_at, customer_id')
            .eq('token', token)
            .maybeSingle()
        if (!invite) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Link non trovato' }) }

        const now = new Date()
        if (new Date(invite.expires_at) < now) {
            return { statusCode: 410, headers, body: JSON.stringify({ error: 'Link scaduto' }) }
        }
        if (invite.used_at) {
            return { statusCode: 410, headers, body: JSON.stringify({ error: 'Link già utilizzato' }) }
        }
        if (invite.revoked_at) {
            return { statusCode: 410, headers, body: JSON.stringify({ error: 'Link revocato' }) }
        }

        // Whitelist + trim fields to avoid arbitrary writes
        const ALLOWED_TEXT = [
            'tipo_cliente', 'nome', 'cognome', 'email', 'telefono', 'pec',
            'codice_fiscale', 'numero_patente', 'indirizzo', 'citta', 'cap',
            'provincia', 'nazione', 'ragione_sociale', 'partita_iva',
            'codice_destinatario', 'denominazione', 'codice_ipa',
            'codice_univoco', 'luogo_nascita', 'provincia_nascita', 'note',
        ] as const

        const insert: Record<string, unknown> = { source: 'self_registration' }

        for (const k of ALLOWED_TEXT) {
            const v = customer[k]
            if (typeof v === 'string') {
                const t = v.trim()
                insert[k] = t || null
            }
        }
        // Date fields
        if (customer.data_nascita && typeof customer.data_nascita === 'string') {
            insert.data_nascita = customer.data_nascita
        }
        if (customer.data_emissione_patente && typeof customer.data_emissione_patente === 'string') {
            insert.data_emissione_patente = customer.data_emissione_patente
        }
        if (customer.data_scadenza_patente && typeof customer.data_scadenza_patente === 'string') {
            insert.data_scadenza_patente = customer.data_scadenza_patente
        }

        // Minimum required fields — at least name and contact info
        if (!insert.nome && !insert.ragione_sociale) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome o Ragione Sociale obbligatori' }) }
        }
        if (!insert.telefono && !insert.email) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Telefono o Email obbligatori' }) }
        }

        const { data: customerRow, error: insErr } = await supabase
            .from('customers_extended')
            .insert(insert)
            .select()
            .single()
        if (insErr) {
            console.error('[submit-customer-invite] insert error', insErr)
            return { statusCode: 500, headers, body: JSON.stringify({ error: insErr.message || 'Errore salvataggio' }) }
        }

        // Mark invite as used (best-effort; the row is the source of truth)
        await supabase
            .from('customer_invites')
            .update({
                used_at: new Date().toISOString(),
                customer_id: customerRow.id,
            })
            .eq('id', invite.id)

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, customerId: customerRow.id }),
        }
    } catch (err) {
        console.error('[submit-customer-invite] error', err)
        const msg = err instanceof Error ? err.message : String(err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
