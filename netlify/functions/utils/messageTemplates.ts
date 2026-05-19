/**
 * Shared utility: loads message templates from system_messages Supabase table.
 *
 * IMPORTANT: NO HARDCODED FALLBACKS.
 * - If a template does not exist in system_messages → returns null.
 * - If a template is disabled → returns null.
 * - Callers MUST check for null and skip sending.
 *
 * Variables in templates use {variable_name} syntax.
 */
import { createClient } from '@supabase/supabase-js'
// 2026-05-19: LABEL_FALLBACKS import rimosso — non più usato dal resolver.
// L'unica fonte di routing è handled_events (Programmazione admin).
import { OLD_TO_PRO as SHARED_OLD_TO_PRO } from '../../../src/utils/proTemplateRouting'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

interface MessageTemplate {
  message_key: string
  message_body: string
  is_enabled: boolean
  include_header: boolean
  label?: string
  // DB-driven event routing (admin-editable). Quando un template
  // dichiara di gestire una chiave evento legacy (es. 'rental_new_customer'),
  // questa lista vince sulla mappa hardcoded OLD_TO_PRO. Vuota o null →
  // fallback alla mappa hardcoded (compatibilità con installazioni che
  // non hanno ancora applicato la migrazione `handled_events`).
  handled_events?: string[] | null
  // Service-type filter del template. Quando più template claimano lo
  // stesso evento, il resolver preferisce quello il cui
  // target_service_type matcha il booking corrente (passato via
  // RenderContext.serviceType) prima di ricadere sull'ordine di
  // inserimento. Vedi resolveKeyForContext sotto.
  target_service_type?: string | null
}

/**
 * Fallback label matchers. SINGLE SOURCE OF TRUTH in
 * `src/utils/proTemplateRouting.ts` — sia il resolver server (qui)
 * sia la UI client (MessaggiSistemaProTab) leggono dalla stessa
 * mappa così non possono divergere. Importato come
 * SHARED_LABEL_FALLBACKS in testa al file.
 *
 * Per la sintassi: ogni voce mappa pro_key → lista ordinata di
 * AND-group. Il primo gruppo dove tutti i frammenti sono presenti
 * nella label del template enabled+non-vuoto vince. Pattern più
 * specifici stanno prima per non essere "rubati" da pattern più
 * generici.
 */
// 2026-05-19: LABEL_FALLBACKS rimosso. Il resolver usa solo handled_events.

/**
 * Old-key → Pro-key router.
 *
 * SINGLE SOURCE OF TRUTH: la mappa vive in
 * `src/utils/proTemplateRouting.ts` così sia il server (questo file,
 * per il render dei template) sia il client (MessaggiSistemaProTab,
 * per mostrare all'admin "quando parte davvero ogni template") usano
 * gli stessi dati. NON duplicare la mappa qui — modifica solo il file
 * condiviso.
 *
 * Comportamento: ogni chiamata legacy `renderTemplate('rental_new_customer', ...)`
 * viene silenziosamente reindirizzata al template pro_* mappato al
 * momento del render. Chiavi non mappate → null → l'invio viene saltato
 * (niente fallback hardcoded).
 *
 * Le varianti admin (rental_new, rental_new_admin, carwash_new,
 * carwash_new_admin) puntano allo STESSO slot pro_* della variante
 * customer — scelta di prodotto: admin riceve lo stesso messaggio del
 * cliente.
 */
const OLD_TO_PRO: Record<string, string> = SHARED_OLD_TO_PRO

export interface RenderContext {
  vehiclePlate?: string | null
  /** Service type del booking corrente — usato dal resolver per dare
      precedenza, in caso di conflitto, ai template con target_service_type
      che matcha il booking (es. car_wash su un booking lavaggio batte un
      canonical con target_service_type=null/'all'). */
  serviceType?: string | null
}

/**
 * Resolves every legacy key to its Pro equivalent.
 *
 * - Key already starts with 'pro_' → pass through unchanged.
 * - Wrapper keys (old or pro namespace) → pass through unchanged.
 * - Key is in OLD_TO_PRO → return the pro_* key IF that template is enabled + non-empty.
 * - Otherwise → return null (caller MUST skip sending — no hardcoded fallback).
 */
export async function resolveKeyForContext(key: string, _context?: RenderContext): Promise<string | null> {
  void _context
  if (key === 'message_wrapper_header' || key === 'message_wrapper_footer') return key

  // 2026-05-19: rimosso `resolveWithLabelFallback` (era un helper che faceva
  // match dei template per label se il canonical pro_* mancava). Bypassava
  // i handled_events configurati dall'admin → la direzione vedeva template
  // partire su eventi che NON aveva selezionato in Programmazione. Adesso
  // l'unica fonte di routing è `handled_events`, gestito da
  // Messaggi di Sistema Pro > Programmazione.

  const templates = await loadAllTemplates()

  if (key.startsWith('pro_')) {
    // BUG FIX 2026-05-13: i caller (CarWashBookingsTab, ReservationsTab,
    // PreventiviTab, ecc.) passano spesso direttamente il canonical
    // `pro_richiesta_pagamento`. Senza questo blocco il resolver tornava
    // il canonical fisso, bypassando completamente i handled_events
    // configurati dall'admin sui template custom (es. il custom
    // "Link pagamento lavaggi" per car_wash non veniva mai usato).
    //
    // Risolto facendo un REVERSE LOOKUP sul OLD_TO_PRO: dato il pro_key
    // ricevuto, troviamo tutti i legacy events che lo mappano e cerchiamo
    // template con handled_events che claimano uno di quei legacy. Il
    // service_type ranking poi sceglie il match migliore.
    const reverseLegacy: string[] = []
    for (const [legacy, pro] of Object.entries(OLD_TO_PRO)) {
      if (pro === key) reverseLegacy.push(legacy)
    }
    if (reverseLegacy.length > 0) {
      const eventBased = templates.filter(t =>
        Array.isArray(t.handled_events)
        && t.handled_events.some(ev => reverseLegacy.includes(ev))
        && t.is_enabled
        && !!t.message_body
      )
      if (eventBased.length > 0) {
        const ctxSvc = (_context?.serviceType || '').toLowerCase()
        const normalisedSvc = ctxSvc === 'mechanical_service' ? 'mechanical'
          : ctxSvc === 'car_wash' ? 'car_wash'
          : ctxSvc === 'mechanical' ? 'mechanical'
          : ctxSvc === 'rental' ? 'rental'
          : ''
        const score = (tplSvc: string | null | undefined): number => {
          const s = String(tplSvc || 'all').toLowerCase()
          if (s === 'all' || s === '') return 1
          if (!normalisedSvc) return s === 'all' ? 1 : 0
          if (s === normalisedSvc) return 3
          if (s === 'prime_wash' && (normalisedSvc === 'car_wash' || normalisedSvc === 'mechanical')) return 2
          return 0
        }
        const ranked = eventBased
          .map(t => ({ t, r: score(t.target_service_type) }))
          .filter(x => x.r > 0)
          .sort((a, b) => b.r - a.r)
        if (ranked.length > 0) return ranked[0].t.message_key
      }
    }
    // 2026-05-19: rispetta SOLO handled_events. Se nessun template li ha
    // configurati per gli eventi di questo pro_key, prova il canonical
    // esatto SE è enabled+non vuoto. Niente label-fallback fuzzy: l'admin
    // assegna gli eventi in Programmazione, fine.
    const canonical = templates.find(t => t.message_key === key)
    if (canonical && canonical.is_enabled && canonical.message_body) {
      return key
    }
    console.warn(`[resolveKeyForContext] No Pro template handles "${key}" — message skipped. Verifica handled_events o riabilita il canonical.`)
    return null
  }

  // 1. DB-driven event routing (admin-editable). Cerca i template
  // enabled+non-vuoto che dichiarano di gestire questa chiave evento via
  // handled_events. Vince sulla mappa hardcoded OLD_TO_PRO così l'admin
  // può riassegnare gli eventi senza intervento dev.
  //
  // Quando PIÙ template claimano lo stesso evento (es. canonical
  // pro_richiesta_pagamento + custom pro_custom_link_pagamento_lavaggi),
  // diamo precedenza al template il cui target_service_type matcha il
  // serviceType del booking passato in _context. Senza questa logica il
  // primo trovato vinceva e i template custom service-specific venivano
  // mascherati dai canonical seedati.
  //
  // 2026-05-19: ESCLUDI i template legacy (con message_key uguale a una chiave
  // di OLD_TO_PRO) dai candidati. Altrimenti, se l'admin aveva un legacy row
  // (es. `rental_new_customer`) con handled_events che include se stesso, il
  // resolver tornava il legacy invece del pro_* assegnato dall'admin in UI.
  // Risultato: la "Programmazione" custom impostata dall'admin in
  // Messaggi di Sistema Pro veniva ignorata e partiva sempre il body legacy
  // (spesso con placeholders extra non sostituiti).
  const candidates = templates.filter(t =>
    Array.isArray(t.handled_events)
    && t.handled_events.includes(key)
    && t.is_enabled
    && !!t.message_body
    && !(t.message_key && Object.prototype.hasOwnProperty.call(OLD_TO_PRO, t.message_key))
  )
  if (candidates.length > 0) {
    const ctxSvc = (_context?.serviceType || '').toLowerCase()
    const normalisedSvc = ctxSvc === 'mechanical_service' ? 'mechanical'
      : ctxSvc === 'car_wash' ? 'car_wash'
      : ctxSvc === 'mechanical' ? 'mechanical'
      : ctxSvc === 'rental' ? 'rental'
      : ''
    // Rank: 3 = service-type match esatto, 2 = match via prime_wash umbrella,
    // 1 = target_service_type 'all'/null (generic), 0 = mismatch esplicito.
    const score = (tplSvc: string | null | undefined): number => {
      const s = String(tplSvc || 'all').toLowerCase()
      if (s === 'all' || s === '') return 1
      if (!normalisedSvc) return s === 'all' ? 1 : 0
      if (s === normalisedSvc) return 3
      if (s === 'prime_wash' && (normalisedSvc === 'car_wash' || normalisedSvc === 'mechanical')) return 2
      return 0
    }
    const ranked = candidates
      .map(t => ({ t, r: score(t.target_service_type) }))
      .filter(x => x.r > 0)
      .sort((a, b) => b.r - a.r)
    if (ranked.length > 0) return ranked[0].t.message_key
  }

  // 2026-05-19: NO MORE HARDCODED FALLBACK.
  //
  // Prima qui c'era un fallback su OLD_TO_PRO + LABEL_FALLBACKS che faceva
  // partire il template canonical (es. pro_conferma_da_saldare per
  // payment_received_damages) anche quando l'admin aveva tolto quell'evento
  // dalla Programmazione del template. Ignorava completamente le scelte
  // della direzione.
  //
  // Adesso: SOLO i template con handled_events che include l'evento
  // possono fire. Se la direzione vuole che un template gestisca un
  // evento, lo seleziona in Messaggi di Sistema Pro > Programmazione.
  // Se nessun template lo gestisce → nessun messaggio (silent skip + log).
  //
  // Log esplicito così, se qualcosa NON parte, l'admin vede in console
  // / Netlify logs quale evento è "orfano" e può assegnarlo.
  console.warn(`[resolveKeyForContext] No Pro template has "${key}" in handled_events — message skipped. Assegna l'evento a un pro_* in Messaggi di Sistema Pro > Programmazione se vuoi che parta.`)
  return null
}

// No cache — admin edits to Pro templates must take effect on the very next
// message send. The DB select is a small, indexed read; the staleness risk
// of a 60s cache (edit in admin → still sending old text) is unacceptable
// for a live messaging system.
async function loadAllTemplates(): Promise<MessageTemplate[]> {
  try {
    if (!supabaseUrl || !supabaseKey) return []
    const supabase = createClient(supabaseUrl, supabaseKey)
    // Tentiamo SELECT con handled_events; se la colonna non esiste ancora
    // (migrazione non applicata) ricadiamo allo schema vecchio così il
    // resolver continua a funzionare via OLD_TO_PRO fallback.
    let { data, error } = await supabase
      .from('system_messages')
      .select('message_key, message_body, is_enabled, include_header, label, handled_events, target_service_type')
    if (error && /column .* does not exist|handled_events/i.test(error.message || '')) {
      const fallback = await supabase
        .from('system_messages')
        .select('message_key, message_body, is_enabled, include_header, label')
      data = fallback.data
      error = fallback.error
    }
    if (error) throw error
    return (data || []) as MessageTemplate[]
  } catch {
    return []
  }
}

/**
 * Get a message template by key, with variable substitution.
 * Returns null if template is disabled, not found, or DB unavailable.
 * The optional `fallback` argument is IGNORED — kept for backwards compat only.
 */
export async function getMessageTemplate(
  key: string,
  variables: Record<string, string> = {},
  _fallback?: string,
  context?: RenderContext
): Promise<string | null> {
  void _fallback // explicitly ignored — no hardcoded fallbacks
  const effectiveKey = await resolveKeyForContext(key, context)
  if (effectiveKey === null) return null // TEST002 with no Pro equivalent → skip send
  const templates = await loadAllTemplates()
  const tpl = templates.find(t => t.message_key === effectiveKey)

  if (!tpl) return null               // Missing → don't send
  if (!tpl.is_enabled) return null    // Disabled → don't send
  if (!tpl.message_body) return null  // Empty body → don't send

  let body = tpl.message_body

  // Replace variables. Accept BOTH bare (`name`) and wrapped (`{name}`) keys
  // coming in, and substitute every brace-wrapped form the template may
  // contain ({name}, {{name}}, { name }). Historically some callers passed
  // wrapped keys here — previously they'd produce a `\{\{name\}\}` regex that
  // only matched `{{name}}` in the body, silently leaving `{name}` untouched.
  //
  // Aliases: caller passes `custName` / `customer_name` but the Italian
  // template typically uses `{nome}` or `{name}` — without these synonyms
  // the substitution silently leaves the literal `{nome}` token in the
  // outgoing WhatsApp. Same logic mirrors send-whatsapp-notification.ts.
  const ALIASES: Record<string, string[]> = {
    custName:      ['name', 'nome', 'customer_name', 'cliente', 'fullName', 'full_name', 'firstName'],
    customer_name: ['name', 'nome', 'cliente', 'fullName', 'full_name', 'firstName', 'custName'],
    nome:          ['name', 'custName', 'customer_name', 'cliente', 'fullName', 'full_name', 'firstName'],
    name:          ['nome', 'custName', 'customer_name', 'cliente', 'fullName', 'full_name', 'firstName'],
    firstName:     ['name', 'nome', 'custName', 'customer_name', 'cliente'],
    full_name:     ['name', 'nome', 'custName', 'customer_name', 'cliente', 'fullName'],
    email:         ['customer_email'],
    customer_email:['email'],
    phone:         ['telefono', 'customer_phone'],
    customer_phone:['telefono', 'phone'],
    amountEur:     ['amount', 'importo', 'totale', 'total'],
    amount:        ['amountEur', 'importo', 'totale', 'total'],
    importo:       ['amountEur', 'amount', 'totale', 'total'],
    // Booking identifier — il caller passa {booking_id} ma l'admin spesso
    // scrive {booking-id}, {bookingId}, {ref} o {codice} nel template. Tutti
    // gli alias risolvono allo stesso valore cosi' nessuno vede placeholder
    // letterali tipo "booking-id" nel messaggio uscente.
    booking_id:    ['booking_ref', 'bookingId', 'bookingRef', 'ref', 'reference', 'codice', 'booking-id', 'booking-ref'],
    booking_ref:   ['booking_id', 'bookingId', 'bookingRef', 'ref', 'reference', 'codice', 'booking-id', 'booking-ref'],
  }
  const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const replaceFor = (key: string, value: string) => {
    body = body.replace(new RegExp(`\\{\\s*${escRx(key)}\\s*\\}`, 'g'), value)
    body = body.replace(new RegExp(`\\{\\{\\s*${escRx(key)}\\s*\\}\\}`, 'g'), value)
  }
  for (const [rawKey, v] of Object.entries(variables)) {
    const cleanKey = String(rawKey).replace(/^\s*\{+\s*|\s*\}+\s*$/g, '').trim()
    if (!cleanKey) continue
    // Trim the substituted value. WhatsApp's *bold* / _italic_ only render
    // when the markers are tight to the text — `*Thomas *` (with a trailing
    // space coming from a dirty customer.nome) renders raw, but `*Thomas*`
    // bolds correctly. Trimming here removes incidental whitespace from
    // database values without forcing a data cleanup.
    const cleanV = (v ?? '').trim()
    replaceFor(cleanKey, cleanV)
    for (const alias of ALIASES[cleanKey] || []) replaceFor(alias, cleanV)
  }
  // Defensive cleanup for `*bold*` / `_italic_` — ONLY when the leading
  // marker is clearly NOT a bullet (a bullet `*` lives at line start with
  // a trailing space). Previous version false-positived on bulleted lines
  // like `* Buono sconto di *€100*`, eating bullet spaces and merging
  // surrounding text. The (?<=\S) lookbehind requires a non-whitespace
  // char immediately before the opening marker, so list items at line
  // start are skipped entirely.
  body = body.replace(/(?<=\S)(\*)\s+([^\s*][^*\n]*?)\s+(\*)(?=\s|[.,;:!?)\]]|$)/g, '$1$2$3')
  body = body.replace(/(?<=\S)(_)\s+([^\s_][^_\n]*?)\s+(_)(?=\s|[.,;:!?)\]]|$)/g, '$1$2$3')

  // Add header/footer ONLY if the template explicitly opts in
  // (include_header === true). Default is OFF — admin must tick the
  // "Includi header/footer" toggle on a template to wrap it. Wrapper
  // content comes from the admin-written `pro_wrapper_header` /
  // `pro_wrapper_footer` rows (labels "Header" / "Footer").
  if (tpl.include_header === true) {
    const headerTpl = templates.find(t => t.message_key === 'pro_wrapper_header' && t.is_enabled !== false)
    const footerTpl = templates.find(t => t.message_key === 'pro_wrapper_footer' && t.is_enabled !== false)
    if (headerTpl?.message_body) body = headerTpl.message_body + '\n\n' + body
    if (footerTpl?.message_body) body = body + '\n\n' + footerTpl.message_body
  }

  return body
}

/**
 * Render a template. Returns null if template missing/disabled.
 * The `fallback` argument is IGNORED — kept only for backwards compat with
 * existing callers. Callers MUST treat null as "do not send".
 */
export async function renderTemplate(
  key: string,
  variables: Record<string, string>,
  _fallback?: string,
  context?: RenderContext
): Promise<string | null> {
  void _fallback // explicitly ignored — no hardcoded fallbacks
  return getMessageTemplate(key, variables, undefined, context)
}
