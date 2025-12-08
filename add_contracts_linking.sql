-- Add booking_id and pdf_url to contracts table
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id),
ADD COLUMN IF NOT EXISTS pdf_url text;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_contracts_booking_id ON contracts(booking_id);
