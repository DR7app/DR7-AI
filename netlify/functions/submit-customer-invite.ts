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

        // Whitelist + trim fields to avoid arbitrary writes. Estesa per
        // matchare i campi del NewClientModal usato nell'admin (sesso,
        // numero_civico, ente_ufficio, citta_nascita) cosi' i clienti che
        // si auto-registrano popolano gli stessi campi che direzione vede
        // dall'admin senza dover completare a mano dopo.
        const ALLOWED_TEXT = [
            'tipo_cliente', 'nome', 'cognome', 'email', 'telefono', 'pec',
            'codice_fiscale', 'numero_patente', 'indirizzo', 'numero_civico',
            'citta', 'cap', 'codice_postale', 'provincia', 'nazione',
            'ragione_sociale', 'partita_iva', 'codice_destinatario',
            'denominazione', 'codice_ipa', 'codice_univoco', 'sesso',
            'luogo_nascita', 'citta_nascita', 'provincia_nascita',
            'ente_ufficio', 'note',
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

        // ─── Required fields validation ──────────────────────────────────
        // Both privati and aziende must provide enough info to actually
        // contact the customer and bill them. The form mirrors these on
        // the client side; this is the authoritative server-side check.
        // Allineato al CHECK constraint su customers_extended.tipo_cliente:
        // accetta solo 'persona_fisica' | 'azienda' | 'pubblica_amministrazione'.
        const tipoCliente = (insert.tipo_cliente as string) || 'persona_fisica'
        if (!['persona_fisica', 'azienda', 'pubblica_amministrazione'].includes(tipoCliente)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: `tipo_cliente non valido: ${tipoCliente}` }) }
        }
        insert.tipo_cliente = tipoCliente
        const missing: string[] = []

        // Common to all: phone + email + address
        if (!insert.telefono) missing.push('Telefono')
        if (!insert.email) missing.push('Email')
        if (!insert.indirizzo) missing.push('Indirizzo')
        if (!insert.citta) missing.push('Città')
        if (!insert.cap) missing.push('CAP')
        if (!insert.provincia) missing.push('Provincia')

        if (tipoCliente === 'azienda') {
            if (!insert.ragione_sociale) missing.push('Ragione sociale')
            if (!insert.partita_iva) missing.push('P.IVA')
            if (!insert.pec && !insert.codice_destinatario) {
                missing.push('PEC oppure Codice Destinatario SDI')
            }
        } else if (tipoCliente === 'pubblica_amministrazione') {
            if (!insert.ente_ufficio && !insert.ragione_sociale && !insert.denominazione) missing.push('Ente / Ufficio')
            if (!insert.codice_univoco && !insert.codice_ipa) missing.push('Codice Univoco IPA')
        } else {
            // persona_fisica
            if (!insert.nome) missing.push('Nome')
            if (!insert.cognome) missing.push('Cognome')
            if (!insert.codice_fiscale) missing.push('Codice Fiscale')
            if (!insert.data_nascita) missing.push('Data di nascita')
            if (!insert.luogo_nascita) missing.push('Luogo di nascita')
        }

        if (missing.length > 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: `Campi obbligatori mancanti: ${missing.join(', ')}` }),
            }
        }

        // Minimal sanity checks
        if (typeof insert.telefono === 'string' && insert.telefono.replace(/\D/g, '').length < 8) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Numero di telefono non valido' }) }
        }
        if (typeof insert.email === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(insert.email)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email non valida' }) }
        }
        if (typeof insert.codice_fiscale === 'string' && insert.codice_fiscale.length > 0 && insert.codice_fiscale.length !== 16) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Codice Fiscale deve essere di 16 caratteri' }) }
        }
        if (typeof insert.partita_iva === 'string' && insert.partita_iva.length > 0 && !/^\d{11}$/.test(insert.partita_iva)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'P.IVA deve essere di 11 cifre' }) }
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
