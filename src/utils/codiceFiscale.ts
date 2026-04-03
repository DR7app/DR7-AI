/**
 * Italian Codice Fiscale calculator
 * Generates CF from: cognome, nome, data_nascita, sesso, luogo_nascita
 *
 * Algorithm: https://it.wikipedia.org/wiki/Codice_fiscale
 */

// ── Month codes ────────────────────────────────────────────────────────────
const MONTH_CODES = 'ABCDEHLMPRST'

// ── Check character tables ─────────────────────────────────────────────────
const ODD_MAP: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9, 'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21,
  'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11, 'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14,
  'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23,
}

const EVEN_MAP: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9,
  'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19,
  'U': 20, 'V': 21, 'W': 22, 'X': 23, 'Y': 24, 'Z': 25,
}

// ── Codici catastali (Belfiore codes) for Italian comuni ───────────────────
// Comprehensive list of all comuni. Format: 'COMUNE': 'CODE'
const CODICI_CATASTALI: Record<string, string> = {
  // Sardegna — Città Metropolitana di Cagliari
  'CAGLIARI': 'B354', 'ASSEMINI': 'A474', 'CAPOTERRA': 'B675', 'DECIMOMANNU': 'D259',
  'ELMAS': 'D399', 'MARACALAGONIS': 'E903', 'MONSERRATO': 'F383', 'PULA': 'H070',
  'QUARTU SANT\'ELENA': 'H118', 'QUARTUCCIU': 'H119', 'SARROCH': 'I443', 'SELARGIUS': 'I580',
  'SESTU': 'I695', 'SETTIMO SAN PIETRO': 'I699', 'SINNAI': 'I752', 'UTA': 'L521',

  // Sardegna — Sud Sardegna
  'CARBONIA': 'B745', 'IGLESIAS': 'E281', 'VILLACIDRO': 'L924', 'SANLURI': 'H974',
  'SAN GAVINO MONREALE': 'H856', 'GUSPINI': 'E270', 'MURAVERA': 'F808',
  'SANT\'ANTIOCO': 'I294', 'DOLIANOVA': 'D323', 'SENORBI': 'I615',
  'SERRAMANNA': 'I647', 'SAN SPERATE': 'I166', 'VILLASOR': 'L969',
  'MONASTIR': 'F333', 'VILLAPUTZU': 'L998', 'VILLASIMIUS': 'B738',

  // Sardegna — Sassari
  'SASSARI': 'I452', 'ALGHERO': 'A192', 'PORTO TORRES': 'G923', 'SORSO': 'I863',
  'OZIERI': 'G203', 'TEMPIO PAUSANIA': 'L093', 'LA MADDALENA': 'E425',
  'CASTELSARDO': 'C272', 'VALLEDORIA': 'L604', 'ITTIRI': 'E376',

  // Sardegna — Nuoro
  'NUORO': 'F979', 'SINISCOLA': 'I751', 'TORTOLI': 'A355', 'MACOMER': 'E788',
  'DORGALI': 'D345', 'OROSEI': 'G119', 'LANUSEI': 'E441',

  // Sardegna — Oristano
  'ORISTANO': 'G113', 'TERRALBA': 'L122', 'CABRAS': 'B314', 'BOSA': 'B068',

  // Sardegna — Olbia-Tempio / Gallura
  'OLBIA': 'G015', 'ARZACHENA': 'A453', 'BUDONI': 'B248', 'SAN TEODORO': 'I329',
  'GOLFO ARANCI': 'E986', 'PALAU': 'G258', 'SANTA TERESA GALLURA': 'I312',
  'LOIRI PORTO SAN PAOLO': 'E632',

  // Capoluoghi di regione & province principali
  'ROMA': 'H501', 'MILANO': 'F205', 'NAPOLI': 'F839', 'TORINO': 'L219',
  'PALERMO': 'G273', 'GENOVA': 'D969', 'BOLOGNA': 'A944', 'FIRENZE': 'D612',
  'BARI': 'A662', 'CATANIA': 'C351', 'VENEZIA': 'L736', 'VERONA': 'L781',
  'MESSINA': 'F158', 'PADOVA': 'G224', 'TRIESTE': 'L424', 'BRESCIA': 'B157',
  'TARANTO': 'L049', 'PRATO': 'G999', 'REGGIO CALABRIA': 'H224',
  'MODENA': 'F257', 'REGGIO EMILIA': 'H225', 'PERUGIA': 'G478',
  'RAVENNA': 'H199', 'LIVORNO': 'E625', 'FOGGIA': 'D643',
  'RIMINI': 'H294', 'SALERNO': 'H703', 'FERRARA': 'D548', 'SIRACUSA': 'I754',
  'PESCARA': 'G482', 'MONZA': 'F704', 'BERGAMO': 'A794', 'VICENZA': 'L840',
  'BOLZANO': 'A952', 'TRENTO': 'L378', 'ANCONA': 'A271', 'UDINE': 'L483',
  'ANDRIA': 'A285', 'AREZZO': 'A390', 'CATANZARO': 'C352', 'LECCE': 'E506',
  'PESARO': 'G479', 'ALESSANDRIA': 'A182', 'PISA': 'G702', 'TERNI': 'L117',
  'LA SPEZIA': 'E463', 'LUCCA': 'E715', 'COMO': 'C933', 'NOVARA': 'F952',
  'VARESE': 'L682', 'LATINA': 'E472', 'BRINDISI': 'B180', 'PARMA': 'G337',
  'PIACENZA': 'G535', 'COSENZA': 'D086', 'TRAPANI': 'L331', 'POTENZA': 'G942',
  'AVELLINO': 'A509', 'BENEVENTO': 'A783', 'CASERTA': 'B963', 'CROTONE': 'D122',
  'VIBO VALENTIA': 'F537', 'AGRIGENTO': 'A089', 'CALTANISSETTA': 'B429',
  'ENNA': 'C342', 'RAGUSA': 'H163', 'FROSINONE': 'D810', 'ISERNIA': 'E335',
  'CAMPOBASSO': 'B519', 'MATERA': 'F052', 'L\'AQUILA': 'A345', 'CHIETI': 'C632',
  'TERAMO': 'L103', 'RIETI': 'H282', 'VITERBO': 'M082', 'AOSTA': 'A326',
  'BELLUNO': 'A757', 'ROVIGO': 'H620', 'TREVISO': 'L407', 'PORDENONE': 'G888',
  'GORIZIA': 'E098', 'SAVONA': 'I480', 'IMPERIA': 'E290', 'ASTI': 'A479',
  'BIELLA': 'A859', 'CUNEO': 'D205', 'VERBANIA': 'L746', 'VERCELLI': 'L750',
  'SONDRIO': 'I829', 'CREMONA': 'D150', 'LODI': 'E648', 'MANTOVA': 'E897',
  'LECCO': 'E507', 'PAVIA': 'G388', 'MASSA': 'F023', 'GROSSETO': 'E202',
  'SIENA': 'I726', 'PISTOIA': 'G713',

  // Grandi città & comuni popolosi
  'GIUGLIANO IN CAMPANIA': 'E054', 'TORRE DEL GRECO': 'L259',
  'POZZUOLI': 'G964', 'CASORIA': 'B990', 'ACERRA': 'A024',
  'AFRAGOLA': 'A065', 'CASTELLAMMARE DI STABIA': 'C129', 'PORTICI': 'G902',
  'SAN GIORGIO A CREMANO': 'H892', 'ERCOLANO': 'H243', 'CAVA DE\' TIRRENI': 'C361',
  'BATTIPAGLIA': 'A717', 'SCAFATI': 'I483', 'NOCERA INFERIORE': 'F912',
  'PAGANI': 'G230', 'SARNO': 'I438', 'AVERSA': 'A512',
  'MARCIANISE': 'E932', 'MADDALONI': 'E791',
  'CINISELLO BALSAMO': 'C707', 'SESTO SAN GIOVANNI': 'I690',
  'RHO': 'H264', 'LEGNANO': 'E514', 'COLOGNO MONZESE': 'C895',
  'BUSTO ARSIZIO': 'B300', 'GALLARATE': 'D869', 'SARONNO': 'I441',
  'CESANO MADERNO': 'C566', 'DESIO': 'D274', 'LISSONE': 'E617',
  'SEREGNO': 'I625', 'MONCALIERI': 'F335', 'COLLEGNO': 'C860',
  'RIVOLI': 'H355', 'NICHELINO': 'F889', 'SETTIMO TORINESE': 'I703',
  'GRUGLIASCO': 'E216', 'CHIERI': 'C627',
  'GUIDONIA MONTECELIO': 'E263', 'FIUMICINO': 'M297', 'TIVOLI': 'L182',
  'ANZIO': 'A323', 'NETTUNO': 'F880', 'VELLETRI': 'L719', 'CIVITAVECCHIA': 'C773',
  'POMEZIA': 'G811',

  // Sicilia
  'MARSALA': 'E974', 'GELA': 'D960', 'VITTORIA': 'M088',
  'MODICA': 'F258', 'ACIREALE': 'A028', 'BAGHERIA': 'A546',
  'MAZARA DEL VALLO': 'F061', 'ALCAMO': 'A176', 'MISTERBIANCO': 'F250',

  // Puglia
  'ALTAMURA': 'A225', 'MOLFETTA': 'F284', 'BARLETTA': 'A669',
  'TRANI': 'L328', 'BISCEGLIE': 'A883', 'BITONTO': 'A893',
  'CERIGNOLA': 'C514', 'MANFREDONIA': 'E885', 'SAN SEVERO': 'I158',
  'LUCERA': 'E716', 'NARDO': 'F842', 'GALLIPOLI': 'D883',
  'MAGLIE': 'E815', 'GALATINA': 'D862',

  // Calabria
  'LAMEZIA TERME': 'M208', 'RENDE': 'H235', 'CASTROVILLARI': 'C349',
  'CORIGLIANO CALABRO': 'D006', 'ROSSANO': 'H579',

  // Toscana
  'EMPOLI': 'D403', 'SCANDICCI': 'B962', 'CAMPI BISENZIO': 'B507',
  'SESTO FIORENTINO': 'I684', 'PONTEDERA': 'G843', 'PIOMBINO': 'G687',
  'VIAREGGIO': 'L833', 'CARRARA': 'B832', 'MONTECATINI TERME': 'A558',

  // Emilia-Romagna
  'CESENA': 'C573', 'FORLI': 'D704', 'IMOLA': 'E289', 'FAENZA': 'D458',
  'CARPI': 'B819', 'SASSUOLO': 'I462', 'FIDENZA': 'B034', 'LUGO': 'E730',

  // Veneto
  'MESTRE': 'L736', 'CHIOGGIA': 'C638', 'SAN DONA DI PIAVE': 'H823',
  'MIRA': 'F229', 'JESOLO': 'C388', 'BASSANO DEL GRAPPA': 'A703',
  'SCHIO': 'I531', 'THIENE': 'L157', 'CASTELFRANCO VENETO': 'C111',
  'CONEGLIANO': 'C957', 'MONTEBELLUNA': 'F443', 'VITTORIO VENETO': 'M089',

  // Lombardia (extra)
  'VIGEVANO': 'L872', 'VOGHERA': 'M109', 'CREMA': 'D142',
  'CASALMAGGIORE': 'B898', 'DALMINE': 'D245', 'TREVIGLIO': 'L400',
  'SERIATE': 'I628', 'ROMANO DI LOMBARDIA': 'H509',
  'CANTÙ': 'B639', 'ERBA': 'D416', 'MARIANO COMENSE': 'E951',

  // Piemonte (extra)
  'ALBA': 'A124', 'BRA': 'B111', 'FOSSANO': 'D742', 'SAVIGLIANO': 'I470',
  'MONDOVI': 'F351', 'CASALE MONFERRATO': 'B885', 'TORTONA': 'L304',
  'NOVI LIGURE': 'F965', 'ACQUI TERME': 'A052', 'OVADA': 'G197',
  'DOMODOSSOLA': 'D332', 'BORGOMANERO': 'B019', 'ARONA': 'A429',

  // Liguria (extra)
  'SANREMO': 'I138', 'VENTIMIGLIA': 'L741', 'RAPALLO': 'H183',
  'CHIAVARI': 'C621', 'SESTRI LEVANTE': 'I693',

  // Friuli Venezia Giulia (extra)
  'MONFALCONE': 'F356', 'SACILE': 'H657', 'CORDENONS': 'C991',

  // Trentino-Alto Adige (extra)
  'MERANO': 'F132', 'BRESSANONE': 'B160', 'BRUNICO': 'B220',
  'LAIVES': 'E421', 'ROVERETO': 'H612', 'RIVA DEL GARDA': 'H330',

  // Marche (extra)
  'FANO': 'D488', 'SENIGALLIA': 'I608', 'JESI': 'E388',
  'FABRIANO': 'D451', 'CIVITANOVA MARCHE': 'C770', 'MACERATA': 'E783',
  'FERMO': 'D542', 'ASCOLI PICENO': 'A462', 'SAN BENEDETTO DEL TRONTO': 'H769',

  // Umbria (extra)
  'FOLIGNO': 'D653', 'CITTA DI CASTELLO': 'C745', 'SPOLETO': 'I921',
  'GUBBIO': 'E256', 'ORVIETO': 'G148', 'NARNI': 'F844',

  // Abruzzo (extra)
  'MONTESILVANO': 'F648', 'FRANCAVILLA AL MARE': 'D758',
  'VASTO': 'E372', 'LANCIANO': 'E435', 'ORTONA': 'G141',
  'AVEZZANO': 'A515', 'SULMONA': 'I804',

  // Molise (extra)
  'TERMOLI': 'L113',

  // Basilicata (extra)
  'MELFI': 'F104', 'PISTICCI': 'G712', 'POLICORO': 'G786',

  // Foreign countries (stati esteri) — for foreign-born
  'ALBANIA': 'Z100', 'ALGERIA': 'Z301', 'ARGENTINA': 'Z600',
  'AUSTRALIA': 'Z700', 'AUSTRIA': 'Z102', 'BANGLADESH': 'Z249',
  'BELGIO': 'Z103', 'BOLIVIA': 'Z601', 'BRASILE': 'Z602',
  'BULGARIA': 'Z104', 'CAMERUN': 'Z306', 'CANADA': 'Z401',
  'CILE': 'Z603', 'CINA': 'Z210', 'COLOMBIA': 'Z604',
  'COREA DEL SUD': 'Z213', 'COSTA D\'AVORIO': 'Z313',
  'CROAZIA': 'Z149', 'CUBA': 'Z504', 'DANIMARCA': 'Z107',
  'ECUADOR': 'Z605', 'EGITTO': 'Z336', 'EL SALVADOR': 'Z506',
  'ERITREA': 'Z368', 'ESTONIA': 'Z144', 'ETIOPIA': 'Z315',
  'FILIPPINE': 'Z216', 'FINLANDIA': 'Z109', 'FRANCIA': 'Z110',
  'GEORGIA': 'Z254', 'GERMANIA': 'Z112', 'GHANA': 'Z318',
  'GIAPPONE': 'Z219', 'GRAN BRETAGNA': 'Z114', 'GRECIA': 'Z115',
  'GUATEMALA': 'Z509', 'GUINEA': 'Z319', 'HONDURAS': 'Z511',
  'INDIA': 'Z222', 'INDONESIA': 'Z223', 'IRAN': 'Z224',
  'IRAQ': 'Z225', 'IRLANDA': 'Z116', 'ISLANDA': 'Z117',
  'ISRAELE': 'Z226', 'LETTONIA': 'Z145', 'LIBANO': 'Z229',
  'LIBIA': 'Z326', 'LITUANIA': 'Z146', 'LUSSEMBURGO': 'Z120',
  'MACEDONIA DEL NORD': 'Z148', 'MALTA': 'Z121', 'MAROCCO': 'Z330',
  'MESSICO': 'Z514', 'MOLDAVIA': 'Z140', 'MONTENEGRO': 'Z159',
  'MOZAMBICO': 'Z340', 'NICARAGUA': 'Z515', 'NIGERIA': 'Z335',
  'NORVEGIA': 'Z125', 'NUOVA ZELANDA': 'Z719', 'OLANDA': 'Z126',
  'PAESI BASSI': 'Z126', 'PAKISTAN': 'Z236', 'PANAMA': 'Z516',
  'PARAGUAY': 'Z610', 'PERU': 'Z611', 'POLONIA': 'Z127',
  'PORTOGALLO': 'Z128', 'REGNO UNITO': 'Z114',
  'REPUBBLICA CECA': 'Z156', 'REPUBBLICA DOMINICANA': 'Z505',
  'ROMANIA': 'Z129', 'RUSSIA': 'Z154', 'SENEGAL': 'Z343',
  'SERBIA': 'Z158', 'SINGAPORE': 'Z248', 'SLOVACCHIA': 'Z155',
  'SLOVENIA': 'Z150', 'SOMALIA': 'Z346', 'SPAGNA': 'Z131',
  'SRI LANKA': 'Z209', 'STATI UNITI': 'Z404', 'STATI UNITI D\'AMERICA': 'Z404',
  'SUDAFRICA': 'Z347', 'SVEZIA': 'Z132', 'SVIZZERA': 'Z133',
  'THAILANDIA': 'Z241', 'TUNISIA': 'Z352', 'TURCHIA': 'Z243',
  'UCRAINA': 'Z138', 'UNGHERIA': 'Z134', 'URUGUAY': 'Z613',
  'VENEZUELA': 'Z614', 'VIETNAM': 'Z251',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractConsonants(s: string): string {
  return s.replace(/[^A-Z]/g, '').replace(/[AEIOU]/g, '')
}

function extractVowels(s: string): string {
  return s.replace(/[^A-Z]/g, '').replace(/[^AEIOU]/g, '')
}

function encodeSurname(cognome: string): string {
  const upper = cognome.toUpperCase().replace(/[^A-Z]/g, '')
  const consonants = extractConsonants(upper)
  const vowels = extractVowels(upper)
  const pool = consonants + vowels + 'XXX'
  return pool.substring(0, 3)
}

function encodeName(nome: string): string {
  const upper = nome.toUpperCase().replace(/[^A-Z]/g, '')
  const consonants = extractConsonants(upper)
  const vowels = extractVowels(upper)

  // Special rule: if 4+ consonants, take 1st, 3rd, 4th
  if (consonants.length >= 4) {
    return consonants[0] + consonants[2] + consonants[3]
  }

  const pool = consonants + vowels + 'XXX'
  return pool.substring(0, 3)
}

function encodeBirthDate(dataNascita: string, sesso: 'M' | 'F'): string {
  const d = new Date(dataNascita)
  if (isNaN(d.getTime())) return ''

  const year = String(d.getFullYear()).slice(-2)
  const month = MONTH_CODES[d.getMonth()]
  let day = d.getDate()

  // Females: day + 40
  if (sesso === 'F') day += 40

  return year + month + String(day).padStart(2, '0')
}

function computeCheckChar(first15: string): string {
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const ch = first15[i]
    // Positions are 1-indexed: odd positions (1,3,5...) use ODD_MAP, even (2,4,6...) use EVEN_MAP
    if (i % 2 === 0) {
      // i=0 → position 1 (odd)
      sum += ODD_MAP[ch] ?? 0
    } else {
      // i=1 → position 2 (even)
      sum += EVEN_MAP[ch] ?? 0
    }
  }
  return String.fromCharCode(65 + (sum % 26)) // A=0, B=1, ...
}

// ── Main calculator ────────────────────────────────────────────────────────

export interface CodiceFiscaleInput {
  cognome: string
  nome: string
  data_nascita: string // YYYY-MM-DD
  sesso: 'M' | 'F'
  luogo_nascita: string // comune name or foreign country
}

export interface CodiceFiscaleResult {
  codice_fiscale: string | null
  error?: string
  belfiore_code?: string
}

export function calcolaCodiceFiscale(input: CodiceFiscaleInput): CodiceFiscaleResult {
  const { cognome, nome, data_nascita, sesso, luogo_nascita } = input

  if (!cognome || !nome || !data_nascita || !sesso || !luogo_nascita) {
    return { codice_fiscale: null, error: 'Tutti i campi sono obbligatori' }
  }

  // 1. Surname (3 chars)
  const surnamePart = encodeSurname(cognome)

  // 2. Name (3 chars)
  const namePart = encodeName(nome)

  // 3. Birth date + sex (5 chars)
  const datePart = encodeBirthDate(data_nascita, sesso)
  if (!datePart) {
    return { codice_fiscale: null, error: 'Data di nascita non valida' }
  }

  // 4. Belfiore code (4 chars)
  const cityUpper = luogo_nascita.toUpperCase().trim()
  const belfioreCode = CODICI_CATASTALI[cityUpper]
  if (!belfioreCode) {
    return { codice_fiscale: null, error: `Comune "${luogo_nascita}" non trovato. Inserisci il codice fiscale manualmente.` }
  }

  // 5. Build first 15 chars
  const first15 = surnamePart + namePart + datePart + belfioreCode

  // 6. Check character
  const checkChar = computeCheckChar(first15)

  return {
    codice_fiscale: first15 + checkChar,
    belfiore_code: belfioreCode,
  }
}

/**
 * Lookup a belfiore code by city name.
 * Returns null if not found.
 */
export function getBelfioreCode(cityName: string): string | null {
  return CODICI_CATASTALI[cityName.toUpperCase().trim()] || null
}

/**
 * Get all available city names (for autocomplete/validation)
 */
export function getAvailableCities(): string[] {
  return Object.keys(CODICI_CATASTALI).sort()
}

// ── City to Provincia mapping ─────────────────────────────────────────────
const CITY_TO_PROVINCIA: Record<string, string> = {
  // Sardegna — Città Metropolitana di Cagliari
  'CAGLIARI': 'CA', 'ASSEMINI': 'CA', 'CAPOTERRA': 'CA', 'DECIMOMANNU': 'CA',
  'ELMAS': 'CA', 'MARACALAGONIS': 'CA', 'MONSERRATO': 'CA', 'PULA': 'CA',
  'QUARTU SANT\'ELENA': 'CA', 'QUARTUCCIU': 'CA', 'SARROCH': 'CA', 'SELARGIUS': 'CA',
  'SESTU': 'CA', 'SETTIMO SAN PIETRO': 'CA', 'SINNAI': 'CA', 'UTA': 'CA',
  // Sardegna — Sud Sardegna
  'CARBONIA': 'SU', 'IGLESIAS': 'SU', 'VILLACIDRO': 'SU', 'SANLURI': 'SU',
  'SAN GAVINO MONREALE': 'SU', 'GUSPINI': 'SU', 'MURAVERA': 'SU',
  'SANT\'ANTIOCO': 'SU', 'DOLIANOVA': 'SU', 'SENORBI': 'SU',
  'SERRAMANNA': 'SU', 'SAN SPERATE': 'SU', 'VILLASOR': 'SU',
  'MONASTIR': 'SU', 'VILLAPUTZU': 'SU', 'VILLASIMIUS': 'SU',
  // Sardegna — Sassari
  'SASSARI': 'SS', 'ALGHERO': 'SS', 'PORTO TORRES': 'SS', 'SORSO': 'SS',
  'OZIERI': 'SS', 'TEMPIO PAUSANIA': 'SS', 'LA MADDALENA': 'SS',
  'CASTELSARDO': 'SS', 'VALLEDORIA': 'SS', 'ITTIRI': 'SS',
  // Sardegna — Nuoro
  'NUORO': 'NU', 'SINISCOLA': 'NU', 'TORTOLI': 'NU', 'MACOMER': 'NU',
  'DORGALI': 'NU', 'OROSEI': 'NU', 'LANUSEI': 'NU',
  // Sardegna — Oristano
  'ORISTANO': 'OR', 'TERRALBA': 'OR', 'CABRAS': 'OR', 'BOSA': 'OR',
  // Sardegna — Olbia-Tempio / Gallura
  'OLBIA': 'SS', 'ARZACHENA': 'SS', 'BUDONI': 'SS', 'SAN TEODORO': 'SS',
  'GOLFO ARANCI': 'SS', 'PALAU': 'SS', 'SANTA TERESA GALLURA': 'SS',
  'LOIRI PORTO SAN PAOLO': 'SS',
  // Capoluoghi di regione & province principali
  'ROMA': 'RM', 'MILANO': 'MI', 'NAPOLI': 'NA', 'TORINO': 'TO',
  'PALERMO': 'PA', 'GENOVA': 'GE', 'BOLOGNA': 'BO', 'FIRENZE': 'FI',
  'BARI': 'BA', 'CATANIA': 'CT', 'VENEZIA': 'VE', 'VERONA': 'VR',
  'MESSINA': 'ME', 'PADOVA': 'PD', 'TRIESTE': 'TS', 'BRESCIA': 'BS',
  'TARANTO': 'TA', 'PRATO': 'PO', 'REGGIO CALABRIA': 'RC',
  'MODENA': 'MO', 'REGGIO EMILIA': 'RE', 'PERUGIA': 'PG',
  'RAVENNA': 'RA', 'LIVORNO': 'LI', 'FOGGIA': 'FG',
  'RIMINI': 'RN', 'SALERNO': 'SA', 'FERRARA': 'FE', 'SIRACUSA': 'SR',
  'PESCARA': 'PE', 'MONZA': 'MB', 'BERGAMO': 'BG', 'VICENZA': 'VI',
  'BOLZANO': 'BZ', 'TRENTO': 'TN', 'ANCONA': 'AN', 'UDINE': 'UD',
  'ANDRIA': 'BT', 'AREZZO': 'AR', 'CATANZARO': 'CZ', 'LECCE': 'LE',
  'PESARO': 'PU', 'ALESSANDRIA': 'AL', 'PISA': 'PI', 'TERNI': 'TR',
  'LA SPEZIA': 'SP', 'LUCCA': 'LU', 'COMO': 'CO', 'NOVARA': 'NO',
  'VARESE': 'VA', 'LATINA': 'LT', 'BRINDISI': 'BR', 'PARMA': 'PR',
  'PIACENZA': 'PC', 'COSENZA': 'CS', 'TRAPANI': 'TP', 'POTENZA': 'PZ',
  'AVELLINO': 'AV', 'BENEVENTO': 'BN', 'CASERTA': 'CE', 'CROTONE': 'KR',
  'VIBO VALENTIA': 'VV', 'AGRIGENTO': 'AG', 'CALTANISSETTA': 'CL',
  'ENNA': 'EN', 'RAGUSA': 'RG', 'FROSINONE': 'FR', 'ISERNIA': 'IS',
  'CAMPOBASSO': 'CB', 'MATERA': 'MT', 'L\'AQUILA': 'AQ', 'CHIETI': 'CH',
  'TERAMO': 'TE', 'RIETI': 'RI', 'VITERBO': 'VT', 'AOSTA': 'AO',
  'BELLUNO': 'BL', 'ROVIGO': 'RO', 'TREVISO': 'TV', 'PORDENONE': 'PN',
  'GORIZIA': 'GO', 'SAVONA': 'SV', 'IMPERIA': 'IM', 'ASTI': 'AT',
  'BIELLA': 'BI', 'CUNEO': 'CN', 'VERBANIA': 'VB', 'VERCELLI': 'VC',
  'SONDRIO': 'SO', 'CREMONA': 'CR', 'LODI': 'LO', 'MANTOVA': 'MN',
  'LECCO': 'LC', 'PAVIA': 'PV', 'MASSA': 'MS', 'GROSSETO': 'GR',
  'SIENA': 'SI', 'PISTOIA': 'PT',
  // Grandi città
  'GIUGLIANO IN CAMPANIA': 'NA', 'TORRE DEL GRECO': 'NA',
  'POZZUOLI': 'NA', 'CASORIA': 'NA', 'ACERRA': 'NA',
  'AFRAGOLA': 'NA', 'CASTELLAMMARE DI STABIA': 'NA', 'PORTICI': 'NA',
  'SAN GIORGIO A CREMANO': 'NA', 'ERCOLANO': 'NA', 'CAVA DE\' TIRRENI': 'SA',
  'BATTIPAGLIA': 'SA', 'SCAFATI': 'SA', 'NOCERA INFERIORE': 'SA',
  'PAGANI': 'SA', 'SARNO': 'SA', 'AVERSA': 'CE',
  'MARCIANISE': 'CE', 'MADDALONI': 'CE',
  'CINISELLO BALSAMO': 'MI', 'SESTO SAN GIOVANNI': 'MI',
  'RHO': 'MI', 'LEGNANO': 'MI', 'COLOGNO MONZESE': 'MI',
  'BUSTO ARSIZIO': 'VA', 'GALLARATE': 'VA', 'SARONNO': 'VA',
  'CESANO MADERNO': 'MB', 'DESIO': 'MB', 'LISSONE': 'MB',
  'SEREGNO': 'MB', 'MONCALIERI': 'TO', 'COLLEGNO': 'TO',
  'RIVOLI': 'TO', 'NICHELINO': 'TO', 'SETTIMO TORINESE': 'TO',
  'GRUGLIASCO': 'TO', 'CHIERI': 'TO',
  'GUIDONIA MONTECELIO': 'RM', 'FIUMICINO': 'RM', 'TIVOLI': 'RM',
  'ANZIO': 'RM', 'NETTUNO': 'RM', 'VELLETRI': 'RM', 'CIVITAVECCHIA': 'RM',
  'POMEZIA': 'RM',
  // Sicilia
  'MARSALA': 'TP', 'GELA': 'CL', 'VITTORIA': 'RG',
  'MODICA': 'RG', 'ACIREALE': 'CT', 'BAGHERIA': 'PA',
  'MAZARA DEL VALLO': 'TP', 'ALCAMO': 'TP', 'MISTERBIANCO': 'CT',
  // Puglia
  'ALTAMURA': 'BA', 'MOLFETTA': 'BA', 'BARLETTA': 'BT',
  'TRANI': 'BT', 'BISCEGLIE': 'BT', 'BITONTO': 'BA',
  'CERIGNOLA': 'FG', 'MANFREDONIA': 'FG', 'SAN SEVERO': 'FG',
  'LUCERA': 'FG', 'NARDO': 'LE', 'GALLIPOLI': 'LE',
  'MAGLIE': 'LE', 'GALATINA': 'LE',
  // Calabria
  'LAMEZIA TERME': 'CZ', 'RENDE': 'CS', 'CASTROVILLARI': 'CS',
  'CORIGLIANO CALABRO': 'CS', 'ROSSANO': 'CS',
  // Toscana
  'EMPOLI': 'FI', 'SCANDICCI': 'FI', 'CAMPI BISENZIO': 'FI',
  'SESTO FIORENTINO': 'FI', 'PONTEDERA': 'PI', 'PIOMBINO': 'LI',
  'VIAREGGIO': 'LU', 'CARRARA': 'MS', 'MONTECATINI TERME': 'PT',
  // Emilia-Romagna
  'CESENA': 'FC', 'FORLI': 'FC', 'IMOLA': 'BO', 'FAENZA': 'RA',
  'CARPI': 'MO', 'SASSUOLO': 'MO', 'FIDENZA': 'PR', 'LUGO': 'RA',
  // Veneto
  'MESTRE': 'VE', 'CHIOGGIA': 'VE', 'SAN DONA DI PIAVE': 'VE',
  'MIRA': 'VE', 'JESOLO': 'VE', 'BASSANO DEL GRAPPA': 'VI',
  'SCHIO': 'VI', 'THIENE': 'VI', 'CASTELFRANCO VENETO': 'TV',
  'CONEGLIANO': 'TV', 'MONTEBELLUNA': 'TV', 'VITTORIO VENETO': 'TV',
  // Lombardia (extra)
  'VIGEVANO': 'PV', 'VOGHERA': 'PV', 'CREMA': 'CR',
  'CASALMAGGIORE': 'CR', 'DALMINE': 'BG', 'TREVIGLIO': 'BG',
  'SERIATE': 'BG', 'ROMANO DI LOMBARDIA': 'BG',
  'CANTÙ': 'CO', 'ERBA': 'CO', 'MARIANO COMENSE': 'CO',
  // Piemonte (extra)
  'ALBA': 'CN', 'BRA': 'CN', 'FOSSANO': 'CN', 'SAVIGLIANO': 'CN',
  'MONDOVI': 'CN', 'CASALE MONFERRATO': 'AL', 'TORTONA': 'AL',
  'NOVI LIGURE': 'AL', 'ACQUI TERME': 'AL', 'OVADA': 'AL',
  'DOMODOSSOLA': 'VB', 'BORGOMANERO': 'NO', 'ARONA': 'NO',
  // Liguria (extra)
  'SANREMO': 'IM', 'VENTIMIGLIA': 'IM', 'RAPALLO': 'GE',
  'CHIAVARI': 'GE', 'SESTRI LEVANTE': 'GE',
  // Friuli Venezia Giulia (extra)
  'MONFALCONE': 'GO', 'SACILE': 'PN', 'CORDENONS': 'PN',
  // Trentino-Alto Adige (extra)
  'MERANO': 'BZ', 'BRESSANONE': 'BZ', 'BRUNICO': 'BZ',
  'LAIVES': 'BZ', 'ROVERETO': 'TN', 'RIVA DEL GARDA': 'TN',
  // Marche (extra)
  'FANO': 'PU', 'SENIGALLIA': 'AN', 'JESI': 'AN',
  'FABRIANO': 'AN', 'CIVITANOVA MARCHE': 'MC', 'MACERATA': 'MC',
  'FERMO': 'FM', 'ASCOLI PICENO': 'AP', 'SAN BENEDETTO DEL TRONTO': 'AP',
  // Umbria (extra)
  'FOLIGNO': 'PG', 'CITTA DI CASTELLO': 'PG', 'SPOLETO': 'PG',
  'GUBBIO': 'PG', 'ORVIETO': 'TR', 'NARNI': 'TR',
  // Abruzzo (extra)
  'MONTESILVANO': 'PE', 'FRANCAVILLA AL MARE': 'CH',
  'VASTO': 'CH', 'LANCIANO': 'CH', 'ORTONA': 'CH',
  'AVEZZANO': 'AQ', 'SULMONA': 'AQ',
  // Molise (extra)
  'TERMOLI': 'CB',
  // Basilicata (extra)
  'MELFI': 'PZ', 'PISTICCI': 'MT', 'POLICORO': 'MT',
}

/**
 * Validate the check digit (last character) of a Codice Fiscale.
 */
export function validateCheckDigit(cf: string): boolean {
  const code = cf.toUpperCase().replace(/\s/g, '')
  if (code.length !== 16) return false
  // Validate basic format
  if (!/^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/.test(code)) return false
  const expected = computeCheckChar(code.substring(0, 15))
  return code[15] === expected
}

/**
 * Decode a Codice Fiscale to extract birth date, sex, birthplace, and province.
 * Cannot extract cognome/nome (the encoding is lossy).
 */
export function decodificaCodiceFiscale(cf: string): {
  data_nascita: string       // YYYY-MM-DD
  sesso: 'M' | 'F'
  luogo_nascita: string      // city name or belfiore code if not found
  provincia_nascita: string  // 2-letter code or 'EE' for foreign or '' if unknown
} | null {
  const code = cf.toUpperCase().replace(/\s/g, '')
  if (code.length !== 16) return null

  // Positions 6-7: year (2 digits)
  const yearPart = parseInt(code.substring(6, 8), 10)
  // Position 8: month letter
  const monthChar = code[8]
  const monthIndex = MONTH_CODES.indexOf(monthChar)
  if (monthIndex === -1) return null
  const month = monthIndex + 1
  // Positions 9-10: day (1-31 for M, 41-71 for F)
  let day = parseInt(code.substring(9, 11), 10)
  let sesso: 'M' | 'F' = 'M'
  if (day > 40) {
    sesso = 'F'
    day -= 40
  }
  // Guess century: if yearPart > current 2-digit year + 5, assume 1900s
  const currentYear2 = new Date().getFullYear() % 100
  const year = yearPart > currentYear2 + 5 ? 1900 + yearPart : 2000 + yearPart
  const data_nascita = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  // Positions 11-14: belfiore code (1 letter + 3 digits)
  const belfiore = code.substring(11, 15)
  // Reverse lookup
  const reverseBelfiore: Record<string, string> = {}
  for (const [city, bcode] of Object.entries(CODICI_CATASTALI)) {
    reverseBelfiore[bcode] = city
  }
  const cityName = reverseBelfiore[belfiore]
  const luogo_nascita = cityName
    ? cityName.charAt(0) + cityName.slice(1).toLowerCase()
    : belfiore // return raw code if not in our list

  // Province lookup
  let provincia_nascita = ''
  if (cityName) {
    if (belfiore.startsWith('Z')) {
      provincia_nascita = 'EE' // foreign country
    } else {
      provincia_nascita = CITY_TO_PROVINCIA[cityName] || ''
    }
  }

  return { data_nascita, sesso, luogo_nascita, provincia_nascita }
}

/**
 * Verify consistency between a Codice Fiscale and personal data.
 * Returns mismatches in Italian.
 */
export function verificaConsistenza(
  cf: string,
  input: Partial<CodiceFiscaleInput>
): {
  isConsistent: boolean
  mismatches: string[]
  decoded: ReturnType<typeof decodificaCodiceFiscale>
} {
  const decoded = decodificaCodiceFiscale(cf)
  if (!decoded) {
    return { isConsistent: false, mismatches: ['Il Codice Fiscale inserito non è valido'], decoded: null }
  }

  if (!validateCheckDigit(cf)) {
    return { isConsistent: false, mismatches: ['Il carattere di controllo del Codice Fiscale non è corretto'], decoded }
  }

  const mismatches: string[] = []

  // Check sesso
  if (input.sesso && input.sesso !== decoded.sesso) {
    mismatches.push(`Sesso: inserito "${input.sesso}", dal CF risulta "${decoded.sesso}"`)
  }

  // Check birth date
  if (input.data_nascita) {
    const inputDate = new Date(input.data_nascita)
    const decodedDate = new Date(decoded.data_nascita)
    if (inputDate.getTime() !== decodedDate.getTime()) {
      mismatches.push(`Data di nascita: inserita "${input.data_nascita}", dal CF risulta "${decoded.data_nascita}"`)
    }
  }

  // Check birthplace
  if (input.luogo_nascita) {
    const inputCity = input.luogo_nascita.toUpperCase().trim()
    const decodedCity = decoded.luogo_nascita.toUpperCase().trim()
    if (inputCity !== decodedCity) {
      mismatches.push(`Luogo di nascita: inserito "${input.luogo_nascita}", dal CF risulta "${decoded.luogo_nascita}"`)
    }
  }

  // If all fields provided, also try generating CF and compare
  if (input.cognome && input.nome && input.data_nascita && input.sesso && input.luogo_nascita) {
    const generated = calcolaCodiceFiscale(input as CodiceFiscaleInput)
    if (generated.codice_fiscale && generated.codice_fiscale !== cf.toUpperCase().replace(/\s/g, '')) {
      if (mismatches.length === 0) {
        mismatches.push('Il Codice Fiscale generato dai dati non corrisponde a quello inserito (possibile omocodia o errore nei dati)')
      }
    }
  }

  return { isConsistent: mismatches.length === 0, mismatches, decoded }
}

/**
 * Get provincia code for a city name.
 * Returns null if not found.
 */
export function getProvinciaByCityName(cityName: string): string | null {
  return CITY_TO_PROVINCIA[cityName.toUpperCase().trim()] || null
}
