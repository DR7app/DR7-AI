-- Enable revenue management by default with auto_apply mode
-- This ensures dynamic pricing from admin controls the website prices

UPDATE revenue_config
SET enabled = true,
    mode = 'auto_apply',
    updated_at = now();
