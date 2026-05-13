import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const NEXI_API_KEY = process.env.NEXI_API_KEY!
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1'

/**
 * Verifica TUTTE le carte tokenizzate (customers_extended.metadata.nexi_contract_id)
 * contro Nexi. Per ogni contractId:
 *   - GET /orders/{id}/operations
 *   - Se HTTP 404 o 0 operazioni: marca come orfano
 *
 * Body:
 *   { dryRun?: boolean }  // default false: pulisce davvero
 *
 * Response:
 *   { checked, alive, orphans: [{ contractId, customerId, email }], cleaned }
 *
 * Quando dryRun=false rimuove metadata.nexi_contract_id dai clienti orfani
 * e marca nexi_transactions con quel contract_id come status='orphan_removed'.
 */
const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { dryRun = false } = JSON.parse(event.body || '{}')

        // Carico TUTTI i clienti con nexi_contract_id valorizzato.
        const { data: customers, error } = await supabase
            .from('customers_extended')
            .select('id, email, full_name, nome, cognome, metadata')
            .not('metadata->>nexi_contract_id', 'is', null)

        if (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
        }

        type Orphan = { contractId: string; customerId: string; email: string | null; name: string | null; reason: string }
        const orphans: Orphan[] = []
        let alive = 0

        // Verifica seriale (Nexi rate-limita a poche req/s). 200ms tra una e l'altra.
        for (const c of (customers || [])) {
            const contractId = (c.metadata as Record<string, unknown> | null)?.nexi_contract_id as string | undefined
            if (!contractId) continue

            try {
                const r = await fetch(`${NEXI_BASE_URL}/orders/${encodeURIComponent(contractId)}/operations`, {
                    headers: {
                        'X-Api-Key': NEXI_API_KEY,
                        'Correlation-Id': 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, x => {
                            const v = Math.random() * 16 | 0
                            return (x === 'x' ? v : (v & 0x3 | 0x8)).toString(16)
                        }),
                    },
                })

                if (r.status === 404) {
                    orphans.push({
                        contractId,
                        customerId: c.id,
                        email: c.email,
                        name: c.full_name || `${c.nome || ''} ${c.cognome || ''}`.trim() || null,
                        reason: '404 not found',
                    })
                } else if (r.ok) {
                    const data = await r.json()
                    const ops = (data?.operations || []) as unknown[]
                    if (ops.length === 0) {
                        orphans.push({
                            contractId,
                            customerId: c.id,
                            email: c.email,
                            name: c.full_name || `${c.nome || ''} ${c.cognome || ''}`.trim() || null,
                            reason: '0 operations',
                        })
                    } else {
                        alive++
                    }
                } else {
                    // 5xx/timeout/altro: NON marco come orfano per evitare falsi
                    // positivi. Lascio stare la riga.
                    console.warn(`[nexi-bulk-cleanup-orphans] ${contractId}: HTTP ${r.status} (skip)`)
                }
            } catch (e) {
                console.warn(`[nexi-bulk-cleanup-orphans] ${contractId}: fetch error (skip):`, e)
            }

            // Rate limit gentle
            await new Promise(res => setTimeout(res, 150))
        }

        let cleaned = 0
        if (!dryRun && orphans.length > 0) {
            for (const o of orphans) {
                // 1) Rimuovi nexi_contract_id dal cliente
                const { data: cust } = await supabase
                    .from('customers_extended')
                    .select('metadata')
                    .eq('id', o.customerId)
                    .maybeSingle()

                if (cust) {
                    const m = { ...(cust.metadata as Record<string, unknown> || {}) }
                    delete m.nexi_contract_id
                    delete m.nexi_contract_updated
                    m.nexi_contract_orphan_removed_at = new Date().toISOString()
                    m.nexi_contract_orphan_reason = o.reason
                    await supabase
                        .from('customers_extended')
                        .update({ metadata: m, updated_at: new Date().toISOString() })
                        .eq('id', o.customerId)
                    cleaned++
                }

                // 2) Marca le nexi_transactions con quel contract_id come orphan_removed
                await supabase.rpc('exec_sql', { sql: '' }).catch(() => null) // no-op safety
                const { data: txRows } = await supabase
                    .from('nexi_transactions')
                    .select('id, metadata')
                    .filter('metadata->>contract_id', 'eq', o.contractId)
                for (const t of (txRows || [])) {
                    const m = { ...(t.metadata as Record<string, unknown> || {}), orphan_removed_at: new Date().toISOString(), orphan_reason: o.reason }
                    await supabase
                        .from('nexi_transactions')
                        .update({ status: 'orphan_removed', metadata: m })
                        .eq('id', t.id)
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                checked: customers?.length || 0,
                alive,
                orphansCount: orphans.length,
                orphans: orphans.slice(0, 50), // anteprima primi 50
                cleaned,
                dryRun,
            }),
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
