-- Add category field to vehicles table for insurance selection
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS category TEXT;

-- Add check constraint for valid categories (skip if exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'vehicles_category_check'
  ) THEN
    ALTER TABLE vehicles
    ADD CONSTRAINT vehicles_category_check 
    CHECK (category IN ('SUPERCAR', 'URBAN', 'UTILITAIRE'));
  END IF;
END $$;

-- Update existing vehicles based on their names (only if category is null)
-- URBAN vehicles
UPDATE vehicles 
SET category = 'URBAN'
WHERE category IS NULL
  AND (display_name ILIKE '%panda%' 
   OR display_name ILIKE '%captur%'
   OR display_name ILIKE '%urban%'
   OR id::text LIKE 'urban-car-%');

-- UTILITAIRE vehicles  
UPDATE vehicles
SET category = 'UTILITAIRE'
WHERE category IS NULL
  AND (display_name ILIKE '%ducato%'
   OR display_name ILIKE '%van%'
   OR display_name ILIKE '%utilitaire%');

-- SUPERCAR vehicles (everything else)
UPDATE vehicles
SET category = 'SUPERCAR'
WHERE category IS NULL;

-- Make category required for future inserts (only if not already set)
DO $$
BEGIN
  ALTER TABLE vehicles
  ALTER COLUMN category SET NOT NULL;
EXCEPTION
  WHEN others THEN
    -- Column might already be NOT NULL, ignore error
    NULL;
END $$;

-- Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_vehicles_category ON vehicles(category);

-- Add comment
COMMENT ON COLUMN vehicles.category IS 'Vehicle category for insurance pricing: SUPERCAR, URBAN, or UTILITAIRE';

