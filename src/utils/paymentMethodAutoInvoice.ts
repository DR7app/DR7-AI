/**
 * paymentMethodAutoInvoice — single source of truth for "should this
 * payment method auto-generate a fattura?"
 *
 * Reads `centralina_pro_config.config.fiscale.payment_methods[].auto_invoice`,
 * which the user manages from Centralina Pro > Fiscale (admin can add /
 * remove / toggle without a dev).
 *
 * Matching rules:
 *   1. Exact match on `key` (case-insensitive).
 *   2. Exact match on `label` (case-insensitive).
 *   3. If no row matches, default = true (generate fattura) — safest
 *      default for unknown / typo'd methods, so we don't accidentally
 *      hide invoices.
 *
 * Cached in-memory for the session; re-read with `reloadAutoInvoiceConfig`
 * after editing Centralina Fiscale.
 */
import { supabase } from '../supabaseClient'

type Method = { key: string; label: string; auto_invoice: boolean }

let cache: Method[] | null = null
let inflight: Promise<Method[]> | null = null

async function fetchMethods(): Promise<Method[]> {
    const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const fiscale = (data?.config as { fiscale?: { payment_methods?: unknown } } | null)?.fiscale
    const list = Array.isArray(fiscale?.payment_methods) ? fiscale.payment_methods : []
    return list
        .filter((m): m is Method =>
            typeof m === 'object' && m !== null &&
            typeof (m as Method).key === 'string' &&
            typeof (m as Method).label === 'string' &&
            typeof (m as Method).auto_invoice === 'boolean'
        )
}

async function getMethods(): Promise<Method[]> {
    if (cache) return cache
    if (!inflight) inflight = fetchMethods().then(m => { cache = m; inflight = null; return m })
    return inflight
}

/**
 * Returns true if a payment method should auto-generate a fattura.
 * Unknown methods default to true (safest — don't hide invoices silently).
 */
export async function paymentMethodAutoInvoice(method: string | null | undefined): Promise<boolean> {
    if (!method) return true
    const needle = method.trim().toLowerCase()
    if (!needle) return true
    const methods = await getMethods()
    for (const m of methods) {
        if (m.key.toLowerCase() === needle || m.label.toLowerCase() === needle) {
            return m.auto_invoice
        }
    }
    return true
}

/**
 * Force a re-read on next call. Call after Centralina Fiscale save so the
 * change takes effect immediately without page reload.
 */
export function reloadAutoInvoiceConfig(): void {
    cache = null
    inflight = null
}
