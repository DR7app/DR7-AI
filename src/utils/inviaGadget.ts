// Invio dal gestionale (tab che non hanno la logica di ReservationsTab, es.
// Lavaggi): rilegge chi ha gia' ricevuto il gadget su QUALUNQUE prenotazione,
// manda il template Pro e registra l'invio sulla prenotazione.
// 07/11/2026: identita' per id cliente (mai telefono o nome), condivisa con
// ReservationsTab tramite clientiConGadget() e controllaGadgetCliente().
import { supabase } from '../supabaseClient'
import { risolviTelefonoCliente } from './telefonoCliente'
import {
  idDichiarati, emailPrenotazione, idCliente, insiemeGadget, raggruppaPerEmail,
  chiaveEmail, type GadgetInviato, type ClienteIdentita, type PrenotazioneIdentita,
} from './gadgetOmaggio'

export interface PrenotazioneGadget {
  id: string
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  user_id?: string | null
  customer_id?: string | null
  service_type?: string | null
  vehicle_name?: string | null
  vehicle_plate?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
}

const BLOCCO = 100

/** Schede cliente il cui id o account e' tra gli id dati (UUID gia' validati). */
async function schedePerId(ids: string[]): Promise<ClienteIdentita[]> {
  const out: ClienteIdentita[] = []
  for (let i = 0; i < ids.length; i += BLOCCO) {
    const pezzo = ids.slice(i, i + BLOCCO).join(',')
    const { data, error } = await supabase
      .from('customers_extended')
      .select('id, user_id, email')
      .or(`id.in.(${pezzo}),user_id.in.(${pezzo})`)
    if (error) throw error
    out.push(...((data || []) as ClienteIdentita[]))
  }
  return out
}

/** Schede per email esatta (senza distinzione maiuscole), raggruppate per email. */
async function schedePerEmail(emails: string[]): Promise<Map<string, ClienteIdentita[]>> {
  // ilike senza escape dei jolly: i risultati si rifiltrano qui per
  // uguaglianza esatta, quindi un "_" che fa da jolly non allarga nulla.
  const valide = [...new Set(emails.map(chiaveEmail).filter(e => e && !/["\\]/.test(e)))]
  const trovate: ClienteIdentita[] = []
  for (let i = 0; i < valide.length; i += 30) {
    const pezzo = valide.slice(i, i + 30)
    const { data, error } = await supabase
      .from('customers_extended')
      .select('id, user_id, email')
      .or(pezzo.map(e => `email.ilike."${e}"`).join(','))
    if (error) throw error
    trovate.push(...((data || []) as ClienteIdentita[]).filter(c => pezzo.includes(chiaveEmail(c.email))))
  }
  return raggruppaPerEmail(trovate)
}

/** Chiavi ("id:" / "e:") dei clienti che hanno gia' ricevuto il gadget, da ogni servizio. */
export async function clientiConGadget(): Promise<Set<string>> {
  const inviati: PrenotazioneIdentita[] = []
  const PAGINA = 1000
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, user_id, customer_email, cust:booking_details->customer, cid:booking_details->customer_id, gadget:booking_details->gadget_omaggio')
      .not('booking_details->gadget_omaggio', 'is', null)
      .range(da, da + PAGINA - 1)
    if (error) throw error
    for (const r of (data || []) as Array<{ user_id: string | null; customer_email: string | null; cust: unknown; cid: unknown; gadget: GadgetInviato | null }>) {
      inviati.push({ user_id: r.user_id, customer_email: r.customer_email, booking_details: { customer: r.cust, customer_id: r.cid, gadget_omaggio: r.gadget } })
    }
    if (!data || data.length < PAGINA) break
  }
  const ids = new Set<string>()
  const emails = new Set<string>()
  for (const r of inviati) {
    const reg = (r.booking_details?.gadget_omaggio || {}) as GadgetInviato
    const dich = [...idDichiarati(r), ...(reg.clienti || [])]
    dich.forEach(i => ids.add(i))
    if (dich.length === 0 && emailPrenotazione(r)) emails.add(emailPrenotazione(r))
  }
  const clienti = await schedePerId([...ids])
  clienti.forEach(c => { const e = chiaveEmail(c.email); if (e) emails.add(e) })
  const perEmail = await schedePerEmail([...emails])
  return insiemeGadget(inviati, [...clienti, ...[...perEmail.values()].flat()], perEmail)
}

/** Tutti gli id del cliente di questa prenotazione (vuoto = non riconoscibile). */
export async function identitaCliente(b: PrenotazioneIdentita): Promise<string[]> {
  const dich = idDichiarati(b)
  const email = emailPrenotazione(b)
  const perEmail = dich.length === 0 && email ? await schedePerEmail([email]) : new Map<string, ClienteIdentita[]>()
  const base = idCliente(dich, email, [], perEmail)
  if (base.length === 0) return []
  return idCliente(base, '', await schedePerId(base), perEmail)
}

/** Prima di inviare: rilegge chi l'ha gia' ricevuto (ogni servizio) e riconosce il cliente. */
export async function controllaGadgetCliente(b: PrenotazioneIdentita): Promise<{ gia: boolean; clienti: string[]; insieme: Set<string> }> {
  const [insieme, clienti] = await Promise.all([clientiConGadget(), identitaCliente(b)])
  const gia = !!b.booking_details?.gadget_omaggio || clienti.some(i => insieme.has('id:' + i))
  return { gia, clienti, insieme }
}

export type EsitoGadget =
  | { stato: 'inviato'; booking_details: Record<string, unknown>; clienti: string[]; avviso?: string }
  | { stato: 'gia_inviato' | 'senza_telefono' | 'template_spento' | 'errore'; messaggio: string }

export async function inviaGadget(booking: PrenotazioneGadget): Promise<EsitoGadget> {
  if (booking.booking_details?.gadget_omaggio) return { stato: 'gia_inviato', messaggio: 'Gadget già inviato su questa prenotazione.' }
  const controllo = await controllaGadgetCliente(booking)
  if (controllo.gia) {
    return { stato: 'gia_inviato', messaggio: 'Gadget già inviato a questo cliente (anche su un\'altra prenotazione): non si rimanda.' }
  }
  const phone = await risolviTelefonoCliente(booking).catch(() => null)
  if (!phone) return { stato: 'senza_telefono', messaggio: 'Nessun numero cliente — impossibile inviare WhatsApp. Aggiungi il telefono nella scheda cliente o nella prenotazione.' }
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
  const registro: GadgetInviato = {
    inviato_at: new Date().toISOString(), telefono: String(phone), email: booking.customer_email || null,
    clienti: controllo.clienti.length ? controllo.clienti : null,
  }
  const nuovi = { ...(booking.booking_details || {}), gadget_omaggio: registro }
  const { error } = await supabase.from('bookings').update({ booking_details: nuovi }).eq('id', booking.id)
  return { stato: 'inviato', booking_details: nuovi, clienti: controllo.clienti, avviso: error ? 'Messaggio inviato, ma non registrato sulla prenotazione: ' + error.message : undefined }
}
