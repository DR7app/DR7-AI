/**
 * Modalita' OSCURARE — dati dei clienti nascosti durante una registrazione schermo.
 *
 * A cosa serve: filmare il gestionale (demo, video di vendita, assistenza in
 * condivisione schermo) senza mostrare nomi, email, telefoni, indirizzi,
 * codici fiscali, partite IVA, IBAN e documenti dei clienti veri.
 *
 * Come funziona: i dati restano QUELLI VERI — non viene sostituito niente.
 * Quando la modalita' e' accesa ogni risposta (Supabase e funzioni Netlify)
 * passa di qui solo per RICONOSCERE quali valori sono personali; poi quei
 * valori, quando compaiono a schermo, vengono SFOCATI via CSS.
 *
 * 01/09/2026 — prima i valori venivano sostituiti con nomi finti plausibili.
 * Sul gestionale vero sembravano dati sbagliati e non era quello che serviva:
 * si deve conservare tutto correttamente e nascondere solo cio' che si vede.
 *
 * SICUREZZA — perche' la modalita' blocca comunque le scritture: e' una
 * modalita' di RIPRESA. Mentre si filma si clicca in giro, e senza blocco
 * partirebbero WhatsApp, email, fatture e pagamenti veri a clienti veri.
 * Quindi ogni scrittura (INSERT/UPDATE/DELETE su Supabase, invii, fatture,
 * pagamenti Nexi, firme) viene fermata nel browser e riceve una risposta
 * finta di successo: la registrazione scorre e nessuno riceve niente.
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
 * L'operatore collegato e' chi sta filmando: la sua email non va sfocata,
 * altrimenti non si vede piu' con che utenza si sta lavorando.
 */
let emailOperatore: string | null = null
export function proteggiOperatore(email?: string | null): void {
  emailOperatore = (email || '').trim().toLowerCase() || null
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

/**
 * Indizi che la riga parla di una COSA (veicolo, servizio, catalogo) e non di
 * una persona: li' `nome`/`name` sono "Lamborghini Urus", non un cliente.
 *
 * Serve perche' i report aggregano: una riga puo' avere il solo `nome` senza
 * email ne' telefono, e senza questo elenco l'unico modo per non scoprire i
 * clienti sarebbe sfocare anche i nomi dei mezzi.
 */
const COSE = new Set([
  'targa', 'plate', 'vehicle_id', 'veicolo', 'vehicle', 'vehicle_name',
  'categoria', 'category', 'service_type', 'servizio', 'price_per_day',
  'daily_rate', 'prezzo', 'price', 'marca', 'modello', 'model', 'brand',
  'is_active', 'nome_servizio', 'nome_categoria', 'nome_veicolo',
])

function sembraCosa(oggetto: Record<string, unknown>): boolean {
  for (const k of Object.keys(oggetto)) if (COSE.has(k.toLowerCase())) return true
  return false
}

function genereDelCampo(chiave: string, valore: string, persona: boolean, cosa = false): Genere {
  const k = chiave.toLowerCase()
  if (MAI.has(k)) return null

  if (NOMI_COMPLETI.has(k)) return 'nome'
  // `cliente` porta il nome del cliente nei report (monthly-report, cauzioni,
  // riconciliazioni). A volte pero' ci finisce l'email: va segnata lo stesso.
  if (k === 'cliente' || k === 'customer') return valore.includes('@') ? 'email' : 'nome'
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
  // `nome`/`name`: nei report la riga e' spesso aggregata (nome + totale) e non
  // porta ne' email ne' telefono, quindi `sembraPersona` da solo non bastava e i
  // clienti restavano in chiaro. Qui si copre per difetto e si lascia in chiaro
  // solo quando la riga parla di una cosa (veicolo, servizio, catalogo).
  if (SE_PERSONA.has(k)) return (persona || !cosa) ? 'nome' : null
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
    // Indizi di scheda cliente usati dai report (report-clienti, dashboard).
    if (kk === 'tipo_cliente' || kk === 'status_cliente' || kk === 'dr7_club'
        || kk === 'customerid' || kk === 'cliente' || kk === 'wallet_balance_eur') return true
  }
  return false
}

const PROFONDITA_MASSIMA = 12

/**
 * Percorre la risposta e SEGNA i campi personali, senza toccarli.
 *
 * 01/09/2026 — prima qui i valori venivano SOSTITUITI con nomi finti. Sul
 * gestionale vero quello si vedeva come dati sbagliati ("perche' ho dei nomi a
 * caso?"), e non era quello che serviva: i dati devono restare quelli giusti,
 * va nascosto solo cio' che si vede a schermo. Quindi il valore torna indietro
 * intatto e viene solo registrato fra quelli da SFOCARE.
 */
function maschera(dato: unknown, profondita: number, persona = false): unknown {
  if (profondita > PROFONDITA_MASSIMA) return dato
  if (Array.isArray(dato)) return dato.map(v => maschera(v, profondita + 1, persona))
  if (dato === null || typeof dato !== 'object') return dato

  const oggetto = dato as Record<string, unknown>
  const eScheda = persona || sembraPersona(oggetto)
  const eCosa = !eScheda && sembraCosa(oggetto)
  const fuori: Record<string, unknown> = {}

  for (const chiave of Object.keys(oggetto)) {
    const valore = oggetto[chiave]

    if (typeof valore === 'string' && valore) {
      const genere = genereDelCampo(chiave, valore, eScheda, eCosa)
      // I testi liberi (note, messaggi) non si segnano: dentro c'e' di tutto e
      // sfocare l'intera nota per una parola non serve. I nomi che contengono
      // vengono comunque colti, perche' sono gia' segnati come campo a se'.
      if (genere && genere !== 'testo') {
        // L'operatore collegato resta leggibile: e' lui che sta filmando.
        const suo = genere === 'email' && emailOperatore && valore.toLowerCase() === emailOperatore
        if (!suo) segnaSensibile(valore)
      }
      // Il dato NON viene mai cambiato.
      fuori[chiave] = valore
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

/** I valori riconosciuti come personali, cioe' quelli che verranno sfocati. */
export function elencoDaSfocare(): string[] {
  return [...valoriSensibili]
}

// ---------------------------------------------------------------------------
// Sfocatura a schermo
// ---------------------------------------------------------------------------
//
// I dati restano quelli veri: l'unica cosa che nasconde i clienti e' questa.
// Quello che compare a schermo e risulta personale va SFOCATO.
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
  nodiVisti = new WeakMap<Text, string>() // c'e' qualcosa di nuovo da cercare
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
    // Con molti clienti caricati l'alternanza diventa lunghissima: se il motore
    // la rifiuta, senza questa rete l'eccezione fermava TUTTA la scansione e
    // non si sfocava piu' niente.
    try {
      cercaSensibili = new RegExp(voci.join('|'), 'i')
    } catch {
      cercaSensibili = null
    }
  }
  if (cercaSensibili && cercaSensibili.test(t)) return true
  return SCHEMI_SENSIBILI.some(schema => schema.test(t))
}

/** Elementi che non vanno mai sfocati per intero. */
const MAI_SFOCARE = new Set(['HTML', 'BODY', 'HEADER', 'NAV', 'MAIN', 'TABLE', 'TBODY', 'THEAD', 'TR', 'FORM'])

/**
 * Nodo di testo gia' esaminato -> il contenuto che aveva quando lo si e' visto.
 *
 * 01/09/2026 — prima era un WeakSet del solo nodo, e bastava a perdere meta'
 * dei nomi: React NON ricrea i nodi di testo, ci riscrive dentro. Il nodo
 * veniva segnato "visto" con il contenuto di quel momento e non veniva piu'
 * riesaminato, cosi' il nome scritto dopo restava nitido mentre la riga
 * accanto era sfocata. Confrontando anche il CONTENUTO, un nodo riscritto
 * torna in coda.
 */
let nodiVisti = new WeakMap<Text, string>()
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
    const contenuto = testo.nodeValue || ''
    if (nodiVisti.get(testo) !== contenuto) {
      nodiVisti.set(testo, contenuto)
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

/**
 * Tipi che NON sono dati: leggerli come testo li rovinerebbe.
 * Tutto il resto si prova a interpretare come JSON.
 */
const BINARI = /^(image|video|audio|font)\/|application\/(pdf|octet-stream|zip|vnd)/i

export async function mascheraRisposta(res: Response): Promise<Response> {
  const tipo = res.headers.get('content-type') || ''
  // 01/09/2026 — NON si guarda piu' se l'intestazione dice "json".
  //
  // Netlify non mette `content-type` quando la function non lo dichiara, e 58
  // delle nostre non lo dichiarano: monthly-report e dashboard-kpi sono fra
  // quelle. Il risultato era che i report — proprio dove i clienti si vedono
  // tutti in fila — passavano in chiaro, anche con Oscurare acceso.
  //
  // Ora si esclude solo cio' che e' dichiaratamente binario; per il resto si
  // tenta il JSON e, se non lo e', il corpo torna indietro intatto.
  if (BINARI.test(tipo)) return res
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
