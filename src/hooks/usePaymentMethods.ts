/**
 * Shared payment-method list. Source of truth:
 *   centralina_pro_config.config.fiscal.payment_methods
 *
 * Every admin dropdown that asks "come è stato pagato?" reads from here so
 * adding a method in Centralina Pro → Fiscale immediately shows up in:
 *   - DanniPenaliModal (segna pagato + addebito danni)
 *   - PenaltyModal
 *   - CarWashBookingsTab (segna pagato lavaggio / meccanica)
 *   - InvoicesTab (creazione fattura manuale)
 *   - ConvertPreventivoModal / PreventivoAcceptModal
 *   - … qualsiasi futuro punto
 *
 * The `label` field is also the option `value` to stay backward compatible
 * with bookings already stored with payment_method = "Contanti", "Bonifico",
 * "Bonifico bancario", "DR7 Wallet (credito)" etc.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export interface PaymentMethod {
    key: string
    label: string
    auto_invoice: boolean
}

const DEFAULT_METHODS: PaymentMethod[] = [
    { key: 'contanti', label: 'Contanti', auto_invoice: true },
    { key: 'bancomat', label: 'Bancomat / POS', auto_invoice: true },
    { key: 'carta', label: 'Carta di credito (Nexi)', auto_invoice: true },
    { key: 'bonifico', label: 'Bonifico bancario', auto_invoice: true },
    { key: 'assegno', label: 'Assegno', auto_invoice: true },
    { key: 'wallet', label: 'DR7 Wallet (credito)', auto_invoice: false },
    { key: 'altro', label: 'Altro', auto_invoice: true },
]

// Module-level cache so multiple components mounting in the same render don't
// re-fetch. Refresh on save in Centralina Pro is handled by realtime; for
// simplicity we just bust on next page reload here.
let CACHED: PaymentMethod[] | null = null
let PENDING: Promise<PaymentMethod[]> | null = null

async function fetchOnce(): Promise<PaymentMethod[]> {
    if (CACHED) return CACHED
    if (PENDING) return PENDING
    PENDING = (async () => {
        try {
            const { data } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            const cfg = (data?.config || {}) as Record<string, unknown>
            const fiscal = (cfg.fiscal || {}) as Record<string, unknown>
            const list = fiscal.payment_methods
            if (Array.isArray(list) && list.length > 0) {
                CACHED = list
                    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
                    .map(m => ({
                        key: String(m.key || ''),
                        label: String(m.label || ''),
                        auto_invoice: m.auto_invoice !== false,
                    }))
                    .filter(m => m.key && m.label)
                return CACHED
            }
        } catch (e) {
            console.warn('[usePaymentMethods] config lookup failed, using default', e)
        }
        CACHED = DEFAULT_METHODS
        return CACHED
    })()
    return PENDING
}

export function usePaymentMethods(): PaymentMethod[] {
    const [methods, setMethods] = useState<PaymentMethod[]>(CACHED || DEFAULT_METHODS)
    useEffect(() => {
        let cancelled = false
        fetchOnce().then(list => { if (!cancelled) setMethods(list) })
        return () => { cancelled = true }
    }, [])
    return methods
}

/** Reset cache. Call after saving the list in Centralina Pro. */
export function invalidatePaymentMethodsCache(): void {
    CACHED = null
    PENDING = null
}
