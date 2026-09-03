import { supabase } from '../supabaseClient'
import { logger } from './logger'

/**
 * Il telefono del cliente di una prenotazione, cercato anche in anagrafica.
 *
 * 03/09/2026 — perche' esiste. Il bottone "Pronta" del Noleggio leggeva SOLO
 * `bookings.customer_phone` e `booking_details.customer.phone`. Sono due copie
 * scattate al momento della prenotazione: se l'operatore ha scelto un cliente
 * gia' in anagrafica senza ridigitare il numero, sulla prenotazione non c'e'
 * niente, e il bottone rispondeva "nessun numero" mentre il numero era nella
 * scheda cliente, sotto gli occhi di chi cliccava.
 *
 * L'arricchimento che la tab fa in memoria non basta: la mappa dei clienti e'
 * indicizzata su `customers_extended.id`, mentre le prenotazioni del sito si
 * agganciano con `user_id` (l'utente auth). Quelle righe non si incontrano mai.
 *
 * Ordine di ricerca (lo stesso di CARGOS, per gli stessi motivi):
 *   1. la prenotazione stessa
 *   2. `customers_extended.user_id` (prenotazioni dal sito)
 *   3. `customers_extended.id` (prenotazioni create dal gestionale)
 *   4. email con `ilike` — con `eq` una maiuscola nell'email non trova nulla
 *
 * MAI per nome: un omonimo riceverebbe il messaggio di un altro cliente.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PrenotazioneConCliente {
  user_id?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
}

async function telefonoDaColonna(colonna: 'user_id' | 'id', valore: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('customers_extended')
    .select('telefono')
    .eq(colonna, valore)
    .not('telefono', 'is', null)
    .limit(1)
  if (error) { logger.warn('[telefonoCliente] lookup', colonna, 'fallito:', error.message); return null }
  return data?.[0]?.telefono || null
}

export async function risolviTelefonoCliente(booking: PrenotazioneConCliente): Promise<string | null> {
  const bd = booking.booking_details || {}
  const suPrenotazione = booking.customer_phone || bd.customer?.phone || bd.phone
  if (suPrenotazione) return String(suPrenotazione).trim()

  if (booking.user_id && UUID.test(booking.user_id)) {
    const tel = await telefonoDaColonna('user_id', booking.user_id)
    if (tel) return String(tel).trim()
  }

  const custId = bd.customer?.customerId || bd.customer_id
  if (custId && UUID.test(String(custId))) {
    const tel = await telefonoDaColonna('id', String(custId))
    if (tel) return String(tel).trim()
  }

  const email = booking.customer_email || bd.customer?.email || bd.email
  if (email) {
    const { data, error } = await supabase
      .from('customers_extended')
      .select('telefono')
      .ilike('email', String(email).trim())
      .not('telefono', 'is', null)
      .limit(2)
    if (error) logger.warn('[telefonoCliente] lookup email fallito:', error.message)
    // Due clienti con la stessa email non si distinguono: meglio nessun
    // numero che il numero della persona sbagliata.
    else if (data && data.length === 1) return String(data[0].telefono).trim()
  }

  return null
}
