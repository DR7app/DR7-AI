import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'
import { removeCard } from './utils/nexiCards'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Rimuove il riferimento a una carta tokenizzata che Nexi non riconosce
 * piu\' (orphan). Pulisce:
 *  - customers_extended.metadata.nexi_contract_id (rimuove la chiave)
 *  - nexi_transactions.status -> 'orphan_removed' (cosi\' resta tracciato)
 *
 * Usato dal pulsante "Rimuovi riferimento" della diagnostica quando
 * /operations restituisce 0 ops e maskedPan vuoto.
 */
const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { contractId } = JSON.parse(event.body || '{}')
        if (!contractId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'contractId richiesto' }) }
        }

        let affected = 0

        // 1) Pulisce customers_extended: trova ogni cliente che referenzia
        //    questo contractId — sia come carta flat/default sia DENTRO
        //    l'array metadata.nexi_cards (multi-carta). removeCard toglie la
        //    carta dall'array e, se era la default, promuove la piu' recente
        //    rimasta (o azzera le chiavi flat se non resta nessuna carta).
        const seen = new Set<string>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const targets: Array<{ id: string; metadata: any }> = []
        const { data: byFlat } = await supabase
            .from('customers_extended')
            .select('id, metadata')
            .filter('metadata->>nexi_contract_id', 'eq', contractId)
        const { data: byArray } = await supabase
            .from('customers_extended')
            .select('id, metadata')
            .filter('metadata->nexi_cards', 'cs', JSON.stringify([{ contractId }]))
        for (const c of ([...(byFlat || []), ...(byArray || [])] as Array<{ id: string; metadata: unknown }>)) {
            if (seen.has(c.id)) continue
            seen.add(c.id)
            targets.push(c)
        }
        for (const c of targets) {
            const m = removeCard(c.metadata, contractId)
            const { error } = await supabase
                .from('customers_extended')
                .update({ metadata: m, updated_at: new Date().toISOString() })
                .eq('id', c.id)
            if (!error) affected++
        }

        // 2) Marca tutte le nexi_transactions con questo contract_id come
        //    orphan_removed (non le cancello, resta traccia).
        const { data: txRows } = await supabase
            .from('nexi_transactions')
            .select('id, metadata')
            .filter('metadata->>contract_id', 'eq', contractId)

        for (const t of (txRows || [])) {
            const m = { ...(t.metadata || {}), orphan_removed_at: new Date().toISOString() }
            const { error } = await supabase
                .from('nexi_transactions')
                .update({ status: 'orphan_removed', metadata: m })
                .eq('id', t.id)
            if (!error) affected++
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, affected, contractId })
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[nexi-forget-card] Error:', msg)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
