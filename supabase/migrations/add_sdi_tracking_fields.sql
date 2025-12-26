-- Add SDI (Sistema di Interscambio) tracking fields to fatture table
-- This enables tracking of electronic invoice submission to Italian tax system

-- Add SDI status tracking
ALTER TABLE public.fatture
ADD COLUMN IF NOT EXISTS sdi_status TEXT DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS sdi_id TEXT,
ADD COLUMN IF NOT EXISTS sdi_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sdi_response JSONB,
ADD COLUMN IF NOT EXISTS xml_fattura_pa TEXT,
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id);

-- Add check constraint for SDI status
ALTER TABLE public.fatture DROP CONSTRAINT IF EXISTS fatture_sdi_status_check;
ALTER TABLE public.fatture ADD CONSTRAINT fatture_sdi_status_check
CHECK (sdi_status IN ('draft', 'sending', 'sent', 'accepted', 'rejected', 'error'));

-- Create index for faster queries by SDI status
CREATE INDEX IF NOT EXISTS idx_fatture_sdi_status ON public.fatture(sdi_status);
CREATE INDEX IF NOT EXISTS idx_fatture_booking_id ON public.fatture(booking_id);

-- Add comments
COMMENT ON COLUMN fatture.sdi_status IS 'Status of invoice in SDI: draft, sending, sent, accepted, rejected, error';
COMMENT ON COLUMN fatture.sdi_id IS 'Unique ID from Fattura Elettronica API';
COMMENT ON COLUMN fatture.sdi_sent_at IS 'Timestamp when invoice was sent to SDI';
COMMENT ON COLUMN fatture.sdi_response IS 'JSON response from Fattura Elettronica API';
COMMENT ON COLUMN fatture.xml_fattura_pa IS 'Generated FatturaPA XML (for debugging)';
COMMENT ON COLUMN fatture.booking_id IS 'Link to booking if invoice was generated from a booking';
