/**
 * Allarmi dei gruppi "danni" e "sinistri" (01/10/2026).
 *
 * Fonte dei danni: `bookings.booking_details.danni[]`, scritta da
 * DanniPenaliModal e letta da GestioneDanniTab. Ogni voce ha:
 *   label, amount, quantity, total (LISTINO), discount (listino - prezzo
 *   finale), amountPaid, paymentStatus ('pending'|'partial'|'paid'|
 *   'nexi_pay_by_link'), paymentMethod, date ('YYYY-MM-DD', giorno di Roma
 *   in cui e' stato registrato), photos (URL), note.
 *
 * Misurato in produzione il 01/10/2026: 43 danni, tutti pagati, nessuno con
 * foto. Non esiste una tabella dei sinistri, ne' uno stato "riparato", ne' la
 * gravita' del danno, ne' un controllo carrozzeria/cerchi/vetri al rientro:
 * le voci del catalogo che ne avrebbero bisogno restano in attesa.
 *
 * Il motore tiene UNA occorrenza per allarme e prenotazione: piu' danni sulla
 * stessa prenotazione diventano un'occorrenza sola, con l'elenco nel dettaglio.
 */
import { supabase } from '../../supabaseClient'
import { getRomeDateComponents } from '../timezoneUtils'
import { sogliaMs, type AlarmHit, type Detector, type DetectorContext, type ModuloAllarmi } from '../alarmDetectors'

const GIORNO = 24 * 60 * 60_000

/** Quanti giorni indietro si leggono le prenotazioni con danni. */
export const GIORNI_LETTURA_DANNI = 120
/**
 * Foto e importo mancanti sono dati da completare a ridosso del rientro: dopo
 * una settimana non sono piu' un allarme ma una pulizia (vedi c6ce1efa).
 * I soldi non incassati invece restano allarmi per tutta la finestra letta.
 */
const GIORNI_RILEVANZA_DATI = 7

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrenotazioneConDanni = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Danno = Record<string, any>

const CHIAVE = 'danniSinistri_prenotazioni'

function prenotazioni(ctx: DetectorContext): PrenotazioneConDanni[] {
    return (ctx.extra?.[CHIAVE] || []) as PrenotazioneConDanni[]
}

/** Giorno di Roma di `d` come numero di giorni dall'epoca. */
function giornoRoma(d: Date): number {
    const c = getRomeDateComponents(d.toISOString())
    return Math.floor(Date.UTC(c.year, c.month - 1, c.day) / GIORNO)
}

/** Giorni passati dalla registrazione del danno (0 = oggi). null se senza data. */
function etaGiorni(danno: Danno, b: PrenotazioneConDanni, now: Date): number | null {
    const raw = String(danno.date || b.dropoff_date || b.pickup_date || '').slice(0, 10)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    if (!m) return null
    const giorno = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / GIORNO)
    return giornoRoma(now) - giorno
}

/** Soglia in giorni interi (minimo 0): il danno ha solo la data, non l'ora. */
function sogliaGiorni(cfg: Parameters<Detector>[0]): number {
    return Math.max(0, Math.ceil(sogliaMs(cfg) / GIORNO))
}

function lordo(d: Danno): number {
    return Number(d.total || (Number(d.amount) || 0) * (Number(d.quantity) || 1)) || 0
}

/** Prezzo finale: listino meno sconto, come in GestioneDanniTab. */
function finale(d: Danno): number {
    return Math.max(0, Math.round((lordo(d) - (Number(d.discount) || 0)) * 100) / 100)
}

function pagato(d: Danno): number {
    return Number(d.amountPaid) || 0
}

/**
 * Chiuso come lo legge GestioneDanniTab: 'paid' vale saldato anche se
 * amountPaid e' piu' basso (in produzione c'e' un caso cosi', segnato pagato
 * a mano), altrimenti decide l'importo incassato.
 */
function saldato(d: Danno): boolean {
    if (String(d.paymentStatus || '') === 'paid') return true
    return pagato(d) >= finale(d) - 0.01
}

function euro(n: number): string {
    return `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function etichettaPrenotazione(b: PrenotazioneConDanni): string {
    const mezzo = b.vehicle_name || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    return `${mezzo}${targa} · ${b.customer_name || 'Cliente'}`
}

function nomeDanno(d: Danno): string {
    return String(d.label || d.description || 'Danno').trim() || 'Danno'
}

/**
 * Costruisce le occorrenze: una per prenotazione, con i danni che passano il
 * filtro elencati nel dettaglio.
 */
function perPrenotazione(
    ctx: DetectorContext,
    filtro: (d: Danno, eta: number) => boolean,
    descrivi: (d: Danno) => string,
): AlarmHit[] {
    const hits: AlarmHit[] = []
    for (const b of prenotazioni(ctx)) {
        const danni: Danno[] = Array.isArray(b.danni) ? b.danni : []
        const scelti = danni.filter(d => {
            if (!d || typeof d !== 'object') return false
            const eta = etaGiorni(d, b, ctx.now)
            return eta !== null && eta >= 0 && filtro(d, eta)
        })
        if (!scelti.length) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id || undefined,
            entita: etichettaPrenotazione(b),
            dettaglio: scelti.map(descrivi).join(' · '),
        })
    }
    return hits
}

/** Danno registrato negli ultimi X giorni (soglia 1 giorno = oggi e ieri). */
const danni_nuovo: Detector = (cfg, ctx) => {
    const g = sogliaGiorni(cfg)
    return perPrenotazione(ctx,
        (_d, eta) => eta <= g,
        d => `${nomeDanno(d)} · ${euro(finale(d))} · registrato il ${String(d.date || '').slice(0, 10)}`)
}

/** Danno registrato da almeno X giorni senza nessuna foto. */
const danni_senza_foto: Detector = (cfg, ctx) => {
    const g = sogliaGiorni(cfg)
    return perPrenotazione(ctx,
        (d, eta) => eta >= g && eta <= GIORNI_RILEVANZA_DATI && !(Array.isArray(d.photos) && d.photos.length > 0),
        d => `${nomeDanno(d)}: nessuna foto`)
}

/** Danno registrato da almeno X giorni con importo zero. */
const danni_senza_importo: Detector = (cfg, ctx) => {
    const g = sogliaGiorni(cfg)
    return perPrenotazione(ctx,
        (d, eta) => eta >= g && eta <= GIORNI_RILEVANZA_DATI && lordo(d) <= 0,
        d => `${nomeDanno(d)}: importo non inserito`)
}

/** Danno valorizzato, da almeno X giorni, e nulla ancora incassato. */
const danni_non_addebitato: Detector = (cfg, ctx) => {
    const g = sogliaGiorni(cfg)
    return perPrenotazione(ctx,
        (d, eta) => eta >= g && finale(d) > 0 && pagato(d) <= 0 && !saldato(d),
        d => `${nomeDanno(d)}: ${euro(finale(d))} non incassati`)
}

/** Danno pagato in parte da almeno X giorni: resta un saldo da incassare. */
const danni_saldo_aperto: Detector = (cfg, ctx) => {
    const g = sogliaGiorni(cfg)
    return perPrenotazione(ctx,
        (d, eta) => eta >= g && finale(d) > 0 && pagato(d) > 0 && !saldato(d),
        d => `${nomeDanno(d)}: incassati ${euro(pagato(d))} su ${euro(finale(d))}, mancano ${euro(finale(d) - pagato(d))}`)
}

export const DETECTORS_DANNI_SINISTRI: Record<string, Detector> = {
    danni_nuovo,
    danni_senza_foto,
    danni_senza_importo,
    danni_non_addebitato,
    danni_saldo_aperto,
}

/**
 * Prenotazioni degli ultimi GIORNI_LETTURA_DANNI giorni che hanno almeno un
 * danno. Si legge solo la lista dei danni, non tutto booking_details.
 */
async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - GIORNI_LETTURA_DANNI * GIORNO).toISOString()
    const righe: PrenotazioneConDanni[] = []
    for (let pagina = 0; pagina < 5; pagina++) {
        const { data, error } = await supabase
            .from('bookings')
            .select('id, vehicle_id, vehicle_name, vehicle_plate, customer_name, pickup_date, dropoff_date, status, danni:booking_details->danni')
            .not('booking_details->danni', 'is', null)
            .gte('pickup_date', da)
            .order('pickup_date', { ascending: false })
            .range(pagina * 1000, pagina * 1000 + 999)
        if (error) throw error
        const got = (data || []) as PrenotazioneConDanni[]
        righe.push(...got)
        if (got.length < 1000) break
    }
    return { [CHIAVE]: righe.filter(r => Array.isArray(r.danni) && r.danni.length > 0) }
}

export const moduloDanniSinistri: ModuloAllarmi = {
    nome: 'danniSinistri',
    detectors: DETECTORS_DANNI_SINISTRI,
    carica,
}
