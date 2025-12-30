
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    try {
        const { data: bookings, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20)

        if (error) throw error

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                count: bookings?.length,
                bookings: bookings?.map(b => ({
                    id: b.id,
                    created_at: b.created_at,
                    customer_name: b.customer_name,
                    service_type: b.service_type,
                    status: b.status,
                    vehicle_name: b.vehicle_name,
                    price_total: b.price_total,
                    booking_source: b.booking_source // if it exists
                }))
            })
        }
    } catch (error: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
