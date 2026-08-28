import { getCAPByCity, getProvinciaByCity, trovaComuneNelTesto } from '../data/sardegnaProvince'

/**
 * Aiuti per la sede legale / indirizzo cliente usati dalla fattura elettronica.
 *
 * 28/08/2026: una sede legale scritta a meta' ("Via Salvo D'acquisto n.7")
 * non blocca il salvataggio della scheda, ma blocca la fattura settimane dopo,
 * quando nessuno ricorda piu' quel cliente. Qui la regola sta accanto al campo:
 * si dice subito cosa manca e, quando il comune e' riconosciuto, il CAP si
 * mette da solo.
 *
 * Stessa regola di parseAddress in netlify/functions/xml-utils.ts.
 */

/** L'XML sa ricavarne via + CAP + comune? */
export function indirizzoUtilizzabile(indirizzo?: string | null): boolean {
    return cosaMancaNellIndirizzo(indirizzo) === null
}

/** Cosa manca, in italiano, o null se l'indirizzo va bene. */
export function cosaMancaNellIndirizzo(indirizzo?: string | null): string | null {
    const raw = String(indirizzo || '').replace(/\s+/g, ' ').trim()
    if (!raw) return 'indirizzo mancante'

    const cap = raw.match(/\b(\d{5})\b/)
    if (!cap || cap.index === undefined) return 'manca il CAP'

    const via = raw.slice(0, cap.index).replace(/[,;\s]+$/, '').trim()
    if (!via) return 'manca la via'

    let resto = raw.slice(cap.index + 5).replace(/^[,;\s]+/, '').trim()
    resto = resto.replace(/\(\s*[A-Za-z]{2}\s*\)/, ' ').replace(/[\s,]([A-Za-z]{2})\s*$/, ' ')
    if (!resto.replace(/[,;]/g, ' ').trim()) return 'manca il comune'

    return null
}

/**
 * Completa un indirizzo a cui manca solo il CAP (e/o la provincia) quando il
 * comune e' riconosciuto. Non tocca niente se il CAP c'e' gia' o se il comune
 * non e' in elenco: meglio lasciare il campo com'e' che scriverci un CAP a caso.
 */
export function completaIndirizzo(indirizzo?: string | null): { indirizzo: string; cambiato: boolean; comune?: string } {
    const raw = String(indirizzo || '').replace(/\s+/g, ' ').trim()
    if (!raw) return { indirizzo: raw, cambiato: false }
    if (/\b\d{5}\b/.test(raw)) return { indirizzo: raw, cambiato: false } // il CAP c'e' gia'

    // 1) Forma pulita "Via Roma 12, Cagliari": il comune e' l'ultimo pezzo.
    const pezzi = raw.split(',').map(p => p.trim()).filter(Boolean)
    if (pezzi.length >= 2) {
        let coda = pezzi[pezzi.length - 1]
        coda = coda.replace(/\(\s*[A-Za-z]{2}\s*\)\s*$/, '').replace(/[\s,]([A-Za-z]{2})\s*$/, '').trim()
        const cap = coda ? getCAPByCity(coda) : null
        if (cap) {
            const prov = getProvinciaByCity(coda) || ''
            const testa = pezzi.slice(0, -1).join(', ')
            return { indirizzo: `${testa}, ${cap} ${coda}${prov ? ` (${prov})` : ''}`, cambiato: true, comune: coda }
        }
    }

    // 2) 28/08/2026 — scritto tutto d'un fiato, senza virgole e in ordine
    // libero: "QUARTU SANT' ELENA VIA SERRA PERDOSA 25" oppure
    // "Via enrico de nicola 24 san sperate". Erano questi a bloccare le
    // fatture al SDI ("il CAP non ricavabile"). Si cerca il comune dentro al
    // testo, lo si toglie da li' e il resto e' la via.
    const trovato = trovaComuneNelTesto(raw)
    if (!trovato || !trovato.cap) return { indirizzo: raw, cambiato: false }

    const pulisci = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    const tokens = raw.split(' ').filter(Boolean)
    const bersaglio = pulisci(trovato.comune)
    let da = -1, a = -1
    for (let i = 0; i < tokens.length && da < 0; i++) {
        let acc = ''
        for (let j = i; j < tokens.length; j++) {
            acc += pulisci(tokens[j])
            if (acc === bersaglio) { da = i; a = j; break }
            if (!bersaglio.startsWith(acc)) break
        }
    }
    const via = (da >= 0 ? [...tokens.slice(0, da), ...tokens.slice(a + 1)] : tokens)
        .join(' ')
        .replace(/\(\s*[A-Za-z]{2}\s*\)/g, ' ')
        .replace(/[,;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!via) return { indirizzo: raw, cambiato: false } // resterebbe senza via

    const prov = trovato.provincia || ''
    return {
        indirizzo: `${via}, ${trovato.cap} ${trovato.comune}${prov ? ` (${prov})` : ''}`,
        cambiato: true,
        comune: trovato.comune,
    }
}

/** Scompone un indirizzo completo nei campi dell'anagrafica. */
export function scomponiIndirizzo(indirizzo?: string | null): { via: string; cap: string; comune: string; provincia: string } | null {
    const raw = String(indirizzo || '').replace(/\s+/g, ' ').trim()
    const cap = raw.match(/\b(\d{5})\b/)
    if (!cap || cap.index === undefined) return null

    const via = raw.slice(0, cap.index).replace(/[,;\s]+$/, '').trim()
    let resto = raw.slice(cap.index + 5).replace(/^[,;\s]+/, '').trim()

    let provincia = ''
    const paren = resto.match(/\(\s*([A-Za-z]{2})\s*\)/)
    if (paren) {
        provincia = paren[1].toUpperCase()
        resto = resto.replace(paren[0], ' ')
    } else {
        const coda = resto.match(/[\s,]([A-Za-z]{2})\s*$/)
        if (coda && coda.index !== undefined) {
            provincia = coda[1].toUpperCase()
            resto = resto.slice(0, coda.index).trim()
        }
    }

    const comune = resto.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!via || !comune) return null
    return { via, cap: cap[1], comune, provincia }
}
