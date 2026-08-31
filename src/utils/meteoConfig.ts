/**
 * Allerta Meteo — configurazione per business, lato app.
 *
 * Gemello di `netlify/functions/weather-config.ts`, che fa lo stesso lavoro
 * lato server. Duplicato di proposito: il bundle dell'app e quello delle
 * Netlify Functions non condividono moduli (stessa scelta di
 * `businessConfigClient.ts`). Cambiando le regole, cambiarle in ENTRAMBI:
 * `meteoConfig.test.ts` confronta i due file e fallisce se divergono.
 *
 * Serve alla sezione Centralina Pro > Allerta Meteo per mostrare, PRIMA di
 * salvare, che livello darebbero le impostazioni appena toccate. Gli invii
 * veri li decide sempre il server con la sua copia.
 */
import { supabase } from '../supabaseClient'

export type MeteoBusiness = 'terra' | 'mare' | 'aria' | 'soggiorni' | 'lavaggio'
export type MeteoCriterio = 'pioggia' | 'vento' | 'entrambi'
export type MeteoLivello = 'bassa' | 'media' | 'elevata'
export type MeteoEsito = 'nessuna' | MeteoLivello

export const METEO_BUSINESSES: MeteoBusiness[] = ['terra', 'mare', 'aria', 'soggiorni', 'lavaggio']

export const METEO_BUSINESS_LABELS: Record<MeteoBusiness, string> = {
  terra: 'Noleggio Terra',
  mare: 'Noleggio Mare',
  aria: 'Noleggio Aria',
  soggiorni: 'Soggiorni & Ospitalita',
  lavaggio: 'Lavaggio & Meccanica',
}

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

export const CRITERIO_LABELS: Record<MeteoCriterio, string> = {
  pioggia: 'Solo pioggia',
  vento: 'Solo vento',
  entrambi: 'Pioggia e vento',
}

const RANK: Record<MeteoEsito, number> = { nessuna: 0, bassa: 1, media: 2, elevata: 3 }

export function rankLivello(l: MeteoEsito): number {
  return RANK[l] ?? 0
}

export interface MeteoSoglia {
  pioggia_mm: number
  vento_kmh: number
}

export interface MeteoBusinessConfig {
  attiva?: boolean
  criterio: MeteoCriterio
  livello_minimo: MeteoLivello
  soglie: Record<MeteoLivello, MeteoSoglia>
  ore_avanti: number
  ora_inizio: number
  ora_fine: number
  riavvisa_se_peggiora: boolean
  template_key: string
}

const SOGLIE_BASE: Record<MeteoLivello, MeteoSoglia> = {
  bassa: { pioggia_mm: 0.2, vento_kmh: 30 },
  media: { pioggia_mm: 2, vento_kmh: 50 },
  elevata: { pioggia_mm: 6, vento_kmh: 70 },
}

export const TEMPLATE_TERRA = 'pro_allerta_meteo'
export const TEMPLATE_MARE = 'pro_allerta_meteo_mare'

/** Copia esatta dei default del server: vedi weather-config.ts. */
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

/** Business a partire dal `service_type` (regola di businessScope). */
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

export interface MeteoSnapshotLike {
  rain?: boolean
  windGustKmh?: number
  precipitationMm?: number
}

function livelloPerValore(valore: number, soglia: (l: MeteoLivello) => number): MeteoEsito {
  let out: MeteoEsito = 'nessuna'
  for (const l of LIVELLI) {
    const s = soglia(l)
    if (s > 0 && valore >= s) out = rankLivello(l) > rankLivello(out) ? l : out
  }
  return out
}

export interface MeteoValutazione {
  livello: MeteoEsito
  pioggia: MeteoEsito
  vento: MeteoEsito
  supera: boolean
  motivo: string
}

/** Stessa valutazione del server (weather-config.valutaMeteo). */
export function valutaMeteo(cfg: MeteoBusinessConfig, w: MeteoSnapshotLike): MeteoValutazione {
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

export function dentroFascia(cfg: MeteoBusinessConfig, oraRoma: number): boolean {
  if (cfg.ora_inizio <= cfg.ora_fine) return oraRoma >= cfg.ora_inizio && oraRoma <= cfg.ora_fine
  return oraRoma >= cfg.ora_inizio || oraRoma <= cfg.ora_fine
}

export const METEO_CONFIG_KEY = 'meteo_config'

/**
 * Config del business dalla sua riga di centralina_pro_config. Nessuna
 * eredita' da Terra: le soglie del Mare non devono diventare quelle delle auto
 * appena Terra salva (vedi weather-config.ts).
 */
export async function loadMeteoConfigClient(business: MeteoBusiness): Promise<MeteoBusinessConfig> {
  const rowId = METEO_BUSINESS_ROW[business]
  try {
    const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', rowId).maybeSingle()
    const cfg = (data?.config as Record<string, unknown>) || {}
    return normalizeMeteoConfig(cfg[METEO_CONFIG_KEY], business)
  } catch {
    return normalizeMeteoConfig(undefined, business)
  }
}

/**
 * Scrive SOLO la chiave meteo_config nella riga del business, rileggendo la
 * config fresca: quel JSONB ospita anche corsie calendario, PEC e numeri
 * direzione. Upsert perche' la riga di un business mai configurato non esiste.
 */
export async function saveMeteoConfigClient(business: MeteoBusiness, cfg: MeteoBusinessConfig): Promise<void> {
  const rowId = METEO_BUSINESS_ROW[business]
  const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', rowId).maybeSingle()
  const base = (data?.config as Record<string, unknown>) || {}
  const { error } = await supabase
    .from('centralina_pro_config')
    .upsert({ id: rowId, config: { ...base, [METEO_CONFIG_KEY]: cfg } }, { onConflict: 'id' })
  if (error) throw error
}
