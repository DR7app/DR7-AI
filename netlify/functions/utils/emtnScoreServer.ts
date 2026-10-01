/**
 * EMTN Score lato server: dalle righe del database agli EventoNormalizzato
 * (fase 1), lettura degli override della direzione e storico dei ricalcoli.
 * Il calcolo vero e' in src/utils/emtnScore/motore.ts.
 *
 * 01/10/2026: regola sulle fonti. I fatti critici (furto, frode,
 * mancata restituzione, recupero del veicolo) fanno scattare un flag SOLO
 * se vengono da una pratica EMTN pubblicata o da un emtn_events APPROVED,
 * oppure da un override motivato della direzione. Un nome di voce DR7 come
 * "Furto" o "chiavi non restituite" resta un danno/violazione: puo' essere
 * il furto subito dal cliente, non commesso.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
    classificaVoce, famigliaCodiceEMTN, giorniTra, ORDINE_FAMIGLIA, statoDaImporti,
    type EventoNormalizzato, type Famiglia, type NoleggioNormalizzato, type StatoPagamentoEvento,
} from '../../../src/utils/emtnScore/normalizza'
import { VERSIONE_ALGORITMO, type OverrideScore, type RisultatoEMTNScore } from '../../../src/utils/emtnScore/motore'

const CRITICHE_SOLO_DA_EMTN = new Set<Famiglia>(['furto', 'frode', 'falsificazione', 'mancata_restituzione', 'recupero_veicolo'])

/** Famiglia di una voce scritta da un operatore DR7: mai un flag critico. */
function famigliaVoceInterna(label: string, predefinita: Famiglia): { famiglia: Famiglia; grave: boolean } {
    const f = classificaVoce(label, predefinita)
    if (!CRITICHE_SOLO_DA_EMTN.has(f)) return { famiglia: f, grave: false }
    return f === 'furto' ? { famiglia: 'danno', grave: true } : { famiglia: 'violazione_contratto', grave: false }
}

const num = (v: unknown): number => {
    const n = Number(String(v ?? '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
}

export interface VoceDr7 {
    bookingId: string
    date?: string | null
    label: string
    amount: number
    residuo: number
    stato: StatoPagamentoEvento
    contesto?: {
        paidAt?: string | null
        dichiaratoDalCliente?: boolean | null
        responsabilita?: string | null
        gravita?: string | null
    }
}

export function eventiDaVociDr7(voci: VoceDr7[], tipo: 'danno' | 'penale', prezzoPerBooking: Map<string, number | null>): EventoNormalizzato[] {
    const visti = new Map<string, number>()
    return voci.map(v => {
        const { famiglia, grave } = famigliaVoceInterna(v.label, tipo)
        const resp = String(v.contesto?.responsabilita || '').toLowerCase()
        const grav = String(v.contesto?.gravita || '').toLowerCase()
        const importo = Math.max(0, num(v.amount))
        return {
            // id stabile tra un calcolo e l'altro (storico: "nuovi eventi").
            id: (() => {
                const k = `${tipo}:${v.bookingId}:${v.label.toLowerCase().trim()}:${importo.toFixed(2)}`
                const n = visti.get(k) || 0
                visti.set(k, n + 1)
                return n ? `${k}#${n}` : k
            })(),
            fonte: 'dr7_prenotazione',
            famiglia,
            label: v.label,
            data: v.date || null,
            importo,
            pagato: Math.max(0, importo - num(v.residuo)),
            residuo: Math.max(0, num(v.residuo)),
            statoPagamento: v.stato,
            giorniAlSaldo: v.stato === 'pagato' ? giorniTra(v.date, v.contesto?.paidAt) : null,
            verificato: true,
            inRevisione: false,
            dichiaratoDalCliente: typeof v.contesto?.dichiaratoDalCliente === 'boolean' ? v.contesto.dichiaratoDalCliente : null,
            responsabilita: resp === 'accertata' || resp === 'contestata' || resp === 'non_attribuibile' ? resp : null,
            gravitaIndicata: grave ? 'grave' : grav === 'lieve' || grav === 'media' || grav === 'grave' ? grav : null,
            contestazione: resp === 'contestata' ? 'aperta' : null,
            prezzoGiornoVeicolo: prezzoPerBooking.get(v.bookingId) ?? null,
            bookingId: v.bookingId || null,
        }
    })
}

export interface EventoReteRow {
    tipo: 'danno' | 'penale' | 'insoluto'
    voce: string | null
    importo: number
    pagato: number
    residuo: number
    statoPagamento: 'paid' | 'partial' | 'pending'
    dataEvento: string | null
    giorniAlSaldo: number | null
}

export function eventiDaRete(rete: EventoReteRow[]): EventoNormalizzato[] {
    return rete.map((r, i) => {
        const { famiglia } = famigliaVoceInterna(r.voce || r.tipo, r.tipo)
        const stato: StatoPagamentoEvento = r.statoPagamento === 'paid' ? 'pagato' : r.statoPagamento === 'partial' ? 'parziale' : 'aperto'
        return {
            // id stabile (non la posizione nella lista): voce, data, importo.
            id: `rete:${(r.voce || r.tipo).toLowerCase().trim()}:${r.dataEvento || ''}:${num(r.importo).toFixed(2)}:${i}`,
            fonte: 'rete', famiglia, label: r.voce || r.tipo, data: r.dataEvento,
            importo: num(r.importo), pagato: num(r.pagato), residuo: num(r.residuo), statoPagamento: stato,
            giorniAlSaldo: r.giorniAlSaldo, verificato: true, inRevisione: false, dichiaratoDalCliente: null,
            responsabilita: null, gravitaIndicata: null, contestazione: null, prezzoGiornoVeicolo: null, bookingId: null,
        }
    })
}

export interface MultaRow { id: string; booking_id: string | null; data_infrazione: string | null; importo: string | null }

export function eventiDaMulte(multe: MultaRow[]): EventoNormalizzato[] {
    return multe.map(m => {
        // data_infrazione e' testo: dd/mm/yyyy o ISO.
        const d = String(m.data_infrazione || '')
        const it = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        const data = it ? `${it[3]}-${it[2]}-${it[1]}` : /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null
        return {
            id: `multa:${m.id}`, fonte: 'multa', famiglia: 'multa', label: 'Multa', data,
            // La multa la paga il conducente all'ente: per DR7 nessuna esposizione.
            importo: num(m.importo), pagato: 0, residuo: 0, statoPagamento: 'non_applicabile',
            giorniAlSaldo: null, verificato: true, inRevisione: false, dichiaratoDalCliente: null,
            responsabilita: null, gravitaIndicata: null, contestazione: null, prezzoGiornoVeicolo: null,
            bookingId: m.booking_id,
        }
    })
}

export interface EmtnEventRow { id: string; type: string; status: string; headline?: string | null; occurred_at?: string | null; created_at: string }

export function eventiDaEmtnEvents(rows: EmtnEventRow[]): EventoNormalizzato[] {
    const out: EventoNormalizzato[] = []
    for (const r of rows) {
        if (r.status !== 'APPROVED' && r.status !== 'UNDER_REVIEW') continue
        const approvato = r.status === 'APPROVED'
        const famiglia: Famiglia = r.type === 'THEFT_REPORTED' ? 'furto'
            : r.type === 'NON_RETURN' ? 'mancata_restituzione'
            : r.type === 'UNPAID_DAMAGE' ? 'danno'
            : r.type === 'INSOLVENCY' ? 'insoluto'
            : 'violazione_contratto'
        const aperto = r.type === 'UNPAID_DAMAGE' || r.type === 'INSOLVENCY'
        out.push({
            id: `evento:${r.id}`, fonte: 'emtn_evento', famiglia, label: r.headline || famiglia,
            data: r.occurred_at || r.created_at, importo: 0, pagato: 0, residuo: 0,
            statoPagamento: aperto ? 'aperto' : 'non_applicabile', giorniAlSaldo: null,
            verificato: approvato, inRevisione: !approvato, dichiaratoDalCliente: null, responsabilita: null,
            gravitaIndicata: aperto ? 'grave' : null, contestazione: null, prezzoGiornoVeicolo: null, bookingId: null,
            accertato: approvato && famiglia === 'furto',
        })
    }
    return out
}

export interface PosizioneRow {
    id: string
    stato?: string | null
    eventi?: Array<{ codice: number; dati?: Record<string, unknown> }> | null
    in_approvazione?: boolean | null
    pubblicata?: boolean | null
    titolo?: string | null
    approvata_at?: string | null
    booking_id?: string | null
    created_at: string
}

/**
 * Una pratica = un evento, con la famiglia piu' grave tra i suoi codici.
 * Pubblicata = verificata; in approvazione = in revisione (non pesa).
 * La pratica porta la prenotazione (booking_id): il motore la unisce alle
 * voci DR7 dello stesso noleggio in un solo incidente (raggruppaIncidenti).
 * Senza booking_id, una voce DR7 con lo stesso importo indica lo stesso fatto.
 */
export function eventiDaPosizioni(rows: PosizioneRow[], vociInterne: Array<{ bookingId: string; amount: number }>): EventoNormalizzato[] {
    const out: EventoNormalizzato[] = []
    for (const p of rows) {
        if (!p.pubblicata && !p.in_approvazione) continue
        const stato = String(p.stato || '').toUpperCase()
        if (stato === 'ANNULLATO') continue
        const eventi = Array.isArray(p.eventi) ? p.eventi : []
        const codici = eventi.map(e => Number(e.codice)).filter(Number.isFinite)
        const famiglie: Famiglia[] = codici.map(famigliaCodiceEMTN).filter(f => f !== 'regolarizzazione')
        if (famiglie.length === 0) continue
        const famiglia = ORDINE_FAMIGLIA.find(f => famiglie.includes(f)) || famiglie[0]
        let importo = 0, pagato = 0, residuo = 0
        let data: string | null = null
        let pagatoIl: string | null = null
        let contestazione: EventoNormalizzato['contestazione'] = null
        let dichiarato: boolean | null = null
        let responsabilita: EventoNormalizzato['responsabilita'] = null
        // I codici di una pratica descrivono lo STESSO fatto da piu' lati
        // (danno documentato, preventivo, accordo, regolarizzazione): gli
        // importi non si sommano, vale il maggiore.
        let residuoEsplicito: number | null = null
        for (const e of eventi) {
            const d = e.dati || {}
            importo = Math.max(importo, num(d.importo_dovuto ?? d.importo_richiesto))
            pagato = Math.max(pagato, num(d.importo_pagato))
            if (d.importo_residuo != null && d.importo_residuo !== '') {
                residuoEsplicito = residuoEsplicito == null ? num(d.importo_residuo) : Math.min(residuoEsplicito, num(d.importo_residuo))
            }
            if (!data && typeof d.data_evento === 'string') data = d.data_evento
            if (!pagatoIl && typeof d.data_pagamento === 'string') pagatoIl = d.data_pagamento
            // Ricavati dall'analisi AI dei documenti e confermati dall'operatore.
            const com = String(d.comunicazione_cliente || '').toUpperCase()
            if (com === 'SPONTANEA' && dichiarato == null) dichiarato = true
            if (com === 'OMESSA') dichiarato = false
            const resp = String(d.responsabilita || '').toUpperCase()
            if (resp === 'NON_ATTRIBUIBILE') responsabilita = 'non_attribuibile'
            else if (resp === 'ACCERTATA' && responsabilita !== 'non_attribuibile') responsabilita = 'accertata'
            else if (resp === 'CONTESTATA' && !responsabilita) responsabilita = 'contestata'
            const sc = String(d.stato_contestazione || '').toUpperCase()
            if (sc === 'RESPINTO') contestazione = 'respinta'
            else if (sc === 'ACCOLTO' && contestazione !== 'respinta') contestazione = 'accolta'
            else if ((sc === 'APERTO' || [14, 15, 16, 17, 18, 36, 57].includes(Number(e.codice))) && !contestazione) contestazione = 'aperta'
        }
        const regolarizzata = stato === 'REGOLARIZZATO' || stato === 'CHIUSO' || codici.some(c => c === 24 || c === 26 || c === 58)
        residuo = residuoEsplicito ?? Math.max(0, importo - pagato)
        const statoPagamento: StatoPagamentoEvento = regolarizzata ? 'pagato'
            : importo > 0 || residuo > 0 ? statoDaImporti(Math.max(importo, residuo), pagato) : 'non_applicabile'
        const bookingId = p.booking_id
            || (importo > 0 ? vociInterne.find(v => Math.abs(v.amount - importo) < 1)?.bookingId : null)
            || null
        out.push({
            id: `pratica:${p.id}`, fonte: 'emtn_pratica', famiglia, label: p.titolo || famiglia,
            data: data || p.approvata_at || p.created_at,
            importo, pagato, residuo: statoPagamento === 'pagato' ? 0 : residuo, statoPagamento,
            giorniAlSaldo: statoPagamento === 'pagato' ? giorniTra(data, pagatoIl) : null,
            verificato: !!p.pubblicata, inRevisione: !p.pubblicata && !!p.in_approvazione,
            dichiaratoDalCliente: dichiarato, responsabilita, gravitaIndicata: null,
            contestazione: contestazione || (responsabilita === 'contestata' ? 'aperta' : null),
            prezzoGiornoVeicolo: null, bookingId,
            veicoloRestituito: codici.includes(40),
        })
    }
    return out
}

/* ---------- noleggi ---------- */

const SERVIZI_NON_NOLEGGIO = new Set(['car_wash', 'mechanical_service', 'uscita_straordinaria'])
const STATI_ANNULLATI = new Set(['cancelled', 'annullata', 'deleted', 'rejected', 'refunded'])

export interface BookingPerScore {
    id: string
    pickup_date?: string | null
    dropoff_date?: string | null
    appointment_date?: string | null
    status?: string | null
    service_type?: string | null
    vehicle_name?: string | null
    vehicle_plate?: string | null
    vehicle_id?: string | null
}

/** Solo noleggi veri: niente lavaggi/meccanica, annullati o veicoli TEST. */
export function eNoleggio(b: BookingPerScore): boolean {
    if (SERVIZI_NON_NOLEGGIO.has(String(b.service_type || '').toLowerCase())) return false
    if (STATI_ANNULLATI.has(String(b.status || '').toLowerCase())) return false
    if (/^test/i.test(String(b.vehicle_plate || '').trim()) || String(b.vehicle_name || '').trim().toLowerCase() === 'test') return false
    return true
}

export function noleggiNormalizzati(bookings: BookingPerScore[], conProblemi: Set<string>, prezzi: Map<string, number | null>, oggi = new Date()): NoleggioNormalizzato[] {
    return bookings.filter(eNoleggio).map(b => {
        const fine = b.dropoff_date || b.pickup_date || b.appointment_date || null
        const st = String(b.status || '').toLowerCase()
        const concluso = st !== 'pending' && !!fine && Date.parse(fine) < oggi.getTime()
        return {
            id: b.id,
            data: fine,
            concluso,
            regolare: concluso && !conProblemi.has(b.id),
            prezzoGiorno: prezzi.get(b.id) ?? null,
        }
    })
}

/* ---------- override e storico ---------- */

export async function leggiOverride(sb: SupabaseClient, clientId: string): Promise<(OverrideScore & { id: string }) | null> {
    try {
        const { data, error } = await sb
            .from('emtn_score_override')
            .select('id, tipo, valore, motivo, operatore_email, created_at, scade_il')
            .eq('client_id', clientId)
            .eq('attivo', true)
            .order('created_at', { ascending: false })
            .limit(5)
        if (error || !data) return null
        const ora = Date.now()
        const r = data.find(o => !o.scade_il || Date.parse(o.scade_il) > ora)
        if (!r) return null
        return { id: r.id, tipo: r.tipo, valore: r.valore, motivo: r.motivo, operatore: r.operatore_email, creato_il: r.created_at }
    } catch {
        // Migrazione 20261001 non ancora applicata: si calcola senza override.
        return null
    }
}

export interface RigaStorico {
    score_precedente: number | null
    score: number
    score_calcolato: number
    confidence: number
    livello: string
    trend: string
    causa: string
    versione: string
    created_at: string
    operatore_email: string | null
}

/**
 * Salva una riga solo se qualcosa e' cambiato (score, confidence, livello,
 * flag, versione o override). Ritorna le ultime righe per la scheda.
 * Senza la tabella (migrazione mancante) non blocca la ricerca.
 */
export async function registraStorico(
    sb: SupabaseClient,
    clientId: string,
    r: RisultatoEMTNScore,
    overrideId: string | null,
    operatoreEmail: string | null,
): Promise<RigaStorico[]> {
    try {
        const { data: ultime, error } = await sb
            .from('emtn_score_storico')
            .select('score_precedente, score, score_calcolato, confidence, livello, trend, causa, versione, created_at, operatore_email, flag, fattori, override_id')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false })
            .limit(10)
        if (error) return []
        const prec = ultime?.[0] as (RigaStorico & { flag: unknown; fattori: { contributi?: Array<{ id: string }>; noleggiConclusi?: number }; override_id: string | null }) | undefined
        const flagOra = r.flag.map(f => f.codice).sort().join(',')
        const flagPrima = Array.isArray(prec?.flag) ? (prec!.flag as Array<{ codice: string }>).map(f => f.codice).sort().join(',') : ''
        const cambiato = !prec || prec.score !== r.score || prec.score_calcolato !== r.scoreCalcolato || prec.confidence !== r.confidence || prec.livello !== r.livello
            || prec.versione !== r.versione || flagOra !== flagPrima || (prec.override_id || null) !== overrideId
        // Alla scheda vanno solo i campi mostrati (non fattori/flag completi).
        const perScheda = (righe: unknown[]): RigaStorico[] => righe.filter(Boolean).map(x => {
            const { score_precedente, score, score_calcolato, confidence, livello, trend, causa, versione, created_at, operatore_email } = x as RigaStorico
            return { score_precedente, score, score_calcolato, confidence, livello, trend, causa, versione, created_at, operatore_email }
        })
        if (!cambiato) return perScheda(ultime || [])

        // Causa: cosa e' cambiato rispetto al calcolo precedente.
        const cause: string[] = []
        if (!prec) cause.push('Primo calcolo')
        else {
            if (prec.versione !== r.versione) cause.push(`Nuova versione algoritmo (${prec.versione} -> ${r.versione})`)
            const idPrima = new Set((prec.fattori?.contributi || []).map(c => c.id))
            const idOra = r.dettaglio.contributi.map(c => c.id)
            const nuovi = r.dettaglio.contributi.filter(c => !idPrima.has(c.id))
            const tolti = [...idPrima].filter(id => !idOra.includes(id))
            if (nuovi.length) cause.push(`Nuovi eventi: ${nuovi.slice(0, 3).map(c => c.label).join(', ')}`)
            if (tolti.length) cause.push(`${tolti.length} eventi non piu' considerati (regolarizzati/annullati)`)
            const nPrima = prec.fattori?.noleggiConclusi ?? null
            if (nPrima != null && r.dettaglio.noleggiConclusi > nPrima) cause.push(`${r.dettaglio.noleggiConclusi - nPrima} nuovi noleggi conclusi`)
            if ((prec.override_id || null) !== overrideId) cause.push(overrideId ? 'Intervento manuale della direzione' : 'Intervento manuale revocato o scaduto')
            if (flagOra !== flagPrima) cause.push('Flag critici cambiati')
            if (!cause.length) cause.push('Passare del tempo (attenuazione eventi / stato pagamenti)')
        }
        const riga = {
            client_id: clientId,
            score_precedente: prec ? prec.score : null,
            score: r.score,
            score_calcolato: r.scoreCalcolato,
            confidence: r.confidence,
            livello: r.livello,
            trend: r.trend,
            flag: r.flag,
            fattori: { positivi: r.positivi, rischi: r.rischi, spiegazione: r.spiegazione, ...r.dettaglio },
            causa: cause.join('; '),
            versione: VERSIONE_ALGORITMO,
            override_id: overrideId,
            operatore_email: operatoreEmail,
        }
        const { data: nuova } = await sb.from('emtn_score_storico').insert(riga)
            .select('score_precedente, score, score_calcolato, confidence, livello, trend, causa, versione, created_at, operatore_email')
            .maybeSingle()
        return perScheda([nuova, ...(ultime || [])]).slice(0, 10)
    } catch {
        return []
    }
}
