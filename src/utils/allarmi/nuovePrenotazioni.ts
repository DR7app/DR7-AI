/**
 * Allarme "Nuova prenotazione" per servizio (09/10/2026).
 *
 * Richiesta della direzione: alla creazione di una prenotazione (noleggio,
 * lavaggio, meccanica, mare, aria, soggiorni) si apre la finestra centrale
 * degli allarmi con il suono, finche' qualcuno non preme Risolto.
 *
 * Un solo detector, `booking_creata:<servizio>`, sei righe nel catalogo
 * (gruppo prenotazioni). La soglia e' la finestra in minuti DOPO la creazione
 * in cui l'allarme resta aperto: oltre, si chiude da solo.
 *
 * Le prenotazioni si leggono qui per data di CREAZIONE: la finestra del motore
 * e' per data di ritiro (±45 giorni), quindi un noleggio prenotato oggi per
 * fra tre mesi non ci sarebbe.
 */
import {
    isNoleggio,
    isLavaggio,
    isViva,
    appuntamentoAt,
    ritiroAt,
    sogliaMs,
    type BookingLite,
    type ClienteAllarmi,
    type Detector,
    type ModuloAllarmi,
} from '../alarmDetectors'
import { getRomeDateComponents } from '../timezoneUtils'

export const EXTRA_NUOVE_PRENOTAZIONI = 'nuove_prenotazioni'

/** Quanto indietro si legge: la soglia massima sensata dal gestionale. */
const ORE_LETTURA = 72

export type ServizioNuovaPrenotazione = 'noleggio' | 'lavaggio' | 'meccanica' | 'mare' | 'aria' | 'soggiorni'

const ALTRI_REPARTI: Record<string, ServizioNuovaPrenotazione> = {
    boat_rental: 'mare',
    heli_rental: 'aria',
    stay_rental: 'soggiorni',
    mechanical_service: 'meccanica',
    mechanical: 'meccanica',
}

/** A quale servizio appartiene una prenotazione; null = non conta (interna, uscita, blocco). */
export function servizioDellaPrenotazione(b: BookingLite): ServizioNuovaPrenotazione | null {
    const tipo = String(b.service_type || '')
    if (tipo === 'car_wash') return isLavaggio(b) ? 'lavaggio' : null
    if (ALTRI_REPARTI[tipo]) return ALTRI_REPARTI[tipo]
    if (tipo === 'uscita_straordinaria') return null
    return isNoleggio(b) ? 'noleggio' : null
}

function oraIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)} ${p(c.hour)}:${p(c.minute)}`
}

function etichetta(b: BookingLite, servizio: ServizioNuovaPrenotazione): string {
    const cliente = b.customer_name || b.booking_details?.customer?.fullName || b.booking_details?.customer?.full || 'Cliente'
    const cosa = servizio === 'lavaggio' || servizio === 'meccanica'
        ? (b.service_name || b.vehicle_name || '')
        : (b.vehicle_name || b.service_name || '')
    const quando = servizio === 'lavaggio' || servizio === 'meccanica' ? appuntamentoAt(b) : ritiroAt(b)
    return [cliente, cosa, quando ? oraIt(quando) : ''].filter(Boolean).join(' · ')
}

async function carica(now: Date, sb: ClienteAllarmi): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - ORE_LETTURA * 60 * 60_000).toISOString()
    const { data, error } = await sb
        .from('bookings')
        .select('id, created_at, service_type, service_name, vehicle_id, vehicle_name, customer_name, status, pickup_date, appointment_date, booking_source, booking_details')
        .gte('created_at', da)
        .neq('status', 'cancelled')
        .neq('status', 'annullata')
        .order('created_at', { ascending: false })
        .range(0, 999)
    if (error) throw error
    return { [EXTRA_NUOVE_PRENOTAZIONI]: data || [] }
}

const booking_creata: Detector = (cfg, ctx, arg) => {
    const servizio = String(arg || '') as ServizioNuovaPrenotazione
    const finestra = sogliaMs(cfg)
    const righe = (ctx.extra?.[EXTRA_NUOVE_PRENOTAZIONI] || []) as BookingLite[]
    return righe
        .filter(b => {
            if (!isViva(b) || servizioDellaPrenotazione(b) !== servizio) return false
            const creata = new Date(String(b.created_at || '')).getTime()
            if (!Number.isFinite(creata)) return false
            const eta = ctx.now.getTime() - creata
            return eta >= -60_000 && eta <= finestra
        })
        .map(b => ({
            bookingId: String(b.id),
            vehicleId: b.vehicle_id ? String(b.vehicle_id) : undefined,
            entita: etichetta(b, servizio),
            dettaglio: `Creata il ${oraIt(new Date(String(b.created_at)))}${b.booking_source === 'website' ? ' dal sito' : ''}`,
        }))
}

export const moduloNuovePrenotazioni: ModuloAllarmi = {
    nome: 'nuove_prenotazioni',
    detectors: { booking_creata },
    carica,
}
