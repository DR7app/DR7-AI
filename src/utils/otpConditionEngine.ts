/**
 * OTP condition engine.
 *
 * L'admin configura per ogni regola OTP (`system_otp_overrides`) un array
 * di condizioni JSON. A runtime, ogni call site di `requestOverride` passa
 * un `context` object con i dati rilevanti del flow (es. amount,
 * vehicle_category, customer_tier). Questo modulo evaluata le condizioni
 * contro il context: se TUTTE matchano, l'OTP scatta; se almeno una non
 * matcha, l'OTP viene saltato (silenzioso, ma con audit log "skipped").
 *
 * Se conditions e' vuoto, comportamento legacy: l'OTP usa solo is_required.
 */
export type OtpOperator =
    | 'eq' | 'neq'
    | 'gt' | 'lt' | 'gte' | 'lte'
    | 'in' | 'not_in'
    | 'contains' | 'starts_with'
    | 'is_empty' | 'is_not_empty'

export interface OtpCondition {
    field: string
    op: OtpOperator
    value: string
}

export type OtpContext = Record<string, unknown>

/**
 * Coerca un valore unknown in numero. NaN se non parsabile.
 */
function asNumber(v: unknown): number {
    if (typeof v === 'number') return v
    if (typeof v === 'string') return parseFloat(v.replace(',', '.'))
    if (typeof v === 'boolean') return v ? 1 : 0
    return NaN
}

/**
 * Coerca un valore unknown in stringa lowercase trimmed.
 */
function asStr(v: unknown): string {
    if (v == null) return ''
    return String(v).toLowerCase().trim()
}

/**
 * Coerca un valore unknown in booleano.
 *   true, 'true', '1', 'yes', 'si', 'sì' → true
 *   tutto il resto → false
 */
function asBool(v: unknown): boolean {
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0
    if (typeof v === 'string') {
        const s = v.toLowerCase().trim()
        return s === 'true' || s === '1' || s === 'yes' || s === 'si' || s === 'sì'
    }
    return false
}

/**
 * Valuta una singola condizione contro il context.
 * Ritorna false se il field manca o la coercion fallisce.
 */
export function evaluateCondition(cond: OtpCondition, context: OtpContext): boolean {
    if (!cond || !cond.field || !cond.op) return false
    const actual = context[cond.field]
    const expected = cond.value ?? ''

    switch (cond.op) {
        case 'eq': {
            // Eq compatibile con boolean / numero / stringa
            if (typeof actual === 'boolean' || expected === 'true' || expected === 'false') {
                return asBool(actual) === asBool(expected)
            }
            const a = asNumber(actual)
            const e = asNumber(expected)
            if (!isNaN(a) && !isNaN(e)) return a === e
            return asStr(actual) === asStr(expected)
        }
        case 'neq': {
            if (typeof actual === 'boolean' || expected === 'true' || expected === 'false') {
                return asBool(actual) !== asBool(expected)
            }
            const a = asNumber(actual)
            const e = asNumber(expected)
            if (!isNaN(a) && !isNaN(e)) return a !== e
            return asStr(actual) !== asStr(expected)
        }
        case 'gt': return asNumber(actual) > asNumber(expected)
        case 'lt': return asNumber(actual) < asNumber(expected)
        case 'gte': return asNumber(actual) >= asNumber(expected)
        case 'lte': return asNumber(actual) <= asNumber(expected)
        case 'in': {
            const list = String(expected).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
            return list.includes(asStr(actual))
        }
        case 'not_in': {
            const list = String(expected).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
            return !list.includes(asStr(actual))
        }
        case 'contains': return asStr(actual).includes(asStr(expected))
        case 'starts_with': return asStr(actual).startsWith(asStr(expected))
        case 'is_empty': return asStr(actual) === ''
        case 'is_not_empty': return asStr(actual) !== ''
        default: return false
    }
}

/**
 * Valuta tutte le condizioni in AND. Ritorna true se TUTTE matchano (o
 * la lista e' vuota — fallback legacy che lascia decidere is_required).
 */
export function evaluateConditions(conditions: OtpCondition[] | null | undefined, context: OtpContext): boolean {
    if (!conditions || conditions.length === 0) return true
    return conditions.every(c => evaluateCondition(c, context))
}

// ─────────────────────────────────────────────────────────────────────
// Catalogo dei field disponibili per ogni azione OTP. L'UI builder usa
// questa lista per popolare la dropdown del field. Il context runtime
// passato a requestOverride deve avere gli stessi nomi. Niente field
// non in lista (l'admin puo' digitarne uno custom, ma non lo vedra'
// nella dropdown standard).
// ─────────────────────────────────────────────────────────────────────
export interface ContextFieldDef {
    key: string
    label: string
    type: 'number' | 'string' | 'boolean' | 'enum'
    /** Per type=enum: lista di valori canonici. Per type=string: solo suggerimenti. */
    options?: string[]
    /** Hint mostrato sotto al builder. */
    hint?: string
}

export const OTP_CONTEXT_FIELDS: Record<string, ContextFieldDef[]> = {
    // Generic / shared fields — usabili da qualsiasi azione purche' il
    // call site passi il valore nel context.
    booking_create: [
        { key: 'amount', label: 'Importo totale (€)', type: 'number' },
        { key: 'vehicle_category', label: 'Categoria veicolo', type: 'enum', hint: 'es. supercars, urban, hypercar' },
        { key: 'rental_days', label: 'Giorni noleggio', type: 'number' },
        { key: 'customer_tier', label: 'Tier DR7 Club', type: 'enum', hint: 'es. access, black, signature, free' },
        { key: 'is_resident', label: 'Cliente residente', type: 'boolean' },
        { key: 'fascia', label: 'Fascia driver (A/B)', type: 'enum', options: ['A', 'B'] },
        { key: 'payment_method', label: 'Metodo pagamento', type: 'enum' },
        { key: 'has_deposit', label: 'Ha cauzione', type: 'boolean' },
        { key: 'unlimited_km', label: 'Km illimitati', type: 'boolean' },
        { key: 'hours_to_pickup', label: 'Ore al pickup', type: 'number' },
    ],
    booking_cancel: [
        { key: 'amount', label: 'Importo (€)', type: 'number' },
        { key: 'hours_to_pickup', label: 'Ore al pickup', type: 'number' },
        { key: 'customer_tier', label: 'Tier DR7 Club', type: 'enum' },
        { key: 'is_resident', label: 'Cliente residente', type: 'boolean' },
        { key: 'payment_method', label: 'Metodo pagamento', type: 'enum' },
        { key: 'payment_status', label: 'Stato pagamento', type: 'enum', options: ['paid', 'pending', 'unpaid', 'succeeded', 'completed'] },
    ],
    booking_modify: [
        { key: 'delta_amount', label: 'Variazione importo (€)', type: 'number', hint: 'positivo = aumento, negativo = riduzione' },
        { key: 'delta_days', label: 'Variazione giorni', type: 'number' },
        { key: 'vehicle_changed', label: 'Veicolo cambiato', type: 'boolean' },
        { key: 'customer_tier', label: 'Tier DR7 Club', type: 'enum' },
    ],
    extension_apply: [
        { key: 'extension_days', label: 'Giorni proroga', type: 'number' },
        { key: 'amount', label: 'Importo proroga (€)', type: 'number' },
        { key: 'customer_tier', label: 'Tier DR7 Club', type: 'enum' },
    ],
    discount_apply: [
        { key: 'discount_pct', label: 'Sconto %', type: 'number' },
        { key: 'discount_amount', label: 'Sconto €', type: 'number' },
        { key: 'final_amount', label: 'Importo finale (€)', type: 'number' },
        { key: 'customer_tier', label: 'Tier DR7 Club', type: 'enum' },
        { key: 'promo_code_used', label: 'Codice promo usato', type: 'string' },
    ],
    deposit_modify: [
        { key: 'delta_amount', label: 'Variazione cauzione (€)', type: 'number' },
        { key: 'is_capture', label: 'E\' un incasso', type: 'boolean' },
        { key: 'is_refund', label: 'E\' un rimborso', type: 'boolean' },
    ],
    invoice_modify: [
        { key: 'amount', label: 'Importo fattura (€)', type: 'number' },
        { key: 'is_revoke', label: 'E\' una revoca', type: 'boolean' },
    ],
}

/**
 * Lista degli operatori con label IT per la dropdown del builder.
 */
export const OTP_OPERATORS: Array<{ op: OtpOperator; label: string; appliesTo: ContextFieldDef['type'][] }> = [
    { op: 'eq',           label: '=',         appliesTo: ['number', 'string', 'boolean', 'enum'] },
    { op: 'neq',          label: '≠',         appliesTo: ['number', 'string', 'boolean', 'enum'] },
    { op: 'gt',           label: '>',         appliesTo: ['number'] },
    { op: 'lt',           label: '<',         appliesTo: ['number'] },
    { op: 'gte',          label: '≥',         appliesTo: ['number'] },
    { op: 'lte',          label: '≤',         appliesTo: ['number'] },
    { op: 'in',           label: 'in lista',  appliesTo: ['string', 'enum'] },
    { op: 'not_in',       label: 'non in lista', appliesTo: ['string', 'enum'] },
    { op: 'contains',     label: 'contiene',  appliesTo: ['string'] },
    { op: 'starts_with',  label: 'inizia con', appliesTo: ['string'] },
    { op: 'is_empty',     label: 'e\' vuoto', appliesTo: ['string'] },
    { op: 'is_not_empty', label: 'non e\' vuoto', appliesTo: ['string'] },
]
