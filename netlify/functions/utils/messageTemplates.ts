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
 * Fallback label matchers. Each entry is an ordered list of AND-groups:
 * the FIRST group where all fragments are present in the template's label
 * wins. This lets a specific template ("Link pagamento penali e danni")
 * beat a generic one ("Link Pagamento") for the penali flow, while the
 * generic "Link Pagamento" still serves the plain pay-by-link flow.
 */
const LABEL_FALLBACKS: Record<string, string[][]> = {
  pro_richiesta_pagamento: [
    ['link pagamento'],
    ['richiesta pagamento'],
    ['invio link pagamento'],
    ['pay by link'],
    ['payment link'],
  ],
  pro_modifica_noleggio: [
    ['modifica', 'noleggio'],
    ['modifica', 'prenotazione'],
    ['modifica', 'rental'],
    ['modifica', 'rent'],
  ],
  pro_modifica_lavaggio: [
    ['modifica', 'lavaggio'],
    ['modifica', 'prime wash'],
    ['modifica', 'primewash'],
    ['modifica', 'wash'],
  ],
  // Penali / Danni — prefer a template whose label explicitly mentions the
  // word, then fall through to a generic "Link Pagamento".
  pro_richiesta_penali: [
    ['link', 'pagamento', 'penal'],      // "Link pagamento penali e danni"
    ['penal'],
    ['link pagamento'],
    ['pay by link'],
  ],
  pro_richiesta_danni: [
    ['link', 'pagamento', 'dann'],        // "Link pagamento penali e danni"
    ['dann'],
    ['link pagamento'],
    ['pay by link'],
  ],
  pro_richiesta_danni_penali: [
    ['link', 'pagamento', 'dann', 'penal'], // most specific: both keywords
    ['link', 'pagamento', 'penal'],
    ['link', 'pagamento', 'dann'],
    ['dann'],
    ['penal'],
    ['link pagamento'],
  ],
  pro_richiesta_addebito: [
    ['link', 'pagamento', 'addebit'],
    ['addebit'],
    ['link pagamento'],
  ],
  pro_richiesta_estensione: [
    ['link', 'pagamento', 'estension'],
    ['estension'],
    ['link pagamento'],
  ],
  // Fidelity Card voucher — admin creates this template manually in Pro
  // with whatever name they prefer. We match by label keywords so the
  // exact name/key doesn't matter.
  pro_fidelity_voucher: [
    ['fidelity', 'voucher'],
    ['fidelity'],
    ['fedeltà'],
    ['buono', 'fidelity'],
    ['250', 'punti'],
    ['buono', 'prime', 'wash'],
  ],
  // Codice sconto post-recensione — admin generates real DR7-XXXX codes from
  // ReviewManagementTab and sends this template with the codes filled in.
  // Match a few plausible label spellings the admin may use.
  pro_marketing_codice_sconto: [
    ['codice', 'sconto', 'recensione'],
    ['codice', 'recensione'],
    ['sconto', 'recensione'],
    ['codice', 'sconto'],
    ['discount', 'review'],
  ],
  // Richiesta Recensione — il body inviato al cliente per chiedere il
  // feedback. Match il primo gruppo "richiesta recensione", poi gruppi
  // più larghi per template rinominati ("recensione", "review request").
  pro_marketing_recensione: [
    ['richiesta', 'recensione'],
    ['review', 'request'],
    ['recensione'],
  ],
  // Maxi Promo Gap 1GG — message #21 in Messaggi di Sistema Pro, body fully
  // editable by admin. Match by a few plausible label spellings so the
  // template resolves even when the admin-created row has a custom key.
  pro_maxi_promo_gap_1gg: [
    ['maxi', 'promo', 'gap', '1gg'],
    ['maxi', 'promo', 'gap'],
    ['maxi', 'promo'],
    ['gap', '1gg'],
    ['gap', '1', 'giorno'],
    ['promo', 'gap'],
  ],
  // Promo Incassi — sent when a vehicle's monthly revenue target hits its
  // 0.8-or-lower coefficient threshold. Body editable in Messaggi di Sistema Pro.
  pro_promo_incassi: [
    ['promo', 'incassi'],
    ['promo', 'incasso'],
    ['incassi', 'promo'],
  ],
}

/**
 * Old-key → Pro-key router.
 *
 * Messaggi di Sistema Pro is now the single source of truth. Every legacy call
 * to renderTemplate('rental_new_customer', ...) gets silently swapped to the
 * mapped pro_* template at render time. Unmapped legacy keys return null →
 * the send is skipped entirely (no hardcoded fallback).
 *
 * Admin variants (rental_new, rental_new_admin, carwash_new, carwash_new_admin)
 * intentionally point at the SAME pro_* slot as the customer variant — per the
 * product decision that admin should receive the same message as the client.
 *
 * Mapping derived from the BODY CONTENT of each pro_* template (labels have
 * been renamed, so the slot's purpose = its body, not its pro_* name).
 */
// IMPORTANT: This mapping points each legacy key to the Pro row that ACTUALLY
// holds the right body in this tenant's system_messages table. The rows are
// the ones already present in Messaggi di Sistema Pro — we do NOT require new
// rows to be created; we just route to where the body already lives.
const OLD_TO_PRO: Record<string, string> = {
  // Noleggio — customer + admin get the same template
  rental_new_customer: 'pro_conferma_noleggio',
  rental_new: 'pro_conferma_noleggio',
  rental_new_admin: 'pro_conferma_noleggio',
  // Modifica noleggio body lives in pro_promemoria_appuntamento
  rental_modified: 'pro_promemoria_appuntamento',
  deposit_return_iban: 'pro_richiesta_iban',

  // Lavaggio — customer + admin get the same template
  carwash_new_customer: 'pro_conferma_lavaggio',
  carwash_new: 'pro_conferma_lavaggio',
  carwash_new_admin: 'pro_conferma_lavaggio',
  // Modifica lavaggio body lives in pro_promemoria_pagamento
  carwash_modified: 'pro_promemoria_pagamento',

  // Meccanica (Prime Wash umbrella) — reuse lavaggio modifica
  mechanical_new_customer: 'pro_conferma_meccanica',
  mechanical_new: 'pro_conferma_meccanica',
  mechanical_new_admin: 'pro_conferma_meccanica',
  mechanical_modified: 'pro_promemoria_pagamento',

  // Firma & Contratto — each call routes to its dedicated Pro slot:
  //   signing-link  → "Richiesta Firma"
  //   reminder      → "Promemoria Firma"
  //   OTP           → "Richiesta OTP"   (admin-editable body for OTP send)
  signature_request_link: 'pro_richiesta_firma',
  signature_reminder_whatsapp: 'pro_promemoria_firma',
  signature_otp_whatsapp: 'pro_richiesta_otp',
  document_signature_link: 'pro_richiesta_firma',

  // Pagamenti & annullamenti — payment-link body now lives in pro_richiesta_pagamento,
  // cancellation body in pro_custom_prenotazione_annullata_da_sito_1776503923221
  payment_link_customer: 'pro_richiesta_pagamento',
  rental_da_saldare_customer: 'pro_richiesta_pagamento',
  booking_cancelled_whatsapp: 'pro_custom_prenotazione_annullata_da_sito_1776503923221',

  // Pagamento ricevuto (estensione, top-up, danni/penali) — il body vive in
  // pro_conferma_pagamento ("Conferma Pagamento"). Admin variants point al
  // medesimo slot (stessa scelta dell'altra famiglia rental_*_admin).
  // Senza queste righe ogni renderTemplate('payment_received_*') tornava
  // null e l'invio WhatsApp veniva silenziosamente saltato — confermati
  // estensione e danni/penali arrivavano nulla a cliente e admin.
  payment_received_extension: 'pro_conferma_pagamento',
  payment_received_extension_admin: 'pro_conferma_pagamento',
  payment_received_damages: 'pro_conferma_pagamento',
  payment_received_damages_admin: 'pro_conferma_pagamento',

  // Preventivi admin alert body lives in pro_richiesta_otp
  admin_new_website_quote: 'pro_richiesta_otp',
  admin_no_cauzione_request: 'pro_richiesta_otp',

  // Marketing & Wallet — review body lives in `pro_marketing_recensione`
  // (slot dedicato "Richiesta Recensione" in Messaggi di Sistema Pro). Era
  // mappato per errore su pro_promemoria_firma (la mappa era stata fatta
  // pensando che il body vivesse lì), ma il body firma e quello recensione
  // sono messaggi diversi: dirottare il review request sul template della
  // firma significava (a) inviare il testo della firma invece del review,
  // o (b) sovraccaricare il template firma con il body del review. La
  // mappa qui sotto ora punta allo slot corretto. Wallet cashback resta
  // su pro_wallet_bonus_cliente.
  review_request_whatsapp: 'pro_marketing_recensione',
  birthday_message: 'pro_marketing_compleanno',
  wallet_bonus_credit: 'pro_wallet_bonus_cliente',

  // Fidelity Card — voucher message fired at 250 punti.
  // Body lives in `pro_fidelity_voucher` so admin can edit it from
  // Messaggi di Sistema Pro without redeploying.
  fidelity_voucher_whatsapp: 'pro_fidelity_voucher',

  // Website customer actions
  website_booking_cancelled_customer: 'pro_custom_prenotazione_annullata_da_sito_1776503923221',
}

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
  const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const [rawKey, v] of Object.entries(variables)) {
    const cleanKey = String(rawKey).replace(/^\s*\{+\s*|\s*\}+\s*$/g, '').trim()
    if (!cleanKey) continue
    // Trim the substituted value. WhatsApp's *bold* / _italic_ only render
    // when the markers are tight to the text — `*Thomas *` (with a trailing
    // space coming from a dirty customer.nome) renders raw, but `*Thomas*`
    // bolds correctly. Trimming here removes incidental whitespace from
    // database values without forcing a data cleanup.
    const cleanV = (v ?? '').trim()
    body = body.replace(new RegExp(`\\{\\s*${escRx(cleanKey)}\\s*\\}`, 'g'), cleanV)
    body = body.replace(new RegExp(`\\{\\{\\s*${escRx(cleanKey)}\\s*\\}\\}`, 'g'), cleanV)
  }
  // Defensive cleanup for templates authored with stray spaces inside markers
  // (`* word *` / `_ word _`): convert them to tight `*word*` / `_word_` so
  // WhatsApp's formatter actually fires.
  body = body.replace(/(\*)\s+([^\s*][^*]*?)\s+(\*)(?=\s|[.,;:!?)\]]|$)/g, '$1$2$3')
  body = body.replace(/(_)\s+([^\s_][^_]*?)\s+(_)(?=\s|[.,;:!?)\]]|$)/g, '$1$2$3')

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
