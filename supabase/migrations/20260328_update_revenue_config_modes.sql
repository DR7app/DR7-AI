-- Update revenue_config mode constraint to support new modes:
-- 'disabled', 'suggestion', 'auto_apply'
-- Also handles migration from legacy modes ('auto', 'auto_with_approval')

-- First update existing rows with legacy modes
UPDATE revenue_config SET mode = 'auto_apply' WHERE mode IN ('auto', 'auto_with_approval');

-- Drop old constraint and add new one
ALTER TABLE revenue_config DROP CONSTRAINT IF EXISTS revenue_config_mode_check;
ALTER TABLE revenue_config ADD CONSTRAINT revenue_config_mode_check
  CHECK (mode IN ('disabled', 'suggestion', 'auto_apply'));
