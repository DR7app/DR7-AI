/**
 * Clausola "RESPONSABILITÀ PENALE DEI CLIENTI" del contratto, scritta con i
 * dati della Centralina Pro invece che in duro.
 *
 * 20/09/2026 (direzione): il paragrafo diceva "€5.000 + 30%" a tutti, mentre
 * la Centralina per quella categoria dice altro — Exotic Cars 15.000,
 * Hypercar 10.000. Il cliente firmava numeri che non erano i suoi.
 *
 * I numeri arrivano gia' risolti dal chiamante (`franchigieContratto.kasko`),
 * quindi comprendono anche la modifica valida per la singola prenotazione
 * ("kasko una volta"). Qui si scrive soltanto la frase.
 */

export const COPERTURA_KASKO_STANDARD =
    'Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale'

export interface DatiClausolaKasko {
    /** Etichetta della categoria come in Centralina (es. "Hypercar"). */
    etichettaCategoria: string
    /** Nome dell'opzione scelta (es. "Kasko Base"). */
    nomeKasko: string
    /** Descrizione della copertura scritta in Centralina; vuota = standard. */
    copertura?: string | null
    /** Franchigia in euro, gia' formattata dal chiamante ('' se vuota). */
    franchigiaEur: string
    /** Scoperto in percentuale, gia' formattato ('' se vuoto). */
    scopertoPerc: string
    /** Cauzione obbligatoria, usata solo per le opzioni di sola RCA. */
    depositoObbligatorio?: number
}

/**
 * Migliaia separate dal punto, sempre. `toLocaleString('it-IT')` non raggruppa
 * i numeri di quattro cifre (5000 restava "5000" mentre 15000 diventava
 * "15.000"): su un contratto due formati diversi nella stessa pagina.
 */
export function euroContratto(n: number): string {
    const intero = Math.round(Math.abs(Number(n) || 0)).toString()
    const raggruppato = intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return (Number(n) < 0 ? '-' : '') + raggruppato
}

/** "da risarcire €15000 + 30% del danno" e le sue varianti. */
export function daRisarcire(franchigiaEur: string, scopertoPerc: string): string {
    const eur = String(franchigiaEur || '').trim()
    const perc = String(scopertoPerc || '').trim()
    if (eur && perc) return `da risarcire €${eur} + ${perc}% del danno`
    if (eur) return `da risarcire €${eur}`
    if (perc) return `da risarcire il ${perc}% del danno`
    return 'nessuna franchigia'
}

/** Un'opzione di sola RCA: la Kasko non c'e'. Si riconosce dal nome. */
export function soloRca(nomeKasko: string): boolean {
    return /^\s*rca\b/i.test(String(nomeKasko || ''))
}

export function clausolaKasko(d: DatiClausolaKasko): string {
    const copertura = String(d.copertura || '').trim() || COPERTURA_KASKO_STANDARD
    const corpo = soloRca(d.nomeKasko)
        ? `${d.nomeKasko}: la copertura Kasko NON è attiva. Ogni danno al veicolo resta interamente a carico del locatario${(d.depositoObbligatorio || 0) > 0 ? `, con cauzione obbligatoria di €${euroContratto(Number(d.depositoObbligatorio))}` : ''}.`
        : `${d.nomeKasko}: ${copertura}: ${daRisarcire(d.franchigiaEur, d.scopertoPerc)}.`
    return `RESPONSABILITÀ PENALE DEI CLIENTI - ${String(d.etichettaCategoria || '').toUpperCase()}:

${corpo}

LA KASKO NON È ATTIVABILE SE AL MOMENTO DEL DANNO IL CLIENTE ERA SOTTO EFFETTO DI STUPEFACENTI O IN STATO DI EBREZZA.`
}
