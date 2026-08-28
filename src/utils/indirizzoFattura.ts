import { getCAPByCity, getProvinciaByCity } from '../data/sardegnaProvince'

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

    // Il comune e' l'ultimo pezzo dopo la virgola: "Via Roma 12, Cagliari".
    const pezzi = raw.split(',').map(p => p.trim()).filter(Boolean)
    if (pezzi.length < 2) return { indirizzo: raw, cambiato: false }

    let coda = pezzi[pezzi.length - 1]
    // Toglie una provincia gia' scritta, "(CA)" o "CA" in coda.
    coda = coda.replace(/\(\s*[A-Za-z]{2}\s*\)\s*$/, '').replace(/[\s,]([A-Za-z]{2})\s*$/, '').trim()
    if (!coda) return { indirizzo: raw, cambiato: false }

    const cap = getCAPByCity(coda)
    if (!cap) return { indirizzo: raw, cambiato: false }

    const prov = getProvinciaByCity(coda) || ''
    const testa = pezzi.slice(0, -1).join(', ')
    const nuovo = `${testa}, ${cap} ${coda}${prov ? ` (${prov})` : ''}`
    return { indirizzo: nuovo, cambiato: true, comune: coda }
}
