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
