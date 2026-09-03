import { getCorsOrigin } from './cors-headers'
import type { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'

/**
 * google-luoghi — ricerca posti e calcolo percorso con Google Maps Platform.
 *
 * 02/09/2026. Serve al blocco "Itinerario a tappe" dei Preventivi. Google
 * conosce le ATTIVITA' (la scheda Google di DR7 compresa, che in
 * OpenStreetMap non esiste) e sa i tempi di percorrenza col traffico vero.
 *
 * La chiave sta SOLO qui: `GOOGLE_MAPS_API_KEY` nelle variabili Netlify,
 * senza prefisso VITE_ — una chiave nel bundle del browser la spenderebbe
 * chiunque sul conto DR7.
 *
 * Senza chiave configurata la funzione risponde 503 con
 * `{ configurato: false }` e il client resta su Photon/OSRM: si accende da
 * sola il giorno in cui la chiave viene messa, senza toccare il codice.
 *
 * POST { azione: 'cerca', testo, sessione }         -> { configurato, luoghi[] }  (senza coordinate)
 * POST { azione: 'dettaglio', placeId, sessione }   -> { configurato, luogo }     (con le coordinate)
 * POST { azione: 'percorso', punti: [{lat,lon}] }   -> { configurato, tratte[] }
 */

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || ''

/** Il centro su cui pesare la ricerca: ufficio DR7, Viale Marconi 229. */
const CENTRO = { lat: 39.2231, lon: 9.1374 }
/** Raggio del biasing, in metri: tutta l'area di Cagliari e dintorni. */
const RAGGIO_M = 50000

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places'
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

/**
 * Perche' Autocomplete e non Text Search (02/09/2026, prima di andare in
 * produzione): Text Search costa 32 $ ogni 1000 chiamate e partiva a ogni
 * pausa di battitura — scrivere "aeroporto cagliari" sono 3-4 chiamate, un
 * preventivo da tre tappe ~12, cioe' ~0,38 $ a preventivo. Con venti
 * preventivi al giorno erano ~200 $ al mese di ricerca indirizzi.
 *
 * Con il modello a sessione si paga quasi zero: l'Autocomplete dentro una
 * sessione non si paga, e si paga solo il Dettaglio del posto SCELTO (una
 * chiamata per tappa), che sotto le migliaia al mese resta nel gratuito.
 * Il `sessionToken` lega le battute alla scelta finale: senza, Google
 * fattura ogni singola battuta.
 */
interface PlaceGoogle {
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    shortFormattedAddress?: string
    primaryTypeDisplayName?: { text?: string }
    location?: { latitude?: number; longitude?: number }
    addressComponents?: {
        longText?: string
        shortText?: string
        types?: string[]
    }[]
}

/**
 * Via, civico, CAP, comune e provincia dal dettaglio Google. Servono ai campi
 * indirizzo del gestionale (fattura, anagrafica, contratto), che non vogliono
 * una riga di testo ma i pezzi separati.
 */
function partiIndirizzo(p: PlaceGoogle) {
    const pezzo = (tipo: string, corto = false) => {
        const c = (p.addressComponents || []).find(x => (x.types || []).includes(tipo))
        return (corto ? c?.shortText : c?.longText) || ''
    }
    return {
        via: pezzo('route'),
        civico: pezzo('street_number'),
        cap: pezzo('postal_code'),
        // `locality` e' il comune; nei paesi piccoli Google usa
        // administrative_area_level_3 e la locality resta vuota.
        comune: pezzo('locality') || pezzo('administrative_area_level_3'),
        // La provincia serve in sigla (CA, SU): e' lo shortText.
        provincia: pezzo('administrative_area_level_2', true),
        // Il paese in sigla ISO minuscola ("it", "fr"): sul sito decide
        // residente/non residente, e quindi la cauzione.
        paese: pezzo('country', true).toLowerCase(),
    }
}

interface SuggerimentoGoogle {
    placePrediction?: {
        placeId?: string
        text?: { text?: string }
        structuredFormat?: {
            mainText?: { text?: string }
            secondaryText?: { text?: string }
        }
    }
}

/** I suggerimenti mentre si scrive. Nessuna coordinata: quelle costano e arrivano solo alla scelta. */
async function suggerisciPosti(testo: string, sessione: string) {
    const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
        },
        body: JSON.stringify({
            input: testo,
            languageCode: 'it',
            regionCode: 'IT',
            sessionToken: sessione,
            locationBias: {
                circle: {
                    center: { latitude: CENTRO.lat, longitude: CENTRO.lon },
                    radius: RAGGIO_M,
                },
            },
        }),
    })
    if (!res.ok) {
        const testoErrore = await res.text()
        throw new Error(`autocomplete ${res.status}: ${testoErrore.slice(0, 200)}`)
    }
    const dati = await res.json() as { suggestions?: SuggerimentoGoogle[] }
    return (dati.suggestions || []).flatMap(s => {
        const p = s.placePrediction
        if (!p?.placeId) return []
        const nome = p.structuredFormat?.mainText?.text || p.text?.text || ''
        if (!nome) return []
        return [{
            id: `google-${p.placeId}`,
            placeId: p.placeId,
            nome,
            indirizzo: p.structuredFormat?.secondaryText?.text || '',
            categoria: '',
            // Le coordinate arrivano con il dettaglio, alla scelta.
            lat: null as number | null,
            lon: null as number | null,
        }]
    })
}

/** Il dettaglio del posto scelto: qui arrivano le coordinate. Una chiamata per tappa. */
async function dettaglioPosto(placeId: string, sessione: string) {
    const url = `${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`
        + `?languageCode=it&sessionToken=${encodeURIComponent(sessione)}`
    const res = await fetch(url, {
        headers: {
            'X-Goog-Api-Key': API_KEY,
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,shortFormattedAddress,location,primaryTypeDisplayName,addressComponents',
        },
    })
    if (!res.ok) {
        const testoErrore = await res.text()
        throw new Error(`details ${res.status}: ${testoErrore.slice(0, 200)}`)
    }
    const p = await res.json() as PlaceGoogle
    const lat = p.location?.latitude
    const lon = p.location?.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('details: posto senza coordinate')
    const nome = p.displayName?.text || p.shortFormattedAddress || p.formattedAddress || ''
    const indirizzo = p.shortFormattedAddress || p.formattedAddress || ''
    return {
        id: `google-${p.id || placeId}`,
        placeId,
        nome,
        indirizzo: indirizzo === nome ? '' : indirizzo,
        categoria: p.primaryTypeDisplayName?.text || '',
        lat: lat as number,
        lon: lon as number,
        parti: partiIndirizzo(p),
        // L'indirizzo per esteso: e' quello che finisce nei campi del
        // gestionale quando non serve il nome dell'attivita'.
        indirizzoCompleto: p.formattedAddress || indirizzo,
    }
}

/**
 * Un solo computeRoutes per tutto l'itinerario: le tappe di mezzo diventano
 * intermediates e la risposta porta una `leg` per tratta, col traffico.
 */
async function calcolaPercorso(punti: { lat: number; lon: number }[]) {
    const waypoint = (p: { lat: number; lon: number }) => ({
        location: { latLng: { latitude: p.lat, longitude: p.lon } },
    })
    const res = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
            'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration',
        },
        body: JSON.stringify({
            origin: waypoint(punti[0]),
            destination: waypoint(punti[punti.length - 1]),
            intermediates: punti.slice(1, -1).map(waypoint),
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            languageCode: 'it',
            units: 'METRIC',
        }),
    })
    if (!res.ok) {
        const testoErrore = await res.text()
        throw new Error(`routes ${res.status}: ${testoErrore.slice(0, 200)}`)
    }
    const dati = await res.json() as {
        routes?: { legs?: { distanceMeters?: number; duration?: string }[] }[]
    }
    const legs = dati.routes?.[0]?.legs
    if (!Array.isArray(legs) || legs.length !== punti.length - 1) {
        throw new Error('routes: numero di tratte inatteso')
    }
    return legs.map(l => {
        const metri = Number(l.distanceMeters)
        // La durata arriva come stringa in secondi ("1234s").
        const secondi = Number(String(l.duration || '').replace(/s$/, ''))
        return {
            km: Math.round((metri / 1000) * 10) / 10,
            minuti: Math.round(secondi / 60),
            stimato: false,
        }
    })
}

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) }

    // Solo dal gestionale: la chiave e' a consumo, non la si lascia
    // interrogare da fuori.
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    if (!API_KEY) {
        return {
            statusCode: 503,
            headers,
            body: JSON.stringify({
                configurato: false,
                messaggio: 'GOOGLE_MAPS_API_KEY non configurata su Netlify: si usa la ricerca di riserva.',
            }),
        }
    }

    try {
        const body = JSON.parse(event.body || '{}') as {
            azione?: string
            testo?: string
            placeId?: string
            sessione?: string
            punti?: { lat: number; lon: number }[]
        }
        // La sessione lega le battute alla scelta finale: e' quella che rende
        // gratuito l'Autocomplete. Se il client non la manda si fattura a
        // richiesta, quindi meglio saperlo dal log che scoprirlo dal conto.
        const sessione = String(body.sessione || '')
        if (!sessione && (body.azione === 'cerca' || body.azione === 'dettaglio')) {
            console.warn('[google-luoghi] chiamata senza sessione: Autocomplete fatturato a richiesta')
        }

        if (body.azione === 'cerca') {
            const testo = String(body.testo || '').trim()
            if (testo.length < 2) {
                return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, luoghi: [] }) }
            }
            const luoghi = await suggerisciPosti(testo, sessione)
            return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, luoghi }) }
        }

        if (body.azione === 'dettaglio') {
            const placeId = String(body.placeId || '')
            if (!placeId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'placeId mancante' }) }
            }
            const luogo = await dettaglioPosto(placeId, sessione)
            return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, luogo }) }
        }

        if (body.azione === 'percorso') {
            const punti = (body.punti || []).filter(p =>
                p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
            if (punti.length < 2) {
                return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, tratte: [] }) }
            }
            // Routes accetta al massimo 25 waypoint intermedi: oltre, meglio
            // dirlo che ricevere un 400 opaco.
            if (punti.length > 25) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Massimo 25 tappe per itinerario' }) }
            }
            const tratte = await calcolaPercorso(punti)
            return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, tratte }) }
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: 'azione sconosciuta' }) }
    } catch (e) {
        const messaggio = e instanceof Error ? e.message : String(e)
        console.error('[google-luoghi]', messaggio)
        // 502 e non 500: per il client e' "Google non ha risposto", quindi
        // ripiega sulla sorgente gratuita invece di lasciare il campo muto.
        return { statusCode: 502, headers, body: JSON.stringify({ configurato: true, error: messaggio }) }
    }
}
