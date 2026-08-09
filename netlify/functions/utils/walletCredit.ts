/**
 * FONTE UNICA di verita' per la classificazione del credito wallet (admin).
 *
 * MIRROR di `Sito/utils/walletCredit.ts` (dr7.app). Le due liste DEVONO
 * restare identiche: modificando una, modificare anche l'altra.
 *
 * Il saldo di un cliente e' composto da due nature di denaro:
 *
 *   CREDITO REALE  = soldi effettivamente incassati da DR7
 *                    (ricarica pagata con carta, incasso registrato a mano
 *                    dall'operatore, rimborso di un pagamento reale)
 *   BONUS          = denaro regalato da DR7
 *                    (bonus pacchetto ricarica, cashback DR7 Club, referral,
 *                    ricarica ricorrente in omaggio, interessi Club)
 *
 * Solo il CREDITO REALE e' capitale: e' l'unico che matura lo 0,1%/giorno del
 * DR7 Club Privilege (`accrue-club-wallet-interest.ts`).
 *
 * REGOLA DI CONSUMO (direzione, 2026-08-08): il cliente spende PRIMA il
 * credito reale, il bonus per ULTIMO. Quindi
 *     bonusResiduo = min(saldo, somma storica dei bonus accreditati)
 *     capitale     = saldo - bonusResiduo
 */

/**
 * reference_type che rappresentano denaro REGALATO da DR7.
 * Tutto cio' che non e' in questa lista e' credito reale (capitale).
 */
export const WALLET_BONUS_REFERENCE_TYPES: ReadonlySet<string> = new Set([
    // Cashback su pagamenti con carta (tier DR7 Club)
    'card_bonus',
    'cashback_3_percent',      // legacy: cashback fisso 3% pre-migrazione tier
    // Bonus del pacchetto ricarica (received_amount - recharge_amount)
    'wallet_package_bonus',
    // Bonus di benvenuto / registrazione
    'welcome_bonus',
    'registration_bonus',
    // Bonus iscrizione DR7 Club
    'dr7_club_signup_bonus',
    'club_signup_bonus',
    // Programma referral
    'referral',
    'referral_bonus',
    'referral_friend_topup',
    'milestone',
    'milestone_10_friends',
    // Interessi DR7 Club Privilege accreditati
    'club_interest_payout',
    // Credito inserito dall'operatore in admin come OMAGGIO (scelta esplicita
    // nella tab Wallet).
    'admin_bonus',
    // Ricarica ricorrente assegnata dalla direzione (es. ogni 15 del mese):
    // e' un regalo, non denaro incassato -> non e' capitale, non fa interessi.
    'wallet_auto_recharge',
    // Omaggi generici
    'gift',
    'voucher',
    'compensation',
])

/**
 * reference_type che rappresentano denaro REALMENTE INCASSATO da DR7.
 * Elencati per documentazione: la classificazione effettiva e' "non presente
 * in WALLET_BONUS_REFERENCE_TYPES".
 */
export const WALLET_REAL_REFERENCE_TYPES: ReadonlySet<string> = new Set([
    'wallet_purchase',        // ricarica pagata con carta (quota pagata)
    'wallet_purchase_fix',    // correzione manuale di una ricarica non accreditata
    'purchase',               // default storico di add_credits
    'topup',
    'admin_topup',            // incasso reale registrato a mano dall'operatore
    // Legacy: fino al 2026-08-08 ogni credito inserito da admin scriveva
    // 'admin_manual'. Per la direzione un credito inserito da un operatore e'
    // sempre denaro incassato (gli omaggi ricorrenti passano dal cron con
    // 'wallet_auto_recharge'), quindi e' credito reale. La migrazione
    // 20260809000000 riscrive queste righe come 'admin_topup'.
    'admin_manual',
    'admin_credit',
    'refund',                 // rimborso di un pagamento reale
    'booking_cancellation_refund',
])

/** true se il reference_type rappresenta denaro regalato da DR7. */
export function isBonusReferenceType(referenceType: string | null | undefined): boolean {
    return WALLET_BONUS_REFERENCE_TYPES.has(String(referenceType || '').toLowerCase())
}

export interface WalletTransactionLike {
    amount: number | string | null
    transaction_type?: string | null
    reference_type?: string | null
}

/**
 * Capitale (credito realmente pagato ancora a saldo) applicando la regola
 * "il bonus si consuma per ultimo".
 */
export function computeRealPrincipalEur(
    balanceEur: number,
    transactions: WalletTransactionLike[] | null | undefined
): number {
    const balance = Number(balanceEur) || 0
    let lifetimeBonus = 0
    for (const t of transactions || []) {
        if (t.transaction_type !== 'credit') continue
        if (!isBonusReferenceType(t.reference_type)) continue
        const amt = Number(t.amount || 0)
        if (Number.isFinite(amt) && amt > 0) lifetimeBonus += amt
    }
    return Math.max(0, balance - lifetimeBonus)
}
