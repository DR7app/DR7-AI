/**
 * Prefissi telefonici internazionali con bandiera.
 *
 * 2026-08-25 (richiesta direzione): il numero WhatsApp del collaboratore si
 * scriveva a mano e in produzione c'era "003684697632" — con lo 00 davanti
 * Green API non consegna (il sanitizer tiene solo le cifre, quindi lo 00
 * resta dentro al numero). Il prefisso ora si sceglie da una tendina con la
 * bandiera del paese e il valore si salva SEMPRE come "+<prefisso><numero>",
 * l'unica forma che Green API accetta dopo lo strip dei non-numerici.
 *
 * La bandiera NON e' scritta come emoji nel sorgente: si calcola dal codice
 * ISO 3166-1 alpha-2 (due "regional indicator" Unicode). Su macOS/iOS e
 * Android si vede la bandiera; su Windows il font di sistema non le disegna e
 * restano le due lettere del paese — per questo accanto alla bandiera c'e'
 * sempre il nome del paese e il prefisso.
 */

export interface Paese {
    /** ISO 3166-1 alpha-2 — usato per la bandiera e come chiave stabile. */
    iso: string
    /** Nome in italiano, coerente col resto del gestionale. */
    nome: string
    /** Prefisso E.164 con il "+". */
    dial: string
}

/** Bandiera dal codice ISO2: 'IT' -> coppia di regional indicator. */
export function bandiera(iso: string): string {
    const codice = iso.toUpperCase()
    if (!/^[A-Z]{2}$/.test(codice)) return ''
    return String.fromCodePoint(...[...codice].map(c => 0x1f1e6 + (c.charCodeAt(0) - 65)))
}

/**
 * Paesi in cima alla tendina: da qui arrivano davvero i collaboratori e i
 * fornitori DR7. Il resto della lista segue in ordine alfabetico.
 */
export const PAESI_FREQUENTI = ['IT', 'FR', 'MC', 'CH', 'ES', 'PT', 'DE', 'BE', 'GB', 'MA', 'TN', 'AE', 'US']

export const PREFISSO_DEFAULT = '+39'

export const PAESI: Paese[] = [
    // Europa
    { iso: 'AL', nome: 'Albania', dial: '+355' },
    { iso: 'AD', nome: 'Andorra', dial: '+376' },
    { iso: 'AT', nome: 'Austria', dial: '+43' },
    { iso: 'BE', nome: 'Belgio', dial: '+32' },
    { iso: 'BY', nome: 'Bielorussia', dial: '+375' },
    { iso: 'BA', nome: 'Bosnia ed Erzegovina', dial: '+387' },
    { iso: 'BG', nome: 'Bulgaria', dial: '+359' },
    { iso: 'CY', nome: 'Cipro', dial: '+357' },
    { iso: 'VA', nome: 'Citta del Vaticano', dial: '+379' },
    { iso: 'HR', nome: 'Croazia', dial: '+385' },
    { iso: 'DK', nome: 'Danimarca', dial: '+45' },
    { iso: 'EE', nome: 'Estonia', dial: '+372' },
    { iso: 'FI', nome: 'Finlandia', dial: '+358' },
    { iso: 'FR', nome: 'Francia', dial: '+33' },
    { iso: 'DE', nome: 'Germania', dial: '+49' },
    { iso: 'GI', nome: 'Gibilterra', dial: '+350' },
    { iso: 'GR', nome: 'Grecia', dial: '+30' },
    { iso: 'IE', nome: 'Irlanda', dial: '+353' },
    { iso: 'IS', nome: 'Islanda', dial: '+354' },
    { iso: 'FO', nome: 'Isole Faroe', dial: '+298' },
    { iso: 'IT', nome: 'Italia', dial: '+39' },
    { iso: 'XK', nome: 'Kosovo', dial: '+383' },
    { iso: 'LV', nome: 'Lettonia', dial: '+371' },
    { iso: 'LI', nome: 'Liechtenstein', dial: '+423' },
    { iso: 'LT', nome: 'Lituania', dial: '+370' },
    { iso: 'LU', nome: 'Lussemburgo', dial: '+352' },
    { iso: 'MK', nome: 'Macedonia del Nord', dial: '+389' },
    { iso: 'MT', nome: 'Malta', dial: '+356' },
    { iso: 'MD', nome: 'Moldavia', dial: '+373' },
    { iso: 'MC', nome: 'Monaco', dial: '+377' },
    { iso: 'ME', nome: 'Montenegro', dial: '+382' },
    { iso: 'NO', nome: 'Norvegia', dial: '+47' },
    { iso: 'NL', nome: 'Paesi Bassi', dial: '+31' },
    { iso: 'PL', nome: 'Polonia', dial: '+48' },
    { iso: 'PT', nome: 'Portogallo', dial: '+351' },
    { iso: 'GB', nome: 'Regno Unito', dial: '+44' },
    { iso: 'CZ', nome: 'Repubblica Ceca', dial: '+420' },
    { iso: 'RO', nome: 'Romania', dial: '+40' },
    { iso: 'RU', nome: 'Russia', dial: '+7' },
    { iso: 'SM', nome: 'San Marino', dial: '+378' },
    { iso: 'RS', nome: 'Serbia', dial: '+381' },
    { iso: 'SK', nome: 'Slovacchia', dial: '+421' },
    { iso: 'SI', nome: 'Slovenia', dial: '+386' },
    { iso: 'ES', nome: 'Spagna', dial: '+34' },
    { iso: 'SE', nome: 'Svezia', dial: '+46' },
    { iso: 'CH', nome: 'Svizzera', dial: '+41' },
    { iso: 'TR', nome: 'Turchia', dial: '+90' },
    { iso: 'UA', nome: 'Ucraina', dial: '+380' },
    { iso: 'HU', nome: 'Ungheria', dial: '+36' },

    // Africa
    { iso: 'DZ', nome: 'Algeria', dial: '+213' },
    { iso: 'AO', nome: 'Angola', dial: '+244' },
    { iso: 'BJ', nome: 'Benin', dial: '+229' },
    { iso: 'BW', nome: 'Botswana', dial: '+267' },
    { iso: 'BF', nome: 'Burkina Faso', dial: '+226' },
    { iso: 'BI', nome: 'Burundi', dial: '+257' },
    { iso: 'CM', nome: 'Camerun', dial: '+237' },
    { iso: 'CV', nome: 'Capo Verde', dial: '+238' },
    { iso: 'TD', nome: 'Ciad', dial: '+235' },
    { iso: 'KM', nome: 'Comore', dial: '+269' },
    { iso: 'CG', nome: 'Congo', dial: '+242' },
    { iso: 'CI', nome: 'Costa d Avorio', dial: '+225' },
    { iso: 'EG', nome: 'Egitto', dial: '+20' },
    { iso: 'ER', nome: 'Eritrea', dial: '+291' },
    { iso: 'SZ', nome: 'Eswatini', dial: '+268' },
    { iso: 'ET', nome: 'Etiopia', dial: '+251' },
    { iso: 'GA', nome: 'Gabon', dial: '+241' },
    { iso: 'GM', nome: 'Gambia', dial: '+220' },
    { iso: 'GH', nome: 'Ghana', dial: '+233' },
    { iso: 'DJ', nome: 'Gibuti', dial: '+253' },
    { iso: 'GN', nome: 'Guinea', dial: '+224' },
    { iso: 'GQ', nome: 'Guinea Equatoriale', dial: '+240' },
    { iso: 'GW', nome: 'Guinea-Bissau', dial: '+245' },
    { iso: 'KE', nome: 'Kenya', dial: '+254' },
    { iso: 'LS', nome: 'Lesotho', dial: '+266' },
    { iso: 'LR', nome: 'Liberia', dial: '+231' },
    { iso: 'LY', nome: 'Libia', dial: '+218' },
    { iso: 'MG', nome: 'Madagascar', dial: '+261' },
    { iso: 'MW', nome: 'Malawi', dial: '+265' },
    { iso: 'ML', nome: 'Mali', dial: '+223' },
    { iso: 'MA', nome: 'Marocco', dial: '+212' },
    { iso: 'MR', nome: 'Mauritania', dial: '+222' },
    { iso: 'MU', nome: 'Mauritius', dial: '+230' },
    { iso: 'YT', nome: 'Mayotte', dial: '+262' },
    { iso: 'MZ', nome: 'Mozambico', dial: '+258' },
    { iso: 'NA', nome: 'Namibia', dial: '+264' },
    { iso: 'NE', nome: 'Niger', dial: '+227' },
    { iso: 'NG', nome: 'Nigeria', dial: '+234' },
    { iso: 'CF', nome: 'Repubblica Centrafricana', dial: '+236' },
    { iso: 'CD', nome: 'Repubblica Democratica del Congo', dial: '+243' },
    { iso: 'RE', nome: 'Riunione', dial: '+262' },
    { iso: 'RW', nome: 'Ruanda', dial: '+250' },
    { iso: 'ST', nome: 'Sao Tome e Principe', dial: '+239' },
    { iso: 'SN', nome: 'Senegal', dial: '+221' },
    { iso: 'SC', nome: 'Seychelles', dial: '+248' },
    { iso: 'SL', nome: 'Sierra Leone', dial: '+232' },
    { iso: 'SO', nome: 'Somalia', dial: '+252' },
    { iso: 'ZA', nome: 'Sudafrica', dial: '+27' },
    { iso: 'SS', nome: 'Sud Sudan', dial: '+211' },
    { iso: 'SD', nome: 'Sudan', dial: '+249' },
    { iso: 'TZ', nome: 'Tanzania', dial: '+255' },
    { iso: 'TG', nome: 'Togo', dial: '+228' },
    { iso: 'TN', nome: 'Tunisia', dial: '+216' },
    { iso: 'UG', nome: 'Uganda', dial: '+256' },
    { iso: 'ZM', nome: 'Zambia', dial: '+260' },
    { iso: 'ZW', nome: 'Zimbabwe', dial: '+263' },

    // Asia e Medio Oriente
    { iso: 'AF', nome: 'Afghanistan', dial: '+93' },
    { iso: 'SA', nome: 'Arabia Saudita', dial: '+966' },
    { iso: 'AM', nome: 'Armenia', dial: '+374' },
    { iso: 'AZ', nome: 'Azerbaigian', dial: '+994' },
    { iso: 'BH', nome: 'Bahrein', dial: '+973' },
    { iso: 'BD', nome: 'Bangladesh', dial: '+880' },
    { iso: 'BT', nome: 'Bhutan', dial: '+975' },
    { iso: 'BN', nome: 'Brunei', dial: '+673' },
    { iso: 'KH', nome: 'Cambogia', dial: '+855' },
    { iso: 'CN', nome: 'Cina', dial: '+86' },
    { iso: 'KP', nome: 'Corea del Nord', dial: '+850' },
    { iso: 'KR', nome: 'Corea del Sud', dial: '+82' },
    { iso: 'AE', nome: 'Emirati Arabi Uniti', dial: '+971' },
    { iso: 'PH', nome: 'Filippine', dial: '+63' },
    { iso: 'JP', nome: 'Giappone', dial: '+81' },
    { iso: 'JO', nome: 'Giordania', dial: '+962' },
    { iso: 'GE', nome: 'Georgia', dial: '+995' },
    { iso: 'HK', nome: 'Hong Kong', dial: '+852' },
    { iso: 'IN', nome: 'India', dial: '+91' },
    { iso: 'ID', nome: 'Indonesia', dial: '+62' },
    { iso: 'IR', nome: 'Iran', dial: '+98' },
    { iso: 'IQ', nome: 'Iraq', dial: '+964' },
    { iso: 'IL', nome: 'Israele', dial: '+972' },
    { iso: 'KZ', nome: 'Kazakistan', dial: '+7' },
    { iso: 'KG', nome: 'Kirghizistan', dial: '+996' },
    { iso: 'KW', nome: 'Kuwait', dial: '+965' },
    { iso: 'LA', nome: 'Laos', dial: '+856' },
    { iso: 'LB', nome: 'Libano', dial: '+961' },
    { iso: 'MO', nome: 'Macao', dial: '+853' },
    { iso: 'MV', nome: 'Maldive', dial: '+960' },
    { iso: 'MY', nome: 'Malaysia', dial: '+60' },
    { iso: 'MN', nome: 'Mongolia', dial: '+976' },
    { iso: 'MM', nome: 'Myanmar', dial: '+95' },
    { iso: 'NP', nome: 'Nepal', dial: '+977' },
    { iso: 'OM', nome: 'Oman', dial: '+968' },
    { iso: 'PK', nome: 'Pakistan', dial: '+92' },
    { iso: 'PS', nome: 'Palestina', dial: '+970' },
    { iso: 'QA', nome: 'Qatar', dial: '+974' },
    { iso: 'SG', nome: 'Singapore', dial: '+65' },
    { iso: 'SY', nome: 'Siria', dial: '+963' },
    { iso: 'LK', nome: 'Sri Lanka', dial: '+94' },
    { iso: 'TJ', nome: 'Tagikistan', dial: '+992' },
    { iso: 'TW', nome: 'Taiwan', dial: '+886' },
    { iso: 'TH', nome: 'Thailandia', dial: '+66' },
    { iso: 'TL', nome: 'Timor Est', dial: '+670' },
    { iso: 'TM', nome: 'Turkmenistan', dial: '+993' },
    { iso: 'UZ', nome: 'Uzbekistan', dial: '+998' },
    { iso: 'VN', nome: 'Vietnam', dial: '+84' },
    { iso: 'YE', nome: 'Yemen', dial: '+967' },

    // Americhe
    { iso: 'AR', nome: 'Argentina', dial: '+54' },
    { iso: 'AW', nome: 'Aruba', dial: '+297' },
    { iso: 'BS', nome: 'Bahamas', dial: '+1' },
    { iso: 'BB', nome: 'Barbados', dial: '+1' },
    { iso: 'BZ', nome: 'Belize', dial: '+501' },
    { iso: 'BM', nome: 'Bermuda', dial: '+1' },
    { iso: 'BO', nome: 'Bolivia', dial: '+591' },
    { iso: 'BR', nome: 'Brasile', dial: '+55' },
    { iso: 'CA', nome: 'Canada', dial: '+1' },
    { iso: 'CL', nome: 'Cile', dial: '+56' },
    { iso: 'CO', nome: 'Colombia', dial: '+57' },
    { iso: 'CR', nome: 'Costa Rica', dial: '+506' },
    { iso: 'CU', nome: 'Cuba', dial: '+53' },
    { iso: 'CW', nome: 'Curacao', dial: '+599' },
    { iso: 'EC', nome: 'Ecuador', dial: '+593' },
    { iso: 'SV', nome: 'El Salvador', dial: '+503' },
    { iso: 'JM', nome: 'Giamaica', dial: '+1' },
    { iso: 'GP', nome: 'Guadalupa', dial: '+590' },
    { iso: 'GT', nome: 'Guatemala', dial: '+502' },
    { iso: 'GY', nome: 'Guyana', dial: '+592' },
    { iso: 'GF', nome: 'Guyana francese', dial: '+594' },
    { iso: 'HT', nome: 'Haiti', dial: '+509' },
    { iso: 'HN', nome: 'Honduras', dial: '+504' },
    { iso: 'MQ', nome: 'Martinica', dial: '+596' },
    { iso: 'MX', nome: 'Messico', dial: '+52' },
    { iso: 'NI', nome: 'Nicaragua', dial: '+505' },
    { iso: 'PA', nome: 'Panama', dial: '+507' },
    { iso: 'PY', nome: 'Paraguay', dial: '+595' },
    { iso: 'PE', nome: 'Peru', dial: '+51' },
    { iso: 'PR', nome: 'Porto Rico', dial: '+1' },
    { iso: 'DO', nome: 'Repubblica Dominicana', dial: '+1' },
    { iso: 'US', nome: 'Stati Uniti', dial: '+1' },
    { iso: 'TT', nome: 'Trinidad e Tobago', dial: '+1' },
    { iso: 'UY', nome: 'Uruguay', dial: '+598' },
    { iso: 'VE', nome: 'Venezuela', dial: '+58' },

    // Oceania
    { iso: 'AU', nome: 'Australia', dial: '+61' },
    { iso: 'FJ', nome: 'Figi', dial: '+679' },
    { iso: 'GU', nome: 'Guam', dial: '+1' },
    { iso: 'SB', nome: 'Isole Salomone', dial: '+677' },
    { iso: 'NC', nome: 'Nuova Caledonia', dial: '+687' },
    { iso: 'NZ', nome: 'Nuova Zelanda', dial: '+64' },
    { iso: 'PG', nome: 'Papua Nuova Guinea', dial: '+675' },
    { iso: 'PF', nome: 'Polinesia francese', dial: '+689' },
    { iso: 'WS', nome: 'Samoa', dial: '+685' },
    { iso: 'TO', nome: 'Tonga', dial: '+676' },
    { iso: 'VU', nome: 'Vanuatu', dial: '+678' },
]

/** Etichetta di una voce della tendina: bandiera + nome + prefisso. */
export function etichettaPaese(p: Paese): string {
    const f = bandiera(p.iso)
    return `${f ? f + ' ' : ''}${p.nome} (${p.dial})`
}

/** I frequenti nell'ordine deciso sopra, poi tutti gli altri in ordine alfabetico. */
export function paesiOrdinati(): { frequenti: Paese[]; altri: Paese[] } {
    const perIso = new Map(PAESI.map(p => [p.iso, p]))
    const frequenti = PAESI_FREQUENTI.map(iso => perIso.get(iso)).filter((p): p is Paese => !!p)
    const isoFrequenti = new Set(frequenti.map(p => p.iso))
    const altri = PAESI
        .filter(p => !isoFrequenti.has(p.iso))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
    return { frequenti, altri }
}

/**
 * Spacchetta un contatto salvato in (prefisso, numero locale).
 * Accetta le forme storiche: "+39340...", "0039340...", "00 36 8469...",
 * "340 123 4567" (senza prefisso -> Italia). Il prefisso piu' lungo vince,
 * cosi' +377 (Monaco) non viene letto come +37.
 */
export function separaPrefisso(valore: string | null | undefined): { dial: string; numero: string } {
    const grezzo = (valore || '').trim()
    if (!grezzo) return { dial: PREFISSO_DEFAULT, numero: '' }
    const cifre = grezzo.replace(/\D/g, '')
    if (!cifre) return { dial: PREFISSO_DEFAULT, numero: '' }
    // "+" esplicito o "00" internazionale: il prefisso e' scritto dentro al numero.
    const internazionale = grezzo.startsWith('+') || cifre.startsWith('00')
    if (!internazionale) return { dial: PREFISSO_DEFAULT, numero: cifre }
    const senzaZeri = cifre.replace(/^00/, '')
    const dials = [...new Set(PAESI.map(p => p.dial))].sort((a, b) => b.length - a.length)
    const trovato = dials.find(d => senzaZeri.startsWith(d.slice(1)))
    if (!trovato) return { dial: PREFISSO_DEFAULT, numero: senzaZeri }
    return { dial: trovato, numero: senzaZeri.slice(trovato.length - 1) }
}

/** Numero completo pronto per Green API: "+<prefisso><numero>", senza zeri di tronco. */
export function componiNumero(dial: string, numeroLocale: string): string | null {
    const locale = (numeroLocale || '').replace(/\D/g, '').replace(/^0+/, '')
    if (!locale) return null
    return `${dial}${locale}`
}
