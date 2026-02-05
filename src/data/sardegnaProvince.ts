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
      'Assemini', 'Barrali', 'Burcei', 'Cagliari', 'Castiadas',
      'Decimomannu', 'Decimoputzu', 'Dolianova', 'Donori', 'Elmas',
      'Maracalagonis', 'Monastir', 'Monserrato', 'Muravera', 'Nuraminis',
      'Pimentel', 'Quartu Sant\'Elena', 'Quartucciu', 'Samatzai', 'San Sperate',
      'San Vito', 'Sant\'Andrea Frius', 'Selargius', 'Serdiana', 'Serramanna',
      'Sestu', 'Sinnai', 'Soleminis', 'Ussana', 'Villasimius', 'Villasor',
      'Villaputzu'
    ].sort()
  },
  {
    code: 'SU',
    name: 'Provincia del Sud Sardegna',
    comuni: [
      'Arbus', 'Barumini', 'Buggerru', 'Calasetta', 'Carbonia', 'Collinas',
      'Domusnovas', 'Fluminimaggiore', 'Furtei', 'Genuri', 'Gesturi', 'Giba',
      'Gonnosfanadiga', 'Gonnostramatza', 'Gonnesa', 'Guspini', 'Iglesias',
      'Las Plassas', 'Lunamatrona', 'Masainas', 'Musei', 'Narcao', 'Nuxis',
      'Pabillonis', 'Pauli Arbarei', 'Perdaxius', 'Piscinas', 'Portoscuso',
      'Samassi', 'San Gavino Monreale', 'San Giovanni Suergiu', 'Sanluri',
      'Santadi', 'Sant\'Antioco', 'Sardara', 'Segariu', 'Setzu', 'Siddi',
      'Tratalias', 'Tuili', 'Turri', 'Ussaramanna', 'Villacidro',
      'Villamassargia', 'Villanovaforru', 'Villanovafranca', 'Villaperuccio'
    ].sort()
  },
  {
    code: 'SS',
    name: 'Provincia di Sassari',
    comuni: [
      'Sassari', 'Alghero', 'Porto Torres', 'Sorso', 'Sennori', 'Stintino',
      'Castelsardo', 'Valledoria', 'Tempio Pausania', 'Olbia', 'Arzachena',
      'La Maddalena', 'Palau', 'Santa Teresa Gallura', 'Budoni', 'San Teodoro',
      'Ozieri', 'Thiesi', 'Bonorva', 'Ittiri', 'Uri', 'Tissi', 'Ossi',
      'Usini', 'Olmedo', 'Fertilia', 'Putifigari', 'Villanova Monteleone',
      'Bosa', 'Torralba', 'Mores', 'Ploaghe'
    ].sort()
  },
  {
    code: 'NU',
    name: 'Provincia di Nuoro',
    comuni: [
      'Nuoro', 'Siniscola', 'Tortolì', 'Dorgali', 'Orosei', 'Macomer',
      'Lanusei', 'Bitti', 'Orgosolo', 'Oliena', 'Fonni', 'Gavoi',
      'Sorgono', 'Tonara', 'Desulo', 'Aritzo', 'Atzara', 'Austis',
      'Belvì', 'Birori', 'Bolotana', 'Borore', 'Bortigali', 'Cardedu',
      'Elini', 'Gairo', 'Girasole', 'Ilbono', 'Jerzu', 'Lotzorai',
      'Mamoiada', 'Meana Sardo', 'Olzai', 'Onanì', 'Onifai', 'Ortueri',
      'Orune', 'Osidda', 'Ottana', 'Posada', 'Sarule', 'Silanus',
      'Teti', 'Tiana'
    ].sort()
  },
  {
    code: 'OR',
    name: 'Provincia di Oristano',
    comuni: [
      'Oristano', 'Terralba', 'Cabras', 'Marrubiu', 'Arborea', 'Santa Giusta',
      'Mogoro', 'Ales', 'Bosa', 'Ghilarza', 'Abbasanta', 'Norbello',
      'Paulilatino', 'Samugheo', 'Senis', 'Laconi', 'Isili', 'Nurallao',
      'Nurri', 'Orroli', 'Escolca', 'Gergei', 'Mandas', 'Serri',
      'Villanova Tulo', 'San Nicolò d\'Arcidano', 'Uras', 'Simaxis',
      'Solarussa', 'Zerfaliu', 'Tramatza', 'Milis', 'Bonarcado', 'Seneghe',
      'Cuglieri', 'Santu Lussurgiu', 'Sedilo', 'Aidomaggiore', 'Baradili',
      'Baressa', 'Fordongianus', 'Busachi', 'Allai'
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

// Reverse lookup: given a city name, return its province code (or null if not found)
export function getProvinciaByCity(cityName?: string): string | null {
  if (!cityName) return null
  const normalized = cityName.trim().toLowerCase()
  for (const prov of SARDEGNA_PROVINCE) {
    if (prov.comuni.some(c => c.toLowerCase() === normalized)) {
      return prov.code
    }
  }
  return null
}

// Get residence status based on province code or city
export function getResidenceStatus(provinciaCode?: string, cityName?: string): 'residente' | 'non_residente' {
  if (provinciaCode && isResidentByProvincia(provinciaCode)) {
    return 'residente'
  }
  if (cityName && isResidentByCity(cityName)) {
    return 'residente'
  }
  return 'non_residente'
}
