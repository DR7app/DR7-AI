import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import NewClientModal from '../../../components/NewClientModal'
import Button from './Button'
import Input from './Input'
import { logger } from '../../../utils/logger'

// ── Types ────────────────────────────────────────────────────────────────────

interface BookingForCargos {
    id: string
    pickup_date: string
    dropoff_date: string
    customer_name: string
    customer_email: string
    customer_phone: string
    vehicle_name: string
    vehicle_plate?: string
    vehicle_id?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details: any
    user_id?: string
    status: string
    // Enriched customer data
    customerData?: CustomerExtended | null
    // CARGOS send status
    cargosStatus?: 'pending' | 'sent' | 'error' | 'checking'
    cargosError?: string
}

interface CustomerExtended {
    id?: string
    nome?: string
    cognome?: string
    data_nascita?: string
    luogo_nascita?: string
    codice_fiscale?: string
    numero_patente?: string
    patente_numero?: string  // legacy alias
    patente_rilasciata_da?: string
    nome_rappresentante?: string
    cognome_rappresentante?: string
    data_nascita_rappresentante?: string
    cf_rappresentante?: string
    documento_tipo?: string
    documento_numero?: string
    numero_documento_rappresentante?: string
    documento_rilasciato_da?: string
    indirizzo?: string
    citta?: string
    provincia?: string
    cap?: string
    nazionalita?: string
    telefono?: string
    tipo_cliente?: string
    denominazione?: string
    ragione_sociale?: string
    partita_iva?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any
}

// ── CARGOS Field Sizes (46 fields, total 1505 chars) ─────────────────────────

const FIELD_SIZES = [
    50, 16, 1, 16, 9, 150, 16, 9, 150, 50,    // 0-9
    30, 70, 9, 150, 20,                          // 10-14
    1, 50, 100, 15, 50, 1, 1,                    // 15-21
    50, 30, 10, 9, 9, 9, 150, 5, 20, 9, 20, 9, 20,  // 22-34
    50, 30, 10, 9, 9, 5, 20, 9, 20, 9, 20       // 35-45
]

function padField(value: string, maxLen: number): string {
    return (value || '').substring(0, maxLen).padEnd(maxLen, ' ')
}

// CARGOS location codes (9-digit, from reference table 1 - COMUNI_STATI)
// Format: prefix + standard ISTAT code
const ISTAT_CODES: Record<string, string> = {
    'CAGLIARI': '420092009',
    'SASSARI': '420090064',
    'NUORO': '420091051',
    'ORISTANO': '420092555',
    'QUARTU SANT\'ELENA': '420092051',
    'OLBIA': '420090047',
    'ALGHERO': '420090003',
    'CARBONIA': '420092012',
    'IGLESIAS': '420092033',
    'SELARGIUS': '420092068',
    'MONSERRATO': '420092109',
    'VILLACIDRO': '420092092',
    'SANLURI': '420092057',
    'LANUSEI': '420091037',
    'ROMA': '412058091',
    'MILANO': '403015146',
    'TORINO': '401001272',
    'NAPOLI': '415063049',
    'FIRENZE': '409048017',
    'BOLOGNA': '408037006',
    'PALERMO': '419082053',
    'GENOVA': '407010025',
    'BARI': '416072006',
    'CATANIA': '419087015',
    'VENEZIA': '405027042',
    // Nationality codes (states)
    'ITALIA': '100000100',
    'ITALY': '100000100',
    'FRANCIA': '100000215',
    'FRANCE': '100000215',
    'GERMANIA': '100000216',
    'GERMANY': '100000216',
}

// Payment type (field 2) — C=Contanti, B=Bonifico, K=Carta, etc.
// CARGOS TIPO_PAGAMENTO codes (from reference table 0)
// 0=Carta di Credito, 1=Contanti, 2=Carta di Debito, 3=Bonifico, 4=RID, 9=Altro
const PAYMENT_TYPE_MAP: Record<string, string> = {
    'cash': '1',
    'contanti': '1',
    'card': '0',
    'carta': '0',
    'credit_card': '0',
    'nexi': '0',
    'transfer': '3',
    'bonifico': '3',
    'wallet': '9',
    'credits': '9',
}

// CARGOS TIPO_DOCUMENTO codes (from reference table 3)
// IDENT=Carta di Identità, IDELE=Carta ID Elettronica, PASOR=Passaporto, PATEN=Patente
const DOC_TYPE_MAP: Record<string, string> = {
    'carta_identita': 'IDENT',
    'CI': 'IDENT',
    'carta_identita_elettronica': 'IDELE',
    'CIE': 'IDELE',
    'passaporto': 'PASOR',
    'PA': 'PASOR',
    'patente': 'PATEN',
    'PT': 'PATEN',
}

// ── Agency constants ─────────────────────────────────────────────────────────

const AGENCY = {
    id: 'RENTORA',
    name: 'RENTORA',
    locationCode: '420092009', // Cagliari CARGOS code
    address: 'VIALE MARCONI 229, CAGLIARI CA',
    phone: '3472817258',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Sanitize strings for CARGOS: only allow letters, accented chars, numbers, space, . , '
function sanitizeCargos(value: string): string {
    return (value || '').replace(/[^a-zA-Z0-9àèìòùäöüßÀÈÌÒÙÄÖÜ .,'/]/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatDateCargos(isoDate: string): string {
    // Convert ISO date to DD/MM/YYYY HH:MM
    const d = new Date(isoDate)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

function formatDateOnlyCargos(dateStr: string): string {
    // Convert YYYY-MM-DD or ISO to DD/MM/YYYY
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
}

// CARGOS TIPO_VEICOLO codes (from reference table 2)
// 0=Autovetture, 1=Furgoni, 9=Autocaravan
function guessVehicleType(vehicleName: string): string {
    const lower = (vehicleName || '').toLowerCase()
    if (lower.includes('vito') || lower.includes('ducato') || lower.includes('furgon')) return '1'
    return '0' // Default: Autovetture
}

function guessVehicleBrand(vehicleName: string): string {
    const lower = (vehicleName || '').toLowerCase()
    if (lower.includes('audi')) return 'AUDI'
    if (lower.includes('fiat')) return 'FIAT'
    if (lower.includes('porsche')) return 'PORSCHE'
    if (lower.includes('bmw')) return 'BMW'
    if (lower.includes('mercedes')) return 'MERCEDES-BENZ'
    if (lower.includes('lamborghini')) return 'LAMBORGHINI'
    if (lower.includes('ferrari')) return 'FERRARI'
    if (lower.includes('maserati')) return 'MASERATI'
    if (lower.includes('alfa')) return 'ALFA ROMEO'
    return vehicleName.split(' ')[0]?.toUpperCase() || 'ND000000000'
}

function guessVehicleModel(vehicleName: string): string {
    // Remove brand from name
    const parts = vehicleName.split(' ')
    return parts.length > 1 ? parts.slice(1).join(' ') : vehicleName
}

// 2026-08-20: nessun ripiego silenzioso su Cagliari — vedi nota in
// cargos-auto-send.ts. `null` = comune sconosciuto, da chiedere all'operatore.
function lookupIstatCode(cityName: string): string | null {
    if (!cityName) return null
    const upper = cityName.toUpperCase().trim()
    return ISTAT_CODES[upper] || null
}
/** Per il record: sconosciuto = campo VUOTO, mai un codice inventato. */
function istatOrEmpty(cityName: string | null | undefined): string {
    return lookupIstatCode(cityName || '') || ''
}

function getPaymentType(booking: BookingForCargos): string {
    const method = booking.booking_details?.payment_method ||
        booking.booking_details?.paymentMethod || ''
    return PAYMENT_TYPE_MAP[method.toLowerCase()] || '0' // Default: Carta di Credito
}

// Extract birth date from Italian codice fiscale (DD/MM/YYYY format)
function birthDateFromCF(cf: string): string {
    if (!cf || cf.length < 11) return ''
    const monthMap: Record<string, string> = {
        'A': '01', 'B': '02', 'C': '03', 'D': '04', 'E': '05', 'H': '06',
        'L': '07', 'M': '08', 'P': '09', 'R': '10', 'S': '11', 'T': '12'
    }
    const yearPart = parseInt(cf.substring(6, 8), 10)
    const monthLetter = cf.charAt(8).toUpperCase()
    let day = parseInt(cf.substring(9, 11), 10)
    if (day > 40) day -= 40 // Female: day += 40
    const mm = monthMap[monthLetter]
    if (!mm) return ''
    const yyyy = yearPart > 50 ? 1900 + yearPart : 2000 + yearPart
    return `${String(day).padStart(2, '0')}/${mm}/${yyyy}`
}

function buildCargosRecord(booking: BookingForCargos): string {
    const c = booking.customerData
    const bd = booking.booking_details || {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = c?.metadata || (c as any)?.metadata || {}
    const rapp = meta?.rappresentante || {}

    // For azienda, use denominazione as surname but rappresentante for driver fields
    let surname = ''
    let firstName = ''
    if (c?.tipo_cliente === 'azienda') {
        surname = c?.ragione_sociale || c?.denominazione || c?.cognome || booking.customer_name || ''
        // CARGOS requires NOME even for azienda — use legal representative or repeat denominazione
        firstName = c?.nome_rappresentante || rapp.nome || c?.nome || surname
    } else {
        surname = c?.cognome || ''
        firstName = c?.nome || ''
        if (!surname && booking.customer_name) {
            const parts = booking.customer_name.trim().split(/\s+/)
            if (parts.length >= 2) {
                surname = parts[parts.length - 1]
                firstName = parts.slice(0, -1).join(' ')
            } else {
                surname = parts[0] || ''
            }
        }
    }

    // For azienda, use rappresentante birth date, then extract from CF as fallback
    let birthDate = ''
    if (c?.tipo_cliente === 'azienda') {
        birthDate = c?.data_nascita_rappresentante || rapp.data_nascita || c?.data_nascita || ''
        if (!birthDate) {
            // Try extracting from CF rappresentante (16-char personal codice fiscale)
            const cfToTry = c?.cf_rappresentante || rapp.cf || rapp.codice_fiscale || (c?.codice_fiscale?.length === 16 ? c.codice_fiscale : '')
            if (cfToTry && cfToTry.length === 16) {
                birthDate = birthDateFromCF(cfToTry)
            }
        }
        logger.log(`[CARGOS-DEBUG] Azienda birthDate: "${birthDate}", data_nascita_rapp="${c?.data_nascita_rappresentante}", rapp.data_nascita="${rapp.data_nascita}", cf_rapp="${c?.cf_rappresentante}", rapp.cf="${rapp.codice_fiscale}", codice_fiscale="${c?.codice_fiscale}"`)
    } else {
        birthDate = c?.data_nascita || bd.customer?.birthDate || ''
    }

    // Second driver from booking_details
    const driver2 = bd.second_driver || bd.secondDriver || null

    const fields = [
        /* 0  */ booking.id.substring(0, 50),
        /* 1  */ formatDateCargos(booking.pickup_date),
        /* 2  */ getPaymentType(booking),
        /* 3  */ formatDateCargos(booking.pickup_date),
        /* 4  */ AGENCY.locationCode,   // Pickup always at agency
        /* 5  */ AGENCY.address,
        /* 6  */ formatDateCargos(booking.dropoff_date),
        /* 7  */ AGENCY.locationCode,   // Return always at agency
        /* 8  */ AGENCY.address,
        /* 9  */ 'ADMIN',
        /* 10 */ AGENCY.id,
        /* 11 */ AGENCY.name,
        /* 12 */ AGENCY.locationCode,
        /* 13 */ AGENCY.address,
        /* 14 */ AGENCY.phone,
        /* 15 */ guessVehicleType(booking.vehicle_name || ''),
        /* 16 */ guessVehicleBrand(booking.vehicle_name || ''),
        /* 17 */ guessVehicleModel(booking.vehicle_name || ''),
        /* 18 */ (booking.vehicle_plate || bd.vehicle_plate || bd.vehicle?.plate || '').toUpperCase(),
        /* 19 */ '', // Color — optional
        /* 20 */ '0', // GPS
        /* 21 */ '0', // Engine lock
        /* 22 */ surname.toUpperCase(),
        /* 23 */ firstName.toUpperCase(),
        /* 24 */ birthDate.includes('/') ? birthDate : formatDateOnlyCargos(birthDate),
        /* 25 */ istatOrEmpty(c?.luogo_nascita || rapp.luogo_nascita || bd.customer?.birthPlace || ''),
        /* 26 */ istatOrEmpty(c?.nazionalita || 'ITALIA'), // Nationality — default Italia
        /* 27 */ istatOrEmpty(c?.citta || ''),
        /* 28 */ sanitizeCargos(`${c?.indirizzo || ''} ${c?.citta || ''} ${c?.provincia || ''}`),
        /* 29 */ DOC_TYPE_MAP[c?.documento_tipo || rapp.documento?.tipo || 'CI'] || 'IDENT',
        /* 30 */ c?.documento_numero || c?.numero_documento_rappresentante || rapp.documento?.numero || bd.customer?.documentNumber || c?.numero_patente || c?.patente_numero || bd.customer?.licenseNumber || bd.customer?.driverLicense || '',
        /* 31 */ istatOrEmpty(rapp.documento?.luogo || c?.citta || ''),
        /* 32 */ (() => {
            if (c?.tipo_cliente === 'azienda') {
                return rapp.patente || c?.numero_patente || c?.patente_numero || bd.customer?.licenseNumber || bd.customer?.driverLicense || 'ND000000000'
            }
            return c?.numero_patente || c?.patente_numero || bd.customer?.licenseNumber || bd.customer?.driverLicense || ''
        })(),
        /* 33 */ istatOrEmpty(c?.patente_rilasciata_da || c?.citta || ''),
        /* 34 */ c?.telefono || booking.customer_phone || '',
        /* 35 */ driver2?.cognome || driver2?.surname || '',
        /* 36 */ driver2?.nome || driver2?.name || '',
        /* 37 */ formatDateOnlyCargos(driver2?.data_nascita || driver2?.birthDate || ''),
        /* 38 */ istatOrEmpty(driver2?.luogo_nascita || driver2?.birthPlace || ''),
        /* 39 */ istatOrEmpty(driver2?.nazionalita || ''),
        /* 40 */ '',  // Driver 2 doc type
        /* 41 */ '',  // Driver 2 doc number
        /* 42 */ '',  // Driver 2 doc issue place
        /* 43 */ driver2?.numero_patente || driver2?.patente_numero || driver2?.licenseNumber || '',
        /* 44 */ istatOrEmpty(driver2?.luogo_nascita || ''),
        /* 45 */ driver2?.telefono || driver2?.phone || '',
    ]

    // Sanitize all text fields (skip date fields 1,3,6,24,37 and code fields 2,4,7,12,15,20,21,25,26,27,29,31,33,38,39,42,44)
    const codeFields = new Set([1,2,3,4,6,7,12,15,20,21,24,25,26,27,29,31,33,37,38,39,42,44])
    return fields.map((val, i) => {
        const s = String(val)
        const clean = codeFields.has(i) ? s : sanitizeCargos(s)
        return padField(clean, FIELD_SIZES[i])
    }).join('')
}

// ── Validation ───────────────────────────────────────────────────────────────

interface ValidationIssue {
    field: string
    message: string
    severity: 'error' | 'warning'
}

function validateBookingForCargos(booking: BookingForCargos): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const c = booking.customerData
    const bd = booking.booking_details || {}

    // Targa is the only hard requirement — CARGOS cannot work without it
    if (!booking.vehicle_plate && !bd.vehicle_plate && !bd.vehicle?.plate) {
        issues.push({ field: 'Targa', message: 'Targa veicolo mancante', severity: 'error' })
    }

    if (!c?.cognome && !c?.ragione_sociale && !c?.denominazione && !booking.customer_name) {
        issues.push({ field: 'Cognome', message: 'Cognome/Denominazione mancante', severity: 'error' })
    }

    // For persona fisica: patente and documento are required by CARGOS
    if (c?.tipo_cliente !== 'azienda') {
        if (!c?.numero_patente && !c?.patente_numero && !bd.customer?.licenseNumber && !bd.customer?.driverLicense) {
            issues.push({ field: 'Patente', message: 'Numero patente mancante', severity: 'error' })
        }

        if (!c?.data_nascita && !bd.customer?.birthDate) {
            issues.push({ field: 'Data Nascita', message: 'Data di nascita mancante', severity: 'error' })
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = c?.metadata || (c as any)?.metadata || {}
        const rapp = meta?.rappresentante || {}
        if (!c?.documento_numero && !c?.numero_documento_rappresentante && !rapp.documento?.numero && !bd.customer?.documentNumber && !c?.numero_patente && !c?.patente_numero && !bd.customer?.licenseNumber && !bd.customer?.driverLicense) {
            issues.push({ field: 'Documento', message: 'Numero documento identità mancante', severity: 'error' })
        }

        // 2026-08-20 (richiesta direzione): era un semplice avviso e la riga
        // partiva lo stesso con Cagliari al posto del luogo vero. Ma questa e'
        // una dichiarazione alla Polizia di Stato: un luogo di nascita inventato
        // e' un'informazione FALSA trasmessa a un'autorita'. Ora blocca.
        const luogoNascita = c?.luogo_nascita || bd.customer?.birthPlace || ''
        if (!luogoNascita) {
            issues.push({ field: 'Luogo Nascita', message: 'Luogo di nascita mancante', severity: 'error' })
        } else if (lookupIstatCode(luogoNascita) === null) {
            issues.push({ field: 'Luogo Nascita', message: `Luogo di nascita non riconosciuto ("${luogoNascita}") — codice ISTAT assente`, severity: 'error' })
        }
    }

    return issues
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CargosTab() {
    // Config
    const [password, setPassword] = useState('')
    const [showSettings, setShowSettings] = useState(false)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [authLoading, setAuthLoading] = useState(false)

    // Bookings
    const [exportDate, setExportDate] = useState(new Date().toISOString().split('T')[0])
    const [bookings, setBookings] = useState<BookingForCargos[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [escludendo, setEscludendo] = useState<string | null>(null)
    // 2026-08-20 (richiesta direzione): i campi "Mancante" si completano da qui.
    // Si apre la STESSA scheda cliente di Clienti (NewClientModal), quindi il
    // dato finisce dove deve — in customers_extended — e non in una copia
    // locale che poi diverge. Alla chiusura si ricarica l'elenco, cosi' la riga
    // smette subito di risultare incompleta.
    const [clienteDaCompletare, setClienteDaCompletare] = useState<Record<string, unknown> | null>(null)

    // 2026-08-20 (richiesta direzione): avvisi WhatsApp quando una trasmissione
    // CARGOS fallisce o quando mancano i dati del cliente. Numeri MULTIPLI:
    // l'avviso deve poter arrivare a piu' persone. Salvati in
    // centralina_pro_config.config.cargos; senza numeri non parte nulla.
    const [alertsEnabled, setAlertsEnabled] = useState(false)
    const [alertNumbers, setAlertNumbers] = useState<string[]>([''])
    const [alertsSaving, setAlertsSaving] = useState(false)
    const [alertsOpen, setAlertsOpen] = useState(false)

    useEffect(() => {
        let annullato = false
        ;(async () => {
            const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
            if (annullato) return
            const cfg = (data?.config || {}) as Record<string, unknown>
            const cargosCfg = (cfg.cargos || {}) as Record<string, unknown>
            setAlertsEnabled(cargosCfg.alerts_enabled === true)
            const nums = Array.isArray(cargosCfg.alert_numbers) ? (cargosCfg.alert_numbers as unknown[]).map(String) : []
            setAlertNumbers(nums.length > 0 ? nums : [''])
        })()
        return () => { annullato = true }
    }, [])

    async function salvaAvvisi() {
        const puliti = Array.from(new Set(
            alertNumbers.map(n => n.replace(/\D/g, '')).filter(n => n.length >= 9)
        ))
        if (alertsEnabled && puliti.length === 0) {
            toast.error('Aggiungi almeno un numero valido (9-15 cifre, formato internazionale senza +)')
            return
        }
        setAlertsSaving(true)
        try {
            const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
            const cfg = (data?.config || {}) as Record<string, unknown>
            const next = { ...cfg, cargos: { ...((cfg.cargos as Record<string, unknown>) || {}), alerts_enabled: alertsEnabled, alert_numbers: puliti } }
            const { error } = await supabase.from('centralina_pro_config').upsert({ id: 'main', config: next }, { onConflict: 'id' })
            if (error) throw error
            setAlertNumbers(puliti.length > 0 ? puliti : [''])
            // Salvato = niente altro da fare qui: il pannello si chiude e resta
            // il badge con lo stato. Prima restava aperto e sembrava in sospeso.
            setAlertsOpen(false)
            toast.success(alertsEnabled ? `Avvisi attivi su ${puliti.length} numero/i` : 'Avvisi disattivati')
        } catch (e) {
            toast.error('Salvataggio fallito: ' + (e instanceof Error ? e.message : 'errore'))
        } finally {
            setAlertsSaving(false)
        }
    }

    // Apre la scheda cliente sulla riga. Se il cliente e' gia' in anagrafica si
    // apre in MODIFICA (id reale); se la prenotazione non e' collegata a nessuna
    // scheda, si apre precompilata con quel che si sa dal booking, cosi' si crea
    // il cliente invece di lasciare il buco.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function apriSchedaCliente(b: any) {
        if (b.customerData?.id) {
            setClienteDaCompletare(b.customerData as Record<string, unknown>)
            return
        }
        // 2026-08-20: prima si apriva subito una scheda VUOTA quando la riga non
        // aveva customerData — ma il cliente in anagrafica spesso c'e', solo che
        // la prenotazione non e' collegata per user_id. Si cerca per email e poi
        // per telefono: meglio aprire la scheda ESISTENTE che crearne una seconda
        // e ritrovarsi due volte lo stesso cliente.
        const email = (b.customer_email || '').trim()
        const tel = (b.customer_phone || '').replace(/\D/g, '')
        if (email) {
            const { data } = await supabase.from('customers_extended').select('*').ilike('email', email).maybeSingle()
            if (data) { setClienteDaCompletare(data as Record<string, unknown>); return }
        }
        if (tel.length >= 9) {
            const { data } = await supabase.from('customers_extended').select('*').ilike('telefono', `%${tel.slice(-9)}%`).limit(1)
            if (data && data.length > 0) { setClienteDaCompletare(data[0] as Record<string, unknown>); return }
        }
        const nome = (b.customer_name || '').trim().split(/\s+/)
        setClienteDaCompletare({
            _isNew: true,
            nome: nome[0] || '',
            cognome: nome.slice(1).join(' ') || '',
            email: b.customer_email || '',
            telefono: b.customer_phone || '',
            tipo_cliente: 'persona_fisica',
        })
    }

    // Toglie una riga dall'elenco CARGOS senza toccare la prenotazione.
    async function escludiRiga(b: { id: string; customer_name?: string | null; vehicle_plate?: string | null; booking_details?: Record<string, unknown> | null }) {
        const chi = b.customer_name || b.vehicle_plate || 'questa riga'
        if (!confirm(
            `Togliere ${chi} dall'elenco CARGOS?\n\n` +
            'La prenotazione NON viene cancellata: sparisce solo da questa lista e ' +
            'non verra\' trasmessa alla Polizia di Stato.\n\n' +
            'Usalo per righe che non devono essere inviate (test, doppioni, prenotazioni gia\' comunicate altrove).'
        )) return
        setEscludendo(b.id)
        try {
            const { error } = await supabase
                .from('bookings')
                .update({
                    booking_details: {
                        ...(b.booking_details || {}),
                        cargos_escluso: true,
                        cargos_escluso_at: new Date().toISOString(),
                    },
                })
                .eq('id', b.id)
            if (error) throw error
            setBookings(prev => prev.filter(x => x.id !== b.id))
            setSelectedIds(prev => { const n = new Set(prev); n.delete(b.id); return n })
            toast.success('Riga tolta dall\'elenco CARGOS')
        } catch (e) {
            toast.error('Operazione fallita: ' + (e instanceof Error ? e.message : 'errore'))
        } finally {
            setEscludendo(null)
        }
    }
    const [viewMode, setViewMode] = useState<'all' | 'date' | 'range'>('all')
    // 2026-06-05: ricerca per intervallo di date (data inizio noleggio).
    const [rangeFrom, setRangeFrom] = useState('')
    const [rangeTo, setRangeTo] = useState('')

    // Send status
    const [sending, setSending] = useState(false)
    const [sendResult, setSendResult] = useState<{ success: number; errors: number; details?: string } | null>(null)

    // Sub-tab
    const [activeSubTab, setActiveSubTab] = useState<'send' | 'export'>('send')

    // Auto-authenticate: try server-side credentials first, then sessionStorage
    useEffect(() => {
        const saved = sessionStorage.getItem('cargos_session')
        if (saved) {
            setPassword(saved)
            setIsAuthenticated(true)
            return
        }
        // Try auto-auth with server-side env credentials (no password needed from UI)
        ;(async () => {
            try {
                const res = await fetch('/.netlify/functions/cargos-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'getToken' }),
                })
                const data = await res.json()
                if (!data.error && data.token) {
                    setIsAuthenticated(true)
                    setPassword('__server__')
                    sessionStorage.setItem('cargos_session', '__server__')
                }
            } catch { /* ignore - user can auth manually */ }
        })()
    }, [])

    // ── Auth ─────────────────────────────────────────────────────────────────

    async function testConnection() {
        if (!password) {
            toast.error('Inserisci la password')
            return
        }
        setAuthLoading(true)
        try {
            const res = await fetch('/.netlify/functions/cargos-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getToken', password }),
            })
            const data = await res.json()
            if (data.error) {
                toast.error('Autenticazione fallita: ' + data.error)
                setIsAuthenticated(false)
            } else {
                toast.success('Connessione CARGOS riuscita!')
                setIsAuthenticated(true)
                sessionStorage.setItem('cargos_session', password)
                setShowSettings(false)
            }
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore connessione: ' + _errMsg)
        } finally {
            setAuthLoading(false)
        }
    }

    // ── Load Bookings ────────────────────────────────────────────────────────

    const loadBookings = useCallback(async () => {
        setLoading(true)
        setBookings([])
        setSelectedIds(new Set())
        setSendResult(null)

        try {
            let query = supabase
                .from('bookings')
                .select(`
                    id, pickup_date, dropoff_date, customer_name, customer_email,
                    customer_phone, vehicle_name, vehicle_plate, vehicle_id,
                    booking_details, user_id, status, service_type
                `)
                .not('status', 'in', '(cancelled,annullata)')
                .order('pickup_date', { ascending: false })

            if (viewMode === 'date') {
                const startOfDay = new Date(exportDate)
                startOfDay.setHours(0, 0, 0, 0)
                const endOfDay = new Date(exportDate)
                endOfDay.setHours(23, 59, 59, 999)
                query = query
                    .gte('pickup_date', startOfDay.toISOString())
                    .lte('pickup_date', endOfDay.toISOString())
            } else if (viewMode === 'range') {
                // Intervallo data inizio noleggio (estremi inclusi). Applica solo
                // i limiti impostati, così "solo da" o "solo a" funzionano comunque.
                if (rangeFrom) {
                    const start = new Date(rangeFrom); start.setHours(0, 0, 0, 0)
                    query = query.gte('pickup_date', start.toISOString())
                }
                if (rangeTo) {
                    const end = new Date(rangeTo); end.setHours(23, 59, 59, 999)
                    query = query.lte('pickup_date', end.toISOString())
                }
            }

            const { data: rawBookings, error } = await query

            if (error) throw error

            // Filter out car wash, mechanical, and Hummer experience bookings — only rental bookings go to CARGOS
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rentalBookings = (rawBookings || []).filter((b: any) => {
                if (b.service_type && b.service_type !== '' && b.service_type !== 'car_rental') return false
                if ((b.vehicle_name || '').toLowerCase().includes('hummer')) return false
                // 2026-06-02: NON mostrare nella lista "da inviare" quelle già
                // trasmesse alla Polizia di Stato — altrimenti il conteggio non
                // cala mai e, peggio, ri-selezionandole si rischia un invio
                // DUPLICATO. (cargos_sent viene messo a true solo su invio riuscito.)
                if (b.booking_details?.cargos_sent === true) return false
                // 2026-08-20 (richiesta direzione): righe tolte a mano dalla lista.
                // NON si cancella la prenotazione — sarebbe un noleggio vero che
                // sparisce dal gestionale: si marca solo "non da trasmettere",
                // cosi' smette di comparire qui e di falsare il conteggio.
                if (b.booking_details?.cargos_escluso === true) return false
                return true
            })

            if (rentalBookings.length === 0) {
                toast(viewMode === 'date' ? 'Nessuna prenotazione noleggio per questa data' : 'Nessuna prenotazione noleggio trovata', { icon: 'ℹ️' })
                setLoading(false)
                return
            }

            // Enrich with customer data
            const enriched: BookingForCargos[] = await Promise.all(
                rentalBookings.map(async (b) => {
                    let customerData: CustomerExtended | null = null
                    // Try by user_id first (user_id links to auth.users.id)
                    if (b.user_id) {
                        const { data: c } = await supabase
                            .from('customers_extended')
                            .select('*')
                            .eq('user_id', b.user_id)
                            .maybeSingle()
                        if (c) customerData = c
                    }
                    // Fallback: by customer_id from booking_details (only if UUID format)
                    const custId = b.booking_details?.customer?.customerId
                    const isUuid = custId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(custId)
                    if (!customerData && isUuid) {
                        const { data: c } = await supabase
                            .from('customers_extended')
                            .select('*')
                            .eq('id', custId)
                            .maybeSingle()
                        if (c) customerData = c
                    }
                    // Fallback: by email (from customerId if it's an email, or from customer_email)
                    const emailToTry = (!isUuid && custId?.includes('@') ? custId : null) || b.customer_email
                    if (!customerData && emailToTry) {
                        const { data: c } = await supabase
                            .from('customers_extended')
                            .select('*')
                            .eq('email', emailToTry)
                            .maybeSingle()
                        if (c) customerData = c
                    }
                    // Resolve plate from vehicles table if missing
                    let resolvedPlate = b.vehicle_plate || b.booking_details?.vehicle_plate || b.booking_details?.vehicle?.plate || ''
                    if (!resolvedPlate && (b.vehicle_id || b.booking_details?.vehicle_id || b.vehicle_name)) {
                        const vId = b.vehicle_id || b.booking_details?.vehicle_id
                        let vQuery = supabase.from('vehicles').select('plate').limit(1)
                        if (vId) {
                            vQuery = vQuery.eq('id', vId)
                        } else if (b.vehicle_name) {
                            vQuery = vQuery.eq('display_name', b.vehicle_name)
                        }
                        const { data: veh } = await vQuery.maybeSingle()
                        if (veh?.plate) resolvedPlate = veh.plate
                    }

                    logger.log(`[CARGOS] Booking ${b.id.substring(0,8)}: user_id=${b.user_id}, customerId=${b.booking_details?.customer?.customerId}, email=${b.customer_email}, found=${!!customerData}, plate=${resolvedPlate || 'MISSING'}`)
                    const alreadySent = b.booking_details?.cargos_sent === true
                    return { ...b, vehicle_plate: resolvedPlate || b.vehicle_plate, customerData, cargosStatus: alreadySent ? 'sent' as const : 'pending' as const }
                })
            )

            setBookings(enriched)
            // Auto-select all
            setSelectedIds(new Set(enriched.map(b => b.id)))

        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore caricamento: ' + _errMsg)
        } finally {
            setLoading(false)
        }
    }, [exportDate, viewMode, rangeFrom, rangeTo])

    // Auto-load bookings on mount and when filters change
    useEffect(() => {
        loadBookings()
    }, [loadBookings])

    // ── Send to CARGOS ───────────────────────────────────────────────────────

    async function handleSend() {
        console.log('[CARGOS] handleSend called, selectedIds:', selectedIds.size, 'bookings:', bookings.length)
        toast.loading('Preparazione invio CARGOS...', { id: 'cargos-send' })

        const selected = bookings.filter(b => selectedIds.has(b.id))
        if (selected.length === 0) {
            toast.error('Seleziona almeno una prenotazione', { id: 'cargos-send' })
            return
        }

        console.log('[CARGOS] Selected bookings:', selected.length)

        // 2026-06-02: invio NON più all-or-nothing. Prima un singolo record con
        // dati mancanti bloccava l'INTERO batch (es. 350 prenotazioni → nessuna
        // partiva). Ora separiamo i record validi da quelli incompleti: inviamo
        // i validi e segnaliamo in rosso quelli da correggere, senza bloccare tutto.
        const updatedBookings = [...bookings]
        const localValid: typeof selected = []
        let localInvalidCount = 0
        for (const b of selected) {
            const issues = validateBookingForCargos(b)
            const errors = issues.filter(i => i.severity === 'error')
            if (errors.length > 0) {
                const idx = updatedBookings.findIndex(ub => ub.id === b.id)
                if (idx >= 0) updatedBookings[idx] = { ...b, cargosStatus: 'error', cargosError: errors.map(e => e.message).join(', ') }
                localInvalidCount++
            } else {
                localValid.push(b)
            }
        }
        if (localInvalidCount > 0) setBookings(updatedBookings)

        if (localValid.length === 0) {
            toast.error('Tutti i record selezionati hanno dati mancanti. Correggi le righe in rosso.', { id: 'cargos-send' })
            return
        }

        setSending(true)
        setSendResult(null)
        toast.loading(`Invio ${localValid.length} contratti a CARGOS${localInvalidCount ? ` (${localInvalidCount} saltati per dati mancanti)` : ''}...`, { id: 'cargos-send' })

        try {
            // Aligned [booking, record] items so per-index API results map back
            // to the right booking (Check/Send return arrays in input order).
            const items = localValid.map(b => ({ b, record: buildCargosRecord(b) }))

            // 2026-06-02: CARGOS accetta MAX 100 righe per richiesta
            // ("Dimensione del blocco eccessiva - Numero Massimo di righe
            // consentito: 100"). Spezziamo Check+Send in blocchi da 100 e
            // processiamo ogni blocco in modo indipendente: un blocco che
            // fallisce non blocca gli altri.
            const CHUNK_SIZE = 100
            const sentOk: typeof items = []
            const failDetails: string[] = []
            const txIds: string[] = []

            const markError = (id: string, msg: string) =>
                setBookings(prev => prev.map(pb => pb.id === id ? { ...pb, cargosStatus: 'error' as const, cargosError: msg } : pb))
            const failChunk = (chunk: typeof items, msg: string) =>
                chunk.forEach(it => { failDetails.push(`${it.b.customer_name || it.b.id}: ${msg}`); markError(it.b.id, msg) })

            const totalChunks = Math.ceil(items.length / CHUNK_SIZE)
            for (let start = 0, ci = 1; start < items.length; start += CHUNK_SIZE, ci++) {
                const chunk = items.slice(start, start + CHUNK_SIZE)
                toast.loading(`Invio CARGOS — blocco ${ci}/${totalChunks} (${chunk.length} record)...`, { id: 'cargos-send' })

                // ── CHECK ──
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let checkData: any
                try {
                    const checkRes = await fetch('/.netlify/functions/cargos-api', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'check', records: chunk.map(i => i.record), password }),
                    })
                    checkData = await checkRes.json()
                } catch (e) {
                    failChunk(chunk, 'Errore rete Check: ' + (e instanceof Error ? e.message : String(e)))
                    continue
                }
                const checkTopErr = checkData?.error
                    || (checkData?.data && !Array.isArray(checkData.data) ? (checkData.data.error_description || checkData.data.error) : null)
                if (checkTopErr) { failChunk(chunk, 'Check: ' + checkTopErr); continue }
                const checkResults = Array.isArray(checkData?.data) ? checkData.data : (Array.isArray(checkData) ? checkData : [])
                if (checkResults.length === 0) { failChunk(chunk, 'Check risposta inattesa: ' + JSON.stringify(checkData).substring(0, 150)); continue }

                const passed: typeof items = []
                chunk.forEach((it, idx) => {
                    const r = checkResults[idx]
                    if (r && r.esito === false) {
                        const msg = r.errore?.error_description || r.errore?.error || (r.errore ? JSON.stringify(r.errore) : 'Errore validazione CARGOS')
                        failDetails.push(`${it.b.customer_name || it.b.id}: ${msg}`)
                        markError(it.b.id, msg)
                    } else {
                        passed.push(it)
                    }
                })
                if (passed.length === 0) continue

                // ── SEND (only records that passed Check in this block) ──
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let sendData: any
                try {
                    const sendRes = await fetch('/.netlify/functions/cargos-api', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'send', records: passed.map(i => i.record), password }),
                    })
                    sendData = await sendRes.json()
                } catch (e) {
                    failChunk(passed, 'Errore rete Send: ' + (e instanceof Error ? e.message : String(e)))
                    continue
                }
                const sendTopErr = sendData?.error
                    || (sendData?.data && !Array.isArray(sendData.data) ? (sendData.data.error_description || sendData.data.error) : null)
                if (sendTopErr) { failChunk(passed, 'Send: ' + sendTopErr); continue }
                const sendResults = Array.isArray(sendData?.data) ? sendData.data : (Array.isArray(sendData) ? sendData : [])
                if (sendResults.length === 0) { failChunk(passed, 'Send risposta inattesa: ' + JSON.stringify(sendData).substring(0, 150)); continue }

                passed.forEach((it, idx) => {
                    const r = sendResults[idx]
                    if (r && r.esito === true) {
                        sentOk.push(it)
                        if (r.transactionid) txIds.push(r.transactionid)
                    } else {
                        const msg = r?.errore?.error_description || r?.errore?.error || (r?.errore ? JSON.stringify(r.errore) : 'Errore invio CARGOS')
                        failDetails.push(`${it.b.customer_name || it.b.id}: ${msg}`)
                        markError(it.b.id, msg)
                    }
                })
            }

            // Persist + REMOVE the successful ones from the "to send" list so
            // the counter actually drops (e.g. 350 → 250 → …) and they can't be
            // re-sent (duplicate). Failed/skipped ones stay (red) for fixing.
            if (sentOk.length > 0) {
                const sentIds = new Set(sentOk.map(s => s.b.id))
                for (const it of sentOk) {
                    try {
                        await supabase
                            .from('bookings')
                            .update({
                                booking_details: {
                                    ...it.b.booking_details,
                                    cargos_sent: true,
                                    cargos_sent_at: new Date().toISOString(),
                                }
                            })
                            .eq('id', it.b.id)
                    } catch (e) {
                        console.error('[CARGOS] Failed to persist cargos_sent for', it.b.id, e)
                    }
                }
                setBookings(prev => prev.filter(pb => !sentIds.has(pb.id)))
                setSelectedIds(prev => {
                    const next = new Set(prev)
                    sentIds.forEach(id => next.delete(id))
                    return next
                })
            }

            const skipped = localInvalidCount + failDetails.length
            if (sentOk.length > 0) {
                toast.success(
                    `${sentOk.length} contratti inviati a CARGOS${skipped ? ` · ${skipped} da correggere (righe rosse)` : ''}. TX: ${txIds.slice(0, 5).join(', ') || 'OK'}${txIds.length > 5 ? '…' : ''}`,
                    { id: 'cargos-send', duration: 6000 }
                )
            } else {
                toast.error(`Nessun contratto inviato. ${failDetails.slice(0, 3).join('; ')}${failDetails.length > 3 ? ` (+${failDetails.length - 3})` : ''}`, { id: 'cargos-send', duration: 10000 })
            }
            setSendResult({
                success: sentOk.length,
                errors: skipped,
                details: failDetails.join('; ') || undefined,
            })
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error('[CARGOS] handleSend error:', err)
            toast.error('Errore invio CARGOS: ' + errMsg, { id: 'cargos-send', duration: 10000 })
            setSendResult({ success: 0, errors: selected.length, details: errMsg })
        } finally {
            setSending(false)
        }
    }

    // ── Check Only ───────────────────────────────────────────────────────────

    async function handleCheck() {
        const selected = bookings.filter(b => selectedIds.has(b.id))
        if (selected.length === 0) {
            toast.error('Seleziona almeno una prenotazione')
            return
        }

        setSending(true)
        try {
            const records = selected.map(b => buildCargosRecord(b))

            const res = await fetch('/.netlify/functions/cargos-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'check', records, password }),
            })
            const data = await res.json()
            console.log('[CARGOS] Check response:', JSON.stringify(data))

            if (data.error) {
                toast.error('Errori validazione: ' + data.error)
            } else {
                // Check per-record results
                const results = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const errors = results.filter((r: any) => r.esito === false)
                if (errors.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const errorDetails = errors.map((r: any) =>
                        r.errore?.error_description || r.errore?.error || 'Errore sconosciuto'
                    ).join('; ')
                    toast.error('Validazione fallita: ' + errorDetails, { duration: 8000 })
                } else {
                    toast.success('Validazione superata! I record sono pronti per l\'invio.')
                }
                setBookings(prev => prev.map(b =>
                    selectedIds.has(b.id) ? { ...b, cargosStatus: 'checking' as const } : b
                ))
            }
        } catch (err: unknown) {
          const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        } finally {
            setSending(false)
        }
    }

    // ── CSV/XML Export (fallback) ────────────────────────────────────────────

    function handleExportCSV() {
        const selected = bookings.filter(b => selectedIds.has(b.id))
        if (selected.length === 0) { toast.error('Seleziona almeno una prenotazione'); return }

        const headers = [
            'Contratto_ID', 'Data_Contratto', 'Tipo_Pagamento',
            'Data_Ritiro', 'Luogo_Ritiro', 'Indirizzo_Ritiro',
            'Data_Restituzione', 'Luogo_Restituzione', 'Indirizzo_Restituzione',
            'Agenzia_ID', 'Agenzia_Nome',
            'Tipo_Veicolo', 'Marca', 'Modello', 'Targa', 'Colore',
            'Cognome', 'Nome', 'Data_Nascita', 'Luogo_Nascita',
            'Patente', 'Documento_Tipo', 'Documento_Numero', 'Telefono'
        ]

        const rows = selected.map(b => {
            const c = b.customerData
            let surname = c?.cognome || ''
            let name = c?.nome || ''
            if (!surname && b.customer_name) {
                const parts = b.customer_name.trim().split(/\s+/)
                surname = parts[parts.length - 1] || ''
                name = parts.slice(0, -1).join(' ')
            }
            return [
                b.id.substring(0, 8),
                formatDateCargos(b.pickup_date),
                getPaymentType(b),
                formatDateCargos(b.pickup_date),
                AGENCY.locationCode,
                `"${AGENCY.address}"`,
                formatDateCargos(b.dropoff_date),
                AGENCY.locationCode,
                `"${AGENCY.address}"`,
                AGENCY.id,
                AGENCY.name,
                guessVehicleType(b.vehicle_name || ''),
                guessVehicleBrand(b.vehicle_name || ''),
                `"${guessVehicleModel(b.vehicle_name || '')}"`,
                b.vehicle_plate || '',
                '',
                surname.toUpperCase(),
                name.toUpperCase(),
                formatDateOnlyCargos(c?.data_nascita || ''),
                c?.luogo_nascita || '',
                c?.numero_patente || c?.patente_numero || '',
                c?.documento_tipo || 'CI',
                c?.documento_numero || c?.numero_documento_rappresentante || c?.numero_patente || c?.patente_numero || '',
                c?.telefono || b.customer_phone || ''
            ].join(',')
        })

        const csv = [headers.join(','), ...rows].join('\n')
        downloadFile(csv, `cargos_export_${exportDate}.csv`, 'text/csv')
        toast.success('CSV scaricato')
    }

    function handleExportXML() {
        const selected = bookings.filter(b => selectedIds.has(b.id))
        if (selected.length === 0) { toast.error('Seleziona almeno una prenotazione'); return }

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<CargosExport date="' + exportDate + '">\n'

        selected.forEach(b => {
            const c = b.customerData
            let surname = c?.cognome || ''
            let name = c?.nome || ''
            if (!surname && b.customer_name) {
                const parts = b.customer_name.trim().split(/\s+/)
                surname = parts[parts.length - 1] || ''
                name = parts.slice(0, -1).join(' ')
            }

            xml += `  <Contratto id="${b.id.substring(0, 8)}">\n`
            xml += `    <DataContratto>${formatDateCargos(b.pickup_date)}</DataContratto>\n`
            xml += `    <Ritiro data="${formatDateCargos(b.pickup_date)}" luogo="${AGENCY.locationCode}" indirizzo="${AGENCY.address}"/>\n`
            xml += `    <Restituzione data="${formatDateCargos(b.dropoff_date)}" luogo="${AGENCY.locationCode}" indirizzo="${AGENCY.address}"/>\n`
            xml += `    <Agenzia id="${AGENCY.id}" nome="${AGENCY.name}" indirizzo="${AGENCY.address}" tel="${AGENCY.phone}"/>\n`
            xml += `    <Veicolo tipo="${guessVehicleType(b.vehicle_name || '')}" marca="${guessVehicleBrand(b.vehicle_name || '')}" modello="${guessVehicleModel(b.vehicle_name || '')}" targa="${b.vehicle_plate || ''}"/>\n`
            xml += `    <Conducente cognome="${surname.toUpperCase()}" nome="${name.toUpperCase()}" nascita="${formatDateOnlyCargos(c?.data_nascita || '')}" luogoNascita="${c?.luogo_nascita || ''}" patente="${c?.numero_patente || c?.patente_numero || ''}" documento="${c?.documento_numero || c?.numero_documento_rappresentante || c?.numero_patente || c?.patente_numero || ''}" tel="${c?.telefono || b.customer_phone || ''}"/>\n`
            xml += `  </Contratto>\n`
        })

        xml += '</CargosExport>'
        downloadFile(xml, `cargos_export_${exportDate}.xml`, 'application/xml')
        toast.success('XML scaricato')
    }

    function downloadFile(content: string, fileName: string, contentType: string) {
        const a = document.createElement('a')
        const file = new Blob([content], { type: contentType })
        a.href = URL.createObjectURL(file)
        a.download = fileName
        a.click()
    }

    // ── Toggle selection ─────────────────────────────────────────────────────

    function toggleSelection(id: string) {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function toggleAll() {
        if (selectedIds.size === bookings.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(bookings.map(b => b.id)))
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-4 lg:space-y-6">
            {/* Header */}
            <div className="bg-theme-bg-secondary rounded-lg p-3 lg:p-4 border border-theme-border">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Cargos</h2>
                        <p className="text-sm text-theme-text-muted mt-0.5">
                            Invio telematico contratti — Polizia di Stato
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-theme-bg-tertiary rounded-lg border border-theme-border overflow-hidden">
                            <button
                                onClick={() => setActiveSubTab('send')}
                                className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'send' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                            >
                                Invio Contratti
                            </button>
                            <button
                                onClick={() => setActiveSubTab('export')}
                                className={`px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === 'export' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                            >
                                Scarica File
                            </button>
                        </div>

                        {/* Connection status dot */}
                        <div className={`w-2.5 h-2.5 rounded-full ${isAuthenticated ? 'bg-green-500' : 'bg-red-500'}`} title={isAuthenticated ? 'Connesso' : 'Non connesso'} />

                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="p-2 bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary rounded-lg border border-theme-border transition-colors"
                            title="Impostazioni API"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </button>

                        <a
                            href="https://cargos.poliziadistato.it/Cargos_Portale/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary font-medium rounded-lg hover:bg-theme-bg-hover transition-colors flex items-center gap-2 text-sm border border-theme-border"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            Portale Cargos
                        </a>
                    </div>
                </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
                <div className="bg-theme-bg-secondary border border-theme-border p-5 rounded-lg animate-fadeIn">
                    <div className="flex justify-between items-center mb-4 pb-3 border-b border-theme-border">
                        <h3 className="text-base font-bold text-theme-text-primary">Configurazione API Cargos</h3>
                        <button onClick={() => setShowSettings(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Nome Utente</label>
                            <div className="px-3 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-sm text-theme-text-primary font-mono">
                                C00006117
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Password</label>
                            <Input
                                type="password"
                                value={password}
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                onChange={(e: any) => setPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-theme-text-muted mb-1">Agenzia</label>
                            <div className="px-3 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-sm text-theme-text-primary">
                                RENTORA — Cagliari
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end mt-4 gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => { setPassword(''); sessionStorage.removeItem('cargos_session'); setIsAuthenticated(false); toast.success('Credenziali rimosse') }}
                        >
                            Reset
                        </Button>
                        <Button
                            onClick={testConnection}
                            className="bg-green-600 hover:bg-green-500"
                            disabled={authLoading}
                        >
                            {authLoading ? (
                                <span className="flex items-center gap-2">
                                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                    Connessione...
                                </span>
                            ) : 'Testa Connessione'}
                        </Button>
                    </div>
                </div>
            )}

            {/* Not authenticated warning */}
            {!isAuthenticated && !showSettings && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm flex items-center gap-2">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                    Configurazione API mancante.
                    <button onClick={() => setShowSettings(true)} className="underline font-semibold hover:text-yellow-300">Configura</button>
                </div>
            )}

            {/* ── SEND TAB ─────────────────────────────────────────────────── */}
            {activeSubTab === 'send' && (
                <div className="space-y-4">
                    {/* View mode + Date selector + load */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button
                                onClick={() => setViewMode('all')}
                                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${viewMode === 'all' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                            >Tutte le prenotazioni</button>
                            <button
                                onClick={() => setViewMode('date')}
                                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${viewMode === 'date' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                            >Per data</button>
                            <button
                                onClick={() => setViewMode('range')}
                                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${viewMode === 'range' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                            >Per intervallo</button>
                        </div>
                        {viewMode === 'date' && <div className="flex flex-col sm:flex-row items-end gap-3">
                            <div className="flex-1">
                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Data Inizio Noleggio</label>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                <Input type="date" value={exportDate} onChange={(e: any) => setExportDate(e.target.value)} />
                            </div>
                        </div>}
                        {viewMode === 'range' && <div className="flex flex-col sm:flex-row items-end gap-3">
                            <div className="flex-1">
                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Dal (data inizio noleggio)</label>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                <Input type="date" value={rangeFrom} max={rangeTo || undefined} onChange={(e: any) => setRangeFrom(e.target.value)} />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Al</label>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                <Input type="date" value={rangeTo} min={rangeFrom || undefined} onChange={(e: any) => setRangeTo(e.target.value)} />
                            </div>
                            {(rangeFrom || rangeTo) && (
                                <button onClick={() => { setRangeFrom(''); setRangeTo('') }} className="px-3 py-2 text-xs text-theme-text-muted hover:text-theme-text-primary whitespace-nowrap">Azzera</button>
                            )}
                        </div>}
                    </div>

                    {/* Bookings table */}
                    {/* 2026-08-20: la configurazione avvisi sta FUORI dal blocco
                        "ci sono prenotazioni". Era dentro, quindi con la lista vuota
                        — cioe' proprio quando non e' partito niente e uno vuole
                        capire perche' — spariva anche il pannello per attivarli. */}
                        {/* Avvisi WhatsApp alla direzione — 2026-08-20 */}
                        <div className="px-4 pb-3">
                            <button
                                onClick={() => setAlertsOpen(o => !o)}
                                className="flex items-center gap-2 text-xs font-semibold text-theme-text-secondary hover:text-dr7-gold"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                                Avvisi WhatsApp direzione
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${alertsEnabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-zinc-500/15 text-zinc-500'}`}>
                                    {alertsEnabled ? `ATTIVI · ${alertNumbers.filter(n => n.trim()).length}` : 'DISATTIVI'}
                                </span>
                            </button>

                            {alertsOpen && (
                                <div className="mt-2 rounded-lg border border-theme-border bg-theme-bg-primary p-3 space-y-2 max-w-xl">
                                    <p className="text-[11px] text-theme-text-muted">
                                        Un messaggio parte quando una trasmissione a CARGOS <strong>fallisce</strong> o
                                        quando <strong>mancano i dati del cliente</strong> per farla. Include cliente,
                                        veicolo e motivo. Senza numeri non parte nulla.
                                    </p>

                                    <label className="flex items-center gap-2 text-xs text-theme-text-primary">
                                        <input type="checkbox" checked={alertsEnabled} onChange={e => setAlertsEnabled(e.target.checked)} className="rounded border-theme-border" />
                                        Avvisi attivi
                                    </label>

                                    {alertNumbers.map((n, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <input
                                                type="tel"
                                                value={n}
                                                onChange={e => setAlertNumbers(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                                                placeholder="es. 393472817258 (senza +)"
                                                className="flex-1 px-2 py-1.5 rounded-md bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs font-mono"
                                            />
                                            {alertNumbers.length > 1 && (
                                                <button
                                                    onClick={() => setAlertNumbers(prev => prev.filter((_, j) => j !== i))}
                                                    className="w-7 h-7 rounded-md border border-theme-border text-theme-text-muted hover:text-red-500"
                                                    title="Rimuovi numero"
                                                >×</button>
                                            )}
                                        </div>
                                    ))}

                                    <div className="flex items-center justify-between">
                                        <button
                                            onClick={() => setAlertNumbers(prev => [...prev, ''])}
                                            className="text-[11px] font-semibold text-dr7-gold hover:opacity-80"
                                        >+ Aggiungi numero</button>
                                        <Button onClick={salvaAvvisi} disabled={alertsSaving} className="text-xs">
                                            {alertsSaving ? 'Salvataggio…' : 'Salva avvisi'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>

                    {bookings.length > 0 && (
                        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
                            <div className="px-4 py-3 border-b border-theme-border flex flex-wrap justify-between items-center gap-2">
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.size === bookings.length}
                                            onChange={toggleAll}
                                            className="rounded border-theme-border"
                                        />
                                        <span className="text-sm text-theme-text-muted">
                                            {selectedIds.size}/{bookings.length} selezionati
                                        </span>
                                    </label>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={handleCheck}
                                        disabled={sending || selectedIds.size === 0}
                                        className="text-sm"
                                    >
                                        Valida
                                    </Button>
                                    <Button
                                        onClick={handleSend}
                                        disabled={sending || selectedIds.size === 0}
                                        className="bg-green-600 hover:bg-green-500 text-sm flex items-center gap-2"
                                    >
                                        {sending ? (
                                            <>
                                                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                                Invio in corso...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                                Invia a Cargos ({selectedIds.size})
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-theme-bg-tertiary/50">
                                            <th className="px-3 py-2 text-left w-10"></th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Conducente</th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Veicolo</th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Targa</th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Ritiro</th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Restituzione</th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Patente</th>
                                            <th className="px-3 py-2 text-left text-xs text-theme-text-muted uppercase">Stato</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-theme-border">
                                        {bookings.map(b => {
                                            const issues = validateBookingForCargos(b)
                                            const hasError = issues.some(i => i.severity === 'error')
                                            const hasWarning = issues.some(i => i.severity === 'warning')

                                            return (
                                                <tr key={b.id} className={`hover:bg-theme-bg-hover/50 transition-colors ${hasError ? 'bg-red-500/5' : ''}`}>
                                                    <td className="px-3 py-2.5">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedIds.has(b.id)}
                                                            onChange={() => toggleSelection(b.id)}
                                                            className="rounded border-theme-border"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="font-medium text-theme-text-primary">
                                                            {b.customerData?.cognome && b.customerData?.nome
                                                                ? `${b.customerData.cognome} ${b.customerData.nome}`
                                                                : b.customer_name || 'ND000000000'}
                                                        </div>
                                                        <div className="text-xs text-theme-text-muted">{b.customer_phone || ''}</div>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-theme-text-primary">{b.vehicle_name}</td>
                                                    <td className="px-3 py-2.5 font-mono text-theme-text-primary">{b.vehicle_plate || b.booking_details?.vehicle_plate || '—'}</td>
                                                    <td className="px-3 py-2.5 text-theme-text-muted text-xs">
                                                        {new Date(b.pickup_date).toLocaleDateString('it-IT')}<br />
                                                        {new Date(b.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-theme-text-muted text-xs">
                                                        {new Date(b.dropoff_date).toLocaleDateString('it-IT')}<br />
                                                        {new Date(b.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="px-3 py-2.5 font-mono text-xs">
                                                        {b.customerData?.numero_patente || b.customerData?.patente_numero || b.booking_details?.customer?.licenseNumber || b.booking_details?.customer?.driverLicense || (
                                                            b.customerData?.tipo_cliente === 'azienda'
                                                                ? <span className="text-theme-text-muted">Azienda</span>
                                                                : (
                                                                    <button
                                                                        onClick={() => apriSchedaCliente(b)}
                                                                        title="Apri la scheda cliente e completa i dati"
                                                                        className="text-yellow-500 underline decoration-dotted hover:text-yellow-400"
                                                                    >Mancante</button>
                                                                )
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        {/* 2026-08-20: toglie la riga dall'elenco CARGOS. NON cancella
                                                            la prenotazione: e' un noleggio vero, sparirebbe dal
                                                            gestionale. Marca solo "non da trasmettere". */}
                                                        <button
                                                            onClick={() => escludiRiga(b)}
                                                            disabled={escludendo === b.id}
                                                            title="Togli questa riga dall'elenco CARGOS (non cancella la prenotazione)"
                                                            aria-label="Togli dall'elenco CARGOS"
                                                            className="float-right ml-2 text-theme-text-muted hover:text-red-500 disabled:opacity-40"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                        {b.cargosStatus === 'sent' && (
                                                            <div className="flex items-center gap-2">
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-xs font-bold">
                                                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                                    Inviato
                                                                </span>
                                                                <button
                                                                    onClick={() => setBookings(prev => prev.map(bk => bk.id === b.id ? { ...bk, cargosStatus: 'pending' as const } : bk))}
                                                                    className="text-[10px] text-theme-text-muted hover:text-dr7-gold underline"
                                                                >
                                                                    Re-invia
                                                                </button>
                                                            </div>
                                                        )}
                                                        {b.cargosStatus === 'checking' && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-xs font-bold">
                                                                Validato
                                                            </span>
                                                        )}
                                                        {b.cargosStatus === 'error' && (
                                                            <div>
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
                                                                    Errore
                                                                </span>
                                                                {b.cargosError && (
                                                                    <p className="text-[10px] text-red-400 mt-1 max-w-[200px] break-words">{b.cargosError}</p>
                                                                )}
                                                            </div>
                                                        )}
                                                        {b.cargosStatus === 'pending' && hasError && (
                                                            <div>
                                                                <button
                                                                    onClick={() => apriSchedaCliente(b)}
                                                                    title="Apri la scheda cliente e completa i dati mancanti"
                                                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs hover:bg-red-500/20"
                                                                >
                                                                    Dati incompleti — completa
                                                                </button>
                                                                <ul className="text-[10px] text-red-400 mt-1 list-disc list-inside">
                                                                    {issues.filter(i => i.severity === 'error').map((i, idx) => (
                                                                        <li key={idx}>{i.message}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {b.cargosStatus === 'pending' && !hasError && hasWarning && (
                                                            <div>
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-xs">
                                                                    Pronto (avvisi)
                                                                </span>
                                                                <ul className="text-[10px] text-yellow-400/70 mt-1 list-disc list-inside">
                                                                    {issues.filter(i => i.severity === 'warning').map((i, idx) => (
                                                                        <li key={idx}>{i.field}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {b.cargosStatus === 'pending' && !hasError && !hasWarning && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-muted text-xs">
                                                                Pronto
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Send result */}
                            {sendResult && (
                                <div className={`mx-4 mb-4 p-3 border rounded-lg text-sm ${
                                    sendResult.errors > 0
                                        ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                        : 'bg-green-500/10 border-green-500/30 text-green-400'
                                }`}>
                                    {sendResult.errors > 0 ? (
                                        <>Errore invio: {sendResult.details}</>
                                    ) : (
                                        <>{sendResult.success} contratti inviati con successo a Polizia di Stato</>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty state */}
                    {bookings.length === 0 && !loading && (
                        <div className="h-64 flex flex-col items-center justify-center bg-theme-bg-secondary rounded-lg border border-theme-border border-dashed text-theme-text-muted">
                            <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                            <p className="text-base font-medium">Seleziona una data e carica le prenotazioni</p>
                            <p className="text-sm mt-1 opacity-60">I dati verranno formattati e inviati al portale CARGOS</p>
                        </div>
                    )}
                </div>
            )}


            {/* ── EXPORT TAB ───────────────────────────────────────────────── */}
            {activeSubTab === 'export' && (
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-5">
                        <h3 className="text-base font-bold text-theme-text-primary mb-1">Scarica File</h3>
                        <p className="text-xs text-theme-text-muted mb-4">Esporta i dati per upload manuale sul portale CARGOS</p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5 uppercase tracking-wider">Data Inizio Noleggio</label>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                <Input type="date" value={exportDate} onChange={(e: any) => setExportDate(e.target.value)} />
                            </div>

                            {bookings.length > 0 && (
                                <div className="space-y-3">
                                    <p className="text-sm text-theme-text-muted">
                                        {bookings.length} prenotazioni trovate — {selectedIds.size} selezionate per export
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Button onClick={handleExportCSV} variant="secondary" className="w-full flex justify-center items-center gap-1.5">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                            CSV
                                        </Button>
                                        <Button onClick={handleExportXML} variant="secondary" className="w-full flex justify-center items-center gap-1.5">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                            XML
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
                    {/* Scheda cliente aperta da una riga CARGOS: e' la STESSA di Clienti,
                quindi quel che scrivi finisce in customers_extended. Alla chiusura
                si ricarica l'elenco: la riga si aggiorna da sola. */}
            {clienteDaCompletare && (
                <NewClientModal
                    isOpen
                    initialData={clienteDaCompletare}
                    onClose={() => { setClienteDaCompletare(null); loadBookings() }}
                    onClientCreated={() => { setClienteDaCompletare(null); loadBookings() }}
                />
            )}
</div>
    )
}
