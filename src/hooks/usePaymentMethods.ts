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
import { businessRowForServiceType, loadBusinessList } from '../utils/businessConfigClient'

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

// Cache PER BUSINESS. Prima era una variabile sola: il primo componente
// montato decideva la lista per tutti, quindi aprendo prima il Noleggio Terra
// e poi il Mare, il Mare si teneva i metodi di Terra fino al reload.
const CACHE = new Map<string, PaymentMethod[]>()
const INFLIGHT = new Map<string, Promise<PaymentMethod[]>>()

async function fetchOnce(serviceType?: string | null): Promise<PaymentMethod[]> {
    const row = businessRowForServiceType(serviceType)
    const cached = CACHE.get(row)
    if (cached) return cached
    const pending = INFLIGHT.get(row)
    if (pending) return pending
    const p = (async () => {
        try {
            // Riga del business, con fallback su `main` se quel business non ha
            // una sua lista: chi non configura eredita i metodi dell'azienda.
            const list = await loadBusinessList<Record<string, unknown>>(serviceType, 'fiscal', 'payment_methods')
            if (list.length > 0) {
                const out = list
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
                CACHE.set(row, out)
                return out
            }
        } catch (e) {
            console.warn('[usePaymentMethods] config lookup failed', e)
        }
        // 2026-05-21: lista vuota se il config non e' configurato. L'admin
        // configura i metodi da Centralina Pro > Fiscale.
        CACHE.set(row, [])
        return []
    })()
    INFLIGHT.set(row, p)
    return p
}

/**
 * @param serviceType service_type della prenotazione in corso
 *   ('boat_rental', 'heli_rental', 'stay_rental', 'car_wash', 'mechanical').
 *   Omesso = Noleggio Terra (riga `main`), il comportamento di prima.
 */
export function usePaymentMethods(serviceType?: string | null): PaymentMethod[] {
    const [methods, setMethods] = useState<PaymentMethod[]>(
        () => CACHE.get(businessRowForServiceType(serviceType)) || []
    )
    useEffect(() => {
        let cancelled = false
        fetchOnce(serviceType).then(list => { if (!cancelled) setMethods(list) })
        return () => { cancelled = true }
    }, [serviceType])
    return methods
}

/** Reset cache. Call after saving the list in Centralina Pro. */
export function invalidatePaymentMethodsCache(): void {
    CACHE.clear()
    INFLIGHT.clear()
}
