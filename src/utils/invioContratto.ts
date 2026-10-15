/**
 * Quando parte il link di firma del contratto (Centralina Pro > Contratto &
 * Modifiche > Invio contratto).
 *
 * 15/10/2026 (richiesta direzione): non tutti i clienti vogliono il contratto
 * appena prenotano. Si sceglie l'anticipo rispetto al ritiro (subito, 48h,
 * 24h, 6h, 2h, 1h, 30 min prima, al momento del ritiro) e per quanto tempo il
 * link resta valido. Una voce per business, letta prima sulla riga del
 * business e poi su `main`.
 *
 * Vale per gli invii AUTOMATICI (salvataggio prenotazione, Segna Pagato,
 * pagamento Nexi, sito). I bottoni manuali (Rinvia contratto, tab Contratti,
 * DR7 Trust) inviano sempre subito: e' l'operatore che lo chiede.
 *
 * Usato sia dall'admin sia dalle Netlify functions: niente import di browser.
 */

export type QuandoInvioContratto = 'subito' | '48h' | '24h' | '6h' | '2h' | '1h' | '30m' | 'al_ritiro'

export interface InvioContrattoConfig {
  quando: QuandoInvioContratto
  /** Validita' del link in ore dall'invio. 0 = fino all'orario di ritiro. */
  validita_ore: number
}

export const INVIO_CONTRATTO_DEFAULT: InvioContrattoConfig = { quando: 'subito', validita_ore: 12 }

export const OPZIONI_QUANDO: { value: QuandoInvioContratto; label: string; minutiPrima: number | null }[] = [
  { value: 'subito', label: 'Subito', minutiPrima: null },
  { value: '48h', label: '48 ore prima del ritiro', minutiPrima: 48 * 60 },
  { value: '24h', label: '24 ore prima del ritiro', minutiPrima: 24 * 60 },
  { value: '6h', label: '6 ore prima del ritiro', minutiPrima: 6 * 60 },
  { value: '2h', label: '2 ore prima del ritiro', minutiPrima: 2 * 60 },
  { value: '1h', label: '1 ora prima del ritiro', minutiPrima: 60 },
  { value: '30m', label: '30 minuti prima del ritiro', minutiPrima: 30 },
  { value: 'al_ritiro', label: "All'orario del ritiro", minutiPrima: 0 },
]

export const OPZIONI_VALIDITA: { value: number; label: string }[] = [
  { value: 12, label: '12 ore' },
  { value: 24, label: '24 ore' },
  { value: 48, label: '48 ore' },
  { value: 72, label: '72 ore' },
  { value: 0, label: "Fino all'orario del ritiro" },
]

/** Il link non dura mai meno di cosi', anche con "fino al ritiro" a ritiro imminente. */
const VALIDITA_MINIMA_MS = 2 * 60 * 60 * 1000

export function normalizzaInvioContratto(raw: unknown): InvioContrattoConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<InvioContrattoConfig>
  const quando = OPZIONI_QUANDO.some(o => o.value === r.quando) ? r.quando as QuandoInvioContratto : INVIO_CONTRATTO_DEFAULT.quando
  const validita_ore = OPZIONI_VALIDITA.some(o => o.value === r.validita_ore) ? Number(r.validita_ore) : INVIO_CONTRATTO_DEFAULT.validita_ore
  return { quando, validita_ore }
}

/**
 * Istante in cui il link deve partire, oppure null = subito.
 * Senza orario di ritiro non si puo' programmare: si invia subito.
 */
export function istanteInvioContratto(cfg: InvioContrattoConfig, ritiroMs: number | null): number | null {
  const minuti = OPZIONI_QUANDO.find(o => o.value === cfg.quando)?.minutiPrima ?? null
  if (minuti === null || ritiroMs === null || !Number.isFinite(ritiroMs)) return null
  return ritiroMs - minuti * 60 * 1000
}

/** Scadenza del link inviato adesso (`oraMs`). */
export function scadenzaLinkFirma(cfg: InvioContrattoConfig, oraMs: number, ritiroMs: number | null): number {
  if (cfg.validita_ore > 0) return oraMs + cfg.validita_ore * 60 * 60 * 1000
  // "Fino al ritiro": senza orario di ritiro si torna alle 12 ore storiche.
  if (ritiroMs === null || !Number.isFinite(ritiroMs)) return oraMs + 12 * 60 * 60 * 1000
  return Math.max(ritiroMs, oraMs + VALIDITA_MINIMA_MS)
}
