/**
 * Car-wash vehicle classification — Urban vs Maxi.
 *
 * Deterministic (no AI guess). Returns ONLY 'Urban' or 'Maxi'.
 *
 * Business rule: "Maxi" is NOT only vans. Maxi = any vehicle bigger, taller or
 * longer than a normal car, or more expensive/longer to wash:
 *   SUV, crossover, 4x4, pickup, van, utilitaire, 7-seater, long/tall vehicles,
 *   large premium vehicles.
 *
 * Order of decision:
 *   1. normalize to lowercase
 *   2. combine brand + model + version + bodyType into one string
 *   3. manualOverrides (exact "brand model") — wins over everything
 *   4. MAXI_KEYWORDS (models / size words)
 *   5. bodyType families (SUV / Crossover / MPV / Van / Pickup / Commercial …)
 *   6. fallback → Urban
 */

export type WashClass = 'Urban' | 'Maxi'

export interface ClassifyVehicleInput {
  brand?: string | null
  model?: string | null
  version?: string | null
  bodyType?: string | null
}

// ── 3. Manual overrides (edit freely). Key = "brand model" in lowercase. ──────
// Use this for any vehicle the keyword logic gets wrong. Wins over all rules.
export const manualOverrides: Record<string, WashClass> = {
  'jeep renegade': 'Maxi',
  'nissan qashqai': 'Maxi',
  'dacia duster': 'Maxi',
  'renault captur': 'Maxi',
  'ford puma': 'Maxi',
  'peugeot 2008': 'Maxi',
  'peugeot 3008': 'Maxi',
  'peugeot 5008': 'Maxi',
  'fiat panda': 'Urban',
  'fiat 500': 'Urban',
  'renault clio': 'Urban',
  'peugeot 208': 'Urban',
  'toyota yaris': 'Urban',
}

// ── 4. Maxi keywords (models + size words). Matched as whole words. ───────────
export const MAXI_KEYWORDS: string[] = [
  // SUV / crossover / off-road
  'suv', 'crossover', '4x4', '4wd', 'fuoristrada', 'off road', 'offroad',
  // Jeep
  'jeep', 'renegade', 'compass', 'cherokee', 'wrangler', 'gladiator', 'commander',
  // popular SUV/crossover models
  'qashqai', 'duster', 'captur', 'kadjar', 'koleos', 'arkana', 'austral',
  'puma', 'kuga', 'ecosport', 'edge', 'explorer',
  '2008', '3008', '5008', '408', '4008',
  'tiguan', 'touareg', 't-roc', 't roc', 't-cross', 't cross', 'taigo',
  'rav4', 'chr', 'c-hr', 'c hr', 'yaris cross', 'corolla cross',
  'tucson', 'santa fe', 'kona', 'bayon', 'nexo',
  'sportage', 'sorento', 'stonic', 'niro', 'xceed',
  'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'ix', 'ix1', 'ix3',
  'q2', 'q3', 'q4', 'q5', 'q7', 'q8',
  'gla', 'glb', 'glc', 'gle', 'gls', 'gl', 'ml', 'eqa', 'eqb', 'eqc',
  'range rover', 'land rover', 'defender', 'discovery', 'evoque', 'velar',
  'macan', 'cayenne',
  'stelvio', 'tonale',
  'stelvio', 'grecale', 'levante',
  'tivoli', 'korando', 'rexton',
  'mokka', 'crossland', 'grandland', 'frontera',
  'juke', 'x-trail', 'x trail', 'pathfinder', 'murano',
  'ateca', 'tarraco', 'cupra formentor', 'formentor', 'terramar',
  'karoq', 'kodiaq', 'enyaq',
  'xc40', 'xc60', 'xc90', 'ex30', 'ex90',
  'cx-30', 'cx 30', 'cx-5', 'cx 5', 'cx-60', 'cx 60', 'cx-80',
  'tonale', 'avenger',
  'bigster', 'jogger',
  // Pickup
  'pickup', 'pick-up', 'pick up', 'ranger', 'hilux', 'amarok', 'navara',
  'l200', 'fullback', 'd-max', 'd max',
  // Vans / commercial / large
  'van', 'cargo', 'furgone', 'furgonato', 'autocarro', 'commercial', 'combi',
  'ducato', 'doblo', 'doblò', 'scudo', 'talento', 'fiorino',
  'vito', 'viano', 'sprinter', 'classe v', 'v-class', 'v class', 'vclass',
  'transit', 'tourneo', 'transit custom', 'transit connect',
  'trafic', 'master', 'kangoo', 'express',
  'partner', 'rifter', 'expert', 'boxer', 'traveller', 'jumpy', 'jumper',
  'berlingo', 'spacetourer',
  'crafter', 'transporter', 'multivan', 'caravelle', 'caddy', 'california',
  'proace', 'movano', 'vivaro', 'combo',
  'nv200', 'nv300', 'primastar', 'interstar', 'interstar',
  // 7-seat / MPV / size words
  'monovolume', 'mpv', 'minivan', '7 posti', '9 posti', '7-posti', '9-posti',
  'touran', 'sharan', 'scenic', 'espace', 'galaxy', 's-max', 's max',
  'zafira', 'verso', 'picasso', 'spacetourer',
  // generic size markers (Maxi line / van length & height codes)
  'maxi', 'long', 'lungo', 'l1', 'l2', 'l3', 'l4', 'h1', 'h2', 'h3',
]

// ── 5. bodyType families that always mean Maxi ───────────────────────────────
const MAXI_BODYTYPES: string[] = [
  'suv', 'crossover', 'fuoristrada', 'off-road', 'offroad', '4x4',
  'mpv', 'monovolume', 'minivan', 'multivan', 'van', 'minibus',
  'pickup', 'pick-up', 'pick up',
  'commercial', 'commerciale', 'autocarro', 'furgone', 'furgonato',
  'station wagon', 'familiare', 'combi',
]

// ── helpers ──────────────────────────────────────────────────────────────────
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** whole-word (or word-bounded phrase) match inside the combined text */
function containsKeyword(text: string, keyword: string): boolean {
  const kw = normalize(keyword)
  if (!kw) return false
  // \b doesn't play well with leading/trailing digits next to letters, so we
  // bound on non-alphanumeric (or string edges) on both sides.
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}([^a-z0-9]|$)`)
  return re.test(text)
}

// ── main classifier ──────────────────────────────────────────────────────────
export function classifyVehicle(vehicle: ClassifyVehicleInput): WashClass {
  // 1 + 2: normalize and combine all fields into one searchable string
  const brand = normalize(vehicle.brand || '')
  const model = normalize(vehicle.model || '')
  const version = normalize(vehicle.version || '')
  const bodyType = normalize(vehicle.bodyType || '')
  const fullText = [brand, model, version, bodyType].filter(Boolean).join(' ').trim()

  // 3: manual overrides (exact "brand model" — wins over everything)
  const brandModel = `${brand} ${model}`.trim()
  for (const key of Object.keys(manualOverrides)) {
    const k = normalize(key)
    if (brandModel === k || brandModel.startsWith(k + ' ')) {
      return manualOverrides[key]
    }
  }

  // 4: Maxi keywords (model names + size words)
  for (const kw of MAXI_KEYWORDS) {
    if (containsKeyword(fullText, kw)) return 'Maxi'
  }

  // 5: bodyType families
  for (const bt of MAXI_BODYTYPES) {
    if (bodyType && containsKeyword(bodyType, bt)) return 'Maxi'
  }

  // 6: fallback
  return 'Urban'
}
