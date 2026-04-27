-- Add a gap fingerprint to maxi_promo_sent_log so a booking edit that
-- changes the gap shape (different free_from / next_pickup timestamps)
-- counts as a NEW gap and the cron re-fires the WhatsApp.
--
-- Previous unique constraint (vehicle_id, gap_date, recipient) blocked
-- the resend even when the gap moved by hours. We replace it with one
-- that includes the signature.

ALTER TABLE public.maxi_promo_sent_log
  ADD COLUMN IF NOT EXISTS gap_signature text;

-- Drop the old unique on (vehicle_id, gap_date, recipient) and add the
-- new one keyed on the signature. The named constraint that Postgres
-- generated for the original UNIQUE (...) clause was auto-named — find
-- it dynamically and drop.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.maxi_promo_sent_log'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%vehicle_id%gap_date%recipient%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.maxi_promo_sent_log DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- New unique key: same (vehicle_id, recipient) pair can hold multiple
-- rows as long as the gap_signature differs. NULL signatures (legacy
-- rows) are allowed and treated as "any" — they don't block new sends.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxi_promo_sent_log_signature
  ON public.maxi_promo_sent_log (vehicle_id, gap_signature, recipient)
  WHERE gap_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maxi_promo_sent_log_vehicle_sig
  ON public.maxi_promo_sent_log (vehicle_id, gap_signature);
