-- Add columns for standalone document signing (not tied to a contract)
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS document_name VARCHAR(255);

-- Make contract_id nullable (it already should be based on the schema, but ensure it)
ALTER TABLE signature_requests ALTER COLUMN contract_id DROP NOT NULL;
