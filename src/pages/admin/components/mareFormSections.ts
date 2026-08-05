// Sezioni accendibili/spegnibili della modale "Nuova prenotazione" del
// Noleggio Mare (MareBookingModal), pilotate dagli Interruttori ON/OFF.
//
// Sempre presenti (non spegnibili): Cliente, Barca & Periodo, Riepilogo,
// Pagamento — senza quelle non esiste una prenotazione.
//
// Fuori scope per una barca (richiesta direzione): Km & Sforo (una barca non fa
// chilometri) e Assicurazioni/Kasko (non si vendono sul noleggio mare).
export const MARE_FORM_SECTIONS: { id: string; title: string; hint: string }[] = [
  { id: 'luoghi', title: 'Luoghi & Consegna', hint: 'Luogo di ritiro/riconsegna e consegna a domicilio con relativo costo' },
  { id: 'conduzione', title: 'Conduzione (skipper)', hint: 'Barca con o senza skipper' },
  { id: 'patente', title: 'Patente Nautica', hint: 'Tipo, numero, ente di rilascio e scadenza' },
  { id: 'passeggeri', title: 'Passeggeri', hint: 'Nome e telefono di chi sale a bordo — NON crea lead/clienti' },
  { id: 'secondo', title: 'Secondo Conduttore', hint: 'Dati e patente del secondo conduttore' },
  { id: 'garante', title: 'Garante / Fideiussore', hint: 'Fino a 3 garanti solidali' },
  { id: 'cauzione', title: 'Cauzione', hint: 'Importo della cauzione e stato di incasso' },
  { id: 'servizi', title: 'Servizi Extra', hint: 'Servizi a pagamento presi da Centralina Pro' },
]

// Chiavi dentro centralina_pro_config.<riga business>.config
export const BOOKING_FORM_OFF_KEY = 'booking_form_off'
// Sezioni di Centralina Pro spente per il business (id di SECTIONS: p4, p5, ...).
export const SEZIONI_OFF_KEY = 'sezioni_off'

// 2026-08-05: i due interruttori non si parlavano. Spegnere "Cauzioni" dalla
// Centralina Pro del Noleggio Mare (sezioni_off = ['p4']) non toccava
// booking_form_off, quindi il blocco Cauzione restava nella modale. Qui la
// mappa sezione-form -> sezione Centralina: se la sezione Centralina e' OFF,
// il blocco sparisce anche dal form (l'interruttore del form resta un OFF
// aggiuntivo, non puo' riaccendere cio' che la Centralina ha spento).
export const CENTRALINA_SECTION_BY_FORM_SECTION: Record<string, { id: string; title: string }> = {
  cauzione: { id: 'p4', title: 'Cauzioni' },
  servizi: { id: 'p5', title: 'Servizi' },
}

// Set effettivo delle sezioni spente nella modale: unione degli interruttori
// del form e delle sezioni Centralina spente per il business.
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
