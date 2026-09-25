import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * Security & Signature Audit Trail DR7 (25/09/2026).
 *
 * Costruisce, per ogni richiesta di firma, cosa e' successo e con quale
 * livello di verifica. Lo usano signature-audit (documento HTML) e
 * signature-sicurezza (sezione Sicurezza Firma del gestionale).
 *
 * Regole:
 * - Si mostra solo quello che il sistema sa davvero. Niente IMEI, numero di
 *   serie o MAC (un browser non li espone), niente modello esatto di telefono
 *   se il browser non lo dichiara. L'IP e il GPS non identificano la persona.
 * - Firme fatte prima delle funzioni nuove: il dato che manca e'
 *   "Non disponibile — funzionalità introdotta successivamente", mai un
 *   valore ricostruito. I dati storici non si modificano.
 * - Il riepilogo ATTENZIONE dipende solo dagli eventi elencati in
 *   REGOLE_ATTENZIONE, ognuno con la sua causa scritta. Niente punteggi.
 */

export const NON_DISPONIBILE_STORICO = 'Non disponibile — funzionalità introdotta successivamente'

// Da quando esistono sessione dispositivo con cookie, GPS, rete separata,
// catena di hash (rilascio del 25/09/2026). Una richiesta creata prima puo'
// non avere questi dati.
const NUOVO_AUDIT_DAL = new Date('2026-09-25T09:00:00Z')
// Primo legame al dispositivo (localStorage), stesso giorno, mattina.
const DISPOSITIVO_DAL = new Date('2026-09-25T08:30:00Z')

// Soglie delle regole ATTENZIONE: qui, visibili, non dentro le funzioni.
export const SOGLIA_OTP_ERRATI = 3

type Riga = Record<string, any>

// ── Date: ora del server, mostrata a Roma ───────────────────────────────
export function dataOra(iso: string | null | undefined): string | null {
    if (!iso) return null
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    const p = Object.fromEntries(new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short',
    }).formatToParts(d).map(x => [x.type, x.value]))
    const zona = p.timeZoneName === 'GMT+2' ? 'CEST' : p.timeZoneName === 'GMT+1' ? 'CET' : p.timeZoneName
    return `${p.day}/${p.month}/${p.year} — ${p.hour}:${p.minute}:${p.second} ${zona}`
}

export function soloOra(iso: string | null | undefined): string | null {
    if (!iso) return null
    return new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(iso))
}

// ── Recapiti mascherati ─────────────────────────────────────────────────
export function mascheraTelefono(tel: string | null | undefined): string | null {
    const cifre = String(tel || '').replace(/\D/g, '')
    if (cifre.length < 4) return null
    return `*** *** ${cifre.slice(-4)}`
}

export function mascheraEmail(email: string | null | undefined): string | null {
    const e = String(email || '').trim()
    const at = e.indexOf('@')
    if (at < 1) return null
    const nome = e.slice(0, at)
    const visibile = nome.length <= 2 ? nome[0] : `${nome[0]}***${nome[nome.length - 1]}`
    return `${visibile}@${e.slice(at + 1)}`
}

// ── Dispositivo dal User-Agent: solo quello che il browser dichiara ─────
export type InfoDispositivo = {
    categoria: string
    dispositivo: string
    sistemaOperativo: string
    browser: string
    userAgent: string
}

export function leggiUserAgent(ua: string | null | undefined): InfoDispositivo | null {
    const s = String(ua || '').trim()
    if (!s || s === 'unknown') return null
    let categoria = 'Non determinabile'
    let dispositivo = 'Non determinabile'
    let so = 'Non determinabile'

    const ios = s.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?/)
    const android = s.match(/Android (\d+(?:\.\d+)*)(?:;\s*([^;)]+))?/)
    if (/iPhone/.test(s)) {
        categoria = 'Smartphone'
        dispositivo = 'Apple iPhone'
        so = ios ? `iOS ${[ios[1], ios[2], ios[3]].filter(Boolean).join('.')}` : 'iOS'
    } else if (/iPad/.test(s)) {
        categoria = 'Tablet'
        dispositivo = 'Apple iPad'
        so = ios ? `iPadOS ${[ios[1], ios[2], ios[3]].filter(Boolean).join('.')}` : 'iPadOS'
    } else if (android) {
        categoria = /Mobile/.test(s) ? 'Smartphone' : 'Tablet'
        // Chrome recente dichiara "K" al posto del modello: non si inventa.
        const modello = (android[2] || '').replace(/\s*Build\/.*$/, '').trim()
        const modelloValido = modello && modello !== 'K' && !/^wv$/i.test(modello) && !/^Linux/i.test(modello)
        dispositivo = modelloValido ? `Android (modello dichiarato: ${modello})` : 'Android'
        so = `Android ${android[1]}`
    } else if (/Windows NT/.test(s)) {
        categoria = 'Computer'
        dispositivo = 'PC Windows'
        // Windows 10 e 11 dichiarano entrambi "NT 10.0".
        so = /Windows NT 10\.0/.test(s) ? 'Windows 10 o successivo' : 'Windows'
    } else if (/Macintosh|Mac OS X/.test(s)) {
        categoria = 'Computer'
        dispositivo = 'Apple Mac'
        so = 'macOS'
    } else if (/CrOS/.test(s)) {
        categoria = 'Computer'
        dispositivo = 'Chromebook'
        so = 'ChromeOS'
    } else if (/Linux/.test(s)) {
        categoria = 'Computer'
        so = 'Linux'
    }

    const v = (re: RegExp) => { const m = s.match(re); return m ? m[1].split('.')[0] : null }
    let browser = 'Non determinabile'
    const prove: [RegExp, string][] = [
        [/CriOS\/([\d.]+)/, 'Chrome iOS'],
        [/FxiOS\/([\d.]+)/, 'Firefox iOS'],
        [/EdgiOS\/([\d.]+)/, 'Edge iOS'],
        [/EdgA?\/([\d.]+)/, 'Edge'],
        [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
        [/OPR\/([\d.]+)/, 'Opera'],
        [/FBAV\/([\d.]+)/, 'Browser interno di Facebook'],
        [/Instagram ([\d.]+)/, 'Browser interno di Instagram'],
        [/Firefox\/([\d.]+)/, 'Firefox'],
        [/Chrome\/([\d.]+)/, 'Chrome'],
        [/Version\/([\d.]+).*Safari/, 'Safari'],
    ]
    for (const [re, nome] of prove) {
        const ver = v(re)
        if (ver) { browser = `${nome} ${ver}`; break }
    }
    if (browser === 'Non determinabile' && /AppleWebKit/.test(s) && /Mobile\//.test(s)) {
        browser = 'Browser interno di un\'app (WebView iOS)'
    }
    return { categoria, dispositivo, sistemaOperativo: so, browser, userAgent: s }
}

// ── Catalogo eventi: tipo nel database → codice e titolo leggibile ──────
type VoceCatalogo = { codice: string; titolo: string; attenzione?: boolean }
const CATALOGO: Record<string, VoceCatalogo> = {
    request_created: { codice: 'SIGN_REQUEST_CREATED', titolo: 'RICHIESTA FIRMA CREATA' },
    link_sent: { codice: 'SIGN_LINK_SENT', titolo: 'LINK INVIATO' },
    email_sent: { codice: 'SIGN_LINK_SENT', titolo: 'LINK INVIATO (EMAIL)' },
    reminder_sent: { codice: 'SIGN_LINK_REMINDER', titolo: 'PROMEMORIA INVIATO' },
    document_viewed: { codice: 'DOCUMENT_OPENED', titolo: 'DOCUMENTO APERTO' },
    device_bound: { codice: 'DEVICE_BOUND', titolo: 'DISPOSITIVO ASSOCIATO' },
    dispositivo_associato: { codice: 'DEVICE_BOUND', titolo: 'DISPOSITIVO ASSOCIATO' },
    new_device_detected: { codice: 'NEW_DEVICE_DETECTED', titolo: 'NUOVO DISPOSITIVO RILEVATO', attenzione: true },
    accesso_altro_dispositivo: { codice: 'NEW_DEVICE_DETECTED', titolo: 'NUOVO DISPOSITIVO RILEVATO', attenzione: true },
    gps_permission_granted: { codice: 'GPS_PERMISSION_GRANTED', titolo: 'POSIZIONE AUTORIZZATA' },
    gps_permission_denied: { codice: 'GPS_PERMISSION_DENIED', titolo: 'GPS NON AUTORIZZATO DAL CLIENTE' },
    gps_unavailable: { codice: 'GPS_UNAVAILABLE', titolo: 'GPS NON DISPONIBILE' },
    gps_captured: { codice: 'GPS_CAPTURED', titolo: 'POSIZIONE ACQUISITA' },
    location_mismatch: { codice: 'LOCATION_MISMATCH', titolo: 'GPS E POSIZIONE IP DISCORDANTI', attenzione: true },
    otp_requested: { codice: 'OTP_REQUESTED', titolo: 'CODICE RICHIESTO' },
    otp_sent: { codice: 'OTP_SENT', titolo: 'OTP INVIATO' },
    otp_send_failed: { codice: 'OTP_SEND_FAILED', titolo: 'INVIO OTP NON RIUSCITO' },
    otp_rate_limited: { codice: 'OTP_RATE_LIMITED', titolo: 'TROPPE RICHIESTE DI CODICE', attenzione: true },
    otp_failed: { codice: 'OTP_FAILED', titolo: 'OTP ERRATO' },
    otp_expired: { codice: 'OTP_EXPIRED', titolo: 'OTP SCADUTO' },
    otp_locked: { codice: 'OTP_LOCKED', titolo: 'OTP BLOCCATO', attenzione: true },
    otp_max_attempts: { codice: 'OTP_LOCKED', titolo: 'OTP BLOCCATO', attenzione: true },
    otp_verified: { codice: 'OTP_VERIFIED', titolo: 'OTP VERIFICATO' },
    firma_confermata: { codice: 'SIGNATURE_CONFIRMED', titolo: 'FIRMA CONFERMATA CON PULSANTE' },
    signature_started: { codice: 'SIGNATURE_STARTED', titolo: 'FIRMA AVVIATA' },
    concurrent_attempt: { codice: 'CONCURRENT_ATTEMPT', titolo: 'TENTATIVO DI FIRMA CONCORRENTE', attenzione: true },
    document_signed: { codice: 'DOCUMENT_SIGNED', titolo: 'DOCUMENTO FIRMATO' },
    integrity_check_failed: { codice: 'INTEGRITY_CHECK_FAILED', titolo: 'VERIFICA INTEGRITA\' NON SUPERATA', attenzione: true },
    request_cancelled: { codice: 'LINK_REVOKED', titolo: 'RICHIESTA SOSTITUITA' },
    link_revoked: { codice: 'LINK_REVOKED', titolo: 'LINK REVOCATO DALLO STAFF' },
    session_revoked: { codice: 'SESSION_REVOKED', titolo: 'SESSIONE REVOCATA' },
    link_revoked_access: { codice: 'SECURITY_BLOCK', titolo: 'TENTATIVO SU LINK NON VALIDO', attenzione: true },
    link_expired: { codice: 'LINK_EXPIRED', titolo: 'LINK SCADUTO' },
    security_block: { codice: 'SECURITY_BLOCK', titolo: 'BLOCCO DI SICUREZZA', attenzione: true },
    seal_layout_corrected: { codice: 'ADMIN_CORRECTION', titolo: 'CORREZIONE DEL SIGILLO' },
}

export type EventoAudit = {
    id: string
    quando: string
    ora: string | null
    dataOra: string | null
    tipo: string
    codice: string
    titolo: string
    descrizione: string
    clientIp: string | null
    proxyIp: string | null
    ipDaCatenaStorica: boolean
    deviceLabel: string | null
    attenzione: boolean
    metadata: Riga
}

/** IP di un evento. Righe storiche: la catena x-forwarded-for intera, divisa qui. */
function ipEvento(r: Riga): { clientIp: string | null; proxyIp: string | null; storico: boolean } {
    if (r.client_ip) return { clientIp: r.client_ip, proxyIp: r.proxy_ip || null, storico: false }
    const catena = String(r.ip_address || '').split(',').map((x: string) => x.trim()).filter((x: string) => x && x !== 'unknown')
    if (!catena.length) return { clientIp: null, proxyIp: null, storico: false }
    return { clientIp: catena[0], proxyIp: catena.slice(1).join(', ') || null, storico: catena.length > 1 }
}

function eventoLeggibile(r: Riga): EventoAudit {
    const voce = CATALOGO[r.event_type] || { codice: String(r.event_type || '').toUpperCase(), titolo: String(r.event_type || '').replace(/_/g, ' ').toUpperCase() }
    const ip = ipEvento(r)
    const titolo = r.event_type === 'gps_captured' && r.metadata?.fase === 'firma' ? 'POSIZIONE FIRMA ACQUISITA' : voce.titolo
    return {
        id: r.id,
        quando: r.created_at,
        ora: soloOra(r.created_at),
        dataOra: dataOra(r.created_at),
        tipo: r.event_type,
        codice: voce.codice,
        titolo,
        descrizione: r.event_description || '',
        clientIp: ip.clientIp,
        proxyIp: ip.proxyIp,
        ipDaCatenaStorica: ip.storico,
        deviceLabel: r.device_label || null,
        attenzione: !!voce.attenzione,
        metadata: r.metadata || {},
    }
}

// ── Regole ATTENZIONE: solo eventi oggettivi, ognuno con la sua causa ────
type ContestoRegola = { eventi: EventoAudit[]; req: Riga; catenaIntegra: boolean | null; firmatoDa: string | null }
const REGOLE_ATTENZIONE: { id: string; causa: (c: ContestoRegola) => string | null }[] = [
    {
        id: 'nuovo_dispositivo',
        causa: ({ eventi, req, firmatoDa }) => {
            const ev = eventi.filter(e => e.codice === 'NEW_DEVICE_DETECTED')
            if (!ev.length) return null
            const sessioni = Array.from(new Set(ev.map(e => e.deviceLabel).filter(Boolean)))
            const chi = sessioni.length ? ` (${sessioni.join(', ')})` : ''
            const esito = req.status === 'signed'
                ? (firmatoDa && sessioni.includes(firmatoDa)
                    ? 'La firma e\' stata completata da quella sessione.'
                    : 'La seconda sessione NON ha completato la firma: il documento e\' stato firmato dal dispositivo associato.')
                : 'La seconda sessione NON ha potuto accedere al contratto, all\'OTP o alla firma.'
            return `Durante la procedura e' stata rilevata l'apertura del link da una seconda sessione${chi}, ${ev.length} ${ev.length === 1 ? 'volta' : 'volte'}. ${esito}`
        },
    },
    {
        id: 'otp_errati',
        causa: ({ eventi }) => {
            const n = eventi.filter(e => e.codice === 'OTP_FAILED').length
            return n >= SOGLIA_OTP_ERRATI ? `Inseriti ${n} codici OTP errati (soglia di attenzione: ${SOGLIA_OTP_ERRATI}).` : null
        },
    },
    {
        id: 'otp_bloccato',
        causa: ({ eventi }) => eventi.some(e => e.codice === 'OTP_LOCKED')
            ? 'La verifica OTP e\' stata bloccata per il numero massimo di tentativi.' : null,
    },
    {
        id: 'troppi_codici',
        causa: ({ eventi }) => eventi.some(e => e.codice === 'OTP_RATE_LIMITED')
            ? 'Richieste di codice OTP respinte perche\' troppo ravvicinate.' : null,
    },
    {
        id: 'gps_ip',
        causa: ({ eventi }) => {
            const ev = eventi.find(e => e.codice === 'LOCATION_MISMATCH')
            return ev ? `Posizione GPS e posizione approssimativa dell'IP distanti circa ${ev.metadata?.distanza_km ?? '?'} km. Dato informativo: la firma non e' stata bloccata per questo.` : null
        },
    },
    {
        id: 'link_non_valido',
        causa: ({ eventi }) => {
            const n = eventi.filter(e => e.tipo === 'link_revoked_access').length
            return n ? `Tentativo di usare il link dopo la revoca o la sostituzione (${n} ${n === 1 ? 'volta' : 'volte'}): respinto.` : null
        },
    },
    {
        id: 'sessione_scaduta',
        causa: ({ eventi, req }) => eventi.some(e => e.codice === 'LINK_EXPIRED') && req.status !== 'signed'
            ? 'Il link e\' scaduto prima della firma.' : null,
    },
    {
        id: 'concorrenza',
        causa: ({ eventi }) => eventi.some(e => e.codice === 'CONCURRENT_ATTEMPT')
            ? 'Tentativo di firma mentre un\'altra firma dello stesso contratto era in corso: rimandato.' : null,
    },
    {
        id: 'blocco',
        causa: ({ eventi }) => {
            const ev = eventi.filter(e => e.tipo === 'security_block')
            return ev.length ? ev.map(e => e.descrizione).join(' ') : null
        },
    },
    {
        id: 'integrita_pdf',
        causa: ({ eventi }) => eventi.some(e => e.codice === 'INTEGRITY_CHECK_FAILED')
            ? 'Un tentativo di firma e\' stato respinto perche\' il PDF non corrispondeva a quello inviato in firma.' : null,
    },
    {
        id: 'registro',
        causa: ({ catenaIntegra }) => catenaIntegra === false
            ? 'La catena di impronte del registro eventi non corrisponde: uno o piu\' eventi sono stati modificati o rimossi dopo la registrazione.' : null,
    },
]

// ── Scheda di una richiesta di firma ────────────────────────────────────
export type SchedaFirma = ReturnType<typeof costruisciScheda> extends Promise<infer T> ? T : never

async function sha256DaUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return null
        return crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')
    } catch {
        return null
    }
}

async function costruisciScheda(
    supabase: SupabaseClient,
    req: Riga,
    righe: Riga[],
    versioni: string[],
    opzioni: { verificaFile: boolean },
) {
    const eventi = righe.map(eventoLeggibile)
    const creata = new Date(req.created_at)
    const storicoAudit = creata < NUOVO_AUDIT_DAL
    const storicoDispositivo = creata < DISPOSITIVO_DAL

    const firmato = eventi.filter(e => e.tipo === 'document_signed').pop() || null
    const firmatoDa = firmato?.deviceLabel || null

    // Catena di impronte del registro (solo eventi registrati dal 25/09/2026)
    let catena: { eventi_protetti: number; integra: boolean; primo_evento: string | null; ultima_impronta: string | null } | null = null
    try {
        const { data } = await supabase.rpc('firma_verifica_catena', { p_request: req.id })
        catena = Array.isArray(data) ? data[0] : data
    } catch { catena = null }
    const catenaIntegra = catena && catena.eventi_protetti > 0 ? catena.integra : null

    // Riepilogo sicurezza
    const cause = REGOLE_ATTENZIONE.map(r => r.causa({ eventi, req, catenaIntegra, firmatoDa })).filter((c): c is string => !!c)

    // Sessione dispositivo. Un legame registrato DOPO la firma (link gia'
    // firmato riaperto piu' tardi, prima che DR7 Trust smettesse di legarli)
    // non riguarda la firma: non si mostra come dispositivo della firma.
    const legatoDopoLaFirma = !!(req.signed_at && req.device_bound_at && new Date(req.device_bound_at) > new Date(req.signed_at))
    const deviceLabel = legatoDopoLaFirma ? null : (req.device_label
        || (req.device_id ? `DR7-DVC-${crypto.createHash('sha256').update(req.device_id).digest('hex').slice(0, 8).toUpperCase()}` : null))
    const sessioniAltre = new Set(eventi.filter(e => e.codice === 'NEW_DEVICE_DETECTED').map(e => e.deviceLabel || e.id))
    const sessione = {
        deviceId: deviceLabel || (storicoDispositivo ? NON_DISPONIBILE_STORICO : 'Nessun dispositivo associato (link mai aperto)'),
        nota: 'Identificativo sessione dispositivo generato da DR7. Non e\' l\'IMEI ne\' il numero di serie del telefono.',
        primaAssociazione: legatoDopoLaFirma
            ? `${NON_DISPONIBILE_STORICO} (associazione registrata il ${dataOra(req.device_bound_at)}, dopo la firma: non riguarda la firma)`
            : dataOra(req.device_bound_at) || (storicoDispositivo ? NON_DISPONIBILE_STORICO : '—'),
        primaApertura: dataOra(req.first_opened_at) || dataOra(eventi.find(e => e.tipo === 'document_viewed')?.quando) || '—',
        ultimaAttivita: dataOra(eventi.length ? eventi[eventi.length - 1].quando : null) || '—',
        cambioDispositivo: storicoDispositivo && !deviceLabel ? NON_DISPONIBILE_STORICO : 'NO (il link resta legato al primo dispositivo; per un altro dispositivo DR7 invia un nuovo link)',
        sessioniRilevate: storicoDispositivo && !deviceLabel ? NON_DISPONIBILE_STORICO : String((deviceLabel ? 1 : 0) + sessioniAltre.size),
    }

    // Dispositivo: User-Agent della firma, se no dell'ultima verifica/apertura
    const uaFirma = righe.filter(r => r.event_type === 'document_signed').pop()?.user_agent
        || req.signer_user_agent || req.first_user_agent || righe.filter(r => r.user_agent).pop()?.user_agent
    const dispositivo = leggiUserAgent(uaFirma)

    // Posizione al momento della firma
    const gpsEventi = eventi.filter(e => e.tipo === 'gps_captured')
    const loc: Riga | null = req.signing_location || firmato?.metadata?.signing_location || null
    const gpsFirma = gpsEventi.filter(e => e.metadata?.fase === 'firma').pop() || null
    const esitoGpsFirma = eventi.filter(e => ['gps_captured', 'gps_permission_denied', 'gps_unavailable'].includes(e.tipo) && e.metadata?.fase === 'firma').pop() || null
    let gpsStato: string
    if (loc?.latitude != null || gpsFirma) gpsStato = 'ACQUISITO'
    else if (esitoGpsFirma?.tipo === 'gps_permission_denied' || loc?.esito === 'GPS NON AUTORIZZATO DAL CLIENTE') gpsStato = 'NON AUTORIZZATO DAL CLIENTE'
    else if (esitoGpsFirma?.tipo === 'gps_unavailable' || loc?.esito === 'GPS NON DISPONIBILE') gpsStato = 'NON DISPONIBILE'
    else if (storicoAudit) gpsStato = NON_DISPONIBILE_STORICO
    else gpsStato = req.status === 'signed' ? 'NON ACQUISITO' : 'NON ANCORA ACQUISITO'
    const m = (loc?.latitude != null ? loc : gpsFirma?.metadata) || null
    const ind = m?.indirizzo_stimato || null
    const posizione = {
        stato: gpsStato,
        indirizzoStimato: ind?.testo || (m ? 'Indirizzo non ricavabile dalle coordinate' : null),
        indirizzoNota: 'Indirizzo stimato dalle coordinate GPS (OpenStreetMap Nominatim), non indirizzo certo del firmatario.',
        coordinate: m ? `${Number(m.latitude).toFixed(6)}, ${Number(m.longitude).toFixed(6)}` : null,
        accuratezza: m?.accuracy != null ? `Accuratezza dichiarata dal dispositivo: ±${Math.round(m.accuracy)} m` : null,
        acquisizione: gpsFirma ? dataOra(gpsFirma.quando) : (loc?.acquisita_server_at ? dataOra(loc.acquisita_server_at) : null),
        oraDispositivo: m?.location_timestamp ? dataOra(m.location_timestamp) : null,
        secondiPrimaDellaFirma: loc?.secondi_prima_della_firma ?? null,
        fonte: m ? 'Browser Geolocation API (GPS/BROWSER, alta precisione)' : null,
        permesso: m?.permission_status || null,
        apertura: (() => {
            const a = gpsEventi.find(e => e.metadata?.fase === 'apertura')
            if (a) return `Acquisita anche all'apertura (${dataOra(a.quando)}): ${a.metadata?.indirizzo_stimato?.testo || `${Number(a.metadata.latitude).toFixed(6)}, ${Number(a.metadata.longitude).toFixed(6)}`}${a.metadata?.accuracy != null ? `, ±${Math.round(a.metadata.accuracy)} m` : ''}`
            const n = eventi.find(e => ['gps_permission_denied', 'gps_unavailable'].includes(e.tipo) && e.metadata?.fase === 'apertura')
            return n ? `All'apertura: ${n.titolo}` : null
        })(),
    }
    const ipGeoTesto = firmato?.metadata?.ip_geo_testo || m?.ip_geo_testo
        || eventi.filter(e => e.metadata?.ip_geo_testo).pop()?.metadata?.ip_geo_testo || null
    const ipGeo = ipGeoTesto
        ? `Area approssimativa: ${ipGeoTesto}`
        : (storicoAudit ? NON_DISPONIBILE_STORICO : 'Non disponibile')

    // Rete
    const evRete = firmato || eventi.filter(e => e.clientIp).pop() || null
    const rete = {
        clientIp: evRete?.clientIp || req.signer_ip?.split(',')[0]?.trim() || 'Non disponibile',
        proxy: evRete?.proxyIp || null,
        nota: evRete?.ipDaCatenaStorica
            ? 'IP ricavato dalla catena X-Forwarded-For registrata prima del 25/09/2026 (primo indirizzo = cliente, seguenti = infrastruttura).'
            : 'IP del cliente fornito dall\'infrastruttura Netlify. L\'IP non identifica con certezza la persona.',
    }

    // OTP
    const otpVerificato = eventi.filter(e => e.tipo === 'otp_verified').pop() || null
    const conPulsante = eventi.some(e => e.tipo === 'firma_confermata') || firmato?.metadata?.metodo_firma === 'pulsante'
    const inviiOtp = eventi.filter(e => e.tipo === 'otp_sent')
    const ultimoInvio = (otpVerificato ? inviiOtp.filter(e => e.quando <= otpVerificato.quando) : inviiOtp).pop() || null
    const canale = req.otp_channel || ultimoInvio?.metadata?.channel || null
    const otp = {
        stato: otpVerificato ? 'VERIFICATO' : conPulsante ? 'NON RICHIESTO (firma con pulsante, OTP spento in Centralina Pro)' : req.status === 'signed' ? 'NON REGISTRATO' : 'NON ANCORA VERIFICATO',
        canale: canale === 'whatsapp' ? 'WhatsApp' : canale === 'email' ? 'Email' : null,
        destinatario: req.otp_recipient_masked || ultimoInvio?.metadata?.destinatario
            || (canale === 'whatsapp' ? mascheraTelefono(req.signer_phone) : canale === 'email' ? mascheraEmail(req.signer_email) : null),
        oraInvio: dataOra(ultimoInvio?.quando),
        oraVerifica: dataOra(otpVerificato?.quando),
        codiciInviati: inviiOtp.length,
        tentativiErrati: eventi.filter(e => e.tipo === 'otp_failed').length,
    }

    // Integrita'
    const hashFirmatoOra = opzioni.verificaFile && req.signed_pdf_url && req.signed_pdf_hash
        ? await sha256DaUrl(req.signed_pdf_url) : null
    const indiceVersione = req.original_pdf_hash ? versioni.indexOf(req.original_pdf_hash) : -1
    const integrita = {
        hashOriginale: req.original_pdf_hash || 'Non disponibile',
        hashFirmato: req.signed_pdf_hash || (req.status === 'signed' ? 'Non disponibile' : 'Documento non ancora firmato'),
        hashAuditTrail: req.audit_trail_hash
            || (req.status === 'signed' ? (storicoAudit ? NON_DISPONIBILE_STORICO : 'Non disponibile') : 'Si calcola alla firma'),
        versione: indiceVersione >= 0
            ? `Versione ${indiceVersione + 1} di ${versioni.length} inviate in firma per questo contratto (identificata dall'impronta del documento originale)`
            : 'Non disponibile',
        fileFirmatoVerificato: !req.signed_pdf_hash ? null
            : hashFirmatoOra === null ? 'NON VERIFICABILE ORA (file non raggiungibile)'
                : hashFirmatoOra === req.signed_pdf_hash ? 'VERIFICATA: il file firmato in archivio ha ancora questa impronta'
                    : 'NON CORRISPONDE: il file firmato in archivio e\' diverso da quello registrato alla firma',
        registro: catena && catena.eventi_protetti > 0
            ? (catena.integra
                ? `Integro: ${catena.eventi_protetti} eventi protetti da catena SHA-256 dal ${dataOra(catena.primo_evento)}`
                : 'NON INTEGRO: la catena di impronte non corrisponde')
            : NON_DISPONIBILE_STORICO,
    }

    // Livello di verifica
    const livelli = [
        { voce: 'Link personale', valore: req.status === 'signed' ? 'VERIFICATO' : ['cancelled', 'superseded'].includes(req.status) || req.revoked_at ? 'REVOCATO / SOSTITUITO' : 'IN ATTESA' },
        {
            voce: 'Dispositivo associato',
            valore: !deviceLabel ? (storicoDispositivo ? NON_DISPONIBILE_STORICO : 'NON ANCORA ASSOCIATO')
                : req.status !== 'signed' ? 'ASSOCIATO'
                    : (firmatoDa && firmatoDa !== deviceLabel) ? 'NON CORRISPONDE' : 'VERIFICATO',
        },
        { voce: 'OTP', valore: otpVerificato ? 'VERIFICATO' : conPulsante ? 'NON RICHIESTO' : req.status === 'signed' ? 'NON REGISTRATO' : 'IN ATTESA' },
        { voce: 'GPS firma', valore: gpsStato },
        {
            voce: 'Integrita\' documento',
            valore: integrita.fileFirmatoVerificato?.startsWith('VERIFICATA') ? 'VERIFICATA'
                : integrita.fileFirmatoVerificato?.startsWith('NON CORRISPONDE') ? 'NON CORRISPONDE'
                    : req.signed_pdf_hash ? 'REGISTRATA (non ricontrollata ora)'
                        : req.status === 'signed' ? 'Non disponibile' : 'IN ATTESA',
        },
    ]

    // Marketing (come nell'audit di prima)
    const mc = firmato?.metadata?.marketing_consent

    return {
        id: req.id,
        status: req.status as string,
        statoFirma: req.status === 'signed' ? 'COMPLETATA'
            : req.revoked_at ? 'LINK REVOCATO'
                : req.status === 'cancelled' || req.status === 'superseded' ? 'SOSTITUITA DA UN INVIO PIU\' RECENTE'
                    : req.status === 'expired' ? 'LINK SCADUTO'
                        : 'IN ATTESA',
        revoca: req.revoked_at ? { quando: dataOra(req.revoked_at), da: req.revoked_by || null, motivo: req.revoke_reason || null } : null,
        firmatario: {
            nome: req.signer_name || '—',
            email: req.signer_email || '—',
            telefono: mascheraTelefono(req.signer_phone) || '—',
            dataFirma: dataOra(req.signed_at),
            metodo: conPulsante ? 'Pulsante "Firma il Contratto"' : otpVerificato ? 'Codice OTP' : null,
        },
        riepilogo: { stato: cause.length ? 'ATTENZIONE' as const : 'REGOLARE' as const, cause },
        livelli,
        sessione,
        dispositivo,
        posizione,
        ipGeo,
        rete,
        otp,
        integrita,
        marketing: mc === undefined ? null : { consenso: !!mc, quando: dataOra(firmato?.quando) },
        eventi,
        linkAttivo: !['signed', 'cancelled', 'superseded', 'expired'].includes(req.status) && !req.revoked_at
            && (!req.token_expires_at || new Date(req.token_expires_at) > new Date()),
        scadenzaLink: dataOra(req.token_expires_at),
        creataIl: dataOra(req.created_at),
    }
}

/** Legge richieste + eventi di un contratto (o di una richiesta sola) e costruisce le schede. */
export async function leggiSicurezzaFirma(
    supabase: SupabaseClient,
    filtro: { contractId?: string | null; requestId?: string | null },
    opzioni: { verificaFile: boolean },
) {
    let q = supabase.from('signature_requests').select('*')
    q = filtro.requestId ? q.eq('id', filtro.requestId) : q.eq('contract_id', filtro.contractId as string)
    const { data: richieste, error } = await q.order('created_at', { ascending: true })
    if (error) throw error
    if (!richieste || !richieste.length) return null

    const ids = richieste.map(r => r.id)
    const { data: righe, error: errAudit } = await supabase
        .from('signature_audit_trail')
        .select('*')
        .in('signature_request_id', ids)
        .order('created_at', { ascending: true })
    if (errAudit) throw errAudit

    // Versioni del contratto: impronte distinte in ordine di invio.
    const contractId = richieste[0].contract_id
    let tutteLeVersioni: string[] = []
    if (contractId) {
        const { data: tutte } = await supabase
            .from('signature_requests')
            .select('original_pdf_hash, created_at')
            .eq('contract_id', contractId)
            .order('created_at', { ascending: true })
        tutteLeVersioni = Array.from(new Set((tutte || []).map(r => r.original_pdf_hash).filter(Boolean)))
    }

    const { data: contract } = contractId
        ? await supabase
            .from('contracts')
            .select('id, contract_number, customer_name, customer_email, customer_phone, vehicle_name, rental_start_date, rental_end_date, booking_id')
            .eq('id', contractId)
            .maybeSingle()
        : { data: null }

    const schede = await Promise.all(richieste.map(req => costruisciScheda(
        supabase, req, (righe || []).filter(r => r.signature_request_id === req.id), tutteLeVersioni, opzioni,
    )))

    // Prima le richieste in corso o firmate, poi quelle sostituite/annullate.
    const attive = schede.filter(s => !['cancelled', 'superseded'].includes(s.status))
    const storiche = schede.filter(s => ['cancelled', 'superseded'].includes(s.status))

    const statoContratto = attive.length && attive.every(s => s.status === 'signed') ? 'COMPLETATA'
        : attive.some(s => s.status === 'signed') ? 'PARZIALE'
            : attive.length ? 'IN ATTESA' : 'NESSUNA RICHIESTA ATTIVA'

    return {
        contratto: contract || null,
        documento: contract ? null : (richieste[0].document_name || 'Documento'),
        statoContratto,
        attive,
        storiche,
    }
}
