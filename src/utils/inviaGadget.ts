// Invio dal gestionale (tab che non hanno la logica di ReservationsTab, es.
// Lavaggi): rilegge chi ha gia' ricevuto il gadget su QUALUNQUE prenotazione,
// manda il template Pro e registra l'invio sulla prenotazione.
import { supabase } from '../supabaseClient'
import { risolviTelefonoCliente } from './telefonoCliente'
import { chiaviPersona, type GadgetInviato } from './gadgetOmaggio'

export interface PrenotazioneGadget {
  id: string
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  user_id?: string | null
  service_type?: string | null
  vehicle_name?: string | null
  vehicle_plate?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
}

export async function personeConGadget(): Promise<Set<string>> {
  const chiavi = new Set<string>()
  const PAGINA = 1000
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, customer_phone, customer_email, gadget:booking_details->gadget_omaggio')
      .not('booking_details->gadget_omaggio', 'is', null)
      .range(da, da + PAGINA - 1)
    if (error) throw error
    for (const r of (data || []) as Array<{ customer_phone: string | null; customer_email: string | null; gadget: GadgetInviato | null }>) {
      chiaviPersona(r.customer_phone, r.customer_email, r.gadget?.telefono, r.gadget?.email).forEach(k => chiavi.add(k))
    }
    if (!data || data.length < PAGINA) break
  }
  return chiavi
}

export type EsitoGadget =
  | { stato: 'inviato'; booking_details: Record<string, unknown>; avviso?: string }
  | { stato: 'gia_inviato' | 'senza_telefono' | 'template_spento' | 'errore'; messaggio: string }

export async function inviaGadget(booking: PrenotazioneGadget): Promise<EsitoGadget> {
  if (booking.booking_details?.gadget_omaggio) return { stato: 'gia_inviato', messaggio: 'Gadget già inviato su questa prenotazione.' }
  const phone = await risolviTelefonoCliente(booking).catch(() => null)
  if (!phone) return { stato: 'senza_telefono', messaggio: 'Nessun numero cliente — impossibile inviare WhatsApp. Aggiungi il telefono nella scheda cliente o nella prenotazione.' }
  const giaRicevuto = await personeConGadget()
  if (chiaviPersona(String(phone), booking.customer_phone, booking.customer_email).some(k => giaRicevuto.has(k))) {
    return { stato: 'gia_inviato', messaggio: 'Gadget già inviato a questo cliente (anche su un\'altra prenotazione): non si rimanda.' }
  }
  const cust = (booking.booking_details?.customer || {}) as Record<string, string | undefined>
  const nomeCompleto = String(
    booking.customer_name || cust.fullName || cust.full_name
    || [cust.firstName, cust.lastName].filter(Boolean).join(' ') || '',
  ).trim()
  const nome = nomeCompleto.split(/\s+/)[0] || 'Cliente'
  const bookingRef = String(booking.id || '').substring(0, 8).toUpperCase()
  const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customPhone: String(phone),
      templateKey: 'gadget_omaggio',
      booking: { service_type: booking.service_type || 'car_rental' },
      templateVars: {
        customer_name: nome, nome, name: nome,
        booking_id: bookingRef, booking_ref: bookingRef,
        vehicle_name: booking.vehicle_name || '',
        vehicle_plate: booking.vehicle_plate || '', targa: booking.vehicle_plate || '',
      },
      skipHeader: true,
    }),
  }).catch(() => null)
  const waResult = waResp ? await waResp.json().catch(() => ({})) : {}
  if (waResult?.skipped) return { stato: 'template_spento', messaggio: 'Messaggio non inviato: template "Gadget in Omaggio" mancante o spento in Messaggi di Sistema Pro > Marketing.' }
  if (!waResp || !waResp.ok) return { stato: 'errore', messaggio: 'Invio WhatsApp fallito' }
  const registro: GadgetInviato = { inviato_at: new Date().toISOString(), telefono: String(phone), email: booking.customer_email || null }
  const nuovi = { ...(booking.booking_details || {}), gadget_omaggio: registro }
  const { error } = await supabase.from('bookings').update({ booking_details: nuovi }).eq('id', booking.id)
  return { stato: 'inviato', booking_details: nuovi, avviso: error ? 'Messaggio inviato, ma non registrato sulla prenotazione: ' + error.message : undefined }
}
