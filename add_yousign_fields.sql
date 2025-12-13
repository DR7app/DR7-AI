-- Add Yousign integration fields to contracts table
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS yousign_signature_request_id text,
ADD COLUMN IF NOT EXISTS yousign_status text DEFAULT 'draft', -- draft, ongoing, signed, declined
ADD COLUMN IF NOT EXISTS signed_pdf_url text;

-- Index for faster lookups by signature request ID (useful for webhooks)
CREATE INDEX IF NOT EXISTS idx_contracts_yousign_id ON contracts(yousign_signature_request_id);
