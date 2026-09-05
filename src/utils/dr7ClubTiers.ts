/**
 * Livelli DR7 Club — lettura UNICA lato gestionale.
 *
 * 04/09/2026 — In Centralina Pro > DR7 Club si possono aggiungere livelli a
 * piacere (Select, Privilege, Prestige, Black Plus, ... ) e infatti ne erano
 * stati salvati 30 in `centralina_pro_config.config.dr7_club.tiers`. Ma quella
 * chiave la leggeva SOLO il motore del cashback
 * (`netlify/functions/utils/dr7ClubCashback.ts::loadActiveTiers`): la scheda
 * cliente del gestionale e la pagina DR7 Club del sito avevano i tre livelli
 * Access/Black/Signature scritti nel codice, quindi al cliente non cambiava
 * nulla. Risultato: cashback versato su un livello che nessuno vedeva.
 *
 * Questo file e' il gemello lato browser di `loadActiveTiers`: stessa
 * normalizzazione, stesso ordinamento, stesso fallback. Mirror sul sito:
 * `Sito/utils/dr7club.ts`. Se cambia una regola qui, cambia in tutte e tre.
 */

import { supabase } from '../supabaseClient'

export interface ClubTierDef {
  /** id normalizzato del livello (quello salvato in Centralina Pro). */
  tier: string
  label: string
  /** soglia minima di spesa annua, in euro. */
  min: number
  /** soglia massima inclusa; Infinity per il livello piu' alto. */
  max: number
  /** percentuale di premio. */
  rewardPercent: number
}

/** Livelli di fabbrica: valgono finche' Centralina Pro non ha mai salvato. */
export const DEFAULT_CLUB_TIERS: ClubTierDef[] = [
  { tier: 'access', label: 'Access', min: 0, max: 2999, rewardPercent: 2 },
  { tier: 'black', label: 'Black', min: 3000, max: 9999, rewardPercent: 3 },
  { tier: 'signature', label: 'Signature', min: 10000, max: Infinity, rewardPercent: 4 },
]

interface RawCentralinaTier {
  id?: unknown
  label?: unknown
  min_annual_spend?: unknown
  rate_pct?: unknown
  is_active?: unknown
}

/**
 * Trasforma le righe di Centralina Pro nella lista usata dalle schermate.
 * `null` = la chiave `dr7_club` non c'e' proprio (istanza mai configurata):
 * chi chiama ripiega sui livelli di fabbrica. Lista VUOTA invece e' una
 * scelta dell'operatore (ha spento tutti i livelli) e va rispettata.
 */
export function normalizeClubTiers(tiersRaw: unknown): ClubTierDef[] | null {
  if (!Array.isArray(tiersRaw)) return null
  const active = (tiersRaw as RawCentralinaTier[])
    .filter((t) => t && t.is_active !== false)
    .map((t) => {
      const label = String(t.label ?? t.id ?? 'Tier')
      const tier = String(t.id ?? label).toLowerCase().replace(/\s+/g, '_') || 'tier'
      const min = Number(t.min_annual_spend ?? 0)
      const rewardPercent = Number(t.rate_pct ?? 0)
      return { tier, label, min, rewardPercent, max: 0 }
    })
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.rewardPercent))
    .sort((a, b) => a.min - b.min)
  // Il tetto di ogni livello e' la soglia del successivo meno uno; l'ultimo
  // resta aperto.
  for (let i = 0; i < active.length; i++) {
    active[i].max = i < active.length - 1 ? active[i + 1].min - 1 : Infinity
  }
  return active
}

let cache: ClubTierDef[] | null = null
let pending: Promise<ClubTierDef[]> | null = null

/** Legge i livelli da Centralina Pro una volta sola per sessione di pagina. */
export async function loadClubTiers(): Promise<ClubTierDef[]> {
  if (cache) return cache
  if (pending) return pending
  pending = (async () => {
    try {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (data?.config ?? null) as Record<string, unknown> | null
      const dr7Club = cfg?.dr7_club as Record<string, unknown> | undefined
      const normalized = normalizeClubTiers(dr7Club?.tiers)
      cache = normalized ?? DEFAULT_CLUB_TIERS
      return cache
    } catch (err) {
      console.error('[dr7ClubTiers] lettura livelli fallita, uso i default:', err)
      return DEFAULT_CLUB_TIERS
    } finally {
      pending = null
    }
  })()
  return pending
}

/** Svuota la cache: da chiamare dopo un salvataggio in Centralina Pro. */
export function invalidateClubTiersCache(): void {
  cache = null
}

export interface ClubTierMatch {
  tier: string
  label: string
  rewardPercent: number
  /** soglia di ingresso del livello attuale (per la barra di avanzamento). */
  min: number
  /** livello successivo, `null` se e' gia' il massimo. */
  next: ClubTierDef | null
}

/** Livello corrispondente alla spesa annua, piu' il livello successivo. */
export function pickClubTier(annualSpend: number, tiers: ClubTierDef[]): ClubTierMatch {
  if (tiers.length === 0) {
    return { tier: 'none', label: 'Nessun livello', rewardPercent: 0, min: 0, next: null }
  }
  let idx = tiers.findIndex((t) => annualSpend >= t.min && annualSpend <= t.max)
  // Spesa sotto la soglia piu' bassa: nessun livello raggiunto, ma il
  // prossimo traguardo esiste ed e' il primo della lista.
  if (idx === -1) {
    return { tier: 'none', label: 'Nessun livello', rewardPercent: 0, min: 0, next: tiers[0] }
  }
  const t = tiers[idx]
  return {
    tier: t.tier,
    label: t.label,
    rewardPercent: t.rewardPercent,
    min: t.min,
    next: idx < tiers.length - 1 ? tiers[idx + 1] : null,
  }
}
