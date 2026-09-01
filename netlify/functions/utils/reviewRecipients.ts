/**
 * Destinatari della richiesta recensione per UNA prenotazione.
 *
 * Fino al 2026-08-31 la recensione partiva solo verso l'intestatario della
 * prenotazione (bookings.customer_*). Ma su un noleggio ci sono spesso altre
 * persone che hanno vissuto il servizio e firmato il contratto: il 2°
 * guidatore, il garante del veicolo dato in cauzione, i fideiussori. Anche
 * loro devono poter ricevere la richiesta di recensione.
 *
 * Le persone sono le STESSE che ContrattoTab elenca come firmatari
 * (buildContractSigners): stessa lettura di booking_details, stessi ruoli.
 * Se cambia una chiave in booking_details vanno aggiornati entrambi.
 */

export type RecipientRole =
  | 'CLIENTE'
  | 'SECONDO_GUIDATORE'
  | 'GARANTE'
  | 'FIDEIUSSORE_1'
  | 'FIDEIUSSORE_2'
  | 'FIDEIUSSORE_3';

export const RECIPIENT_ROLE_LABELS: Record<RecipientRole, string> = {
  CLIENTE: 'Cliente',
  SECONDO_GUIDATORE: '2° Guidatore',
  GARANTE: 'Garante',
  FIDEIUSSORE_1: 'Fideiussore 1',
  FIDEIUSSORE_2: 'Fideiussore 2',
  FIDEIUSSORE_3: 'Fideiussore 3',
};

export interface ReviewRecipient {
  role: RecipientRole;
  name: string;
  email: string | null;
  phone: string | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Solo cifre: due numeri scritti diversamente sono la stessa persona. */
const phoneKey = (v: string): string => v.replace(/\D/g, '').replace(/^0+/, '');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = clean(obj[k]);
    if (v) return v;
  }
  return '';
}

/**
 * Costruisce la lista dei destinatari di una prenotazione.
 * Il CLIENTE c'e' sempre (anche senza contatti: la sua riga deve comunque
 * comparire in tab con il motivo di esclusione). Le persone aggiuntive
 * entrano SOLO se hanno almeno un contatto — altrimenti sarebbero righe
 * inviabili a nessuno.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildReviewRecipients(record: any): ReviewRecipient[] {
  const bd = record?.booking_details || {};
  const out: ReviewRecipient[] = [];

  // Chiavi gia' viste: il garante "guidatore" o un 2° guidatore registrato con
  // lo stesso telefono del cliente non devono generare un doppio invio.
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const add = (role: RecipientRole, name: string, phone: string, email: string) => {
    const n = clean(name);
    if (!n) return;
    const pk = phone ? phoneKey(phone) : '';
    const ek = email ? email.toLowerCase() : '';
    if (pk && seenPhones.has(pk)) return;
    if (ek && seenEmails.has(ek)) return;
    if (role !== 'CLIENTE' && !pk && !ek) return;
    if (pk) seenPhones.add(pk);
    if (ek) seenEmails.add(ek);
    out.push({ role, name: n, email: email || null, phone: phone || null });
  };

  add(
    'CLIENTE',
    clean(record?.customer_name) || pick(bd?.customer, ['fullName', 'full_name']),
    clean(record?.customer_phone) || pick(bd?.customer, ['phone', 'telefono']),
    clean(record?.customer_email) || pick(bd?.customer, ['email'])
  );

  const sd = bd?.second_driver;
  if (sd) {
    const sdName =
      [clean(sd.name), clean(sd.surname)].filter(Boolean).join(' ') ||
      pick(sd, ['fullName', 'full_name']) ||
      [clean(sd.nome), clean(sd.cognome)].filter(Boolean).join(' ');
    add('SECONDO_GUIDATORE', sdName, pick(sd, ['phone', 'telefono']), pick(sd, ['email']));
  }

  // garante_veicolo con tipo 'guidatore' e' il cliente stesso duplicato.
  const g = bd?.garante_veicolo;
  if (g && g.tipo !== 'guidatore') {
    const gName =
      [clean(g.nome), clean(g.cognome)].filter(Boolean).join(' ') ||
      pick(g, ['nome_cognome', 'fullName', 'full_name']);
    add('GARANTE', gName, pick(g, ['phone', 'telefono']), pick(g, ['email']));
  }

  const fids = Array.isArray(bd?.guarantors) ? bd.guarantors : [];
  for (let n = 1; n <= 3; n++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = fids.find((r: any) => Number(r?.index) === n);
    if (!row) continue;
    add(
      `FIDEIUSSORE_${n}` as RecipientRole,
      clean(row[`garante_${n}_nome_cognome`]),
      clean(row[`garante_${n}_telefono`]),
      clean(row[`garante_${n}_email`])
    );
  }

  return out;
}
