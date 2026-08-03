/**
 * Input monetari — SEMPRE `type="text"` + `inputMode="decimal"` + sanitizeMoney.
 *
 * 2026-08-03: mai `type="number"` per gli importi. Su Chrome/Safari con locale
 * italiano il campo numerico rifiuta il punto (e in certe combinazioni anche la
 * virgola): digitando "155.5" restava "1555" o si bloccava sugli interi, quindi
 * un danno da 155,50 non era inseribile. `sanitizeMoney` accetta indifferentemente
 * "." e "," e normalizza sempre in ISO con il punto, cosi' parseFloat non sbaglia
 * ("155,5" -> parseFloat = 155).
 *
 * Nato duplicato in DanniPenaliModal/PenaltyModal, qui e' condiviso.
 */
export function sanitizeMoney(raw: string): string {
    if (!raw) return ''
    // Trim, mantengo "-" se in prima posizione, sostituisco "," con "."
    // per uniformare. Tolgo tutto cio' che non e' cifra/punto/meno.
    let s = String(raw).trim().replace(/,/g, '.')
    s = s.replace(/[^0-9.\-]/g, '')
    // "-" solo in prima posizione
    s = s.replace(/(?!^)-/g, '')
    // Un solo "." (il primo). Tronco il resto dei punti.
    const firstDot = s.indexOf('.')
    if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
    }
    return s
}

/** parseFloat tollerante alla virgola: "155,5" e "155.5" -> 155.5. NaN se vuoto/non valido. */
export function parseMoney(raw: string | number | null | undefined): number {
    if (typeof raw === 'number') return raw
    if (raw === null || raw === undefined || raw === '') return NaN
    return parseFloat(sanitizeMoney(String(raw)))
}
