/**
 * EMTN Score lato server: dalle righe del database agli EventoNormalizzato
 * (fase 1), lettura degli override della direzione e storico dei ricalcoli.
 * Il calcolo vero e' in src/utils/emtnScore/motore.ts, i punti in regole.ts.
 *
 * 01/10/2026: regola sulle fonti. I fatti critici (furto, frode) fanno
 * scattare il blocco SOLO se vengono da un emtn_events APPROVED o da un
 * override motivato della direzione. Un nome di voce DR7 come "Furto" resta
 * un danno: puo' essere il furto subito dal cliente, non commesso.
 *
 * 05/10/2026: ogni fonte porta la categoria delle regole fisse della
 * direzione. Le pratiche EMTN usano la categoria proposta dall'AI
 * (categoria_score) e confermata dall'operatore; senza, il codice EMTN.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
    categoriaCodiceEMTN, classificaVoce, dataIso, minutiDaTesto, minutiTra, statoDaImporti,
    type EventoNormalizzato, type NoleggioNormalizzato, type StatoPagamentoEvento,
} from '../../../src/utils/emtnScore/normalizza'
import { VERSIONE_ALGORITMO, type OverrideScore, type RisultatoEMTNScore } from '../../../src/utils/emtnScore/motore'
import { categoriaScoreValida, type CategoriaScore } from '../../../src/utils/emtnScore/regole'

const num = (v: unknown): number => {
    const n = Number(String(v ?? '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
}
const PAGATO = new Set(['paid', 'completed', 'succeeded'])

export interface VoceDr7 {
    bookingId: string
    date?: string | null
    label: string
    amount: number
    quantity?: number
    residuo: number
    stato: StatoPagamentoEvento
    contesto?: {
        paidAt?: string | null
        scadenza?: string | null
        dichiaratoDalCliente?: boolean | null
        responsabilita?: string | null
        gravita?: string | null
    }
}

export function eventiDaVociDr7(voci: VoceDr7[], tipo: 'danno' | 'penale', contratti: Map<string, string>): EventoNormalizzato[] {
    const visti = new Map<string, number>()
    return voci.map(v => {
        const { categoria, fermo } = classificaVoce(v.label, tipo)
        const resp = String(v.contesto?.responsabilita || '').toLowerCase()
        const importo = Math.max(0, num(v.amount))
        // id stabile tra un calcolo e l'altro (storico: "nuovi eventi").
        const k = `${tipo}:${v.bookingId}:${v.label.toLowerCase().trim()}:${importo.toFixed(2)}`
        const n = visti.get(k) || 0
        visti.set(k, n + 1)
        return {
            id: n ? `${k}#${n}` : k,
            fonte: 'dr7_prenotazione',
            categoria,
            fermo,
            label: v.label,
            data: dataIso(v.date),
            bookingId: v.bookingId || null,
            contratto: contratti.get(v.bookingId) || null,
            importo,
            pagato: Math.max(0, importo - num(v.residuo)),
            residuo: Math.max(0, num(v.residuo)),
            statoPagamento: v.stato,
            // Le voci del gestionale non hanno una scadenza: nessun ritardo
            // di pagamento ne' insoluto inventati.
            scadenza: dataIso(v.contesto?.scadenza) || null,
            dataSaldo: v.stato === 'pagato' ? dataIso(v.contesto?.paidAt) : null,
            minutiRitardo: categoria === 'ritardo_riconsegna' ? minutiDaTesto(v.label, v.quantity) : null,
            verificato: true,
            inRevisione: false,
            dichiaratoDalCliente: typeof v.contesto?.dichiaratoDalCliente === 'boolean' ? v.contesto.dichiaratoDalCliente : null,
            responsabilita: resp === 'accertata' || resp === 'contestata' || resp === 'non_attribuibile' ? resp : null,
            contestazione: resp === 'contestata' ? 'aperta' : null,
            prove: [`Gestionale DR7: ${tipo === 'danno' ? 'danno' : 'penale'} "${v.label}"`],
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
        const categoria: CategoriaScore = r.tipo === 'insoluto' ? 'insoluto' : classificaVoce(r.voce || r.tipo, r.tipo === 'danno' ? 'danno' : 'penale').categoria
        const stato: StatoPagamentoEvento = r.statoPagamento === 'paid' ? 'pagato' : r.statoPagamento === 'partial' ? 'parziale' : 'aperto'
        const data = dataIso(r.dataEvento)
        const t = data ? Date.parse(data) : NaN
        return {
            // id stabile (non la posizione nella lista): voce, data, importo.
            id: `rete:${(r.voce || r.tipo).toLowerCase().trim()}:${r.dataEvento || ''}:${num(r.importo).toFixed(2)}:${i}`,
            fonte: 'rete', categoria, label: r.voce || r.tipo, data, bookingId: null, contratto: null,
            importo: num(r.importo), pagato: num(r.pagato), residuo: num(r.residuo), statoPagamento: stato,
            scadenza: null,
            dataSaldo: stato === 'pagato' && r.giorniAlSaldo != null && Number.isFinite(t) ? new Date(t + r.giorniAlSaldo * 86_400_000).toISOString().slice(0, 10) : null,
            minutiRitardo: categoria === 'ritardo_riconsegna' ? minutiDaTesto(r.voce || '') : null,
            verificato: true, inRevisione: false, dichiaratoDalCliente: null, responsabilita: null, contestazione: null,
            prove: ['Storico della rete EMTN (altro operatore)'],
        }
    })
}

export interface MultaRow { id: string; booking_id: string | null; data_infrazione: string | null; importo: string | null; numero_verbale?: string | null }

/**
 * Un verbale = una detrazione, non ogni notifica: multe_pec_log ha una riga
 * per invio PEC (05/10/2026: 10 righe per 6 verbali), si unisce per numero.
 */
export function eventiDaMulte(multe: MultaRow[], contratti: Map<string, string>): EventoNormalizzato[] {
    const perVerbale = new Map<string, MultaRow>()
    for (const m of multe) {
        const k = String(m.numero_verbale || '').trim().toUpperCase() || m.id
        if (!perVerbale.has(k)) perVerbale.set(k, m)
    }
    return [...perVerbale.entries()].map(([k, m]) => ({
        id: `multa:${k}`, fonte: 'multa', categoria: 'multa', label: 'Multa', data: dataIso(m.data_infrazione),
        bookingId: m.booking_id, contratto: m.booking_id ? contratti.get(m.booking_id) || null : null,
        // La multa la paga il conducente all'ente: per DR7 nessuna esposizione.
        importo: num(m.importo), pagato: 0, residuo: 0, statoPagamento: 'non_applicabile',
        scadenza: null, dataSaldo: null, minutiRitardo: null,
        verificato: true, inRevisione: false, dichiaratoDalCliente: null, responsabilita: null, contestazione: null,
        prove: [`Registro multe: verbale ${m.numero_verbale || 'senza numero'} rinotificato al conducente`],
    }))
}

export interface EmtnEventRow { id: string; type: string; status: string; headline?: string | null; occurred_at?: string | null; created_at: string; booking_id?: string | null }

export function eventiDaEmtnEvents(rows: EmtnEventRow[]): EventoNormalizzato[] {
    const out: EventoNormalizzato[] = []
    for (const r of rows) {
        if (r.status !== 'APPROVED' && r.status !== 'UNDER_REVIEW') continue
        const approvato = r.status === 'APPROVED'
        const categoria: CategoriaScore = r.type === 'THEFT_REPORTED' ? 'furto'
            : r.type === 'NON_RETURN' ? 'ritardo_riconsegna'
            : r.type === 'UNPAID_DAMAGE' ? 'danno'
            : r.type === 'INSOLVENCY' ? 'insoluto'
            : 'non_previsto'
        const aperto = r.type === 'UNPAID_DAMAGE' || r.type === 'INSOLVENCY'
        out.push({
            id: `evento:${r.id}`, fonte: 'emtn_evento', categoria, label: r.headline || categoria,
            data: r.occurred_at || r.created_at,
            // Con la prenotazione si unisce alle voci DR7 dello stesso noleggio:
            // un UNPAID_DAMAGE gia' saldato in gestionale non resta aperto.
            bookingId: r.booking_id || null, contratto: null,
            importo: 0, pagato: 0, residuo: 0,
            statoPagamento: aperto ? 'aperto' : 'non_applicabile',
            scadenza: null, dataSaldo: null,
            // Mancata restituzione approvata dalla direzione: oltre 24 ore.
            minutiRitardo: r.type === 'NON_RETURN' ? 24 * 60 + 1 : null,
            verificato: approvato, inRevisione: !approvato, dichiaratoDalCliente: null, responsabilita: null, contestazione: null,
            accertato: approvato && categoria === 'furto',
            prove: [`Segnalazione EMTN ${approvato ? 'approvata' : 'in revisione'}: ${r.headline || r.type}`],
        })
    }
    return out
}

export interface PosizioneRow {
    id: string
    stato?: string | null
    eventi?: Array<{ codice: number; dati?: Record<string, unknown>; fonti?: string[] }> | null
    in_approvazione?: boolean | null
    pubblicata?: boolean | null
    titolo?: string | null
    approvata_at?: string | null
    booking_id?: string | null
    created_at: string
}

/**
 * Ogni evento di una pratica e' un fatto con la sua categoria; i fatti della
 * stessa pratica restano legati (gruppo = id pratica) e, con la prenotazione,
 * si uniscono alle voci DR7 dello stesso noleggio. Pubblicata = verificata;
 * in approvazione = in revisione (non pesa).
 * Senza booking_id, una voce DR7 con lo stesso importo indica lo stesso fatto.
 */
export function eventiDaPosizioni(rows: PosizioneRow[], vociInterne: Array<{ bookingId: string; amount: number }>, contratti: Map<string, string>): EventoNormalizzato[] {
    const out: EventoNormalizzato[] = []
    const sommaPerNoleggio = new Map<string, number>()
    for (const v of vociInterne) sommaPerNoleggio.set(v.bookingId, (sommaPerNoleggio.get(v.bookingId) || 0) + v.amount)
    for (const p of rows) {
        if (!p.pubblicata && !p.in_approvazione) continue
        const stato = String(p.stato || '').toUpperCase()
        if (stato === 'ANNULLATO') continue
        const eventi = Array.isArray(p.eventi) ? p.eventi : []
        const codici = eventi.map(e => Number(e.codice)).filter(Number.isFinite)
        const regolarizzata = stato === 'REGOLARIZZATO' || stato === 'CHIUSO' || codici.some(c => c === 24 || c === 26 || c === 58)
        const importoMax = Math.max(0, ...eventi.map(e => num(e.dati?.importo_dovuto ?? e.dati?.importo_richiesto)))
        // Senza booking_id: stessa cifra di una voce DR7 o della somma delle
        // voci di un noleggio (es. danno 8.129,30 + fermo 4.870,70 = 13.000).
        const bookingId = p.booking_id
            || (importoMax > 0 ? vociInterne.find(v => Math.abs(v.amount - importoMax) < 1)?.bookingId : null)
            || (importoMax > 0 ? [...sommaPerNoleggio.entries()].find(([, t]) => Math.abs(t - importoMax) < 1)?.[0] : null)
            || null
        eventi.forEach((e, i) => {
            const d = e.dati || {}
            const codice = Number(e.codice)
            // L'AI propone la categoria; l'operatore la conferma. Se manca o non
            // e' una delle regole, vale il codice EMTN.
            const proposta = String(d.categoria_score || '').trim()
            const categoria = categoriaScoreValida(proposta) ? proposta : categoriaCodiceEMTN(codice)
            const importo = num(d.importo_dovuto ?? d.importo_richiesto)
            const pagato = num(d.importo_pagato)
            const residuoEsplicito = d.importo_residuo != null && d.importo_residuo !== '' ? num(d.importo_residuo) : null
            const residuo = regolarizzata ? 0 : residuoEsplicito ?? Math.max(0, importo - pagato)
            const statoPagamento: StatoPagamentoEvento = regolarizzata ? (importo > 0 ? 'pagato' : 'non_applicabile')
                : importo > 0 || residuo > 0 ? statoDaImporti(Math.max(importo, residuo), pagato) : 'non_applicabile'
            const com = String(d.comunicazione_cliente || '').toUpperCase()
            const resp = String(d.responsabilita || '').toUpperCase()
            const sc = String(d.stato_contestazione || '').toUpperCase()
            const contestazione: EventoNormalizzato['contestazione'] = sc === 'RESPINTO' ? 'respinta' : sc === 'ACCOLTO' ? 'accolta'
                : sc === 'APERTO' ? 'aperta' : resp === 'CONTESTATA' ? 'aperta' : null
            let minuti = minutiTra(String(d.riconsegna_prevista || ''), String(d.riconsegna_effettiva || ''))
            // "Mancata restituzione alla scadenza" senza orari: oltre 24 ore.
            if (minuti == null && codice === 39) minuti = 24 * 60 + 1
            out.push({
                id: `pratica:${p.id}:${i}`, fonte: 'emtn_pratica', categoria,
                label: String(d.sottotipologia || p.titolo || categoria),
                data: dataIso(d.data_evento) || p.approvata_at || p.created_at,
                bookingId, gruppo: p.id,
                contratto: String(d.numero_contratto || '').trim() || (bookingId ? contratti.get(bookingId) || null : null),
                importo, pagato, residuo: statoPagamento === 'pagato' ? 0 : residuo, statoPagamento,
                scadenza: dataIso(d.data_scadenza),
                dataSaldo: statoPagamento === 'pagato' ? dataIso(d.data_pagamento) : null,
                minutiRitardo: categoria === 'ritardo_riconsegna' ? minuti : null,
                verificato: !!p.pubblicata, inRevisione: !p.pubblicata && !!p.in_approvazione,
                dichiaratoDalCliente: com === 'SPONTANEA' ? true : com === 'OMESSA' ? false : null,
                responsabilita: resp === 'NON_ATTRIBUIBILE' ? 'non_attribuibile' : resp === 'ACCERTATA' ? 'accertata' : resp === 'CONTESTATA' ? 'contestata' : null,
                contestazione,
                prove: [`Pratica EMTN "${p.titolo || p.id}"`, ...(Array.isArray(e.fonti) ? e.fonti.map(String) : [])],
            })
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
    payment_status?: string | null
    service_type?: string | null
    vehicle_name?: string | null
    vehicle_plate?: string | null
    vehicle_id?: string | null
    booking_details?: { extras?: unknown; parent_booking_id?: string | null } | null
}

/** Solo noleggi veri: niente lavaggi/meccanica, annullati o veicoli TEST. */
export function eNoleggio(b: BookingPerScore): boolean {
    if (SERVIZI_NON_NOLEGGIO.has(String(b.service_type || '').toLowerCase())) return false
    if (STATI_ANNULLATI.has(String(b.status || '').toLowerCase())) return false
    if (/^test/i.test(String(b.vehicle_plate || '').trim()) || String(b.vehicle_name || '').trim().toLowerCase() === 'test') return false
    return true
}

function haExtra(extras: unknown): boolean {
    if (Array.isArray(extras)) return extras.length > 0
    if (extras && typeof extras === 'object') return Object.values(extras as Record<string, unknown>).some(v => v === true || (typeof v === 'number' && v > 0))
    return false
}

/**
 * Una proroga resta nella stessa prenotazione (extension_history); una
 * prenotazione figlia (parent_booking_id) non e' un nuovo noleggio.
 */
export function noleggiNormalizzati(bookings: BookingPerScore[], contratti: Map<string, string>, oggi = new Date()): NoleggioNormalizzato[] {
    return bookings.filter(b => eNoleggio(b) && !b.booking_details?.parent_booking_id).map(b => {
        const fine = b.dropoff_date || b.pickup_date || b.appointment_date || null
        const st = String(b.status || '').toLowerCase()
        const concluso = st !== 'pending' && !!fine && Date.parse(fine) < oggi.getTime()
        return {
            id: b.id,
            contratto: contratti.get(b.id) || null,
            inizio: b.pickup_date || b.appointment_date || null,
            data: fine,
            concluso,
            saldato: PAGATO.has(String(b.payment_status || '').toLowerCase()),
            conExtra: haExtra(b.booking_details?.extras),
        }
    })
}

/** Numero di contratto DR7XXXX per prenotazione (il piu' recente). */
export async function contrattiPerBooking(sb: SupabaseClient, bookingIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (let i = 0; i < bookingIds.length; i += 100) {
        const { data } = await sb.from('contracts').select('booking_id, contract_number, created_at')
            .in('booking_id', bookingIds.slice(i, i + 100)).order('created_at', { ascending: true })
        for (const r of (data || []) as Array<{ booking_id: string; contract_number: string | null }>) {
            if (r.contract_number) out.set(r.booking_id, r.contract_number)
        }
    }
    return out
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
            const nuovaVersione = prec.versione !== r.versione
            if (nuovaVersione) cause.push(`Nuova versione algoritmo (${prec.versione} -> ${r.versione})`)
            const idPrima = new Set((prec.fattori?.contributi || []).map(c => c.id))
            const idOra = r.dettaglio.contributi.map(c => c.id)
            const nuovi = r.dettaglio.contributi.filter(c => !idPrima.has(c.id))
            const tolti = [...idPrima].filter(id => !idOra.includes(id))
            // Con una nuova versione gli eventi possono essere raggruppati in
            // modo diverso: non sono "nuovi" ne' "tolti".
            if (nuovi.length && !nuovaVersione) cause.push(`Nuovi eventi: ${nuovi.slice(0, 3).map(c => c.label).join(', ')}`)
            if (tolti.length && !nuovaVersione) cause.push(`${tolti.length} eventi non piu' considerati (regolarizzati/annullati)`)
            const nPrima = prec.fattori?.noleggiConclusi ?? null
            if (nPrima != null && r.dettaglio.noleggiConclusi > nPrima) cause.push(`${r.dettaglio.noleggiConclusi - nPrima} nuovi noleggi conclusi`)
            if ((prec.override_id || null) !== overrideId) cause.push(overrideId ? 'Intervento manuale della direzione' : 'Intervento manuale revocato o scaduto')
            if (flagOra !== flagPrima) cause.push('Flag critici cambiati')
            if (!cause.length) cause.push('Ricalcolo: stato dei pagamenti, scadenze o revisioni cambiati')
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
