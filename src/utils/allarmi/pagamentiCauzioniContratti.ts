/**
 * Allarmi dei gruppi Pagamenti, Cauzione e Contratto (01/10/2026).
 *
 * Le voci di questi tre gruppi che erano "in attesa" nel catalogo. Ogni
 * rilevazione e' stata scritta solo dove il dato esiste davvero in produzione
 * (misurato il 01/10/2026 sul database): le altre restano in attesa e sono
 * elencate nella migration 20261001_allarmi_pagamenti_cauzione_contratto.sql
 * con il dato che manca.
 *
 * Fonti:
 *   - bookings (gia' nel contesto del motore): penali/danni con il loro
 *     paymentStatus, extension_history, amount_paid, richiesta "No Cauzione",
 *     garanti, flag di rifirma del contratto;
 *   - cauzioni: stato, metodo, incasso, sblocco;
 *   - nexi_transactions: le pre-autorizzazioni (metadata.type = 'preauth',
 *     legate alla cauzione da metadata.cauzione_id o da cauzioni.nexi_order_id);
 *   - signature_requests + signature_audit_trail: link aperto o no, OTP
 *     verificato, firma completata;
 *   - contracts: i dati del cliente cosi' come sono stati STAMPATI nel PDF.
 *
 * Importi: price_total e amount_paid sono in CENTESIMI; penali, danni,
 * estensioni e cauzioni sono in EURO.
 */
import { supabase } from '../../supabaseClient'
import {
    isNoleggio,
    isPagato,
    isViva,
    ritiroAt,
    riconsegnaAt,
    sogliaMs,
    importoCauzioneRichiesto,
    type AlarmCfgLite,
    type AlarmHit,
    type BookingLite,
    type Detector,
    type DetectorContext,
    type ModuloAllarmi,
} from '../alarmDetectors'
import { getRomeDateComponents } from '../timezoneUtils'

const NOME = 'pagamentiCauzioniContratti'

/** Chiavi in ctx.extra. Una chiave manca se la sua lettura e' fallita. */
export const K = {
    cauzioni: `${NOME}.cauzioni`,
    preauth: `${NOME}.preauth`,
    prenotazioni: `${NOME}.prenotazioni`,
    firme: `${NOME}.firme`,
    eventiFirma: `${NOME}.eventiFirma`,
    contratti: `${NOME}.contratti`,
} as const

// ─── Aiutanti ────────────────────────────────────────────────────────────────

const MIN = 60_000
const GIORNO = 24 * 60 * MIN
/** Fatti di orario: oltre una settimana non sono piu' allarmi (vedi alarmDetectors). */
const GIORNI_RILEVANZA = 7
/** Soldi ancora da incassare o da sistemare: restano vivi piu' a lungo, non per sempre. */
const GIORNI_SOLDI = 30

type Riga = Record<string, unknown>

function tempo(v: unknown): Date | null {
    if (!v) return null
    const d = new Date(String(v))
    return Number.isFinite(d.getTime()) ? d : null
}

function num(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

function oraIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)} ${p(c.hour)}:${p(c.minute)}`
}

function eur(n: number): string {
    return `${n.toFixed(2).replace('.', ',')} €`
}

function etichetta(b: BookingLite, quando?: Date | null): string {
    const mezzo = b.vehicle_name || b.itemName || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    const cliente = b.customer_name || b.booking_details?.customer?.full || 'Cliente'
    return `${mezzo}${targa} · ${cliente}${quando ? ` · ${oraIt(quando)}` : ''}`
}

function dettagli(b: BookingLite): Riga {
    const d = b.booking_details
    return d && typeof d === 'object' && !Array.isArray(d) ? d as Riga : {}
}

function extra<T = Riga>(ctx: DetectorContext, chiave: string): T[] | null {
    const v = ctx.extra?.[chiave]
    return Array.isArray(v) ? v as T[] : null
}

/**
 * Allarmi "prima del ritiro": dentro la finestra da X minuti (o giorni) prima
 * fino al ritiro. Con `minutes_after` diventa "ritiro passato da almeno X" e
 * smette dopo una settimana, come gli altri fatti di orario.
 */
function finestraRitiro(cfg: AlarmCfgLite, b: BookingLite, now: Date): boolean {
    const r = ritiroAt(b)
    if (!r) return false
    const ms = sogliaMs(cfg)
    const diff = r.getTime() - now.getTime()
    if (cfg.threshold_unit === 'minutes_after') return -diff >= ms && -diff <= GIORNI_RILEVANZA * GIORNO
    return diff >= 0 && diff <= ms
}

/**
 * Allarmi di soldi legati alla riconsegna: suonano da X prima del rientro in
 * poi (al rientro si incassa) e restano vivi finche' il problema c'e', fino a
 * GIORNI_SOLDI dalla riconsegna. Con `minutes_after` partono X dopo.
 */
function daRiconsegna(cfg: AlarmCfgLite, evento: Date | null, now: Date): boolean {
    if (!evento) return false
    const ms = sogliaMs(cfg)
    const diff = evento.getTime() - now.getTime()
    if (-diff > GIORNI_SOLDI * GIORNO) return false
    if (cfg.threshold_unit === 'minutes_after') return -diff >= ms
    return diff <= ms
}

/** Gia' versato su una prenotazione, in centesimi. Le due fonti a volte divergono: vince la piu' alta. */
export function pagatoCent(b: BookingLite): number {
    return Math.max(num(b.amount_paid), num(dettagli(b).amountPaid))
}

/** Residuo della prenotazione in centesimi (mai negativo). */
export function residuoCent(b: BookingLite): number {
    return Math.max(0, num(b.price_total) - pagatoCent(b))
}

// ─── Penali, danni, estensioni ───────────────────────────────────────────────

export interface AddebitoAperto {
    tipo: 'penale' | 'danno'
    label: string
    residuo: number // euro
    km: boolean
}

const RE_KM = /sforo|chilometr|kilometr|\bkm\b/i
const NON_PAGATO = new Set(['', 'pending', 'partial', 'nexi_pay_by_link'])

/**
 * Penali e danni non saldati. Stessa regola di "Da Saldare"
 * (UnpaidBookingsTab): totale reale (total, o amount x quantity) meno sconto
 * meno gia' pagato. NON `amount`, che e' il prezzo unitario.
 */
export function addebitiAperti(b: BookingLite): AddebitoAperto[] {
    const d = dettagli(b)
    const out: AddebitoAperto[] = []
    for (const [chiave, tipo] of [['penalties', 'penale'], ['danni', 'danno']] as const) {
        const arr = d[chiave]
        if (!Array.isArray(arr)) continue
        for (const it of arr as Riga[]) {
            if (!it || typeof it !== 'object') continue
            if (!NON_PAGATO.has(String(it.paymentStatus ?? ''))) continue
            const totale = num(it.total) || num(it.amount) * (num(it.quantity) || 1)
            const residuo = totale - num(it.discount) - num(it.amountPaid)
            if (residuo <= 0.005) continue
            const label = String(it.label || (tipo === 'danno' ? 'Danno' : 'Penale'))
            out.push({ tipo, label, residuo, km: tipo === 'penale' && RE_KM.test(label) })
        }
    }
    return out
}

/** Estensioni registrate e non pagate (importo in euro). */
export function estensioniAperte(b: BookingLite): { fino: Date | null; residuo: number }[] {
    const arr = dettagli(b).extension_history
    if (!Array.isArray(arr)) return []
    const out: { fino: Date | null; residuo: number }[] = []
    for (const e of arr as Riga[]) {
        if (!e || typeof e !== 'object') continue
        if (!NON_PAGATO.has(String(e.payment_status ?? ''))) continue
        const residuo = num(e.additional_amount) - num(e.amount_paid)
        if (residuo <= 0.005) continue
        out.push({ fino: tempo(e.new_dropoff), residuo })
    }
    return out
}

// ─── Rilevazioni: pagamenti ──────────────────────────────────────────────────

/**
 * Penali o danni registrati e non incassati.
 * arg: 'km' -> solo sforo chilometri; 'danni' -> danni e tutte le altre penali.
 */
const pag_x_addebito_aperto: Detector = (cfg, ctx, arg) => {
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b)) continue
        const fine = riconsegnaAt(b)
        if (!daRiconsegna(cfg, fine, ctx.now)) continue
        const voci = addebitiAperti(b).filter(a => (arg === 'km' ? a.km : !a.km))
        if (voci.length === 0) continue
        const totale = voci.reduce((s, v) => s + v.residuo, 0)
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, fine),
            dettaglio: `Da incassare ${eur(totale)}: ${voci.map(v => `${v.label} ${eur(v.residuo)}`).join(', ')}`,
        })
    }
    return hits
}

/**
 * Estensione registrata e non pagata. Conta solo se anche la prenotazione ha
 * un residuo: in produzione ci sono estensioni rimaste "pending" con il totale
 * gia' saldato da un'integrazione (es. topup Nexi completato), e quelle non
 * sono soldi da chiedere.
 */
const pag_x_estensione_non_pagata: Detector = (cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b)) continue
        const fine = riconsegnaAt(b)
        if (!daRiconsegna(cfg, fine, ctx.now)) continue
        const aperte = estensioniAperte(b)
        if (aperte.length === 0 || residuoCent(b) < 100) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, fine),
            dettaglio: aperte.map(e => `Estensione al ${oraIt(e.fino)}: ${eur(e.residuo)} da incassare`).join(' · '),
        })
    }
    return hits
}

/**
 * Acconto versato, saldo ancora aperto. Vale anche su noleggi gia' chiusi o
 * segnati "pagato" con un importo pagato inferiore al totale (il totale si
 * puo' alzare senza toccare l'importo pagato). Suona da X prima del rientro.
 */
const pag_x_saldo_residuo: Detector = (cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b)) continue
        const pagato = pagatoCent(b)
        const residuo = residuoCent(b)
        if (pagato <= 0 || residuo < 100) continue
        const fine = riconsegnaAt(b)
        if (!daRiconsegna(cfg, fine, ctx.now)) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, fine),
            dettaglio: `Pagati ${eur(pagato / 100)} di ${eur(num(b.price_total) / 100)}: residuo ${eur(residuo / 100)}`,
        })
    }
    return hits
}

/** Il pagamento va chiuso entro il ritiro: avviso con l'anticipo del catalogo (es. 7 giorni). */
const pag_x_scadenza: Detector = (cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b) || isPagato(b)) continue
        if (num(b.price_total) <= 0 || residuoCent(b) < 100) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        const ritiro = ritiroAt(b)
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiro),
            dettaglio: `Da incassare ${eur(residuoCent(b) / 100)} entro il ritiro del ${oraIt(ritiro)}`,
        })
    }
    return hits
}

// ─── Cauzioni e pre-autorizzazioni ───────────────────────────────────────────

const CAUZIONE_CHIUSA = new Set(['Restituita', 'Sbloccata', 'Danno'])
const CAUZIONE_APERTA = new Set(['Attiva', 'In scadenza'])

function cauzioniDi(ctx: DetectorContext): Riga[] {
    return extra(ctx, K.cauzioni) || (ctx.cauzioni as Riga[])
}

function cauzioniPerPrenotazione(ctx: DetectorContext): Map<string, Riga[]> {
    const m = new Map<string, Riga[]>()
    for (const c of cauzioniDi(ctx)) {
        const k = String(c.riferimento_contratto_id || '')
        if (!k) continue
        const arr = m.get(k) || []
        arr.push(c)
        m.set(k, arr)
    }
    return m
}

/** Prenotazione per id: prima il contesto del motore, poi quelle lette dal modulo. */
function prenotazioniPerId(ctx: DetectorContext): Map<string, BookingLite> {
    const m = new Map<string, BookingLite>()
    for (const b of extra<BookingLite>(ctx, K.prenotazioni) || []) m.set(String(b.id), b)
    for (const b of ctx.bookings) m.set(String(b.id), b)
    return m
}

/** Pre-autorizzazioni della cauzione, la piu' recente per prima. */
function preauthDi(ctx: DetectorContext, c: Riga): Riga[] {
    const tx = extra(ctx, K.preauth) || []
    const id = String(c.id || '')
    const ordine = String(c.nexi_order_id || '')
    return tx
        .filter(t => (id && String(t.cauzione_id || '') === id) || (ordine && String(t.order_id || '') === ordine))
        .sort((a, b) => (tempo(b.created_at)?.getTime() || 0) - (tempo(a.created_at)?.getTime() || 0))
}

/** La cauzione ha gia' i soldi: incassata, oppure pre-autorizzazione andata a buon fine. */
function cauzioneCoperta(c: Riga): boolean {
    if (c.data_incasso) return true
    return String(c.metodo || '') === 'preautorizzazione' && CAUZIONE_APERTA.has(String(c.stato || ''))
}

function etichettaCauzione(c: Riga, b?: BookingLite): string {
    const base = `Cauzione ${eur(num(c.importo))}`
    return b ? `${base} · ${etichetta(b)}` : `${base} · ${String(c.stato || '—')}`
}

/** Cauzione registrata per un importo inferiore a quello previsto dal noleggio. */
const cauz_inferiore_richiesta: Detector = (cfg, ctx) => {
    const perPren = cauzioniPerPrenotazione(ctx)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        const richiesto = importoCauzioneRichiesto(b)
        if (richiesto <= 0) continue
        const registrato = (perPren.get(String(b.id)) || [])
            .filter(c => !CAUZIONE_CHIUSA.has(String(c.stato || '')))
            .reduce((s, c) => s + num(c.importo), 0)
        // Nessuna cauzione: e' "cauzione mancante", un altro allarme.
        if (registrato <= 0 || registrato + 0.005 >= richiesto) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Cauzione registrata ${eur(registrato)} su ${eur(richiesto)} richiesti`,
        })
    }
    return hits
}

/** Richiesta "No Cauzione" (Fascia B) ancora senza risposta in Preventivi. */
const cauz_formula_senza_non_autorizzata: Detector = (cfg, ctx) => {
    return ctx.bookings
        .filter(b => {
            if (!isNoleggio(b) || !isViva(b)) return false
            const d = dettagli(b)
            if (d.no_cauzione_request !== true) return false
            if (String(d.no_cauzione_status || 'pending') !== 'pending') return false
            return finestraRitiro(cfg, b, ctx.now)
        })
        .map(b => ({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: 'Richiesta "No Cauzione" in attesa di approvazione (Preventivi)',
        }))
}

/**
 * Garanzia al posto (o accanto) della cauzione — garante o veicolo a
 * garanzia — dichiarata ma senza i dati che la rendono verificabile.
 */
const cauz_garanzia_alternativa: Detector = (cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        const d = dettagli(b)
        const problemi: string[] = []
        const quanti = Math.max(0, Math.floor(num(d.garante_count)))
        const garanti = Array.isArray(d.guarantors) ? d.guarantors as Riga[] : []
        for (let i = 1; i <= quanti; i++) {
            const g = garanti.find(x => num(x?.index) === i) || garanti[i - 1] || {}
            const manca: string[] = []
            if (!String(g[`garante_${i}_nome_cognome`] || '').trim()) manca.push('nome')
            if (!String(g[`garante_${i}_codice_fiscale`] || '').trim()) manca.push('codice fiscale')
            if (!String(g[`garante_${i}_telefono`] || '').trim()) manca.push('telefono')
            if (manca.length > 0) problemi.push(`Garante ${i} senza ${manca.join(', ')}`)
        }
        if (d.cauzione_auto === true) {
            const cv = (d.cauzione_veicolo && typeof d.cauzione_veicolo === 'object') ? d.cauzione_veicolo as Riga : {}
            if (!String(d.cauzione_targa || cv.targa || '').trim()) problemi.push('Veicolo a garanzia senza targa')
        }
        if (problemi.length === 0) continue
        hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: problemi.join(' · ') })
    }
    return hits
}

/**
 * Esito della pre-autorizzazione della cauzione prima del ritiro.
 * arg: 'fallita' | 'rifiutata' | 'non_effettuata'
 *   - rifiutata: Nexi ha rifiutato la carta (DECLINED / "RIFIUTATA da Nexi");
 *   - fallita: ogni altro esito negativo (es. THREEDS_FAILED);
 *   - non_effettuata: link di pre-autorizzazione inviato, cliente mai arrivato
 *     in fondo (pending_preauth / scaduto).
 * Vale l'ULTIMO tentativo: un rifiuto seguito da una pre-autorizzazione
 * riuscita non e' piu' un problema.
 */
const cauz_preauth: Detector = (cfg, ctx, arg) => {
    if (!extra(ctx, K.preauth)) return []
    const perPren = cauzioniPerPrenotazione(ctx)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        for (const c of perPren.get(String(b.id)) || []) {
            if (!CAUZIONE_APERTA.has(String(c.stato || '')) || cauzioneCoperta(c)) continue
            const ultima = preauthDi(ctx, c)[0]
            if (!ultima) continue
            const stato = String(ultima.status || '')
            const rifiuto = /DECLINED/i.test(String(ultima.esito || '')) || /rifiut/i.test(String(ultima.motivo || ''))
            let ok = false
            let testo = ''
            if (arg === 'non_effettuata') {
                ok = ['pending_preauth', 'preauth_pending_link', 'expired'].includes(stato)
                testo = `Link di pre-autorizzazione inviato il ${oraIt(tempo(ultima.created_at))}, non completato dal cliente`
            } else if (arg === 'rifiutata') {
                ok = stato === 'failed' && rifiuto
                testo = 'Pre-autorizzazione rifiutata da Nexi'
            } else if (arg === 'fallita') {
                ok = stato === 'failed' && !rifiuto
                testo = `Pre-autorizzazione fallita${ultima.esito ? ` (${String(ultima.esito)})` : ''}`
            }
            if (!ok) continue
            hits.push({
                bookingId: b.id,
                vehicleId: b.vehicle_id,
                entita: etichetta(b, ritiroAt(b)),
                dettaglio: `${testo} · cauzione ${eur(num(c.importo))}`,
            })
            break
        }
    }
    return hits
}

/**
 * Storno della pre-autorizzazione da verificare: gestionale e Nexi non
 * dicono la stessa cosa da piu' della soglia (giorni).
 *   - cauzione sbloccata/restituita in gestionale, ma su Nexi i fondi
 *     risultano ancora bloccati (preauth_held);
 *   - pre-autorizzazione stornata su Nexi (preauth_voided), ma la cauzione e'
 *     ancora aperta in gestionale.
 */
const cauz_storno_da_verificare: Detector = (cfg, ctx) => {
    if (!extra(ctx, K.preauth)) return []
    const ms = sogliaMs(cfg)
    const pren = prenotazioniPerId(ctx)
    const hits: AlarmHit[] = []
    for (const c of cauzioniDi(ctx)) {
        const tx = preauthDi(ctx, c)
        if (tx.length === 0) continue
        const stato = String(c.stato || '')
        const b = pren.get(String(c.riferimento_contratto_id || ''))
        let dettaglio = ''
        if (stato === 'Sbloccata' || stato === 'Restituita') {
            const chiusa = tempo(c.data_sblocco) || tempo(c.data_restituzione)
            if (!chiusa) continue
            const eta = ctx.now.getTime() - chiusa.getTime()
            if (eta < ms || eta > GIORNI_SOLDI * GIORNO) continue
            if (!tx.some(t => String(t.status || '') === 'preauth_held')) continue
            dettaglio = `${stato} il ${oraIt(chiusa)}, ma su Nexi i fondi risultano ancora bloccati`
        } else if (CAUZIONE_APERTA.has(stato)) {
            const stornata = tx.find(t => String(t.status || '') === 'preauth_voided')
            if (!stornata) continue
            const quando = tempo(stornata.updated_at) || tempo(stornata.created_at)
            if (!quando) continue
            const eta = ctx.now.getTime() - quando.getTime()
            if (eta < ms || eta > GIORNI_SOLDI * GIORNO) continue
            dettaglio = `Pre-autorizzazione stornata su Nexi (${String(stornata.order_id || '')}), cauzione ancora ${stato}`
        } else {
            continue
        }
        hits.push({
            bookingId: c.riferimento_contratto_id ? String(c.riferimento_contratto_id) : undefined,
            vehicleId: c.veicolo_id ? String(c.veicolo_id) : undefined,
            entita: etichettaCauzione(c, b),
            dettaglio,
        })
    }
    return hits
}

/**
 * Noleggio rientrato da piu' della soglia e cauzione ancora "da incassare":
 * mai incassata, mai pre-autorizzata, mai chiusa. Una pre-autorizzazione
 * attiva o una cauzione incassata in attesa di restituzione NON sono pratiche
 * aperte: e' il loro corso normale (15 giorni lavorativi).
 */
const cauz_aperta_dopo_chiusura: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const pren = prenotazioniPerId(ctx)
    const hits: AlarmHit[] = []
    for (const c of cauzioniDi(ctx)) {
        if (!CAUZIONE_APERTA.has(String(c.stato || '')) || cauzioneCoperta(c)) continue
        const b = pren.get(String(c.riferimento_contratto_id || ''))
        if (!b || !isNoleggio(b)) continue
        const fine = riconsegnaAt(b)
        if (!fine) continue
        const eta = ctx.now.getTime() - fine.getTime()
        if (eta < ms || eta > GIORNI_SOLDI * GIORNO) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id || (c.veicolo_id ? String(c.veicolo_id) : undefined),
            entita: etichettaCauzione(c, b),
            dettaglio: `Noleggio rientrato il ${oraIt(fine)}, cauzione mai incassata ne' chiusa`,
        })
    }
    return hits
}

/**
 * Cauzione in restituzione (incassata o pre-autorizzata) mentre il cliente
 * deve ancora soldi sulla stessa prenotazione: penali, danni, estensioni o
 * saldo. Suona da X giorni prima della scadenza di restituzione in poi.
 */
const cauz_da_trattenere: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const pren = prenotazioniPerId(ctx)
    const hits: AlarmHit[] = []
    for (const c of cauzioniDi(ctx)) {
        if (!CAUZIONE_APERTA.has(String(c.stato || '')) || !cauzioneCoperta(c)) continue
        const sr = String(c.stato_restituzione || 'DA_RESTITUIRE')
        if (sr !== 'DA_RESTITUIRE') continue
        const scad = tempo(c.scadenza_cauzione)
        if (!scad) continue
        const diff = scad.getTime() - ctx.now.getTime()
        if (diff > ms || -diff > GIORNI_SOLDI * GIORNO) continue
        const b = pren.get(String(c.riferimento_contratto_id || ''))
        if (!b) continue
        const motivi: string[] = []
        for (const a of addebitiAperti(b)) motivi.push(`${a.label} ${eur(a.residuo)}`)
        for (const e of estensioniAperte(b)) motivi.push(`Estensione ${eur(e.residuo)}`)
        if (motivi.length === 0 && residuoCent(b) >= 100) motivi.push(`Saldo noleggio ${eur(residuoCent(b) / 100)}`)
        if (motivi.length === 0) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id || (c.veicolo_id ? String(c.veicolo_id) : undefined),
            entita: etichettaCauzione(c, b),
            dettaglio: `Restituzione entro ${oraIt(scad)} ma il cliente deve ancora: ${motivi.join(', ')}`,
        })
    }
    return hits
}

// ─── Contratto ───────────────────────────────────────────────────────────────

/** Ultima richiesta di firma per prenotazione (dalla lettura del modulo). */
function ultimeFirme(ctx: DetectorContext): Map<string, Riga> | null {
    const righe = extra(ctx, K.firme)
    if (!righe) return null
    const m = new Map<string, Riga>()
    for (const r of righe) {
        const k = String(r.booking_id || '')
        if (!k) continue
        const prima = m.get(k)
        if (!prima || (tempo(r.created_at)?.getTime() || 0) >= (tempo(prima.created_at)?.getTime() || 0)) m.set(k, r)
    }
    return m
}

function eventiPerRichiesta(ctx: DetectorContext): Map<string, Set<string>> | null {
    const righe = extra(ctx, K.eventiFirma)
    if (!righe) return null
    const m = new Map<string, Set<string>>()
    for (const e of righe) {
        const k = String(e.signature_request_id || '')
        const s = m.get(k) || new Set<string>()
        s.add(String(e.event_type || ''))
        m.set(k, s)
    }
    return m
}

const FIRMA_FINITA = new Set(['signed', 'cancelled', 'superseded', 'expired'])

/** Link di firma inviato, mai aperto dal cliente. */
const contr_inviato_non_aperto: Detector = (cfg, ctx) => {
    const firme = ultimeFirme(ctx)
    const eventi = eventiPerRichiesta(ctx)
    // Senza gli eventi non si puo' sapere se e' stato aperto: meglio tacere.
    if (!firme || !eventi) return []
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        const f = firme.get(String(b.id))
        if (!f || String(f.status || '') !== 'pending' || f.signed_at || f.revoked_at) continue
        if (f.first_opened_at || f.otp_verified_at) continue
        const ev = eventi.get(String(f.id)) || new Set<string>()
        if (['document_viewed', 'otp_sent', 'otp_verified', 'signature_started'].some(t => ev.has(t))) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Link di firma inviato il ${oraIt(tempo(f.created_at))}, mai aperto dal cliente`,
        })
    }
    return hits
}

/** Il cliente ha aperto e verificato l'OTP, ma la firma non e' stata completata. */
const contr_firma_incompleta: Detector = (cfg, ctx) => {
    const firme = ultimeFirme(ctx)
    if (!firme) return []
    const eventi = eventiPerRichiesta(ctx)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        const f = firme.get(String(b.id))
        if (!f || f.signed_at || f.revoked_at || FIRMA_FINITA.has(String(f.status || ''))) continue
        const ev = eventi?.get(String(f.id))
        const iniziata = String(f.status || '') === 'otp_verified' || !!f.otp_verified_at
            || !!ev?.has('otp_verified') || !!ev?.has('signature_started')
        if (!iniziata) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: 'Identita\' verificata con OTP, firma non completata',
        })
    }
    return hits
}

/** Il contratto generato (tabella contracts) e' stato stampato senza dati del cliente. */
const contr_dati_mancanti: Detector = (cfg, ctx) => {
    const righe = extra(ctx, K.contratti)
    if (!righe) return []
    const ultimo = new Map<string, Riga>()
    for (const r of righe) {
        const k = String(r.booking_id || '')
        if (!k) continue
        const prima = ultimo.get(k)
        if (!prima || (tempo(r.updated_at)?.getTime() || 0) >= (tempo(prima.updated_at)?.getTime() || 0)) ultimo.set(k, r)
    }
    const campi: [string, string][] = [
        ['customer_name', 'nome cliente'],
        ['customer_tax_code', 'codice fiscale / P.IVA'],
        ['customer_address', 'indirizzo'],
        ['customer_license_number', 'numero patente'],
    ]
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        if (!finestraRitiro(cfg, b, ctx.now)) continue
        const c = ultimo.get(String(b.id))
        if (!c) continue
        const mancano = campi.filter(([k]) => !String(c[k] ?? '').trim()).map(([, t]) => t)
        if (mancano.length === 0) continue
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Contratto senza: ${mancano.join(', ')}`,
        })
    }
    return hits
}

/** Tolleranza tra l'orologio del browser (flag) e quello del database (richiesta). */
const TOLLERANZA_OROLOGIO = 2 * MIN

/**
 * Modifica salvata con "Rifirma" (Centralina Pro > Contratto & Modifiche) e
 * nessun nuovo contratto partito dopo: il cliente ha in mano solo quello
 * vecchio. Se una richiesta nuova esiste, il caso passa agli allarmi di firma.
 */
const contr_da_rigenerare: Detector = (cfg, ctx) => {
    const mie = ultimeFirme(ctx)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const d = dettagli(b)
        if (d.contratto_rifirma_richiesta !== true) continue
        const dal = tempo(d.contratto_rifirma_at)
        if (!dal) continue
        const ritiro = ritiroAt(b)
        const fine = riconsegnaAt(b)
        const inCorso = !!ritiro && !!fine && ritiro <= ctx.now && fine > ctx.now
        if (!inCorso && !finestraRitiro(cfg, b, ctx.now)) continue
        const f = mie?.get(String(b.id)) || ctx.firme.get(String(b.id))
        const creata = tempo(f?.created_at)
        if (creata && creata.getTime() >= dal.getTime() - TOLLERANZA_OROLOGIO) continue
        const voci = Array.isArray(d.contratto_rifirma_voci) ? (d.contratto_rifirma_voci as unknown[]).join(', ') : ''
        hits.push({
            bookingId: b.id,
            vehicleId: b.vehicle_id,
            entita: etichetta(b, ritiro),
            dettaglio: `Modifica del ${oraIt(dal)}${voci ? ` (${voci})` : ''}: nuovo contratto non ancora generato`,
        })
    }
    return hits
}

// ─── Lettura dati ────────────────────────────────────────────────────────────

const GIORNI_LETTURA = 60
const STATI_PREAUTH = 'pending_preauth,preauth_pending_link,preauth_held,preauth_voided,preauth_captured'

async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - GIORNI_LETTURA * GIORNO).toISOString()
    const daCauzioni = new Date(now.getTime() - 180 * GIORNO).toISOString()
    const out: Record<string, unknown[]> = {}

    const [cauzRes, preRes, firmeRes, contrRes] = await Promise.all([
        supabase
            .from('cauzioni')
            .select('id, riferimento_contratto_id, veicolo_id, importo, stato, metodo, data_incasso, data_sblocco, data_restituzione, scadenza_cauzione, stato_restituzione, nexi_order_id, updated_at')
            .gte('created_at', daCauzioni)
            .range(0, 999),
        supabase
            .from('nexi_transactions')
            .select('id, order_id, status, created_at, updated_at, cauzione_id:metadata->>cauzione_id, esito:metadata->>operation_result, motivo:metadata->>motivo_riconciliazione')
            .or(`status.in.(${STATI_PREAUTH}),metadata->>type.eq.preauth`)
            .gte('created_at', da)
            .range(0, 999),
        supabase
            .from('signature_requests')
            .select('id, booking_id, status, signed_at, created_at, first_opened_at, otp_verified_at, revoked_at')
            .gte('created_at', da)
            .not('booking_id', 'is', null)
            .range(0, 1999),
        supabase
            .from('contracts')
            .select('id, booking_id, customer_name, customer_tax_code, customer_address, customer_license_number, updated_at')
            .gte('updated_at', da)
            .range(0, 999),
    ])

    if (!cauzRes.error) out[K.cauzioni] = cauzRes.data || []
    if (!preRes.error) out[K.preauth] = preRes.data || []
    if (!firmeRes.error) out[K.firme] = firmeRes.data || []
    if (!contrRes.error) out[K.contratti] = contrRes.data || []
    for (const [k, r] of [[K.cauzioni, cauzRes], [K.preauth, preRes], [K.firme, firmeRes], [K.contratti, contrRes]] as const) {
        if (r.error) console.warn(`[allarmi] ${k} non letto:`, r.error.message)
    }

    // Prenotazioni delle cauzioni (anche fuori dalla finestra del motore).
    const idPren = [...new Set((cauzRes.data || []).map(c => String(c.riferimento_contratto_id || '')).filter(Boolean))]
    if (!cauzRes.error) {
        const blocchi: string[][] = []
        for (let i = 0; i < idPren.length; i += 200) blocchi.push(idPren.slice(i, i + 200))
        const risposte = await Promise.all(blocchi.map(ids => supabase
            .from('bookings')
            .select('id, status, service_type, pickup_date, dropoff_date, customer_name, vehicle_name, vehicle_plate, vehicle_id, price_total, amount_paid, payment_status, booking_details')
            .in('id', ids)))
        if (risposte.every(r => !r.error)) out[K.prenotazioni] = risposte.flatMap(r => r.data || [])
    }

    // Eventi delle sole richieste non firmate: aperto, OTP, firma iniziata.
    if (!firmeRes.error) {
        const idRich = (firmeRes.data || [])
            .filter(r => !r.signed_at && ['pending', 'otp_verified'].includes(String(r.status || '')))
            .map(r => String(r.id))
        const blocchi: string[][] = []
        for (let i = 0; i < idRich.length; i += 200) blocchi.push(idRich.slice(i, i + 200))
        const risposte = await Promise.all(blocchi.map(ids => supabase
            .from('signature_audit_trail')
            .select('signature_request_id, event_type')
            .in('signature_request_id', ids)
            .in('event_type', ['document_viewed', 'otp_sent', 'otp_verified', 'signature_started'])))
        if (risposte.every(r => !r.error)) out[K.eventiFirma] = risposte.flatMap(r => r.data || [])
    }

    return out
}

export const moduloPagamentiCauzioniContratti: ModuloAllarmi = {
    nome: NOME,
    carica,
    detectors: {
        pag_x_addebito_aperto,
        pag_x_estensione_non_pagata,
        pag_x_saldo_residuo,
        pag_x_scadenza,
        cauz_inferiore_richiesta,
        cauz_formula_senza_non_autorizzata,
        cauz_garanzia_alternativa,
        cauz_preauth,
        cauz_storno_da_verificare,
        cauz_aperta_dopo_chiusura,
        cauz_da_trattenere,
        contr_inviato_non_aperto,
        contr_firma_incompleta,
        contr_dati_mancanti,
        contr_da_rigenerare,
    },
}
