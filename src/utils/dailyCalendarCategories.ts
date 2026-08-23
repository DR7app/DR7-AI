/**
 * Calendario Giornaliero — catalogo delle categorie (2026-08-23).
 *
 * Prima il giorno mostrava solo 4 colonne (Noleggio Terra, Lavaggio, Meccanica,
 * Varie): Mare, Aria, Soggiorni e le Uscite Straordinarie non comparivano
 * affatto, quindi il calendario del giorno non era la giornata dell'azienda ma
 * solo quella di Terra. La stessa logica era duplicata in DailyCalendarTab e
 * DailyCalendarModal: due copie che potevano divergere. Ora la fonte e' una.
 *
 * `service_type` sulle righe bookings:
 *   Terra      rental | car_rental | NULL (storico)
 *   Mare       boat_rental
 *   Aria       heli_rental
 *   Soggiorni  stay_rental
 *   Lavaggio   car_wash
 *   Meccanica  mechanical_service | mechanical
 *   Uscite     uscita_straordinaria  (interne, di OGNI business)
 *   Varie      varie
 */

export type DailyType =
  | 'check-in' | 'check-out'
  | 'mare-in' | 'mare-out'
  | 'aria-in' | 'aria-out'
  | 'soggiorno-in' | 'soggiorno-out'
  | 'lavaggio' | 'meccanica' | 'uscita' | 'varie'

export type DailyCategoryId =
  | 'terra' | 'mare' | 'aria' | 'soggiorni'
  | 'lavaggio' | 'meccanica' | 'uscite' | 'varie'

export interface DailyCategory {
  id: DailyCategoryId
  label: string
  /** Pallino della legenda. */
  dot: string
  /** Bordo sinistro della card. */
  color: string
  gradient: string
  glow: string
  /** Tinta piatta (vista Tab): pastiglia e bordo sinistro. */
  solid: string
  solidBorder: string
}

/** Ordine di visualizzazione: i business nell'ordine della direzione, poi i servizi. */
export const DAILY_CATEGORIES: DailyCategory[] = [
  { id: 'terra',     label: 'Noleggio',   dot: 'from-green-500 to-green-600 shadow-green-500/50',       color: 'border-green-500',   gradient: 'from-green-500/20 to-green-600/10',   glow: 'hover:shadow-green-500/30', solid: 'bg-green-600', solidBorder: 'border-green-600' },
  { id: 'mare',      label: 'Mare',       dot: 'from-cyan-500 to-cyan-600 shadow-cyan-500/50',          color: 'border-cyan-500',    gradient: 'from-cyan-500/20 to-cyan-600/10',     glow: 'hover:shadow-cyan-500/30', solid: 'bg-cyan-600', solidBorder: 'border-cyan-600' },
  { id: 'aria',      label: 'Aria',       dot: 'from-indigo-500 to-indigo-600 shadow-indigo-500/50',    color: 'border-indigo-500',  gradient: 'from-indigo-500/20 to-indigo-600/10', glow: 'hover:shadow-indigo-500/30', solid: 'bg-indigo-600', solidBorder: 'border-indigo-600' },
  { id: 'soggiorni', label: 'Soggiorni',  dot: 'from-amber-500 to-amber-600 shadow-amber-500/50',       color: 'border-amber-500',   gradient: 'from-amber-500/20 to-amber-600/10',   glow: 'hover:shadow-amber-500/30', solid: 'bg-amber-600', solidBorder: 'border-amber-600' },
  { id: 'lavaggio',  label: 'Lavaggio',   dot: 'from-blue-500 to-blue-600 shadow-blue-500/50',          color: 'border-blue-500',    gradient: 'from-blue-500/20 to-blue-600/10',     glow: 'hover:shadow-blue-500/30', solid: 'bg-blue-600', solidBorder: 'border-blue-600' },
  { id: 'meccanica', label: 'Meccanica',  dot: 'from-orange-500 to-orange-600 shadow-orange-500/50',    color: 'border-orange-500',  gradient: 'from-orange-500/20 to-orange-600/10', glow: 'hover:shadow-orange-500/30', solid: 'bg-orange-600', solidBorder: 'border-orange-600' },
  { id: 'uscite',    label: 'Uscite Str.', dot: 'from-teal-500 to-teal-600 shadow-teal-500/50',         color: 'border-teal-500',    gradient: 'from-teal-500/20 to-teal-600/10',     glow: 'hover:shadow-teal-500/30', solid: 'bg-teal-600', solidBorder: 'border-teal-600' },
  { id: 'varie',     label: 'Varie',      dot: 'from-purple-500 to-purple-600 shadow-purple-500/50',    color: 'border-purple-500',  gradient: 'from-purple-500/20 to-purple-600/10', glow: 'hover:shadow-purple-500/30', solid: 'bg-purple-600', solidBorder: 'border-purple-600' },
]

const TYPE_TO_CATEGORY: Record<DailyType, DailyCategoryId> = {
  'check-in': 'terra', 'check-out': 'terra',
  'mare-in': 'mare', 'mare-out': 'mare',
  'aria-in': 'aria', 'aria-out': 'aria',
  'soggiorno-in': 'soggiorni', 'soggiorno-out': 'soggiorni',
  lavaggio: 'lavaggio', meccanica: 'meccanica', uscita: 'uscite', varie: 'varie',
}

export function categoryOf(type: DailyType | string): DailyCategoryId {
  return TYPE_TO_CATEGORY[type as DailyType] || 'varie'
}

export function categoryMeta(id: DailyCategoryId): DailyCategory {
  return DAILY_CATEGORIES.find(c => c.id === id) || DAILY_CATEGORIES[DAILY_CATEGORIES.length - 1]
}

/** Badge sulla card. Ritiro/rientro per i noleggi, nome del servizio per gli altri. */
export function labelOf(type: DailyType | string): string {
  if (String(type).endsWith('-in') || type === 'check-in') return 'USCITE'
  if (String(type).endsWith('-out') || type === 'check-out') return 'RIENTRI'
  switch (type) {
    case 'lavaggio': return 'LAVAGGIO'
    case 'meccanica': return 'MECCANICA'
    case 'uscita': return 'STRAORDINARIA'
    default: return 'VARIE'
  }
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
): DailyType[] {
  const out: DailyType[] = []
  const st: string | undefined = booking?.service_type

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
    // Terra storico usa 'check-in'/'check-out', non 'check-in'/'check-out' col prefisso.
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
  if (type === 'uscita') {
    return d.uscita?.pickup?.time || hhmm(booking.pickup_date) || '09:00'
  }
  return booking.appointment_time || '00:00'
}
