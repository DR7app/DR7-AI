// Configurazione Allerta Meteo PER BUSINESS (31/08/2026).
//
// Prima l'allerta aveva due comportamenti scritti nel codice: TERRA partiva
// con qualunque pioggia, MARE con pioggia O raffiche oltre 30 km/h. Nessuno
// dei due si poteva cambiare dal gestionale, gli altri tre business (Aria,
// Soggiorni, Lavaggio) non avevano allerta affatto, e la citta' era una sola
// per tutti.
//
// Da qui in avanti ogni business ha la SUA configurazione, scritta in
// `centralina_pro_config.config.meteo_config` della riga del business
// (`main` = Terra, poi business_mare/aria/soggiorni/lavaggio):
//   - criterio: solo pioggia, solo vento, oppure entrambi;
//   - tre livelli (Bassa / Media / Elevata) con le loro soglie in mm/h e km/h;
//   - il livello da cui in su si invia;
//   - quante ore avanti guardare e in che fascia oraria si puo' inviare;
//   - quale template Pro spedire.
//
// Gemello lato app: `src/utils/meteoConfig.ts` (le Netlify Functions e il
// bundle dell'app non condividono moduli). Cambiando le regole, cambiarle in
// ENTRAMBI: `src/utils/meteoConfig.test.ts` verifica che i due concordino.
import type { WeatherSnapshot } from './weather-source'

export type MeteoBusiness = 'terra' | 'mare' | 'aria' | 'soggiorni' | 'lavaggio'
export type MeteoCriterio = 'pioggia' | 'vento' | 'entrambi'
export type MeteoLivello = 'bassa' | 'media' | 'elevata'
/** Livello valutato: 'nessuna' quando non si raggiunge nemmeno la soglia bassa. */
export type MeteoEsito = 'nessuna' | MeteoLivello

export const METEO_BUSINESSES: MeteoBusiness[] = ['terra', 'mare', 'aria', 'soggiorni', 'lavaggio']

export const METEO_BUSINESS_LABELS: Record<MeteoBusiness, string> = {
  terra: 'Noleggio Terra',
  mare: 'Noleggio Mare',
  aria: 'Noleggio Aria',
  soggiorni: 'Soggiorni & Ospitalita',
  lavaggio: 'Lavaggio & Meccanica',
}

/** Riga di Centralina Pro del business (stessa mappa di utils/businessConfig.ts). */
export const METEO_BUSINESS_ROW: Record<MeteoBusiness, string> = {
  terra: 'main',
  mare: 'business_mare',
  aria: 'business_aria',
  soggiorni: 'business_soggiorni',
  lavaggio: 'business_lavaggio',
}

export const LIVELLI: MeteoLivello[] = ['bassa', 'media', 'elevata']

export const LIVELLO_LABELS: Record<MeteoEsito, string> = {
  nessuna: 'Nessuna allerta',
  bassa: 'Bassa',
  media: 'Media',
  elevata: 'Elevata',
}

const RANK: Record<MeteoEsito, number> = { nessuna: 0, bassa: 1, media: 2, elevata: 3 }

export function rankLivello(l: MeteoEsito): number {
  return RANK[l] ?? 0
}

export interface MeteoSoglia {
  /** Pioggia prevista in mm/h da cui scatta il livello. */
  pioggia_mm: number
  /** Raffica prevista in km/h da cui scatta il livello. */
  vento_kmh: number
}

export interface MeteoBusinessConfig {
  /** Invio automatico per questo business. `undefined` = mai deciso (vedi cron). */
  attiva?: boolean
  criterio: MeteoCriterio
  /** Si invia da questo livello in su. */
  livello_minimo: MeteoLivello
  soglie: Record<MeteoLivello, MeteoSoglia>
  /** Quante ore di previsione guardare (1-12). */
  ore_avanti: number
  /** Fascia oraria in cui e' lecito inviare (Europe/Rome), estremi inclusi. */
  ora_inizio: number
  ora_fine: number
  /** Nuovo avviso se, nello stesso episodio, il livello peggiora. */
  riavvisa_se_peggiora: boolean
  /** Template di Messaggi di Sistema Pro da spedire. */
  template_key: string
}

/** Soglie di partenza: la "bassa" coincide con le vecchie regole scritte nel codice. */
const SOGLIE_BASE: Record<MeteoLivello, MeteoSoglia> = {
  bassa: { pioggia_mm: 0.2, vento_kmh: 30 },
  media: { pioggia_mm: 2, vento_kmh: 50 },
  elevata: { pioggia_mm: 6, vento_kmh: 70 },
}

export const TEMPLATE_TERRA = 'pro_allerta_meteo'
export const TEMPLATE_MARE = 'pro_allerta_meteo_mare'

/**
 * Valori di partenza per business. Terra e Mare riproducono ESATTAMENTE il
 * comportamento storico (Terra: qualunque pioggia; Mare: pioggia o raffiche
 * >= 30 km/h): chi non entra mai in questa sezione non vede cambiare nulla.
 * Gli altri tre nascono spenti — prima non inviavano, non devono iniziare da
 * soli.
 */
export const METEO_DEFAULTS: Record<MeteoBusiness, MeteoBusinessConfig> = {
  terra: {
    criterio: 'pioggia', livello_minimo: 'bassa', soglie: SOGLIE_BASE,
    ore_avanti: 3, ora_inizio: 8, ora_fine: 21,
    riavvisa_se_peggiora: true, template_key: TEMPLATE_TERRA,
  },
  mare: {
    criterio: 'entrambi', livello_minimo: 'bassa', soglie: SOGLIE_BASE,
    ore_avanti: 3, ora_inizio: 8, ora_fine: 21,
    riavvisa_se_peggiora: true, template_key: TEMPLATE_MARE,
  },
  aria: {
    attiva: false,
    criterio: 'entrambi', livello_minimo: 'bassa',
    // Un elicottero teme il vento molto prima di un'auto: soglie piu' basse.
    soglie: {
      bassa: { pioggia_mm: 0.2, vento_kmh: 25 },
      media: { pioggia_mm: 2, vento_kmh: 40 },
      elevata: { pioggia_mm: 6, vento_kmh: 60 },
    },
    ore_avanti: 6, ora_inizio: 7, ora_fine: 21,
    riavvisa_se_peggiora: true, template_key: TEMPLATE_TERRA,
  },
  soggiorni: {
    attiva: false,
    criterio: 'entrambi', livello_minimo: 'media', soglie: SOGLIE_BASE,
    ore_avanti: 6, ora_inizio: 9, ora_fine: 20,
    riavvisa_se_peggiora: true, template_key: TEMPLATE_TERRA,
  },
  lavaggio: {
    attiva: false,
    criterio: 'pioggia', livello_minimo: 'media', soglie: SOGLIE_BASE,
    ore_avanti: 6, ora_inizio: 8, ora_fine: 19,
    riavvisa_se_peggiora: true, template_key: TEMPLATE_TERRA,
  },
}

/** Business a partire dal `service_type` di una prenotazione (regola di businessScope). */
export function meteoBusinessOfServiceType(serviceType?: string | null): MeteoBusiness {
  switch (String(serviceType || '').toLowerCase()) {
    case 'boat_rental': return 'mare'
    case 'heli_rental': return 'aria'
    case 'stay_rental': return 'soggiorni'
    case 'car_wash':
    case 'mechanical':
    case 'mechanical_service': return 'lavaggio'
    default: return 'terra'
  }
}

export function toMeteoBusiness(v: unknown): MeteoBusiness {
  const s = String(v || '').toLowerCase()
  if ((METEO_BUSINESSES as string[]).includes(s)) return s as MeteoBusiness
  // Retrocompatibilita' con il vecchio parametro `channel` (terra|mare).
  return meteoBusinessOfServiceType(s)
}

/**
 * Numero entro i limiti. Un campo assente o vuoto vale il default: senza il
 * controllo esplicito `Number('')` fa 0, e una soglia mancante diventava zero
 * (quindi livello mai raggiunto) invece di quella di fabbrica.
 */
function numero(v: unknown, fallback: number, min: number, max: number): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Porta un oggetto qualunque (o niente) alla forma completa, riempiendo con i
 * default del business. Le soglie fuori ordine (media sotto la bassa) NON
 * vengono riordinate: la valutazione prende comunque il livello piu' alto
 * raggiunto, quindi una scala storta resta prevedibile invece di essere
 * corretta di nascosto.
 */
export function normalizeMeteoConfig(raw: unknown, business: MeteoBusiness): MeteoBusinessConfig {
  const d = METEO_DEFAULTS[business]
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const soglieRaw = (o.soglie && typeof o.soglie === 'object' ? o.soglie : {}) as Record<string, unknown>
  const soglie = {} as Record<MeteoLivello, MeteoSoglia>
  for (const l of LIVELLI) {
    const s = (soglieRaw[l] && typeof soglieRaw[l] === 'object' ? soglieRaw[l] : {}) as Record<string, unknown>
    soglie[l] = {
      pioggia_mm: numero(s.pioggia_mm, d.soglie[l].pioggia_mm, 0, 200),
      vento_kmh: numero(s.vento_kmh, d.soglie[l].vento_kmh, 0, 250),
    }
  }
  const criterio = (['pioggia', 'vento', 'entrambi'] as string[]).includes(String(o.criterio))
    ? o.criterio as MeteoCriterio : d.criterio
  const livelloMinimo = (LIVELLI as string[]).includes(String(o.livello_minimo))
    ? o.livello_minimo as MeteoLivello : d.livello_minimo
  return {
    attiva: typeof o.attiva === 'boolean' ? o.attiva : d.attiva,
    criterio,
    livello_minimo: livelloMinimo,
    soglie,
    ore_avanti: Math.round(numero(o.ore_avanti, d.ore_avanti, 1, 12)),
    ora_inizio: Math.round(numero(o.ora_inizio, d.ora_inizio, 0, 23)),
    ora_fine: Math.round(numero(o.ora_fine, d.ora_fine, 0, 23)),
    riavvisa_se_peggiora: typeof o.riavvisa_se_peggiora === 'boolean' ? o.riavvisa_se_peggiora : d.riavvisa_se_peggiora,
    template_key: String(o.template_key || d.template_key),
  }
}

/** Livello raggiunto da un valore rispetto alle soglie della sua colonna. */
function livelloPerValore(valore: number, soglia: (l: MeteoLivello) => number): MeteoEsito {
  let out: MeteoEsito = 'nessuna'
  for (const l of LIVELLI) {
    const s = soglia(l)
    if (s > 0 && valore >= s) out = rankLivello(l) > rankLivello(out) ? l : out
  }
  return out
}

export interface MeteoValutazione {
  /** Livello complessivo, secondo il criterio scelto. */
  livello: MeteoEsito
  /** Livello della sola pioggia e del solo vento (mostrati nel gestionale). */
  pioggia: MeteoEsito
  vento: MeteoEsito
  /** true se il livello raggiunge o supera `livello_minimo`. */
  supera: boolean
  /** Frase pronta per la UI e per i log del cron. */
  motivo: string
}

/**
 * Valuta uno snapshot (di norma la PEGGIORE ora della previsione) contro la
 * configurazione del business.
 *
 * Nota sulla pioggia: Open-Meteo puo' dare 0 mm e comunque un codice di
 * pioviggine. Quel caso vale come soglia bassa raggiunta, altrimenti una
 * pioggia leggera non farebbe scattare nulla pur essendo prevista.
 */
export function valutaMeteo(cfg: MeteoBusinessConfig, w: WeatherSnapshot): MeteoValutazione {
  const mm = Math.max(Number(w.precipitationMm || 0), w.rain ? cfg.soglie.bassa.pioggia_mm : 0)
  const kmh = Number(w.windGustKmh || 0)
  const pioggia = livelloPerValore(mm, l => cfg.soglie[l].pioggia_mm)
  const vento = livelloPerValore(kmh, l => cfg.soglie[l].vento_kmh)

  let livello: MeteoEsito
  if (cfg.criterio === 'pioggia') livello = pioggia
  else if (cfg.criterio === 'vento') livello = vento
  else livello = rankLivello(pioggia) >= rankLivello(vento) ? pioggia : vento

  const supera = livello !== 'nessuna' && rankLivello(livello) >= rankLivello(cfg.livello_minimo)

  const pezzi: string[] = []
  if (cfg.criterio !== 'vento') pezzi.push(`pioggia ${mm.toFixed(1)} mm/h (${LIVELLO_LABELS[pioggia].toLowerCase()})`)
  if (cfg.criterio !== 'pioggia') pezzi.push(`raffiche ${Math.round(kmh)} km/h (${LIVELLO_LABELS[vento].toLowerCase()})`)
  const motivo = livello === 'nessuna'
    ? `Sotto soglia: ${pezzi.join(', ')}`
    : `Allerta ${LIVELLO_LABELS[livello]}: ${pezzi.join(', ')}`

  return { livello, pioggia, vento, supera, motivo }
}

/** Ora locale (Europe/Rome) dentro la fascia di invio del business? */
export function dentroFascia(cfg: MeteoBusinessConfig, oraRoma: number): boolean {
  if (cfg.ora_inizio <= cfg.ora_fine) return oraRoma >= cfg.ora_inizio && oraRoma <= cfg.ora_fine
  // Fascia a cavallo della mezzanotte (es. 22 -> 6).
  return oraRoma >= cfg.ora_inizio || oraRoma <= cfg.ora_fine
}

export const METEO_CONFIG_KEY = 'meteo_config'

interface ConfigReader {
  from: (t: string) => {
    select: (c: string) => {
      in: (k: string, v: string[]) => Promise<{ data: Array<{ id: string; config: Record<string, unknown> | null }> | null }>
    }
  }
}

/**
 * Config meteo del business: si legge SOLO la riga del business, senza
 * eredita' da Terra.
 *
 * Qui l'eredita' sarebbe dannosa: appena Terra salva "solo pioggia", il Mare
 * (che deve guardare anche il vento) si ritroverebbe la regola delle auto. I
 * default di `METEO_DEFAULTS` sono gia' quelli giusti business per business.
 * La citta', invece, resta ereditabile — quella la gestisce weather-source.
 */
export async function loadMeteoConfig(supabase: unknown, business: MeteoBusiness): Promise<MeteoBusinessConfig> {
  const rowId = METEO_BUSINESS_ROW[business]
  try {
    const db = supabase as ConfigReader
    const { data } = await db.from('centralina_pro_config').select('id, config').in('id', [rowId])
    const raw = ((data || []).find(r => r.id === rowId)?.config || {})[METEO_CONFIG_KEY]
    return normalizeMeteoConfig(raw, business)
  } catch (e) {
    console.error('[weather-config] loadMeteoConfig failed:', e)
    return normalizeMeteoConfig(undefined, business)
  }
}
