// 01/10/2026: esito di un invio Green API e registro in sent_messages_log.
//
// Il 30/09 dalle 18:00 al 01/10 alle 10:00 l'istanza Green API era
// "notAuthorized": ogni invio falliva e nessuno lo ha registrato, perche'
// sent_messages_log veniva scritto SOLO quando Green API rispondeva OK.
//
// Qui stanno due cose, entrambe pure (nessun accesso al database):
//  1. classificaRispostaGreenApi: dice se il messaggio e' partito, se
//     l'istanza non e' utilizzabile (=> il messaggio sicuramente NON e' partito
//     e si puo' rimandare da solo quando l'istanza torna) o se e' un altro
//     errore (=> esito incerto, decide una persona).
//  2. rigaLogWhatsapp: la riga per sent_messages_log, anche per i falliti.
//
// sent_messages_log NON ha colonne per l'errore ne' per l'idMessage (e
// nemmeno una colonna jsonb): l'errore va in testa a message_text, l'idMessage
// non si salva. Mai scrivere colonne che non esistono: un insert con una
// colonna sconosciuta fallisce per intero.
import { mascheraTesto } from './systemControl'

export type EsitoGreenApi =
  | { tipo: 'inviato'; idMessage: string }
  /** Istanza non autorizzata/bloccata/quota: il messaggio NON e' partito. */
  | { tipo: 'istanza_non_disponibile'; motivo: string; status: number | null }
  /** Qualsiasi altro errore: non si sa con certezza se e' partito. */
  | { tipo: 'errore'; motivo: string; status: number | null }

// Codici con cui Green API rifiuta la richiesta prima di consegnarla:
// 401 = istanza non autorizzata / token errato, 403 = istanza bloccata o
// accesso negato, 466 = quota dell'istanza esaurita.
const STATUS_ISTANZA_NON_DISPONIBILE = new Set([401, 403, 466])

// Testi con cui Green API descrive un'istanza non utilizzabile.
const TESTO_ISTANZA_NON_DISPONIBILE =
  /not\s*authori[sz]ed|unauthori[sz]ed|yellow\s*card|instance\s+(is\s+)?(blocked|not\s+authori[sz]ed)|quota\s+exceeded|correspondents?\s+quota/i

function testoDi(corpo: unknown): string {
  if (corpo == null) return ''
  if (typeof corpo === 'string') return corpo
  if (typeof corpo === 'object') {
    const c = corpo as Record<string, unknown>
    const parti = [c.error, c.message, c.stateInstance, c.statusInstance]
      .filter(v => typeof v === 'string' && v) as string[]
    if (parti.length) return parti.join(' — ')
    try { return JSON.stringify(corpo) } catch { return '' }
  }
  return String(corpo)
}

/** Interpreta il corpo di una risposta Green API (testo grezzo o gia' JSON). */
export function leggiCorpo(testo: string): unknown {
  try { return JSON.parse(testo) } catch { return testo }
}

/**
 * Classifica la risposta HTTP di Green API.
 * Un 200 senza idMessage NON e' un invio riuscito.
 */
export function classificaRispostaGreenApi(status: number, corpo: unknown): EsitoGreenApi {
  const testo = mascheraTesto(testoDi(corpo)).slice(0, 500)
  const c = (corpo && typeof corpo === 'object') ? corpo as Record<string, unknown> : null
  const idMessage = typeof c?.idMessage === 'string' ? c.idMessage : ''
  const haErrore = !!c?.error

  if (status >= 200 && status < 300 && idMessage && !haErrore) {
    return { tipo: 'inviato', idMessage }
  }
  const motivo = `Green API HTTP ${status}${testo ? `: ${testo}` : ''}`
  if (STATUS_ISTANZA_NON_DISPONIBILE.has(status) || TESTO_ISTANZA_NON_DISPONIBILE.test(testo)) {
    return { tipo: 'istanza_non_disponibile', motivo, status }
  }
  if (status >= 200 && status < 300 && !haErrore) {
    return { tipo: 'errore', motivo: `Green API HTTP ${status} senza idMessage${testo ? `: ${testo}` : ''}`, status }
  }
  return { tipo: 'errore', motivo, status }
}

/**
 * Eccezione durante la chiamata (rete, timeout): esito INCERTO, la richiesta
 * puo' essere arrivata a Green API. Mai classificata come "non partito".
 */
export function classificaEccezioneGreenApi(err: unknown): EsitoGreenApi {
  const m = err instanceof Error ? err.message : String(err)
  return { tipo: 'errore', motivo: mascheraTesto(`Chiamata Green API non riuscita: ${m}`).slice(0, 500), status: null }
}

/**
 * Si puo' rimandare da solo (worker System Control) senza rischio di doppione
 * o di messaggio rovinato?
 *  - solo se l'istanza ha rifiutato l'invio (il messaggio non e' partito);
 *  - mai per gli OTP (scadono: meglio un nuovo codice richiesto dal cliente);
 *  - mai se la sanificazione del payload ha cambiato qualcosa: il ritentativo
 *    rimanderebbe un testo con "[nascosto]" al posto del dato vero (es. un
 *    templateVars.iban, un link con token nel messaggio).
 *    Eccezione: il sotto-albero `booking` QUANDO ha un id. La sanificazione lo
 *    tronca (bookings ha >100 colonne, sanifica ne tiene 60) e maschera
 *    nexi_authorization_code, ma alla ripresa send-whatsapp-notification
 *    rilegge la prenotazione dal database per id: conta solo l'id.
 */
export function reinvioAutomaticoSicuro(
  esito: EsitoGreenApi,
  payloadOriginale: Record<string, unknown>,
  payloadSanificato: unknown,
): boolean {
  if (esito.tipo !== 'istanza_non_disponibile') return false
  const chiavi = [payloadOriginale.messageKey, payloadOriginale.templateKey, payloadOriginale.type]
    .map(v => String(v || '').toLowerCase())
  if (chiavi.some(k => k.includes('otp'))) return false
  if (!payloadSanificato || typeof payloadSanificato !== 'object') return false
  const sanificato = payloadSanificato as Record<string, unknown>
  const idDi = (p: Record<string, unknown>) => {
    const b = p.booking as Record<string, unknown> | null | undefined
    const id = b && typeof b === 'object' ? b.id : undefined
    return (typeof id === 'string' && id) || (typeof id === 'number' && Number.isFinite(id)) ? id : null
  }
  const idOriginale = idDi(payloadOriginale)
  // Prenotazione riletta per id alla ripresa: basta che l'id sia arrivato intatto.
  const normalizza = (p: Record<string, unknown>) =>
    idOriginale != null ? { ...p, booking: { id: idDi(p) } } : p
  try {
    return JSON.stringify(normalizza(payloadOriginale)) === JSON.stringify(normalizza(sanificato))
  } catch { return false }
}

/** Un messaggio rimasto in coda oltre questo tempo non si manda piu': e' vecchio. */
export const REINVIO_SCADE_ORE = 24

export function reinvioScaduto(primoTentativoIso: unknown, adesso = Date.now()): boolean {
  if (typeof primoTentativoIso !== 'string') return false
  const t = new Date(primoTentativoIso).getTime()
  if (!Number.isFinite(t)) return false
  return adesso - t > REINVIO_SCADE_ORE * 3_600_000
}

export interface RigaLogWhatsapp {
  customer_name: string
  customer_phone: string
  message_text: string
  template_label: string | null
  status: 'sent' | 'failed'
}

/** Riga per sent_messages_log: SOLO colonne esistenti. */
export function rigaLogWhatsapp(p: {
  nome?: string | null
  telefono: string
  testo: string
  etichetta?: string | null
  esito: EsitoGreenApi
  inCoda?: boolean
}): RigaLogWhatsapp {
  const base = {
    customer_name: (p.nome && String(p.nome).trim()) || 'N/A',
    customer_phone: p.telefono,
    template_label: p.etichetta || null,
  }
  if (p.esito.tipo === 'inviato') {
    return { ...base, message_text: p.testo, status: 'sent' }
  }
  const nota = p.inCoda
    ? 'in coda: ripartira da solo quando WhatsApp torna disponibile'
    : 'da verificare nel System Control'
  return {
    ...base,
    message_text: `[NON INVIATO — ${p.esito.motivo} — ${nota}]\n\n${p.testo}`,
    status: 'failed',
  }
}
