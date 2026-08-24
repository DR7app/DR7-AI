/**
 * Business scope — a quale linea di business appartiene una riga.
 *
 * PERCHE' ESISTE (24/08/2026, richiesta direzione):
 * "ogni categoria deve essere ben differenziata e non prendere dalle altre:
 *  Terra e' Terra, Mare e' Mare". Diverse tab (Danni & Penali, Multe,
 * Magazzino, GPS) erano registrate UNA sola volta e riusate in tutte le
 * sezioni: aprendole dal Mare si vedevano i dati del Noleggio Terra, e la
 * sidebar rimbalzava sulla sezione Terra perche' la tab attiva era la stessa.
 *
 * Qui sta la regola UNICA per dire "questa prenotazione e' di quale business",
 * cosi' non viene riscritta (diversa) in ogni tab.
 *
 * REGOLA: il business sta su `bookings.service_type`.
 *  - Terra:    NULL / '' / 'car_rental' / 'rental'   (storico: il campo nasce vuoto)
 *  - Mare:     'boat_rental'
 *  - Aria:     'heli_rental'
 *  - Soggiorni:'stay_rental'
 *  - Lavaggio: 'car_wash' / 'mechanical' / 'mechanical_service'  ([[prime_wash_scope]])
 *  - Uscite Straordinarie: service_type comune, business su vehicle_type /
 *    booking_details.uscita.business (vedi utils/uscitaStraordinaria.ts).
 */
import { USCITA_SERVICE_TYPE, uscitaBusinessOf } from './uscitaStraordinaria'

export const BUSINESSES = ['rental', 'boat_rental', 'heli_rental', 'stay_rental', 'car_wash'] as const
export type Business = typeof BUSINESSES[number]

/** Etichetta leggibile, come nel menu. */
export const BUSINESS_LABELS: Record<Business, string> = {
  rental: 'Noleggio Terra',
  boat_rental: 'Noleggio Mare',
  heli_rental: 'Noleggio Aria',
  stay_rental: 'Soggiorni & Ospitalita',
  car_wash: 'Lavaggio & Meccanica',
}

/** Nome del mezzo per business: una barca non e' un "veicolo". */
export const BUSINESS_ASSET_LABELS: Record<Business, { asset: string; assetPlural: string }> = {
  rental: { asset: 'Veicolo', assetPlural: 'Veicoli' },
  boat_rental: { asset: 'Barca', assetPlural: 'Barche' },
  heli_rental: { asset: 'Elicottero', assetPlural: 'Elicotteri' },
  stay_rental: { asset: 'Alloggio', assetPlural: 'Alloggi' },
  car_wash: { asset: 'Veicolo', assetPlural: 'Veicoli' },
}

/** I business che NON usano la flotta auto ma il catalogo `noleggio_catalog`. */
export function usaCatalogoDedicato(business: Business | string | null | undefined): boolean {
  return business === 'boat_rental' || business === 'heli_rental' || business === 'stay_rental'
}

/** Normalizza qualunque stringa arrivi da una prop in un Business. */
export function toBusiness(v: string | null | undefined): Business {
  if (!v) return 'rental'
  if ((BUSINESSES as readonly string[]).includes(v)) return v as Business
  if (v === 'car_rental') return 'rental'
  if (v === 'mechanical' || v === 'mechanical_service') return 'car_wash'
  return 'rental'
}

/** Business di una riga `bookings`. Campo assente/vuoto = Terra (storico). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function businessOfBooking(booking: any): Business {
  const st = String(booking?.service_type || '').trim()
  if (st === USCITA_SERVICE_TYPE) return toBusiness(uscitaBusinessOf(booking))
  if (!st) return 'rental'
  return toBusiness(st)
}

/** La riga appartiene al business indicato? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bookingBelongsTo(booking: any, business: Business | string | null | undefined): boolean {
  return businessOfBooking(booking) === toBusiness(business)
}
