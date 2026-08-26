// Sezioni accendibili/spegnibili del form "Nuova prenotazione" dei business
// diversi dal Noleggio Terra (Mare, Aria, Soggiorni), pilotate dagli
// Interruttori ON/OFF.
//
// 25/08/2026: questa mappa nasceva per MareBookingModal, la vecchia modale
// dedicata al Mare. Da quando ogni business apre ReservationsTab con il proprio
// `serviceType`, quella modale non e' piu' montata da nessuna parte: gli
// interruttori scrivevano `booking_form_off` e nessuno lo leggeva, quindi
// spegnere una sezione non nascondeva niente. Adesso le sezioni elencate qui
// sono quelle che ReservationsTab sa davvero nascondere.
//
// Sempre presenti (non spegnibili): Cliente, Mezzo & Periodo, Luoghi, Riepilogo
// e Pagamento — senza quelli non esiste una prenotazione, e il luogo di ritiro
// e' un campo obbligatorio del form.
//
// Fuori scope per una barca (richiesta direzione): Km & Sforo (una barca non fa
// chilometri) e Assicurazioni/Kasko (non si vendono sul noleggio mare).

/** Sezioni che esistono solo sull'acqua: skipper, patente nautica, passeggeri. */
export const FORM_SECTIONS_SOLO_MARE: ReadonlySet<string> = new Set(['conduzione', 'patente', 'passeggeri'])

export const MARE_FORM_SECTIONS: { id: string; title: string; hint: string }[] = [
  { id: 'conduzione', title: 'Conduzione (skipper)', hint: 'Barca con o senza skipper' },
  { id: 'patente', title: 'Patente Nautica', hint: 'Patente dello skipper (solo con skipper); senza skipper si legge dall\'anagrafica cliente' },
  { id: 'passeggeri', title: 'Passeggeri', hint: 'Nome e telefono di chi sale a bordo — NON crea lead/clienti' },
  { id: 'secondo', title: 'Secondo Conducente', hint: 'Dati e patente del secondo conducente' },
  { id: 'garante', title: 'Garante / Fideiussore', hint: 'Fino a 3 garanti solidali' },
  { id: 'servizi', title: 'Servizi Experience', hint: 'Servizi a pagamento presi da Centralina Pro' },
]

// Chiavi dentro centralina_pro_config.<riga business>.config
export const BOOKING_FORM_OFF_KEY = 'booking_form_off'
// Sezioni di Centralina Pro spente per il business (id di SECTIONS: p4, p5, ...).
export const SEZIONI_OFF_KEY = 'sezioni_off'

// 2026-08-05: i due interruttori non si parlavano. Spegnere "Servizi" dalla
// Centralina Pro del business (sezioni_off = ['p5']) non toccava
// booking_form_off, quindi il blocco restava nel form. Qui la mappa
// sezione-form -> sezione Centralina: se la sezione Centralina e' OFF, il
// blocco sparisce anche dal form (l'interruttore del form resta un OFF
// aggiuntivo, non puo' riaccendere cio' che la Centralina ha spento).
export const CENTRALINA_SECTION_BY_FORM_SECTION: Record<string, { id: string; title: string }> = {
  servizi: { id: 'p5', title: 'Servizi' },
}

// Set effettivo delle sezioni spente nel form: unione degli interruttori del
// form e delle sezioni Centralina spente per il business.
export function mareFormSectionsOff(config: Record<string, unknown> | null | undefined): Set<string> {
  const cfg = config || {}
  const formOff = Array.isArray(cfg[BOOKING_FORM_OFF_KEY]) ? (cfg[BOOKING_FORM_OFF_KEY] as string[]) : []
  const sezioniOff = Array.isArray(cfg[SEZIONI_OFF_KEY]) ? (cfg[SEZIONI_OFF_KEY] as string[]) : []
  const off = new Set(formOff)
  for (const [formId, sezione] of Object.entries(CENTRALINA_SECTION_BY_FORM_SECTION)) {
    if (sezioniOff.includes(sezione.id)) off.add(formId)
  }
  return off
}
