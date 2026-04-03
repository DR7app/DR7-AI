import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const handler: Handler = async (event) => {
    if (!serviceKey) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Cannot run migration.' })
        }
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const sql = `
        ALTER TABLE fatture 
        ADD COLUMN IF NOT EXISTS customer_tax_code TEXT,
        ADD COLUMN IF NOT EXISTS customer_vat TEXT;

        COMMENT ON COLUMN fatture.customer_tax_code IS 'Customer Tax Code (Codice Fiscale)';
        COMMENT ON COLUMN fatture.customer_vat IS 'Customer VAT Number (Partita IVA)';
    `

    try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: sql })

        if (error) {
            console.error('Migration failed:', error)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Migration failed', details: error })
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Migration applied successfully! Added customer_tax_code and customer_vat columns.' })
        }
    } catch (err: any) {
        console.error('Migration error:', err)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Migration exception', message: err.message })
        }
    }
}
