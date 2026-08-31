/**
 * serviziPrenotati — la lista dei servizi scelti su una prenotazione
 * Lavaggio & Meccanica, letta sempre allo stesso modo.
 *
 * Perche' esiste: il sito ha scritto a lungo `booking_details.cart_items`
 * mentre il gestionale legge `booking_details.cartItems`. Risultato: di una
 * prenotazione arrivata dal sito, in admin si vedeva solo la riga
 * `service_name` e il dettaglio (extra, opzioni, sedili) spariva — anche
 * riaprendo la prenotazione per modificarla.
 *
 * Il sito adesso scrive `cartItems`, ma le prenotazioni gia' in banca dati
 * hanno la chiave vecchia: qui si leggono tutte e due, cosi' nessuna
 * prenotazione passata resta senza dettaglio.
 */
import { normalizeSeats } from './seatPlan'

export interface ServizioPrenotato {
  serviceId: string
  serviceName: string
  price: number
  quantity: number
  option?: string | null
  /** Sigle dei sedili scelti sulla pianta (servizi venduti a sedile). */
  seats?: string[]
}

/** I servizi scelti, in ordine: il primo e' il lavaggio principale. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function leggiServiziPrenotati(bookingDetails: any): ServizioPrenotato[] {
  const grezzo = bookingDetails?.cartItems ?? bookingDetails?.cart_items
  if (!Array.isArray(grezzo)) return []
  return grezzo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((item: any) => item && typeof item === 'object')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => {
      const seats = normalizeSeats(item.seats)
      return {
        serviceId: String(item.serviceId ?? ''),
        serviceName: String(item.serviceName ?? ''),
        price: Number(item.price) || 0,
        // Sui servizi a sedile la quantita' e' sempre il numero di sedili:
        // se le due cose non tornano, comanda la pianta.
        quantity: seats.length || Number(item.quantity) || 1,
        option: item.option ?? null,
        ...(seats.length ? { seats } : {}),
      }
    })
}
