/**
 * Modalita' OSCURARE — dati dei clienti nascosti durante una registrazione schermo.
 *
 * A cosa serve: filmare il gestionale (demo, video di vendita, assistenza in
 * condivisione schermo) senza mostrare nomi, email, telefoni, indirizzi,
 * codici fiscali, partite IVA, IBAN e documenti dei clienti veri.
 *
 * Come funziona: invece di andare a toccare le duecento schede una per una,
 * si interviene in un punto solo — la rete. Quando la modalita' e' accesa
 * ogni risposta JSON (Supabase e funzioni Netlify) passa di qui e i campi
 * personali vengono sostituiti con dati finti ma plausibili PRIMA che il
 * gestionale li veda. Lo schermo resta pieno e credibile: "Marco Rossi",
 * "+39 348 512 7734", "Via Roma 14". Nessun componente cambia.
 *
 * I dati finti sono DETERMINISTICI: lo stesso cliente diventa sempre lo
 * stesso nome finto, in ogni tab, prenotazione, fattura e report. La demo
 * resta coerente.
 *
 * SICUREZZA — perche' la modalita' blocca le scritture: se una scheda viene
 * riempita con dati finti e qualcuno preme Salva, i dati finti finirebbero
 * nel database VERO. Quindi finche' Oscurare e' acceso ogni scrittura
 * (INSERT/UPDATE/DELETE su Supabase, invii WhatsApp/email, fatture,
 * pagamenti Nexi, firme) viene fermata nel browser e riceve una risposta
 * finta di successo: la registrazione scorre, il database non si muove e
 * nessun cliente vero riceve messaggi.
 *
 * Non e' una modalita' di lavoro: e' una modalita' di ripresa. Si spegne
 * dallo stesso bottone in alto a destra.
 */

const CHIAVE = 'dr7_oscura'

/**
 * Durata massima. Con Oscurare acceso le scritture non partono: se resta acceso
 * per dimenticanza, il gestionale sembra funzionare ma non salva piu' niente.
 * Dopo due ore si spegne da solo al primo caricamento.
 */
const DURATA_MS = 2 * 60 * 60 * 1000

/** Oscurare e' acceso? */
export function oscuraAttivo(): boolean {
  try {
    const acceso = localStorage.getItem(CHIAVE)
    if (!acceso) return false
    const da = Number(acceso)
    if (!Number.isFinite(da) || Date.now() - da > DURATA_MS) {
      localStorage.removeItem(CHIAVE)
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Accende o spegne la modalita' e ricarica la pagina.
 *
 * La ricarica non e' pigrizia: i dati gia' scaricati stanno nella memoria dei
 * componenti, e mascherarli a posteriori vorrebbe dire inseguire ogni schermo
 * aperto. Ripartendo da zero tutto quello che arriva e' gia' mascherato.
 */
export function impostaOscura(attivo: boolean): void {
  try {
    if (attivo) localStorage.setItem(CHIAVE, String(Date.now()))
    else localStorage.removeItem(CHIAVE)
  } catch { /* archiviazione non disponibile: si ricarica lo stesso */ }
  window.location.reload()
}

/**
 * L'email dell'operatore collegato non va MAI mascherata: alcuni controlli di
 * ruolo confrontano la riga letta con la sessione, e un'email finta li
 * farebbe fallire (schermate vuote, tab che spariscono).
 */
let emailOperatore: string | null = null
export function proteggiOperatore(email?: string | null): void {
  emailOperatore = (email || '').trim().toLowerCase() || null
}

// ---------------------------------------------------------------------------
// Generatore di dati finti, stabile per valore di partenza
// ---------------------------------------------------------------------------

const NOMI = [
  'Marco', 'Luca', 'Giulia', 'Francesca', 'Andrea', 'Chiara', 'Matteo', 'Sara',
  'Davide', 'Elena', 'Alessandro', 'Martina', 'Simone', 'Valentina', 'Federico',
  'Silvia', 'Riccardo', 'Anna', 'Nicola', 'Laura', 'Stefano', 'Ilaria',
]

const COGNOMI = [
  'Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci',
  'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano',
  'Mancini', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Serra', 'Pinna',
]

const VIE = [
  'Via Roma', 'Via Garibaldi', 'Via Dante', 'Viale Marconi', 'Via Verdi',
  'Corso Italia', 'Via Manzoni', 'Via Cavour', 'Via Nazionale', 'Via Milano',
]

const CITTA = [
  'Cagliari', 'Quartu Sant\'Elena', 'Sassari', 'Olbia', 'Nuoro', 'Oristano',
  'Iglesias', 'Carbonia', 'Alghero', 'Selargius',
]

const SOCIETA = ['Alba', 'Mediterranea', 'Nuraghe', 'Tirreno', 'Sardegna', 'Orion', 'Aurora']
const FORME = ['SRL', 'SRLS', 'SPA', 'SNC']

/**
 * Impronta FNV-1a: stessa stringa, stesso numero, sempre.
 *
 * Il rimescolamento finale non e' un vezzo: senza, i bit bassi si somigliano
 * troppo e due indirizzi diversi finivano sulla stessa via allo stesso civico.
 */
function impronta(testo: string): number {
  let h = 2166136261
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

function scegli<T>(elenco: T[], seme: number): T {
  return elenco[seme % elenco.length]
}

function cifre(seme: number, quante: number): string {
  let s = ''
  let n = seme
  for (let i = 0; i < quante; i++) {
    n = (Math.imul(n, 1103515245) + 12345) >>> 0
    s += String(n % 10)
  }
  return s
}

function lettere(seme: number, quante: number): string {
  const A = 'ABCDEFGHILMNOPQRSTUVZ'
  let s = ''
  let n = seme
  for (let i = 0; i < quante; i++) {
    n = (Math.imul(n, 1103515245) + 12345) >>> 0
    s += A[n % A.length]
  }
  return s
}

function nomeFinto(orig: string): string {
  const h = impronta(orig)
  return `${scegli(NOMI, h)} ${scegli(COGNOMI, h >>> 5)}`
}

function soloNomeFinto(orig: string): string {
  return scegli(NOMI, impronta(orig))
}

function soloCognomeFinto(orig: string): string {
  return scegli(COGNOMI, impronta(orig))
}

function emailFinta(orig: string): string {
  const h = impronta(orig)
  const n = scegli(NOMI, h).toLowerCase()
  const c = scegli(COGNOMI, h >>> 5).toLowerCase().replace(/\s+/g, '')
  return `${n}.${c}${h % 90 + 10}@example.it`
}

function telefonoFinto(orig: string): string {
  const h = impronta(orig)
  return `+39 3${(h % 5) + 2}${cifre(h, 1)} ${cifre(h >>> 3, 3)} ${cifre(h >>> 7, 4)}`
}

function cfFinto(orig: string): string {
  const h = impronta(orig)
  return `${lettere(h, 6)}${cifre(h >>> 4, 2)}${lettere(h >>> 8, 1)}${cifre(h >>> 11, 2)}${lettere(h >>> 15, 1)}${cifre(h >>> 19, 3)}${lettere(h >>> 23, 1)}`
}

function pivaFinta(orig: string): string {
  return cifre(impronta(orig), 11)
}

function ibanFinto(orig: string): string {
  const h = impronta(orig)
  return `IT${cifre(h, 2)}${lettere(h >>> 6, 1)}${cifre(h >>> 9, 22)}`
}

function indirizzoFinto(orig: string): string {
  const h = impronta(orig)
  return `${scegli(VIE, h)} ${(h % 120) + 1}`
}

function cittaFinta(orig: string): string {
  return scegli(CITTA, impronta(orig))
}

function aziendaFinta(orig: string): string {
  const h = impronta(orig)
  return `${scegli(SOCIETA, h)} ${scegli(COGNOMI, h >>> 5)} ${scegli(FORME, h >>> 9)}`
}

function documentoFinto(orig: string): string {
  const h = impronta(orig)
  return `${lettere(h, 2)}${cifre(h >>> 5, 7)}`
}

function sdiFinto(orig: string): string {
  const h = impronta(orig)
  return `${lettere(h, 3)}${cifre(h >>> 5, 4)}`
}

/** Sposta una data di nascita di qualche anno/giorno, mantenendo il formato. */
function dataFinta(orig: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(orig)
  if (!iso) return orig
  const h = impronta(orig)
  const anno = Math.max(1950, Number(iso[1]) - (h % 7) - 1)
  const mese = (h % 12) + 1
  const giorno = (h % 27) + 1
  const dueCifre = (n: number) => String(n).padStart(2, '0')
  return `${anno}-${dueCifre(mese)}-${dueCifre(giorno)}${orig.slice(10)}`
}

// ---------------------------------------------------------------------------
// Quali campi sono personali
// ---------------------------------------------------------------------------

type Genere =
  | 'nome' | 'solo-nome' | 'solo-cognome' | 'azienda' | 'email' | 'telefono'
  | 'cf' | 'piva' | 'iban' | 'indirizzo' | 'citta' | 'documento' | 'sdi'
  | 'data-nascita' | 'testo' | null

/** Campi che sembrano personali ma non lo sono: mai toccati. */
const MAI = new Set([
  'id', 'user_id', 'customer_id', 'vehicle_id', 'booking_id', 'created_by',
  'targa', 'plate', 'status', 'created_at', 'updated_at', 'email_sent',
  'email_inviata', 'phone_verified', 'nome_file', 'file_name', 'nome_tab',
  'nome_campo', 'nome_template', 'nome_servizio', 'nome_categoria',
  'nome_veicolo', 'nome_azienda_mittente',
])

/** Nomi completi: sempre personali, in qualunque tabella arrivino. */
const NOMI_COMPLETI = new Set([
  'customer_name', 'customer_full_name', 'full_name', 'fullname', 'nome_completo',
  'nominativo', 'intestatario', 'contact_name', 'guest_name', 'driver_name',
  'billing_name', 'nome_cliente', 'cliente_nome', 'nome_e_cognome',
  'beneficiario', 'richiedente', 'referente', 'conducente', 'passeggero',
  'firmatario', 'nome_cognome',
])

/** Campi ambigui: personali solo dentro una scheda che parla di una persona. */
const SE_PERSONA = new Set(['nome', 'name', 'cognome_nome'])

function genereDelCampo(chiave: string, valore: string, persona: boolean): Genere {
  const k = chiave.toLowerCase()
  if (MAI.has(k)) return null

  if (NOMI_COMPLETI.has(k)) return 'nome'
  if (/(^|_)(ragione_sociale|denominazione|azienda|company_name)$/.test(k)) return 'azienda'
  if (/(^|_)(cognome|last_name|surname)$/.test(k)) return 'solo-cognome'
  if (/(^|_)(first_name|given_name)$/.test(k)) return 'solo-nome'
  if (/(^|_)(pec)$/.test(k) || /(^|_)e?mail$/.test(k) || k.endsWith('_email') || k === 'email') {
    return valore.includes('@') ? 'email' : null
  }
  if (/(telefono|phone|cellulare|mobile|whatsapp|numero_tel)/.test(k)) {
    return (valore.replace(/\D/g, '').length >= 6) ? 'telefono' : null
  }
  if (/(codice_fiscale|tax_code|(^|_)cf$)/.test(k)) return 'cf'
  if (/(partita_iva|p_?iva|(^|_)vat$|vat_number)/.test(k)) return 'piva'
  if (/iban/.test(k)) return 'iban'
  // Solo il codice: `sdi_status`, `sdi_message` & co. sono stati, non dati.
  if (/^(sdi|codice_sdi|sdi_code|codice_destinatario)$/.test(k) || k.endsWith('_sdi_code')) return 'sdi'
  if (/(indirizzo|address|(^|_)via$|street|residenza|domicilio)/.test(k)) {
    return valore.includes('@') ? 'email' : 'indirizzo'
  }
  if (/(luogo_nascita|birth_place|place_of_birth|comune_nascita)/.test(k)) return 'citta'
  if (/(data_nascita|birth_date|date_of_birth|dob)/.test(k)) return 'data-nascita'
  if (/(patente|licen[sc]e_number|numero_documento|documento_numero|carta_identita|passaporto)/.test(k)) {
    // `patente_scadenza` e simili portano una data, non un numero di documento.
    return /^\d{4}-\d{2}-\d{2}/.test(valore) ? null : 'documento'
  }
  if (/^(note|notes|messaggio|message|descrizione|description|oggetto|subject|body|testo|contenuto|commento|commenti|dettagli|osservazioni)$/.test(k)) return 'testo'
  if (persona && SE_PERSONA.has(k)) return 'nome'
  return null
}

/** Questa scheda parla di una persona? (decide sui campi ambigui come `nome`) */
function sembraPersona(oggetto: Record<string, unknown>): boolean {
  for (const k of Object.keys(oggetto)) {
    const kk = k.toLowerCase()
    if (kk === 'cognome' || kk === 'last_name' || kk === 'codice_fiscale'
        || kk === 'data_nascita' || kk === 'luogo_nascita' || kk === 'numero_patente'
        || kk === 'customer_name' || kk === 'customer_email' || kk === 'customer_phone') {
      return true
    }
    if ((kk === 'email' || kk === 'telefono' || kk === 'phone') && typeof oggetto[k] === 'string') return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Dizionario reale -> finto, per ripulire anche i testi liberi
// ---------------------------------------------------------------------------

const dizionario = new Map<string, string>()
const LIMITE_DIZIONARIO = 1200
let cercaTutti: RegExp | null = null

function ricorda(reale: string, finto: string): void {
  if (dizionario.size >= LIMITE_DIZIONARIO) return
  const chiave = reale.trim().toLowerCase()
  if (chiave.length < 4 || dizionario.has(chiave)) return
  dizionario.set(chiave, finto)
  cercaTutti = null // il dizionario e' cambiato: la ricerca si ricostruisce
}

/**
 * Nelle note, nei messaggi e nelle descrizioni i nomi sono scritti dentro la
 * frase: nessuna chiave da mascherare. Si riusano i valori gia' incontrati,
 * cercandoli tutti in una passata sola.
 */
function ripuliscTesto(testo: string): string {
  if (!testo || testo.length > 4000 || dizionario.size === 0) return testo
  if (!cercaTutti) {
    // I piu' lunghi per primi: "Mario Rossi" prima di "Rossi".
    const voci = [...dizionario.keys()]
      .sort((a, b) => b.length - a.length)
      .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    cercaTutti = new RegExp(voci.join('|'), 'gi')
  }
  return testo.replace(cercaTutti, trovato => dizionario.get(trovato.toLowerCase()) || trovato)
}

function valoreFinto(genere: Genere, valore: string): string {
  switch (genere) {
    case 'nome': return nomeFinto(valore)
    case 'solo-nome': return soloNomeFinto(valore)
    case 'solo-cognome': return soloCognomeFinto(valore)
    case 'azienda': return aziendaFinta(valore)
    case 'email': return emailFinta(valore)
    case 'telefono': return telefonoFinto(valore)
    case 'cf': return cfFinto(valore)
    case 'piva': return pivaFinta(valore)
    case 'iban': return ibanFinto(valore)
    case 'indirizzo': return indirizzoFinto(valore)
    case 'citta': return cittaFinta(valore)
    case 'documento': return documentoFinto(valore)
    case 'sdi': return sdiFinto(valore)
    case 'data-nascita': return dataFinta(valore)
    default: return valore
  }
}

const PROFONDITA_MASSIMA = 12

/** Percorre la risposta e sostituisce i campi personali. */
function maschera(dato: unknown, profondita: number, persona = false): unknown {
  if (profondita > PROFONDITA_MASSIMA) return dato
  if (Array.isArray(dato)) return dato.map(v => maschera(v, profondita + 1, persona))
  if (dato === null || typeof dato !== 'object') return dato

  const oggetto = dato as Record<string, unknown>
  const eScheda = persona || sembraPersona(oggetto)
  const fuori: Record<string, unknown> = {}

  for (const chiave of Object.keys(oggetto)) {
    const valore = oggetto[chiave]

    if (typeof valore === 'string' && valore) {
      const genere = genereDelCampo(chiave, valore, eScheda)
      if (genere === 'testo') {
        fuori[chiave] = ripuliscTesto(valore)
      } else if (genere) {
        const finto = valoreFinto(genere, valore)
        if (genere === 'nome' || genere === 'azienda' || genere === 'email'
            || genere === 'telefono' || genere === 'solo-cognome') {
          ricorda(valore, finto)
        }
        // Quello che si vede a schermo va anche sfocato: si segnano sia il
        // valore vero (se qualcosa sfuggisse alla mascheratura) sia il finto.
        segnaSensibile(valore)
        segnaSensibile(finto)
        // L'operatore collegato resta se stesso: i controlli di ruolo lo cercano.
        fuori[chiave] = (genere === 'email' && emailOperatore && valore.toLowerCase() === emailOperatore)
          ? valore
          : finto
      } else {
        fuori[chiave] = valore
      }
      continue
    }

    if (valore && typeof valore === 'object') {
      // Un JSONB come `customer_data` o `booking_details` e' una scheda a se':
      // la decisione sui campi ambigui si rifa' guardando dentro.
      fuori[chiave] = maschera(valore, profondita + 1, false)
      continue
    }

    fuori[chiave] = valore
  }

  return fuori
}

/** Uguale a quello che vede il gestionale: usato dai test. */
export function mascheraDati(dato: unknown): unknown {
  return maschera(dato, 0)
}

// ---------------------------------------------------------------------------
// Sfocatura a schermo
// ---------------------------------------------------------------------------
//
// Sostituire i dati non basta: un nome finto sembra un nome vero, e a schermo
// non si vede nessuna differenza — chi guarda la registrazione non sa se la
// modalita' e' accesa. Quello che appare va anche SFOCATO.
//
// Non si possono marcare i campi uno per uno: sono duecento schede. Si guarda
// il testo che finisce nella pagina e si sfoca l'elemento che lo contiene,
// aggiungendo una classe. Solo un attributo: React puo' ridisegnare quanto
// vuole, l'osservatore rimette la classe al giro dopo.

/** Valori (veri e finti) che a schermo vanno sfocati. */
const valoriSensibili = new Set<string>()
const LIMITE_SENSIBILI = 2000
let cercaSensibili: RegExp | null = null

function segnaSensibile(valore: string): void {
  if (valoriSensibili.size >= LIMITE_SENSIBILI) return
  const v = valore.trim().toLowerCase()
  if (v.length < 3 || v.length > 120 || valoriSensibili.has(v)) return
  valoriSensibili.add(v)
  cercaSensibili = null
  nodiVisti = new WeakSet<Text>() // c'e' qualcosa di nuovo da cercare
  programmaScansione()
}

/** Riconoscimenti che valgono anche senza dizionario. */
const SCHEMI_SENSIBILI: RegExp[] = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,                 // email
  /(?:\+\d{1,3}[\s.-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/, // cellulare italiano
  /\bIT\d{2}[A-Z]\d{10,22}\b/i,                            // IBAN
  /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/i,            // codice fiscale
]

/** Campi di scrittura da sfocare anche se vuoti. */
const CAMPO_PERSONALE = /(nome|cognome|email|mail|telefono|phone|cellulare|indirizzo|address|codice_?fiscale|partita_?iva|piva|iban|patente|documento|nascita)/i

function vaOscurato(testo: string): boolean {
  const t = testo.trim()
  if (t.length < 3) return false
  if (!cercaSensibili && valoriSensibili.size > 0) {
    const voci = [...valoriSensibili]
      .sort((a, b) => b.length - a.length)
      .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    cercaSensibili = new RegExp(voci.join('|'), 'i')
  }
  if (cercaSensibili && cercaSensibili.test(t)) return true
  return SCHEMI_SENSIBILI.some(schema => schema.test(t))
}

/** Elementi che non vanno mai sfocati per intero. */
const MAI_SFOCARE = new Set(['HTML', 'BODY', 'HEADER', 'NAV', 'MAIN', 'TABLE', 'TBODY', 'THEAD', 'TR', 'FORM'])

let nodiVisti = new WeakSet<Text>()
let attesa: ReturnType<typeof setTimeout> | null = null

function programmaScansione(): void {
  if (attesa) return
  attesa = setTimeout(() => {
    attesa = null
    try {
      scansiona()
    } catch { /* una schermata storta non deve fermare il gestionale */ }
  }, 120)
}

function scansiona(): void {
  if (!document.body) return

  const cammino = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let nodo = cammino.nextNode()
  while (nodo) {
    const testo = nodo as Text
    if (!nodiVisti.has(testo)) {
      nodiVisti.add(testo)
      const contenuto = testo.nodeValue || ''
      if (contenuto.length <= 400 && vaOscurato(contenuto)) {
        const el = testo.parentElement
        if (el && !el.classList.contains('oscurato')
            && !MAI_SFOCARE.has(el.tagName)
            && el.children.length <= 12
            && !el.closest('.oscurato')) {
          el.classList.add('oscurato')
        }
      }
    }
    nodo = cammino.nextNode()
  }

  // Nei campi di scrittura il testo non e' un nodo della pagina: si guarda
  // il valore, e il nome del campo per quelli ancora vuoti.
  const campi = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  for (const campo of campi) {
    if (campo.classList.contains('oscurato')) continue
    if ((campo as HTMLInputElement).type === 'password') continue
    const etichetta = `${campo.name || ''} ${campo.id || ''} ${campo.getAttribute('placeholder') || ''}`
    if (CAMPO_PERSONALE.test(etichetta) || vaOscurato(campo.value || '')) {
      campo.classList.add('oscurato')
    }
  }
}

/** Prima passata e sorveglianza di quello che React ridisegna. */
function avviaSfocatura(): void {
  scansiona()
  new MutationObserver(programmaScansione).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

// ---------------------------------------------------------------------------
// Intercettazione della rete
// ---------------------------------------------------------------------------

/** Tabelle di sistema/personale: mascherarle romperebbe ruoli e configurazioni. */
const TABELLE_ESCLUSE = new Set([
  'admins', 'operatori_persone', 'operatore_contratto', 'timesheet_entries',
  'timesheet_day_notes', 'centralina_pro_config', 'rental_config',
  'system_messages', 'system_message_variables', 'system_alarms',
  'system_otp_overrides', 'app_settings', 'service_secrets', 'cauzioni_config',
])

/** Chiamate che non vanno né mascherate né bloccate. */
function daLasciareStare(url: string): boolean {
  if (url.includes('/auth/v1/')) return true      // sessione: mascherarla = fuori dal gestionale
  if (url.includes('/storage/v1/')) return true   // file, non JSON di schede
  if (url.includes('/realtime/v1/')) return true
  const rest = /\/rest\/v1\/([a-z0-9_]+)/i.exec(url)
  if (rest && TABELLE_ESCLUSE.has(rest[1].toLowerCase())) return true
  return false
}

/**
 * Le RPC viaggiano in POST anche quando leggono soltanto (search_customers_extended,
 * operatore_minuti_lavorati, dr7_recent_logins...): fermarle tutte svuoterebbe
 * mezzo gestionale. Si fermano solo quelle che scrivono davvero.
 */
const RPC_CHE_SCRIVONO = /^(mark_|set_|update_|insert_|upsert_|delete_|incrementa|decrementa|inv_apply|book_with_credits|crea|salva|aggiorna|elimina|assegna|genera|invia)/

/** Parole che rendono una funzione Netlify una scrittura o un invio. */
const FUNZIONI_CHE_SCRIVONO = /(send|invia|create|crea|generate|genera|update|aggiorna|delete|elimina|save|salva|upload|charge|addebito|pay|nexi|invoice|fattura|sdi|sign|firma|trigger|import|process|reconcile|confirm|conferma|cancel|annulla|refund|rimborso|otp|whatsapp|email|sms|campaign|campagna|assign|link-|unlink|set-|seed|migrate|run-)/

function eScrittura(url: string, metodo: string): boolean {
  if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return false

  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(url)
  if (rpc) return RPC_CHE_SCRIVONO.test(rpc[1].toLowerCase())
  if (url.includes('/rest/v1/')) return true

  const fn = /\/\.netlify\/functions\/([a-z0-9-_]+)/i.exec(url)
  if (fn) return FUNZIONI_CHE_SCRIVONO.test(fn[1].toLowerCase())

  return false
}

function urlDi(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return String(input)
}

function metodoDi(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

/** Risposta finta di successo per una scrittura fermata. */
function rispostaFermata(url: string): Response {
  const corpo = url.includes('/rest/v1/') ? '[]' : JSON.stringify({ success: true, oscurato: true })
  return new Response(corpo, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
  })
}

async function mascheraRisposta(res: Response): Promise<Response> {
  const tipo = res.headers.get('content-type') || ''
  if (!tipo.includes('json')) return res
  if (!res.ok) return res

  let testo: string
  try {
    testo = await res.text()
  } catch {
    return res
  }
  if (!testo) return new Response(testo, { status: res.status, statusText: res.statusText, headers: res.headers })

  const intestazioni = new Headers(res.headers)
  intestazioni.delete('content-length')

  let dati: unknown
  try {
    dati = JSON.parse(testo)
  } catch {
    return new Response(testo, { status: res.status, statusText: res.statusText, headers: intestazioni })
  }

  let mascherato: string
  try {
    mascherato = JSON.stringify(maschera(dati, 0))
  } catch {
    mascherato = testo
  }
  return new Response(mascherato, { status: res.status, statusText: res.statusText, headers: intestazioni })
}

/**
 * Si installa in main.tsx, prima che l'app parta. Se la modalita' e' spenta
 * non fa assolutamente nulla: nessun costo, nessun rischio sul gestionale
 * di tutti i giorni.
 */
export function installaOscuramento(): void {
  if (!oscuraAttivo()) return

  document.documentElement.setAttribute('data-oscura', '')

  if (document.body) avviaSfocatura()
  else document.addEventListener('DOMContentLoaded', avviaSfocatura, { once: true })

  const finestra = window as unknown as { __dr7OscuraInstallato?: boolean }
  if (finestra.__dr7OscuraInstallato) return
  finestra.__dr7OscuraInstallato = true

  const originale = window.fetch.bind(window)

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = urlDi(input)

    if (daLasciareStare(url)) return originale(input as RequestInfo, init)

    if (eScrittura(url, metodoDi(input, init))) {
      console.info('[Oscurare] scrittura fermata:', url)
      return rispostaFermata(url)
    }

    const res = await originale(input as RequestInfo, init)
    try {
      return await mascheraRisposta(res)
    } catch {
      return res
    }
  }
}
