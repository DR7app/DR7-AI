import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    try {
        // Fetch the active template
        const { data, error } = await supabase
            .from('lottery_email_templates')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('[get-lottery-email-template] Error:', error)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to fetch template: ' + error.message })
            }
        }

        if (!data) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    template: null,
                    message: 'No active template found'
                })
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                template: data
            })
        }

    } catch (error: any) {
        console.error('[get-lottery-email-template] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Unknown error occurred'
            })
        }
    }
}
