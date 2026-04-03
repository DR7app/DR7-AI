-- Add extension_index column to fatture table
-- NULL = main booking invoice, 0/1/2... = extension invoice for that extension_history index
ALTER TABLE fatture ADD COLUMN IF NOT EXISTS extension_index INTEGER DEFAULT NULL;
