/**
 * Confronto tollerante tra ragioni sociali, lato pannello.
 * Stesse regole di netlify/functions/utils/fornitoreMatch.ts: servono a
 * riconoscere che "HYDROCHEM SRL" e "Hydrochem S.r.l." sono lo stesso
 * fornitore inserito due volte.
 */

export function normalizzaPiva(s: string | null | undefined): string {
    if (!s) return ''
    return s.replace(/\D/g, '')
}

export function normalizzaNome(s: string | null | undefined): string {
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

/** true se due nomi gia' normalizzati descrivono lo stesso fornitore. */
export function nomiCoincidono(a: string, b: string): boolean {
    if (!a || !b) return false
    if (a === b) return true
    if (a.length >= 4 && b.includes(a)) return true
    if (b.length >= 4 && a.includes(b)) return true
    const at = a.split(' ').filter(t => t.length >= 3)
    const bt = b.split(' ').filter(t => t.length >= 3)
    if (at.length === 0 || bt.length === 0) return false
    const comuni = at.filter(t => bt.includes(t)).length
    return comuni >= Math.min(2, Math.min(at.length, bt.length))
}
