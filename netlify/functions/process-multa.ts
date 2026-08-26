import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import nodemailer from 'nodemailer'
import { pecHostFor, pecProviderFor, PEC_PORT } from './utils/pecServer'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// PEC SMTP configuration — il server si ricava dal dominio del mittente
// (utils/pecServer.ts): una casella Aruba non si autentica sul server
// Legalmail, e prima l'host era scritto in duro.
const PEC_USER = process.env.PEC_USER || 'Dubai.rent7.0srl@legalmail.it'
const PEC_PASSWORD = process.env.PEC_PASSWORD || ''
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
    codice_fiscale_urls?: string[]
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

// ── Contratto di noleggio: si allega SEMPRE ────────────────────────
// La comunicazione dati conducente vale quanto il contratto che la sostiene:
// se per quel noleggio il contratto non esiste ancora lo si genera al volo
// invece di spedire la PEC senza. La generazione parte SOLO quando non c'e'
// nessun contratto collegato al booking, quindi non tocca mai firme apposte.
async function generateContractForBooking(bookingId: string): Promise<string> {
    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://platform.dr7ai.com'
    try {
        const res = await fetch(`${baseUrl}/.netlify/functions/generate-contract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId }),
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok || data?.error || data?.skipped) {
            console.warn(`[process-multa] generate-contract non ha prodotto il contratto per ${bookingId}:`, data?.error || data?.reason || res.status)
            return ''
        }
        console.log(`[process-multa] Contratto generato automaticamente per ${bookingId}`)
        return String(data?.url || '')
    } catch (e) {
        console.warn('[process-multa] generate-contract fallito:', e)
        return ''
    }
}

/**
 * URL del contratto da allegare alla PEC. Ordine: contratto del booking
 * (firmato > non firmato) > `bookings.contract_url` > generazione automatica >
 * ricerca per nome nel bucket. La ricerca per nome resta per ultima perche' e'
 * l'unica che puo' pescare il file di un omonimo: il contratto generato per
 * QUEL booking e' sempre preferibile.
 */
async function resolveContractUrl(
    bookingId: string,
    bookingContractUrl: string | null | undefined,
    nameParts: string[],
): Promise<string> {
    const { data: contractData } = await supabase
        .from('contracts')
        .select('signed_pdf_url, pdf_url')
        .eq('booking_id', bookingId)
        .maybeSingle()
    if (contractData) {
        const url = contractData.signed_pdf_url || contractData.pdf_url || ''
        if (url) return url
    }

    if (bookingContractUrl) return bookingContractUrl

    // Nessun contratto per questo noleggio: si genera adesso.
    const generated = await generateContractForBooking(bookingId)
    if (generated) return generated
    // La generazione scrive anche su `contracts`: rileggi, cosi' si prende il
    // PDF anche se la risposta non portava l'URL.
    const { data: afterGen } = await supabase
        .from('contracts')
        .select('signed_pdf_url, pdf_url')
        .eq('booking_id', bookingId)
        .maybeSingle()
    if (afterGen) {
        const url = afterGen.signed_pdf_url || afterGen.pdf_url || ''
        if (url) return url
    }

    // Ultima spiaggia: file nel bucket `contracts` che contiene il nome del
    // cliente (contratto_Patrizio.pdf, contratto_Campagnola.pdf...).
    const parts = nameParts.map(p => p.trim()).filter(Boolean)
    if (parts.length === 0) return ''
    for (const folder of ['filled', 'signed', '']) {
        const { data: files } = await supabase.storage
            .from('contracts')
            .list(folder || undefined, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
        if (!files) continue
        const contractFile = files.find(f => {
            if (!f.name.endsWith('.pdf')) return false
            const lower = f.name.toLowerCase()
            return parts.some(part => lower.includes(part.toLowerCase()))
        })
        if (contractFile) {
            const path = folder ? `${folder}/${contractFile.name}` : contractFile.name
            const { data: signed } = await supabase.storage
                .from('contracts')
                .createSignedUrl(path, 86400)
            if (signed?.signedUrl) return signed.signedUrl
        }
    }
    return ''
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

    // Contratto di noleggio da allegare: se manca viene generato adesso.
    const contractNameParts = (match.customer_name || '').trim().split(/\s+/).filter(Boolean)
    if (nome && !contractNameParts.includes(nome)) contractNameParts.push(nome)
    if (cognome && !contractNameParts.includes(cognome)) contractNameParts.push(cognome)
    const contractUrl = await resolveContractUrl(match.id, match.contract_url, contractNameParts)
    console.log(`[process-multa] Contract lookup: contractUrl=${contractUrl ? 'found' : 'not found'}`)

    // Fetch customer documents (patente, documento d'identita', tessera CF).
    // Fronte e retro sono file separati nello stesso bucket: si allegano tutti,
    // perche' l'organo accertatore chiede sempre le due facciate.
    const licenseUrls: string[] = []
    const idUrls: string[] = []
    const codiceFiscaleUrls: string[] = []

    // La patente NAUTICA sta nel bucket `driver-licenses` ma non c'entra nulla
    // con una multa stradale: si riconosce dal nome del file (stesso criterio
    // di get-customer-documents) e non va allegata.
    const isNautica = (name: string) => /^patente_nautica/i.test(String(name || ''))

    const bucketList = (bucket: string): string[] | null =>
        bucket === 'driver-licenses' ? licenseUrls
        : bucket === 'codice-fiscale' ? codiceFiscaleUrls
        : (bucket === 'driver-ids' || bucket === 'carta-identita' || bucket === 'customer-documents') ? idUrls
        : null

    // Storage folder = customers_extended.id (same ID used by admin upload)
    // Try: customerExtendedId first, then booking.user_id as fallback
    const storageUserId = customerExtendedId || match.user_id

    console.log(`[process-multa] Customer lookup: customerExtendedId=${customerExtendedId}, booking.user_id=${match.user_id}, storageUserId=${storageUserId}`)

    if (storageUserId) {
        const seenFileNames = new Set<string>()

        // 1. Documenti registrati in `user_documents`: il file puo' stare in una
        //    cartella diversa da quella dell'id, quindi il path arriva da li'.
        const { data: dbDocs } = await supabase
            .from('user_documents')
            .select('bucket, file_path, document_type')
            .eq('user_id', storageUserId)

        for (const doc of dbDocs || []) {
            const bucket = (doc as { bucket?: string }).bucket || 'driver-ids'
            const filePath = (doc as { file_path?: string }).file_path || ''
            if (!filePath) continue
            const fileName = filePath.split('/').pop() || ''
            const list = bucketList(bucket)
            if (!list) continue
            if (isNautica(fileName) || isNautica((doc as { document_type?: string }).document_type || '')) continue
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(filePath, 86400)
            if (signed?.signedUrl) { list.push(signed.signedUrl); seenFileNames.add(fileName) }
        }

        // 2. Sweep dei bucket: prende anche i file caricati senza riga in DB.
        const BUCKETS = ['driver-licenses', 'driver-ids', 'carta-identita', 'customer-documents', 'codice-fiscale']

        await Promise.all(BUCKETS.map(async (name) => {
            const list = bucketList(name)
            if (!list) return
            const { data: files } = await supabase.storage
                .from(name)
                .list(storageUserId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

            if (files) {
                for (const file of files) {
                    if (!file.id || file.name.includes('.emptyFolderPlaceholder')) continue
                    if (seenFileNames.has(file.name) || isNautica(file.name)) continue
                    const path = `${storageUserId}/${file.name}`
                    const { data: signed } = await supabase.storage
                        .from(name)
                        .createSignedUrl(path, 86400)
                    if (signed?.signedUrl) { list.push(signed.signedUrl); seenFileNames.add(file.name) }
                }
            }
        }))
    }

    console.log(`[process-multa] Documenti trovati: patente=${licenseUrls.length}, identita=${idUrls.length}, codice_fiscale=${codiceFiscaleUrls.length}`)

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
        codice_fiscale_urls: codiceFiscaleUrls,
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
    /**
     * Server SMTP della casella PEC. Vuoto = si ricava dal dominio
     * (utils/pecServer.ts). Sta in config perche' il provider cambia da
     * azienda ad azienda: indovinarlo dal dominio copre i casi noti, non tutti.
     */
    pec_smtp_host?: string
    /** Porta SMTP. Vuota = 465 (SMTPS implicito, lo standard PEC). */
    pec_smtp_port?: number
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
            pec_smtp_host: cfg.pec_smtp_host?.trim() || undefined,
            pec_smtp_port: Number(cfg.pec_smtp_port) > 0 ? Number(cfg.pec_smtp_port) : undefined,
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

    // Elenco allegati calcolato su quello che si allega davvero: prima era
    // fisso e prometteva la patente anche quando in archivio non c'era.
    const allegati = [
        '- Copia del verbale ricevuto',
        (driver.license_urls?.length ? '- Copia della patente di guida del conducente (fronte e retro)' : ''),
        (driver.id_urls?.length ? '- Copia del documento d\'identita\' del conducente (fronte e retro)' : ''),
        (driver.codice_fiscale_urls?.length ? '- Copia della tessera codice fiscale del conducente (fronte e retro)' : ''),
        (driver.contract_url ? '- Copia del contratto di noleggio' : ''),
    ].filter(Boolean).join('\n')

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
- Contratto di noleggio: ${driver.contract_url ? 'in allegato' : 'disponibile su richiesta'}

Si allegano alla presente:
${allegati}

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

/**
 * Password della casella PEC mittente.
 *
 * 25/08/2026 — La PEC mittente si cambia da Centralina Pro, ma ogni casella ha
 * la SUA password: cambiare indirizzo senza cambiare credenziali significa
 * autenticarsi ancora sulla vecchia. La password non sta nella config (la
 * leggerebbe qualunque admin): sta in `service_secrets`, come il token targa.
 * Chiave: `pec_password:<indirizzo in minuscolo>`.
 */
async function loadPecPassword(mittente: string): Promise<string> {
    const addr = mittente.trim().toLowerCase()
    try {
        const { data } = await supabase
            .from('service_secrets')
            .select('value')
            .eq('key', `pec_password:${addr}`)
            .maybeSingle()
        const v = (data as { value?: string } | null)?.value
        if (v && v.trim()) return v.trim()
    } catch (e) {
        console.warn('[process-multa] service_secrets non leggibile:', e instanceof Error ? e.message : e)
    }
    // La password d'ambiente vale SOLO per la casella d'ambiente: usarla per un
    // altro indirizzo produrrebbe un errore di autenticazione incomprensibile.
    if (addr === PEC_USER.trim().toLowerCase()) return PEC_PASSWORD
    return ''
}

async function sendPEC(
    subject: string,
    body: string,
    attachments: Array<{ filename: string; content: Buffer; contentType: string }>,
    pecTo?: string,
    pecPassword?: string,
    pecCc?: string[],
    /** Casella mittente scelta in Centralina Pro > Gestione Multe. */
    pecFrom?: string,
    /** Server SMTP configurato a mano; vuoto = dedotto dal dominio. */
    smtpHost?: string,
    /** Porta configurata a mano; vuota = 465. */
    smtpPort?: number
): Promise<{ messageId: string; accepted: string[]; rejected: string[]; response: string }> {
    // Mittente: quello configurato, altrimenti la casella d'ambiente storica.
    const from = (pecFrom || '').trim() || PEC_USER
    const pass = pecPassword || await loadPecPassword(from)
    if (!pass) {
        throw new Error(
            `Password mancante per la casella PEC ${from}. ` +
            'Ogni casella ha la sua password: aggiungila in service_secrets con chiave ' +
            `"pec_password:${from.toLowerCase()}" (oppure rimetti la PEC mittente precedente in Centralina Pro > Gestione Multe).`
        )
    }

    // Regola non negoziabile: nessun destinatario hardcoded. Se il chiamante non
    // passa un destinatario esplicito, l'invio si blocca (mai all'indirizzo
    // sbagliato). PEC_TO_DEFAULT resta solo come costante legacy, non usata.
    const to = (pecTo || '').trim()
    if (!to || !/\S+@\S+\.\S+/.test(to)) {
        throw new Error('Destinatario PEC mancante: invio bloccato (nessun destinatario predefinito).')
    }

    // Login e From devono coincidere: i provider PEC rifiutano un mittente
    // diverso dalla casella autenticata.
    const host = (smtpHost || '').trim() || pecHostFor(from)
    const port = Number(smtpPort) > 0 ? Number(smtpPort) : PEC_PORT
    console.log(`[process-multa] PEC ${from} via ${host}:${port}`)
    const transporter = nodemailer.createTransport({
        host,
        port,
        // 465 = TLS dall'inizio; 587/25 partono in chiaro e salgono con STARTTLS.
        secure: port === 465,
        auth: {
            user: from,
            pass: pass,
        },
    })

    const cc = (pecCc || []).map(c => c.trim()).filter(c => /\S+@\S+\.\S+/.test(c))
    let info
    try {
        info = await transporter.sendMail({
        from,
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
    } catch (e) {
        // "Invalid login" da solo non dice dove guardare: il colpevole e' quasi
        // sempre la coppia casella/password, oppure il server del provider.
        const msg = e instanceof Error ? e.message : String(e)
        if (/auth|login|535|password/i.test(msg)) {
            throw new Error(
                `Autenticazione rifiutata dal server PEC per ${from} ` +
                `(server ${host}, ${pecProviderFor(from)}). ` +
                'Controlla la password in Centralina Pro > Gestione PEC & Email. ' +
                `Dettaglio: ${msg}`
            )
        }
        throw e
    }

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

                // Il contratto deve partire INSIEME al verbale: si risolve
                // prima della lettera, cosi' l'elenco degli allegati che la
                // lettera dichiara e' quello che parte davvero.
                if (!req.driverData.contract_url && req.driverData.booking_id) {
                    const np = String(req.driverData.customer_name || '').trim().split(/\s+/).filter(Boolean)
                    if (req.driverData.nome && !np.includes(req.driverData.nome)) np.push(req.driverData.nome)
                    if (req.driverData.cognome && !np.includes(req.driverData.cognome)) np.push(req.driverData.cognome)
                    req.driverData.contract_url = await resolveContractUrl(req.driverData.booking_id, null, np)
                }

                // Use user-edited letter if provided, otherwise auto-generate
                const multeCfg = await loadMulteConfig()
                const letterText = req.letterText
                    || generateLetterText(req.multaData, req.driverData, multeCfg, req.aziendaOverride || {})
                const subject = `Comunicazione dati conducente — Verbale n. ${req.multaData.numero_verbale || 'N/D'} — Targa ${req.driverData.vehicle_plate}`

                const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
                const driver = req.driverData

                console.log(`[process-multa] sendPec: license_urls=${req.driverData.license_urls?.length || 0}, id_urls=${req.driverData.id_urls?.length || 0}, cf_urls=${req.driverData.codice_fiscale_urls?.length || 0}, contract_url=${req.driverData.contract_url ? 'yes' : 'no'}, pdfBase64=${req.pdfBase64 ? 'yes' : 'no'}`)

                // Scarica un documento dallo storage e lo mette in allegato.
                // Il nome del file distingue fronte e retro: se l'originale lo
                // dice, si tiene quel suffisso, altrimenti si numera.
                const attachDocs = async (urls: string[] | undefined, base: string) => {
                    for (let i = 0; i < (urls?.length || 0); i++) {
                        const url = urls![i]
                        try {
                            const res = await fetch(url)
                            if (!res.ok) continue
                            const buf = Buffer.from(await res.arrayBuffer())
                            const ct = res.headers.get('content-type') || 'application/octet-stream'
                            const ext = ct.includes('pdf') ? 'pdf' : ct.includes('png') ? 'png' : 'jpg'
                            const src = decodeURIComponent(url.split('?')[0].split('/').pop() || '')
                            const lato = /front|fronte/i.test(src) ? '_fronte' : /back|retro/i.test(src) ? '_retro' : (i > 0 ? `_${i + 1}` : '')
                            attachments.push({
                                filename: `${base}_${driver.cognome || 'conducente'}${lato}.${ext}`,
                                content: buf,
                                contentType: ct,
                            })
                        } catch (e) {
                            console.warn(`[process-multa] Failed to fetch ${base}:`, e)
                        }
                    }
                }

                // 1. Attach original multa PDF
                if (req.pdfBase64) {
                    attachments.push({
                        filename: req.pdfFileName || `verbale_${req.multaData.numero_verbale || 'multa'}.pdf`,
                        content: Buffer.from(req.pdfBase64, 'base64'),
                        contentType: 'application/pdf',
                    })
                }

                // 2. Patente di guida (fronte e retro)
                await attachDocs(req.driverData.license_urls, 'patente')

                // 3. Documento d'identita' (fronte e retro)
                await attachDocs(req.driverData.id_urls, 'documento_identita')

                // 3-bis. Tessera codice fiscale (fronte e retro): l'organo
                // accertatore la chiede insieme alla patente, prima non partiva.
                await attachDocs(req.driverData.codice_fiscale_urls, 'codice_fiscale')

                // 4. Contratto di noleggio — allegato SEMPRE.
                // L'URL arriva dalla schermata, ma non ci si ferma li': se
                // manca (o non si scarica piu': i link firmati scadono, e la
                // schermata puo' restare aperta per ore) il contratto viene
                // ricercato e, se non esiste, generato adesso lato server.
                const attachContract = async (url: string): Promise<boolean> => {
                    if (!url) return false
                    try {
                        const res = await fetch(url)
                        if (!res.ok) return false
                        const buf = Buffer.from(await res.arrayBuffer())
                        attachments.push({
                            filename: `contratto_noleggio_${driver.vehicle_plate}.pdf`,
                            content: buf,
                            contentType: 'application/pdf',
                        })
                        return true
                    } catch (e) {
                        console.warn('[process-multa] Failed to fetch contract:', e)
                        return false
                    }
                }
                let contractAttached = await attachContract(driver.contract_url || '')
                if (!contractAttached && driver.contract_url && driver.booking_id) {
                    // Link scaduto o file sparito: si rifa' la risoluzione.
                    const nameParts = String(driver.customer_name || '').trim().split(/\s+/).filter(Boolean)
                    if (driver.nome && !nameParts.includes(driver.nome)) nameParts.push(driver.nome)
                    if (driver.cognome && !nameParts.includes(driver.cognome)) nameParts.push(driver.cognome)
                    const freshUrl = await resolveContractUrl(driver.booking_id, null, nameParts)
                    if (freshUrl && freshUrl !== driver.contract_url) {
                        contractAttached = await attachContract(freshUrl)
                    }
                }
                if (!contractAttached) {
                    console.warn(`[process-multa] PEC senza contratto per booking ${driver.booking_id || 'N/D'} — non e' stato possibile recuperarlo`)
                }

                console.log(`[process-multa] Sending PEC with ${attachments.length} attachments`)

                // La PEC parte DALLA casella scelta in Centralina Pro: prima
                // quel campo finiva solo stampato nella lettera e l'invio
                // restava sulla casella scritta nel codice.
                const cfgPec = await loadMulteConfig()
                const result = await sendPEC(
                    subject,
                    letterText,
                    attachments,
                    req.pecTo,
                    req.pecPassword,
                    req.pecCc,
                    cfgPec.pec_mittente,
                    cfgPec.pec_smtp_host,
                    cfgPec.pec_smtp_port
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
                        // Lo storico deve dire se il contratto e' partito
                        // davvero, non se la schermata ne aveva l'URL.
                        contractAttached,
                        contractUrl: driver.contract_url || null,
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
