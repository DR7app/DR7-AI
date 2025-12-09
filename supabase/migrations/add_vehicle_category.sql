-- Add category field to vehicles table for insurance selection
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS category TEXT;

-- Add check constraint for valid categories
ALTER TABLE vehicles
ADD CONSTRAINT vehicles_category_check 
CHECK (category IN ('SUPERCAR', 'URBAN', 'UTILITAIRE'));

-- Update existing vehicles based on their names
-- URBAN vehicles
UPDATE vehicles 
SET category = 'URBAN'
WHERE display_name ILIKE '%panda%' 
   OR display_name ILIKE '%captur%'
   OR display_name ILIKE '%urban%'
   OR id LIKE 'urban-car-%';

-- UTILITAIRE vehicles  
UPDATE vehicles
SET category = 'UTILITAIRE'
WHERE display_name ILIKE '%ducato%'
   OR display_name ILIKE '%van%'
   OR display_name ILIKE '%utilitaire%';

-- SUPERCAR vehicles (everything else)
UPDATE vehicles
SET category = 'SUPERCAR'
WHERE category IS NULL;

-- Make category required for future inserts
ALTER TABLE vehicles
ALTER COLUMN category SET NOT NULL;

-- Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_vehicles_category ON vehicles(category);

-- Add comment
COMMENT ON COLUMN vehicles.category IS 'Vehicle category for insurance pricing: SUPERCAR, URBAN, or UTILITAIRE';
