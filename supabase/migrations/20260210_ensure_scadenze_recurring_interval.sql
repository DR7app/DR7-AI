-- Ensure recurring_interval column exists on scadenze table
-- Supports: monthly, quarterly, biannual, yearly
ALTER TABLE scadenze
  ADD COLUMN IF NOT EXISTS recurring_interval text;
