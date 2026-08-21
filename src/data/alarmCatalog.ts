/**
 * Allarmi DR7 — gruppi del catalogo e vocabolario condiviso.
 *
 * 2026-08-21 (richiesta direzione): il gestionale e' passato da 13 allarmi a un
 * catalogo completo di 19 gruppi. L'ELENCO delle voci vive in
 * `public.system_alarms` (una riga per allarme, modificabile dal gestionale):
 * qui restano solo i gruppi e le etichette, cioe' le cose che il codice deve
 * conoscere per disegnare e ordinare.
 *
 * Il seed del catalogo e' la migration `20260821_alarm_engine.sql`, generata da
 * `scripts/alarm-catalog/` a partire da `catalogo.txt`. Per aggiungere un
 * allarme si tocca quel file e si rigenera: cosi' elenco e migration non
 * divergono.
 */

export type AlarmPriority = 'informativo' | 'attenzione' | 'urgente' | 'bloccante'
export type AlarmThresholdUnit = 'minutes_before' | 'minutes_after' | 'km' | 'days'
/** 'attivo' = c'e' il codice che lo rileva. 'in_attesa' = riga configurabile ma muta. */
export type AlarmStatoRilevamento = 'attivo' | 'in_attesa'

export interface AlarmGroup {
  key: string
  num: number
  title: string
  /** Cosa copre il gruppo — sottotitolo nel gestionale. */
  hint: string
}

export const ALARM_GROUPS: AlarmGroup[] = [
  { key: 'ritiro', num: 1, title: 'Ritiro / Uscita veicolo', hint: 'Il cliente sta arrivando e la vettura deve essere pronta.' },
  { key: 'contratto', num: 2, title: 'Contratto', hint: 'Generazione, invio e firma prima che il veicolo esca.' },
  { key: 'documenti', num: 3, title: 'Documenti cliente', hint: 'Identita\u2019, patente, requisiti di eta\u2019 e anzianita\u2019.' },
  { key: 'pagamenti', num: 4, title: 'Pagamenti', hint: 'Saldi aperti, link Nexi, extra e supplementi non incassati.' },
  { key: 'cauzione', num: 5, title: 'Cauzione', hint: 'Incasso, preautorizzazione, sblocco e restituzione.' },
  { key: 'riconsegna', num: 6, title: 'Riconsegna', hint: 'Rientro previsto, ritardi e chiusura della pratica.' },
  { key: 'danni', num: 7, title: 'Controllo danni / Check-in', hint: 'Controlli al rientro e gestione del danno rilevato.' },
  { key: 'sinistri', num: 8, title: 'Sinistri', hint: 'Denuncia, perizia e pratica assicurativa.' },
  { key: 'lavaggi', num: 9, title: 'Lavaggi clienti', hint: 'Appuntamenti di lavaggio dei clienti esterni.' },
  { key: 'preparazione', num: 10, title: 'Lavaggio / Preparazione flotta', hint: 'Rimessa in ordine del veicolo tra un noleggio e l’altro.' },
  { key: 'manutenzione', num: 11, title: 'Manutenzione', hint: 'Tagliandi, freni, liquidi, guasti e appuntamenti officina.' },
  { key: 'pneumatici', num: 12, title: 'Pneumatici', hint: 'Usura, pressione, sostituzioni e idoneita’ alla prossima uscita.' },
  { key: 'scadenze', num: 13, title: 'Scadenze veicolo', hint: 'Assicurazione, bollo, revisione, leasing e garanzie.' },
  { key: 'multe', num: 14, title: 'Multe / Pedaggi / Spese post-noleggio', hint: 'Da associare al cliente e da riaddebitare nei termini.' },
  { key: 'chilometraggio', num: 15, title: 'Chilometraggio', hint: 'Km inclusi, sforamenti e addebiti.' },
  { key: 'prenotazioni', num: 16, title: 'Prenotazioni / Calendario', hint: 'Sovrapposizioni, pratiche incomplete, veicolo non disponibile.' },
  { key: 'fatturazione', num: 17, title: 'Fatturazione / Amministrazione', hint: 'Fatture, note di credito, rimborsi e riconciliazione.' },
  { key: 'lead', num: 18, title: 'Lead / Preventivi', hint: 'Richieste senza risposta e preventivi in scadenza.' },
  { key: 'officina', num: 19, title: 'Officina / Carrozzeria', hint: 'Consegne, ritiri, ricambi e tempi di riparazione.' },
]

export const ALARM_GROUP_BY_KEY: Record<string, AlarmGroup> =
  Object.fromEntries(ALARM_GROUPS.map(g => [g.key, g]))

export const PRIORITY_LABEL: Record<AlarmPriority, string> = {
  informativo: 'Informativo',
  attenzione: 'Attenzione',
  urgente: 'Urgente',
  bloccante: 'Bloccante',
}

/** Ordine di gravita': a parita' di momento suona prima il piu' grave. */
export const PRIORITY_RANK: Record<AlarmPriority, number> = {
  informativo: 0, attenzione: 1, urgente: 2, bloccante: 3,
}

/** Colori per pallino e bordo. Coppie light/dark: la centralina vive in entrambi i temi. */
export const PRIORITY_STYLE: Record<AlarmPriority, { dot: string; text: string; chip: string }> = {
  informativo: { dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', chip: 'bg-sky-500/10 border-sky-500/30' },
  attenzione: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-500/10 border-amber-500/30' },
  urgente: { dot: 'bg-orange-600', text: 'text-orange-600 dark:text-orange-400', chip: 'bg-orange-600/10 border-orange-600/30' },
  bloccante: { dot: 'bg-rose-600', text: 'text-rose-600 dark:text-rose-400', chip: 'bg-rose-600/10 border-rose-600/30' },
}

export const UNIT_LABEL: Record<AlarmThresholdUnit, string> = {
  minutes_before: 'minuti prima',
  minutes_after: 'minuti dopo',
  km: 'km',
  days: 'giorni prima',
}

/** Reparti proposti nella tendina "Responsabile". Testo libero comunque ammesso. */
export const REPARTI = [
  'Front Office', 'Amministrazione', 'Officina', 'Lavaggio', 'Commerciale', 'Direzione',
] as const
