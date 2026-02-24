/**
 * Vehicle Classification Utility
 * Classifies vehicles as URBAN or MAXI for car wash pricing.
 *
 * URBAN = small/medium cars (segments A, B)
 * MAXI = SUV, crossover, monovolumi, fuoristrada, station wagon, large cars (segments D+)
 *
 * IMPORTANT: Any car in Station Wagon / SW / Variant / Touring / Avant form = MAXI
 * Borderline segment C sedans/hatchbacks (Golf, Focus, Astra, etc.) = URBAN
 */

export type VehicleCategory = 'urban' | 'maxi'

interface ClassificationResult {
  category: VehicleCategory
  confidence: 'high' | 'medium' | 'low'
  source: 'local' | 'api'
  matchedBrand?: string
  matchedModel?: string
}

// Keywords that indicate MAXI body type — always MAXI regardless of model
const MAXI_KEYWORDS = [
  // Station wagon variants
  'station wagon', 'sw', 'wagon', 'variant', 'touring', 'avant',
  'estate', 'break', 'allroad', 'alltrack', 'cross country',
  'sportwagon', 'sport wagon',
  // SUV / crossover / fuoristrada
  'suv', 'crossover', 'fuoristrada', 'off road', 'offroad', '4x4', '4wd',
  'stepway', 'cross',
  // Monovolume / MPV / van
  'monovolume', 'mpv', 'minivan', 'van', 'multivan',
  // Pickup
  'pickup', 'pick up', 'pick-up',
]

// Brand → [{ models[], category }]
const VEHICLE_DB: Record<string, { models: string[]; category: VehicleCategory }[]> = {
  fiat: [
    { models: ['panda', 'panda hybrid', '500', '500 hybrid', '500e', 'punto', 'grande punto', 'punto evo', 'tipo', 'tipo 5p', 'bravo', 'stilo', 'evo', 'uno', 'seicento', '600', '600e', 'qubo', 'fiorino', 'linea', 'palio', 'idea', 'barchetta'], category: 'urban' },
    { models: ['ducato', 'scudo', 'doblo', 'talento', 'ulysse', 'freemont', 'fullback', '500l', '500x', 'multipla', 'croma', 'sedici'], category: 'maxi' },
  ],
  abarth: [
    { models: ['500', '595', '695', 'punto', 'punto abarth', '124', '124 spider'], category: 'urban' },
  ],
  volkswagen: [
    { models: ['polo', 'golf', 'up', 'e up', 'id.3', 'id.2', 'scirocco', 'beetle', 'new beetle', 'lupo', 'fox', 'bora', 'jetta', 'eos', 'cc', 'arteon', 'passat', 'taigo'], category: 'urban' },
    { models: ['t-cross', 't cross', 't-roc', 't roc', 'tiguan', 'touareg', 'atlas', 'id.4', 'id.5', 'id.buzz', 'touran', 'sharan', 'caddy', 'transporter', 't5', 't6', 't7', 'caravelle', 'multivan', 'amarok', 'crafter'], category: 'maxi' },
  ],
  bmw: [
    { models: ['serie 1', 'serie 2', '1 series', '2 series', '116', '118', '120', '125', '216', '218', '220', '225', 'i3', 'z3', 'z4', 'serie 4', '4 series', '420', '430', '440'], category: 'urban' },
    { models: ['serie 3', 'serie 5', 'serie 6', 'serie 7', 'serie 8', '3 series', '5 series', '6 series', '7 series', '8 series', '316', '318', '320', '325', '330', '520', '530', '540', '550', '630', '640', '650', '730', '740', '750', '840', '850', 'i4', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'ix', 'ix1', 'ix3', 'i5', 'i7', 'ix5'], category: 'maxi' },
  ],
  mercedes: [
    { models: ['classe a', 'classe b', 'a class', 'b class', 'a180', 'a200', 'a250', 'a35', 'b180', 'b200', 'cla', 'slk', 'slc'], category: 'urban' },
    { models: ['classe c', 'classe e', 'classe s', 'c class', 'e class', 's class', 'c180', 'c200', 'c220', 'c250', 'c300', 'c43', 'c63', 'e200', 'e220', 'e300', 'e350', 'e400', 'e53', 'e63', 's350', 's400', 's500', 's580', 's63', 'gla', 'glb', 'glc', 'gle', 'gls', 'gl', 'ml', 'cls', 'amg gt', 'eqa', 'eqb', 'eqc', 'eqe', 'eqs', 'vito', 'viano', 'sprinter', 'classe v', 'v class', 'classe g', 'g class'], category: 'maxi' },
  ],
  audi: [
    { models: ['a1', 'a2', 'a3', 'tt', 's3', 'rs3'], category: 'urban' },
    { models: ['a4', 'a5', 'a6', 'a7', 'a8', 'q2', 'q3', 'q4', 'q5', 'q7', 'q8', 'e-tron', 'etron', 'q4 e-tron', 'q8 e-tron', 's4', 'rs4', 's5', 'rs5', 'rs6', 's6', 'rs7', 's7', 's8', 'rs q8', 'sq5', 'sq7', 'sq8'], category: 'maxi' },
  ],
  toyota: [
    { models: ['yaris', 'aygo', 'corolla', 'auris', 'prius', 'gt86', 'gr86', 'celica', 'mr2', 'iq', 'urban cruiser'], category: 'urban' },
    { models: ['c-hr', 'chr', 'c hr', 'rav4', 'highlander', 'land cruiser', 'hilux', 'proace', 'verso', 'avensis', 'camry', 'supra', 'bz4x', 'yaris cross'], category: 'maxi' },
  ],
  ford: [
    { models: ['fiesta', 'focus', 'ka', 'ka+', 'mondeo', 'fusion', 'probe', 'cougar'], category: 'urban' },
    { models: ['puma', 'ecosport', 'kuga', 'edge', 'explorer', 'expedition', 'ranger', 'transit', 'transit connect', 'tourneo', 's-max', 'galaxy', 'maverick', 'bronco', 'mustang', 'mustang mach-e'], category: 'maxi' },
  ],
  opel: [
    { models: ['corsa', 'corsa-e', 'corsa e', 'astra', 'adam', 'karl', 'meriva', 'agila', 'tigra', 'insignia', 'vectra', 'calibra', 'combo life'], category: 'urban' },
    { models: ['mokka', 'mokka-e', 'mokka e', 'crossland', 'crossland x', 'grandland', 'grandland x', 'zafira', 'vivaro', 'movano', 'combo cargo', 'antara'], category: 'maxi' },
  ],
  renault: [
    { models: ['clio', 'twingo', 'twingo e-tech', 'twingo e tech', 'megane', 'scenic', 'captur', 'zoe', 'kangoo', 'laguna', 'fluence', 'wind', 'symbol', 'megane e-tech', 'megane e tech'], category: 'urban' },
    { models: ['arkana', 'austral', 'kadjar', 'koleos', 'espace', 'talisman', 'trafic', 'master', 'rafale'], category: 'maxi' },
  ],
  peugeot: [
    { models: ['106', '107', '108', '205', '206', '207', '208', '308', '2008', '301', '307', 'rcz', 'e-208', 'e 208', 'e-308', 'ion'], category: 'urban' },
    { models: ['3008', '408', '508', '5008', 'partner', 'rifter', 'expert', 'traveller', 'boxer', '4008', 'e-3008', 'e-5008', '807', '607'], category: 'maxi' },
  ],
  citroen: [
    { models: ['c1', 'c2', 'c3', 'c4', 'c3 aircross', 'c-elysee', 'saxo', 'xsara', 'ami', 'e-c4'], category: 'urban' },
    { models: ['c5', 'c5 aircross', 'c5 x', 'berlingo', 'spacetourer', 'jumpy', 'jumper', 'c8', 'c4 picasso', 'c4 spacetourer', 'grand c4 picasso', 'grand c4 spacetourer'], category: 'maxi' },
  ],
  ds: [
    { models: ['ds3', 'ds3 crossback'], category: 'urban' },
    { models: ['ds4', 'ds7', 'ds9', 'ds7 crossback'], category: 'maxi' },
  ],
  hyundai: [
    { models: ['i10', 'i20', 'i30', 'bayon', 'ioniq', 'accent', 'elantra', 'veloster', 'i40', 'ioniq 6', 'getz', 'matrix', 'ix20'], category: 'urban' },
    { models: ['kona', 'kona electric', 'tucson', 'santa fe', 'nexo', 'palisade', 'ioniq 5', 'ioniq 7', 'staria', 'h-1', 'ix35', 'ix55', 'trajet'], category: 'maxi' },
  ],
  kia: [
    { models: ['picanto', 'rio', 'ceed', 'xceed', 'stonic', 'soul', 'ev6', 'optima', 'forte', 'niro', 'pro ceed', 'proceed'], category: 'urban' },
    { models: ['sportage', 'sorento', 'ev9', 'carnival', 'stinger', 'telluride', 'carens', 'mohave'], category: 'maxi' },
  ],
  nissan: [
    { models: ['micra', 'note', 'leaf', 'pulsar', 'almera', 'primera', 'ariya', 'sunny', 'sentra', 'tiida', '350z', '370z', 'pixo'], category: 'urban' },
    { models: ['juke', 'qashqai', 'x-trail', 'x trail', 'pathfinder', 'navara', 'patrol', 'murano', 'nv200', 'nv300', 'e-nv200', 'primastar', 'interstar'], category: 'maxi' },
  ],
  honda: [
    { models: ['jazz', 'civic', 'fit', 'city', 'e', 'honda e', 'accord', 's2000', 'insight', 'integra', 'prelude'], category: 'urban' },
    { models: ['cr-v', 'hr-v', 'zr-v', 'pilot', 'passport', 'odyssey', 'element', 'ridgeline', 'e:ny1'], category: 'maxi' },
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
    { models: ['fabia', 'scala', 'rapid', 'citigo', 'roomster', 'kamiq', 'enyaq coupe'], category: 'urban' },
    { models: ['octavia', 'karoq', 'kodiaq', 'superb', 'enyaq', 'yeti'], category: 'maxi' },
  ],
  volvo: [
    { models: ['v40', 'c30', 's40', 'c40', 'ex30'], category: 'urban' },
    { models: ['s60', 'v60', 'xc40', 'xc60', 'xc90', 'v90', 's90', 'ex90', 'em90', 'v70', 'xc70'], category: 'maxi' },
  ],
  jeep: [
    { models: ['renegade', 'avenger'], category: 'urban' },
    { models: ['compass', 'cherokee', 'grand cherokee', 'wrangler', 'gladiator', 'commander', 'patriot'], category: 'maxi' },
  ],
  land_rover: [
    { models: ['freelander', 'evoque', 'range rover evoque', 'discovery sport', 'range rover', 'range rover sport', 'range rover velar', 'defender', 'discovery'], category: 'maxi' },
  ],
  porsche: [
    { models: ['718', 'boxster', 'cayman'], category: 'urban' },
    { models: ['911', 'macan', 'cayenne', 'panamera', 'taycan'], category: 'maxi' },
  ],
  mini: [
    { models: ['one', 'cooper', 'cooper s', 'cooper se', 'john cooper works', 'hatch', '3 door', '3 porte', '5 door', '5 porte', 'cabrio', 'convertible', 'electric', 'coupe', 'roadster', 'paceman'], category: 'urban' },
    { models: ['countryman', 'clubman'], category: 'maxi' },
  ],
  suzuki: [
    { models: ['swift', 'ignis', 'baleno', 'alto', 'celerio', 'splash', 'sx4'], category: 'urban' },
    { models: ['vitara', 'jimny', 'grand vitara', 's-cross', 'sx4 s-cross', 'across'], category: 'maxi' },
  ],
  dacia: [
    { models: ['sandero', 'logan', 'spring'], category: 'urban' },
    { models: ['sandero stepway', 'duster', 'jogger', 'lodgy', 'dokker'], category: 'maxi' },
  ],
  mazda: [
    { models: ['2', 'mazda2', '3', 'mazda3', 'mx-5', 'mx-30', 'demio', '323', '6', 'mazda6'], category: 'urban' },
    { models: ['cx-3', 'cx-30', 'cx-5', 'cx-60', 'cx-80', 'cx-9', 'bt-50', 'cx-7'], category: 'maxi' },
  ],
  tesla: [
    { models: ['model 3'], category: 'urban' },
    { models: ['model s', 'model x', 'model y', 'cybertruck'], category: 'maxi' },
  ],
  smart: [
    { models: ['fortwo', 'forfour', 'eq fortwo', 'eq forfour', '#1', '#3'], category: 'urban' },
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
    { models: ['impreza', 'wrx', 'brz', 'xv', 'crosstrek', 'legacy', 'levorg', 'justy', 'trezia'], category: 'urban' },
    { models: ['outback', 'forester', 'solterra', 'ascent', 'tribeca'], category: 'maxi' },
  ],
  mitsubishi: [
    { models: ['space star', 'colt', 'lancer', 'i-miev', 'carisma', 'galant'], category: 'urban' },
    { models: ['asx', 'eclipse cross', 'outlander', 'l200', 'pajero', 'shogun'], category: 'maxi' },
  ],
  dodge: [
    { models: ['challenger', 'charger', 'dart', 'neon', 'avenger', 'caliber', 'viper', 'durango', 'ram', 'journey', 'nitro'], category: 'maxi' },
  ],
  chevrolet: [
    { models: ['spark', 'aveo', 'cruze', 'sonic', 'bolt', 'malibu', 'camaro', 'corvette', 'matiz', 'kalos'], category: 'urban' },
    { models: ['captiva', 'trax', 'equinox', 'blazer', 'tahoe', 'suburban', 'colorado', 'silverado', 'orlando', 'trailblazer'], category: 'maxi' },
  ],
  dr: [
    { models: ['1', 'dr1', '3', 'dr3', '5', 'dr5'], category: 'urban' },
    { models: ['4', 'dr4', '6', 'dr6', '7', 'dr7', 'f35', 'evo'], category: 'maxi' },
  ],
  evo: [
    { models: ['3', '4', '5', '6', 'cross 4'], category: 'urban' },
  ],
  mg: [
    { models: ['3', 'mg3', '4', 'mg4', '5', 'mg5', 'zs ev'], category: 'urban' },
    { models: ['zs', 'hs', 'marvel r', 'ehs'], category: 'maxi' },
  ],
  ssangyong: [
    { models: ['tivoli'], category: 'urban' },
    { models: ['korando', 'rexton', 'musso', 'xlv', 'rodius', 'torres'], category: 'maxi' },
  ],
  jaguar: [
    { models: ['xe', 'xf', 'xj', 'f-type', 'i-pace'], category: 'maxi' },
  ],
  lexus: [
    { models: ['ct', 'is', 'es', 'ux'], category: 'urban' },
    { models: ['nx', 'rx', 'lx', 'lc', 'ls', 'rz'], category: 'maxi' },
  ],
  infiniti: [
    { models: ['q30', 'q50', 'q60', 'qx30', 'qx50', 'qx70', 'qx80'], category: 'maxi' },
  ],
}

// Brand aliases for normalization
const BRAND_ALIASES: Record<string, string> = {
  'vw': 'volkswagen',
  'mercedes-benz': 'mercedes',
  'mercedes benz': 'mercedes',
  'merc': 'mercedes',
  'mb': 'mercedes',
  'alfa romeo': 'alfa',
  'alfaromeo': 'alfa',
  'land rover': 'land_rover',
  'landrover': 'land_rover',
  'range rover': 'land_rover',
  'citroën': 'citroen',
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' ')
}

function hasMaxiKeyword(input: string): string | null {
  const n = normalize(input)
  for (const keyword of MAXI_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (regex.test(n)) return keyword
  }
  return null
}

function resolveBrand(input: string): string {
  const n = normalize(input)
  if (BRAND_ALIASES[n]) return BRAND_ALIASES[n]
  // Check if input starts with a known alias
  for (const [alias, resolved] of Object.entries(BRAND_ALIASES)) {
    if (n.startsWith(alias + ' ')) return resolved
  }
  // Direct brand match
  if (VEHICLE_DB[n]) return n
  // Partial match
  for (const brand of Object.keys(VEHICLE_DB)) {
    if (n.startsWith(brand + ' ') || n.startsWith(brand)) return brand
  }
  return ''
}

export function classifyVehicleLocally(makeModel: string): ClassificationResult {
  const input = normalize(makeModel)
  if (!input) return { category: 'urban', confidence: 'low', source: 'local' }

  // MAXI keyword detection (SUV, SW, fuoristrada, monovolume, etc.) — always MAXI
  const maxiKeyword = hasMaxiKeyword(input)
  if (maxiKeyword) {
    const brand = resolveBrand(input)
    return {
      category: 'maxi',
      confidence: 'high',
      source: 'local',
      matchedBrand: brand || undefined,
      matchedModel: maxiKeyword,
    }
  }

  // Try to resolve the brand
  const brand = resolveBrand(input)
  if (!brand || !VEHICLE_DB[brand]) {
    // Unknown brand — default to URBAN
    return { category: 'urban', confidence: 'low', source: 'local' }
  }

  const entries = VEHICLE_DB[brand]

  // Extract the model part (everything after the brand name)
  let modelPart = input
  const brandVariants = [brand, ...Object.entries(BRAND_ALIASES).filter(([, v]) => v === brand).map(([k]) => k)]
    .sort((a, b) => b.length - a.length)
  for (const variant of brandVariants) {
    if (modelPart.startsWith(variant + ' ')) {
      modelPart = modelPart.slice(variant.length).trim()
      break
    } else if (modelPart.startsWith(variant)) {
      modelPart = modelPart.slice(variant.length).trim()
      break
    }
  }

  if (!modelPart) {
    // Only brand, no model — default to URBAN
    return { category: 'urban', confidence: 'low', source: 'local', matchedBrand: brand }
  }

  // Search for exact model match
  for (const entry of entries) {
    for (const model of entry.models) {
      const normalizedModel = normalize(model)
      if (modelPart === normalizedModel || modelPart.startsWith(normalizedModel + ' ') || modelPart.startsWith(normalizedModel)) {
        return {
          category: entry.category,
          confidence: 'high',
          source: 'local',
          matchedBrand: brand,
          matchedModel: model,
        }
      }
    }
  }

  // Partial matching
  for (const entry of entries) {
    for (const model of entry.models) {
      const normalizedModel = normalize(model)
      if (modelPart.includes(normalizedModel) || normalizedModel.includes(modelPart)) {
        return {
          category: entry.category,
          confidence: 'medium',
          source: 'local',
          matchedBrand: brand,
          matchedModel: model,
        }
      }
    }
  }

  // Brand known but model not found — default to URBAN
  return { category: 'urban', confidence: 'low', source: 'local', matchedBrand: brand }
}

export async function classifyVehicleFromAPI(makeModel: string): Promise<ClassificationResult> {
  try {
    const response = await fetch('/.netlify/functions/classify-vehicle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ makeModel }),
    })

    if (!response.ok) throw new Error('API error')

    const data = await response.json()
    return {
      category: data.category === 'urban' ? 'urban' : 'maxi',
      confidence: data.confidence || 'medium',
      source: 'api',
    }
  } catch {
    // Default to MAXI on failure (higher price = safer)
    return {
      category: 'maxi',
      confidence: 'low',
      source: 'api',
    }
  }
}

export async function classifyVehicle(makeModel: string): Promise<ClassificationResult> {
  // Try local first
  const localResult = classifyVehicleLocally(makeModel)
  if (localResult) return localResult

  // Fallback to API
  return classifyVehicleFromAPI(makeModel)
}
