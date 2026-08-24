import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import nodemailer from 'nodemailer'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// PEC SMTP configuration — Aruba Legalmail
const PEC_HOST = 'sendm.cert.legalmail.it'
const PEC_PORT = 465
const PEC_USER = process.env.PEC_USER || 'Dubai.rent7.0srl@legalmail.it'
const PEC_PASSWORD = process.env.PEC_PASSWORD || ''
const PEC_FROM = 'Dubai.rent7.0srl@legalmail.it'
const PEC_TO_DEFAULT = 'poliziamunicipale@comune.cagliari.legalmail.it'

interface MultaData {
    targa?: string
    data_infrazione?: string   // DD/MM/YYYY
    ora_infrazione?: string    // HH:MM
    numero_verbale?: string
    importo?: string
    luogo_infrazione?: string
    tipo_violazione?: string
    articolo?: string
    // Organo accertatore (per destinatario PEC dinamico)
    ente_denominazione?: string | null
    ente_tipo?: string | null
    comune?: string | null
    provincia?: string | null
    pec_indicata_nel_verbale?: string | null
    raw_text?: string
}

// Destinatario PEC proposto dal matching contro la rubrica enti_notificatori.
interface PecRecipient {
    pec: string | null
    ente_id: string | null
    denominazione: string | null
    source: 'verbale' | 'rubrica' | 'nessuno'
    confidence: number         // 0..1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candidates: any[]          // top match alternativi (per confidenza media)
}

interface DriverData {
    booking_id: string
    user_id?: string
    customer_name: string
    customer_email: string
    customer_phone: string
    cognome: string
    nome: string
    codice_fiscale?: string
    data_nascita?: string
    luogo_nascita?: string
    indirizzo?: string
    citta?: string
    provincia?: string
    cap?: string
    patente_numero?: string
    vehicle_name: string
    vehicle_plate: string
    pickup_date: string
    dropoff_date: string
    contract_url?: string
    license_urls?: string[]
    id_urls?: string[]
}

// ── Extract multa data from PDF using Claude ─────────────────────────────────

async function extractMultaData(pdfBase64: string): Promise<MultaData> {
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
            role: 'user',
            content: [
                {
                    type: 'document',
                    source: {
                        type: 'base64',
                        media_type: 'application/pdf',
                        data: pdfBase64,
                    },
                },
                {
                    type: 'text',
                    text: `Estrai i seguenti dati da questo verbale/multa stradale italiano.
Rispondi SOLO con un oggetto JSON valido, senza commenti o markdown.

Campi da estrarre:
- targa: targa del veicolo (es: "KNC9339")
- data_infrazione: data dell'infrazione in formato DD/MM/YYYY (es: "15/03/2026")
- ora_infrazione: ora dell'infrazione in formato HH:MM (es: "14:30")
- numero_verbale: numero del verbale/protocollo
- importo: importo della multa in euro (es: "87.00")
- luogo_infrazione: luogo/via dell'infrazione
- tipo_violazione: breve descrizione della violazione
- articolo: articolo del CdS violato (es: "Art. 142 comma 8")
- ente_denominazione: nome COMPLETO dell'organo accertatore che ha emesso il verbale (es: "Comando Polizia Locale di Olbia", "Polizia Stradale - Sezione di Sassari", "Comando Provinciale Carabinieri di Nuoro"). NON inventare: prendilo dall'intestazione/timbro del verbale.
- ente_tipo: uno tra polizia_locale | polizia_stradale | carabinieri | gdf | polizia_provinciale | concessionaria | altro
- comune: comune dell'organo accertatore (es: "Olbia")
- provincia: sigla provincia dell'organo accertatore (es: "SS")
- pec_indicata_nel_verbale: indirizzo PEC dell'organo accertatore SE stampato nel verbale (molti verbali la riportano per la comunicazione dati conducente), altrimenti null. Deve essere un indirizzo di posta certificata (pec.*, *.pec.it, legalmail.it, postecert.it...).

Se un campo non è leggibile, usa null.
Rispondi SOLO con il JSON.`
                }
            ]
        }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    // Parse JSON from response, handling potential markdown wrapping
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Impossibile estrarre dati dal PDF')
    return JSON.parse(jsonMatch[0])
}

// ── Matching organo accertatore → destinatario PEC ──────────────────────────
// Priorita' (spec FASE 5): PEC nel verbale (0.95) > match esatto denom+comune
// (0.90) > fuzzy denom+comune (=similarita') > nessuno (0). Se il verbale
// riporta una PEC non in rubrica, la proponiamo comunque (source 'verbale').
function normalizeDenom(s: string): string {
    return (s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')       // via accenti
        .replace(/\b(comando|corpo|sezione|distaccamento|di|del|della|dei|delle|the)\b/g, ' ')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ').trim()
}
function isPecDomain(email: string): boolean {
    const e = (email || '').toLowerCase()
    return /@(pec\.|.*\.pec\.it|.*legalmail\.it|.*postecert\.it|.*sicurezzapostale\.it|.*pec\.aruba\.it|.*cert\.legalmail\.it)/.test(e)
        || /pec/.test(e.split('@')[1] || '')
}
async function matchEnte(multa: MultaData): Promise<PecRecipient> {
    const empty: PecRecipient = { pec: null, ente_id: null, denominazione: null, source: 'nessuno', confidence: 0, candidates: [] }

    // 1) PEC stampata nel verbale → fonte piu' affidabile.
    const pecVerbale = (multa.pec_indicata_nel_verbale || '').trim()
    if (pecVerbale && /\S+@\S+\.\S+/.test(pecVerbale)) {
        // esiste gia' in rubrica? (per collegare ente_id)
        const { data: existing } = await supabase
            .from('enti_notificatori').select('id, denominazione')
            .ilike('pec', pecVerbale).eq('attivo', true).limit(1)
        return {
            pec: pecVerbale.toLowerCase(),
            ente_id: existing?.[0]?.id || null,
            denominazione: existing?.[0]?.denominazione || multa.ente_denominazione || null,
            source: 'verbale', confidence: 0.95, candidates: [],
        }
    }

    const denom = (multa.ente_denominazione || '').trim()
    const comune = (multa.comune || '').trim()
    if (!denom && !comune) return empty

    // 2) match esatto denominazione + comune.
    if (denom && comune) {
        const { data: exact } = await supabase
            .from('enti_notificatori').select('id, denominazione, pec, comune, provincia')
            .ilike('denominazione', denom).ilike('comune', comune).eq('attivo', true).limit(1)
        if (exact?.[0]) {
            return { pec: exact[0].pec, ente_id: exact[0].id, denominazione: exact[0].denominazione, source: 'rubrica', confidence: 0.90, candidates: [] }
        }
    }

    // 3) fuzzy: candidati per comune (o provincia), poi similarita' sulla denominazione.
    let query = supabase.from('enti_notificatori').select('id, denominazione, pec, comune, provincia').eq('attivo', true)
    if (comune) query = query.ilike('comune', comune)
    else if (multa.provincia) query = query.ilike('provincia', multa.provincia)
    const { data: pool } = await query.limit(50)
    const nd = normalizeDenom(denom)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scored = (pool || []).map((e: any) => {
        const ne = normalizeDenom(e.denominazione)
        // Dice/trigram-ish: quota di token in comune.
        const a = new Set(nd.split(' ').filter(Boolean))
        const b = new Set(ne.split(' ').filter(Boolean))
        const inter = [...a].filter(t => b.has(t)).length
        const sim = a.size + b.size > 0 ? (2 * inter) / (a.size + b.size) : 0
        return { ...e, confidence: Math.round(sim * 1000) / 1000 }
    }).sort((x, y) => y.confidence - x.confidence)

    if (scored.length && scored[0].confidence >= 0.5) {
        const top = scored[0]
        return { pec: top.pec, ente_id: top.id, denominazione: top.denominazione, source: 'rubrica', confidence: top.confidence, candidates: scored.slice(0, 3) }
    }
    // Confidenza bassa: proponi comunque i 3 candidati per la scelta manuale.
    return { ...empty, candidates: scored.slice(0, 3) }
}

// ── Find driver from booking ─────────────────────────────────────────────────

async function findDriver(targa: string, dataInfrazione: string, oraInfrazione: string): Promise<DriverData | null> {
    // Parse date from DD/MM/YYYY. L'ora sul verbale e' ora italiana: la
    // convertiamo a UTC con l'offset reale di Europe/Rome in quella data
    // (+2 legale / +1 solare). Prima si usava new Date('YYYY-MM-DDTHH:MM:00')
    // che su Netlify (server in UTC) interpretava l'orario come UTC e
    // spostava l'istante di 1-2 ore: bastava a far cadere fuori intervallo
    // le multe prese vicino al ritiro o alla riconsegna.
    const [dd, mm, yyyy] = dataInfrazione.split('/')
    const timeStr = oraInfrazione || '12:00'
    const romeOffsetMs = (isoLocal: string): number => {
        const asUtc = Date.parse(`${isoLocal}Z`)
        if (isNaN(asUtc)) return 0
        // Formatta quell'istante a Roma e ricalcola la differenza.
        const romeStr = new Date(asUtc).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' })
        return Date.parse(`${romeStr.replace(' ', 'T')}Z`) - asUtc
    }
    const localIso = `${yyyy}-${mm}-${dd}T${timeStr}:00`
    const searchMs = Date.parse(`${localIso}Z`) - romeOffsetMs(localIso)
    const isoSearch = new Date(searchMs).toISOString()

    // Finestra di ricerca: TUTTO il giorno dell'infrazione (ora italiana).
    // Il match esatto sull'istante resta preferito, ma la query non lo impone
    // piu': una multa presa la mattina del giorno di ritiro (o dopo l'orario
    // di riconsegna, con l'auto ancora dal cliente) non trovava alcun
    // noleggio e la funzione rispondeva "Nessun noleggio trovato".
    const dayStartIso = new Date(Date.parse(`${yyyy}-${mm}-${dd}T00:00:00Z`) - romeOffsetMs(`${yyyy}-${mm}-${dd}T00:00:00`)).toISOString()
    const dayEndIso = new Date(Date.parse(`${yyyy}-${mm}-${dd}T23:59:59Z`) - romeOffsetMs(`${yyyy}-${mm}-${dd}T23:59:59`)).toISOString()

    const { data: bookings, error } = await supabase
        .from('bookings')
        .select(`
            id, pickup_date, dropoff_date, customer_name, customer_email,
            customer_phone, vehicle_name, vehicle_plate, booking_details, user_id, contract_url
        `)
        .lte('pickup_date', dayEndIso)
        .gte('dropoff_date', dayStartIso)
        .not('status', 'in', '(cancelled,annullata)')

    if (error || !bookings || bookings.length === 0) return null

    // Match by plate
    const normalize = (s: string) => s?.replace(/\s/g, '').toUpperCase() || ''
    const targetPlate = normalize(targa)

    const plateMatches = bookings.filter(b => {
        const bPlate = normalize(b.vehicle_plate || b.booking_details?.vehicle_plate || '')
        return !!bPlate && (bPlate === targetPlate || bPlate.includes(targetPlate))
    })

    if (plateMatches.length === 0) return null

    // Priorita': il noleggio che contiene davvero l'istante dell'infrazione.
    // Altrimenti (multa presa nel giorno ma fuori dall'orario registrato) si
    // prende quello con l'intervallo piu' vicino all'istante.
    const contains = plateMatches.find(b => {
        const p = Date.parse(b.pickup_date)
        const d = Date.parse(b.dropoff_date)
        return !isNaN(p) && !isNaN(d) && p <= searchMs && searchMs <= d
    })
    const match = contains || plateMatches.slice().sort((a, b) => {
        const dist = (bk: typeof a) => {
            const p = Date.parse(bk.pickup_date)
            const d = Date.parse(bk.dropoff_date)
            if (isNaN(p) || isNaN(d)) return Number.MAX_SAFE_INTEGER
            if (searchMs < p) return p - searchMs
            if (searchMs > d) return searchMs - d
            return 0
        }
        return dist(a) - dist(b)
    })[0]

    if (!match) return null

    // Enrich with customer_extended data
    let cognome = ''
    let nome = ''
    let codiceFiscale = ''
    let dataNascita = ''
    let luogoNascita = ''
    let indirizzo = ''
    let citta = ''
    let provincia = ''
    let cap = ''
    let patenteNumero = ''

    // Try to find customer in customers_extended: first by user_id, then by email
    let customerExtendedId = '' // The actual ID in customers_extended (used for storage lookups)

    const applyCustomerData = (c: any) => {
        customerExtendedId = c.id || ''
        cognome = c.cognome || ''
        nome = c.nome || ''
        codiceFiscale = c.codice_fiscale || ''
        dataNascita = c.data_nascita || ''
        luogoNascita = c.luogo_nascita || ''
        indirizzo = c.indirizzo || ''
        citta = c.citta || ''
        provincia = c.provincia || ''
        cap = c.cap || c.codice_postale || ''
        patenteNumero = c.numero_patente || c.patente || ''
    }

    if (match.user_id) {
        const { data: c } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('id', match.user_id)
            .maybeSingle()
        if (c) applyCustomerData(c)
    }

    // Fallback: search by email if user_id didn't work
    if (!customerExtendedId && match.customer_email) {
        const { data: c } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('email', match.customer_email)
            .maybeSingle()
        if (c) applyCustomerData(c)
    }

    // Fallback name splitting
    if (!cognome && match.customer_name) {
        const parts = match.customer_name.trim().split(/\s+/)
        cognome = parts[parts.length - 1] || ''
        nome = parts.slice(0, -1).join(' ')
    }

    // Fetch contract PDF URL — check multiple sources
    let contractUrl = ''

    // 1. Check contracts DB table (signed first, then unsigned)
    const { data: contractData } = await supabase
        .from('contracts')
        .select('signed_pdf_url, pdf_url')
        .eq('booking_id', match.id)
        .maybeSingle()
    if (contractData) {
        contractUrl = contractData.signed_pdf_url || contractData.pdf_url || ''
    }

    // 2. Fallback: check booking.contract_url
    if (!contractUrl && match.contract_url) {
        contractUrl = match.contract_url
    }

    // 3. Fallback: search contracts storage bucket for files matching customer name
    //    Contracts are named like contratto_Patrizio.pdf or contratto_Campagnola.pdf
    if (!contractUrl) {
        const nameParts = (match.customer_name || '').trim().split(/\s+/).filter(Boolean)
        // Also include nome/cognome from customers_extended
        if (nome && !nameParts.includes(nome)) nameParts.push(nome)
        if (cognome && !nameParts.includes(cognome)) nameParts.push(cognome)

        if (nameParts.length > 0) {
            for (const folder of ['filled', 'signed', '']) {
                const { data: files } = await supabase.storage
                    .from('contracts')
                    .list(folder || undefined, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
                if (files) {
                    const contractFile = files.find(f => {
                        if (!f.name.endsWith('.pdf')) return false
                        const lower = f.name.toLowerCase()
                        return nameParts.some(part => lower.includes(part.toLowerCase()))
                    })
                    if (contractFile) {
                        const path = folder ? `${folder}/${contractFile.name}` : contractFile.name
                        const { data: signed } = await supabase.storage
                            .from('contracts')
                            .createSignedUrl(path, 86400)
                        if (signed?.signedUrl) contractUrl = signed.signedUrl
                        break
                    }
                }
            }
        }
    }
    console.log(`[process-multa] Contract lookup: contractUrl=${contractUrl ? 'found' : 'not found'}`)

    // Fetch customer documents (driver license, ID) from storage
    const licenseUrls: string[] = []
    const idUrls: string[] = []

    // Storage folder = customers_extended.id (same ID used by admin upload)
    // Try: customerExtendedId first, then booking.user_id as fallback
    const storageUserId = customerExtendedId || match.user_id

    console.log(`[process-multa] Customer lookup: customerExtendedId=${customerExtendedId}, booking.user_id=${match.user_id}, storageUserId=${storageUserId}`)

    if (storageUserId) {
        const BUCKETS = [
            { name: 'driver-licenses', list: licenseUrls },
            { name: 'driver-ids', list: idUrls },
            { name: 'carta-identita', list: idUrls },
            { name: 'customer-documents', list: idUrls },
        ]

        await Promise.all(BUCKETS.map(async ({ name, list }) => {
            const { data: files } = await supabase.storage
                .from(name)
                .list(storageUserId, { limit: 10, sortBy: { column: 'created_at', order: 'desc' } })

            if (files) {
                for (const file of files) {
                    if (!file.id || file.name.includes('.emptyFolderPlaceholder')) continue
                    const path = `${storageUserId}/${file.name}`
                    const { data: signed } = await supabase.storage
                        .from(name)
                        .createSignedUrl(path, 86400)
                    if (signed?.signedUrl) list.push(signed.signedUrl)
                }
            }
        }))
    }

    return {
        booking_id: match.id,
        user_id: match.user_id,
        customer_name: match.customer_name || `${nome} ${cognome}`.trim(),
        customer_email: match.customer_email,
        customer_phone: match.customer_phone,
        cognome,
        nome,
        codice_fiscale: codiceFiscale,
        data_nascita: dataNascita,
        luogo_nascita: luogoNascita,
        indirizzo,
        citta,
        provincia,
        cap,
        patente_numero: patenteNumero,
        vehicle_name: match.vehicle_name,
        vehicle_plate: match.vehicle_plate || targa,
        pickup_date: match.pickup_date,
        dropoff_date: match.dropoff_date,
        contract_url: contractUrl,
        license_urls: licenseUrls,
        id_urls: idUrls,
    }
}


/**
 * Intestazione della lettera "Comunicazione dati conducente" (24/08/2026).
 *
 * Prima erano scritti in duro nel testo: il destinatario ("Spett.le Polizia
 * Municipale di Cagliari" — sbagliato per ogni verbale che non venga da
 * Cagliari, figurarsi per una multa estera), l'indirizzo DR7, il telefono, la
 * PEC e il rappresentante legale. Ora arrivano da
 * `centralina_pro_config.config.multe_config` (Centralina Pro > Gestione Multe)
 * e possono essere sovrascritti sulla singola multa.
 */
export interface MulteConfig {
    ragione_sociale: string
    piva: string
    rappresentante_legale: string
    indirizzo: string
    telefono: string
    pec_mittente: string
    /** Destinatario proposto quando il verbale non permette di dedurlo. */
    destinatario_default?: string
}

const MULTE_CONFIG_FALLBACK: MulteConfig = {
    ragione_sociale: 'DR7 S.p.A.',
    piva: '04104640927',
    rappresentante_legale: 'Campagnola Ilenia',
    indirizzo: 'Viale Marconi 229, Cagliari (CA)',
    telefono: '3472817258',
    pec_mittente: 'Dubai.rent7.0srl@legalmail.it',
}

async function loadMulteConfig(): Promise<MulteConfig> {
    try {
        const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        const cfg = ((data?.config as Record<string, unknown>) || {}).multe_config as Partial<MulteConfig> | undefined
        if (!cfg) return MULTE_CONFIG_FALLBACK
        return {
            ragione_sociale: cfg.ragione_sociale?.trim() || MULTE_CONFIG_FALLBACK.ragione_sociale,
            piva: cfg.piva?.trim() || MULTE_CONFIG_FALLBACK.piva,
            rappresentante_legale: cfg.rappresentante_legale?.trim() || MULTE_CONFIG_FALLBACK.rappresentante_legale,
            indirizzo: cfg.indirizzo?.trim() || MULTE_CONFIG_FALLBACK.indirizzo,
            telefono: cfg.telefono?.trim() || MULTE_CONFIG_FALLBACK.telefono,
            pec_mittente: cfg.pec_mittente?.trim() || MULTE_CONFIG_FALLBACK.pec_mittente,
            destinatario_default: cfg.destinatario_default?.trim() || undefined,
        }
    } catch (e) {
        console.error('[process-multa] loadMulteConfig failed, uso i valori storici:', e)
        return MULTE_CONFIG_FALLBACK
    }
}

// ── Generate communication letter ────────────────────────────────────────────

function generateLetterText(
    multa: MultaData,
    driver: DriverData,
    cfg: MulteConfig = MULTE_CONFIG_FALLBACK,
    /** Sovrascritture valide SOLO per questa multa (indirizzo diverso, ecc.). */
    override: Partial<MulteConfig> = {},
): string {
    const az: MulteConfig = { ...cfg, ...Object.fromEntries(Object.entries(override).filter(([, v]) => !!v)) } as MulteConfig
    // Destinatario: quello letto dal verbale. "Polizia Municipale di Cagliari"
    // era scritto in duro e finiva su OGNI lettera, anche di altri comuni.
    const destinatario = (multa as { ente_denominazione?: string }).ente_denominazione?.trim()
        || [((multa as { ente_tipo?: string }).ente_tipo || 'Organo accertatore'),
            (multa as { comune?: string }).comune ? `di ${(multa as { comune?: string }).comune}` : '']
           .filter(Boolean).join(' ')

    const today = new Date()
    const formattedToday = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`

    return `Spett.le ${destinatario}

Oggetto: Comunicazione dati conducente — Verbale n. ${multa.numero_verbale || 'N/D'} del ${multa.data_infrazione || 'N/D'}

Con la presente, la società ${az.ragione_sociale} (P.IVA ${az.piva}), in qualità di proprietaria del veicolo targato ${driver.vehicle_plate}, comunica che al momento dell'infrazione contestata con il verbale in oggetto, il veicolo era concesso a noleggio al seguente soggetto:

DATI DEL CONDUCENTE:
- Cognome: ${driver.cognome.toUpperCase() || 'N/D'}
- Nome: ${driver.nome.toUpperCase() || 'N/D'}
- Codice Fiscale: ${driver.codice_fiscale?.toUpperCase() || 'N/D'}
- Data di nascita: ${driver.data_nascita ? formatDateIT(driver.data_nascita) : 'N/D'}
- Luogo di nascita: ${driver.luogo_nascita || 'N/D'}
- Residenza: ${[driver.indirizzo, driver.cap, driver.citta, driver.provincia ? `(${driver.provincia})` : ''].filter(Boolean).join(' ') || 'N/D'}
- Patente n.: ${driver.patente_numero || 'N/D'}
- Telefono: ${driver.customer_phone || 'N/D'}

DATI DEL NOLEGGIO:
- Veicolo: ${driver.vehicle_name} — Targa: ${driver.vehicle_plate}
- Periodo noleggio: dal ${formatDateIT(driver.pickup_date)} al ${formatDateIT(driver.dropoff_date)}
- Contratto di noleggio: disponibile su richiesta

Si allegano alla presente:
- Copia del verbale ricevuto
- Copia della patente di guida del conducente
- Copia del contratto di noleggio

Distinti saluti,

${az.ragione_sociale}
Rappresentante Legale: ${az.rappresentante_legale}
${az.indirizzo}
Tel: ${az.telefono}
PEC: ${az.pec_mittente}

Cagliari, ${formattedToday}`
}

function formatDateIT(dateStr: string): string {
    if (!dateStr) return 'N/D'
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

// ── Send PEC ─────────────────────────────────────────────────────────────────

async function sendPEC(
    subject: string,
    body: string,
    attachments: Array<{ filename: string; content: Buffer; contentType: string }>,
    pecTo?: string,
    pecPassword?: string,
    pecCc?: string[]
): Promise<{ messageId: string; accepted: string[]; rejected: string[]; response: string }> {
    const pass = pecPassword || PEC_PASSWORD
    if (!pass) throw new Error('Password PEC non configurata. Aggiungi PEC_PASSWORD nelle variabili d\'ambiente Netlify.')

    // Regola non negoziabile: nessun destinatario hardcoded. Se il chiamante non
    // passa un destinatario esplicito, l'invio si blocca (mai all'indirizzo
    // sbagliato). PEC_TO_DEFAULT resta solo come costante legacy, non usata.
    const to = (pecTo || '').trim()
    if (!to || !/\S+@\S+\.\S+/.test(to)) {
        throw new Error('Destinatario PEC mancante: invio bloccato (nessun destinatario predefinito).')
    }

    const transporter = nodemailer.createTransport({
        host: PEC_HOST,
        port: PEC_PORT,
        secure: true, // SSL
        auth: {
            user: PEC_USER,
            pass: pass,
        },
    })

    const cc = (pecCc || []).map(c => c.trim()).filter(c => /\S+@\S+\.\S+/.test(c))
    const info = await transporter.sendMail({
        from: PEC_FROM,
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        text: body,
        attachments: attachments.map(a => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
        })),
    })

    // Il server SMTP puo' accettare il messaggio e rifiutare un destinatario:
    // senza questo controllo la schermata diceva "inviata" anche quando la PEC
    // non era stata presa in carico per nessuno.
    const accepted = (info.accepted || []).map(String)
    const rejected = (info.rejected || []).map(String)
    if (accepted.length === 0) {
        throw new Error(`Nessun destinatario accettato dal server PEC${rejected.length ? ` (rifiutati: ${rejected.join(', ')})` : ''}. ${info.response || ''}`.trim())
    }
    if (!accepted.some(a => a.toLowerCase().includes(to.toLowerCase()))) {
        throw new Error(`Il destinatario ${to} e' stato rifiutato dal server PEC. Accettati: ${accepted.join(', ') || 'nessuno'}. ${info.response || ''}`.trim())
    }
    return { messageId: info.messageId, accepted, rejected, response: String(info.response || '') }
}

// ── Handler ──────────────────────────────────────────────────────────────────

interface ProcessMultaRequest {
    action: 'extract' | 'findDriver' | 'sendPec' | 'fullProcess'
    // For extract
    pdfBase64?: string
    pdfFileName?: string
    // For findDriver
    targa?: string
    data_infrazione?: string
    ora_infrazione?: string
    // For sendPec
    multaData?: MultaData
    driverData?: DriverData
    letterText?: string    // User-edited letter text (if not provided, auto-generated)
    /** Dati azienda validi solo per questa multa (es. indirizzo diverso). */
    aziendaOverride?: Partial<MulteConfig>
    pecTo?: string
    pecCc?: string[]
    pecPassword?: string
    // For fullProcess — all of the above
}

const handler: Handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const req: ProcessMultaRequest = JSON.parse(event.body || '{}')

        switch (req.action) {
            // ── Step 1: Extract data from PDF ────────────────────────────
            case 'extract': {
                if (!req.pdfBase64) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'PDF mancante' }) }
                }

                const multaData = await extractMultaData(req.pdfBase64)
                const pecRecipient = await matchEnte(multaData)
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ multaData, pecRecipient }),
                }
            }

            // ── Step 2: Find driver ──────────────────────────────────────
            case 'findDriver': {
                if (!req.targa || !req.data_infrazione) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Targa e data infrazione richieste' }) }
                }

                const driver = await findDriver(req.targa, req.data_infrazione, req.ora_infrazione || '12:00')
                if (!driver) {
                    return {
                        statusCode: 404,
                        headers: corsHeaders,
                        body: JSON.stringify({ error: 'Nessun noleggio trovato per questa targa e data' }),
                    }
                }

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ driver }),
                }
            }

            // ── Step 3: Send PEC ─────────────────────────────────────────
            case 'sendPec': {
                if (!req.multaData || !req.driverData) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Dati multa e conducente richiesti' }) }
                }

                // Use user-edited letter if provided, otherwise auto-generate
                const multeCfg = await loadMulteConfig()
                const letterText = req.letterText
                    || generateLetterText(req.multaData, req.driverData, multeCfg, req.aziendaOverride || {})
                const subject = `Comunicazione dati conducente — Verbale n. ${req.multaData.numero_verbale || 'N/D'} — Targa ${req.driverData.vehicle_plate}`

                const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []

                console.log(`[process-multa] sendPec: license_urls=${req.driverData.license_urls?.length || 0}, id_urls=${req.driverData.id_urls?.length || 0}, contract_url=${req.driverData.contract_url ? 'yes' : 'no'}, pdfBase64=${req.pdfBase64 ? 'yes' : 'no'}`)

                // 1. Attach original multa PDF
                if (req.pdfBase64) {
                    attachments.push({
                        filename: req.pdfFileName || `verbale_${req.multaData.numero_verbale || 'multa'}.pdf`,
                        content: Buffer.from(req.pdfBase64, 'base64'),
                        contentType: 'application/pdf',
                    })
                }

                // 2. Attach driver's license from storage
                if (req.driverData.license_urls && req.driverData.license_urls.length > 0) {
                    for (let i = 0; i < req.driverData.license_urls.length; i++) {
                        try {
                            const res = await fetch(req.driverData.license_urls[i])
                            if (res.ok) {
                                const buf = Buffer.from(await res.arrayBuffer())
                                const ct = res.headers.get('content-type') || 'application/octet-stream'
                                const ext = ct.includes('pdf') ? 'pdf' : ct.includes('png') ? 'png' : 'jpg'
                                attachments.push({
                                    filename: `patente_${req.driverData.cognome || 'conducente'}${i > 0 ? `_${i + 1}` : ''}.${ext}`,
                                    content: buf,
                                    contentType: ct,
                                })
                            }
                        } catch (e) {
                            console.warn('[process-multa] Failed to fetch license:', e)
                        }
                    }
                }

                // 3. Attach ID document from storage
                if (req.driverData.id_urls && req.driverData.id_urls.length > 0) {
                    for (let i = 0; i < req.driverData.id_urls.length; i++) {
                        try {
                            const res = await fetch(req.driverData.id_urls[i])
                            if (res.ok) {
                                const buf = Buffer.from(await res.arrayBuffer())
                                const ct = res.headers.get('content-type') || 'application/octet-stream'
                                const ext = ct.includes('pdf') ? 'pdf' : ct.includes('png') ? 'png' : 'jpg'
                                attachments.push({
                                    filename: `documento_identita_${req.driverData.cognome || 'conducente'}${i > 0 ? `_${i + 1}` : ''}.${ext}`,
                                    content: buf,
                                    contentType: ct,
                                })
                            }
                        } catch (e) {
                            console.warn('[process-multa] Failed to fetch ID:', e)
                        }
                    }
                }

                // 4. Attach signed contract PDF
                if (req.driverData.contract_url) {
                    try {
                        const res = await fetch(req.driverData.contract_url)
                        if (res.ok) {
                            const buf = Buffer.from(await res.arrayBuffer())
                            attachments.push({
                                filename: `contratto_noleggio_${req.driverData.vehicle_plate}.pdf`,
                                content: buf,
                                contentType: 'application/pdf',
                            })
                        }
                    } catch (e) {
                        console.warn('[process-multa] Failed to fetch contract:', e)
                    }
                }

                console.log(`[process-multa] Sending PEC with ${attachments.length} attachments`)

                const result = await sendPEC(
                    subject,
                    letterText,
                    attachments,
                    req.pecTo,
                    req.pecPassword,
                    req.pecCc
                )

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: true,
                        messageId: result.messageId,
                        // Prova concreta della presa in carico: chi ha accettato
                        // il server PEC e cosa ha risposto.
                        accepted: result.accepted,
                        rejected: result.rejected,
                        smtpResponse: result.response,
                        letterText,
                        attachmentCount: attachments.length,
                    }),
                }
            }

            // ── Full process: extract → find → send ─────────────────────
            case 'fullProcess': {
                if (!req.pdfBase64) {
                    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'PDF mancante' }) }
                }

                // Step 1: Extract
                const multaData = await extractMultaData(req.pdfBase64)

                if (!multaData.targa || !multaData.data_infrazione) {
                    return {
                        statusCode: 400,
                        headers: corsHeaders,
                        body: JSON.stringify({
                            error: 'Impossibile estrarre targa o data dal PDF. Inserisci manualmente.',
                            multaData,
                        }),
                    }
                }

                // Step 2: Find driver
                const driver = await findDriver(multaData.targa, multaData.data_infrazione, multaData.ora_infrazione || '12:00')

                if (!driver) {
                    return {
                        statusCode: 404,
                        headers: corsHeaders,
                        body: JSON.stringify({
                            error: `Nessun noleggio trovato per targa ${multaData.targa} il ${multaData.data_infrazione}`,
                            multaData,
                        }),
                    }
                }

                // Step 3: Generate letter (but don't send yet — return for review)
                const letterText = generateLetterText(multaData, driver, await loadMulteConfig(), req.aziendaOverride || {})

                // Step 4: propose PEC recipient (organo accertatore dinamico)
                const pecRecipient = await matchEnte(multaData)

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ multaData, driver, letterText, pecRecipient }),
                }
            }

            default:
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Azione sconosciuta: ${req.action}` }) }
        }
    } catch (err: any) {
        console.error('[process-multa] Error:', err)
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Errore: ' + err.message }),
        }
    }
}

export { handler }
