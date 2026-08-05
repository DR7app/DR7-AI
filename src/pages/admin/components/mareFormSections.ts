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

// Chiave dentro centralina_pro_config.<riga business>.config
export const BOOKING_FORM_OFF_KEY = 'booking_form_off'
