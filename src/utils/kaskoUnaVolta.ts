/**
 * Kasko modificata SOLO per questa volta.
 *
 * Il listino sta in Centralina Pro ed e' giusto che ci resti: quando pero' si
 * chiude un accordo diverso con UN cliente (prezzo diverso, franchigie
 * diverse), prima l'unica strada era cambiare l'opzione in Centralina —
 * cambiandola per tutti — e rimetterla a posto dopo. Da qui la modifica
 * "una volta sola": vale per questa prenotazione o per questo preventivo, e
 * non tocca il listino.
 *
 * Vive dentro `booking_details.kasko_una_volta` (e nella riga del preventivo):
 * viaggia con la prenotazione, quindi il contratto stampa quello che il
 * cliente ha davvero accettato, anche a distanza di mesi.
 */

/** Una riga della tabella franchigie: euro e scoperto in percentuale. */
export interface VoceFranchigia {
    eur: number | ''
    perc: number | ''
}

export interface KaskoUnaVolta {
    /** Id dell'opzione a cui si riferisce: se cambia opzione, la modifica cade. */
    opzione_id: string
    /** Nome dell'opzione al momento della modifica, per i messaggi. */
    opzione_nome?: string
    /** Prezzo al giorno concordato. Vuoto = resta quello di listino. */
    prezzo_giorno?: number | ''
    /** Riga Kasko della tabella franchigie. */
    franchigia_eur?: number | ''
    scoperto_perc?: number | ''
    /** Le altre righe della tabella. */
    incendio?: VoceFranchigia
    furto?: VoceFranchigia
    eventi_naturali?: VoceFranchigia
    eventi_sociopolitici?: VoceFranchigia
    atti_vandalici?: VoceFranchigia
    /** Perche' e' stata concordata: finisce nello storico, non sul contratto. */
    nota?: string
    /** Quando e da chi. */
    creata_il?: string
}

export const GARANZIE: { chiave: 'incendio' | 'furto' | 'eventi_naturali' | 'eventi_sociopolitici' | 'atti_vandalici'; label: string }[] = [
    { chiave: 'incendio', label: 'Incendio' },
    { chiave: 'furto', label: 'Furto' },
    { chiave: 'eventi_naturali', label: 'Eventi naturali' },
    { chiave: 'eventi_sociopolitici', label: 'Eventi sociopolitici' },
    { chiave: 'atti_vandalici', label: 'Atti vandalici' },
]

const numero = (v: unknown): number | '' => {
    if (v === '' || v === null || v === undefined) return ''
    const n = Number(v)
    return Number.isFinite(n) ? n : ''
}

/** Normalizza quello che arriva dal database (o da una versione vecchia). */
export function leggiKaskoUnaVolta(raw: unknown): KaskoUnaVolta | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (!o.opzione_id) return null
    const voce = (v: unknown): VoceFranchigia => {
        if (!v || typeof v !== 'object') return { eur: '', perc: '' }
        const x = v as Record<string, unknown>
        return { eur: numero(x.eur), perc: numero(x.perc) }
    }
    return {
        opzione_id: String(o.opzione_id),
        opzione_nome: o.opzione_nome ? String(o.opzione_nome) : undefined,
        prezzo_giorno: numero(o.prezzo_giorno),
        franchigia_eur: numero(o.franchigia_eur),
        scoperto_perc: numero(o.scoperto_perc),
        incendio: voce(o.incendio),
        furto: voce(o.furto),
        eventi_naturali: voce(o.eventi_naturali),
        eventi_sociopolitici: voce(o.eventi_sociopolitici),
        atti_vandalici: voce(o.atti_vandalici),
        nota: o.nota ? String(o.nota) : undefined,
        creata_il: o.creata_il ? String(o.creata_il) : undefined,
    }
}

/**
 * Il prezzo al giorno da usare: quello concordato se c'e' ED e' per l'opzione
 * scelta adesso, altrimenti il listino. Cambiare opzione annulla l'accordo:
 * un prezzo pattuito sulla Kasko DR7 non vale per la Kasko Base.
 */
export function prezzoKaskoDelGiorno(
    prezzoListino: number,
    opzioneId: string | undefined,
    modifica: KaskoUnaVolta | null | undefined,
): number {
    if (!modifica || !opzioneId || modifica.opzione_id !== opzioneId) return prezzoListino
    return modifica.prezzo_giorno === '' || modifica.prezzo_giorno === undefined
        ? prezzoListino
        : Number(modifica.prezzo_giorno)
}

/** `true` se la modifica riguarda l'opzione attualmente scelta. */
export function modificaAttiva(opzioneId: string | undefined, modifica: KaskoUnaVolta | null | undefined): boolean {
    return !!modifica && !!opzioneId && modifica.opzione_id === opzioneId
}
