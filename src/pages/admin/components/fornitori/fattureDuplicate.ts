import type { FornitoreDocument } from './types'

/**
 * Riconoscimento dei doppioni tra le fatture di un fornitore.
 *
 * L'indice unico a database copre (fornitore, tipo, numero, data): non basta,
 * perche' la stessa fattura Aruba puo' entrare due volte con il numero scritto
 * in modo diverso ("1/26" e "0001/26") se il numero arriva una volta dal JSON
 * e una volta dall'XML. L'identita' vera di una fattura scaricata da Aruba e'
 * il suo filename; per le fatture inserite a mano restano numero + data.
 */

/** Numero documento ridotto all'osso: niente separatori, niente zeri iniziali. */
export function normalizzaNumero(numero: string | null | undefined): string {
    if (!numero) return ''
    return numero
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/^0+(?=\d)/, '')
}

/** Le chiavi con cui due righe vengono considerate la stessa fattura. */
export function chiaviFattura(d: FornitoreDocument): string[] {
    const chiavi: string[] = []
    if (d.aruba_filename) chiavi.push(`file:${d.aruba_filename}`)
    const num = normalizzaNumero(d.numero_documento)
    if (num && d.data_documento) chiavi.push(`num:${num}|${d.data_documento}`)
    return chiavi
}

/**
 * Quale riga tenere quando due descrivono la stessa fattura:
 * prima quella pagata (ha lo storico del pagamento), poi quella con il file
 * gia' in archivio, poi la piu' vecchia — cosi' i collegamenti alle bolle
 * fatti dall'utente restano validi.
 */
function meglioDi(a: FornitoreDocument, b: FornitoreDocument): boolean {
    const peso = (d: FornitoreDocument) =>
        (d.stato === 'pagato' ? 4 : 0) +
        (d.data_pagamento ? 2 : 0) +
        (d.file_url ? 1 : 0)
    const pa = peso(a)
    const pb = peso(b)
    if (pa !== pb) return pa > pb
    // A parita' di peso resta quella gia' scelta: sostituiamo solo se la
    // candidata e' davvero piu' vecchia.
    return (a.created_at || '') < (b.created_at || '')
}

export interface RisultatoDuplicati {
    /** Una riga per fattura reale. */
    unici: FornitoreDocument[]
    /** Le righe in piu' da eliminare. */
    duplicati: FornitoreDocument[]
}

/**
 * Raggruppa le righe che descrivono la stessa fattura e tiene la migliore.
 * L'ordine di partenza viene rispettato.
 */
export function separaDuplicati(docs: FornitoreDocument[]): RisultatoDuplicati {
    const gruppoDi = new Map<string, number>()   // chiave -> indice gruppo
    const gruppi: FornitoreDocument[][] = []

    for (const d of docs) {
        const chiavi = chiaviFattura(d)
        // Le chiavi di questa riga possono puntare a gruppi diversi gia'
        // esistenti (una riga con filename + numero fa da ponte): li fondiamo.
        const indici = [...new Set(chiavi.map(k => gruppoDi.get(k)).filter((i): i is number => i !== undefined))]
        let idx: number
        if (indici.length === 0) {
            idx = gruppi.length
            gruppi.push([])
        } else {
            idx = indici[0]
            for (const altro of indici.slice(1)) {
                gruppi[idx].push(...gruppi[altro])
                gruppi[altro] = []
                gruppoDi.forEach((v, k) => { if (v === altro) gruppoDi.set(k, idx) })
            }
        }
        gruppi[idx].push(d)
        // Riga senza chiavi (numero e data vuoti): resta un gruppo a se'.
        for (const k of chiavi) gruppoDi.set(k, idx)
    }

    const unici: FornitoreDocument[] = []
    const duplicati: FornitoreDocument[] = []
    for (const g of gruppi) {
        if (g.length === 0) continue
        let tenuta = g[0]
        for (const d of g.slice(1)) if (meglioDi(d, tenuta)) tenuta = d
        unici.push(tenuta)
        for (const d of g) if (d.id !== tenuta.id) duplicati.push(d)
    }
    return { unici, duplicati }
}
