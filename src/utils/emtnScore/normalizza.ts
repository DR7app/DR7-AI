/**
 * EMTN Score — fase 1: normalizzazione degli eventi.
 *
 * 01/10/2026 (direzione): lo score non e' piu' un contatore di penalita'.
 * Ogni fonte (danni/penali della prenotazione, righe di fattura, pratiche
 * EMTN, vecchi emtn_events, storico della rete, multe) diventa un
 * EventoNormalizzato con la stessa forma; il motore (motore.ts) lavora solo
 * su questi. Un dato che non c'e' resta null: neutro, mai inventato.
 *
 * Mai usati: eta', sesso, nazionalita', residenza o altri dati personali.
 */

export type Famiglia =
    | 'danno'
    | 'carburante'
    | 'pulizia'
    | 'fumo'
    | 'animali'
    | 'ritardo'
    | 'km'
    | 'multa'
    | 'penale'
    | 'insoluto'
    | 'chargeback'
    | 'contestazione'
    | 'guida_non_autorizzata'
    | 'violazione_contratto'
    | 'documentazione'
    | 'cauzione'
    | 'recupero_veicolo'
    | 'mancata_restituzione'
    | 'furto'
    | 'frode'
    | 'falsificazione'
    | 'regolarizzazione'

export type FonteEvento = 'dr7_prenotazione' | 'dr7_fattura' | 'emtn_pratica' | 'emtn_evento' | 'rete' | 'multa'
export type StatoPagamentoEvento = 'pagato' | 'parziale' | 'aperto' | 'non_applicabile'

export interface EventoNormalizzato {
    id: string
    fonte: FonteEvento
    famiglia: Famiglia
    label: string
    /** ISO yyyy-mm-dd (o timestamp). null = data sconosciuta. */
    data: string | null
    importo: number
    pagato: number
    residuo: number
    statoPagamento: StatoPagamentoEvento
    /** Giorni tra l'evento e il saldo, quando risultano entrambe le date. */
    giorniAlSaldo: number | null
    /** Fatto documentato (registro interno DR7 o pratica approvata). */
    verificato: boolean
    /** Segnalazione non ancora decisa: non pesa sullo score. */
    inRevisione: boolean
    /** null = non risulta. */
    dichiaratoDalCliente: boolean | null
    responsabilita: 'accertata' | 'contestata' | 'non_attribuibile' | null
    gravitaIndicata: 'lieve' | 'media' | 'grave' | null
    contestazione: 'aperta' | 'respinta' | 'accolta' | null
    /** Prezzo giornaliero del veicolo coinvolto (proxy del valore), se noto. */
    prezzoGiornoVeicolo: number | null
    bookingId: string | null
    /** Veicolo poi riconsegnato (pratiche con codice 40). */
    veicoloRestituito?: boolean
    /** Fatto critico accertato (furto/frode/falsificazione), solo da fonti approvate. */
    accertato?: boolean
}

export interface NoleggioNormalizzato {
    id: string
    data: string | null
    /** Noleggio terminato (data di riconsegna passata, non annullato). */
    concluso: boolean
    /** Concluso senza danni, penali o insoluti. */
    regolare: boolean
    prezzoGiorno: number | null
}

const RE: Array<[Famiglia, RegExp]> = [
    ['furto', /\b(furto|rubat|appropriazion)/i],
    ['mancata_restituzione', /mancat\w* (restituzion|riconsegn)|non restituit|non riconsegnat/i],
    ['recupero_veicolo', /recupero (del )?veicol|carro attrezzi|rimozione/i],
    ['guida_non_autorizzata', /guidator\w* non|conducente non|non citat\w* nel contratto|non autorizzat/i],
    ['fumo', /\bfum(o|at)|sigarett/i],
    ['animali', /\bcan[ei]\b|pelo|animal/i],
    ['carburante', /carburant|benzin|gasolio|rifornim|ricarica|serbatoio/i],
    ['pulizia', /pulizi|lavaggi|sporc|igienizz|immondiz/i],
    ['km', /\bkm\b|chilometr|sforo/i],
    ['ritardo', /ritard|riconsegna tardiv|oltre l'orario|extra ora/i],
    ['multa', /mult[ae]|sanzion|verbal|contravvenz|autovelox|ztl/i],
    ['chargeback', /chargeback|storno|disconosc/i],
    ['insoluto', /insolut|non pagat|mancato pagament/i],
    ['cauzione', /cauzion|preautorizz/i],
    ['documentazione', /document|patente/i],
    ['danno', /dann|graffi|ammacc|urto|incident|rottur|rott[oa]|cerchi|paraurti|specchiett|parabrezz|cristall|carrozzer|tappezzer|sedil|gomm|pneumatic|bomboletta|franchigi|distrutt/i],
]

/** Famiglia di una voce DR7 dal suo nome. `predefinita` se nulla corrisponde. */
export function classificaVoce(label: string, predefinita: Famiglia): Famiglia {
    const t = String(label || '').replace(/^(penale|danno)\s*[-:]\s*/i, '')
    for (const [famiglia, re] of RE) if (re.test(t)) return famiglia
    return predefinita
}

/** Famiglia di un codice EMTN (66 categorie di emtnMobilityRisk.ts). */
export function famigliaCodiceEMTN(codice: number): Famiglia {
    if (codice === 19) return 'chargeback'
    if (codice >= 14 && codice <= 18) return 'contestazione'
    if (codice === 24 || codice === 26 || codice === 58) return 'regolarizzazione'
    if (codice >= 20 && codice <= 25) return 'insoluto'
    if (codice >= 27 && codice <= 36) return 'danno'
    if (codice === 39) return 'mancata_restituzione'
    if (codice === 42) return 'recupero_veicolo'
    if (codice === 37 || codice === 38 || codice === 40 || codice === 41 || codice === 43) return 'ritardo'
    if (codice === 44 || codice === 45) return 'guida_non_autorizzata'
    if (codice === 48 || codice === 8 || codice === 17) return 'km'
    if (codice === 9) return 'carburante'
    if (codice >= 46 && codice <= 52) return 'violazione_contratto'
    if (codice >= 53 && codice <= 57) return 'cauzione'
    if (codice >= 59 && codice <= 64) return 'documentazione'
    if (codice >= 65) return 'violazione_contratto'
    if (codice === 11) return 'penale'
    return 'insoluto'
}

/** Ordine di gravita' tra famiglie, per scegliere la principale di una pratica. */
export const ORDINE_FAMIGLIA: Famiglia[] = [
    'furto', 'frode', 'falsificazione', 'mancata_restituzione', 'recupero_veicolo', 'chargeback',
    'guida_non_autorizzata', 'danno', 'insoluto', 'violazione_contratto', 'fumo', 'ritardo',
    'multa', 'penale', 'animali', 'pulizia', 'carburante', 'cauzione', 'km', 'documentazione',
    'contestazione', 'regolarizzazione',
]

export function statoDaImporti(importo: number, pagato: number, statoDichiarato?: string | null): StatoPagamentoEvento {
    const s = String(statoDichiarato || '').toLowerCase()
    if (importo <= 0) return s === 'paid' ? 'pagato' : 'non_applicabile'
    if (s === 'paid' || pagato >= importo - 0.005) return 'pagato'
    if (s === 'partial' || pagato > 0.005) return 'parziale'
    return 'aperto'
}

export function giorniTra(da: string | null | undefined, a: string | null | undefined): number | null {
    if (!da || !a) return null
    const x = Date.parse(da)
    const y = Date.parse(a)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return Math.max(0, Math.round((y - x) / 86_400_000))
}
