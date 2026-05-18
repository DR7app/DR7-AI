/**
 * BIN (Bank Identification Number) lookup with multi-source fallback.
 *
 * Returns the card type (credit/debit/prepaid) + brand (visa/mastercard/etc)
 * from the first 6 digits of a card PAN.
 *
 * Strategy (in order):
 *   1. Local prefix table (instant, no network) — covers the most common
 *      Italian issuers (Intesa, Unicredit, BPER, Posteposhop, Nexi-issued cards)
 *      so the BIN is always classified for the cards we see in practice.
 *   2. binlist.net free API — rate-limited to ~1 req/10s and returns 429 a
 *      lot, but works for international BINs we don't have locally.
 *
 * Returning `null` means "unknown" — caller should leave the field empty
 * rather than guessing.
 */

interface BinResult {
    type: 'credit' | 'debit' | 'prepaid' | ''
    brand: 'visa' | 'mastercard' | 'amex' | 'maestro' | 'diners' | ''
}

/**
 * Local known-prefix table. Keys are 4-6 digit BIN prefixes; longer prefixes
 * take priority. Cards starting with these prefixes are classified offline.
 * Add new prefixes as you observe missing classifications in production.
 */
const LOCAL_PREFIXES: Array<{ prefix: string; type: BinResult['type']; brand: BinResult['brand'] }> = [
    // ── Italian banks: major credit/debit prefixes ──────────────────────
    // Intesa Sanpaolo
    { prefix: '402360', type: 'debit',   brand: 'visa' },
    { prefix: '404159', type: 'debit',   brand: 'visa' },
    { prefix: '410938', type: 'credit',  brand: 'visa' },
    { prefix: '422222', type: 'debit',   brand: 'visa' },
    { prefix: '454311', type: 'debit',   brand: 'visa' },
    { prefix: '454639', type: 'debit',   brand: 'visa' },
    { prefix: '518753', type: 'credit',  brand: 'mastercard' },
    { prefix: '530214', type: 'debit',   brand: 'mastercard' },
    { prefix: '536218', type: 'credit',  brand: 'mastercard' },
    { prefix: '545616', type: 'credit',  brand: 'mastercard' },
    { prefix: '548999', type: 'credit',  brand: 'mastercard' },

    // Unicredit
    { prefix: '402400', type: 'debit',   brand: 'visa' },
    { prefix: '406063', type: 'debit',   brand: 'visa' },
    { prefix: '408835', type: 'credit',  brand: 'visa' },
    { prefix: '424519', type: 'debit',   brand: 'visa' },
    { prefix: '435704', type: 'credit',  brand: 'visa' },
    { prefix: '457173', type: 'credit',  brand: 'visa' },
    { prefix: '521853', type: 'credit',  brand: 'mastercard' },
    { prefix: '525766', type: 'debit',   brand: 'mastercard' },
    { prefix: '535340', type: 'credit',  brand: 'mastercard' },
    { prefix: '535419', type: 'credit',  brand: 'mastercard' },

    // BPER / BancoPosta
    { prefix: '402894', type: 'prepaid', brand: 'visa' },        // Postepay
    { prefix: '454656', type: 'prepaid', brand: 'visa' },        // Postepay Evolution
    { prefix: '525488', type: 'prepaid', brand: 'mastercard' },  // Postepay Mastercard

    // Revolut / N26 / Wise (typically prepaid/debit)
    { prefix: '485962', type: 'debit',   brand: 'visa' },        // Revolut UK
    { prefix: '414740', type: 'debit',   brand: 'visa' },        // Revolut LT
    { prefix: '518685', type: 'debit',   brand: 'mastercard' },  // N26
    { prefix: '521729', type: 'debit',   brand: 'mastercard' },  // Wise

    // Nexi-issued credit cards (Cartasi)
    { prefix: '401200', type: 'credit',  brand: 'visa' },
    { prefix: '423840', type: 'credit',  brand: 'visa' },
    { prefix: '454360', type: 'credit',  brand: 'visa' },
    { prefix: '518701', type: 'credit',  brand: 'mastercard' },
    { prefix: '530270', type: 'credit',  brand: 'mastercard' },

    // ── Brand-only fallback (no type inference) ─────────────────────────
    // These match by 1-char prefix to at least surface VISA/MC even when
    // the issuer-specific row is missing. type='' means "unknown type".
    { prefix: '4',  type: '', brand: 'visa' },
    { prefix: '51', type: '', brand: 'mastercard' },
    { prefix: '52', type: '', brand: 'mastercard' },
    { prefix: '53', type: '', brand: 'mastercard' },
    { prefix: '54', type: '', brand: 'mastercard' },
    { prefix: '55', type: '', brand: 'mastercard' },
    { prefix: '22', type: '', brand: 'mastercard' },
    { prefix: '23', type: '', brand: 'mastercard' },
    { prefix: '24', type: '', brand: 'mastercard' },
    { prefix: '25', type: '', brand: 'mastercard' },
    { prefix: '26', type: '', brand: 'mastercard' },
    { prefix: '27', type: '', brand: 'mastercard' },
    { prefix: '34', type: 'credit', brand: 'amex' },
    { prefix: '37', type: 'credit', brand: 'amex' },
    { prefix: '36', type: 'credit', brand: 'diners' },
]

// Sort once by descending prefix length so the most specific match wins.
const SORTED_PREFIXES = [...LOCAL_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length)

function classifyLocal(bin: string): BinResult | null {
    const digits = (bin || '').replace(/\D/g, '')
    if (digits.length < 1) return null
    for (const entry of SORTED_PREFIXES) {
        if (digits.startsWith(entry.prefix)) {
            return { type: entry.type, brand: entry.brand }
        }
    }
    return null
}

async function classifyBinlist(bin: string): Promise<BinResult | null> {
    try {
        const res = await fetch(`https://lookup.binlist.net/${bin}`, {
            headers: { 'Accept-Version': '3' },
        })
        if (!res.ok) return null
        const data = await res.json() as { type?: string; scheme?: string }
        const type = String(data.type || '').toLowerCase()
        const brand = String(data.scheme || '').toLowerCase()
        if (!type && !brand) return null
        return {
            type: (['credit', 'debit', 'prepaid'].includes(type) ? type : '') as BinResult['type'],
            brand: (['visa', 'mastercard', 'amex', 'maestro', 'diners'].includes(brand) ? brand : '') as BinResult['brand'],
        }
    } catch {
        return null
    }
}

/**
 * Look up a card BIN. Returns brand + type if any source classifies it.
 * Local table first (instant + no rate limit), binlist.net as fallback.
 *
 * Special case: if the local table matched only a brand (1-char prefix) but
 * we still want a type, we ALSO ask binlist.net for the type. Result is
 * merged with local data winning for brand.
 */
export async function lookupBin(bin: string): Promise<BinResult | null> {
    const digits = (bin || '').replace(/\D/g, '').substring(0, 6)
    if (digits.length < 4) return null

    const local = classifyLocal(digits)
    if (local && local.type && local.brand) return local

    // Local match missing or incomplete → try binlist.net to fill the gap.
    const remote = await classifyBinlist(digits)
    if (remote && (remote.type || remote.brand)) {
        return {
            type: (local?.type || remote.type) as BinResult['type'],
            brand: (local?.brand || remote.brand) as BinResult['brand'],
        }
    }
    return local
}
