// Temporary: find all cauzioni for Balducci
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
    const { clienteId, cauzioneId, updateData } = JSON.parse(event.body || '{}')
    
    if (cauzioneId && updateData) {
        const { data, error } = await supabase.from('cauzioni').update(updateData).eq('id', cauzioneId).select().single()
        if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
        return { statusCode: 200, body: JSON.stringify({ updated: data }) }
    }
    
    const { data, error } = await supabase.from('cauzioni').select('*').eq('cliente_id', clienteId)
    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, body: JSON.stringify({ cauzioni: data }) }
}
