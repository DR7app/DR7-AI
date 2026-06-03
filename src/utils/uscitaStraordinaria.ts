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
