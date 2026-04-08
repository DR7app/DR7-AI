-- Add created_by and sent_by tracking fields to preventivi
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'preventivi' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE preventivi ADD COLUMN created_by TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'preventivi' AND column_name = 'sent_by'
  ) THEN
    ALTER TABLE preventivi ADD COLUMN sent_by TEXT;
  END IF;
END $$;
