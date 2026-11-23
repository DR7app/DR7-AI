import { supabase } from '../supabaseClient'
import { authFetch } from './authFetch'

/**
 * Prenotazioni lette ESATTAMENTE come il Calendario Noleggio (CalendarTab):
 * funzione list-bookings (service role) con la finestra di date, e se non
 * risponde lo stesso ripiego diretto su Supabase del calendario.
 * 23/11/2026 (direzione): "deve essere collegato al VERO calendario" — auto
 * di cortesia nel lavaggio e Tour Terra leggono da qui, non da query proprie.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function caricaPrenotazioniCalendario(daIso: string, aIso: string): Promise<any[]> {
  try {
    const res = await authFetch(`/.netlify/functions/list-bookings?from=${encodeURIComponent(daIso)}&to=${encodeURIComponent(aIso)}`)
    if (res.ok) {
      const j = await res.json()
      if (Array.isArray(j?.bookings)) return j.bookings
    }
  } catch { /* ripiego sotto */ }
  const { data, error } = await supabase.from('bookings').select('*')
    .neq('status', 'cancelled').neq('status', 'annullata')
    .lt('pickup_date', aIso)
    .or(`dropoff_date.is.null,dropoff_date.gte.${daIso}`)
  if (error) throw error
  return data || []
}

/** Riga del calendario nella forma che usa utils/autoCortesia. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function perAutoCortesia(b: any) {
  return {
    id: b.id,
    vehicle_id: b.vehicle_id ?? null,
    vehicle_plate: b.vehicle_plate ?? null,
    service_type: b.service_type ?? null,
    status: b.status ?? null,
    payment_status: b.payment_status ?? null,
    payment_method: b.payment_method ?? null,
    pickup_date: b.pickup_date ?? null,
    // Come il calendario: senza riconsegna la barra finisce al ritiro.
    dropoff_date: b.dropoff_date ?? b.pickup_date ?? null,
    bd_vehicle_id: b.booking_details?.vehicle_id ?? null,
    bd_plate: b.booking_details?.vehicle?.plate ?? null,
    bd_link_scade: b.booking_details?.payment_link_expires_at || b.booking_details?.payment_link_created_at || null,
  }
}
