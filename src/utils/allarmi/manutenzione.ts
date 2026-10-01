/**
 * Allarmi dei gruppi Manutenzione, Pneumatici e Chilometraggio (01/10/2026).
 *
 * Da dove vengono i dati (misurato su produzione il 01/10/2026):
 *   - vehicles: km attuali, ultimo tagliando / cambio gomme / cambio freni in
 *     km e intervalli in km, scritti da Flotta > scheda veicolo
 *     (FleetVehicleDetail). Sono gli stessi campi che usa il controllo storico
 *     checkFleetMaintenanceAlarms di VehicleAlarmContext per le righe fleet_*:
 *     quelle restano li', qui ci sono le righe nuove del catalogo.
 *   - vehicle_maintenance_log: "Registra intervento" della stessa scheda
 *     (Tagliando, Cambio gomme, Cambio pastiglie/freni... con i km).
 *   - bookings.booking_details.penalties / danni: Danni & Penali. La voce
 *     "Sforo Km" (km x tariffa del contratto) e i danni alle gomme.
 *
 * Regole che valgono per tutte le rilevazioni di questo file:
 *   - un km a 0 o vuoto vuol dire "mai inserito", non "fatto a km 0": la
 *     scheda salva 0 di default. Contarlo come dato vero farebbe suonare
 *     "tagliando scaduto" su ogni veicolo nuovo (Vito: gomme 0 + 30.000 km).
 *   - intervalli sotto i 1.000 km sono errori di battitura (Cayenne: freni
 *     ogni 111 km) e si ignorano: un allarme su un dato sbagliato non serve.
 *   - le soglie in km si leggono dalla riga del catalogo quando l'unita' e'
 *     'km'; se la riga ha ancora l'unita' in giorni si usano 1.000 km, il
 *     valore storico degli allarmi fleet_*.
 */
import { supabase } from '../../supabaseClient'
import { getRomeDateComponents } from '../timezoneUtils'
import {
    isNoleggio,
    isViva,
    ritiroAt,
    sogliaMs,
    type AlarmCfgLite,
    type AlarmHit,
    type Detector,
    type DetectorContext,
    type ModuloAllarmi,
} from '../alarmDetectors'

const GIORNO = 24 * 60 * 60_000
const KM_SOGLIA_DEFAULT = 1000
const INTERVALLO_MINIMO_KM = 1000
/** Addebiti e danni si leggono sui noleggi rientrati negli ultimi 180 giorni. */
const GIORNI_ADDEBITI = 180

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Riga = Record<string, any>

// ─── Aiutanti ────────────────────────────────────────────────────────────────

function numero(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

/** Primo valore > 0 tra quelli dati, altrimenti 0 ("non inserito"). */
function primoPositivo(...valori: unknown[]): number {
    for (const v of valori) {
        const n = numero(v)
        if (n > 0) return n
    }
    return 0
}

function data(v: unknown): Date | null {
    if (!v) return null
    const s = String(v)
    // Le date senza ora ("2026-09-28") sono giorni di calendario italiani.
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s)
    return Number.isFinite(d.getTime()) ? d : null
}

function giornoIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)}/${c.year}`
}

function kmIt(n: number): string {
    return `${Math.round(n).toLocaleString('it-IT')} km`
}

function etichettaVeicolo(v: Riga): string {
    return `${v.display_name || 'Veicolo'}${v.plate ? ` (${v.plate})` : ''}`
}

function etichettaNoleggio(b: Riga): string {
    const mezzo = b.vehicle_name || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    return `${mezzo}${targa} · ${b.customer_name || 'Cliente'}`
}

function sogliaKm(cfg: AlarmCfgLite): number {
    if (cfg.threshold_unit === 'km') return Math.max(0, numero(cfg.threshold_value))
    return KM_SOGLIA_DEFAULT
}

function veicoli(ctx: DetectorContext): Riga[] {
    const lista = (ctx.extra?.manutenzione_veicoli as Riga[] | undefined) || ctx.vehicles
    return lista.filter(v => String(v.status || '').toLowerCase() !== 'retired')
}

function registro(ctx: DetectorContext): Riga[] {
    return (ctx.extra?.manutenzione_log as Riga[] | undefined) || []
}

function addebiti(ctx: DetectorContext): Riga[] {
    return (ctx.extra?.manutenzione_addebiti as Riga[] | undefined) || []
}

/** Km piu' alto registrato in "Registra intervento" per veicolo e tipo. */
function kmRegistro(ctx: DetectorContext, vehicleId: string, tipo?: RegExp): number {
    let max = 0
    for (const r of registro(ctx)) {
        if (String(r.vehicle_id) !== vehicleId) continue
        if (tipo && !tipo.test(String(r.tipo || ''))) continue
        max = Math.max(max, numero(r.km))
    }
    return max
}

// ─── Scadenze a km (tagliando, gomme, freni) ─────────────────────────────────

interface Scadenza {
    vehicle: Riga
    voce: string
    ultimoKm: number
    prossimoKm: number
    mancano: number
}

type Componente = 'tagliando' | 'gomme' | 'freni'

const TIPO_REGISTRO: Record<Componente, RegExp> = {
    tagliando: /^tagliando$/i,
    gomme: /gomm/i,
    freni: /pastiglie|freni/i,
}

/**
 * Le scadenze a km di un componente, una per asse dove serve. Stessa regola
 * di FleetVehicleDetail: intervallo dell'asse, altrimenti quello generale;
 * ultimo cambio dell'asse, altrimenti quello generale; in piu' l'ultimo
 * intervento dello stesso tipo nel registro, se e' piu' recente.
 */
function scadenze(ctx: DetectorContext, comp: Componente): Scadenza[] {
    const out: Scadenza[] = []
    for (const v of veicoli(ctx)) {
        const attuali = numero(v.current_km)
        if (attuali <= 0) continue
        const dalRegistro = kmRegistro(ctx, String(v.id), TIPO_REGISTRO[comp])
        const voci: { voce: string; intervallo: number; ultimo: number }[] =
            comp === 'tagliando'
                ? [{ voce: 'Tagliando', intervallo: primoPositivo(v.maintenance_service_interval_km), ultimo: primoPositivo(v.last_service_km) }]
                : comp === 'gomme'
                    ? [
                        { voce: 'Gomme anteriori', intervallo: primoPositivo(v.maintenance_tires_front_interval_km, v.maintenance_tires_interval_km), ultimo: primoPositivo(v.last_tire_change_front_km, v.last_tire_change_km) },
                        { voce: 'Gomme posteriori', intervallo: primoPositivo(v.maintenance_tires_rear_interval_km, v.maintenance_tires_interval_km), ultimo: primoPositivo(v.last_tire_change_rear_km, v.last_tire_change_km) },
                    ]
                    : [
                        { voce: 'Freni anteriori', intervallo: primoPositivo(v.maintenance_brake_front_interval_km, v.maintenance_brake_interval_km), ultimo: primoPositivo(v.last_brake_change_front_km, v.last_brake_change_km) },
                        { voce: 'Freni posteriori', intervallo: primoPositivo(v.maintenance_brake_rear_interval_km, v.maintenance_brake_interval_km), ultimo: primoPositivo(v.last_brake_change_rear_km, v.last_brake_change_km) },
                    ]
        for (const x of voci) {
            if (x.intervallo < INTERVALLO_MINIMO_KM) continue
            const ultimo = Math.max(x.ultimo, dalRegistro)
            if (ultimo <= 0) continue
            const prossimo = ultimo + x.intervallo
            out.push({ vehicle: v, voce: x.voce, ultimoKm: ultimo, prossimoKm: prossimo, mancano: prossimo - attuali })
        }
    }
    return out
}

function hitScadenza(s: Scadenza): AlarmHit {
    return {
        vehicleId: s.vehicle.id,
        entita: `${etichettaVeicolo(s.vehicle)} · ${s.voce}`,
        dettaglio: s.mancano > 0
            ? `Mancano ${kmIt(s.mancano)} (a ${kmIt(s.prossimoKm)}; ora ${kmIt(numero(s.vehicle.current_km))}, ultimo a ${kmIt(s.ultimoKm)})`
            : `Superato di ${kmIt(-s.mancano)} (doveva farsi a ${kmIt(s.prossimoKm)}; ora ${kmIt(numero(s.vehicle.current_km))})`,
    }
}

/** arg: 'vicino' (0 < mancano <= soglia) | 'scaduto' (mancano <= 0) | 'entro' (mancano <= soglia, scaduti compresi). */
function filtroScadenza(cfg: AlarmCfgLite, arg: string | undefined) {
    const soglia = sogliaKm(cfg)
    return (s: Scadenza) => {
        if (arg === 'scaduto') return s.mancano <= 0
        if (arg === 'entro') return s.mancano <= soglia
        return s.mancano > 0 && s.mancano <= soglia
    }
}

const manut_tagliando: Detector = (cfg, ctx, arg) =>
    scadenze(ctx, 'tagliando').filter(filtroScadenza(cfg, arg)).map(hitScadenza)

const manut_freni: Detector = (cfg, ctx, arg) =>
    scadenze(ctx, 'freni').filter(filtroScadenza(cfg, arg)).map(hitScadenza)

const gomme_cambio: Detector = (cfg, ctx, arg) =>
    scadenze(ctx, 'gomme').filter(filtroScadenza(cfg, arg)).map(hitScadenza)

/** Gomme gia' oltre l'intervallo e un noleggio che parte entro la soglia (giorni). */
const gomme_non_idonee_uscita: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const scadute = new Map<string, Scadenza[]>()
    for (const s of scadenze(ctx, 'gomme')) {
        if (s.mancano > 0) continue
        const id = String(s.vehicle.id)
        scadute.set(id, [...(scadute.get(id) || []), s])
    }
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b) || !b.vehicle_id) continue
        const lista = scadute.get(String(b.vehicle_id))
        if (!lista) continue
        const ritiro = ritiroAt(b)
        if (!ritiro) continue
        const diff = ritiro.getTime() - ctx.now.getTime()
        if (diff < 0 || diff > ms) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: `${etichettaNoleggio(b)} · ritiro ${giornoIt(ritiro)}`,
            dettaglio: lista.map(s => `${s.voce} oltre di ${kmIt(-s.mancano)}`).join('; '),
        })
    }
    return hits
}

// ─── Chilometraggio anomalo ──────────────────────────────────────────────────

/**
 * Il contachilometri del veicolo e' piu' basso di un km gia' registrato
 * (ultimo tagliando, cambio gomme/freni o intervento a registro): o e' stato
 * scritto male adesso, o era sbagliato il dato di prima.
 */
const km_anomalo: Detector = (_cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const v of veicoli(ctx)) {
        const attuali = numero(v.current_km)
        if (attuali <= 0) continue
        const fonti: { nome: string; km: number }[] = [
            { nome: 'ultimo tagliando', km: numero(v.last_service_km) },
            { nome: 'cambio gomme anteriori', km: numero(v.last_tire_change_front_km) },
            { nome: 'cambio gomme posteriori', km: numero(v.last_tire_change_rear_km) },
            { nome: 'cambio gomme', km: numero(v.last_tire_change_km) },
            { nome: 'cambio freni anteriori', km: numero(v.last_brake_change_front_km) },
            { nome: 'cambio freni posteriori', km: numero(v.last_brake_change_rear_km) },
            { nome: 'cambio freni', km: numero(v.last_brake_change_km) },
            { nome: 'intervento a registro', km: kmRegistro(ctx, String(v.id)) },
        ]
        const massimo = fonti.reduce((a, f) => (f.km > a.km ? f : a), { nome: '', km: 0 })
        if (massimo.km > attuali) {
            hits.push({
                vehicleId: v.id,
                entita: etichettaVeicolo(v),
                dettaglio: `Km attuali ${kmIt(attuali)}, ma il ${massimo.nome} e' registrato a ${kmIt(massimo.km)}`,
            })
        }
    }
    return hits
}

// ─── Danni & Penali: sforo km e gomme ────────────────────────────────────────

const SFORO = /sfor|eccedenza chilometric/i

function voci(b: Riga, chiave: 'penalties' | 'danni'): Riga[] {
    const v = b[chiave] ?? b.booking_details?.[chiave]
    return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []
}

function totaleVoce(p: Riga): number {
    const t = numero(p.total)
    if (t > 0) return t
    return numero(p.amount) * (numero(p.quantity) || 1)
}

function pagata(p: Riga): boolean {
    if (String(p.paymentStatus || '').toLowerCase() === 'paid') return true
    const tot = totaleVoce(p)
    return tot > 0 && numero(p.amountPaid) >= tot
}

function prenotazioneValida(b: Riga): boolean {
    return !['cancelled', 'annullata'].includes(String(b.status || '').toLowerCase())
}

/**
 * Voce "Sforo Km" di Danni & Penali.
 * arg: 'da_calcolare' — km scritti ma importo a 0 (tariffa mancante);
 *      'non_pagato'   — importo da incassare, registrato da almeno la soglia;
 *      'registrato'   — sforo registrato negli ultimi giorni della soglia.
 */
const km_sforo: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of addebiti(ctx)) {
        if (!prenotazioneValida(b)) continue
        for (const p of voci(b, 'penalties')) {
            if (!SFORO.test(String(p.label || ''))) continue
            const quando = data(p.date) || data(b.dropoff_date)
            const tot = totaleVoce(p)
            const km = numero(p.quantity)
            const base = { bookingId: b.id, vehicleId: b.vehicle_id || undefined, entita: etichettaNoleggio(b) }
            if (arg === 'da_calcolare') {
                if (tot > 0 || pagata(p)) continue
                hits.push({ ...base, dettaglio: `Sforo Km del ${giornoIt(quando)} senza importo${km > 1 ? ` (${kmIt(km)})` : ''}: manca la tariffa €/km` })
            } else if (arg === 'non_pagato') {
                if (tot <= 0 || pagata(p)) continue
                if (!quando || ctx.now.getTime() - quando.getTime() < ms) continue
                const incassato = numero(p.amountPaid)
                hits.push({ ...base, dettaglio: `Sforo Km del ${giornoIt(quando)}: da incassare ${(tot - incassato).toFixed(2)} € su ${tot.toFixed(2)} €` })
            } else if (arg === 'registrato') {
                if (!quando) continue
                const eta = ctx.now.getTime() - quando.getTime()
                if (eta < -GIORNO || eta > ms) continue
                hits.push({ ...base, dettaglio: `Sforo registrato il ${giornoIt(quando)}${km > 1 ? `: ${kmIt(km)}` : ''}, ${tot.toFixed(2)} €` })
            }
        }
    }
    return hits
}

const GOMMA = /gomm|pneumat/i
const NON_GOMMA = /gonfiator/i
const USURA = /consum|bruciat|usur/i

/**
 * Danno alle gomme registrato al rientro (Danni & Penali) negli ultimi giorni
 * della soglia. arg: 'usura' — consumo/gomme bruciate; 'danno' — tutto il resto
 * (foro, da sostituire...). Oltre la soglia il fatto e' vecchio e non suona.
 */
const gomme_danno: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const hits: AlarmHit[] = []
    for (const b of addebiti(ctx)) {
        if (!prenotazioneValida(b)) continue
        for (const d of [...voci(b, 'danni'), ...voci(b, 'penalties')]) {
            const label = String(d.label || '')
            if (!GOMMA.test(label) || NON_GOMMA.test(label)) continue
            const usura = USURA.test(label)
            if (arg === 'usura' ? !usura : usura) continue
            const quando = data(d.date) || data(b.dropoff_date)
            if (!quando) continue
            const eta = ctx.now.getTime() - quando.getTime()
            if (eta < -GIORNO || eta > ms) continue
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id || undefined,
                entita: etichettaNoleggio(b),
                dettaglio: `"${label}" registrato il ${giornoIt(quando)}`,
            })
        }
    }
    return hits
}

// ─── Lettura dati ────────────────────────────────────────────────────────────

async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - GIORNI_ADDEBITI * GIORNO).toISOString()
    const [veicoliRes, logRes, addebitiRes] = await Promise.all([
        supabase
            .from('vehicles')
            .select('id, display_name, plate, status, current_km, last_service_km, maintenance_service_interval_km, '
                + 'last_tire_change_km, last_tire_change_front_km, last_tire_change_rear_km, '
                + 'maintenance_tires_interval_km, maintenance_tires_front_interval_km, maintenance_tires_rear_interval_km, '
                + 'last_brake_change_km, last_brake_change_front_km, last_brake_change_rear_km, '
                + 'maintenance_brake_interval_km, maintenance_brake_front_interval_km, maintenance_brake_rear_interval_km')
            .neq('status', 'retired')
            .range(0, 999),
        supabase
            .from('vehicle_maintenance_log')
            .select('vehicle_id, tipo, km, intervento_date')
            .order('intervento_date', { ascending: false })
            .range(0, 1999),
        supabase
            .from('bookings')
            .select('id, vehicle_id, vehicle_name, vehicle_plate, customer_name, status, dropoff_date, penalties:booking_details->penalties, danni:booking_details->danni')
            .gte('dropoff_date', da)
            .or('service_type.is.null,service_type.neq.car_wash')
            .order('dropoff_date', { ascending: false })
            .range(0, 1999),
    ])
    const out: Record<string, unknown[]> = {}
    // Se una lettura fallisce (RLS, rete) il suo gruppo tace invece di
    // allarmare su dati a meta'.
    if (!veicoliRes.error && veicoliRes.data) out.manutenzione_veicoli = veicoliRes.data
    if (!logRes.error && logRes.data) out.manutenzione_log = logRes.data
    if (!addebitiRes.error && addebitiRes.data) {
        out.manutenzione_addebiti = (addebitiRes.data as Riga[]).filter(b => voci(b, 'penalties').length || voci(b, 'danni').length)
    }
    return out
}

export const moduloManutenzione: ModuloAllarmi = {
    nome: 'manutenzione',
    detectors: {
        manut_tagliando,
        manut_freni,
        gomme_cambio,
        gomme_non_idonee_uscita,
        gomme_danno,
        km_anomalo,
        km_sforo,
    },
    carica,
}
