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
import { serviziExtraPrenotati, serviziExtraInBreve, type ServizioExtraCatalogo } from '../serviziExtraPrenotazione'

export const EXTRA_NUOVE_PRENOTAZIONI = 'nuove_prenotazioni'
export const EXTRA_CATALOGO_SERVIZI_EXTRA = 'catalogo_servizi_extra'

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
        .select('id, created_at, service_type, service_name, vehicle_id, vehicle_name, customer_name, status, pickup_date, dropoff_date, appointment_date, booking_source, booking_details')
        .gte('created_at', da)
        .neq('status', 'cancelled')
        .neq('status', 'annullata')
        .order('created_at', { ascending: false })
        .range(0, 999)
    if (error) throw error
    // 18/11/2026: nomi e prezzi dei servizi extra per l'allarme dedicato.
    // Se la Centralina non si legge l'allarme suona lo stesso, con gli id.
    let catalogo: ServizioExtraCatalogo[] = []
    try {
        const { data: cfg } = await sb.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exp = (cfg as any)?.config?.servizi?.experience
        if (Array.isArray(exp)) catalogo = exp
    } catch { /* ripiego: id grezzi */ }
    return { [EXTRA_NUOVE_PRENOTAZIONI]: data || [], [EXTRA_CATALOGO_SERVIZI_EXTRA]: catalogo }
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

/**
 * 18/11/2026: "Servizi extra prenotati". Un cliente ha prenotato 6 rose dal
 * sito e nessuno se n'e' accorto. Si apre per ogni prenotazione viva creata
 * entro la soglia (minuti dopo la creazione) che ha almeno un servizio extra;
 * il dettaglio dice quali e quanti. Resta aperto finche' qualcuno preme Risolto.
 */
const servizi_extra_prenotati: Detector = (cfg, ctx) => {
    const finestra = sogliaMs(cfg)
    const righe = (ctx.extra?.[EXTRA_NUOVE_PRENOTAZIONI] || []) as BookingLite[]
    const catalogo = (ctx.extra?.[EXTRA_CATALOGO_SERVIZI_EXTRA] || []) as ServizioExtraCatalogo[]
    const out: Array<{ bookingId: string; vehicleId?: string; entita: string; dettaglio: string }> = []
    for (const b of righe) {
        if (!isViva(b)) continue
        const servizio = servizioDellaPrenotazione(b)
        if (!servizio) continue
        const creata = new Date(String(b.created_at || '')).getTime()
        if (!Number.isFinite(creata)) continue
        const eta = ctx.now.getTime() - creata
        if (eta < -60_000 || eta > finestra) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extra = serviziExtraPrenotati(b as any, catalogo)
        if (!extra.length) continue
        out.push({
            bookingId: String(b.id),
            vehicleId: b.vehicle_id ? String(b.vehicle_id) : undefined,
            entita: etichetta(b, servizio),
            dettaglio: serviziExtraInBreve(extra),
        })
    }
    return out
}

export const moduloNuovePrenotazioni: ModuloAllarmi = {
    nome: 'nuove_prenotazioni',
    detectors: { booking_creata, servizi_extra_prenotati },
    carica,
}
