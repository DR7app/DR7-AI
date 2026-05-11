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
import { OLD_TO_PRO as SHARED_OLD_TO_PRO, LABEL_FALLBACKS as SHARED_LABEL_FALLBACKS } from '../../../src/utils/proTemplateRouting'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

interface MessageTemplate {
  message_key: string
  message_body: string
  is_enabled: boolean
  include_header: boolean
  label?: string
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
const LABEL_FALLBACKS: Record<string, string[][]> = SHARED_LABEL_FALLBACKS

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

  // Helper: if the chosen pro_* key has no enabled+non-empty row, try a
  // label-based match against custom (pro_custom_*) templates the admin
  // may have created.
  const resolveWithLabelFallback = async (proKey: string, templates: MessageTemplate[]): Promise<string | null> => {
    const pro = templates.find(t => t.message_key === proKey)
    if (pro && pro.is_enabled && pro.message_body) return proKey
    const groups = LABEL_FALLBACKS[proKey]
    if (groups && groups.length) {
      const enabled = templates.filter(t => t.is_enabled && t.message_body && t.label)
      // Try each AND-group in order. First group where a template has ALL
      // fragments in its lowercase label wins. More-specific groups are
      // listed first in LABEL_FALLBACKS so they take priority over generic
      // fallbacks like ['link pagamento'].
      for (const group of groups) {
        const match = enabled.find(t => {
          const lbl = (t.label || '').toLowerCase()
          return group.every(f => lbl.includes(f))
        })
        if (match) return match.message_key
      }
    }
    return null
  }

  const templates = await loadAllTemplates()

  if (key.startsWith('pro_')) {
    // Allow label-based fallback for predefined pro_* slots that are empty.
    return await resolveWithLabelFallback(key, templates)
  }

  const proKey = OLD_TO_PRO[key]
  if (!proKey) return null
  return await resolveWithLabelFallback(proKey, templates)
}

// No cache — admin edits to Pro templates must take effect on the very next
// message send. The DB select is a small, indexed read; the staleness risk
// of a 60s cache (edit in admin → still sending old text) is unacceptable
// for a live messaging system.
async function loadAllTemplates(): Promise<MessageTemplate[]> {
  try {
    if (!supabaseUrl || !supabaseKey) return []
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data, error } = await supabase
      .from('system_messages')
      .select('message_key, message_body, is_enabled, include_header, label')
    if (error) throw error
    return data || []
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
