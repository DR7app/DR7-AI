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

CREATE POLICY "Enable read access for authenticated users" 
ON invoice_status_logs FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Enable insert access for authenticated users" 
ON invoice_status_logs FOR INSERT 
TO authenticated 
WITH CHECK (true);
