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
import { businessRowForServiceType, loadBusinessList } from './businessConfigClient'

type Method = { key: string; label: string; auto_invoice: boolean }

// Cache per business: la spunta "Fattura" puo' essere diversa fra Terra e
// Mare, e una cache unica avrebbe applicato ovunque quella caricata per prima.
const cache = new Map<string, Method[]>()
const inflight = new Map<string, Promise<Method[]>>()

async function fetchMethods(serviceType?: string | null): Promise<Method[]> {
    // 2026-08 FIX: la config si salva sotto `fiscal` (senza 'e') — vedi
    // CentralinaProTab. Prima si leggeva `fiscale` (chiave inesistente) → lista
    // vuota → auto_invoice sempre true (il toggle non aveva alcun effetto lato
    // client). Il server (generate-invoice-from-booking) leggeva gia' `fiscal`.
    // 2026-08-14 (roadmap #16): si legge la riga del business, non piu' `main`.
    const list = await loadBusinessList<Method>(serviceType, 'fiscal', 'payment_methods')
    return list
        .filter((m): m is Method =>
            typeof m === 'object' && m !== null &&
            typeof (m as Method).key === 'string' &&
            typeof (m as Method).label === 'string' &&
            typeof (m as Method).auto_invoice === 'boolean'
        )
}

async function getMethods(serviceType?: string | null): Promise<Method[]> {
    const row = businessRowForServiceType(serviceType)
    const hit = cache.get(row)
    if (hit) return hit
    const pending = inflight.get(row)
    if (pending) return pending
    const p = fetchMethods(serviceType).then(m => { cache.set(row, m); inflight.delete(row); return m })
    inflight.set(row, p)
    return p
}

/**
 * Returns true if a payment method should auto-generate a fattura.
 * Unknown methods default to true (safest — don't hide invoices silently).
 */
export async function paymentMethodAutoInvoice(
    method: string | null | undefined,
    serviceType?: string | null,
): Promise<boolean> {
    if (!method) return true
    const needle = method.trim().toLowerCase()
    if (!needle) return true
    const methods = await getMethods(serviceType)
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
    cache.clear()
    inflight.clear()
}
