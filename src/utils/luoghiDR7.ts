/**
 * Rubrica dei luoghi DR7 e ricerca luoghi in stile "app di consegne": si
 * scrive il nome di un posto (DR7, un hotel, l'aeroporto) e la tendina
 * risponde con l'attivita', non solo con la via.
 *
 * Due sorgenti, in quest'ordine:
 *
 * 1. LUOGHI_DR7 — la rubrica di casa. OpenStreetMap non conosce DR7 (cercare
 *    "DR7" restituisce un capannone in Nuova Zelanda), quindi le nostre sedi
 *    stanno qui e vincono sempre sui risultati esterni.
 * 2. Google Places, quando su Netlify c'e' `GOOGLE_MAPS_API_KEY`. Conosce le
 *    attivita' con scheda Google (DR7 compresa) e gli indirizzi italiani
 *    meglio di chiunque altro. Passa dalla funzione `google-luoghi`, che
 *    tiene la chiave lato server. Se la chiave non c'e' risponde
 *    "non configurato" una volta e non ci si prova piu' per la sessione.
 * 3. Photon (photon.komoot.io) — indice OSM pensato per il type-ahead:
 *    trova attivita' (hotel, aeroporti, ristoranti, autonoleggi) e indirizzi
 *    civico compreso. Gratuito, nessuna chiave. Se non risponde si ripiega
 *    su Nominatim, lo stesso servizio gia' usato dagli altri campi indirizzo.
 *
 * I risultati sono ordinati per vicinanza a Cagliari, con l'Italia prima:
 * cercando "Marconi" deve uscire Cagliari, non Milano.
 */

import { DR7_OFFICE_COORDS, haversineKm } from './dr7Distance'
import { authFetch } from './authFetch'

export interface Luogo {
    /** Chiave stabile per React. */
    id: string
    /**
     * Solo per i suggerimenti Google: l'id del posto. Le coordinate non
     * arrivano con il suggerimento (costerebbero a ogni battuta) ma con
     * `risolviLuogo`, chiamata una volta sola sul posto scelto.
     */
    placeId?: string
    /** Il nome dell'attivita' ("Aeroporto di Cagliari-Elmas", "DR7"). Puo' essere l'indirizzo se il posto non ha nome. */
    nome: string
    /** La riga sotto il nome: via, civico, CAP, comune. */
    indirizzo: string
    /** Etichetta di categoria mostrata accanto al nome ("Hotel", "Aeroporto"). Vuota per gli indirizzi. */
    categoria: string
    /** Coordinate. `null` sui suggerimenti Google finche' non si sceglie il posto. */
    lat: number | null
    lon: number | null
    /** true = sede DR7 dalla rubrica interna: nella tendina va in cima con il badge. */
    dr7?: boolean
}

/**
 * Le sedi DR7. Aggiungerne una qui la rende cercabile in ogni campo che usa
 * questa ricerca. `alias` sono le parole con cui la si cerca oltre al nome.
 */
export const LUOGHI_DR7: (Luogo & { alias: string[] })[] = [
    {
        id: 'dr7-ufficio',
        nome: 'DR7 Luxury Empire',
        indirizzo: 'Viale Guglielmo Marconi 229, 09131 Cagliari CA',
        categoria: 'Sede DR7',
        lat: DR7_OFFICE_COORDS.lat,
        lon: DR7_OFFICE_COORDS.lon,
        dr7: true,
        alias: ['dr7', 'dr 7', 'ufficio', 'sede', 'marconi', 'dubai rent'],
    },
]

/** Le sedi DR7 che corrispondono al testo scritto. */
export function cercaLuoghiDR7(testo: string): Luogo[] {
    const q = testo.toLowerCase().trim()
    if (q.length < 2) return []
    return LUOGHI_DR7
        .filter(l => {
            const campi = [l.nome, l.indirizzo, ...l.alias].map(s => s.toLowerCase())
            return campi.some(c => c.includes(q))
        })
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ alias: _alias, ...luogo }) => luogo)
}

/** osm_key/osm_value → etichetta italiana. Quello che non e' qui resta senza categoria. */
const CATEGORIE: Record<string, string> = {
    'tourism/hotel': 'Hotel',
    'tourism/guest_house': 'B&B',
    'tourism/apartment': 'Appartamento',
    'tourism/attraction': 'Attrazione',
    'tourism/museum': 'Museo',
    'tourism/camp_site': 'Camping',
    'amenity/restaurant': 'Ristorante',
    'amenity/cafe': 'Bar',
    'amenity/bar': 'Bar',
    'amenity/pub': 'Pub',
    'amenity/fast_food': 'Fast food',
    'amenity/hospital': 'Ospedale',
    'amenity/pharmacy': 'Farmacia',
    'amenity/fuel': 'Distributore',
    'amenity/parking': 'Parcheggio',
    'amenity/car_rental': 'Autonoleggio',
    'amenity/bank': 'Banca',
    'amenity/police': 'Polizia',
    'amenity/townhall': 'Comune',
    'amenity/school': 'Scuola',
    'amenity/university': 'Universita',
    'aeroway/aerodrome': 'Aeroporto',
    'aeroway/terminal': 'Aeroporto',
    'amenity/ferry_terminal': 'Porto',
    'harbour/yes': 'Porto',
    'leisure/marina': 'Porto turistico',
    'leisure/beach_resort': 'Spiaggia',
    'natural/beach': 'Spiaggia',
    'railway/station': 'Stazione',
    'railway/halt': 'Stazione',
    'shop/car': 'Concessionaria',
    'shop/supermarket': 'Supermercato',
    'office/company': 'Azienda',
    'building/commercial': 'Azienda',
    'building/industrial': 'Azienda',
    'place/city': 'Comune',
    'place/town': 'Comune',
    'place/village': 'Comune',
    'place/suburb': 'Quartiere',
}

interface PhotonProps {
    name?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    county?: string
    state?: string
    country?: string
    countrycode?: string
    osm_key?: string
    osm_value?: string
    osm_id?: number
    osm_type?: string
}

/** La riga indirizzo sotto il nome: via civico, CAP comune. */
function componiIndirizzo(p: PhotonProps): string {
    const via = [p.street, p.housenumber].filter(Boolean).join(' ')
    const comune = [p.postcode, p.city || p.county].filter(Boolean).join(' ')
    return [via, comune, p.city ? undefined : p.state].filter(Boolean).join(', ')
}

const PHOTON_URL = 'https://photon.komoot.io/api/'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const TIMEOUT_MS = 6000

async function conTimeout(url: string): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
        return await fetch(url, { signal: ctrl.signal })
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Ordina come se lo facesse un navigatore: prima l'Italia, poi il piu' vicino
 * a Cagliari. Senza questo "Marconi" restituisce mezza Europa.
 */
function ordinaPerVicinanza(luoghi: (Luogo & { italia?: boolean })[]): Luogo[] {
    // Chi non ha coordinate (i suggerimenti Google) resta in fondo: qui ci
    // arrivano solo Photon e Nominatim, che le hanno sempre.
    const distanza = (l: Luogo) =>
        Number.isFinite(l.lat) && Number.isFinite(l.lon)
            ? haversineKm(DR7_OFFICE_COORDS, { lat: l.lat as number, lon: l.lon as number })
            : Number.POSITIVE_INFINITY
    return [...luoghi].sort((a, b) => {
        if (!!a.italia !== !!b.italia) return a.italia ? -1 : 1
        return distanza(a) - distanza(b)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    }).map(({ italia: _italia, ...l }) => l)
}

/**
 * Google c'e' o no. `null` = ancora da scoprire; una volta che la funzione
 * risponde "non configurato" si smette di chiamarla per tutta la sessione,
 * cosi' non si paga un giro di rete inutile a ogni lettera digitata.
 */
let googleAttivo: boolean | null = null

/**
 * L'ultimo motivo per cui Google non ha risposto, da mostrare nel campo.
 *
 * 03/09/2026: prima l'errore veniva inghiottito e si ripiegava su Photon
 * senza dire niente — a video sembrava che "Google non funzionasse", ma
 * nessuno poteva sapere se mancava la fatturazione, se l'API non era
 * abilitata o se la chiave era ristretta male. Un errore muto costa piu'
 * tempo di un errore scritto.
 */
let erroreGoogle: string | null = null

/** Il motivo dell'ultimo fallimento Google, o null se e' andata bene. */
export function ultimoErroreGoogle(): string | null {
    return erroreGoogle
}

/** Ricerca su Google Places (via la funzione Netlify che custodisce la chiave). */
async function cercaGoogle(testo: string, sessione: string): Promise<Luogo[] | null> {
    if (googleAttivo === false) return null
    erroreGoogle = null
    try {
        const res = await authFetch('/.netlify/functions/google-luoghi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ azione: 'cerca', testo, sessione }),
        })
        if (res.status === 503) { googleAttivo = false; return null }
        if (!res.ok) {
            // Il messaggio di Google arriva dentro `error`: e' quello che
            // dice se manca la fatturazione o l'API non e' abilitata.
            const dettaglio = await res.json().catch(() => null) as { error?: string } | null
            erroreGoogle = dettaglio?.error || `Google ha risposto ${res.status}`
            return null
        }
        const dati = await res.json() as { configurato?: boolean; luoghi?: Luogo[] }
        if (dati.configurato === false) { googleAttivo = false; return null }
        googleAttivo = true
        // I suggerimenti Google arrivano SENZA coordinate: si prendono con
        // `risolviLuogo` solo sul posto scelto. Google ordina gia' per
        // pertinenza e prossimita', quindi l'ordine non si tocca.
        const luoghi = (dati.luoghi || []).filter(l => l.placeId)
        return luoghi.length > 0 ? luoghi : null
    } catch (e) {
        erroreGoogle = e instanceof Error ? e.message : 'Google non raggiungibile'
        return null
    }
}

/** Ricerca su Photon: attivita' e indirizzi, con le coordinate. */
async function cercaPhoton(testo: string, limite: number): Promise<Luogo[]> {
    // Niente `lang`: Photon accetta solo default/de/en/fr e con `lang=it`
    // risponde 400 — la ricerca sarebbe sempre caduta sul ripiego. Il
    // default restituisce comunque i nomi locali ("Aeroporto di Cagliari").
    const url = `${PHOTON_URL}?q=${encodeURIComponent(testo)}`
        + `&lat=${DR7_OFFICE_COORDS.lat}&lon=${DR7_OFFICE_COORDS.lon}`
        + `&limit=${limite}`
    const res = await conTimeout(url)
    if (!res.ok) throw new Error(`photon ${res.status}`)
    const dati = await res.json() as {
        features?: { properties?: PhotonProps; geometry?: { coordinates?: [number, number] } }[]
    }
    const luoghi = (dati.features || []).flatMap(f => {
        const p = f.properties || {}
        const coord = f.geometry?.coordinates
        if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return []
        const indirizzo = componiIndirizzo(p)
        const nome = p.name || indirizzo || p.city || ''
        if (!nome) return []
        return [{
            id: `photon-${p.osm_type || 'x'}${p.osm_id || Math.random()}`,
            nome,
            // Quando il nome E' gia' l'indirizzo non lo ripetiamo sotto.
            indirizzo: nome === indirizzo ? [p.city, p.state].filter(Boolean).join(', ') : indirizzo,
            categoria: CATEGORIE[`${p.osm_key}/${p.osm_value}`] || '',
            lat: coord[1],
            lon: coord[0],
            italia: (p.countrycode || '').toUpperCase() === 'IT',
        }]
    })
    return ordinaPerVicinanza(luoghi)
}

/** Ripiego su Nominatim quando Photon non risponde. */
async function cercaNominatim(testo: string, limite: number): Promise<Luogo[]> {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(testo)}`
        + `&format=json&addressdetails=1&namedetails=1&accept-language=it&limit=${limite}`
    const res = await conTimeout(url)
    if (!res.ok) throw new Error(`nominatim ${res.status}`)
    const dati = await res.json() as {
        place_id?: number
        display_name?: string
        lat?: string
        lon?: string
        class?: string
        type?: string
        name?: string
        address?: Record<string, string>
    }[]
    const luoghi = (dati || []).flatMap(r => {
        const lat = parseFloat(r.lat || '')
        const lon = parseFloat(r.lon || '')
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
        const a = r.address || {}
        const via = [a.road, a.house_number].filter(Boolean).join(' ')
        const comune = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ')
        const indirizzo = [via, comune].filter(Boolean).join(', ') || (r.display_name || '')
        const nome = r.name || via || (r.display_name || '').split(',')[0]
        return [{
            id: `nominatim-${r.place_id || Math.random()}`,
            nome,
            indirizzo: nome === indirizzo ? comune : indirizzo,
            categoria: CATEGORIE[`${r.class}/${r.type}`] || '',
            lat,
            lon,
            italia: (a.country_code || '').toUpperCase() === 'IT',
        }]
    })
    return ordinaPerVicinanza(luoghi)
}

/**
 * La ricerca completa: rubrica DR7 in cima, poi le attivita' e gli indirizzi
 * trovati fuori. Non lancia mai: se entrambe le sorgenti falliscono restano
 * comunque i luoghi DR7 che corrispondono.
 */
export async function cercaLuoghi(testo: string, limite = 8, sessione = ''): Promise<Luogo[]> {
    const q = testo.trim()
    if (q.length < 2) return []
    const nostri = cercaLuoghiDR7(q)
    let esterni: Luogo[] = []
    // Prima Google (se configurato), poi le sorgenti gratuite.
    const daGoogle = await cercaGoogle(q, sessione)
    if (daGoogle) {
        esterni = daGoogle
    } else {
        try {
            esterni = await cercaPhoton(q, limite)
        } catch {
            try {
                esterni = await cercaNominatim(q, limite)
            } catch {
                esterni = []
            }
        }
    }
    // Niente doppioni con la rubrica di casa (stesso nome).
    const nomiNostri = new Set(nostri.map(l => l.nome.toLowerCase()))
    return [...nostri, ...esterni.filter(l => !nomiNostri.has(l.nome.toLowerCase()))].slice(0, limite + nostri.length)
}

/**
 * Le coordinate del posto scelto. I suggerimenti Google non le portano (le
 * battute sarebbero tutte a pagamento): si chiede il dettaglio una volta
 * sola, sul posto che l'operatore ha davvero scelto, chiudendo la sessione.
 *
 * Photon, Nominatim e la rubrica DR7 le hanno gia': tornano com'erano.
 */
export async function risolviLuogo(l: Luogo, sessione = ''): Promise<Luogo | null> {
    if (Number.isFinite(l.lat) && Number.isFinite(l.lon)) return l
    if (!l.placeId) return null
    try {
        const res = await authFetch('/.netlify/functions/google-luoghi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ azione: 'dettaglio', placeId: l.placeId, sessione }),
        })
        if (!res.ok) return null
        const dati = await res.json() as { luogo?: Luogo }
        const luogo = dati.luogo
        if (!luogo || !Number.isFinite(luogo.lat) || !Number.isFinite(luogo.lon)) return null
        // Il nome mostrato nella tendina resta quello scelto dall'operatore.
        return { ...luogo, nome: l.nome || luogo.nome, indirizzo: luogo.indirizzo || l.indirizzo }
    } catch {
        return null
    }
}

/** Il testo che finisce nel campo quando si sceglie un luogo. */
export function testoLuogo(l: Luogo): string {
    return l.indirizzo && l.indirizzo !== l.nome ? `${l.nome}, ${l.indirizzo}` : l.nome
}
