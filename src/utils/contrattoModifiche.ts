/**
 * Contratto & Modifiche — regole "cosa succede al contratto quando si modifica
 * una prenotazione GIA' FIRMATA".
 *
 * Storia: fino al 2026-08-02 QUALSIASI modifica su una prenotazione firmata
 * riconduceva il contratto (la firma originale veniva ristampata sulle nuove
 * condizioni, senza chiedere niente al cliente). Comodo per uno spostamento
 * d'orario, sbagliato per un CAMBIO VEICOLO: il cliente risultava firmatario
 * di un contratto per un mezzo che non ha mai accettato.
 *
 * Dal 2026-08-20 la direzione decide voce per voce da Centralina Pro
 * (`centralina_pro_config.config.contratto_modifica`):
 *   - RIFIRMA    → parte un nuovo link di firma, la vecchia firma decade
 *   - RICONDOTTO → il contratto aggiornato viene rimandato gia' firmato
 *
 * Le voci e i default vivevano dentro CentralinaProTab (che scriveva la config
 * ma nessuno la leggeva). Sono qui perche' il flusso di salvataggio della
 * prenotazione deve poterle leggere senza importare l'intero tab.
 */

export type ContrattoAzione = 'rifirma' | 'ricondotto'

export const CONTRATTO_VOCI: { key: string; label: string; hint: string }[] = [
  { key: 'veicolo',    label: 'Cambio veicolo',        hint: 'Targa o modello diversi da quelli firmati' },
  { key: 'date_orari', label: 'Date e orari',          hint: 'Ritiro o riconsegna spostati' },
  { key: 'prezzo',     label: 'Prezzo',                hint: 'Totale del noleggio modificato' },
  { key: 'guidatore',  label: 'Guidatore / conducente', hint: 'Intestatario o secondo guidatore cambiato' },
  { key: 'luoghi',     label: 'Luoghi ritiro/riconsegna', hint: 'Indirizzo di consegna o rientro diverso' },
  { key: 'estensione', label: 'Estensione',            hint: 'Noleggio prolungato oltre la data firmata' },
  { key: 'garanti',    label: 'Garanti',               hint: 'Garante veicolo o fideiussori aggiunti, tolti o cambiati' },
  { key: 'assicurazioni', label: 'Assicurazioni',      hint: 'Formula, copertura o franchigia diverse da quelle accettate' },
  { key: 'cauzione',   label: 'Cauzioni',              hint: 'Importo o formula della cauzione modificati' },
  { key: 'servizi_extra', label: 'Servizi extra',      hint: 'Servizi aggiuntivi aggiunti o rimossi (seggiolino, consegna, accessori...)' },
  { key: 'km',         label: 'Km',                    hint: 'Km inclusi o tariffa di sforo modificati' },
  { key: 'metodo_pagamento', label: 'Metodo pagamento', hint: 'Modalita\' di pagamento diversa da quella indicata nel contratto' },
]

export const CONTRATTO_DEFAULT: Record<string, ContrattoAzione> = {
  veicolo: 'rifirma',      // il default che la direzione ha chiesto esplicitamente
  date_orari: 'ricondotto',
  prezzo: 'ricondotto',
  guidatore: 'rifirma',    // firma una persona diversa: va rifirmato
  luoghi: 'ricondotto',
  estensione: 'ricondotto', // e' esattamente il caso per cui la clausola esiste
  garanti: 'rifirma',       // il garante FIRMA: se cambia, la firma vecchia non lo copre
  assicurazioni: 'rifirma', // cambia la franchigia a carico del cliente
  cauzione: 'ricondotto',
  servizi_extra: 'ricondotto',
  km: 'ricondotto',
  metodo_pagamento: 'ricondotto',
}

/**
 * Quali campi del form di prenotazione appartengono a ciascuna voce.
 * `estensione` non e' qui: non e' un campo, e' un flusso a parte
 * (handleExtendBooking) e va passato esplicitamente.
 */
const CAMPI_PER_VOCE: Record<string, string[]> = {
  veicolo: ['vehicle_id'],
  date_orari: ['pickup_date', 'pickup_time', 'return_date', 'return_time'],
  prezzo: ['total_amount'],
  guidatore: [
    'customer_id',
    'has_second_driver', 'second_driver_id',
    'second_driver_name', 'second_driver_surname', 'second_driver_codice_fiscale',
  ],
  luoghi: [
    'pickup_location', 'dropoff_location',
    'delivery_street', 'delivery_city', 'delivery_zip', 'delivery_province',
    'pickup_street', 'pickup_city', 'pickup_zip', 'pickup_province',
  ],
  garanti: [
    'garante_customer_id',
    'garante_nome', 'garante_cognome', 'garante_codice_fiscale',
  ],
  assicurazioni: ['insurance_option'],
  cauzione: ['deposit', 'deposit_status', 'deposit_option_id', 'include_cauzione_veicoli'],
  servizi_extra: ['experience_services', 'dr7_flex', 'km_packages', 'delivery_enabled', 'pickup_enabled'],
  km: ['km_limit', 'km_overage_fee', 'unlimited_km'],
  metodo_pagamento: ['payment_method'],
}

type FormLike = Record<string, unknown> | null | undefined

/** Confronto stabile: undefined e null sono equivalenti, il resto via JSON. */
function changed(before: FormLike, after: FormLike, field: string): boolean {
  const a = (before as Record<string, unknown>)?.[field]
  const b = (after as Record<string, unknown>)?.[field]
  return JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b === undefined ? null : b)
}

/**
 * Elenco delle voci di CONTRATTO_VOCI toccate da questa modifica, confrontando
 * lo snapshot caricato nel form con i valori al momento del Salva.
 */
export function vociCambiate(before: FormLike, after: FormLike, opts?: { estensione?: boolean }): string[] {
  const out: string[] = []
  if (before && after) {
    for (const [voce, campi] of Object.entries(CAMPI_PER_VOCE)) {
      if (campi.some(f => changed(before, after, f))) out.push(voce)
    }
  }
  if (opts?.estensione) out.push('estensione')
  return out
}

/**
 * Decide se il contratto va RIFIRMATO. Regola della direzione: se la modifica
 * tocca piu' voci, basta che UNA sia impostata su "rifirma" — la regola piu'
 * severa vince.
 *
 * Fail-safe: una voce non presente in `regole` ricade sul default, e un default
 * mancante vale 'ricondotto' (comportamento storico).
 */
export function richiedeNuovaFirma(
  voci: string[],
  regole?: Record<string, ContrattoAzione> | null,
): boolean {
  return voci.some(v => (regole?.[v] || CONTRATTO_DEFAULT[v] || 'ricondotto') === 'rifirma')
}

/**
 * Helper unico per il flusso di salvataggio: ritorna sia la decisione sia le
 * voci coinvolte (utili per il log e per capire PERCHE' e' partita una firma).
 */
export function decidiAzioneContratto(
  before: FormLike,
  after: FormLike,
  regole?: Record<string, ContrattoAzione> | null,
  opts?: { estensione?: boolean },
): { voci: string[]; vociRifirma: string[]; rifirma: boolean } {
  const voci = vociCambiate(before, after, opts)
  const vociRifirma = voci.filter(v => (regole?.[v] || CONTRATTO_DEFAULT[v] || 'ricondotto') === 'rifirma')
  return { voci, vociRifirma, rifirma: vociRifirma.length > 0 }
}
