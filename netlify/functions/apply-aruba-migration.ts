import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const migrationSQL = `
-- Add Aruba-specific columns to fatture table
ALTER TABLE fatture 
ADD COLUMN IF NOT EXISTS aruba_invoice_id text,
ADD COLUMN IF NOT EXISTS xml_filename text,
ADD COLUMN IF NOT EXISTS aruba_upload_filename text;

-- Create invoice_status_logs table
CREATE TABLE IF NOT EXISTS invoice_status_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id uuid REFERENCES fatture(id) ON DELETE CASCADE,
    status text NOT NULL,
    message text,
    raw_response jsonb,
    created_at timestamptz DEFAULT now()
);

-- Add RLS policies for invoice_status_logs (match fatture permissions)
ALTER TABLE invoice_status_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE tablename = 'invoice_status_logs' AND policyname = 'Enable read access for authenticated users'
    ) THEN
        CREATE POLICY "Enable read access for authenticated users" 
        ON invoice_status_logs FOR SELECT 
        TO authenticated 
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_policies WHERE tablename = 'invoice_status_logs' AND policyname = 'Enable insert access for authenticated users'
    ) THEN
        CREATE POLICY "Enable insert access for authenticated users" 
        ON invoice_status_logs FOR INSERT 
        TO authenticated 
        WITH CHECK (true);
    END IF;
END $$;
`

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL })

        if (error) {
            console.error('Migration SQL Error:', error)
            throw error
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Aruba migration applied successfully' })
        }
    } catch (error: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        }
    }
}
