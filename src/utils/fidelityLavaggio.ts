/**
 * Fidelity Card lavaggio — regole da Centralina Pro (06/11/2026).
 *
 * Le regole stanno in `centralina_pro_config` (riga 'main', globale)
 * alla chiave `fidelity_lavaggio`. I punti e i premi li calcola SOLO il
 * database (dr7_punti_lavaggio_ricalcola, migrazione
 * 20261106_fidelity_lavaggio_da_centralina.sql): qui si leggono i valori per
 * mostrarli e la sezione della Centralina li scrive.
 *
 * `normalizzaFidelityLavaggio` e' la gemella di dr7_fidelity_lavaggio_norm in
 * SQL: un valore mancante, a zero, negativo o non numerico torna al default,
 * cosi' quello che si vede e' quello che il database applica. Gemella anche
 * nel sito: Sito/utils/fidelityLavaggioRules.ts. Cambiare in tutti e tre.
 */
import { supabase } from '../supabaseClient'

export const FIDELITY_LAVAGGIO_KEY = 'fidelity_lavaggio'

export type TipoPremioFidelity = 'credito_wallet' | 'codice_sconto'

export interface FidelityLavaggioConfig {
  attivo: boolean
  /** EUR di lavaggio pagato per fare 1 punto (decimali ammessi). */
  euro_per_punto: number
  /** Punti per un premio (intero > 0). */
  soglia_punti: number
  /** Valore del premio in EUR. */
  importo_premio: number
  /** Giorni di validita' del premio. */
  validita_giorni: number
  tipo_premio: TipoPremioFidelity
}

export const FIDELITY_LAVAGGIO_DEFAULT: FidelityLavaggioConfig = {
  attivo: true,
  euro_per_punto: 1,
  soglia_punti: 250,
  importo_premio: 25,
  validita_giorni: 15,
  tipo_premio: 'credito_wallet',
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    return /^[0-9]+(\.[0-9]+)?$/.test(t) ? Number(t) : null
  }
  return null
}

const due = (n: number) => Math.round(n * 100) / 100

/** Config completa e valida, come la applica il database. */
export function normalizzaFidelityLavaggio(raw: unknown): FidelityLavaggioConfig {
  const v = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const d = FIDELITY_LAVAGGIO_DEFAULT

  let epp = numero(v.euro_per_punto)
  if (epp === null || epp <= 0 || epp > 100000) epp = d.euro_per_punto
  epp = due(epp)
  if (epp <= 0) epp = d.euro_per_punto

  let soglia = numero(v.soglia_punti)
  soglia = soglia === null ? null : Math.floor(soglia)
  if (soglia === null || soglia < 1 || soglia > 1000000) soglia = d.soglia_punti

  let importo = numero(v.importo_premio)
  if (importo === null || importo <= 0 || importo > 100000) importo = d.importo_premio
  importo = due(importo)
  if (importo <= 0) importo = d.importo_premio

  let giorni = numero(v.validita_giorni)
  giorni = giorni === null ? null : Math.floor(giorni)
  if (giorni === null || giorni < 1 || giorni > 3650) giorni = d.validita_giorni

  const tipo: TipoPremioFidelity = v.tipo_premio === 'codice_sconto' ? 'codice_sconto' : 'credito_wallet'

  return {
    attivo: typeof v.attivo === 'boolean' ? v.attivo : d.attivo,
    euro_per_punto: epp,
    soglia_punti: soglia,
    importo_premio: importo,
    validita_giorni: giorni,
    tipo_premio: tipo,
  }
}

/** "25" per 25, "12,50" per 12.5 — come lo legge un cliente italiano. */
export function euroFidelity(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

/**
 * Legge le regole dalla Centralina. Non lancia mai: una lettura fallita
 * torna ai default (`letta: false`), cosi' la scheda cliente resta in piedi.
 */
export async function caricaFidelityLavaggio(): Promise<{ config: FidelityLavaggioConfig; letta: boolean }> {
  try {
    const { data, error } = await supabase
      .from('centralina_pro_config')
      .select('config')
      .eq('id', 'main')
      .maybeSingle()
    if (error) throw error
    const cfg = (data?.config ?? {}) as Record<string, unknown>
    return { config: normalizzaFidelityLavaggio(cfg[FIDELITY_LAVAGGIO_KEY]), letta: true }
  } catch {
    return { config: { ...FIDELITY_LAVAGGIO_DEFAULT }, letta: false }
  }
}
