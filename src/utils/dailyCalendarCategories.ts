/**
 * Calendario Giornaliero — catalogo delle corsie (2026-08-23, rivisto il 24/08).
 *
 * Prima il giorno mostrava solo 4 colonne fisse (Noleggio Terra, Lavaggio,
 * Meccanica, Varie): Mare, Aria, Soggiorni e le Uscite Straordinarie non
 * comparivano affatto. La stessa logica era duplicata in DailyCalendarTab e
 * DailyCalendarModal: due copie che potevano divergere.
 *
 * 24/08 (direzione): Lavaggio e Meccanica sono UNA cosa sola — Prime Wash — e
 * "Varie" non esiste nell'operativita' reale, quindi nasce spenta. Etichette,
 * colori, ordine e visibilita' si cambiano da Centralina Pro > Calendario
 * Giornaliero, che scrive `centralina_pro_config.config.daily_calendar_categories`.
 *
 * `service_type` sulle righe bookings:
 *   Terra      rental | car_rental | NULL (storico)
 *   Mare       boat_rental
 *   Aria       heli_rental
 *   Soggiorni  stay_rental
 *   Prime Wash car_wash | mechanical | mechanical_service
 *   Uscite     uscita_straordinaria  (interne, di OGNI business)
 *   Varie      varie
 */

export type DailyType =
  | 'check-in' | 'check-out'
  | 'mare-in' | 'mare-out'
  | 'aria-in' | 'aria-out'
  | 'soggiorno-in' | 'soggiorno-out'
  | 'lavaggio' | 'meccanica' | 'uscita' | 'varie'

/** Le corsie di fabbrica; una corsia aggiunta a mano usa `custom:<slug>`. */
export type DailyCategoryId = string

/** Classi Tailwind scritte per esteso: il JIT non vede i template string. */
export interface DailyPaletteEntry {
  key: string
  label: string
  dot: string
  color: string
  gradient: string
  glow: string
  solid: string
  solidBorder: string
  swatch: string
}

export const DAILY_PALETTE: Record<string, DailyPaletteEntry> = {
  green: {
    key: 'green', label: 'Verde',
    dot: 'from-green-500 to-green-600 shadow-green-500/50',
    color: 'border-green-500',
    gradient: 'from-green-500/20 to-green-600/10',
    glow: 'hover:shadow-green-500/30',
    solid: 'bg-green-600',
    solidBorder: 'border-green-600',
    swatch: 'bg-green-500',
  },
  emerald: {
    key: 'emerald', label: 'Smeraldo',
    dot: 'from-emerald-500 to-emerald-600 shadow-emerald-500/50',
    color: 'border-emerald-500',
    gradient: 'from-emerald-500/20 to-emerald-600/10',
    glow: 'hover:shadow-emerald-500/30',
    solid: 'bg-emerald-600',
    solidBorder: 'border-emerald-600',
    swatch: 'bg-emerald-500',
  },
  teal: {
    key: 'teal', label: 'Verde acqua',
    dot: 'from-teal-500 to-teal-600 shadow-teal-500/50',
    color: 'border-teal-500',
    gradient: 'from-teal-500/20 to-teal-600/10',
    glow: 'hover:shadow-teal-500/30',
    solid: 'bg-teal-600',
    solidBorder: 'border-teal-600',
    swatch: 'bg-teal-500',
  },
  cyan: {
    key: 'cyan', label: 'Ciano',
    dot: 'from-cyan-500 to-cyan-600 shadow-cyan-500/50',
    color: 'border-cyan-500',
    gradient: 'from-cyan-500/20 to-cyan-600/10',
    glow: 'hover:shadow-cyan-500/30',
    solid: 'bg-cyan-600',
    solidBorder: 'border-cyan-600',
    swatch: 'bg-cyan-500',
  },
  sky: {
    key: 'sky', label: 'Azzurro',
    dot: 'from-sky-500 to-sky-600 shadow-sky-500/50',
    color: 'border-sky-500',
    gradient: 'from-sky-500/20 to-sky-600/10',
    glow: 'hover:shadow-sky-500/30',
    solid: 'bg-sky-600',
    solidBorder: 'border-sky-600',
    swatch: 'bg-sky-500',
  },
  blue: {
    key: 'blue', label: 'Blu',
    dot: 'from-blue-500 to-blue-600 shadow-blue-500/50',
    color: 'border-blue-500',
    gradient: 'from-blue-500/20 to-blue-600/10',
    glow: 'hover:shadow-blue-500/30',
    solid: 'bg-blue-600',
    solidBorder: 'border-blue-600',
    swatch: 'bg-blue-500',
  },
  indigo: {
    key: 'indigo', label: 'Indaco',
    dot: 'from-indigo-500 to-indigo-600 shadow-indigo-500/50',
    color: 'border-indigo-500',
    gradient: 'from-indigo-500/20 to-indigo-600/10',
    glow: 'hover:shadow-indigo-500/30',
    solid: 'bg-indigo-600',
    solidBorder: 'border-indigo-600',
    swatch: 'bg-indigo-500',
  },
  violet: {
    key: 'violet', label: 'Viola',
    dot: 'from-violet-500 to-violet-600 shadow-violet-500/50',
    color: 'border-violet-500',
    gradient: 'from-violet-500/20 to-violet-600/10',
    glow: 'hover:shadow-violet-500/30',
    solid: 'bg-violet-600',
    solidBorder: 'border-violet-600',
    swatch: 'bg-violet-500',
  },
  purple: {
    key: 'purple', label: 'Porpora',
    dot: 'from-purple-500 to-purple-600 shadow-purple-500/50',
    color: 'border-purple-500',
    gradient: 'from-purple-500/20 to-purple-600/10',
    glow: 'hover:shadow-purple-500/30',
    solid: 'bg-purple-600',
    solidBorder: 'border-purple-600',
    swatch: 'bg-purple-500',
  },
  fuchsia: {
    key: 'fuchsia', label: 'Fucsia',
    dot: 'from-fuchsia-500 to-fuchsia-600 shadow-fuchsia-500/50',
    color: 'border-fuchsia-500',
    gradient: 'from-fuchsia-500/20 to-fuchsia-600/10',
    glow: 'hover:shadow-fuchsia-500/30',
    solid: 'bg-fuchsia-600',
    solidBorder: 'border-fuchsia-600',
    swatch: 'bg-fuchsia-500',
  },
  pink: {
    key: 'pink', label: 'Rosa',
    dot: 'from-pink-500 to-pink-600 shadow-pink-500/50',
    color: 'border-pink-500',
    gradient: 'from-pink-500/20 to-pink-600/10',
    glow: 'hover:shadow-pink-500/30',
    solid: 'bg-pink-600',
    solidBorder: 'border-pink-600',
    swatch: 'bg-pink-500',
  },
  rose: {
    key: 'rose', label: 'Rosa scuro',
    dot: 'from-rose-500 to-rose-600 shadow-rose-500/50',
    color: 'border-rose-500',
    gradient: 'from-rose-500/20 to-rose-600/10',
    glow: 'hover:shadow-rose-500/30',
    solid: 'bg-rose-600',
    solidBorder: 'border-rose-600',
    swatch: 'bg-rose-500',
  },
  red: {
    key: 'red', label: 'Rosso',
    dot: 'from-red-500 to-red-600 shadow-red-500/50',
    color: 'border-red-500',
    gradient: 'from-red-500/20 to-red-600/10',
    glow: 'hover:shadow-red-500/30',
    solid: 'bg-red-600',
    solidBorder: 'border-red-600',
    swatch: 'bg-red-500',
  },
  orange: {
    key: 'orange', label: 'Arancione',
    dot: 'from-orange-500 to-orange-600 shadow-orange-500/50',
    color: 'border-orange-500',
    gradient: 'from-orange-500/20 to-orange-600/10',
    glow: 'hover:shadow-orange-500/30',
    solid: 'bg-orange-600',
    solidBorder: 'border-orange-600',
    swatch: 'bg-orange-500',
  },
  amber: {
    key: 'amber', label: 'Ambra',
    dot: 'from-amber-500 to-amber-600 shadow-amber-500/50',
    color: 'border-amber-500',
    gradient: 'from-amber-500/20 to-amber-600/10',
    glow: 'hover:shadow-amber-500/30',
    solid: 'bg-amber-600',
    solidBorder: 'border-amber-600',
    swatch: 'bg-amber-500',
  },
  lime: {
    key: 'lime', label: 'Lime',
    dot: 'from-lime-500 to-lime-600 shadow-lime-500/50',
    color: 'border-lime-500',
    gradient: 'from-lime-500/20 to-lime-600/10',
    glow: 'hover:shadow-lime-500/30',
    solid: 'bg-lime-600',
    solidBorder: 'border-lime-600',
    swatch: 'bg-lime-500',
  },
  slate: {
    key: 'slate', label: 'Grigio',
    dot: 'from-slate-500 to-slate-600 shadow-slate-500/50',
    color: 'border-slate-500',
    gradient: 'from-slate-500/20 to-slate-600/10',
    glow: 'hover:shadow-slate-500/30',
    solid: 'bg-slate-600',
    solidBorder: 'border-slate-600',
    swatch: 'bg-slate-500',
  },
}

export const DAILY_PALETTE_KEYS = Object.keys(DAILY_PALETTE)

export interface DailyCategory extends DailyPaletteEntry {
  id: DailyCategoryId
  /** true = corsia aggiunta dall'admin. */
  custom?: boolean
  /** `service_type` raccolti dalla corsia (solo custom). */
  serviceTypes?: string[]
  /** Etichetta mostrata in legenda e intestazione colonna. */
  label: string
  /** Corsia attiva: se false non compare ne' in legenda ne' in griglia. */
  enabled: boolean
  colorKey: string
}

/** Catalogo di fabbrica. La config utente lo sovrascrive voce per voce. */
export const DEFAULT_DAILY_CATEGORIES: Array<{ id: DailyCategoryId; label: string; colorKey: string; enabled: boolean }> = [
  { id: 'terra',      label: 'Noleggio',     colorKey: 'green',  enabled: true },
  { id: 'mare',       label: 'Mare',         colorKey: 'cyan',   enabled: true },
  { id: 'aria',       label: 'Aria',         colorKey: 'indigo', enabled: true },
  { id: 'soggiorni',  label: 'Soggiorni',    colorKey: 'amber',  enabled: true },
  { id: 'prime_wash', label: 'Lavaggio & Meccanica',   colorKey: 'blue',   enabled: true },
  { id: 'uscite',     label: 'Uscite Str.',  colorKey: 'teal',   enabled: true },
  // 24/08: "Varie" non esiste nell'operativita' reale — resta disponibile ma
  // spenta, cosi' le eventuali righe storiche service_type='varie' non
  // spariscono dal sistema, semplicemente non occupano una corsia.
  { id: 'varie',      label: 'Varie',        colorKey: 'purple', enabled: false },
]

export interface DailyCategoryConfig {
  id: DailyCategoryId
  label?: string
  colorKey?: string
  enabled?: boolean
  /** true = corsia aggiunta dall'admin, non di fabbrica. */
  custom?: boolean
  /**
   * true = corsia tolta dall'admin. Serve per le corsie DI FABBRICA: senza
   * questo segno tornerebbero da sole al primo caricamento, perche' il
   * catalogo di fabbrica riaggiunge in coda tutto cio' che non e' configurato.
   */
  removed?: boolean
  /**
   * Solo per le corsie personalizzate: quali `service_type` finiscono qui.
   * Senza almeno un valore la corsia esiste ma non raccoglie nulla — la UI
   * lo segnala invece di lasciarla silenziosamente vuota.
   */
  serviceTypes?: string[]
}

/**
 * Servizi predefiniti dei business DR7 (25/08/2026).
 *
 * Una corsia aggiunta a mano non sapeva a cosa agganciarsi: bisognava
 * conoscere e scrivere i `service_type` esatti. Qui c'e' il catalogo, cosi'
 * la corsia si collega scegliendo il business invece di indovinare la stringa.
 * Sono gli stessi valori usati da `categorizeDayBooking` per le corsie di
 * fabbrica: una corsia "Aria" personalizzata raccoglie esattamente cio' che
 * raccoglie la corsia Aria di fabbrica.
 */
export const DAILY_BUSINESS_PRESETS: Array<{ id: string; label: string; serviceTypes: string[] }> = [
  { id: 'terra',      label: 'Noleggio Terra',        serviceTypes: ['rental', 'car_rental'] },
  { id: 'mare',       label: 'Noleggio Mare',         serviceTypes: ['boat_rental'] },
  { id: 'aria',       label: 'Noleggio Aria',         serviceTypes: ['heli_rental'] },
  { id: 'soggiorni',  label: 'Soggiorni',             serviceTypes: ['stay_rental'] },
  { id: 'lavaggio',   label: 'Lavaggio',              serviceTypes: ['car_wash'] },
  { id: 'meccanica',  label: 'Meccanica',             serviceTypes: ['mechanical', 'mechanical_service'] },
  { id: 'uscite',     label: 'Uscite Straordinarie',  serviceTypes: ['uscita_straordinaria'] },
  { id: 'varie',      label: 'Varie',                 serviceTypes: ['varie'] },
]

/** Cosa raccoglie ogni corsia di fabbrica — solo per mostrarlo in configurazione. */
export const FACTORY_LANE_SERVICE_TYPES: Record<DailyCategoryId, string[]> = {
  terra: ['rental', 'car_rental', '(storico senza service_type)'],
  mare: ['boat_rental'],
  aria: ['heli_rental'],
  soggiorni: ['stay_rental'],
  prime_wash: ['car_wash', 'mechanical', 'mechanical_service'],
  uscite: ['uscita_straordinaria'],
  varie: ['varie'],
}

/** Tutti i service_type che compaiono nei preset, per separare i valori "liberi". */
export const PRESET_SERVICE_TYPES: string[] = Array.from(
  new Set(DAILY_BUSINESS_PRESETS.flatMap(p => p.serviceTypes)),
)

/**
 * Preset con lo stesso nome della corsia (accento/maiuscole ignorati), cosi'
 * una corsia nuova chiamata "Aria" nasce gia' collegata a heli_rental invece
 * di restare una colonna vuota.
 */
export function presetForLabel(label: string): { id: string; label: string; serviceTypes: string[] } | undefined {
  const norm = (x: string) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const n = norm(label)
  if (!n) return undefined
  return DAILY_BUSINESS_PRESETS.find(p => {
    const pl = norm(p.label)
    return pl === n || norm(p.id) === n || pl.endsWith(' ' + n)
  })
}

export const CUSTOM_PREFIX = 'custom:'
export function isCustomCategory(id: string): boolean {
  return String(id).startsWith(CUSTOM_PREFIX)
}
/** Slug stabile da un'etichetta, per costruire l'id di una corsia nuova. */
export function customCategoryId(label: string): string {
  const slug = String(label).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  return CUSTOM_PREFIX + (slug || 'corsia')
}

/**
 * Fonde il catalogo di fabbrica con la config salvata. Ordine = quello della
 * config; le voci non ancora configurate restano in coda con i valori di
 * fabbrica, cosi' una categoria nuova non sparisce per chi ha gia' salvato.
 */
export function resolveDailyCategories(saved?: DailyCategoryConfig[] | null): DailyCategory[] {
  const byId = new Map(DEFAULT_DAILY_CATEGORIES.map(d => [d.id, d]))
  const seen = new Set<string>()
  const out: DailyCategory[] = []

  const push = (id: DailyCategoryId, label: string, colorKey: string, enabled: boolean,
                custom = false, serviceTypes: string[] = []) => {
    const pal = DAILY_PALETTE[colorKey] || DAILY_PALETTE.slate
    out.push({ ...pal, id, label, enabled, colorKey: pal.key, custom, serviceTypes })
  }

  for (const s of (Array.isArray(saved) ? saved : [])) {
    if (seen.has(s.id)) continue
    if (s.removed) { seen.add(s.id); continue }
    if (isCustomCategory(s.id)) {
      // Corsia aggiunta dall'admin: non ha una voce di fabbrica alle spalle.
      seen.add(s.id)
      const label = (s.label || '').trim() || 'Corsia'
      let tipi = Array.isArray(s.serviceTypes) ? s.serviceTypes.filter(Boolean) : []
      // 25/08/2026: una corsia salvata PRIMA che `aggiungi()` collegasse da
      // sola i business (es. "Aria", rifatta a mano dopo aver eliminato la
      // corsia di fabbrica) resta con la lista vuota: la colonna c'e', la
      // legenda pure, ma non raccoglie niente — e se la corsia di fabbrica
      // corrispondente e' stata eliminata quelle prenotazioni non compaiono
      // in nessuna colonna. Qui il nome ricollega la corsia al suo business,
      // esattamente come alla creazione.
      if (tipi.length === 0) {
        const preset = presetForLabel(label)
        if (preset) tipi = [...preset.serviceTypes]
      }
      push(s.id, label, s.colorKey || 'slate', s.enabled !== false, true, tipi)
      continue
    }
    const base = byId.get(s.id)
    if (!base) continue
    seen.add(s.id)
    push(s.id, (s.label || '').trim() || base.label, s.colorKey || base.colorKey, s.enabled !== false)
  }
  for (const d of DEFAULT_DAILY_CATEGORIES) {
    if (seen.has(d.id)) continue
    push(d.id, d.label, d.colorKey, d.enabled)
  }
  return out
}

/** Solo le corsie attive, nell'ordine configurato. */
export function enabledDailyCategories(saved?: DailyCategoryConfig[] | null): DailyCategory[] {
  return resolveDailyCategories(saved).filter(c => c.enabled)
}

const TYPE_TO_CATEGORY: Record<DailyType, DailyCategoryId> = {
  'check-in': 'terra', 'check-out': 'terra',
  'mare-in': 'mare', 'mare-out': 'mare',
  'aria-in': 'aria', 'aria-out': 'aria',
  'soggiorno-in': 'soggiorni', 'soggiorno-out': 'soggiorni',
  // 24/08: Lavaggio e Meccanica condividono la corsia Prime Wash.
  lavaggio: 'prime_wash', meccanica: 'prime_wash', uscita: 'uscite', varie: 'varie',
}

export function categoryOf(type: DailyType | string): DailyCategoryId {
  // Una prenotazione instradata su una corsia personalizzata porta gia' l'id
  // nella sua `type` (es. 'custom:transfer'): la corsia e' quella.
  if (isCustomCategory(String(type))) return String(type)
  return TYPE_TO_CATEGORY[type as DailyType] || 'varie'
}

/** Badge sulla card. Ritiro/rientro per i noleggi, nome del servizio per gli altri. */
export function labelOf(type: DailyType | string): string {
  if (isCustomCategory(String(type))) return 'EVENTO'
  if (String(type).endsWith('-in') || type === 'check-in') return 'USCITE'
  if (String(type).endsWith('-out') || type === 'check-out') return 'RIENTRI'
  switch (type) {
    case 'lavaggio': return 'LAVAGGIO'
    case 'meccanica': return 'MECCANICA'
    case 'uscita': return 'STRAORDINARIA'
    default: return 'VARIE'
  }
}

/**
 * Badge della card nel Calendario Giornaliero (25/08/2026).
 *
 * `labelOf` da sola dice solo il MOMENTO ('USCITE' / 'RIENTRI'), identico per
 * Terra, Mare, Aria e Soggiorni: sulla card il business si distingueva dal
 * solo colore, e per capire "di chi" fosse una prenotazione bisognava
 * ricordare la legenda. Qui il nome della corsia entra nel badge.
 *
 * Il momento si aggiunge solo dove esiste davvero una coppia ritiro/rientro.
 * Su lavaggio, meccanica, uscite e corsie personalizzate il nome della corsia
 * dice gia' tutto: ripetere non aggiunge niente e allunga il badge.
 */
export function badgeOf(type: DailyType | string, laneLabel?: string): string {
  const corsia = (laneLabel || '').trim().toUpperCase()
  const t = String(type)
  const dueTempi = t.endsWith('-in') || t.endsWith('-out') || t === 'check-in' || t === 'check-out'
  if (!corsia) return labelOf(type)
  if (!dueTempi) return corsia
  return `${corsia} - ${labelOf(type)}`
}

/** Business a due tempi (ritiro + rientro): service_type -> prefisso del tipo. */
const NOLEGGIO_LIKE: Array<{ match: (st?: string) => boolean; prefix: string }> = [
  { match: st => !st || st === 'rental' || st === 'car_rental', prefix: 'check' },
  { match: st => st === 'boat_rental', prefix: 'mare' },
  { match: st => st === 'heli_rental', prefix: 'aria' },
  { match: st => st === 'stay_rental', prefix: 'soggiorno' },
]

/**
 * Decide in quali righe del giorno finisce una prenotazione.
 * `isSameDay` decide se una data cade nel giorno selezionato (Europe/Rome).
 */
export function categorizeDayBooking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any,
  isSameDay: (d?: string) => boolean,
  /** Corsie personalizzate attive, con i service_type che raccolgono. */
  customLanes: Array<{ id: string; serviceTypes?: string[] }> = [],
): DailyType[] {
  const out: DailyType[] = []
  const st: string | undefined = booking?.service_type

  // Le corsie aggiunte a mano hanno la precedenza: se l'admin ha dirottato un
  // service_type su una corsia propria, quella vince sulle regole di fabbrica.
  const stLower = String(st || '').toLowerCase()
  for (const lane of customLanes) {
    const wanted = (lane.serviceTypes || []).map(x => String(x).toLowerCase().trim()).filter(Boolean)
    if (wanted.length === 0 || !wanted.includes(stLower)) continue
    if (isSameDay(booking.pickup_date) || isSameDay(booking.appointment_date) || isSameDay(booking.dropoff_date)) {
      out.push(lane.id as DailyType)
    }
    return out
  }

  // Uscite Straordinarie: movimenti interni, esistono per OGNI business.
  // Vanno in una corsia propria, non mescolate ai noleggi cliente.
  if (st === 'uscita_straordinaria') {
    if (isSameDay(booking.pickup_date) || isSameDay(booking.appointment_date)) out.push('uscita')
    return out
  }

  // Noleggi (Terra, Mare, Aria, Soggiorni): ritiro e rientro sono due eventi.
  const noleggio = NOLEGGIO_LIKE.find(n => n.match(st))
  if (noleggio) {
    if (isSameDay(booking.pickup_date)) out.push(`${noleggio.prefix}-in` as DailyType)
    if (isSameDay(booking.dropoff_date)) out.push(`${noleggio.prefix}-out` as DailyType)
    return out
  }

  // Lavaggio cliente — esclude i lavaggi di rientro interni/auto-creati.
  if (st === 'car_wash' && isSameDay(booking.appointment_date)
    && booking.customer_name !== 'Lavaggio Rientro'
    && !booking.booking_details?.internal
    && !booking.booking_details?.auto_created) {
    out.push('lavaggio')
  }

  if ((st === 'mechanical_service' || st === 'mechanical') && isSameDay(booking.appointment_date)) {
    out.push('meccanica')
  }

  if (st === 'varie' && (isSameDay(booking.pickup_date) || isSameDay(booking.appointment_date))) {
    out.push('varie')
  }

  return out
}

/** Orario da mostrare in griglia, per tipo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dailyBookingTime(booking: any, type: DailyType | string): string {
  const d = booking?.booking_details || {}
  const hhmm = (iso?: string) => iso
    ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
    : null

  if (String(type).endsWith('-in')) {
    return d.pickupTime || d.pickup_time || hhmm(booking.pickup_date) || '09:00'
  }
  if (String(type).endsWith('-out')) {
    return d.returnTime || d.return_time || hhmm(booking.dropoff_date) || '18:00'
  }
  if (isCustomCategory(String(type))) {
    return booking.appointment_time || d.pickupTime || d.pickup_time
      || hhmm(booking.appointment_date) || hhmm(booking.pickup_date) || '09:00'
  }
  if (type === 'uscita') {
    return d.uscita?.pickup?.time || hhmm(booking.pickup_date) || '09:00'
  }
  return booking.appointment_time || '00:00'
}

/**
 * Righe orarie della giornata (25/08/2026).
 *
 * Le due viste avevano una griglia FISSA 09:00-20:00 costruita una volta sola
 * a livello di modulo, e la card si agganciava alla riga per uguaglianza di
 * stringa. Una prenotazione fuori da quella finestra non finiva in nessuna
 * riga: spariva dal Calendario Giornaliero senza un errore, senza un vuoto,
 * senza niente. Si vedeva soprattutto su Mare/Aria/Soggiorni, dove l'orario
 * non e' quello del banco noleggio (un volo alle 07:30, un rientro alle 21:00)
 * e dove, se l'orario manca del tutto, la data nasce a mezzanotte UTC = 02:00
 * a Roma — di nuovo fuori griglia.
 *
 * Ora la fascia di base resta 09:00-20:00 ma si ALLARGA fino a coprire il
 * primo e l'ultimo evento del giorno. La giornata non puo' piu' nascondere
 * una prenotazione: al massimo mostra qualche riga in piu'.
 */
export function dailyTimeSlots(times: string[] = []): string[] {
  const QUARTO = 15
  const inMinuti = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim())
    if (!m) return null
    const h = Number(m[1]), min = Number(m[2])
    if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
    return h * 60 + min
  }

  let inizio = 9 * 60
  let fine = 20 * 60
  for (const t of times) {
    const v = inMinuti(t)
    if (v === null) continue
    if (v < inizio) inizio = Math.floor(v / QUARTO) * QUARTO
    if (v > fine) fine = Math.ceil(v / QUARTO) * QUARTO
  }

  const out: string[] = []
  for (let m = inizio; m <= fine; m += QUARTO) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out
}

/**
 * Nome leggibile di una corsia che NON e' fra quelle accese (25/08/2026).
 *
 * Serve per dire all'operatore quale corsia manca quando una prenotazione del
 * giorno non ha una colonna dove stare. Senza, il messaggio direbbe 'aria' o
 * 'custom:qualcosa' invece di 'Aria'.
 */
export function laneNameFor(id: string): string {
  const base = DEFAULT_DAILY_CATEGORIES.find(d => d.id === id)
  if (base) return base.label
  if (isCustomCategory(id)) return id.slice(CUSTOM_PREFIX.length).replace(/-/g, ' ') || 'Corsia'
  return id
}

/**
 * Prenotazioni del giorno che non hanno una corsia accesa dove comparire.
 *
 * 25/08: la griglia disegna SOLO le corsie accese. Una prenotazione la cui
 * corsia e' stata spenta o eliminata veniva caricata, categorizzata e poi
 * disegnata da nessuna parte: spariva dalla giornata in silenzio, e dall'esterno
 * sembrava che il calendario non fosse collegato ai business. Ora la giornata
 * lo dice invece di ingoiarla.
 */
export function orphanLaneCounts(
  types: Array<DailyType | string>,
  activeIds: string[],
): Array<{ id: string; label: string; count: number }> {
  const attive = new Set(activeIds)
  const conteggio = new Map<string, number>()
  for (const t of types) {
    const id = categoryOf(t)
    if (attive.has(id)) continue
    conteggio.set(id, (conteggio.get(id) || 0) + 1)
  }
  return [...conteggio.entries()].map(([id, count]) => ({ id, label: laneNameFor(id), count }))
}

/** Chiave JSONB in centralina_pro_config.config dove vive la configurazione. */
export const DAILY_CATEGORIES_CONFIG_KEY = 'daily_calendar_categories'
