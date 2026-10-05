/**
 * EMTN Score — fase 1: normalizzazione degli eventi.
 *
 * Ogni fonte (danni/penali della prenotazione, righe di fattura, pratiche
 * EMTN, vecchi emtn_events, storico della rete, multe) diventa un
 * EventoNormalizzato con la stessa forma; il motore (motore.ts) lavora solo
 * su questi. Un dato che non c'e' resta null: neutro, mai inventato.
 *
 * 05/10/2026 (direzione, "MTN — Regole di punteggio clienti"): ogni evento
 * porta una CATEGORIA delle regole fisse (regole.ts). Dalle voci DR7 la
 * categoria si ricava dal nome; dalle pratiche EMTN la propone l'AI
 * (campo categoria_score) o, in mancanza, il codice EMTN.
 *
 * Mai usati: eta', sesso, nazionalita', residenza o altri dati personali.
 */
import type { CategoriaScore } from './regole'

export type FonteEvento = 'dr7_prenotazione' | 'dr7_fattura' | 'emtn_pratica' | 'emtn_evento' | 'rete' | 'multa'
export type StatoPagamentoEvento = 'pagato' | 'parziale' | 'aperto' | 'non_applicabile'

export interface EventoNormalizzato {
    id: string
    fonte: FonteEvento
    categoria: CategoriaScore
    label: string
    /** ISO yyyy-mm-dd (o timestamp). null = data sconosciuta. */
    data: string | null
    bookingId: string | null
    /** Pratica EMTN di provenienza: lega gli eventi di una pratica senza prenotazione. */
    gruppo?: string | null
    /** Numero di contratto/pratica, se noto. */
    contratto: string | null
    importo: number
    pagato: number
    residuo: number
    statoPagamento: StatoPagamentoEvento
    /** Scadenza documentata del pagamento. null = non documentata. */
    scadenza: string | null
    /** Data del saldo, se risulta. */
    dataSaldo: string | null
    /** Ritardo documentato in minuti (riconsegna). null = non documentato. */
    minutiRitardo: number | null
    /** Fermo tecnico: fa parte dell'incidente ma non del costo del danno. */
    fermo?: boolean
    /** Fatto documentato (registro interno DR7 o pratica approvata). */
    verificato: boolean
    /** Segnalazione non ancora decisa: non pesa sullo score. */
    inRevisione: boolean
    /** null = non risulta. */
    dichiaratoDalCliente: boolean | null
    responsabilita: 'accertata' | 'contestata' | 'non_attribuibile' | null
    contestazione: 'aperta' | 'respinta' | 'accolta' | null
    /** Fatto critico accertato (furto/frode), solo da fonti approvate. */
    accertato?: boolean
    /** Documenti/registri da cui risulta. */
    prove: string[]
}

export interface NoleggioNormalizzato {
    id: string
    contratto: string | null
    inizio: string | null
    /** Data di riconsegna. */
    data: string | null
    /** Noleggio terminato (data di riconsegna passata, non annullato). */
    concluso: boolean
    /** Noleggio completamente pagato. */
    saldato: boolean
    /** Extra acquistati e pagati. */
    conExtra: boolean
}

/* ---------- voci DR7: categoria dal nome ---------- */

const RE: Array<[CategoriaScore, RegExp]> = [
    // Costo di annullamento: la tempistica non risulta dalla voce -> revisione.
    ['non_previsto', /annullament|cancellazion|disdett/i],
    ['non_imputabile', /usura|preesistent|guasto|non imputabil/i],
    ['incidente_terzi', /incident\w*.*terz|terz\w*.*incident/i],
    ['manomissione', /manomiss|manomess/i],
    ['subnoleggio', /subnoleg|cession\w* (del )?(veicol|mezzo)|ceduto a terz/i],
    ['fuori_area', /perimetr|fuori (zona|area|territorio)|espatri|estero senza/i],
    ['uso_vietato', /\bpista\b|circuito|competizion|\bgara\b/i],
    ['guidatore_non_autorizzato', /guidator\w* non|conducente non|non citat\w* nel contratto|guida non autorizzat/i],
    ['chiavi', /chiav/i],
    ['documenti_veicolo', /libretto|carta di circolazione|documenti del (veicolo|mezzo)/i],
    ['accessorio', /accessor|dotazion|cavo|triangol|giubbott|seggiolin|gonfiator|\bkit\b/i],
    ['fumo', /\bfum(o|at)|sigarett/i],
    ['animali', /\bcan[ei]\b|pelo|animal/i],
    ['ricarica', /ricarica|batteri/i],
    ['carburante', /carburant|benzin|gasolio|rifornim|serbatoio|tacch|\bpieno\b/i],
    ['pulizia', /pulizi|lavaggi|sporc|ig(i)?enizz|immondiz/i],
    ['km_extra', /\bkm\b|chilometr|kilom|sforo/i],
    ['riconsegna_luogo_diverso', /luogo divers|riconsegn\w* (in|presso) (altr|luogo)/i],
    ['multa', /mult[ae]|sanzion|verbal|contravvenz|autovelox|ztl/i],
    ['addebito_contestato', /chargeback|storno|disconosc|contestat/i],
    ['insoluto', /insolut|non pagat|mancato pagament/i],
    ['non_previsto', /recupero (del )?veicol|carro attrezzi|rimozione|cauzion/i],
    ['danno', /dann|graffi|ammacc|urto|incident|rottur|rott[oa]|cerchi|paraurti|specchiett|parabrezz|cristall|vetro|carrozzer|fermo (tecnico|veicolo|macchina|auto)|pattan|tappezzer|sedil|gomm|pneumatic|faro|bomboletta|franchigi|distrutt|furto|rubat/i],
]

export interface ClassificazioneVoce {
    categoria: CategoriaScore
    fermo: boolean
}

/**
 * Categoria di una voce DR7 dal suo nome. `tipo` dice in che lista sta:
 * una voce della lista danni senza parole chiave e' comunque un danno
 * (spesso il nome e' il pezzo: "Pattana ant sx"); una penale sconosciuta
 * va in revisione umana.
 * Furto/"rubato" scritti da un operatore restano un danno: puo' essere il
 * furto subito dal cliente (01/10/2026), mai un blocco di sicurezza.
 */
export function classificaVoce(label: string, tipo: 'danno' | 'penale'): ClassificazioneVoce {
    const t = String(label || '').replace(/^(penale|danno)\s*[-:]\s*/i, '')
    if (/ritard/i.test(t)) return { categoria: /ritiro/i.test(t) ? 'ritardo_ritiro' : 'ritardo_riconsegna', fermo: false }
    for (const [categoria, re] of RE) {
        if (!re.test(t)) continue
        // "Fermo tecnico 2gg" da solo e' il fermo; "danno paraurti + 3gg fermo" e' il danno.
        const fermo = categoria === 'danno' && /fermo (tecnico|veicolo|macchina|auto)/i.test(t) && !/\+/.test(t)
        return { categoria, fermo }
    }
    return { categoria: tipo === 'danno' ? 'danno' : 'non_previsto', fermo: false }
}

/**
 * Minuti di ritardo scritti nel nome della voce: "Ritardo 5 ore e 5 minuti"
 * = 305; "Ritardo check-out (> 30 min)" = 31 (il minimo che il documento
 * dimostra); "(per min)" = la quantita' addebitata. Altrimenti null.
 */
export function minutiDaTesto(label: string, quantita?: number | null): number | null {
    const t = String(label || '').toLowerCase()
    const oltre = t.match(/>\s*(\d+)\s*min/)
    if (oltre) return Number(oltre[1]) + 1
    const ore = t.match(/(\d+(?:[.,]\d+)?)\s*or[ae]\b/)
    const min = t.match(/(\d+)\s*min(?:ut[io])?\b/)
    if (ore || min) {
        return Math.round((ore ? Number(ore[1].replace(',', '.')) * 60 : 0) + (min ? Number(min[1]) : 0))
    }
    if (/per\s*min/.test(t) && quantita != null && quantita > 1) return Math.round(quantita)
    if (/per\s*or[ae]/.test(t) && quantita != null && quantita > 0) return Math.round(quantita * 60)
    return null
}

/* ---------- pratiche EMTN: categoria dal codice ---------- */

/**
 * Categoria di un codice EMTN (66 voci di emtnMobilityRisk.ts) quando l'AI
 * non ha proposto categoria_score. Gli importi non saldati li gestisce il
 * motore dal residuo: qui conta il FATTO.
 */
export function categoriaCodiceEMTN(codice: number): CategoriaScore {
    if (codice === 4) return 'pagamento_tardivo'
    if (codice === 8 || codice === 48) return 'km_extra'
    if (codice === 9) return 'carburante'
    if ([1, 2, 3, 5, 6, 7, 10, 11, 12, 13, 23, 56].includes(codice)) return 'insoluto'
    if ((codice >= 14 && codice <= 19) || codice === 36 || codice === 57) return 'addebito_contestato'
    if ([20, 21, 22, 24, 25, 26, 40, 43, 58].includes(codice)) return 'regolarizzazione'
    if (codice >= 27 && codice <= 35) return 'danno'
    if (codice === 37 || codice === 38 || codice === 39) return 'ritardo_riconsegna'
    if (codice === 41) return 'riconsegna_luogo_diverso'
    if (codice === 44) return 'guidatore_non_autorizzato'
    if (codice === 45) return 'subnoleggio'
    if (codice === 46 || codice === 47) return 'fuori_area'
    if (codice === 50) return 'accessorio'
    if (codice === 51) return 'chiavi'
    if (codice === 52) return 'documenti_veicolo'
    // 42 recupero, 49 uso non conforme generico, 53-55 cauzione,
    // 59-66 documentazione e clausole: non previsti dalle regole.
    return 'non_previsto'
}

/* ---------- utilita' ---------- */

export function statoDaImporti(importo: number, pagato: number, statoDichiarato?: string | null): StatoPagamentoEvento {
    const s = String(statoDichiarato || '').toLowerCase()
    if (importo <= 0) return s === 'paid' ? 'pagato' : 'non_applicabile'
    if (s === 'paid' || pagato >= importo - 0.005) return 'pagato'
    if (s === 'partial' || pagato > 0.005) return 'parziale'
    return 'aperto'
}

/** dd/mm/yyyy (anche con ora) -> yyyy-mm-dd; ISO resta com'e'; altro -> null. */
export function dataIso(v: unknown): string | null {
    const t = String(v ?? '').trim()
    if (!t) return null
    const it = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
    if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`
    return Number.isFinite(Date.parse(t)) ? t : null
}

export function giorniTra(da: string | null | undefined, a: string | null | undefined): number | null {
    const x = Date.parse(dataIso(da) || '')
    const y = Date.parse(dataIso(a) || '')
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return Math.max(0, Math.round((y - x) / 86_400_000))
}

/** Minuti tra due data/ora (riconsegna prevista ed effettiva). */
export function minutiTra(da: string | null | undefined, a: string | null | undefined): number | null {
    const x = Date.parse(String(da || ''))
    const y = Date.parse(String(a || ''))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return Math.max(0, Math.round((y - x) / 60_000))
}
