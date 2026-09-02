/**
 * Itinerario a tappe: km su strada e tempo di percorrenza fra un punto e
 * l'altro (punto 1 → punto 2 → punto 3 …).
 *
 * I km li chiediamo a OSRM (router pubblico, gratuito, nessuna chiave):
 * una sola richiesta per tutto l'itinerario, che risponde con una "leg"
 * per ogni tratta — metri e secondi reali su strada.
 *
 * Se OSRM non risponde (offline, rate limit, coordinate mancanti) NON si
 * blocca il preventivo: si ripiega sulla stessa stima gia' usata per la
 * consegna a domicilio — distanza in linea d'aria x 1,3 — e sul tempo a
 * velocita' media. Le tratte stimate restano marcate (`stimato: true`)
 * cosi' l'operatore sa che quel numero e' approssimativo.
 */

import { haversineKm } from './dr7Distance'

/** Una tappa dell'itinerario. `lat`/`lon` arrivano dai suggerimenti indirizzo. */
export interface Tappa {
    /** Chiave stabile per React e per il riordino. */
    id: string
    indirizzo: string
    lat?: number
    lon?: number
}

/** L'itinerario salvato sul preventivo: tappe, tratte calcolate e costo. */
export interface ItinerarioValore {
    tappe: Tappa[]
    tratte: Tratta[]
    /** Km su strada di tutto il percorso. */
    km: number
    /** Minuti di percorrenza di tutto il percorso. */
    minuti: number
    /** Tariffa €/km applicata (parte da quella della Centralina Pro, correggibile). */
    prezzo_per_km: number
    /** true quando la tariffa l'ha scritta l'operatore: da li' in poi la
     *  Centralina Pro non la sovrascrive piu' (zero incluso = itinerario
     *  incluso nel prezzo, non a pagamento). */
    tariffa_manuale?: boolean
    /** km × €/km, arrotondato ai centesimi. */
    costo: number
    /** true se almeno una tratta e' una stima (router stradale non raggiungibile). */
    stimato: boolean
}

/** Itinerario a zero: nessuna tappa, nessun costo. */
export function itinerarioVuoto(): ItinerarioValore {
    return { tappe: [], tratte: [], km: 0, minuti: 0, prezzo_per_km: 0, costo: 0, stimato: false }
}

/** Una tratta = il pezzo di strada fra due tappe consecutive. */
export interface Tratta {
    /** Km su strada, arrotondati a un decimale. */
    km: number
    /** Minuti di percorrenza, arrotondati al minuto. */
    minuti: number
    /** true = numero stimato (OSRM non ha risposto). */
    stimato: boolean
}

/** Velocita' media usata solo dalla stima di ripiego. */
const VELOCITA_MEDIA_KMH = 70

/** Moltiplicatore linea d'aria → strada, lo stesso di dr7Distance. */
const FATTORE_STRADA = 1.3

/** Router pubblico OSRM. Nessuna chiave, nessun costo. */
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving'

/** Quanto aspettiamo OSRM prima di ripiegare sulla stima. */
const TIMEOUT_MS = 8000

/** Una tappa e' utilizzabile solo con entrambe le coordinate. */
export function tappaValida(t: Tappa | null | undefined): boolean {
    return !!t && Number.isFinite(t.lat) && Number.isFinite(t.lon)
}

function arrotonda(n: number, decimali = 1): number {
    const f = 10 ** decimali
    return Math.round(n * f) / f
}

/** Stima di ripiego fra due punti: linea d'aria x 1,3, tempo a velocita' media. */
function trattaStimata(a: Tappa, b: Tappa): Tratta {
    const km = arrotonda(
        haversineKm({ lat: a.lat as number, lon: a.lon as number }, { lat: b.lat as number, lon: b.lon as number }) * FATTORE_STRADA
    )
    return { km, minuti: Math.round((km / VELOCITA_MEDIA_KMH) * 60), stimato: true }
}

/**
 * Le tratte dell'itinerario, nell'ordine delle tappe. Ritorna un elemento in
 * meno delle tappe (2 tappe = 1 tratta). Le tappe senza coordinate vengono
 * saltate: si calcola sulle sole tappe posizionate.
 */
export async function calcolaTratte(tappe: Tappa[]): Promise<Tratta[]> {
    const punti = (tappe || []).filter(tappaValida)
    if (punti.length < 2) return []

    const stima = (): Tratta[] =>
        punti.slice(0, -1).map((p, i) => trattaStimata(p, punti[i + 1]))

    try {
        const coord = punti.map(p => `${p.lon},${p.lat}`).join(';')
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
        let res: Response
        try {
            res = await fetch(`${OSRM_URL}/${coord}?overview=false`, { signal: ctrl.signal })
        } finally {
            clearTimeout(timer)
        }
        if (!res.ok) return stima()
        const dati = await res.json() as {
            code?: string
            routes?: { legs?: { distance?: number; duration?: number }[] }[]
        }
        const legs = dati?.routes?.[0]?.legs
        if (dati.code !== 'Ok' || !Array.isArray(legs) || legs.length !== punti.length - 1) return stima()
        return legs.map((leg, i) => {
            const metri = Number(leg?.distance)
            const secondi = Number(leg?.duration)
            if (!Number.isFinite(metri) || !Number.isFinite(secondi)) return trattaStimata(punti[i], punti[i + 1])
            return { km: arrotonda(metri / 1000), minuti: Math.round(secondi / 60), stimato: false }
        })
    } catch {
        return stima()
    }
}

/** Somma di km e minuti di tutte le tratte. */
export function totaliItinerario(tratte: Tratta[]): { km: number; minuti: number; stimato: boolean } {
    const km = arrotonda((tratte || []).reduce((s, t) => s + (Number(t.km) || 0), 0))
    const minuti = Math.round((tratte || []).reduce((s, t) => s + (Number(t.minuti) || 0), 0))
    return { km, minuti, stimato: (tratte || []).some(t => t.stimato) }
}

/** "1h 25min" / "45min" / "—". Formato europeo, mai AM/PM. */
export function formattaDurata(minuti: number): string {
    const m = Math.max(0, Math.round(Number(minuti) || 0))
    if (m <= 0) return '—'
    const ore = Math.floor(m / 60)
    const resto = m % 60
    if (ore === 0) return `${resto}min`
    if (resto === 0) return `${ore}h`
    return `${ore}h ${String(resto).padStart(2, '0')}min`
}
