/**
 * Allarmi dei gruppi "documenti" e "fatturazione" (01/10/2026).
 *
 * Documenti: si guarda la scheda del cliente (customers_extended), i file
 * caricati dal gestionale (customer_documents), quelli caricati dal sito
 * (user_documents, con l'esito della tab Verifica Documenti) e le
 * autorizzazioni OTP gia' date sulla prenotazione. Il cliente si trova SOLO
 * per id (booking_details.customer.customerId) o per account (user_id): mai
 * per nome, e una scheda non trovata non e' un "dato mancante" — e' una
 * ricerca fallita, e su quella non si suona (vedi CARGOS, 20/08/2026).
 *
 * Fatturazione: si guarda la tabella `fatture` (stato SdI, bozze bloccate con
 * il motivo in sdi_response.auto_send_error, note di credito collegate con
 * related_invoice_id) e gli incassi Nexi. Regole che valgono ovunque qui:
 *   - Credit Wallet / Gift Card non si fatturano mai (la ricarica e' gia'
 *     fatturata): stessa lista del server generate-invoice-from-booking;
 *   - la spunta "Fattura" per metodo di pagamento si legge da Centralina Pro
 *     > Fiscale, riga del business, come fa il server;
 *   - una fattura annullata da nota di credito non conta piu'.
 *
 * Fatti senza prenotazione (fatture di ricarica, incassi Nexi non collegati):
 * il motore riconosce un'occorrenza da prenotazione o veicolo, quindi per
 * questi si apre UNA sola occorrenza riassuntiva con l'elenco nel dettaglio.
 */
import { supabase } from '../../supabaseClient'
import { getRomeDateComponents } from '../timezoneUtils'
import { classifyDriverTier } from '../tierClassification'
import {
    isNoleggio,
    isPagato,
    isViva,
    riconsegnaAt,
    ritiroAt,
    sogliaMs,
    type AlarmHit,
    type BookingLite,
    type Detector,
    type DetectorContext,
    type ModuloAllarmi,
} from '../alarmDetectors'

// ─── Chiavi dei dati in ctx.extra ────────────────────────────────────────────

export const K_CLIENTI = 'documentiFatture.clienti'
export const K_DOCUMENTI = 'documentiFatture.documenti'
export const K_DOCUMENTI_SITO = 'documentiFatture.documentiSito'
export const K_FATTURE = 'documentiFatture.fatture'
export const K_PRENOTAZIONI_FATTURE = 'documentiFatture.prenotazioniFatture'
export const K_METODI = 'documentiFatture.metodiPagamento'
export const K_INCASSI = 'documentiFatture.incassiNexi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Riga = Record<string, any>

const MIN = 60_000
const GIORNO = 24 * 60 * MIN
/** Stessa finestra del motore: quello che e' successo e quello che succede. */
const GIORNI_FINESTRA = 45
/** Fatture lette per data: le pratiche recenti (emesse senza pagamento, NC). */
const GIORNI_FATTURE = 120

// ─── Aiutanti ────────────────────────────────────────────────────────────────

function tempo(v: unknown): Date | null {
    if (!v) return null
    const d = new Date(String(v))
    return Number.isFinite(d.getTime()) ? d : null
}

function entroPrima(evento: Date | null, now: Date, ms: number): boolean {
    if (!evento) return false
    const diff = evento.getTime() - now.getTime()
    return diff >= 0 && diff <= ms
}

function passatoDa(evento: Date | null, now: Date, ms: number): boolean {
    if (!evento) return false
    return now.getTime() - evento.getTime() >= ms
}

function dataIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)}/${c.year}`
}

function oraIt(d: Date | null): string {
    if (!d) return '—'
    const c = getRomeDateComponents(d.toISOString())
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)} ${p(c.hour)}:${p(c.minute)}`
}

function euro(n: number): string {
    return `${(Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function testo(v: unknown): string {
    return v === null || v === undefined ? '' : String(v).trim()
}

function etichetta(b: BookingLite, quando?: Date | null): string {
    const mezzo = b.vehicle_name || b.itemName || 'Veicolo'
    const targa = b.vehicle_plate ? ` (${b.vehicle_plate})` : ''
    const cliente = b.customer_name || b.booking_details?.customer?.fullName || 'Cliente'
    return `${mezzo}${targa} · ${cliente}${quando ? ` · ${oraIt(quando)}` : ''}`
}

function lista<T = Riga>(ctx: DetectorContext, chiave: string): T[] {
    return ((ctx.extra?.[chiave] as T[] | undefined) || [])
}

/** Data "YYYY-MM-DD" (o ISO) -> anni compiuti alla data di riferimento, ora di Roma. */
export function anniCompiutiAl(dataIso: string, riferimento: Date): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataIso || ''))
    if (!m) return null
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const r = getRomeDateComponents(riferimento.toISOString())
    let anni = r.year - y
    if (r.month < mo || (r.month === mo && r.day < d)) anni--
    return anni
}

/** Fine del giorno indicato (Europe/Rome non serve: basta il giorno di calendario). */
function giorno(v: unknown): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(testo(v))
    if (!m) return null
    return new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59.000Z`)
}

/** Codici delle autorizzazioni OTP gia' approvate sulla prenotazione. */
function autorizzazioni(b: BookingLite): Set<string> {
    const lo = b.booking_details?.limitation_overrides
    const out = new Set<string>()
    if (Array.isArray(lo)) for (const o of lo) if (o?.limitationCode) out.add(String(o.limitationCode))
    return out
}

// ─── Cliente della prenotazione ──────────────────────────────────────────────

function indiceClienti(ctx: DetectorContext): { perId: Map<string, Riga>; perUtente: Map<string, Riga> } {
    const perId = new Map<string, Riga>()
    const perUtente = new Map<string, Riga>()
    for (const c of lista(ctx, K_CLIENTI)) {
        if (c.id) perId.set(String(c.id), c)
        if (c.user_id) perUtente.set(String(c.user_id), c)
    }
    return { perId, perUtente }
}

/** Solo per id o per account. Mai per nome. */
function clienteDi(b: BookingLite, idx: ReturnType<typeof indiceClienti>): Riga | null {
    const cid = testo(b.booking_details?.customer?.customerId)
    if (cid && idx.perId.has(cid)) return idx.perId.get(cid)!
    const uid = testo(b.user_id)
    if (uid && idx.perUtente.has(uid)) return idx.perUtente.get(uid)!
    return null
}

function dataNascita(b: BookingLite, c: Riga | null): string {
    return testo(c?.data_nascita) || testo(b.date_of_birth) || testo(b.booking_details?.customer?.birthDate)
}

function rilascioPatente(b: BookingLite, c: Riga | null): string {
    return testo(c?.data_rilascio_patente) || testo(c?.meta_patente?.rilascio) || testo(c?.meta_pat_ril)
        || testo(b.license_issue_date) || testo(b.booking_details?.customer?.licenseIssueDate)
}

function scadenzaPatente(c: Riga | null): string {
    return testo(c?.scadenza_patente) || testo(c?.meta_patente?.scadenza) || testo(c?.meta_pat_scad)
}

function secondoConducente(b: BookingLite): Riga | null {
    const sd = b.booking_details?.second_driver
    if (!sd || typeof sd !== 'object' || Array.isArray(sd)) return null
    const nome = `${testo(sd.name)} ${testo(sd.surname)}`.trim()
    if (!nome && !testo(sd.customer_id)) return null
    return { ...sd, nomeCompleto: nome || 'Secondo conducente' }
}

/** Il noleggio che conta per i documenti: vivo, e col ritiro nella finestra. */
function noleggiInArrivo(cfg: Parameters<Detector>[0], ctx: DetectorContext): BookingLite[] {
    const ms = sogliaMs(cfg)
    return ctx.bookings.filter(b => isNoleggio(b) && isViva(b) && entroPrima(ritiroAt(b), ctx.now, ms))
}

// ─── Documenti: lati e categorie ─────────────────────────────────────────────

type Tipo = 'identita' | 'patente' | 'cf'
type Lato = 'fronte' | 'retro' | 'completo'

/** customer_documents.document_type -> tipo e lato. Il formato vecchio (un file solo) vale per entrambi i lati. */
export function latoDocumentoGestionale(t: string): { tipo: Tipo; lato: Lato } | null {
    const v = t.toLowerCase()
    const tipo: Tipo | null = v.startsWith('identity_document') ? 'identita'
        : v.startsWith('drivers_license') ? 'patente'
        : v.startsWith('codice_fiscale') ? 'cf' : null
    if (!tipo) return null
    const lato: Lato = v.endsWith('_front') ? 'fronte' : v.endsWith('_back') ? 'retro' : 'completo'
    return { tipo, lato }
}

/**
 * user_documents.document_type (sito) -> tipo e lato. I nomi sono storicamente
 * disordinati (patenteFront, drivers_license_back, cartaIdentitaBack, id_back,
 * license...). Righe col nome del file al posto del tipo (import del 30/04)
 * non si possono classificare: restano fuori.
 */
export function latoDocumentoSito(t: string): { tipo: Tipo; lato: Lato } | null {
    const v = t.toLowerCase()
    if (/^\d+\.(jpe?g|png|pdf|heic|webp)$/.test(v)) return null
    if (/_\d{6,}$/.test(v)) return null
    if (v.includes('libretto')) return null
    const tipo: Tipo | null = (v.includes('patente') || v.includes('license') || v.includes('licence')) ? 'patente'
        : (v.includes('codice_fiscale') || v.includes('codicefiscale') || v === 'cf' || v.startsWith('cf_')) ? 'cf'
        : (v.includes('carta') || v.includes('identit') || v === 'id' || v.startsWith('id_')) ? 'identita'
        : null
    if (!tipo) return null
    const lato: Lato = (v.includes('back') || v.includes('retro')) ? 'retro'
        : (v.includes('front') || v.includes('fronte')) ? 'fronte' : 'completo'
    return { tipo, lato }
}

/** Lati presenti per tipo, da tutte le fonti (gestionale, sito, foto sulla prenotazione). */
function latiPresenti(b: BookingLite, c: Riga | null, ctx: DetectorContext): Map<Tipo, Set<Lato>> {
    const out = new Map<Tipo, Set<Lato>>()
    const add = (tipo: Tipo, lato: Lato) => {
        const s = out.get(tipo) || new Set<Lato>()
        s.add(lato)
        out.set(tipo, s)
    }
    if (c?.id) {
        for (const d of lista(ctx, K_DOCUMENTI)) {
            if (String(d.customer_id) !== String(c.id)) continue
            const x = latoDocumentoGestionale(testo(d.document_type))
            if (x) add(x.tipo, x.lato)
        }
    }
    const uid = testo(b.user_id) || testo(c?.user_id)
    if (uid) {
        for (const d of lista(ctx, K_DOCUMENTI_SITO)) {
            if (String(d.user_id) !== uid || d.status === 'rejected') continue
            const x = latoDocumentoSito(testo(d.document_type))
            if (x) add(x.tipo, x.lato)
        }
    }
    const det = (b.booking_details || {}) as Riga
    if (b.idCardImage || b.driverIdImage || det.driverIdImage) add('identita', 'fronte')
    if (det.driverIdImageBack) add('identita', 'retro')
    if (b.driverLicenseImage || b.license_file_url || det.driverLicenseImage) add('patente', 'fronte')
    if (det.driverLicenseImageBack) add('patente', 'retro')
    return out
}

const NOME_TIPO: Record<Tipo, string> = { identita: 'documento d’identità', patente: 'patente', cf: 'codice fiscale' }

// ─── Rilevazioni: documenti ──────────────────────────────────────────────────

/** Patente da meno di 3 anni alla data del ritiro (stessa regola della prenotazione). */
const doc_x_anzianita_patente: Detector = (cfg, ctx) => {
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const auth = autorizzazioni(b)
        if (auth.has('license_too_recent') || auth.has('driver_blocked')) continue
        const ril = rilascioPatente(b, clienteDi(b, idx))
        const anni = ril ? anniCompiutiAl(ril, ritiroAt(b)!) : null
        if (anni === null || anni >= 3) continue
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Patente rilasciata il ${dataIt(tempo(ril))}: ${Math.max(anni, 0)} anni al ritiro, ne servono almeno 3. Nessuna autorizzazione OTP`,
        })
    }
    return hits
}

/** Eta' fuori dai limiti (sotto i 21 o da 70 in su) al giorno del ritiro. */
const doc_x_eta_conducente: Detector = (cfg, ctx) => {
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        if (autorizzazioni(b).has('driver_blocked')) continue
        const nascita = dataNascita(b, clienteDi(b, idx))
        const eta = nascita ? anniCompiutiAl(nascita, ritiroAt(b)!) : null
        if (eta === null) continue
        // Solo l'eta': l'anzianita' di patente ha la sua voce.
        const esito = classifyDriverTier(eta, 99)
        if (esito.tier !== 'BLOCKED') continue
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `${eta} anni al ritiro: ${esito.reason} Nessuna autorizzazione OTP`,
        })
    }
    return hits
}

/** Prenotazione ancora in stato "pending" (non confermata) a ridosso del ritiro. */
const doc_x_pratica_da_confermare: Detector = (cfg, ctx) => {
    return noleggiInArrivo(cfg, ctx)
        .filter(b => String(b.status || '').toLowerCase() === 'pending')
        .map(b => ({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: 'Pratica ancora da confermare (stato "in attesa")',
        }))
}

/**
 * Campi della scheda che servono al contratto. Stessa lista della
 * validazione in ReservationsTab (modalita' contratto), cosi' l'allarme dice
 * esattamente cio' che il popup "Dati mancanti" chiederebbe.
 */
export function campiMancantiContratto(c: Riga): string[] {
    const m: string[] = []
    const tipo = testo(c.tipo_cliente) || 'persona_fisica'
    if (tipo === 'azienda') {
        if (!testo(c.sede_legale) && !testo(c.sede_operativa)) m.push('sede legale')
        if (!testo(c.denominazione) && !testo(c.ragione_sociale)) m.push('denominazione')
        if (!testo(c.partita_iva)) m.push('partita IVA')
        if (!testo(c.telefono)) m.push('telefono')
        return m
    }
    if (tipo === 'pubblica_amministrazione') {
        if (!testo(c.indirizzo) && !testo(c.citta)) m.push('indirizzo')
        return m
    }
    if (!testo(c.indirizzo)) m.push('indirizzo')
    if (!testo(c.citta_residenza) && !testo(c.citta)) m.push('città di residenza')
    if (!testo(c.provincia_residenza) && !testo(c.provincia)) m.push('provincia di residenza')
    if (!testo(c.codice_postale) && !testo(c.cap)) m.push('CAP')
    if (!testo(c.codice_fiscale)) m.push('codice fiscale')
    if (!testo(c.nome)) m.push('nome')
    if (!testo(c.cognome)) m.push('cognome')
    if (!testo(c.telefono)) m.push('telefono')
    if (!testo(c.data_nascita)) m.push('data di nascita')
    if (!testo(c.luogo_nascita)) m.push('luogo di nascita')
    if (!testo(c.sesso) && !testo(c.meta_sesso)) m.push('sesso')
    if (!testo(c.patente) && !testo(c.numero_patente) && !testo(c.meta_patente?.numero)) m.push('numero patente')
    if (!testo(c.emessa_da) && !testo(c.meta_patente?.ente)) m.push('patente emessa da')
    if (!testo(c.data_rilascio_patente) && !testo(c.meta_patente?.rilascio)) m.push('data rilascio patente')
    if (!testo(c.scadenza_patente) && !testo(c.meta_patente?.scadenza)) m.push('scadenza patente')
    return m
}

const doc_x_dati_incompleti: Detector = (cfg, ctx) => {
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const c = clienteDi(b, idx)
        if (!c) continue // scheda non trovata = ricerca fallita, non dato mancante
        const mancano = campiMancantiContratto(c)
        if (mancano.length === 0) continue
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Scheda cliente senza: ${mancano.join(', ')}`,
        })
    }
    return hits
}

/** Ultimo documento caricato dal sito per tipo e lato. */
function ultimiDocumentiSito(ctx: DetectorContext, uid: string): Riga[] {
    const ultimi = new Map<string, Riga>()
    for (const d of lista(ctx, K_DOCUMENTI_SITO)) {
        if (String(d.user_id) !== uid) continue
        const x = latoDocumentoSito(testo(d.document_type))
        if (!x) continue
        const k = `${x.tipo}:${x.lato}`
        const prima = ultimi.get(k)
        if (!prima || (tempo(d.created_at)?.getTime() || 0) > (tempo(prima.created_at)?.getTime() || 0)) ultimi.set(k, d)
    }
    return [...ultimi.values()]
}

/**
 * Documento rifiutato nella tab Verifica Documenti (illeggibile, scaduto,
 * non conforme: il motivo e' quello scritto da chi l'ha rifiutato) e mai
 * sostituito da un caricamento piu' recente dello stesso lato.
 */
const doc_x_documento_rifiutato: Detector = (cfg, ctx) => {
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const uid = testo(b.user_id) || testo(clienteDi(b, idx)?.user_id)
        if (!uid) continue
        const rifiutati = ultimiDocumentiSito(ctx, uid).filter(d => d.status === 'rejected')
        if (rifiutati.length === 0) continue
        const cosa = rifiutati.map(d => {
            const x = latoDocumentoSito(testo(d.document_type))!
            const motivo = testo(d.rejection_reason)
            return `${NOME_TIPO[x.tipo]}${x.lato === 'completo' ? '' : ` (${x.lato})`}${motivo ? `: ${motivo}` : ''}`
        })
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Documento rifiutato in verifica — ${cosa.join(' · ')}`,
        })
    }
    return hits
}

/** Documenti caricati dal cliente e ancora "da verificare" nella tab Verifica Documenti. */
const doc_x_verifica_in_sospeso: Detector = (cfg, ctx) => {
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const uid = testo(b.user_id) || testo(clienteDi(b, idx)?.user_id)
        if (!uid) continue
        const sospesi = ultimiDocumentiSito(ctx, uid).filter(d => d.status === 'pending_verification')
        if (sospesi.length === 0) continue
        const cosa = [...new Set(sospesi.map(d => {
            const x = latoDocumentoSito(testo(d.document_type))!
            return `${NOME_TIPO[x.tipo]}${x.lato === 'completo' ? '' : ` ${x.lato}`}`
        }))]
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Da verificare: ${cosa.join(', ')}`,
        })
    }
    return hits
}

/**
 * arg: 'fronte' | 'retro'. Suona quando di un documento c'e' un lato solo:
 * se non c'e' nessuno dei due lati la voce giusta e' "documento mancante".
 */
const doc_x_lato_mancante: Detector = (cfg, ctx, arg) => {
    const cerco: Lato = arg === 'retro' ? 'retro' : 'fronte'
    const altro: Lato = cerco === 'fronte' ? 'retro' : 'fronte'
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const lati = latiPresenti(b, clienteDi(b, idx), ctx)
        const mancanti: string[] = []
        for (const tipo of ['identita', 'patente'] as Tipo[]) {
            const s = lati.get(tipo)
            if (!s || s.has('completo') || s.has(cerco) || !s.has(altro)) continue
            mancanti.push(NOME_TIPO[tipo])
        }
        if (mancanti.length === 0) continue
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Manca il ${cerco} di: ${mancanti.join(', ')} (c'è solo il ${altro})`,
        })
    }
    return hits
}

/** Secondo conducente dichiarato senza patente o documento d'identita' in archivio. */
const doc_x_secondo_conducente: Detector = (cfg, ctx) => {
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const sd = secondoConducente(b)
        if (!sd) continue
        const cid = testo(sd.customer_id)
        const tipi = new Set<Tipo>()
        if (cid) {
            for (const d of lista(ctx, K_DOCUMENTI)) {
                if (String(d.customer_id) !== cid) continue
                const x = latoDocumentoGestionale(testo(d.document_type))
                if (x) tipi.add(x.tipo)
            }
        }
        const mancano = (['patente', 'identita'] as Tipo[]).filter(t => !tipi.has(t)).map(t => NOME_TIPO[t])
        if (mancano.length === 0) continue
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: cid
                ? `${sd.nomeCompleto}: manca ${mancano.join(' e ')} in archivio`
                : `${sd.nomeCompleto}: nessuna scheda cliente, documenti non in archivio`,
        })
    }
    return hits
}

/** Patente (conducente o secondo conducente) gia' scaduta al momento del ritiro. */
const doc_x_patente_scaduta: Detector = (cfg, ctx) => {
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    for (const b of noleggiInArrivo(cfg, ctx)) {
        const ritiro = ritiroAt(b)!
        const problemi: string[] = []
        if (!autorizzazioni(b).has('license_expired')) {
            const scad = giorno(scadenzaPatente(clienteDi(b, idx)))
            if (scad && scad < ritiro) problemi.push(`patente del cliente scaduta il ${dataIt(scad)}`)
        }
        const sd = secondoConducente(b)
        const scad2 = giorno(sd?.license_expiry)
        if (sd && scad2 && scad2 < ritiro) problemi.push(`patente di ${sd.nomeCompleto} scaduta il ${dataIt(scad2)}`)
        if (problemi.length === 0) continue
        hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiro), dettaglio: problemi.join(' · ') })
    }
    return hits
}

/**
 * Patente valida oggi che scade entro la soglia (giorni) oppure prima della
 * riconsegna: il cliente ha un noleggio in arrivo o in corso.
 */
const doc_x_patente_in_scadenza: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const idx = indiceClienti(ctx)
    const hits: AlarmHit[] = []
    const scade = (scad: Date | null, fine: Date | null) => !!scad && scad >= ctx.now
        && (scad.getTime() - ctx.now.getTime() <= ms || (!!fine && scad < fine))
    for (const b of ctx.bookings) {
        if (!isNoleggio(b) || !isViva(b)) continue
        const fine = riconsegnaAt(b)
        if (!fine || fine < ctx.now) continue
        const problemi: string[] = []
        const scad = giorno(scadenzaPatente(clienteDi(b, idx)))
        if (scade(scad, fine)) problemi.push(`patente del cliente scade il ${dataIt(scad)}`)
        const sd = secondoConducente(b)
        const scad2 = giorno(sd?.license_expiry)
        if (sd && scade(scad2, fine)) problemi.push(`patente di ${sd.nomeCompleto} scade il ${dataIt(scad2)}`)
        if (problemi.length === 0) continue
        hits.push({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `${problemi.join(' · ')} (riconsegna ${oraIt(fine)})`,
        })
    }
    return hits
}

// ─── Fatturazione: aiutanti ──────────────────────────────────────────────────

const NOTE_DI_CREDITO = new Set(['nota_di_credito', 'nota_credito', 'td04'])
const SCARTATE = new Set(['rejected', 'scartata', 'error'])
const NON_EMESSE = new Set(['', 'draft'])

function isNotaCredito(f: Riga): boolean {
    return NOTE_DI_CREDITO.has(testo(f.tipo_fattura).toLowerCase())
}

function statoSdi(f: Riga): string {
    return testo(f.sdi_status).toLowerCase()
}

/** Stessa lista del server (generate-invoice-from-booking): questi metodi non si fatturano mai. */
export function isWalletOGift(metodo: unknown): boolean {
    const m = testo(metodo).toLowerCase()
    return m === 'credit' || m.includes('wallet') || m.includes('gift')
}

function rigaBusiness(serviceType: unknown): string {
    switch (testo(serviceType).toLowerCase()) {
        case 'boat_rental': return 'business_mare'
        case 'heli_rental': return 'business_aria'
        case 'stay_rental': return 'business_soggiorni'
        case 'car_wash':
        case 'mechanical':
        case 'mechanical_service': return 'business_lavaggio'
        default: return 'main'
    }
}

/**
 * Centralina Pro > Fiscale > Metodi di pagamento, colonna "Fattura". Riga
 * del business, poi `main`; metodo sconosciuto = si fattura (come il server).
 */
export function metodoFattura(ctx: DetectorContext, metodo: unknown, serviceType: unknown): boolean {
    if (isWalletOGift(metodo)) return false
    const m = testo(metodo).toLowerCase()
    if (!m) return true
    const righe = lista(ctx, K_METODI)
    const elenco = (id: string) => {
        const r = righe.find(x => x.id === id)
        return Array.isArray(r?.pm) && r!.pm.length > 0 ? (r!.pm as Riga[]) : null
    }
    const metodi = elenco(rigaBusiness(serviceType)) || elenco('main') || []
    for (const x of metodi) {
        if (testo(x.key).toLowerCase() === m || testo(x.label).toLowerCase() === m) return x.auto_invoice !== false
    }
    return true
}

/** Fatture di una prenotazione che contano: niente note di credito, niente fatture stornate. */
function fattureValidePerPrenotazione(ctx: DetectorContext): Map<string, Riga[]> {
    const fatture = lista(ctx, K_FATTURE)
    const stornate = new Set(fatture.filter(isNotaCredito).map(f => testo(f.related_invoice_id)).filter(Boolean))
    const out = new Map<string, Riga[]>()
    for (const f of fatture) {
        if (!f.booking_id || isNotaCredito(f) || stornate.has(String(f.id))) continue
        if (testo(f.stato).toLowerCase() === 'cancelled') continue
        const arr = out.get(String(f.booking_id)) || []
        arr.push(f)
        out.set(String(f.booking_id), arr)
    }
    return out
}

/**
 * Pratica che si fattura al cliente: fuori le uscite straordinarie (interne,
 * di ogni business), i blocchi di cortesia e i lavaggi interni di rientro.
 */
export function isPraticaCliente(b: BookingLite): boolean {
    if (testo(b.service_type).toLowerCase() === 'uscita_straordinaria') return false
    const det = (b.booking_details || {}) as Riga
    if (det.is_courtesy_block || det.internal === true || det.createdBy === 'automatic_system') return false
    if (testo(b.customer_name).toLowerCase() === 'lavaggio rientro') return false
    return true
}

function etichettaFattura(f: Riga): string {
    return `Fattura ${testo(f.numero_fattura) || 's.n.'} · ${testo(f.customer_name) || 'cliente n/d'} · ${euro(Number(f.importo_totale) || 0)}`
}

/**
 * Le occorrenze si riconoscono per prenotazione: piu' fatture sulla stessa
 * pratica diventano una riga sola; quelle senza pratica una riga riassuntiva.
 */
function hitsDaFatture(righe: { f: Riga; motivo: string }[], senzaPratica: string): AlarmHit[] {
    const perPratica = new Map<string, { f: Riga; motivo: string }[]>()
    const orfane: { f: Riga; motivo: string }[] = []
    for (const r of righe) {
        if (r.f.booking_id) {
            const k = String(r.f.booking_id)
            perPratica.set(k, [...(perPratica.get(k) || []), r])
        } else orfane.push(r)
    }
    const hits: AlarmHit[] = []
    for (const [bookingId, rr] of perPratica) {
        hits.push({
            bookingId,
            entita: rr.length === 1 ? etichettaFattura(rr[0].f) : `${rr.length} fatture · ${testo(rr[0].f.customer_name) || 'cliente n/d'}`,
            dettaglio: rr.map(r => `${testo(r.f.numero_fattura) || 's.n.'}: ${r.motivo}`).join(' · '),
        })
    }
    if (orfane.length > 0) {
        hits.push({
            entita: `${orfane.length} ${orfane.length === 1 ? 'fattura' : 'fatture'} ${senzaPratica}`,
            dettaglio: orfane.slice(0, 10).map(r => `${etichettaFattura(r.f)} — ${r.motivo}`).join(' · ')
                + (orfane.length > 10 ? ` · …e altre ${orfane.length - 10}` : ''),
        })
    }
    return hits
}

// ─── Rilevazioni: fatture ────────────────────────────────────────────────────

/** Scartata o in errore allo SdI da almeno la soglia, mai sostituita ne' stornata. */
const fatt_scartata_sdi: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const valide = fattureValidePerPrenotazione(ctx)
    const fatture = lista(ctx, K_FATTURE)
    const stornate = new Set(fatture.filter(isNotaCredito).map(f => testo(f.related_invoice_id)).filter(Boolean))
    const righe = fatture
        .filter(f => SCARTATE.has(statoSdi(f)) && !stornate.has(String(f.id)) && testo(f.stato).toLowerCase() !== 'cancelled')
        .filter(f => passatoDa(tempo(f.sdi_sent_at) || tempo(f.created_at), ctx.now, ms))
        .filter(f => {
            // Riemessa: sulla stessa pratica c'e' una fattura dello stesso tipo passata allo SdI dopo.
            if (!f.booking_id) return true
            const dopo = (valide.get(String(f.booking_id)) || []).find(g => g.id !== f.id
                && testo(g.tipo_fattura) === testo(f.tipo_fattura)
                && !SCARTATE.has(statoSdi(g)) && !NON_EMESSE.has(statoSdi(g))
                && (tempo(g.created_at)?.getTime() || 0) >= (tempo(f.created_at)?.getTime() || 0))
            return !dopo
        })
        .map(f => ({ f, motivo: statoSdi(f) === 'error' ? 'errore di trasmissione allo SdI' : 'scartata dallo SdI' }))
    return hitsDaFatture(righe, 'senza prenotazione da correggere')
}

/** Ferma in bozza: l'invio automatico allo SdI e' fallito e il motivo e' scritto. */
const fatt_bozza_bloccata: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const righe = lista(ctx, K_FATTURE)
        .filter(f => NON_EMESSE.has(statoSdi(f)) && !isNotaCredito(f) && testo(f.stato).toLowerCase() !== 'cancelled')
        .filter(f => !!testo(f.auto_send_error))
        .filter(f => passatoDa(tempo(f.created_at), ctx.now, ms))
        .map(f => ({ f, motivo: `ferma in bozza — ${testo(f.auto_send_error).slice(0, 200)}` }))
    return hitsDaFatture(righe, 'senza prenotazione ferme in bozza')
}

/** Codice fiscale persona (16) o numerico (11, enti/aziende). */
export function codiceFiscaleValido(cf: unknown): boolean {
    const v = testo(cf).toUpperCase()
    return /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v) || /^\d{11}$/.test(v)
}

/** Fattura non ancora accettata dallo SdI con CF vuoto o segnaposto e senza partita IVA. */
const fatt_cf_non_valido: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const righe = lista(ctx, K_FATTURE)
        .filter(f => (NON_EMESSE.has(statoSdi(f)) || SCARTATE.has(statoSdi(f))) && testo(f.stato).toLowerCase() !== 'cancelled')
        .filter(f => !testo(f.customer_vat) && !codiceFiscaleValido(f.customer_tax_code))
        .filter(f => passatoDa(tempo(f.created_at), ctx.now, ms))
        .map(f => ({ f, motivo: testo(f.customer_tax_code) ? `codice fiscale non valido (“${testo(f.customer_tax_code)}”)` : 'codice fiscale vuoto' }))
    return hitsDaFatture(righe, 'senza prenotazione con codice fiscale mancante')
}

/**
 * arg: 'partita_iva' | 'sdi_pec'. Cliente azienda con una pratica da
 * fatturare (ritiro entro la soglia, oppure gia' partita e senza fattura):
 * nella scheda manca la partita IVA, o mancano sia codice destinatario sia PEC.
 */
const fatt_dato_azienda: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const idx = indiceClienti(ctx)
    const valide = fattureValidePerPrenotazione(ctx)
    const hits: AlarmHit[] = []
    for (const b of ctx.bookings) {
        if (!isPraticaCliente(b) || (Number(b.price_total) || 0) <= 0) continue
        const ritiro = ritiroAt(b)
        if (!ritiro) continue
        const daFatturare = entroPrima(ritiro, ctx.now, ms)
            || (ritiro < ctx.now && !(valide.get(String(b.id)) || []).length)
        if (!daFatturare) continue
        const c = clienteDi(b, idx)
        if (!c || testo(c.tipo_cliente) !== 'azienda') continue
        const nome = testo(c.ragione_sociale) || testo(c.denominazione) || 'Azienda'
        let manca = ''
        if (arg === 'partita_iva') {
            if (!testo(c.partita_iva)) manca = `${nome}: partita IVA mancante nella scheda cliente`
        } else {
            const sdi = testo(c.codice_destinatario).toUpperCase()
            if ((!sdi || sdi === '0000000') && !testo(c.pec)) manca = `${nome}: né codice destinatario SDI né PEC nella scheda cliente`
        }
        if (!manca) continue
        hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiro), dettaglio: manca })
    }
    // Partita IVA: anche le fatture non ancora accettate intestate a un codice
    // fiscale numerico (azienda) senza partita IVA.
    if (arg === 'partita_iva') {
        const giaViste = new Set(hits.map(h => h.bookingId))
        const righe = lista(ctx, K_FATTURE)
            .filter(f => (NON_EMESSE.has(statoSdi(f)) || SCARTATE.has(statoSdi(f))) && !isNotaCredito(f))
            .filter(f => /^\d{11}$/.test(testo(f.customer_tax_code)) && !testo(f.customer_vat))
            .filter(f => passatoDa(tempo(f.created_at), ctx.now, ms) && !giaViste.has(f.booking_id))
            .map(f => ({ f, motivo: 'intestata ad azienda senza partita IVA' }))
        hits.push(...hitsDaFatture(righe, 'senza prenotazione intestate ad azienda senza partita IVA'))
    }
    return hits
}

/** C'e' un pagamento sulla voce che la fattura documenta? */
function voceIncassata(f: Riga, b: Riga): boolean {
    const tipo = testo(f.tipo_fattura).toLowerCase()
    const det = (b.booking_details || {}) as Riga
    const pagata = (x: Riga) => ['paid', 'completed', 'succeeded', 'pagato'].includes(testo(x?.paymentStatus || x?.payment_status).toLowerCase())
        || (Number(x?.amountPaid) || 0) > 0
    if (tipo === 'penale') return (Array.isArray(det.penalties) ? det.penalties : []).some(pagata)
    if (tipo === 'danno') return (Array.isArray(det.danni) ? det.danni : []).some(pagata)
    if (tipo === 'estensione') return (Array.isArray(det.extension_history) ? det.extension_history : []).some(pagata)
    return isPagato(b) || (Number(b.amount_paid) || 0) > 0
}

/**
 * arg: 'attiva' (pratica viva: fattura emessa e nessun incasso) |
 *      'annullata' (pratica annullata e mai pagata: la fattura va stornata
 *      con una nota di credito).
 * Solo fatture passate allo SdI e non gia' stornate. Le ricariche wallet
 * hanno il loro incasso fuori dalle prenotazioni e qui non entrano.
 */
const fatt_senza_pagamento: Detector = (cfg, ctx, arg) => {
    const ms = sogliaMs(cfg)
    const pren = new Map(lista(ctx, K_PRENOTAZIONI_FATTURE).map(b => [String(b.id), b]))
    const fatture = lista(ctx, K_FATTURE)
    const stornate = new Set(fatture.filter(isNotaCredito).map(f => testo(f.related_invoice_id)).filter(Boolean))
    const righe: { f: Riga; motivo: string }[] = []
    for (const f of fatture) {
        if (!f.booking_id || isNotaCredito(f) || stornate.has(String(f.id))) continue
        if (NON_EMESSE.has(statoSdi(f)) || SCARTATE.has(statoSdi(f))) continue
        if (testo(f.stato).toLowerCase() === 'cancelled') continue
        if (!passatoDa(tempo(f.created_at), ctx.now, ms)) continue
        const b = pren.get(String(f.booking_id))
        if (!b || voceIncassata(f, b)) continue
        const annullata = ['cancelled', 'annullata'].includes(testo(b.status).toLowerCase())
        if ((arg === 'annullata') !== annullata) continue
        righe.push({
            f,
            motivo: annullata
                ? 'prenotazione annullata e mai pagata: emettere la nota di credito'
                : 'emessa ma sulla prenotazione non risulta alcun incasso',
        })
    }
    return hitsDaFatture(righe, '')
}

/**
 * Prenotazione pagata, con un metodo che in Centralina genera la fattura,
 * e nessuna fattura valida collegata dopo la soglia.
 */
const fatt_senza_fattura: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const valide = fattureValidePerPrenotazione(ctx)
    return ctx.bookings
        // Il motore carica gia' solo prenotazioni non annullate.
        .filter(b => isPagato(b) && (Number(b.price_total) || 0) > 0 && isPraticaCliente(b))
        .filter(b => metodoFattura(ctx, b.payment_method, b.service_type))
        .filter(b => !(valide.get(String(b.id)) || []).length)
        .filter(b => passatoDa(tempo(b.payment_completed_at) || riconsegnaAt(b) || ritiroAt(b), ctx.now, ms))
        .map(b => ({
            bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)),
            dettaglio: `Pagata (${testo(b.payment_method) || 'metodo n/d'}), nessuna fattura generata`,
        }))
}

/**
 * Pagamenti registrati sulla pratica dopo la prenotazione — prolungamenti,
 * penali, danni — senza la loro fattura. Le penali di uno stesso incasso
 * vanno in una fattura sola: basta che ce ne sia una per il tipo.
 */
const fatt_extra_senza_fattura: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const valide = fattureValidePerPrenotazione(ctx)
    const hits: AlarmHit[] = []
    const pagata = (x: Riga) => ['paid', 'completed', 'succeeded'].includes(testo(x?.paymentStatus || x?.payment_status).toLowerCase())
    for (const b of ctx.bookings) {
        if (!isPraticaCliente(b)) continue
        const det = (b.booking_details || {}) as Riga
        const fatt = valide.get(String(b.id)) || []
        const conta = (tipo: string) => fatt.filter(f => testo(f.tipo_fattura).toLowerCase() === tipo).length
        const fatturabile = (x: Riga) => metodoFattura(ctx, x.paymentMethod || x.payment_method || b.payment_method, b.service_type)
        const problemi: string[] = []

        const ext = (Array.isArray(det.extension_history) ? det.extension_history : [])
            .filter((e: Riga) => pagata(e) && (Number(e.additional_amount) || 0) > 0 && fatturabile(e)
                && passatoDa(tempo(e.paid_at) || tempo(e.extended_at), ctx.now, ms))
        if (ext.length > conta('estensione')) {
            problemi.push(`${ext.length - conta('estensione')} prolungamento/i pagato/i senza fattura`)
        }
        for (const [chiave, tipo, nome] of [['penalties', 'penale', 'penali'], ['danni', 'danno', 'danni']] as const) {
            const voci = (Array.isArray(det[chiave]) ? det[chiave] : [])
                .filter((p: Riga) => (Number(p.amountPaid) || 0) > 0 && fatturabile(p)
                    && passatoDa(tempo(p.paidAt) || tempo(p.date), ctx.now, ms))
            if (voci.length > 0 && conta(tipo) === 0) {
                const tot = voci.reduce((s: number, p: Riga) => s + (Number(p.amountPaid) || 0), 0)
                problemi.push(`${nome} incassate (${euro(tot)}) senza fattura`)
            }
        }
        if (problemi.length === 0) continue
        hits.push({ bookingId: b.id, vehicleId: b.vehicle_id, entita: etichetta(b, ritiroAt(b)), dettaglio: problemi.join(' · ') })
    }
    return hits
}

/** Incasso Nexi andato a buon fine, non collegato ad alcuna prenotazione ne' cauzione. */
export function isIncassoDaRiconciliare(t: Riga): boolean {
    if (testo(t.status).toLowerCase() !== 'completed' || t.booking_id) return false
    if (testo(t.cauzione_id)) return false
    const d = testo(t.description).toLowerCase()
    // Ricariche wallet e quote Club hanno il loro registro; le cauzioni il loro.
    if (d.includes('wallet') || d.includes('club') || d.startsWith('cauzione') || d.includes('pre-autorizzazione')) return false
    return true
}

const fatt_incasso_senza_pratica: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const righe = lista(ctx, K_INCASSI)
        .filter(isIncassoDaRiconciliare)
        .filter(t => passatoDa(tempo(t.created_at), ctx.now, ms))
        .sort((a, b) => (tempo(b.created_at)?.getTime() || 0) - (tempo(a.created_at)?.getTime() || 0))
    if (righe.length === 0) return []
    const tot = righe.reduce((s, t) => s + (Number(t.amount_cents) || 0) / 100, 0)
    return [{
        entita: `${righe.length} ${righe.length === 1 ? 'incasso Nexi' : 'incassi Nexi'} senza prenotazione · ${euro(tot)}`,
        dettaglio: righe.slice(0, 10)
            .map(t => `${dataIt(tempo(t.created_at))} ${euro((Number(t.amount_cents) || 0) / 100)} — ${testo(t.description) || testo(t.customer_email) || 'senza descrizione'}`)
            .join(' · ') + (righe.length > 10 ? ` · …e altri ${righe.length - 10}` : '') + '. Collegarli dalla tab Nexi.',
    }]
}

/** Documento fiscale senza pratica: non e' ne' di una prenotazione ne' di una ricarica wallet. */
const fatt_documento_senza_pratica: Detector = (cfg, ctx) => {
    const ms = sogliaMs(cfg)
    const righe = lista(ctx, K_FATTURE)
        .filter(f => !f.booking_id && !testo(f.note).startsWith('wallet_purchase:') && testo(f.stato).toLowerCase() !== 'cancelled')
        .filter(f => passatoDa(tempo(f.created_at), ctx.now, ms) && !passatoDa(tempo(f.created_at), ctx.now, GIORNI_FATTURE * GIORNO))
        .map(f => ({ f, motivo: isNotaCredito(f) ? 'nota di credito non collegata a una prenotazione' : 'fattura non collegata a una prenotazione' }))
    return hitsDaFatture(righe, 'senza prenotazione né ricarica wallet')
}

export const DETECTORS_DOCUMENTI_FATTURE: Record<string, Detector> = {
    doc_x_anzianita_patente,
    doc_x_eta_conducente,
    doc_x_pratica_da_confermare,
    doc_x_dati_incompleti,
    doc_x_documento_rifiutato,
    doc_x_verifica_in_sospeso,
    doc_x_lato_mancante,
    doc_x_secondo_conducente,
    doc_x_patente_scaduta,
    doc_x_patente_in_scadenza,
    fatt_scartata_sdi,
    fatt_bozza_bloccata,
    fatt_cf_non_valido,
    fatt_dato_azienda,
    fatt_senza_pagamento,
    fatt_senza_fattura,
    fatt_extra_senza_fattura,
    fatt_incasso_senza_pratica,
    fatt_documento_senza_pratica,
}

// ─── Lettura dei dati ────────────────────────────────────────────────────────

async function aBlocchi<T>(ids: string[], leggi: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    const blocchi: string[][] = []
    for (let i = 0; i < ids.length; i += 200) blocchi.push(ids.slice(i, i + 200))
    const risposte = await Promise.all(blocchi.map(async c => {
        const { data, error } = await leggi(c)
        if (error) throw error
        return (data || []) as T[]
    }))
    return risposte.flat()
}

const COLONNE_CLIENTE = [
    'id', 'user_id', 'tipo_cliente', 'nome', 'cognome', 'codice_fiscale', 'telefono',
    'data_nascita', 'luogo_nascita', 'sesso', 'patente', 'numero_patente', 'emessa_da',
    'data_rilascio_patente', 'scadenza_patente', 'indirizzo', 'citta_residenza', 'citta',
    'provincia_residenza', 'provincia', 'codice_postale', 'cap', 'sede_legale', 'sede_operativa',
    'denominazione', 'ragione_sociale', 'partita_iva', 'codice_destinatario', 'pec',
    'meta_patente:metadata->patente', 'meta_sesso:metadata->>sesso',
    'meta_pat_scad:metadata->>patente_scadenza', 'meta_pat_ril:metadata->>patente_data_rilascio',
].join(', ')

const COLONNE_FATTURA = 'id, numero_fattura, booking_id, tipo_fattura, stato, sdi_status, sdi_sent_at, created_at, ' +
    'related_invoice_id, customer_name, customer_tax_code, customer_vat, importo_totale, note, ' +
    'auto_send_error:sdi_response->>auto_send_error'

async function carica(now: Date): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - GIORNI_FINESTRA * GIORNO).toISOString()
    const a = new Date(now.getTime() + GIORNI_FINESTRA * GIORNO).toISOString()
    const daFatture = new Date(now.getTime() - GIORNI_FATTURE * GIORNO).toISOString()

    // 1. Prenotazioni della finestra del motore, solo i collegamenti.
    const { data: prenRaw, error: errPren } = await supabase
        .from('bookings')
        .select('id, user_id, cid:booking_details->customer->>customerId, sd:booking_details->second_driver->>customer_id')
        .or(
            `and(pickup_date.lte.${a},dropoff_date.gte.${da}),` +
            `and(pickup_date.gte.${da},pickup_date.lte.${a}),` +
            `and(appointment_date.gte.${da},appointment_date.lte.${a})`,
        )
        .range(0, 2999)
    if (errPren) throw errPren
    const pren = (prenRaw || []) as Riga[]
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const idClienti = [...new Set(pren.flatMap(p => [p.cid, p.sd]).map(testo).filter(v => uuid.test(v)))]
    const idUtenti = [...new Set(pren.map(p => testo(p.user_id)).filter(v => uuid.test(v)))]
    const idPren = pren.map(p => String(p.id))

    const [perId, perUtente, fattureFinestra, fattureRecenti, fattureAperte, metodi, incassi] = await Promise.all([
        aBlocchi<Riga>(idClienti, c => supabase.from('customers_extended').select(COLONNE_CLIENTE).in('id', c)),
        aBlocchi<Riga>(idUtenti, c => supabase.from('customers_extended').select(COLONNE_CLIENTE).in('user_id', c)),
        aBlocchi<Riga>(idPren, c => supabase.from('fatture').select(COLONNE_FATTURA).in('booking_id', c)),
        supabase.from('fatture').select(COLONNE_FATTURA).gte('created_at', daFatture).range(0, 1999)
            .then(r => { if (r.error) throw r.error; return (r.data || []) as Riga[] }),
        // Non ancora accettate dallo SdI, di qualunque data: sono problemi vivi.
        supabase.from('fatture').select(COLONNE_FATTURA)
            .or('sdi_status.is.null,sdi_status.in.(draft,error,rejected,scartata)').range(0, 999)
            .then(r => { if (r.error) throw r.error; return (r.data || []) as Riga[] }),
        supabase.from('centralina_pro_config').select('id, pm:config->fiscal->payment_methods')
            .then(r => { if (r.error) throw r.error; return (r.data || []) as Riga[] }),
        supabase.from('nexi_transactions')
            .select('id, created_at, amount_cents, status, booking_id, description, customer_email, cauzione_id:metadata->>cauzione_id')
            .eq('status', 'completed').is('booking_id', null).gte('created_at', da).range(0, 999)
            .then(r => { if (r.error) throw r.error; return (r.data || []) as Riga[] }),
    ])

    const clienti = new Map<string, Riga>()
    for (const c of [...perId, ...perUtente]) clienti.set(String(c.id), c)

    const fatture = new Map<string, Riga>()
    for (const f of [...fattureFinestra, ...fattureRecenti, ...fattureAperte]) fatture.set(String(f.id), f)
    // Le note di credito si cercano anche per fattura originale: una NC
    // emessa su una fattura vecchia deve togliere quella fattura dai conti.
    const idFatture = [...fatture.keys()]
    const noteCredito = await aBlocchi<Riga>(idFatture, c => supabase.from('fatture').select(COLONNE_FATTURA).in('related_invoice_id', c))
    for (const f of noteCredito) fatture.set(String(f.id), f)

    const idsDoc = [...clienti.keys()]
    const idsSecondi = pren.map(p => testo(p.sd)).filter(v => uuid.test(v))
    const idsUtentiTutti = [...new Set([...idUtenti, ...[...clienti.values()].map(c => testo(c.user_id)).filter(v => uuid.test(v))])]
    const idPrenFatture = [...new Set([...fatture.values()].map(f => testo(f.booking_id)).filter(Boolean))]

    const [documenti, documentiSito, prenFatture] = await Promise.all([
        aBlocchi<Riga>([...new Set([...idsDoc, ...idsSecondi])], c => supabase.from('customer_documents').select('customer_id, document_type').in('customer_id', c)),
        aBlocchi<Riga>(idsUtentiTutti, c => supabase.from('user_documents').select('user_id, document_type, status, rejection_reason, created_at').in('user_id', c)),
        aBlocchi<Riga>(idPrenFatture, c => supabase.from('bookings')
            .select('id, status, payment_status, amount_paid, penalties:booking_details->penalties, danni:booking_details->danni, extension_history:booking_details->extension_history')
            .in('id', c)),
    ])

    return {
        [K_CLIENTI]: [...clienti.values()],
        [K_DOCUMENTI]: documenti,
        [K_DOCUMENTI_SITO]: documentiSito,
        [K_FATTURE]: [...fatture.values()],
        // booking_details ricomposto con le sole liste che servono.
        [K_PRENOTAZIONI_FATTURE]: prenFatture.map(b => ({
            ...b,
            booking_details: { penalties: b.penalties, danni: b.danni, extension_history: b.extension_history },
        })),
        [K_METODI]: metodi,
        [K_INCASSI]: incassi,
    }
}

export const moduloDocumentiFatture: ModuloAllarmi = {
    nome: 'documentiFatture',
    detectors: DETECTORS_DOCUMENTI_FATTURE,
    carica,
}
