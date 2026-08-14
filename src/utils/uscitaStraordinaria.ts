/**
 * Uscita Straordinaria — shared constants & types.
 *
 * An "Uscita Straordinaria" is an internal, non-customer vehicle movement
 * (consegne, ritiri, transfer, carrozzeria, gommista, meccanica, lavaggi,
 * preparazioni, experience, allestimenti, movimentazioni interne...).
 *
 * STORAGE: each vehicle card is persisted as a row in `bookings` with
 * `service_type = 'uscita_straordinaria'`, all cards of one operation sharing
 * the same `booking_details.uscita.group_id`. This reuses the existing
 * availability engine (the car is "occupied"), the calendar (matched by
 * plate/vehicle_id) and the payment/cauzione plumbing for free. Customer-facing
 * flows (fattura, reports revenue, customer WhatsApp, confirmation pages) must
 * EXCLUDE this service_type — same pattern already used for 'Lavaggio Rientro'.
 */

export const USCITA_SERVICE_TYPE = 'uscita_straordinaria' as const

/**
 * 2026-08-14 (richiesta direzione): le Uscite Straordinarie esistono per OGNI
 * business, non solo Terra. `service_type` resta 'uscita_straordinaria' per
 * tutti — cosi' l'esclusione da fatture, report e flussi cliente continua a
 * valere ovunque senza toccare una riga — e il business viaggia su due campi:
 *  - `vehicle_type` (colonna vera, filtrabile lato query)
 *  - `booking_details.uscita.business` (ridondante, ma sopravvive a un
 *    vehicle_type sporco e rende leggibile la riga a occhio nudo)
 * Le righe storiche non hanno ne' l'uno ne' l'altro: assente = Terra.
 */
export const USCITA_BUSINESSES = ['rental', 'boat_rental', 'heli_rental', 'stay_rental', 'car_wash'] as const
export type UscitaBusiness = typeof USCITA_BUSINESSES[number]

/** `vehicle_type` scritto sulla riga bookings per ogni business.
 *
 * Lavaggio & Meccanica lavora sulle STESSE auto del Noleggio Terra, quindi
 * serve un `vehicle_type` proprio ('carwash', non 'car'): senza, un'uscita del
 * lavaggio finirebbe nell'elenco di Terra e viceversa, perche' il business si
 * riconosce proprio da questo campo. */
export const USCITA_VEHICLE_TYPE: Record<UscitaBusiness, string> = {
  rental: 'car',
  boat_rental: 'boat',
  heli_rental: 'helicopter',
  stay_rental: 'stay',
  car_wash: 'carwash',
}

/** Etichette del mezzo, per non chiamare "veicolo" una barca o un alloggio. */
export const USCITA_ASSET_LABELS: Record<UscitaBusiness, { asset: string; assetPlural: string; identifier: string }> = {
  rental: { asset: 'Veicolo', assetPlural: 'Veicoli', identifier: 'Targa' },
  boat_rental: { asset: 'Barca', assetPlural: 'Barche', identifier: 'Matricola' },
  heli_rental: { asset: 'Elicottero', assetPlural: 'Elicotteri', identifier: 'Marche' },
  stay_rental: { asset: 'Alloggio', assetPlural: 'Alloggi', identifier: 'Unita' },
  car_wash: { asset: 'Veicolo', assetPlural: 'Veicoli', identifier: 'Targa' },
}

/** Business che lavorano sulla flotta auto (`vehicles`) invece che su un
 *  catalogo dedicato (`noleggio_catalog`). */
export function uscitaUsaFlottaAuto(serviceType: string | null | undefined): boolean {
  return serviceType === 'rental' || serviceType === 'car_wash' || !serviceType
}

export function isUscitaBusiness(v: string | null | undefined): v is UscitaBusiness {
  return !!v && (USCITA_BUSINESSES as readonly string[]).includes(v)
}

/** Business di una riga uscita. Assente / non riconosciuto = Terra. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function uscitaBusinessOf(booking: any): UscitaBusiness {
  const fromDetails = booking?.booking_details?.uscita?.business
  if (isUscitaBusiness(fromDetails)) return fromDetails
  const vt = booking?.vehicle_type
  const match = (Object.keys(USCITA_VEHICLE_TYPE) as UscitaBusiness[]).find(b => USCITA_VEHICLE_TYPE[b] === vt)
  return match || 'rental'
}

/** L'uscita appartiene al business indicato? (Terra assorbe le righe storiche.) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function uscitaBelongsTo(booking: any, serviceType: string | null | undefined): boolean {
  const business = isUscitaBusiness(serviceType) ? serviceType : 'rental'
  return uscitaBusinessOf(booking) === business
}

/** Predefined autisti (seeded into `customers` tagged metadata.role='autista'). */
export const DEFAULT_AUTISTI = [
  'Salvatore Pintori',
  'Emily Dessì',
  'Alessio Montisci',
  'Roberto Campagnola',
] as const

/** Motivazioni predefinite (admin can also type a custom one). */
export const USCITA_MOTIVAZIONI = [
  'Gommista',
  'Carrozzeria',
  'Meccanica',
  'Transfer per Noleggio',
  'Transfer per Cliente',
  'Lavaggio / Preparazione',
  'Consegna Veicolo',
  'Ritiro Veicolo',
  'Servizio Interno DR7',
  'Allestimento Matrimonio',
  'Servizio Experience',
  'Altro',
] as const

/** Luoghi predefiniti per partenza/destinazione (custom places allowed). */
export const USCITA_LUOGHI = [
  'Sede DR7',
  'Cliente',
  'Aeroporto',
  'Porto',
  'Gommista',
  'Carrozzeria',
  'Officina',
  'Lavaggio',
  'Hotel',
  'Altro',
] as const

/** Servizi extra / experience predefiniti (custom services allowed). */
export const USCITA_SERVIZI_EXTRA = [
  'Champagne',
  'Rose',
  'Allestimento Matrimonio',
  'Transfer Luxury',
  'Consegna Speciale',
  'Ritiro Speciale',
  'Servizio Foto/Video',
  'Altro',
] as const

/** Stato pagamento per singolo veicolo. */
export const USCITA_PAYMENT_STATES = [
  'Non previsto',
  'Da incassare',
  'Già pagato',
  'Pagamento parziale',
] as const
export type UscitaPaymentState = typeof USCITA_PAYMENT_STATES[number]

/** Stato cauzione per singolo veicolo. */
export const USCITA_CAUZIONE_STATES = [
  'Non prevista',
  'Da incassare',
  'Già incassata',
  'Non richiesta',
] as const
export type UscitaCauzioneState = typeof USCITA_CAUZIONE_STATES[number]

/** Stato uscita (mapped onto the booking `status` column on save). */
export const USCITA_STATI = [
  'Programmata',
  'In Corso',
  'Completata',
  'Annullata',
  'Da Verificare',
] as const
export type UscitaStato = typeof USCITA_STATI[number]

/**
 * Map an UscitaStato to the existing `bookings.status` value so the calendar,
 * availability filter and conflict logic keep working unchanged.
 *  - Programmata / Da Verificare → 'pending'   (booked, still blocks the car)
 *  - In Corso                    → 'active'
 *  - Completata                  → 'completed'
 *  - Annullata                   → 'cancelled' (frees the car; cauzione trigger fires)
 */
export function uscitaStatoToBookingStatus(stato: UscitaStato): string {
  switch (stato) {
    case 'In Corso': return 'active'
    case 'Completata': return 'completed'
    case 'Annullata': return 'cancelled'
    case 'Programmata':
    case 'Da Verificare':
    default: return 'pending'
  }
}

export function bookingStatusToUscitaStato(status: string | null | undefined, fallback: UscitaStato = 'Programmata'): UscitaStato {
  switch (status) {
    case 'active': return 'In Corso'
    case 'completed':
    case 'completata': return 'Completata'
    case 'cancelled':
    case 'annullata': return 'Annullata'
    case 'pending': return fallback
    default: return fallback
  }
}

export interface UscitaServizioExtra {
  name: string
  quantity: number
  /** EUR string (admin-typed, gross). */
  price: string
  stato: string
  note_operative: string
  note_integrative: string
}

export interface UscitaPayment {
  state: UscitaPaymentState
  /** EUR string. */
  amount: string
  method: string
  notes: string
}

export interface UscitaCauzione {
  state: UscitaCauzioneState
  /** EUR string. */
  amount: string
  method: string
  notes: string
}

/**
 * One independent vehicle card / tratta. A single Uscita Straordinaria holds
 * an array of these (one row in `bookings` each, sharing the group id).
 */
export interface UscitaVehicleCard {
  /** Local-only id for React keys before persistence. */
  localId: string
  /** In edit mode: the existing bookings.id this card maps to (UPDATE, not INSERT). */
  _editBookingId?: string
  /** The DR7 vehicle being moved. */
  vehicle_id: string
  plate: string
  /** Autisti assigned to THIS card (customer ids tagged 'autista'). */
  autista_ids: string[]
  /**
   * Per-autista "vehicle to drive" override. Defaults to vehicle_id but the
   * operator can pin exactly which car each autista drives (autista_id → vehicle_id).
   */
  vehicle_to_drive: Record<string, string>
  pickup_date: string
  pickup_time: string
  pickup_place: string
  pickup_address: string
  dropoff_date: string
  dropoff_time: string
  dropoff_place: string
  dropoff_address: string
  motivazioni: string[]
  /** Optional linked customer booking (conflict exception applies to it). */
  linked_booking_id: string | null
  payment: UscitaPayment
  cauzione: UscitaCauzione
  servizi_extra: UscitaServizioExtra[]
  note_operative: string
  note_integrative: string
}

/** The full draft edited in the modal. */
export interface UscitaDraft {
  group_id: string
  title: string
  stato: UscitaStato
  /** Autisti available/selected at the header level (union across cards). */
  cards: UscitaVehicleCard[]
}

export function emptyPayment(): UscitaPayment {
  return { state: 'Non previsto', amount: '', method: '', notes: '' }
}

export function emptyCauzione(): UscitaCauzione {
  return { state: 'Non prevista', amount: '', method: '', notes: '' }
}

/** A fresh vehicle card with sensible defaults. `localId` must be supplied by
 *  the caller (Date.now()/random not available in some sandboxed contexts —
 *  callers in the app run in the browser, so they pass crypto/random ids). */
export function emptyVehicleCard(localId: string): UscitaVehicleCard {
  return {
    localId,
    vehicle_id: '',
    plate: '',
    autista_ids: [],
    vehicle_to_drive: {},
    pickup_date: '',
    pickup_time: '',
    pickup_place: '',
    pickup_address: '',
    dropoff_date: '',
    dropoff_time: '',
    dropoff_place: '',
    dropoff_address: '',
    motivazioni: [],
    linked_booking_id: null,
    payment: emptyPayment(),
    cauzione: emptyCauzione(),
    servizi_extra: [],
    note_operative: '',
    note_integrative: '',
  }
}

/** Reconstruct an editable card from a persisted uscita_straordinaria booking row.
 *  Symmetric with how the modal save writes booking_details.uscita. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cardFromUscitaBooking(booking: any, localId: string): UscitaVehicleCard {
  const u = (booking?.booking_details?.uscita || {}) as Record<string, any>
  const base = emptyVehicleCard(localId)
  return {
    ...base,
    _editBookingId: booking.id,
    vehicle_id: booking.vehicle_id || '',
    plate: booking.vehicle_plate || '',
    autista_ids: Array.isArray(u.autista_ids) ? u.autista_ids : [],
    vehicle_to_drive: u.vehicle_to_drive || {},
    pickup_date: u.pickup?.date || '',
    pickup_time: u.pickup?.time || '',
    pickup_place: u.pickup?.place || '',
    pickup_address: u.pickup?.address || '',
    dropoff_date: u.dropoff?.date || '',
    dropoff_time: u.dropoff?.time || '',
    dropoff_place: u.dropoff?.place || '',
    dropoff_address: u.dropoff?.address || '',
    motivazioni: Array.isArray(u.motivazioni) ? u.motivazioni : [],
    linked_booking_id: u.linked_booking_id || null,
    payment: u.payment || base.payment,
    cauzione: u.cauzione || base.cauzione,
    servizi_extra: Array.isArray(u.servizi_extra) ? u.servizi_extra : [],
    note_operative: u.note_operative || '',
    note_integrative: u.note_integrative || '',
  }
}
