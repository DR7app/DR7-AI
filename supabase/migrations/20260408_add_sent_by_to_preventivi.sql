-- Add sent_by column to preventivi table
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS sent_by TEXT;

-- Ensure created_by is TEXT (may already exist as UUID, make it TEXT for email storage)
-- If created_by already exists as UUID, this will be a no-op
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'preventivi' AND column_name = 'sent_by') THEN
    ALTER TABLE preventivi ADD COLUMN sent_by TEXT;
  END IF;
END $$;
