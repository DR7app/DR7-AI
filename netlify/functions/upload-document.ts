import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { fileBase64, fileName, contentType } = JSON.parse(event.body || '{}')

        if (!fileBase64 || !fileName) {
            return { statusCode: 400, body: JSON.stringify({ error: 'File e nome richiesti' }) }
        }

        const fileBuffer = Buffer.from(fileBase64, 'base64')

        if (fileBuffer.length > 10 * 1024 * 1024) {
            return { statusCode: 400, body: JSON.stringify({ error: 'File troppo grande (max 10MB)' }) }
        }

        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `documents/${Date.now()}_${safeName}`

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(storagePath, fileBuffer, {
                contentType: contentType || 'application/pdf',
                upsert: false
            })

        if (uploadError) {
            console.error('[upload-document] Upload error:', uploadError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Errore caricamento: ' + uploadError.message }) }
        }

        const { data: publicUrl } = supabase.storage.from('contracts').getPublicUrl(storagePath)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                url: publicUrl.publicUrl,
                path: storagePath
            })
        }
    } catch (error: any) {
        console.error('[upload-document] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nel caricamento del documento', details: error.message })
        }
    }
}
