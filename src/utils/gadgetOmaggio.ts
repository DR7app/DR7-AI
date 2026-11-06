// 26/10/2026 (direzione): bottone "Gadget" sulle prenotazioni di ogni servizio.
// Il WhatsApp "gadget in omaggio" parte UNA volta per CLIENTE: se torna per un
// lavaggio o un altro noleggio, non riparte.
//
// 07/11/2026: l'identita' era telefono (ultime 9 cifre) o email, e la tab
// Lavaggi guardava solo la prenotazione stessa. Caso Nicola Talli: gadget
// mandato dal Noleggio, il Lavaggio lo riproponeva e lo lasciava rimandare.
// Ora il cliente si riconosce dagli id (scheda cliente / account), MAI per
// telefono o nome; l'email esatta solo se la prenotazione non ha nessun id e
// l'email appartiene a una sola scheda cliente. Stessa regola su entrambe le tab.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const uuid = (v: unknown): string => {
  const s = String(v ?? '').trim()
  return UUID.test(s) ? s.toLowerCase() : ''
}

export const chiaveEmail = (v: string | null | undefined): string => {
  const e = String(v || '').trim().toLowerCase()
  return e.includes('@') ? e : ''
}

/** Registrazione dell'invio salvata in booking_details.gadget_omaggio. */
export interface GadgetInviato {
  inviato_at: string
  telefono?: string | null
  email?: string | null
  operatore?: string | null
  /** 07/11/2026: id del cliente (scheda customers_extended e account) al momento dell'invio. */
  clienti?: string[] | null
}

export interface PrenotazioneIdentita {
  user_id?: string | null
  customer_id?: string | null
  customer_email?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details?: any
}

/** Scheda cliente minima: id della scheda, account collegato, email. */
export interface ClienteIdentita {
  id: string
  user_id?: string | null
  email?: string | null
}

/**
 * Gli id cliente scritti sulla prenotazione. bookings.user_id puo' contenere
 * l'account del sito oppure l'id della scheda cliente (prenotazioni dal
 * gestionale): sono tutti UUID, si trattano come un solo spazio di id.
 */
export function idDichiarati(b: PrenotazioneIdentita): string[] {
  const bd = b.booking_details || {}
  const cust = bd.customer || {}
  const ids = new Set<string>()
  for (const v of [b.user_id, b.customer_id, cust.customerId, cust.id, bd.customer_id, bd.customerId]) {
    const u = uuid(v)
    if (u) ids.add(u)
  }
  return [...ids]
}

/** Email della prenotazione (ultima risorsa, solo senza id). */
export function emailPrenotazione(b: PrenotazioneIdentita): string {
  const bd = b.booking_details || {}
  return chiaveEmail(b.customer_email || bd.customer?.email || bd.email)
}

/** Raggruppa le schede per email esatta (minuscole); solo i gruppi da 1 identificano. */
export function raggruppaPerEmail(clienti: ClienteIdentita[]): Map<string, ClienteIdentita[]> {
  const mappa = new Map<string, ClienteIdentita[]>()
  const visti = new Set<string>()
  for (const c of clienti) {
    const e = chiaveEmail(c.email)
    const id = uuid(c.id)
    if (!e || !id || visti.has(id)) continue
    visti.add(id)
    mappa.set(e, [...(mappa.get(e) || []), c])
  }
  return mappa
}

/**
 * Tutti gli id della stessa persona: quelli di partenza piu' scheda e account
 * delle schede che li contengono. Senza id, l'email se e' di UNA sola scheda.
 */
export function idCliente(
  dichiarati: string[],
  email: string,
  clienti: ClienteIdentita[],
  perEmail: Map<string, ClienteIdentita[]>,
): string[] {
  const ids = new Set(dichiarati.map(uuid).filter(Boolean))
  if (ids.size === 0 && email) {
    const gruppo = perEmail.get(email)
    if (gruppo && gruppo.length === 1) ids.add(uuid(gruppo[0].id))
  }
  if (ids.size === 0) return []
  for (const c of clienti) {
    const id = uuid(c.id)
    const acc = uuid(c.user_id)
    if ((id && ids.has(id)) || (acc && ids.has(acc))) {
      if (id) ids.add(id)
      if (acc) ids.add(acc)
    }
  }
  return [...ids]
}

/** Chiavi con cui una prenotazione si confronta con chi ha gia' ricevuto il gadget. */
export function chiaviPrenotazione(b: PrenotazioneIdentita): string[] {
  const ids = idDichiarati(b)
  if (ids.length) return ids.map(i => 'id:' + i)
  const e = emailPrenotazione(b)
  return e ? ['e:' + e] : []
}

/**
 * Insieme delle chiavi dei clienti che hanno gia' ricevuto il gadget, da tutte
 * le prenotazioni registrate (noleggi, lavaggi, ogni servizio).
 * `clienti` = schede trovate per gli id delle prenotazioni o per email;
 * `perEmail` = schede per email esatta, per decidere se un'email e' univoca.
 */
export function insiemeGadget(
  inviati: PrenotazioneIdentita[],
  clienti: ClienteIdentita[],
  perEmail: Map<string, ClienteIdentita[]>,
): Set<string> {
  const chiavi = new Set<string>()
  const idInviati = new Set<string>()
  for (const r of inviati) {
    const registro = (r.booking_details?.gadget_omaggio || {}) as GadgetInviato
    const dichiarati = [...idDichiarati(r), ...((registro.clienti || []).map(uuid).filter(Boolean))]
    idCliente(dichiarati, emailPrenotazione(r), clienti, perEmail).forEach(i => idInviati.add(i))
  }
  idInviati.forEach(i => chiavi.add('id:' + i))
  // Le prenotazioni senza id si riconoscono per email solo se quell'email e'
  // di una sola scheda, e quella scheda ha gia' ricevuto il gadget.
  for (const [email, gruppo] of perEmail) {
    if (gruppo.length !== 1) continue
    const c = gruppo[0]
    if (idInviati.has(uuid(c.id)) || (uuid(c.user_id) && idInviati.has(uuid(c.user_id)))) chiavi.add('e:' + email)
  }
  return chiavi
}

/** Gadget gia' inviato su questa prenotazione o a questo cliente su un'altra. */
export function gadgetGiaInviatoA(b: PrenotazioneIdentita, insieme: Set<string>): boolean {
  if (b.booking_details?.gadget_omaggio) return true
  return chiaviPrenotazione(b).some(k => insieme.has(k))
}
