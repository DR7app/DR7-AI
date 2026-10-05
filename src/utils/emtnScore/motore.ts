/**
 * EMTN Score — motore a regole fisse.
 *
 * 05/10/2026 (direzione, "MTN — Regole di punteggio clienti"): sostituisce
 * il modello probabilistico del 01/10/2026 (emivita, recidiva non lineare,
 * cliente nuovo a 70). Ora lo score e' un REGISTRO: si parte da 50 e si
 * ripercorre la storia del cliente in ordine di data, applicando i punti
 * fissi di regole.ts. Ogni variazione resta nel registro con contratto,
 * motivo, prove e stato del pagamento.
 *
 * Regole di calcolo (dal documento della direzione):
 *  - il +10 solo alla chiusura verificata del noleggio (concluso e saldato);
 *  - un noleggio con eventi negativi prende le detrazioni e nessun bonus;
 *  - lo stesso fatto si conta una volta (danno + fattura, fumo + pulizia,
 *    piu' componenti dello stesso incidente, una multa = un verbale);
 *  - un problema emerso dopo la chiusura toglie il bonus gia' dato: il
 *    registro si ricalcola da zero a ogni consultazione;
 *  - insoluto scaduto = 0/100 e blocco; dopo il saldo: storico - 10, max 40;
 *  - furto/frode accertati = 0/100 senza risalita automatica;
 *  - evento non previsto o contestato = revisione umana, mai punti inventati.
 *
 * Funzioni pure: stessi dati => stesso risultato. Cambiare una regola =
 * nuova VERSIONE_ALGORITMO.
 */
import type { EventoNormalizzato, NoleggioNormalizzato, StatoPagamentoEvento } from './normalizza'
import { giorniTra } from './normalizza'
import {
    AUMENTO_MASSIMO_NOLEGGIO, BONUS_EXTRA, BONUS_NOLEGGIO_PERFETTO, DETRAZIONE_INSOLUTO, PUNTEGGIO_INIZIALE,
    PUNTEGGIO_MASSIMO, PUNTEGGIO_MINIMO, RIENTRO_MASSIMO_INSOLUTO,
    puntiDanno, puntiPagamentoTardivo, puntiRitardoRiconsegna, regolaScore,
    type CategoriaScore,
} from './regole'

export const VERSIONE_ALGORITMO = 'emtn-score-2.0.0'

/* ---------- tipi del risultato ---------- */

export type TipoMovimento =
    | 'bonus'            // noleggio perfetto
    | 'detrazione'
    | 'neutro'           // fatto registrato, 0 punti
    | 'nessun_bonus'     // noleggio concluso senza aumento (motivo nel testo)
    | 'revisione'        // 0 punti, decide una persona
    | 'blocco_insoluto'
    | 'rientro'          // saldo di un insoluto
    | 'blocco_sicurezza'

export interface Movimento {
    data: string | null
    tipo: TipoMovimento
    categoria: CategoriaScore | 'noleggio'
    bookingId: string | null
    contratto: string | null
    motivo: string
    /** Punti della regola (prima del limite 0-100). */
    punti: number
    /** Score dopo il movimento (quello che vede l'operatore). */
    score: number
    prove: string[]
    statoPagamento: StatoPagamentoEvento | null
    importo: number | null
}

export interface FlagCritico {
    codice: 'furto' | 'frode' | 'insoluto' | 'revisione_sicurezza' | 'verifica_immediata' | 'override'
    label: string
    /** Score massimo consentito dal flag (100 = nessun tetto, solo avviso). */
    tetto: number
    eventoId: string | null
}

export type LivelloRischio = 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Critical'
export type Trend = 'Improving' | 'Stable' | 'Deteriorating'

export interface OverrideScore {
    id?: string
    tipo: 'limite_massimo' | 'score_fisso' | 'flag_critico'
    valore: number | null
    motivo: string
    operatore: string | null
    creato_il: string
}

export interface RisultatoEMTNScore {
    versione: string
    score: number
    /** Score del registro prima degli override della direzione. */
    scoreCalcolato: number
    confidence: number
    livello: LivelloRischio
    band: 'green' | 'yellow' | 'red'
    level: 1 | 2 | 3
    trend: Trend
    scorePrecedente6Mesi: number | null
    /** Cliente nuovo: "storico insufficiente". */
    profiloInCostruzione: boolean
    revisioneManuale: boolean
    blocco: 'sicurezza' | 'insoluto' | null
    flag: FlagCritico[]
    /** Eventi che aspettano una decisione umana (nessun punto applicato). */
    revisioni: string[]
    positivi: string[]
    rischi: string[]
    spiegazione: string
    override: OverrideScore | null
    movimenti: Movimento[]
    dettaglio: {
        noleggiConclusi: number
        noleggiRegolari: number
        eventiConsiderati: number
        eventiInRevisione: number
        nonSaldati: number
        residuo: number
        contributi: Array<{ id: string; categoria: CategoriaScore; label: string; data: string | null; punti: number }>
    }
}

export interface InputScore {
    eventi: EventoNormalizzato[]
    noleggi: NoleggioNormalizzato[]
    /** Cliente riconosciuto con codice fiscale/scheda. */
    identificato: boolean
    override?: OverrideScore | null
    oggi?: Date
}

/* ---------- helpers ---------- */

const clamp = (x: number, a = PUNTEGGIO_MINIMO, b = PUNTEGGIO_MASSIMO) => Math.max(a, Math.min(b, x))
const ms = (d: string | null | undefined): number => {
    const t = d ? Date.parse(d) : NaN
    return Number.isFinite(t) ? t : NaN
}
/** Data mancante o illeggibile = evento tenuto (mai sparito per un formato). */
const entro = (d: string | null | undefined, oggi: Date) => {
    const t = ms(d)
    return !Number.isFinite(t) || t <= oggi.getTime()
}
const euro = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} EUR`
const dataIt = (d: string | null) => {
    const t = ms(d)
    if (!Number.isFinite(t)) return 'data non nota'
    return new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
}
const segno = (n: number) => (n > 0 ? `+${n}` : String(n))

/* ---------- fase 2: dai singoli eventi ai FATTI ---------- */

/** Un fatto = un evento contato una volta sola, anche se lo raccontano piu' fonti. */
export interface Fatto {
    id: string
    categoria: CategoriaScore
    label: string
    data: string | null
    bookingId: string | null
    contratto: string | null
    importo: number
    residuo: number
    statoPagamento: StatoPagamentoEvento
    scadenza: string | null
    dataSaldo: string | null
    minutiRitardo: number | null
    dichiaratoDalCliente: boolean | null
    accertato: boolean
    prove: string[]
    voci: number
}

const CATEGORIE_ANNULLAMENTO: CategoriaScore[] = ['annullamento_5g', 'annullamento_48h_5g', 'annullamento_24_48h', 'annullamento_meno_24h', 'mancata_presentazione']

/** Eventi che entrano nel calcolo: documentati, decisi, non futuri. */
function eventiValidi(eventi: EventoNormalizzato[], oggi: Date): EventoNormalizzato[] {
    return eventi.filter(e => e.verificato && !e.inRevisione && e.contestazione !== 'accolta' && entro(e.data, oggi))
}

/** Categoria effettiva: responsabilita' e contestazioni cambiano la regola da applicare. */
function categoriaEffettiva(e: EventoNormalizzato): CategoriaScore {
    if (e.categoria === 'furto' || e.categoria === 'frode') return e.accertato ? e.categoria : 'non_previsto'
    // Addebito contestato e non deciso: revisione umana, nessun azzeramento.
    if (e.contestazione === 'aperta' || e.responsabilita === 'contestata') return 'addebito_contestato'
    if (e.responsabilita === 'non_attribuibile' && e.categoria === 'danno') return 'non_imputabile'
    return e.categoria
}

function unisci(categoria: CategoriaScore, g: EventoNormalizzato[]): Fatto {
    // Importo: le voci di una stessa fonte si sommano (piu' componenti dello
    // stesso incidente), tra fonti diverse vale la maggiore (raccontano lo
    // stesso fatto: voce DR7, riga di fattura, pratica EMTN).
    // Il fermo tecnico non e' costo del danno: conta solo se non c'e' altro.
    const perFonte = new Map<string, { importo: number; fermo: number; pagato: number; residuo: number }>()
    for (const e of g) {
        const f = perFonte.get(e.fonte) || { importo: 0, fermo: 0, pagato: 0, residuo: 0 }
        const pagato = e.statoPagamento === 'pagato' ? e.importo : Math.max(0, e.importo - e.residuo)
        const residuo = e.statoPagamento === 'pagato' ? 0 : e.residuo
        if (e.fonte === 'emtn_pratica') {
            // I codici di una pratica descrivono lo STESSO fatto da piu' lati
            // (danno documentato, preventivo, danno non saldato): vale il maggiore.
            f.importo = Math.max(f.importo, e.importo)
            f.pagato = Math.max(f.pagato, pagato)
            f.residuo = Math.max(f.residuo, residuo)
        } else {
            if (e.fermo) f.fermo += e.importo
            else f.importo += e.importo
            f.pagato += pagato
            f.residuo += residuo
        }
        perFonte.set(e.fonte, f)
    }
    const fonti = [...perFonte.values()]
    const importo = fonti.reduce((m, f) => Math.max(m, f.importo > 0 ? f.importo : f.fermo), 0)
    // Residuo: il piu' basso tra le fonti che hanno un importo (la
    // regolarizzazione piu' recente vince), mai sopra l'importo.
    const conImporto = fonti.filter(f => f.importo + f.fermo > 0)
    const residuo = conImporto.length
        ? Math.max(0, Math.min(...conImporto.map(f => f.residuo)))
        : g.reduce((t, e) => t + e.residuo, 0)
    // Senza importi lo stato e' quello dichiarato dalle fonti (es. insoluto
    // approvato senza cifra); con importi decide il residuo.
    const statoPagamento: StatoPagamentoEvento = conImporto.length === 0
        ? (g.some(e => e.statoPagamento === 'aperto' || e.statoPagamento === 'parziale') ? 'aperto' : g.some(e => e.statoPagamento === 'pagato') ? 'pagato' : 'non_applicabile')
        : residuo > 0.005
            ? (fonti.some(f => f.pagato > 0.005) ? 'parziale' : 'aperto')
            : 'pagato'
    const prima = (xs: Array<string | null>) => xs.filter(Boolean).sort()[0] || null
    const ultima = (xs: Array<string | null>) => xs.filter(Boolean).sort().pop() || null
    const minuti = g.map(e => e.minutiRitardo).filter((x): x is number => x != null)
    const principale = [...g].sort((a, b) => b.importo - a.importo)[0]
    return {
        id: g[0].id,
        categoria,
        label: g.length > 1 ? `${principale.label} (${g.length} voci, un solo fatto)` : principale.label,
        data: prima(g.map(e => e.data)),
        bookingId: principale.bookingId,
        contratto: g.map(e => e.contratto).find(Boolean) || null,
        importo: Math.round(importo * 100) / 100,
        residuo: Math.round(residuo * 100) / 100,
        statoPagamento,
        scadenza: prima(g.map(e => e.scadenza)),
        dataSaldo: ultima(g.map(e => e.dataSaldo)),
        minutiRitardo: minuti.length ? Math.max(...minuti) : null,
        dichiaratoDalCliente: g.some(e => e.dichiaratoDalCliente === false) ? false : g.some(e => e.dichiaratoDalCliente === true) ? true : null,
        accertato: g.some(e => e.accertato),
        prove: [...new Set(g.flatMap(e => e.prove))],
        voci: g.length,
    }
}

/**
 * Raggruppa per noleggio (o pratica) e per categoria, poi applica le regole
 * "lo stesso fatto si conta una sola volta".
 */
export function fattiDaEventi(eventi: EventoNormalizzato[], oggi: Date): Fatto[] {
    const perGruppo = new Map<string, EventoNormalizzato[]>()
    for (const e of eventiValidi(eventi, oggi)) {
        const k = e.bookingId ? `b:${e.bookingId}` : e.gruppo ? `g:${e.gruppo}` : `e:${e.id}`
        perGruppo.set(k, [...(perGruppo.get(k) || []), { ...e, categoria: categoriaEffettiva(e) }])
    }
    const out: Fatto[] = []
    for (const [k, lista] of perGruppo) {
        // Multa: un verbale = una detrazione. Se il registro multe c'e', le
        // voci "multa" del gestionale sullo stesso noleggio sono lo stesso verbale.
        const conRegistroMulte = lista.some(e => e.fonte === 'multa')
        const perCategoria = new Map<string, EventoNormalizzato[]>()
        for (const e of lista) {
            if (e.categoria === 'multa' && conRegistroMulte && e.fonte !== 'multa') continue
            const kc = e.categoria === 'multa' ? `multa:${e.id}` : e.categoria
            perCategoria.set(kc, [...(perCategoria.get(kc) || []), e])
        }
        // id stabile: un evento isolato tiene il suo; i fatti di un noleggio
        // si chiamano noleggio+categoria (una voce in piu' non e' un fatto nuovo).
        let fatti = [...perCategoria.entries()].map(([kc, g]) => {
            const f = unisci(g[0].categoria, g)
            return g.length === 1 && !g[0].bookingId && !g[0].gruppo ? f : { ...f, id: `fatto:${k}|${kc}` }
        })
        const ha = (c: CategoriaScore) => fatti.some(f => f.categoria === c)
        // Fumo e pulizia dovuta al medesimo fumo: solo -10.
        if (ha('fumo')) fatti = fatti.filter(f => f.categoria !== 'pulizia')
        // Incidente con responsabilita' del cliente: solo il danno, niente -5.
        if (ha('danno')) fatti = fatti.filter(f => f.categoria !== 'incidente_terzi')
        // Ritardo o luogo diverso autorizzati: 0.
        if (ha('ritardo_autorizzato')) fatti = fatti.filter(f => f.categoria !== 'ritardo_riconsegna' && f.categoria !== 'riconsegna_luogo_diverso')
        // Annullamento giustificato o dell'azienda: nessuna detrazione di annullamento.
        if (ha('annullamento_giustificato') || ha('annullamento_azienda')) fatti = fatti.filter(f => !CATEGORIE_ANNULLAMENTO.includes(f.categoria))
        // "Insoluto" accanto a un altro fatto aperto dello stesso noleggio
        // (es. danno non saldato) e' lo stesso debito: un solo debito, che
        // eredita la scadenza (l'insoluto e' scaduto per definizione).
        const insoluto = fatti.find(f => f.categoria === 'insoluto')
        const debitore = fatti.find(f => f.categoria !== 'insoluto' && aperto(f))
        if (insoluto && debitore) {
            debitore.scadenza = debitore.scadenza || insoluto.scadenza || insoluto.data
            debitore.prove = [...new Set([...debitore.prove, ...insoluto.prove])]
            fatti = fatti.filter(f => f !== insoluto)
        }
        // Occultamento di un danno accertato: -10 in aggiunta, una volta.
        const danno = fatti.find(f => f.categoria === 'danno')
        if (danno && danno.dichiaratoDalCliente === false && !ha('occultamento_danno')) {
            fatti.push({ ...danno, id: `${danno.id}|occultamento`, categoria: 'occultamento_danno', label: `Occultamento del danno: ${danno.label}`, importo: 0, residuo: 0, statoPagamento: 'non_applicabile', voci: 1 })
        }
        out.push(...fatti)
    }
    return out
}

/* ---------- fase 3: punti di un fatto ---------- */

interface Valutazione {
    punti: number
    motivo: string
    revisione: string | null
    flag: FlagCritico | null
    bloccoSicurezza: boolean
}

function valuta(f: Fatto): Valutazione {
    const regola = regolaScore(f.categoria)
    const base: Valutazione = { punti: 0, motivo: regola.label, revisione: null, flag: null, bloccoSicurezza: false }
    if (f.categoria === 'danno') {
        if (!(f.importo > 0)) return { ...base, motivo: `${f.label}: costo del danno non documentato`, revisione: `${f.label}: manca il costo documentato del danno per lo scaglione` }
        const d = puntiDanno(f.importo)
        return { ...base, punti: d.punti, motivo: `Danno ${euro(f.importo)} (${d.scaglione}): ${f.label}` }
    }
    if (f.categoria === 'ritardo_riconsegna') {
        if (f.minutiRitardo == null) return { ...base, motivo: `${f.label}: durata del ritardo non documentata`, revisione: `${f.label}: durata del ritardo non documentata` }
        const r = puntiRitardoRiconsegna(f.minutiRitardo)
        const ore = f.minutiRitardo >= 60 ? `${Math.floor(f.minutiRitardo / 60)} h ${f.minutiRitardo % 60} min` : `${f.minutiRitardo} min`
        return {
            ...base, punti: r.punti, motivo: `Ritardo alla riconsegna ${ore} (${r.scaglione})`,
            flag: r.verificaImmediata ? { codice: 'verifica_immediata', label: 'Ritardo oltre 24 ore senza autorizzazione: verifica immediata', tetto: 100, eventoId: f.id } : null,
        }
    }
    if (f.categoria === 'pagamento_tardivo') {
        const g = giorniTra(f.scadenza, f.dataSaldo)
        if (g == null) return { ...base, motivo: `${f.label}: date di scadenza e saldo non documentate`, revisione: `${f.label}: date di scadenza e saldo non documentate` }
        const p = puntiPagamentoTardivo(g)
        // Oltre 7 giorni lo gestisce il registro come insoluto saldato.
        return { ...base, punti: p.insoluto ? 0 : p.punti, motivo: `Pagamento saldato ${g} giorni dopo la scadenza (${p.scaglione})` }
    }
    if (f.categoria === 'furto' || f.categoria === 'frode') {
        return {
            ...base, motivo: `${regola.label}: 0/100 e blocco di sicurezza`, bloccoSicurezza: true,
            flag: { codice: f.categoria, label: `${regola.label}: nessuna risalita automatica`, tetto: 0, eventoId: f.id },
        }
    }
    if (regola.effetto === 'revisione_umana') {
        return { ...base, motivo: `${f.label}: ${regola.label.toLowerCase()}`, revisione: `${f.label} (${regola.label.toLowerCase()})` }
    }
    const punti = regola.punti ?? 0
    return {
        ...base, punti,
        motivo: f.categoria === 'multa' ? `${regola.label} (verbale)` : punti !== 0 && f.label !== regola.label ? `${regola.label}: ${f.label}` : regola.label,
        flag: regola.effetto === 'revisione_sicurezza' ? { codice: 'revisione_sicurezza', label: `${regola.label}: revisione di sicurezza`, tetto: 100, eventoId: f.id } : null,
    }
}

/* ---------- fase 4: il registro ---------- */

type Voce =
    | { tipo: 'noleggio'; data: string | null; ordine: number; noleggio: NoleggioNormalizzato; fatti: Fatto[] }
    | { tipo: 'fatti'; data: string | null; ordine: number; fatti: Fatto[] }
    | { tipo: 'scadenza'; data: string; ordine: number; fatto: Fatto }
    | { tipo: 'saldo'; data: string; ordine: number; fatto: Fatto; giorni: number }

interface Registro {
    score: number
    movimenti: Movimento[]
    flag: FlagCritico[]
    revisioni: string[]
    blocco: 'sicurezza' | 'insoluto' | null
    noleggiConclusi: number
    noleggiPerfetti: number
    fatti: Fatto[]
    valutazioni: Map<string, Valutazione>
    debitiAperti: Fatto[]
}

/** Debito scaduto: scadenza documentata passata, o insoluto gia' scaduto per definizione. */
function scadenzaDebito(f: Fatto): string | null {
    if (f.scadenza) return f.scadenza
    if (f.categoria === 'insoluto') return f.data
    return null
}

function aperto(f: Fatto): boolean {
    if (f.statoPagamento !== 'aperto' && f.statoPagamento !== 'parziale') return false
    // Insoluto approvato senza importo (vecchi emtn_events): resta un debito aperto.
    return f.residuo > 0.005 || (f.categoria === 'insoluto' && f.importo === 0)
}

function calcolaRegistro(eventi: EventoNormalizzato[], noleggi: NoleggioNormalizzato[], oggi: Date): Registro {
    const fatti = fattiDaEventi(eventi, oggi)
    const valutazioni = new Map(fatti.map(f => [f.id, valuta(f)]))
    const conclusi = noleggi.filter(n => n.concluso && entro(n.data, oggi))
    const idConclusi = new Set(conclusi.map(n => n.id))

    const voci: Voce[] = []
    for (const n of conclusi) voci.push({ tipo: 'noleggio', data: n.data, ordine: 1, noleggio: n, fatti: fatti.filter(f => f.bookingId === n.id) })
    // Fatti fuori da un noleggio concluso (noleggio in corso, rete, pratica
    // senza prenotazione): alla loro data.
    const sciolti = new Map<string, Fatto[]>()
    for (const f of fatti) {
        if (f.bookingId && idConclusi.has(f.bookingId)) continue
        const k = f.bookingId || f.id
        sciolti.set(k, [...(sciolti.get(k) || []), f])
    }
    for (const g of sciolti.values()) voci.push({ tipo: 'fatti', data: g.map(f => f.data).filter(Boolean).sort().pop() || null, ordine: 1, fatti: g })
    // Debiti: inizio dell'insoluto alla scadenza, saldo alla data di pagamento.
    for (const f of fatti) {
        if (f.categoria === 'addebito_contestato') continue
        const scad = scadenzaDebito(f)
        if (!scad || !entro(scad, oggi)) continue
        const pagatoDopo = f.statoPagamento === 'pagato' && f.dataSaldo && ms(f.dataSaldo) > ms(scad)
        if (aperto(f) || pagatoDopo) voci.push({ tipo: 'scadenza', data: scad, ordine: 2, fatto: f })
        if (pagatoDopo && entro(f.dataSaldo, oggi)) {
            voci.push({ tipo: 'saldo', data: f.dataSaldo!, ordine: 3, fatto: f, giorni: giorniTra(scad, f.dataSaldo) ?? 0 })
        }
    }
    // Data sconosciuta = prima di tutto (non sposta il bonus dei noleggi datati).
    voci.sort((a, b) => {
        const x = ms(a.data), y = ms(b.data)
        const dx = Number.isFinite(x) ? x : -Infinity
        const dy = Number.isFinite(y) ? y : -Infinity
        return dx === dy ? a.ordine - b.ordine : dx - dy
    })

    let base = PUNTEGGIO_INIZIALE
    let sicurezza = false
    const insolutiAttivi = new Set<string>()
    const movimenti: Movimento[] = []
    const flag: FlagCritico[] = []
    const revisioni: string[] = []
    let perfetti = 0
    const visibile = () => (sicurezza || insolutiAttivi.size > 0 ? 0 : base)
    const debitiAperti = fatti.filter(f => aperto(f) && f.categoria !== 'addebito_contestato')
    // Debito aperto senza scadenza documentata: niente blocco, ma nessun
    // aumento finche' resta aperto (dalla data dell'evento).
    const congelatoDa = debitiAperti.filter(f => !scadenzaDebito(f)).map(f => ms(f.data)).map(t => (Number.isFinite(t) ? t : -Infinity))
    const congelato = (d: string | null) => congelatoDa.some(t => ms(d) >= t || !Number.isFinite(ms(d)))

    const movimento = (m: Omit<Movimento, 'score'>) => movimenti.push({ ...m, score: visibile() })

    const applicaFatti = (lista: Fatto[], contrattoNoleggio: string | null): { negativi: boolean; inRevisione: boolean } => {
        let negativi = false
        let inRevisione = false
        for (const f of lista) {
            const v = valutazioni.get(f.id)!
            const comune = {
                data: f.data, categoria: f.categoria, bookingId: f.bookingId, contratto: f.contratto || contrattoNoleggio,
                prove: f.prove, statoPagamento: f.statoPagamento, importo: f.importo > 0 ? f.importo : null,
            }
            if (v.bloccoSicurezza) {
                sicurezza = true
                negativi = true
                if (v.flag) flag.push(v.flag)
                movimento({ ...comune, tipo: 'blocco_sicurezza', motivo: v.motivo, punti: 0 })
                continue
            }
            if (v.revisione) {
                inRevisione = true
                revisioni.push(v.revisione)
                movimento({ ...comune, tipo: 'revisione', motivo: `${v.motivo}: revisione umana, nessun punto applicato`, punti: 0 })
                continue
            }
            if (v.flag) flag.push(v.flag)
            if (v.punti < 0) {
                negativi = true
                base = clamp(base + v.punti)
                movimento({ ...comune, tipo: 'detrazione', motivo: v.motivo, punti: v.punti })
            } else {
                // Una pendenza aperta non e' un noleggio "perfetto" anche se la regola vale 0.
                if (aperto(f)) negativi = true
                movimento({ ...comune, tipo: 'neutro', motivo: v.motivo, punti: 0 })
            }
        }
        return { negativi, inRevisione }
    }

    for (const v of voci) {
        if (v.tipo === 'noleggio') {
            const n = v.noleggio
            const { negativi, inRevisione } = applicaFatti(v.fatti, n.contratto)
            const comune = { data: n.data, categoria: 'noleggio' as const, bookingId: n.id, contratto: n.contratto, prove: ['Prenotazione nel gestionale'], importo: null }
            if (negativi) {
                movimento({ ...comune, tipo: 'nessun_bonus', motivo: 'Noleggio concluso con eventi negativi: nessun bonus', punti: 0, statoPagamento: n.saldato ? 'pagato' : 'aperto' })
            } else if (inRevisione) {
                movimento({ ...comune, tipo: 'nessun_bonus', motivo: 'Bonus sospeso: evento del noleggio in revisione umana', punti: 0, statoPagamento: n.saldato ? 'pagato' : 'aperto' })
            } else if (!n.saldato) {
                movimento({ ...comune, tipo: 'nessun_bonus', motivo: 'Noleggio concluso ma non risulta completamente pagato: nessun bonus', punti: 0, statoPagamento: 'aperto' })
            } else if (sicurezza || insolutiAttivi.size > 0 || congelato(n.data)) {
                movimento({ ...comune, tipo: 'nessun_bonus', motivo: sicurezza ? 'Blocco di sicurezza: nessuna risalita automatica' : 'Debito aperto: nessun aumento finche\' non e\' saldato', punti: 0, statoPagamento: 'pagato' })
            } else {
                // +10, extra compresi, mai oltre il massimo per noleggio.
                const bonus = Math.min(AUMENTO_MASSIMO_NOLEGGIO, BONUS_NOLEGGIO_PERFETTO + (n.conExtra ? BONUS_EXTRA : 0))
                perfetti++
                base = clamp(base + bonus)
                movimento({ ...comune, tipo: 'bonus', motivo: 'Noleggio concluso senza problemi e completamente pagato', punti: bonus, statoPagamento: 'pagato' })
            }
        } else if (v.tipo === 'fatti') {
            applicaFatti(v.fatti, null)
        } else if (v.tipo === 'scadenza') {
            const f = v.fatto
            insolutiAttivi.add(f.id)
            movimento({
                data: v.data, tipo: 'blocco_insoluto', categoria: 'insoluto', bookingId: f.bookingId, contratto: f.contratto,
                motivo: `Importo scaduto e non pagato (${euro(f.residuo > 0 ? f.residuo : f.importo)}): ${f.label}. 0/100 e blocco per insoluto`,
                punti: 0, prove: f.prove, statoPagamento: aperto(f) ? f.statoPagamento : 'aperto', importo: f.importo || null,
            })
        } else if (v.tipo === 'saldo') {
            const f = v.fatto
            insolutiAttivi.delete(f.id)
            const p = puntiPagamentoTardivo(v.giorni)
            const comune = { data: v.data, categoria: 'pagamento_tardivo' as const, bookingId: f.bookingId, contratto: f.contratto, prove: f.prove, statoPagamento: 'pagato' as const, importo: f.importo || null }
            if (p.insoluto) {
                // Rientro: punteggio storico (gia' senza le penalita' dell'evento) - 10, massimo 40.
                const prima = base
                base = clamp(Math.min(RIENTRO_MASSIMO_INSOLUTO, base - DETRAZIONE_INSOLUTO))
                movimento({ ...comune, tipo: 'rientro', motivo: `Insoluto saldato ${v.giorni} giorni dopo la scadenza: rientro a ${base} (storico ${prima} - ${DETRAZIONE_INSOLUTO}, massimo ${RIENTRO_MASSIMO_INSOLUTO})`, punti: base - prima })
            } else if (f.categoria !== 'pagamento_tardivo') {
                // (la categoria pagamento_tardivo ha gia' la sua detrazione dal fatto)
                base = clamp(base + p.punti)
                movimento({ ...comune, tipo: 'detrazione', motivo: `Pagamento saldato ${v.giorni} giorni dopo la scadenza (${p.scaglione}): ${f.label}`, punti: p.punti })
            }
        }
    }

    for (const f of debitiAperti) {
        if (!scadenzaDebito(f)) revisioni.push(`${f.label}: ${euro(f.residuo)} non saldati, scadenza non documentata (nessun aumento finche' resta aperto)`)
    }
    if (insolutiAttivi.size > 0) {
        flag.push({ codice: 'insoluto', label: `Insoluto scaduto: blocco finche' esiste un saldo scaduto`, tetto: 0, eventoId: [...insolutiAttivi][0] })
    }
    return {
        score: visibile(),
        movimenti, flag, revisioni,
        blocco: sicurezza ? 'sicurezza' : insolutiAttivi.size > 0 ? 'insoluto' : null,
        noleggiConclusi: conclusi.length,
        noleggiPerfetti: perfetti,
        fatti, valutazioni, debitiAperti,
    }
}

/* ---------- fase 5: livello, trend, spiegazione ---------- */

/** Soglie approvate dalla direzione il 05/10/2026: un cliente nuovo (50) e' giallo. */
function livelloDa(score: number, bloccato: boolean): LivelloRischio {
    if (bloccato || score < 20) return 'Critical'
    if (score < 40) return 'High'
    if (score < 60) return 'Moderate'
    if (score < 75) return 'Low'
    return 'Very Low'
}

const ORDINE_LIVELLI: LivelloRischio[] = ['Very Low', 'Low', 'Moderate', 'High', 'Critical']
const almeno = (l: LivelloRischio, minimo: LivelloRischio) => (ORDINE_LIVELLI.indexOf(l) >= ORDINE_LIVELLI.indexOf(minimo) ? l : minimo)

/** Quantita' di dati a sostegno dello score (non e' rischio). */
function confidenceDa(noleggiConclusi: number, primo: string | null, identificato: boolean, oggi: Date): number {
    const mesi = primo && Number.isFinite(ms(primo)) ? Math.max(0, (oggi.getTime() - ms(primo)) / (30.44 * 86_400_000)) : 0
    const c = (identificato ? 0.1 : 0.05) + 0.75 * (1 - Math.exp(-noleggiConclusi / 6)) + 0.12 * Math.min(1, mesi / 24)
    return Math.round(Math.min(0.97, c) * 100)
}

export function calcolaEMTNScore(input: InputScore): RisultatoEMTNScore {
    const oggi = input.oggi || new Date()
    const reg = calcolaRegistro(input.eventi, input.noleggi, oggi)
    const flag = [...reg.flag]
    const override = input.override || null
    if (override?.tipo === 'flag_critico') {
        flag.push({ codice: 'override', label: `Flag della direzione: ${override.motivo}`, tetto: override.valore ?? 0, eventoId: null })
    }

    let score = reg.score
    for (const f of flag) score = Math.min(score, f.tetto)
    if (override?.tipo === 'limite_massimo' && override.valore != null) score = Math.min(score, override.valore)
    if (override?.tipo === 'score_fisso' && override.valore != null) score = override.valore
    score = Math.round(clamp(score))

    const bloccato = reg.blocco != null || flag.some(f => f.tetto === 0)
    const minimo: LivelloRischio = reg.debitiAperti.length > 0 ? 'Moderate' : 'Very Low'
    const livello = almeno(livelloDa(score, bloccato), minimo)
    const band: RisultatoEMTNScore['band'] = livello === 'Very Low' || livello === 'Low' ? 'green' : livello === 'Moderate' ? 'yellow' : 'red'
    const level = band === 'green' ? 1 : band === 'yellow' ? 2 : 3

    // Trend: lo stesso registro con i soli dati di 6 mesi fa.
    const seiMesiFa = new Date(oggi.getTime() - 182 * 86_400_000)
    const haStoria = input.noleggi.some(n => n.concluso && n.data && ms(n.data) <= seiMesiFa.getTime())
        || input.eventi.some(e => e.data && ms(e.data) <= seiMesiFa.getTime())
    let scorePrecedente6Mesi: number | null = null
    let trend: Trend = 'Stable'
    if (haStoria) {
        scorePrecedente6Mesi = calcolaRegistro(input.eventi, input.noleggi, seiMesiFa).score
        const delta = reg.score - scorePrecedente6Mesi
        trend = delta >= 3 ? 'Improving' : delta <= -3 ? 'Deteriorating' : 'Stable'
    }

    const negativi = reg.movimenti.filter(m => m.tipo === 'detrazione' || m.tipo === 'blocco_insoluto' || m.tipo === 'blocco_sicurezza')
    const residuo = reg.debitiAperti.reduce((t, f) => t + f.residuo, 0)
    const inRevisione = input.eventi.filter(e => e.inRevisione).length
    const profiloInCostruzione = reg.noleggiConclusi === 0
    const dateConclusi = input.noleggi.filter(n => n.concluso && n.data).map(n => n.data as string).sort()

    const positivi: string[] = []
    if (reg.noleggiPerfetti > 0) positivi.push(`${reg.noleggiPerfetti} noleggi conclusi senza problemi e pagati`)
    if (negativi.length === 0 && reg.noleggiConclusi > 0) positivi.push('Nessun evento negativo registrato')
    if (reg.fatti.some(f => f.importo > 0) && reg.debitiAperti.length === 0) positivi.push('Tutti gli importi dovuti risultano saldati')
    if (dateConclusi.length && (oggi.getTime() - ms(dateConclusi[0])) >= 365 * 86_400_000) positivi.push(`Cliente dal ${dataIt(dateConclusi[0])}`)

    // Rischi: le detrazioni piu' pesanti, poi blocchi e pendenze.
    const rischi: string[] = []
    for (const f of flag) rischi.push(f.label)
    for (const m of [...negativi].filter(m => m.tipo === 'detrazione').sort((a, b) => a.punti - b.punti)) {
        if (rischi.length >= 3) break
        rischi.push(`${segno(m.punti)} ${m.motivo} (${dataIt(m.data)})`)
    }
    if (rischi.length < 3 && residuo > 0) rischi.push(`Importi non saldati: ${euro(residuo)}`)

    const frasi: string[] = []
    if (profiloInCostruzione) frasi.push(`Storico insufficiente: nessun noleggio concluso, punteggio di partenza ${PUNTEGGIO_INIZIALE}.`)
    else frasi.push(`Partenza ${PUNTEGGIO_INIZIALE}; ${reg.noleggiConclusi} noleggi conclusi, ${reg.noleggiPerfetti} senza problemi (+${BONUS_NOLEGGIO_PERFETTO} ciascuno, massimo ${PUNTEGGIO_MASSIMO}).`)
    const totDetrazioni = negativi.filter(m => m.tipo === 'detrazione').reduce((t, m) => t + m.punti, 0)
    if (negativi.length === 0) frasi.push('Nessun evento negativo documentato.')
    else if (totDetrazioni < 0) frasi.push(`Detrazioni applicate: ${totDetrazioni} punti in ${negativi.filter(m => m.tipo === 'detrazione').length} eventi.`)
    if (reg.blocco === 'insoluto') frasi.push('Blocco per insoluto: 0/100 finche\' esiste un saldo scaduto.')
    if (reg.blocco === 'sicurezza') frasi.push('Blocco di sicurezza: 0/100, nessuna risalita automatica.')
    if (reg.revisioni.length) frasi.push(`${reg.revisioni.length} eventi in revisione umana: nessun punto applicato finche' non si decide.`)
    if (override) frasi.push(`Intervento manuale della direzione: ${override.motivo}.`)
    if (trend !== 'Stable' && scorePrecedente6Mesi != null) frasi.push(`Sei mesi fa lo score era ${scorePrecedente6Mesi}.`)

    return {
        versione: VERSIONE_ALGORITMO,
        score,
        scoreCalcolato: reg.score,
        confidence: confidenceDa(reg.noleggiConclusi, dateConclusi[0] || null, input.identificato, oggi),
        livello, band, level, trend, scorePrecedente6Mesi,
        profiloInCostruzione,
        revisioneManuale: flag.length > 0 || reg.revisioni.length > 0,
        blocco: reg.blocco,
        flag,
        revisioni: reg.revisioni,
        positivi: positivi.slice(0, 3),
        rischi: rischi.slice(0, 3),
        spiegazione: frasi.join(' '),
        override,
        movimenti: reg.movimenti,
        dettaglio: {
            noleggiConclusi: reg.noleggiConclusi,
            noleggiRegolari: reg.noleggiPerfetti,
            eventiConsiderati: reg.fatti.filter(f => {
                const v = reg.valutazioni.get(f.id)!
                return v.punti !== 0 || v.bloccoSicurezza || aperto(f)
            }).length,
            eventiInRevisione: inRevisione,
            nonSaldati: reg.debitiAperti.length,
            residuo: Math.round(residuo * 100) / 100,
            contributi: reg.fatti.map(f => ({ id: f.id, categoria: f.categoria, label: f.label, data: f.data, punti: reg.valutazioni.get(f.id)!.punti })),
        },
    }
}
