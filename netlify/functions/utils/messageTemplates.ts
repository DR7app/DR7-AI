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
const OLD_TO_PRO: Record<string, string> = {
  // Noleggio — customer + admin get the same template
  rental_new_customer: 'pro_conferma_noleggio',
  rental_new: 'pro_conferma_noleggio',
  rental_new_admin: 'pro_conferma_noleggio',
  rental_modified: 'pro_modifica_noleggio',
  rental_da_saldare_customer: 'pro_conferma_pagamento',
  deposit_return_iban: 'pro_richiesta_iban',

  // Lavaggio — customer + admin get the same template
  carwash_new_customer: 'pro_conferma_lavaggio',
  carwash_new: 'pro_conferma_lavaggio',
  carwash_new_admin: 'pro_conferma_lavaggio',
  carwash_modified: 'pro_modifica_lavaggio',

  // Meccanica (Prime Wash umbrella)
  mechanical_new_customer: 'pro_conferma_meccanica',
  mechanical_new: 'pro_conferma_meccanica',
  mechanical_new_admin: 'pro_conferma_meccanica',
  mechanical_modified: 'pro_modifica_meccanica',

  // Firma & Contratto
  signature_request_link: 'pro_conferma_contratto_firmato',
  signature_reminder_whatsapp: 'pro_conferma_preventivo',
  signature_otp_whatsapp: 'pro_promemoria_pickup',

  // Pagamenti & annullamenti
  payment_link_customer: 'pro_promemoria_dropoff',
  booking_cancelled_whatsapp: 'pro_richiesta_pagamento',

  // Preventivi
  preventivo_whatsapp: 'pro_promemoria_checkin',
  admin_new_website_quote: 'pro_richiesta_otp',
  admin_no_cauzione_request: 'pro_richiesta_firma',

  // Marketing & Wallet
  review_request_whatsapp: 'pro_promemoria_firma',
  birthday_message: 'pro_marketing_compleanno',
  wallet_bonus_credit: 'pro_richiesta_documenti',

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
  if (key.startsWith('pro_')) return key
  if (key === 'message_wrapper_header' || key === 'message_wrapper_footer') return key

  const proKey = OLD_TO_PRO[key]
  if (!proKey) return null

  const templates = await loadAllTemplates()
  const pro = templates.find(t => t.message_key === proKey)
  if (!pro || !pro.is_enabled || !pro.message_body) return null
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
  if (effectiveKey === null) return null // TEST002 with no Pro equivalent → skip send
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

  // Add header/footer if configured — pulled from Messaggi di Sistema Pro
  if (tpl.include_header !== false) {
    const headerTpl = templates.find(t => t.message_key === 'pro_wrapper_header' && t.is_enabled !== false)
    const footerTpl = templates.find(t => t.message_key === 'pro_wrapper_footer' && t.is_enabled !== false)
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
