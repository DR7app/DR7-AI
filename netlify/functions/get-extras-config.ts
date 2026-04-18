import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { convertProToLegacy } from './utils/convertProConfig'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const handler: Handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin
  const headers = corsHeaders(origin)

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Try Centralina Pro first
    const { data: proData } = await supabase
      .from('centralina_pro_config')
      .select('config, updated_at')
      .eq('id', 'main')
      .maybeSingle()

    if (proData?.config && typeof proData.config === 'object') {
      const converted = convertProToLegacy(proData.config)
      if (converted) {
        return {
          statusCode: 200,
          headers: { ...headers, 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ config: converted, updated_at: proData.updated_at }),
        }
      }
    }

    // Fallback to old config
    const { data, error } = await supabase
      .from('rental_extras_config')
      .select('config, updated_at')
      .limit(1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return { statusCode: 200, headers, body: JSON.stringify({ config: null }) }
      }
      throw error
    }

    return {
      statusCode: 200,
      headers: { ...headers, 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ config: data.config, updated_at: data.updated_at }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('get-extras-config error:', message)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: message }),
    }
  }
}

export { handler }
