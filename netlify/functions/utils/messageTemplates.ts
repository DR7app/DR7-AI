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
}

/**
 * Pro-template A/B gate.
 *
 * When a booking's vehicle plate matches TEST_PRO_PLATE, the sender swaps the
 * old message_key for the mapped `pro_*` key BEFORE fetching from DB. This
 * lets the admin validate new Pro templates on a test vehicle without
 * affecting real customers. Remove a mapping entry to stop the swap.
 */
const TEST_PRO_PLATE = 'TEST002'
const OLD_TO_PRO: Record<string, string> = {
  // Noleggio
  rental_new_customer: 'pro_conferma_noleggio',
  // Add more as Pro templates are configured:
  // rental_new: 'pro_admin_nuova_prenotazione',
  // rental_modified: 'pro_conferma_noleggio_modifica',
  // carwash_new_customer: 'pro_conferma_lavaggio',
  // mechanical_new_customer: 'pro_conferma_meccanica',
  // signature_request_link: 'pro_richiesta_firma',
  // payment_link_customer: 'pro_richiesta_pagamento',
  // deposit_return_iban: 'pro_richiesta_iban',
  // birthday_message: 'pro_marketing_compleanno',
  // review_request_whatsapp: 'pro_marketing_recensione',
  // referral_otp_whatsapp: 'pro_marketing_referral',
  // preventivo_whatsapp: 'pro_conferma_preventivo',
  // admin_no_cauzione_request: 'pro_admin_no_cauzione',
  // booking_cancelled_whatsapp: 'pro_annullamento_cliente',
}

function normalizePlate(plate?: string | null): string {
  return (plate || '').replace(/\s+/g, '').toUpperCase()
}

export interface RenderContext {
  vehiclePlate?: string | null
}

/**
 * If the booking is on the Pro-test vehicle AND a mapping + enabled Pro
 * template exist, returns the pro_* key to use. Otherwise returns the
 * original key unchanged.
 */
export async function resolveKeyForContext(key: string, context?: RenderContext): Promise<string> {
  if (!context) return key
  const normalized = normalizePlate(context.vehiclePlate)
  if (normalized !== TEST_PRO_PLATE) return key
  const proKey = OLD_TO_PRO[key]
  if (!proKey) return key
  const templates = await loadAllTemplates()
  const pro = templates.find(t => t.message_key === proKey)
  if (!pro || !pro.is_enabled || !pro.message_body) return key
  return proKey
}

// Cache templates for 60 seconds to avoid hammering DB
let cache: { templates: MessageTemplate[]; loadedAt: number } | null = null
const CACHE_TTL = 60_000

async function loadAllTemplates(): Promise<MessageTemplate[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL) return cache.templates
  try {
    if (!supabaseUrl || !supabaseKey) return []
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data, error } = await supabase
      .from('system_messages')
      .select('message_key, message_body, is_enabled, include_header')
    if (error) throw error
    cache = { templates: data || [], loadedAt: Date.now() }
    return cache.templates
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
  const templates = await loadAllTemplates()
  const tpl = templates.find(t => t.message_key === effectiveKey)

  if (!tpl) return null               // Missing → don't send
  if (!tpl.is_enabled) return null    // Disabled → don't send
  if (!tpl.message_body) return null  // Empty body → don't send

  let body = tpl.message_body

  // Replace variables
  for (const [k, v] of Object.entries(variables)) {
    body = body.replace(new RegExp(`\\{${k}\\}`, 'g'), v ?? '')
  }

  // Add header/footer if configured — pulled from DB, no hardcoded defaults
  if (tpl.include_header !== false) {
    const headerTpl = templates.find(t => t.message_key === 'message_wrapper_header' && t.is_enabled !== false)
    const footerTpl = templates.find(t => t.message_key === 'message_wrapper_footer' && t.is_enabled !== false)
    if (headerTpl?.message_body) body = headerTpl.message_body + '\n\n' + body
    if (footerTpl?.message_body) body = body + '\n\n' + footerTpl.message_body
  }

  return body
}

/**
 * Invalidate cache (call after admin edits a template)
 */
export function invalidateTemplateCache() {
  cache = null
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
