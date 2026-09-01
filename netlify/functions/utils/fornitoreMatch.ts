/**
 * Regole condivise per capire se una fattura Aruba appartiene a un fornitore.
 *
 * Stavano dentro sync-fornitore-invoices.ts: la funzione di auto-discovery
 * (fornitori-fatture-sync-background) usava invece il solo confronto per
 * P.IVA, quindi un fornitore inserito a mano senza P.IVA veniva ricreato come
 * stub e le stesse fatture finivano su due anagrafiche (es. Hydrochem).
 * Una sola regola, usata da entrambi.
 */

/** Solo cifre: "IT01234567890" e "01234567890" diventano lo stesso valore. */
export function normalizeVat(s: string | null | undefined): string {
    if (!s) return ''
    return s.replace(/\D/g, '')
}

/**
 * Normalizza una ragione sociale per un confronto tollerante: minuscole, via
 * accenti, forme societarie (s.r.l., s.p.a., snc, sas...), punteggiatura e
 * spazi doppi. Cosi' "AGENZIA GOFFI SRL" e "Agenzia Goffi S.r.l." coincidono.
 */
export function normalizeName(s: string | null | undefined): string {
    if (!s) return ''
    return s
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc(?:ieta')?|srls|s\.r\.l\.s\.?)\b/gi, '')
        .replace(/\b(a socio unico|succursale italiana|italia|italy|italiana|italiano)\b/gi, '')
        .replace(/['".,&\-_/\\()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * true se due nomi gia' normalizzati combaciano abbastanza:
 * uguali, uno contenuto nell'altro, oppure con almeno due token in comune.
 */
export function namesMatch(a: string, b: string): boolean {
    if (!a || !b) return false
    if (a === b) return true
    if (a.length >= 4 && b.includes(a)) return true
    if (b.length >= 4 && a.includes(b)) return true
    const at = a.split(' ').filter(t => t.length >= 3)
    const bt = b.split(' ').filter(t => t.length >= 3)
    if (at.length === 0 || bt.length === 0) return false
    const shared = at.filter(t => bt.includes(t)).length
    return shared >= Math.min(2, Math.min(at.length, bt.length))
}
