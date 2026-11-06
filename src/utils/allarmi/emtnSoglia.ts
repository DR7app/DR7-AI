/**
 * Allarme "Cliente sotto la soglia EMTN" (07/11/2026).
 *
 * Richiesta della direzione: se un cliente con EMTN Score sotto la soglia di
 * allarme (Centralina Pro > EMTN) ha un noleggio, si apre la finestra
 * centrale con il suono finche' qualcuno non preme Risolto.
 *
 * Il punteggio NON si calcola qui: e' quello di EMTN salvato in
 * emtn_score_clienti (netlify/functions/utils/emtnScorePersistito.ts,
 * aggiornato da emtn-score-ricalcolo ogni 10 minuti). Il cliente si aggancia
 * alla prenotazione solo per id (user_id, booking_details.customer_id,
 * customer.customerId, customer.id), mai per nome o telefono.
 *
 * Le prenotazioni si leggono qui per cliente, non dalla finestra del motore
 * (±45 giorni di ritiro): un noleggio prenotato oggi per fra tre mesi conta.
 * Soglia spenta o tabella assente = nessun allarme.
 */
import {
    isNoleggio,
    isViva,
    ritiroAt,
    type BookingLite,
    type ClienteAllarmi,
    type Detector,
    type ModuloAllarmi,
} from '../alarmDetectors'
import { servizioDellaPrenotazione } from './nuovePrenotazioni'
import { EMTN_SOGLIE_KEY, normalizzaSoglieEmtn, sottoSoglia } from '../emtnSoglie'
import { getRomeDateComponents } from '../timezoneUtils'

export const EXTRA_EMTN_SOTTO_SOGLIA = 'emtn_sotto_soglia'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PrenotazioneEmtn = BookingLite & { _emtn_score: number; _emtn_soglia: number }

/** Id del cliente sulla prenotazione (account del sito o scheda). */
export function idClientePrenotazione(b: BookingLite): string[] {
    const bd = b.booking_details || {}
    return [b.user_id, bd.customer_id, bd.customer?.customerId, bd.customer?.id]
        .filter((v): v is string => typeof v === 'string' && UUID.test(v))
}

function oraIt(d: Date | null): string {
    if (!d) return ''
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)}/${c.year} ${p(c.hour)}:${p(c.minute)}`
}

async function carica(now: Date, sb: ClienteAllarmi): Promise<Record<string, unknown[]>> {
    const vuoto = { [EXTRA_EMTN_SOTTO_SOGLIA]: [] }
    const { data: cfg, error: errCfg } = await sb.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
    if (errCfg) throw errCfg
    const soglia = normalizzaSoglieEmtn((cfg?.config as Record<string, unknown> | null)?.[EMTN_SOGLIE_KEY]).soglia_allarme
    if (soglia == null) return vuoto

    const { data: punteggi, error } = await sb
        .from('emtn_score_clienti')
        .select('persona_id, score')
        .lt('score', soglia)
        .range(0, 999)
    // Migrazione 20261107 non ancora eseguita: nessun allarme, nessun errore.
    if (error || !punteggi || punteggi.length === 0) return vuoto
    const scorePerId = new Map<string, number>()
    for (const r of punteggi as Array<{ persona_id: string; score: number }>) scorePerId.set(String(r.persona_id), Number(r.score))

    const ids = [...scorePerId.keys()]
    // Noleggi non ancora riconsegnati: in corso o futuri.
    const da = new Date(now.getTime() - 60 * 60_000).toISOString()
    const righe = new Map<string, PrenotazioneEmtn>()
    for (let i = 0; i < ids.length; i += 100) {
        const lista = ids.slice(i, i + 100).join(',')
        const { data, error: errB } = await sb
            .from('bookings')
            .select('id, user_id, service_type, vehicle_id, vehicle_name, vehicle_plate, customer_name, status, pickup_date, dropoff_date, booking_details')
            .neq('status', 'cancelled')
            .neq('status', 'annullata')
            .or(`user_id.in.(${lista}),booking_details->>customer_id.in.(${lista}),booking_details->customer->>customerId.in.(${lista}),booking_details->customer->>id.in.(${lista})`)
            .or(`dropoff_date.gte.${da},pickup_date.gte.${da}`)
            .range(0, 999)
        if (errB) throw errB
        for (const b of (data || []) as BookingLite[]) {
            const score = Math.min(...idClientePrenotazione(b).map(id => scorePerId.get(id)).filter((s): s is number => typeof s === 'number'))
            if (!Number.isFinite(score)) continue
            righe.set(String(b.id), { ...b, _emtn_score: score, _emtn_soglia: soglia })
        }
    }
    return { [EXTRA_EMTN_SOTTO_SOGLIA]: [...righe.values()] }
}

const emtn_sotto_soglia: Detector = (_cfg, ctx) => {
    const righe = (ctx.extra?.[EXTRA_EMTN_SOTTO_SOGLIA] || []) as PrenotazioneEmtn[]
    return righe
        .filter(b => isViva(b) && isNoleggio(b) && servizioDellaPrenotazione(b) === 'noleggio'
            && sottoSoglia(b._emtn_score, b._emtn_soglia))
        .map(b => {
            const cliente = b.booking_details?.customer?.fullName || b.customer_name || 'Cliente'
            const ritiro = ritiroAt(b)
            return {
                bookingId: String(b.id),
                vehicleId: b.vehicle_id ? String(b.vehicle_id) : undefined,
                entita: [cliente, `EMTN ${b._emtn_score}%`, b.vehicle_name || b.vehicle_plate || ''].filter(Boolean).join(' · '),
                dettaglio: `EMTN Score ${b._emtn_score}% sotto la soglia di allarme ${b._emtn_soglia}%`
                    + (ritiro ? ` · ritiro ${oraIt(ritiro)}` : ''),
            }
        })
}

export const moduloEmtnSoglia: ModuloAllarmi = {
    nome: 'emtn_soglia',
    detectors: { emtn_sotto_soglia },
    carica,
}
