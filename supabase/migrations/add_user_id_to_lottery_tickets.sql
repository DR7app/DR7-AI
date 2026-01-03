-- Add user_id column to link lottery tickets to customer profiles
ALTER TABLE commercial_operation_tickets
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user_id 
ON commercial_operation_tickets(user_id);

-- Backfill user_id for existing tickets by matching email to customers_extended
UPDATE commercial_operation_tickets t
SET user_id = ce.id
FROM customers_extended ce
WHERE t.email = ce.email
AND t.user_id IS NULL;

-- Also try to match with customers table if not found in customers_extended
UPDATE commercial_operation_tickets t
SET user_id = c.id
FROM customers c
WHERE t.email = c.email
AND t.user_id IS NULL;

-- Log results
DO $$
DECLARE
  linked_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM commercial_operation_tickets;
  SELECT COUNT(*) INTO linked_count FROM commercial_operation_tickets WHERE user_id IS NOT NULL;
  
  RAISE NOTICE 'Lottery tickets migration complete:';
  RAISE NOTICE '  Total tickets: %', total_count;
  RAISE NOTICE '  Linked to customers: %', linked_count;
  RAISE NOTICE '  Unlinked: %', (total_count - linked_count);
END $$;
