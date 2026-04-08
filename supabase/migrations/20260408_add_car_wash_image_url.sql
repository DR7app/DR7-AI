-- Add image_url column to car_wash_services
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'car_wash_services' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE car_wash_services ADD COLUMN image_url TEXT;
  END IF;
END $$;
