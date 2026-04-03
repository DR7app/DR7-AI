-- Add nexi_contract_id to cauzioni table for card tokenization
ALTER TABLE cauzioni ADD COLUMN IF NOT EXISTS nexi_contract_id TEXT;

-- Add contract_id to nexi_transactions table
ALTER TABLE nexi_transactions ADD COLUMN IF NOT EXISTS contract_id TEXT;

-- Index for quick lookup by contract_id
CREATE INDEX IF NOT EXISTS idx_cauzioni_nexi_contract_id ON cauzioni(nexi_contract_id) WHERE nexi_contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nexi_transactions_contract_id ON nexi_transactions(contract_id) WHERE contract_id IS NOT NULL;
