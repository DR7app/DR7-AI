import { getProvinciaByCityName } from '../utils/codiceFiscale'

export interface Provincia {
  code: string
  name: string
  comuni: string[]
}

export const SARDEGNA_PROVINCE: Provincia[] = [
  {
    code: 'CA',
    name: 'Città Metropolitana di Cagliari',
    comuni: [
      'Assemini', 'Cagliari', 'Capoterra', 'Decimomannu', 'Elmas',
      'Maracalagonis', 'Monserrato', 'Pula', 'Quartu Sant\'Elena',
      'Quartucciu', 'Sarroch', 'Selargius', 'Sestu', 'Settimo San Pietro',
      'Sinnai', 'Uta', 'Villa San Pietro'
    ].sort()
  },
  {
    code: 'SU',
    name: 'Provincia del Sud Sardegna',
    comuni: [
      'Arbus', 'Armungia', 'Ballao', 'Barrali', 'Barumini', 'Buggerru',
      'Burcei', 'Calasetta', 'Carbonia', 'Carloforte', 'Castiadas',
      'Collinas', 'Decimoputzu', 'Dolianova', 'Domusnovas', 'Donori',
      'Escalaplano', 'Escolca', 'Esterzili', 'Fluminimaggiore', 'Furtei',
      'Genoni', 'Genuri', 'Gergei', 'Gesico', 'Gesturi', 'Giba', 'Goni',
      'Gonnosfanadiga', 'Gonnesa', 'Gonnostramatza', 'Guamaggiore',
      'Guasila', 'Guspini', 'Iglesias', 'Isili', 'Las Plassas',
      'Lunamatrona', 'Mandas', 'Masainas', 'Monastir', 'Muravera',
      'Musei', 'Narcao', 'Nuragus', 'Nurallao', 'Nuraminis', 'Nurri',
      'Nuxis', 'Orroli', 'Ortacesus', 'Pabillonis', 'Pauli Arbarei',
      'Perdaxius', 'Pimentel', 'Piscinas', 'Portoscuso', 'Sadali',
      'Samassi', 'Samatzai', 'San Basilio', 'San Gavino Monreale',
      'San Giovanni Suergiu', 'San Nicolò Gerrei', 'San Sperate',
      'San Vito', 'Sanluri', 'Sant\'Andrea Frius', 'Sant\'Anna Arresi',
      'Sant\'Antioco', 'Santadi', 'Sardara', 'Segariu', 'Senorbì',
      'Serdiana', 'Serramanna', 'Serrenti', 'Serri', 'Setzu', 'Seui',
      'Siliqua', 'Silius', 'Siurgus Donigala', 'Soleminis', 'Suelli',
      'Teulada', 'Tratalias', 'Tuili', 'Turri', 'Ussana', 'Ussaramanna',
      'Vallermosa', 'Villacidro', 'Villamassargia', 'Villanova Tulo',
      'Villanovaforru', 'Villanovafranca', 'Villaperuccio', 'Villaputzu',
      'Villasalto', 'Villasimius', 'Villasor', 'Villaspeciosa'
    ].sort()
  },
  {
    code: 'SS',
    name: 'Provincia di Sassari',
    comuni: [
      'Aggius', 'Aglientu', 'Alà dei Sardi', 'Alghero', 'Anela',
      'Ardara', 'Arzachena', 'Banari', 'Benetutti', 'Berchidda',
      'Bessude', 'Bonnanaro', 'Bono', 'Bonorva', 'Bortigiadas',
      'Borutta', 'Bottidda', 'Buddusò', 'Budoni', 'Bultei', 'Bulzi',
      'Burgos', 'Calangianus', 'Cargeghe', 'Castelsardo', 'Cheremule',
      'Chiaramonti', 'Codrongianos', 'Cossoine', 'Erula', 'Esporlatu',
      'Florinas', 'Giave', 'Golfo Aranci', 'Illorai', 'Ittireddu',
      'Ittiri', 'La Maddalena', 'Laerru', 'Loiri Porto San Paolo',
      'Luogosanto', 'Luras', 'Mara', 'Martis', 'Monteleone Rocca Doria',
      'Monti', 'Mores', 'Muros', 'Nughedu San Nicolò', 'Nule', 'Nulvi',
      'Olbia', 'Olmedo', 'Oschiri', 'Osilo', 'Ossi', 'Ozieri',
      'Padria', 'Padru', 'Palau', 'Pattada', 'Perfugas', 'Ploaghe',
      'Porto Torres', 'Pozzomaggiore', 'Putifigari', 'Romana',
      'San Teodoro', 'Santa Maria Coghinas', 'Santa Teresa Gallura',
      'Sassari', 'Sedini', 'Semestene', 'Sennori', 'Siligo', 'Sorso',
      'Stintino', 'Telti', 'Tempio Pausania', 'Tergu', 'Thiesi',
      'Tissi', 'Torralba', 'Trinità d\'Agultu e Vignola', 'Tula',
      'Uri', 'Usini', 'Valledoria', 'Viddalba',
      'Villanova Monteleone'
    ].sort()
  },
  {
    code: 'NU',
    name: 'Provincia di Nuoro',
    comuni: [
      'Aritzo', 'Arzana', 'Atzara', 'Austis', 'Bari Sardo', 'Baunei',
      'Belvì', 'Birori', 'Bitti', 'Bolotana', 'Borore', 'Bortigali',
      'Cardedu', 'Desulo', 'Dorgali', 'Dualchi', 'Elini', 'Fonni',
      'Gadoni', 'Gairo', 'Galtellì', 'Gavoi', 'Girasole', 'Ilbono',
      'Irgoli', 'Jerzu', 'Lanusei', 'Lei', 'Loceri', 'Loculi',
      'Lodè', 'Lodine', 'Lotzorai', 'Lula', 'Macomer', 'Mamoiada',
      'Meana Sardo', 'Noragugume', 'Nuoro', 'Oliena', 'Ollolai',
      'Olzai', 'Onanì', 'Onifai', 'Oniferi', 'Orani', 'Orgosolo',
      'Orosei', 'Orotelli', 'Ortueri', 'Orune', 'Osidda', 'Osini',
      'Ottana', 'Ovodda', 'Perdasdefogu', 'Posada', 'Sarule',
      'Silanus', 'Siniscola', 'Sorgono', 'Talana', 'Tertenia', 'Teti',
      'Tiana', 'Tonara', 'Tortolì', 'Triei', 'Ulassai', 'Urzulei',
      'Villagrande Strisaili'
    ].sort()
  },
  {
    code: 'OR',
    name: 'Provincia di Oristano',
    comuni: [
      'Abbasanta', 'Aidomaggiore', 'Albagiara', 'Ales', 'Allai',
      'Arborea', 'Ardauli', 'Assolo', 'Asuni', 'Baradili', 'Baressa',
      'Bauladu', 'Bidonì', 'Bonarcado', 'Boroneddu', 'Bosa', 'Busachi',
      'Cabras', 'Cuglieri', 'Curcuris', 'Flussio', 'Fordongianus',
      'Ghilarza', 'Gonnoscodina', 'Gonnosnò', 'Laconi', 'Magomadas',
      'Marrubiu', 'Masullas', 'Milis', 'Modolo', 'Mogorella', 'Mogoro',
      'Montresta', 'Morgongiori', 'Narbolia', 'Neoneli', 'Norbello',
      'Nughedu Santa Vittoria', 'Nurachi', 'Nureci', 'Ollastra',
      'Oristano', 'Palmas Arborea', 'Pau', 'Paulilatino', 'Pompu',
      'Riola Sardo', 'Ruinas', 'Sagama', 'Samugheo',
      'San Nicolò d\'Arcidano', 'San Vero Milis', 'Santa Giusta',
      'Santu Lussurgiu', 'Scano di Montiferro', 'Sedilo', 'Seneghe',
      'Senis', 'Sennariolo', 'Siamanna', 'Siapiccia', 'Simala',
      'Simaxis', 'Sindia', 'Siris', 'Solarussa', 'Sorradile',
      'Suni', 'Tadasuni', 'Terralba', 'Tinnura', 'Tramatza',
      'Tresnuraghes', 'Ula Tirso', 'Uras', 'Usellus',
      'Villa Sant\'Antonio', 'Villa Verde', 'Villanova Truschedu',
      'Villaurbana', 'Zeddiani', 'Zerfaliu'
    ].sort()
  }
]

// Flat lookup: province code → comuni
export function getComuniByProvincia(code: string): string[] {
  const prov = SARDEGNA_PROVINCE.find(p => p.code === code)
  return prov ? prov.comuni : []
}

// All province codes
export const PROVINCE_CODES = SARDEGNA_PROVINCE.map(p => ({ code: p.code, name: p.name }))

// Province codes considered "resident" for tax/reporting purposes
export const RESIDENT_PROVINCE_CODES = ['CA', 'SU']

// Check if a province code is resident (CA or SU)
export function isResidentByProvincia(provinciaCode: string): boolean {
  return RESIDENT_PROVINCE_CODES.includes(provinciaCode.toUpperCase())
}

// Check if a city name is in CA or SU (case-insensitive)
export function isResidentByCity(cityName: string): boolean {
  if (!cityName) return false
  const normalizedCity = cityName.trim().toLowerCase()

  for (const prov of SARDEGNA_PROVINCE) {
    if (RESIDENT_PROVINCE_CODES.includes(prov.code)) {
      if (prov.comuni.some(c => c.toLowerCase() === normalizedCity)) {
        return true
      }
    }
  }
  return false
}

// Reverse lookup: given a city name, return its province code.
// 2026-05-22 FIX: il fuzzy match cross-comune Sardegna restituiva falsi
// positivi (es. "Roma" → "Romana" SS → provincia "SS" invece di "RM").
// Strategia adesso:
//   1) Match esatto fra i comuni Sardegna
//   2) Fallback alla tabella nazionale CITY_TO_PROVINCIA (Roma, Milano, ecc.)
//   3) (fuzzy rimosso: troppo rumore — meglio nessun match che match sbagliato)
export function getProvinciaByCity(cityName?: string): string | null {
  if (!cityName) return null
  const normalized = cityName.trim().toLowerCase()

  for (const prov of SARDEGNA_PROVINCE) {
    if (prov.comuni.some(c => c.toLowerCase() === normalized)) {
      return prov.code
    }
  }

  const national = getProvinciaByCityName(cityName)
  if (national) return national

  return null
}

// Get residence status based on province code or city
// CAP (Codice Avviamento Postale) lookup by city name
const CAP_MAP: Record<string, string> = {
  // Sardegna — Cagliari area
  'Cagliari': '09124', 'Assemini': '09032', 'Capoterra': '09012', 'Decimomannu': '09033',
  'Elmas': '09030', 'Maracalagonis': '09040', 'Monserrato': '09042', 'Pula': '09010',
  'Quartu Sant\'Elena': '09045', 'Quartucciu': '09044', 'Sarroch': '09018', 'Selargius': '09047',
  'Sestu': '09028', 'Settimo San Pietro': '09040', 'Sinnai': '09048', 'Uta': '09010',
  // Sardegna — Sud Sardegna
  'Carbonia': '09013', 'Iglesias': '09016', 'Villacidro': '09039', 'Sanluri': '09025',
  'San Gavino Monreale': '09037', 'Guspini': '09036', 'Muravera': '09043',
  'Sant\'Antioco': '09017', 'Dolianova': '09041', 'Monastir': '09023',
  'San Sperate': '09026', 'Villasor': '09034', 'Serramanna': '09038',
  'Villasimius': '09049', 'Villaputzu': '09040',
  // Sardegna — Sassari
  'Sassari': '07100', 'Alghero': '07041', 'Porto Torres': '07046', 'Sorso': '07037',
  'Ozieri': '07014', 'Tempio Pausania': '07029', 'La Maddalena': '07024',
  'Castelsardo': '07031', 'Ittiri': '07044',
  // Sardegna — Nuoro
  'Nuoro': '08100', 'Siniscola': '08029', 'Tortolì': '08048', 'Macomer': '08015',
  'Dorgali': '08022', 'Orosei': '08028', 'Lanusei': '08045',
  // Sardegna — Oristano
  'Oristano': '09170', 'Terralba': '09098', 'Cabras': '09072', 'Bosa': '08013',
  // Sardegna — Olbia-Tempio
  'Olbia': '07026', 'Arzachena': '07021', 'Budoni': '08020', 'San Teodoro': '08020',
  'Golfo Aranci': '07020', 'Palau': '07020', 'Santa Teresa Gallura': '07028',
  // Capoluoghi
  'Roma': '00100', 'Milano': '20100', 'Napoli': '80100', 'Torino': '10100',
  'Palermo': '90100', 'Genova': '16100', 'Bologna': '40100', 'Firenze': '50100',
  'Bari': '70100', 'Catania': '95100', 'Venezia': '30100', 'Verona': '37100',
  'Messina': '98100', 'Padova': '35100', 'Trieste': '34100', 'Brescia': '25100',
  'Taranto': '74100', 'Reggio Calabria': '89100', 'Modena': '41100',
  'Reggio Emilia': '42100', 'Perugia': '06100', 'Ravenna': '48100',
  'Livorno': '57100', 'Foggia': '71100', 'Rimini': '47921', 'Salerno': '84100',
  'Ferrara': '44121', 'Siracusa': '96100', 'Pescara': '65100', 'Monza': '20900',
  'Bergamo': '24100', 'Vicenza': '36100', 'Bolzano': '39100', 'Trento': '38122',
  'Ancona': '60100', 'Udine': '33100', 'Arezzo': '52100', 'Catanzaro': '88100',
  'Lecce': '73100', 'Pesaro': '61121', 'Alessandria': '15121', 'Pisa': '56100',
  'La Spezia': '19100', 'Lucca': '55100', 'Como': '22100', 'Novara': '28100',
  'Varese': '21100', 'Latina': '04100', 'Brindisi': '72100', 'Parma': '43121',
  'Piacenza': '29121', 'Cosenza': '87100', 'Potenza': '85100', 'Avellino': '83100',
  'Caserta': '81100', 'L\'Aquila': '67100', 'Chieti': '66100', 'Teramo': '64100',
  'Aosta': '11100', 'Prato': '59100', 'Terni': '05100', 'Grosseto': '58100',
  'Siena': '53100', 'Pistoia': '51100', 'Massa': '54100', 'Frosinone': '03100',
  'Campobasso': '86100', 'Isernia': '86170', 'Matera': '75100',
}

// Simple similarity score (0-1) between two strings
function similarity(a: string, b: string): number {
  const al = a.toLowerCase(), bl = b.toLowerCase()
  if (al === bl) return 1
  if (al.length < 2 || bl.length < 2) return 0
  // Bigram similarity
  const bigramsA = new Set<string>()
  for (let i = 0; i < al.length - 1; i++) bigramsA.add(al.substring(i, i + 2))
  let matches = 0
  for (let i = 0; i < bl.length - 1; i++) {
    if (bigramsA.has(bl.substring(i, i + 2))) matches++
  }
  return (2 * matches) / (al.length - 1 + bl.length - 1)
}

/**
 * Get CAP (postal code) by city name. Case-insensitive with fuzzy matching.
 * Handles typos like "Algerho" → "Alghero", "Quartu" → "Quartu Sant'Elena".
 * Returns null if no good match found.
 */
export function getCAPByCity(cityName?: string): string | null {
  if (!cityName) return null
  const trimmed = cityName.trim()
  const lower = trimmed.toLowerCase()

  // 1. Exact match (case-insensitive)
  for (const [city, cap] of Object.entries(CAP_MAP)) {
    if (city.toLowerCase() === lower) return cap
  }

  // 2. Starts-with match (e.g. "Quartu" → "Quartu Sant'Elena")
  for (const [city, cap] of Object.entries(CAP_MAP)) {
    if (city.toLowerCase().startsWith(lower) || lower.startsWith(city.toLowerCase())) return cap
  }

  // 3. Fuzzy match — find best similarity score (handles typos)
  let bestScore = 0
  let bestCap: string | null = null
  for (const [city, cap] of Object.entries(CAP_MAP)) {
    const score = similarity(trimmed, city)
    if (score > bestScore) {
      bestScore = score
      bestCap = cap
    }
  }
  // Threshold: 0.6 = decent match (e.g., "Algerho"↔"Alghero" ≈ 0.7)
  if (bestScore >= 0.6 && bestCap) return bestCap

  return null
}

export function getResidenceStatus(provinciaCode?: string, cityName?: string): 'residente' | 'non_residente' {
  if (provinciaCode && isResidentByProvincia(provinciaCode)) {
    return 'residente'
  }
  if (cityName && isResidentByCity(cityName)) {
    return 'residente'
  }
  return 'non_residente'
}
