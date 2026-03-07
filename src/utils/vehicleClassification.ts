/**
 * Smart Vehicle Classification — URBAN vs MAXI for car wash pricing.
 *
 * Strategy (in order):
 *  1. MAXI keywords in full text (SUV, SW, fuoristrada, monovolume, 4x4…)
 *  2. Brand-specific naming patterns (BMW X*, Audi Q*, Mercedes GL*, Mazda CX*…)
 *  3. Model DB lookup (comprehensive Italian market coverage)
 *  4. Default → URBAN (small/medium car assumption)
 */

export type VehicleCategory = 'urban' | 'maxi'

interface ClassificationResult {
  category: VehicleCategory
  confidence: 'high' | 'medium' | 'low'
  source: 'local' | 'api'
  matchedBrand?: string
  matchedModel?: string
}

// ── Keywords that ALWAYS mean MAXI ──────────────────────────────────────────
const MAXI_KEYWORDS = [
  // Station wagon
  'station wagon', 'sw', 'wagon', 'variant', 'touring', 'avant',
  'estate', 'break', 'allroad', 'alltrack', 'cross country',
  'sportwagon', 'sport wagon', 'combi',
  // SUV / crossover / fuoristrada
  'suv', 'crossover', 'fuoristrada', 'off road', 'offroad', '4x4', '4wd',
  'stepway',
  // Monovolume / MPV / van
  'monovolume', 'mpv', 'minivan', 'multivan',
  // Pickup
  'pickup', 'pick up', 'pick-up',
  // Specific model words that always indicate large
  'aircross', 'spacetourer', 'picasso',
]

// ── Smart naming patterns: brand prefixes → MAXI ───────────────────────────
// These catch current AND future models (e.g. BMW X8 would auto-match)
const BRAND_MAXI_PATTERNS: [string, RegExp][] = [
  ['bmw', /\bx[1-9]\b/],           // BMW X1, X2, X3, X4, X5, X6, X7
  ['bmw', /\bix[0-9]?\b/],         // BMW iX, iX1, iX3
  ['audi', /\bq[2-9]\b/],          // Audi Q2, Q3, Q4, Q5, Q7, Q8
  ['audi', /\b[rs]?sq?[2-9]\b/],   // Audi SQ5, RSQ8
  ['mercedes', /\bg[la-z]{1,2}\b/], // Mercedes GLA, GLB, GLC, GLE, GLS
  ['mercedes', /\beq[a-z]\b/],     // Mercedes EQA, EQB, EQC, EQE, EQS
  ['mercedes', /\bclasse [c-gv]\b/], // Mercedes Classe C, E, S, G, V
  ['volvo', /\bxc\d{2}\b/],        // Volvo XC40, XC60, XC90
  ['volvo', /\b[vs]\d{2}\b/],      // Volvo V60, V90, S60, S90
  ['volvo', /\bex\d{2}\b/],        // Volvo EX90
  ['mazda', /\bcx[ -]?\d\b/],      // Mazda CX-3, CX-5, CX-30, CX-60
  ['honda', /\b[a-z]r[ -]?v\b/],   // Honda CR-V, HR-V, ZR-V
  ['hyundai', /\bix\d{2}\b/],      // Hyundai ix35, ix55
  ['lexus', /\b[nr]x\b/],          // Lexus NX, RX
  ['infiniti', /\bqx\d{2}\b/],     // Infiniti QX50, QX70
]

// ── All brands that are ALWAYS MAXI (every model) ──────────────────────────
const ALWAYS_MAXI_BRANDS = new Set([
  'land_rover', 'maserati', 'ferrari', 'lamborghini', 'jaguar', 'infiniti',
])

// ── Model DB ────────────────────────────────────────────────────────────────
const VEHICLE_DB: Record<string, { models: string[]; category: VehicleCategory }[]> = {
  fiat: [
    { models: ['panda', '500', '500e', 'punto', 'grande punto', 'punto evo', 'tipo', 'bravo', 'stilo', 'uno', 'seicento', '600', '600e', 'qubo', 'fiorino', 'linea', 'palio', 'idea', 'barchetta'], category: 'urban' },
    { models: ['ducato', 'scudo', 'doblo', 'talento', 'ulysse', 'freemont', 'fullback', '500l', '500x', 'multipla', 'croma', 'sedici'], category: 'maxi' },
  ],
  abarth: [
    { models: ['500', '595', '695', 'punto', '124'], category: 'urban' },
  ],
  volkswagen: [
    { models: ['polo', 'golf', 'up', 'id.3', 'scirocco', 'beetle', 'lupo', 'fox', 'bora', 'jetta', 'eos', 'cc', 'arteon', 'passat', 'taigo'], category: 'urban' },
    { models: ['t cross', 't roc', 'tiguan', 'touareg', 'atlas', 'id.4', 'id.5', 'id.buzz', 'touran', 'sharan', 'caddy', 'transporter', 'caravelle', 'multivan', 'amarok', 'crafter'], category: 'maxi' },
  ],
  bmw: [
    { models: ['serie 1', 'serie 2', '1 series', '2 series', 'i3', 'z3', 'z4', 'serie 4', '4 series'], category: 'urban' },
    { models: ['serie 3', 'serie 5', 'serie 6', 'serie 7', 'serie 8', '3 series', '5 series', '6 series', '7 series', '8 series', 'i4', 'i5', 'i7', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'ix', 'ix1', 'ix3'], category: 'maxi' },
  ],
  mercedes: [
    { models: ['classe a', 'classe b', 'a class', 'b class', 'cla', 'slk', 'slc'], category: 'urban' },
    { models: ['classe c', 'classe e', 'classe s', 'classe g', 'classe v', 'c class', 'e class', 's class', 'g class', 'v class', 'gla', 'glb', 'glc', 'gle', 'gls', 'gl', 'ml', 'cls', 'amg gt', 'eqa', 'eqb', 'eqc', 'eqe', 'eqs', 'vito', 'viano', 'sprinter'], category: 'maxi' },
  ],
  audi: [
    { models: ['a1', 'a2', 'a3', 'tt', 's3', 'rs3'], category: 'urban' },
    { models: ['a4', 'a5', 'a6', 'a7', 'a8', 'q2', 'q3', 'q4', 'q5', 'q7', 'q8', 'e tron', 'etron', 's4', 'rs4', 's5', 'rs5', 'rs6', 's6', 'rs7', 's7', 's8'], category: 'maxi' },
  ],
  toyota: [
    { models: ['yaris', 'aygo', 'corolla', 'auris', 'prius', 'gt86', 'gr86', 'iq'], category: 'urban' },
    { models: ['c hr', 'rav4', 'highlander', 'land cruiser', 'hilux', 'proace', 'verso', 'avensis', 'camry', 'supra', 'bz4x', 'yaris cross'], category: 'maxi' },
  ],
  ford: [
    { models: ['fiesta', 'focus', 'ka', 'mondeo', 'fusion'], category: 'urban' },
    { models: ['puma', 'ecosport', 'kuga', 'edge', 'explorer', 'ranger', 'transit', 'tourneo', 's max', 'galaxy', 'maverick', 'bronco', 'mustang', 'mustang mach e'], category: 'maxi' },
  ],
  opel: [
    { models: ['corsa', 'astra', 'adam', 'karl', 'meriva', 'agila', 'tigra', 'insignia', 'vectra', 'calibra', 'combo life'], category: 'urban' },
    { models: ['mokka', 'crossland', 'grandland', 'zafira', 'vivaro', 'movano', 'combo cargo', 'antara'], category: 'maxi' },
  ],
  renault: [
    { models: ['clio', 'twingo', 'megane', 'zoe', 'laguna', 'fluence', 'symbol'], category: 'urban' },
    { models: ['captur', 'scenic', 'kangoo', 'arkana', 'austral', 'kadjar', 'koleos', 'espace', 'talisman', 'trafic', 'master', 'rafale'], category: 'maxi' },
  ],
  peugeot: [
    { models: ['106', '107', '108', '205', '206', '207', '208', '308', '301', '307', 'rcz'], category: 'urban' },
    { models: ['2008', '3008', '408', '508', '5008', 'partner', 'rifter', 'expert', 'traveller', 'boxer', '807', '607'], category: 'maxi' },
  ],
  citroen: [
    { models: ['c1', 'c2', 'c3', 'c4', 'c elysee', 'saxo', 'xsara', 'ami'], category: 'urban' },
    { models: ['c3 aircross', 'c5', 'c5 aircross', 'c5 x', 'berlingo', 'spacetourer', 'jumpy', 'jumper', 'c8', 'c4 picasso', 'c4 spacetourer', 'grand c4 picasso', 'grand c4 spacetourer'], category: 'maxi' },
  ],
  ds: [
    { models: ['ds3', 'ds3 crossback'], category: 'urban' },
    { models: ['ds4', 'ds7', 'ds9', 'ds7 crossback'], category: 'maxi' },
  ],
  hyundai: [
    { models: ['i10', 'i20', 'i30', 'bayon', 'ioniq', 'accent', 'elantra', 'veloster', 'i40', 'ioniq 6', 'getz', 'matrix', 'ix20'], category: 'urban' },
    { models: ['kona', 'tucson', 'santa fe', 'nexo', 'palisade', 'ioniq 5', 'ioniq 7', 'staria', 'ix35', 'ix55', 'trajet'], category: 'maxi' },
  ],
  kia: [
    { models: ['picanto', 'rio', 'ceed', 'xceed', 'stonic', 'soul', 'ev6', 'optima', 'niro', 'proceed'], category: 'urban' },
    { models: ['sportage', 'sorento', 'ev9', 'carnival', 'stinger', 'telluride', 'carens'], category: 'maxi' },
  ],
  nissan: [
    { models: ['micra', 'note', 'leaf', 'pulsar', 'almera', 'primera', 'ariya', '350z', '370z', 'pixo'], category: 'urban' },
    { models: ['juke', 'qashqai', 'x trail', 'pathfinder', 'navara', 'patrol', 'murano', 'nv200', 'nv300', 'primastar', 'interstar'], category: 'maxi' },
  ],
  honda: [
    { models: ['jazz', 'civic', 'fit', 'city', 'honda e', 'accord', 's2000', 'insight', 'integra', 'prelude'], category: 'urban' },
    { models: ['cr v', 'hr v', 'zr v', 'pilot', 'passport', 'odyssey', 'ridgeline'], category: 'maxi' },
  ],
  alfa: [
    { models: ['mito', 'giulietta', 'giulia', '147', '156', '159', '166', 'brera', 'gt', 'spider', '4c', '33', '75', '155', 'junior'], category: 'urban' },
    { models: ['stelvio', 'tonale'], category: 'maxi' },
  ],
  lancia: [
    { models: ['ypsilon', 'musa', 'delta', 'thesis', 'phedra'], category: 'urban' },
  ],
  seat: [
    { models: ['ibiza', 'leon', 'arona', 'mii', 'toledo', 'altea', 'exeo', 'cordoba'], category: 'urban' },
    { models: ['ateca', 'tarraco', 'alhambra'], category: 'maxi' },
  ],
  skoda: [
    { models: ['fabia', 'scala', 'rapid', 'citigo', 'roomster', 'kamiq'], category: 'urban' },
    { models: ['octavia', 'karoq', 'kodiaq', 'superb', 'enyaq', 'yeti'], category: 'maxi' },
  ],
  volvo: [
    { models: ['v40', 'c30', 's40', 'c40', 'ex30'], category: 'urban' },
    { models: ['s60', 'v60', 'xc40', 'xc60', 'xc90', 'v90', 's90', 'ex90', 'v70', 'xc70'], category: 'maxi' },
  ],
  jeep: [
    { models: ['renegade', 'avenger'], category: 'urban' },
    { models: ['compass', 'cherokee', 'grand cherokee', 'wrangler', 'gladiator', 'commander', 'patriot'], category: 'maxi' },
  ],
  land_rover: [
    { models: ['freelander', 'evoque', 'discovery sport', 'range rover', 'range rover sport', 'range rover velar', 'defender', 'discovery'], category: 'maxi' },
  ],
  porsche: [
    { models: ['718', 'boxster', 'cayman'], category: 'urban' },
    { models: ['911', 'macan', 'cayenne', 'panamera', 'taycan'], category: 'maxi' },
  ],
  mini: [
    { models: ['one', 'cooper', 'hatch', 'cabrio', 'convertible', 'electric', 'coupe', 'roadster', 'paceman'], category: 'urban' },
    { models: ['countryman', 'clubman'], category: 'maxi' },
  ],
  suzuki: [
    { models: ['swift', 'ignis', 'baleno', 'alto', 'celerio', 'splash', 'sx4'], category: 'urban' },
    { models: ['vitara', 'jimny', 'grand vitara', 's cross', 'across'], category: 'maxi' },
  ],
  dacia: [
    { models: ['logan', 'spring'], category: 'urban' },
    { models: ['sandero', 'duster', 'jogger', 'lodgy', 'dokker'], category: 'maxi' },
  ],
  mazda: [
    { models: ['2', 'mazda2', '3', 'mazda3', 'mx 5', 'mx 30', 'demio', '323', '6', 'mazda6'], category: 'urban' },
    { models: ['cx 3', 'cx 30', 'cx 5', 'cx 60', 'cx 80', 'cx 9', 'bt 50'], category: 'maxi' },
  ],
  tesla: [
    { models: ['model 3'], category: 'urban' },
    { models: ['model s', 'model x', 'model y', 'cybertruck'], category: 'maxi' },
  ],
  smart: [
    { models: ['fortwo', 'forfour', '#1', '#3'], category: 'urban' },
  ],
  maserati: [
    { models: ['ghibli', 'grancabrio', 'granturismo', 'mc20', 'levante', 'grecale'], category: 'maxi' },
  ],
  ferrari: [
    { models: ['296', '488', 'f8', 'roma', 'portofino', '812', 'sf90', 'daytona', 'laferrari', '458', '430', '360', '355', '348', 'california', 'enzo'], category: 'maxi' },
  ],
  lamborghini: [
    { models: ['huracan', 'aventador', 'urus', 'gallardo', 'murcielago', 'revuelto', 'temerario'], category: 'maxi' },
  ],
  cupra: [
    { models: ['born', 'leon', 'formentor'], category: 'urban' },
    { models: ['ateca', 'tavascan', 'terramar'], category: 'maxi' },
  ],
  subaru: [
    { models: ['impreza', 'wrx', 'brz', 'xv', 'crosstrek', 'legacy', 'levorg'], category: 'urban' },
    { models: ['outback', 'forester', 'solterra', 'ascent', 'tribeca'], category: 'maxi' },
  ],
  mitsubishi: [
    { models: ['space star', 'colt', 'lancer', 'carisma', 'galant'], category: 'urban' },
    { models: ['asx', 'eclipse cross', 'outlander', 'l200', 'pajero', 'shogun'], category: 'maxi' },
  ],
  dodge: [
    { models: ['challenger', 'charger', 'dart', 'neon', 'durango', 'ram', 'journey', 'nitro'], category: 'maxi' },
  ],
  chevrolet: [
    { models: ['spark', 'aveo', 'cruze', 'bolt', 'malibu', 'camaro', 'corvette', 'matiz', 'kalos'], category: 'urban' },
    { models: ['captiva', 'trax', 'equinox', 'blazer', 'tahoe', 'suburban', 'colorado', 'silverado', 'orlando', 'trailblazer'], category: 'maxi' },
  ],
  dr: [
    { models: ['1', 'dr1', '3', 'dr3'], category: 'urban' },
    { models: ['4', 'dr4', '5', 'dr5', '6', 'dr6', '7', 'dr7', 'f35', 'evo'], category: 'maxi' },
  ],
  evo: [
    { models: ['3', '4', '5', '6', 'cross 4'], category: 'maxi' },
  ],
  mg: [
    { models: ['3', 'mg3', '4', 'mg4', '5', 'mg5'], category: 'urban' },
    { models: ['zs', 'hs', 'marvel r', 'ehs'], category: 'maxi' },
  ],
  ssangyong: [
    { models: ['tivoli'], category: 'urban' },
    { models: ['korando', 'rexton', 'musso', 'rodius', 'torres'], category: 'maxi' },
  ],
  jaguar: [
    { models: ['xe', 'xf', 'xj', 'f type', 'i pace'], category: 'maxi' },
  ],
  lexus: [
    { models: ['ct', 'is', 'es', 'ux'], category: 'urban' },
    { models: ['nx', 'rx', 'lx', 'lc', 'ls', 'rz'], category: 'maxi' },
  ],
  infiniti: [
    { models: ['q30', 'q50', 'q60', 'qx30', 'qx50', 'qx70', 'qx80'], category: 'maxi' },
  ],
}

// ── Brand aliases ───────────────────────────────────────────────────────────
const BRAND_ALIASES: Record<string, string> = {
  'vw': 'volkswagen',
  'mercedes-benz': 'mercedes',
  'mercedes benz': 'mercedes',
  'alfa romeo': 'alfa',
  'alfaromeo': 'alfa',
  'land rover': 'land_rover',
  'landrover': 'land_rover',
  'range rover': 'land_rover',
  'citroën': 'citroen',
  'citröen': 'citroen',
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/ª/g, '').replace(/°/g, '')     // strip "4ª serie" → "4 serie"
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function hasMaxiKeyword(text: string): string | null {
  const n = normalize(text)
  for (const kw of MAXI_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (re.test(n)) return kw
  }
  return null
}

function resolveBrand(input: string): string {
  const n = normalize(input)
  // Check aliases first (longest match)
  const sortedAliases = Object.entries(BRAND_ALIASES).sort((a, b) => b[0].length - a[0].length)
  for (const [alias, resolved] of sortedAliases) {
    if (n === alias || n.startsWith(alias + ' ')) return resolved
  }
  // Direct brand match
  for (const brand of Object.keys(VEHICLE_DB)) {
    if (n === brand || n.startsWith(brand + ' ')) return brand
  }
  return ''
}

function extractModel(input: string, brand: string): string {
  let n = normalize(input)
  const allNames = [brand, ...Object.entries(BRAND_ALIASES).filter(([, v]) => v === brand).map(([k]) => k)]
    .sort((a, b) => b.length - a.length)
  for (const name of allNames) {
    if (n.startsWith(name + ' ')) { n = n.slice(name.length).trim(); break }
    if (n.startsWith(name)) { n = n.slice(name.length).trim(); break }
  }
  return n
}

// ── Smart pattern check ─────────────────────────────────────────────────────
function matchesBrandMaxiPattern(brand: string, modelPart: string): boolean {
  for (const [patternBrand, regex] of BRAND_MAXI_PATTERNS) {
    if (brand === patternBrand && regex.test(modelPart)) return true
  }
  return false
}

// ── Main classification ─────────────────────────────────────────────────────
export function classifyVehicleLocally(makeModel: string): ClassificationResult {
  const input = normalize(makeModel)
  if (!input) return { category: 'urban', confidence: 'low', source: 'local' }

  // 1. MAXI keyword in full text
  const kw = hasMaxiKeyword(input)
  if (kw) {
    return { category: 'maxi', confidence: 'high', source: 'local', matchedBrand: resolveBrand(input) || undefined, matchedModel: kw }
  }

  // 2. Resolve brand
  const brand = resolveBrand(input)

  // 3. Always-MAXI brands
  if (brand && ALWAYS_MAXI_BRANDS.has(brand)) {
    return { category: 'maxi', confidence: 'high', source: 'local', matchedBrand: brand }
  }

  // 4. Smart brand-specific naming patterns
  if (brand) {
    const modelPart = extractModel(input, brand)
    if (modelPart && matchesBrandMaxiPattern(brand, modelPart)) {
      return { category: 'maxi', confidence: 'high', source: 'local', matchedBrand: brand, matchedModel: modelPart.split(' ')[0] }
    }
  }

  // 5. DB lookup
  if (brand && VEHICLE_DB[brand]) {
    const modelPart = extractModel(input, brand)
    if (modelPart) {
      const entries = VEHICLE_DB[brand]
      // Exact / starts-with (check longer models first)
      for (const entry of entries) {
        const sorted = [...entry.models].sort((a, b) => b.length - a.length)
        for (const model of sorted) {
          const nm = normalize(model)
          if (modelPart === nm || modelPart.startsWith(nm + ' ') || modelPart.startsWith(nm)) {
            return { category: entry.category, confidence: 'high', source: 'local', matchedBrand: brand, matchedModel: model }
          }
        }
      }
      // Partial / contains
      for (const entry of entries) {
        for (const model of entry.models) {
          const nm = normalize(model)
          if (modelPart.includes(nm) || nm.includes(modelPart)) {
            return { category: entry.category, confidence: 'medium', source: 'local', matchedBrand: brand, matchedModel: model }
          }
        }
      }
    }
  }

  // 6. Default → URBAN
  return { category: 'urban', confidence: 'low', source: 'local', matchedBrand: brand || undefined }
}

export async function classifyVehicle(makeModel: string): Promise<ClassificationResult> {
  return classifyVehicleLocally(makeModel)
}
