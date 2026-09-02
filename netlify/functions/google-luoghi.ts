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
 * POST { azione: 'cerca', testo }              -> { configurato, luoghi[] }
 * POST { azione: 'percorso', punti: [{lat,lon}] } -> { configurato, tratte[] }
 */

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || ''

/** Il centro su cui pesare la ricerca: ufficio DR7, Viale Marconi 229. */
const CENTRO = { lat: 39.2231, lon: 9.1374 }
/** Raggio del biasing, in metri: tutta l'area di Cagliari e dintorni. */
const RAGGIO_M = 50000

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

interface PlaceGoogle {
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    shortFormattedAddress?: string
    primaryTypeDisplayName?: { text?: string }
    location?: { latitude?: number; longitude?: number }
}

/** searchText invece di autocomplete: una sola chiamata porta gia' le coordinate. */
async function cercaPosti(testo: string) {
    const res = await fetch(PLACES_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
            // Solo i campi che servono: la fatturazione di Places cresce con
            // la field mask, chiedere tutto costerebbe senza motivo.
            'X-Goog-FieldMask': [
                'places.id',
                'places.displayName',
                'places.formattedAddress',
                'places.shortFormattedAddress',
                'places.primaryTypeDisplayName',
                'places.location',
            ].join(','),
        },
        body: JSON.stringify({
            textQuery: testo,
            languageCode: 'it',
            regionCode: 'IT',
            maxResultCount: 8,
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
        throw new Error(`places ${res.status}: ${testoErrore.slice(0, 200)}`)
    }
    const dati = await res.json() as { places?: PlaceGoogle[] }
    return (dati.places || []).flatMap(p => {
        const lat = p.location?.latitude
        const lon = p.location?.longitude
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
        const nome = p.displayName?.text || p.shortFormattedAddress || p.formattedAddress || ''
        if (!nome) return []
        const indirizzo = p.shortFormattedAddress || p.formattedAddress || ''
        return [{
            id: `google-${p.id || `${lat},${lon}`}`,
            nome,
            indirizzo: indirizzo === nome ? '' : indirizzo,
            categoria: p.primaryTypeDisplayName?.text || '',
            lat: lat as number,
            lon: lon as number,
        }]
    })
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
            punti?: { lat: number; lon: number }[]
        }

        if (body.azione === 'cerca') {
            const testo = String(body.testo || '').trim()
            if (testo.length < 2) {
                return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, luoghi: [] }) }
            }
            const luoghi = await cercaPosti(testo)
            return { statusCode: 200, headers, body: JSON.stringify({ configurato: true, luoghi }) }
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
