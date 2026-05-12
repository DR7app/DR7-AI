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

// Fallback mirror della lista DEFAULT_PAYMENT_METHODS di CentralinaProTab.
// Quando la direzione non ha ancora salvato la lista in Fiscale, i dropdown
// mostrano questo set completo (operativi + codici SDI).
const DEFAULT_METHODS: PaymentMethod[] = [
    { key: 'contanti',                label: 'Contanti',                         auto_invoice: true  },
    { key: 'bancomat',                label: 'Carta di Credito / bancomat',      auto_invoice: true  },
    { key: 'nexi_pay_by_link',        label: 'Nexi - Pay by Link',               auto_invoice: true  },
    { key: 'bonifico',                label: 'Bonifico',                         auto_invoice: true  },
    { key: 'bonifico_bancario',       label: 'Bonifico bancario',                auto_invoice: true  },
    { key: 'credit_wallet',           label: 'Credit Wallet',                    auto_invoice: false },
    { key: 'paypal',                  label: 'Paypal',                           auto_invoice: true  },
    { key: 'assegno',                 label: 'Assegno',                          auto_invoice: true  },
    { key: 'assegno_circolare',       label: 'Assegno circolare',                auto_invoice: true  },
    { key: 'riba',                    label: 'RIBA',                             auto_invoice: true  },
    { key: 'rid',                     label: 'RID',                              auto_invoice: true  },
    { key: 'rid_utenze',              label: 'RID utenze',                       auto_invoice: true  },
    { key: 'rib_veloce',              label: 'RIB veloce',                       auto_invoice: true  },
    { key: 'sepa_direct_debit',       label: 'SEPA Direct Debit',                auto_invoice: true  },
    { key: 'sepa_direct_debit_core',  label: 'SEPA Direct Debit CORE',           auto_invoice: true  },
    { key: 'sepa_direct_debit_b2b',   label: 'SEPA Direct Debit B2B',            auto_invoice: true  },
    { key: 'domiciliazione_bancaria', label: 'Domiciliazione bancaria',          auto_invoice: true  },
    { key: 'domiciliazione_postale',  label: 'Domiciliazione postale',           auto_invoice: true  },
    { key: 'pagopa',                  label: 'PagoPA',                           auto_invoice: true  },
    { key: 'bollettino_postale',      label: 'Bollettino postale',               auto_invoice: true  },
    { key: 'bollettino_bancario',     label: 'Bollettino bancario',              auto_invoice: true  },
    { key: 'contanti_tesoreria',      label: 'Contanti presso tesoreria',        auto_invoice: true  },
    { key: 'vaglia_cambiario',        label: 'Vaglia cambiario',                 auto_invoice: true  },
    { key: 'quietanza_erario',        label: 'Quietanza erario',                 auto_invoice: true  },
    { key: 'giroconto_contabilita',   label: 'Giroconto su conti di contabilità', auto_invoice: true },
    { key: 'trattenuta_riscosse',     label: 'Trattenuta su somme già riscosse', auto_invoice: true  },
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
