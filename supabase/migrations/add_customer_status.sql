-- Add customer status field for blacklist, VIP, and rental history tracking
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS status TEXT;

-- Add check constraint for valid statuses
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_extended_status_check'
  ) THEN
    ALTER TABLE customers_extended
    ADD CONSTRAINT customers_extended_status_check 
    CHECK (status IN ('blacklist', 'has_rental', 'vip'));
  END IF;
END $$;

-- Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_customers_extended_status ON customers_extended(status);

-- Add comment
COMMENT ON COLUMN customers_extended.status IS 'Customer status: blacklist (black), has_rental (green), vip (yellow)';
