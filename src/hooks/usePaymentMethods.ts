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
    // 2026-05-21: opt-out per nascondere metodi dai dropdown senza
    // cancellarli dal config. Default true (backwards compat).
    is_enabled?: boolean
}

// 2026-05-21: DEFAULT_METHODS hardcoded RIMOSSO. La direzione vuole che
// la lista metodi venga ESCLUSIVAMENTE da Centralina Pro > Fiscale.
// Se il config e' vuoto, i dropdown sono vuoti — l'admin deve aggiungere
// i metodi dalla UI. Niente fallback "magico" che riempiva la lista con
// 27 voci nascondendo il fatto che il config non era stato configurato.

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
                        is_enabled: m.is_enabled !== false,
                    }))
                    // 2026-05-21: filtra is_enabled === false così i dropdown
                    // mostrano solo i metodi attivi. I metodi disattivati
                    // restano nel config per archivio storico.
                    .filter(m => m.key && m.label && m.is_enabled !== false)
                return CACHED
            }
        } catch (e) {
            console.warn('[usePaymentMethods] config lookup failed', e)
        }
        // 2026-05-21: lista vuota se il config non e' configurato. L'admin
        // configura i metodi da Centralina Pro > Fiscale.
        CACHED = []
        return CACHED
    })()
    return PENDING
}

export function usePaymentMethods(): PaymentMethod[] {
    const [methods, setMethods] = useState<PaymentMethod[]>(CACHED || [])
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
