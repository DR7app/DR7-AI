-- Add membership tier fields to customers_extended table
-- This allows tracking of membership packages (Argento, Oro, Platino)

ALTER TABLE customers_extended 
ADD COLUMN IF NOT EXISTS membership_tier TEXT CHECK (membership_tier IN ('Argento', 'Oro', 'Platino'));

ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS membership_expires_at TIMESTAMPTZ;

-- Add index for membership queries
CREATE INDEX IF NOT EXISTS idx_customers_extended_membership ON customers_extended(membership_tier);

-- Add comments
COMMENT ON COLUMN customers_extended.membership_tier IS 'Membership package tier: Argento (Silver), Oro (Gold), or Platino (Platinum)';
COMMENT ON COLUMN customers_extended.membership_expires_at IS 'Membership expiration date (NULL if lifetime or no expiration)';

-- Set Massimo Runchina as Argento member
UPDATE customers_extended
SET membership_tier = 'Argento'
WHERE full_name = 'Massimo Runchina'
  OR (nome = 'Massimo' AND cognome = 'Runchina');

-- Verify the update
SELECT id, full_name, nome, cognome, membership_tier, membership_expires_at
FROM customers_extended
WHERE membership_tier IS NOT NULL;
