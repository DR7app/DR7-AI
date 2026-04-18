-- Add columns to fatture for Nota di Credito support
ALTER TABLE fatture
ADD COLUMN IF NOT EXISTS tipo_fattura VARCHAR(50) DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS related_invoice_id UUID REFERENCES fatture(id) ON DELETE SET NULL;

-- Index for quick lookup of credit notes by parent invoice
CREATE INDEX IF NOT EXISTS idx_fatture_related_invoice ON fatture(related_invoice_id) WHERE related_invoice_id IS NOT NULL;
