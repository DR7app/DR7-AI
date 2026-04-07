/**
 * Shared utility: loads message templates from system_messages Supabase table.
 * Falls back to default text if template not found or DB unavailable.
 *
 * Variables in templates use {variable_name} syntax.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

interface MessageTemplate {
  message_key: string
  message_body: string
  is_enabled: boolean
  include_header: boolean
}

const HEADER = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora, Tecnologia Proprietaria DR7_\n\n`
const FOOTER = `\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`

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
 * Returns null if template is disabled or not found and no fallback provided.
 */
export async function getMessageTemplate(
  key: string,
  variables: Record<string, string> = {},
  fallback?: string
): Promise<string | null> {
  const templates = await loadAllTemplates()
  const tpl = templates.find(t => t.message_key === key)

  if (tpl && !tpl.is_enabled) return null // Disabled = don't send

  let body = tpl?.message_body || fallback || null
  if (!body) return null

  // Replace variables
  for (const [k, v] of Object.entries(variables)) {
    body = body.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
  }

  // Add header/footer if configured
  const includeHeader = tpl?.include_header ?? true
  if (includeHeader) {
    body = HEADER + body + FOOTER
  }

  return body
}

/**
 * Invalidate cache (call after admin edits a template)
 */
export function invalidateTemplateCache() {
  cache = null
}
