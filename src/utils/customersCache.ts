import { invalidateCache } from './dataCache'

/**
 * Da chiamare dopo OGNI scrittura su un cliente (creazione, modifica, import).
 *
 * Le tab tengono l'anagrafica in cache per una finestra breve (dataCache.ts).
 * Senza questa invalidazione, un cliente appena creato nella tab Clienti non
 * compariva nella ricerca cliente del form prenotazione finche' la finestra
 * non scadeva: si aggiungeva la lead e non la si trovava per fare il noleggio.
 */
export function invalidateCustomersCache(): void {
  // Copre 'reservations:customers_extended' e 'reservations:customers_legacy'.
  invalidateCache('reservations:customers')
}
