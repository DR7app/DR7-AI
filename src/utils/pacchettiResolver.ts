/**
 * Centralized pacchetti KM lookup for admin (PreventiviTab + ReservationsTab).
 *
 * Mirrors the website helper in CarBookingWizard.tsx — risolve la lista
 * pacchetti per categoria veicolo con fallback chain:
 *
 *   1) match diretto sul raw category id del veicolo
 *   2) alias legacy: supercars <-> exotic <-> supercar
 *   3) fallback universale: primo elenco non-vuoto in pacchetti_km
 *
 * Bug 2026-05-17: senza il fallback universale, veicoli con categoria
 * custom (es. "porsche", "luxury", "sports") perdevano i pacchetti
 * configurati per la categoria principale. Ora un singolo setup in
 * Centralina Pro si applica a tutto il listino premium.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolvePacchetti<T = any>(
  rawCat: string | undefined | null,
  byCat: Record<string, T[]> | undefined | null,
): T[] {
  if (!byCat) return []
  const cat = String(rawCat || '').toLowerCase().trim()
  const aliases = (cat === 'supercars' || cat === 'supercar') ? ['supercars', 'exotic', 'supercar']
                : cat === 'exotic' ? ['exotic', 'supercars', 'supercar']
                : cat ? [cat, 'supercars', 'exotic', 'supercar']
                : ['supercars', 'exotic', 'supercar']
  for (const k of aliases) {
    const v = byCat[k]
    if (Array.isArray(v) && v.length > 0) return v
  }
  for (const v of Object.values(byCat)) {
    if (Array.isArray(v) && v.length > 0) return v as T[]
  }
  return []
}
