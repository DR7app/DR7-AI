// CARGOS — luoghi (comuni e stati) con il codice ufficiale.
//
// 26/09/2026: CARGOS conosceva ~25 comuni scritti a mano; Sanluri,
// Quartucciu, Assemini... davano "codice ISTAT mancante" anche con
// l'indirizzo scritto giusto, e Oristano aveva il codice soppresso nel 1974.
// Ora i codici vengono dalla Tabella 1 ufficiale di CARGOS (V_COMUNI_STATI),
// salvata in cargos_luoghi / cargos_luoghi_nomi da cargos-luoghi-sync.
//
// Regola d'oro (2026-08-20, direzione): questa e' una dichiarazione alla
// Polizia di Stato. Mai un codice inventato: se il nome non e' univoco o non
// esiste, si dice all'operatore cosa manca invece di indovinare.
//
// Tutto qui e' logica pura: il database entra solo tramite `CercaLuoghi`,
// cosi' gli stessi controlli girano nel gestionale, nelle Netlify functions e
// nei test.

/**
 * Forma confrontabile di un nome di luogo: senza accenti, maiuscolo, apostrofi
 * tipografici uniformati, tutto cio' che non e' lettera o cifra diventa uno
 * spazio. "Sant’Antioco" e "SANT'ANTIOCO" danno "SANT ANTIOCO".
 * La stessa regola riempie cargos_luoghi_nomi: se cambia qui, va rilanciato
 * cargos-luoghi-sync.
 */
export function normalizzaLuogo(nome: string | null | undefined): string {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tutti i nomi con cui un luogo della tabella si puo' cercare (nomi bilingui "BOLZANO/BOZEN"). */
export function nomiDiRicerca(nomeUfficiale: string): string[] {
  const parti = [nomeUfficiale, ...nomeUfficiale.split('/')]
  return Array.from(new Set(parti.map(normalizzaLuogo).filter(Boolean)))
}

export interface RigaLuogoCargos {
  codice: string
  nome: string
  provincia: string | null
  valido_dal: string | null   // aaaa-mm-gg
  valido_al: string | null    // NULL = valido oggi
}

/** Legge il file V_COMUNI_STATI.dat (CODICE#DESCRIZIONE#provincia#DataInizioVal#DataFineVal). */
export function leggiTabellaLuoghi(testo: string): RigaLuogoCargos[] {
  const data = (s: string) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((s || '').trim())
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null
  }
  return testo.split(/\r?\n/).slice(1)
    .map(l => l.split('#'))
    .filter(r => r.length >= 5 && /^\d{9}$/.test(r[0].trim()))
    .map(r => ({
      codice: r[0].trim(),
      nome: r[1].trim(),
      provincia: r[2].trim() || null,
      valido_dal: data(r[3]),
      valido_al: data(r[4]),
    }))
}

// ── Nomi alternativi ─────────────────────────────────────────────────────────
// Stati scritti in inglese o come aggettivo di nazionalita' ("italiana"):
// destinazione = nome ufficiale CARGOS gia' normalizzato. Un test verifica che
// ogni destinazione esista davvero nella tabella ufficiale.
const ALIAS_STATI: Record<string, string> = {
  'ITALY': 'ITALIA', 'ITALIANA': 'ITALIA', 'ITALIANO': 'ITALIA', 'ITA': 'ITALIA',
  'FRANCE': 'FRANCIA', 'FRANCESE': 'FRANCIA',
  'GERMANY': 'GERMANIA', 'DEUTSCHLAND': 'GERMANIA', 'TEDESCA': 'GERMANIA', 'TEDESCO': 'GERMANIA',
  'SPAIN': 'SPAGNA', 'ESPANA': 'SPAGNA', 'SPAGNOLA': 'SPAGNA', 'SPAGNOLO': 'SPAGNA',
  'UK': 'REGNO UNITO', 'UNITED KINGDOM': 'REGNO UNITO', 'ENGLAND': 'REGNO UNITO', 'INGHILTERRA': 'REGNO UNITO',
  'GRAN BRETAGNA': 'REGNO UNITO', 'GREAT BRITAIN': 'REGNO UNITO', 'INGLESE': 'REGNO UNITO',
  'BRITANNICA': 'REGNO UNITO', 'BRITANNICO': 'REGNO UNITO',
  'USA': "STATI UNITI D AMERICA", 'US': "STATI UNITI D AMERICA", 'UNITED STATES': "STATI UNITI D AMERICA",
  'STATI UNITI': "STATI UNITI D AMERICA", 'AMERICANA': "STATI UNITI D AMERICA", 'AMERICANO': "STATI UNITI D AMERICA",
  'SWITZERLAND': 'SVIZZERA', 'SCHWEIZ': 'SVIZZERA', 'SUISSE': 'SVIZZERA',
  'ROMENA': 'ROMANIA', 'RUMENA': 'ROMANIA', 'RUMENO': 'ROMANIA',
  'ALBANESE': 'ALBANIA',
  'MOROCCO': 'MAROCCO', 'MAROCCHINA': 'MAROCCO', 'MAROCCHINO': 'MAROCCO',
  'CHINA': 'CINA', 'CINESE': 'CINA',
  'UKRAINE': 'UCRAINA', 'UCRAINO': 'UCRAINA',
  'POLAND': 'POLONIA', 'POLACCA': 'POLONIA', 'POLACCO': 'POLONIA',
  'OLANDA': 'PAESI BASSI', 'NETHERLANDS': 'PAESI BASSI', 'OLANDESE': 'PAESI BASSI',
  'BELGIUM': 'BELGIO', 'BELGA': 'BELGIO',
  'AUSTRIAN': 'AUSTRIA', 'AUSTRIACA': 'AUSTRIA', 'AUSTRIACO': 'AUSTRIA', 'OSTERREICH': 'AUSTRIA',
  // 'ROMENO' e' anche un comune (TN): niente alias, sarebbe ambiguo.
  'RUSSIA': 'FEDERAZIONE RUSSA', 'RUSSA': 'FEDERAZIONE RUSSA', 'RUSSO': 'FEDERAZIONE RUSSA',
  'SWEDEN': 'SVEZIA', 'SVEDESE': 'SVEZIA',
  'SVIZZERO': 'SVIZZERA',
}

/** Destinazioni degli alias, per il test che le confronta con la tabella ufficiale. */
export const DESTINAZIONI_ALIAS: readonly string[] = Array.from(new Set(Object.values(ALIAS_STATI)))

// Province sarde nate dopo la tabella CARGOS, che usa ancora quelle storiche.
// Servono SOLO a scegliere fra due comuni con lo stesso nome, mai a scartarne uno.
const PROVINCE_EQUIVALENTI: Record<string, string[]> = {
  SU: ['CA', 'OR'], CI: ['CA'], VS: ['CA'], MD: ['CA'], OG: ['NU'], OT: ['SS', 'NU'],
}

const ABBREVIAZIONI: Record<string, string[]> = {
  S: ['SAN', 'SANT', 'SANTA', 'SANTO'],
  STA: ['SANTA'],
  STO: ['SANTO'],
  SS: ['SANTI', 'SANTISSIMA'],
}

// Sigle provinciali ammesse in coda ("Sanluri CA", "Sanluri (CA)").
const SIGLE_PROVINCIA = new Set((
  'AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CI CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OG OR OT PA PC PD PE PG PI PN PO PR PS PT PU PV PZ RA RC RE RG RI RM RN RO SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VS VT VV MD'
).split(' '))

export interface AnalisiTesto {
  /** Nomi da cercare, in ordine di preferenza a gruppi: prima il testo intero, poi senza la sigla in coda. */
  gruppi: string[][]
  provinciaInCoda: string | null
  codiceCatastale: boolean
}

function espandiAbbreviazioni(norm: string): string[] {
  const token = norm.split(' ')
  let varianti: string[][] = [[]]
  let espansi = 0
  for (const t of token) {
    const alt = ABBREVIAZIONI[t]
    if (alt && espansi < 2 && token.length > 1) {
      espansi++
      varianti = varianti.flatMap(v => alt.map(a => [...v, a]))
    } else {
      varianti = varianti.map(v => [...v, t])
    }
  }
  return varianti.map(v => v.join(' '))
}

function varianti(norm: string): string[] {
  if (!norm) return []
  const base = [norm, ...espandiAbbreviazioni(norm)]
  const alias = ALIAS_STATI[norm]
  if (alias) base.push(alias)
  return Array.from(new Set(base))
}

/** Scompone il testo scritto dall'operatore nei nomi da cercare. */
export function analizzaTesto(testo: string | null | undefined): AnalisiTesto {
  const grezzo = String(testo || '').trim()
  if (/^[A-Za-z]\d{3}$/.test(grezzo)) {
    return { gruppi: [], provinciaInCoda: null, codiceCatastale: true }
  }
  // Un CAP davanti ("09025 Sanluri") non fa parte del nome.
  const norm = normalizzaLuogo(grezzo).replace(/^\d{5} /, '')
  const gruppi: string[][] = [varianti(norm)]
  let provinciaInCoda: string | null = null
  const coda = /^(.+) ([A-Z]{2})$/.exec(norm)
  if (coda && SIGLE_PROVINCIA.has(coda[2])) {
    provinciaInCoda = coda[2]
    gruppi.push(varianti(coda[1]))
  }
  return { gruppi: gruppi.filter(g => g.length), provinciaInCoda, codiceCatastale: false }
}

export type EsitoLuogo =
  | { esito: 'trovato'; codice: string; nome: string; provincia: string | null }
  | { esito: 'ambiguo'; candidati: { codice: string; nome: string; provincia: string | null }[] }
  | { esito: 'non_trovato'; motivo: string }

export interface OpzioniLuogo {
  /** Provincia scritta dall'operatore: serve solo a scegliere fra omonimi. */
  provincia?: string | null
  /** Data a cui il luogo deve esistere (nascita). Assente = preferisce i luoghi validi oggi. */
  alla?: Date | null
  soloStati?: boolean
  soloComuni?: boolean
}

function validoAlla(r: RigaLuogoCargos, giorno: string): boolean {
  return (!r.valido_dal || r.valido_dal <= giorno) && (!r.valido_al || r.valido_al >= giorno)
}

function isoGiorno(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Sceglie il luogo fra le righe trovate per i nomi di `analizzaTesto`.
 * `righePerNome` = per ogni nome normalizzato, le righe della tabella.
 */
export function scegliLuogo(
  testo: string | null | undefined,
  righePerNome: ReadonlyMap<string, RigaLuogoCargos[]>,
  opts: OpzioniLuogo = {},
): EsitoLuogo {
  const analisi = analizzaTesto(testo)
  if (analisi.codiceCatastale) {
    return { esito: 'non_trovato', motivo: `"${String(testo).trim()}" e un codice catastale: serve il nome del comune` }
  }
  if (!analisi.gruppi.length) return { esito: 'non_trovato', motivo: 'luogo non indicato' }

  for (const gruppo of analisi.gruppi) {
    const perCodice = new Map<string, RigaLuogoCargos>()
    for (const nome of gruppo) for (const r of righePerNome.get(nome) || []) perCodice.set(r.codice, r)
    let righe = Array.from(perCodice.values())
    if (opts.soloStati) righe = righe.filter(r => r.provincia === 'ES')
    if (opts.soloComuni) righe = righe.filter(r => r.provincia !== 'ES')
    if (!righe.length) continue

    if (opts.alla) {
      const giorno = isoGiorno(opts.alla)
      righe = righe.filter(r => validoAlla(r, giorno))
      if (!righe.length) {
        return { esito: 'non_trovato', motivo: `"${String(testo).trim()}" non esisteva con questo nome alla data indicata` }
      }
    } else {
      const oggi = righe.filter(r => !r.valido_al)
      if (oggi.length) righe = oggi
    }

    if (righe.length > 1) {
      const sigla = String(opts.provincia || analisi.provinciaInCoda || '').trim().toUpperCase()
      if (sigla) {
        const ammesse = [sigla, ...(PROVINCE_EQUIVALENTI[sigla] || [])]
        const stessa = righe.filter(r => ammesse.includes(String(r.provincia || '')))
        if (stessa.length === 1) righe = stessa
      }
    }

    if (righe.length === 1) {
      const r = righe[0]
      return { esito: 'trovato', codice: r.codice, nome: r.nome, provincia: r.provincia }
    }
    return {
      esito: 'ambiguo',
      candidati: righe.map(r => ({ codice: r.codice, nome: r.nome, provincia: r.provincia }))
        .sort((a, b) => String(a.provincia).localeCompare(String(b.provincia))),
    }
  }
  return { esito: 'non_trovato', motivo: `"${String(testo).trim()}" non risulta nella tabella ufficiale CARGOS` }
}

/** Dato il testo, cerca le righe nel database: nome normalizzato -> righe. `null` = database non raggiungibile. */
export type CercaLuoghi = (nomiNormalizzati: string[]) => Promise<Map<string, RigaLuogoCargos[]> | null>

/** Risoluzione singola (form cliente, report). */
export async function risolviLuogo(cerca: CercaLuoghi, testo: string | null | undefined, opts: OpzioniLuogo = {}): Promise<EsitoLuogo | null> {
  const nomi = analizzaTesto(testo).gruppi.flat()
  const trovati = nomi.length ? await cerca(nomi) : new Map<string, RigaLuogoCargos[]>()
  if (!trovati) return null
  return scegliLuogo(testo, trovati, opts)
}

// ── Adattatore Supabase (gestionale e functions) ─────────────────────────────
export interface ClienteSupabaseMinimo {
  from: (tabella: string) => {
    select: (colonne: string) => {
      in: (colonna: string, valori: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
    }
  }
}

export function creaCercaSupabase(client: ClienteSupabaseMinimo): CercaLuoghi {
  return async (nomi) => {
    const unici = Array.from(new Set(nomi.filter(Boolean)))
    const perNome = new Map<string, RigaLuogoCargos[]>()
    if (!unici.length) return perNome
    const coppie: { nome_norm: string; codice: string }[] = []
    for (let i = 0; i < unici.length; i += 150) {
      const { data, error } = await client.from('cargos_luoghi_nomi').select('nome_norm, codice').in('nome_norm', unici.slice(i, i + 150))
      if (error) return null
      coppie.push(...((data || []) as { nome_norm: string; codice: string }[]))
    }
    const codici = Array.from(new Set(coppie.map(c => c.codice)))
    const perCodice = new Map<string, RigaLuogoCargos>()
    for (let i = 0; i < codici.length; i += 150) {
      const { data, error } = await client.from('cargos_luoghi').select('codice, nome, provincia, valido_dal, valido_al').in('codice', codici.slice(i, i + 150))
      if (error) return null
      for (const r of (data || []) as RigaLuogoCargos[]) perCodice.set(r.codice, r)
    }
    for (const c of coppie) {
      const r = perCodice.get(c.codice)
      if (!r) continue
      perNome.set(c.nome_norm, [...(perNome.get(c.nome_norm) || []), r])
    }
    return perNome
  }
}

// ── Risolutore con cache (record CARGOS, sincroni) ───────────────────────────
// I record CARGOS si costruiscono in modo sincrono: prima si caricano in un
// colpo solo tutti i nomi che serviranno (`precarica`), poi `risolvi` legge
// dalla cache. Se la tabella ufficiale non e' ancora caricata o il database
// non risponde, si torna all'elenco storico scritto a mano: lo stesso
// comportamento di prima, mai peggio.

/** Elenco storico (pre 26/09/2026), usato SOLO se la tabella ufficiale manca. Oristano corretto. */
export const LUOGHI_STORICI: Readonly<Record<string, string>> = {
  'CAGLIARI': '420092009', 'SASSARI': '420090064', 'NUORO': '420091051',
  'ORISTANO': '420095038', "QUARTU SANT'ELENA": '420092051', 'OLBIA': '420090047',
  'ALGHERO': '420090003', 'CARBONIA': '420092012', 'IGLESIAS': '420092033',
  'SELARGIUS': '420092068', 'MONSERRATO': '420092109', 'VILLACIDRO': '420092092',
  'SANLURI': '420092057', 'LANUSEI': '420091037',
  'ROMA': '412058091', 'MILANO': '403015146', 'TORINO': '401001272',
  'NAPOLI': '415063049', 'FIRENZE': '409048017', 'BOLOGNA': '408037006',
  'PALERMO': '419082053', 'GENOVA': '407010025', 'BARI': '416072006',
  'CATANIA': '419087015', 'VENEZIA': '405027042',
  'ITALIA': '100000100', 'ITALY': '100000100',
  'FRANCIA': '100000215', 'FRANCE': '100000215',
  'GERMANIA': '100000216', 'GERMANY': '100000216',
}

export class RisolutoreLuoghi {
  private cache = new Map<string, RigaLuogoCargos[]>()
  private cercati = new Set<string>()
  /** false = tabella ufficiale non disponibile: si usa l'elenco storico. */
  tabellaDisponibile = false

  private cerca: CercaLuoghi
  private avvisa: (msg: string) => void

  constructor(cerca: CercaLuoghi, avvisa: (msg: string) => void = () => {}) {
    this.cerca = cerca
    this.avvisa = avvisa
  }

  async precarica(testi: (string | null | undefined)[]): Promise<void> {
    // ITALIA c'e' sempre: se non si trova, la tabella e' vuota o irraggiungibile.
    const nomi = Array.from(new Set(['ITALIA', ...testi.flatMap(t => analizzaTesto(t).gruppi.flat())]))
      .filter(n => !this.cercati.has(n))
    if (!nomi.length) return
    const trovati = await this.cerca(nomi)
    if (!trovati) {
      this.avvisa('[luoghiCargos] tabella luoghi non raggiungibile: uso l elenco storico')
      return
    }
    for (const n of nomi) {
      this.cercati.add(n)
      const r = trovati.get(n)
      if (r) this.cache.set(n, r)
    }
    this.tabellaDisponibile = this.cache.has('ITALIA')
    if (!this.tabellaDisponibile) this.avvisa('[luoghiCargos] tabella luoghi vuota: uso l elenco storico')
  }

  risolvi(testo: string | null | undefined, opts: OpzioniLuogo = {}): EsitoLuogo {
    if (!this.tabellaDisponibile) {
      const codice = LUOGHI_STORICI[String(testo || '').toUpperCase().trim()]
      if (codice) return { esito: 'trovato', codice, nome: String(testo).toUpperCase().trim(), provincia: null }
      return { esito: 'non_trovato', motivo: `"${String(testo || '').trim()}" non riconosciuto (tabella ufficiale CARGOS non ancora caricata)` }
    }
    return scegliLuogo(testo, this.cache, opts)
  }

  /** Codice per il record, o '' se non trovato / ambiguo (mai inventato). */
  codice(testo: string | null | undefined, opts: OpzioniLuogo = {}): string {
    const e = this.risolvi(testo, opts)
    return e.esito === 'trovato' ? e.codice : ''
  }
}

/** Messaggio per l'operatore su un luogo non utilizzabile. */
export function spiegaLuogo(campo: string, testo: string | null | undefined, e: EsitoLuogo): string | null {
  if (e.esito === 'trovato') return null
  if (e.esito === 'ambiguo') {
    const nome = e.candidati[0]?.nome || String(testo || '').toUpperCase()
    const prov = e.candidati.map(c => c.provincia === 'ES' ? 'stato estero' : c.provincia).join(' o ')
    return `${campo}: "${String(testo || '').trim()}" corrisponde a piu luoghi (${nome}: ${prov}) — indica la provincia`
  }
  return `${campo}: ${e.motivo}`
}

/** Data aaaa-mm-gg o gg/mm/aaaa -> Date (mezzogiorno, niente sorprese di fuso). */
export function dataDaTesto(s: string | null | undefined): Date | null {
  const t = String(s || '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12)
  return null
}
