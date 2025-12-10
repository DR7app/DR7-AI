
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    try {
        const { data: bookings, error } = await supabase
            .from('bookings')
            .select('service_type')

        if (error) throw error

        const counts: Record<string, number> = {}
        bookings?.forEach(b => {
            const type = b.service_type || 'NULL'
            counts[type] = (counts[type] || 0) + 1
        })

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, counts })
        }
    } catch (error: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
